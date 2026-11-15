# Post-split contribution architecture: three repos, one shared contract surface

Baseline: upstream master `f4bd6d62` (2026-11-15), with #647 (remove web app) and #649 (remove backend) still open but fully staged for merge. This plan covers what the contributor side (forks, branches, PRs, local preview) looks like once those land, and the cross-repo contracts that must not drift.

Context: the split is the planned DA-764 refactor, not a reaction to anything. Step one was c99046e5 (`(chore) publish the shared packages to public npm [DA-764] (#643)`); the docs site already moved out in d92fd823. The `Danmaku-Anywhere/web` repo was created 2026-11-13 and `Danmaku-Anywhere/backend` on 2026-11-15, both actively pushed.

## 1. Repo map after #647 and #649 merge

| Repo | Contains | Deploys |
|---|---|---|
| `Danmaku-Anywhere/danmaku-anywhere` (monorepo) | Extension (`packages/danmaku-anywhere`), `danmaku-engine`, `danmaku-model`, `danmaku-provider`, `danmaku-converter`, `extension-protocol`, `integration-policy`, `result`, `web-scraper`, `tools/`, `dev/`, `patches/` | Store + nightly extension builds |
| `Danmaku-Anywhere/web` | Angular app (repo root) + `packages/bangumi-api` (generated Bangumi types, workspace package) + `worker/` | Cloudflare Workers Builds: `danmaku.weeblify.app` from `master`, preview deploy per branch |
| `Danmaku-Anywhere/backend` | Cloudflare Worker proxy (auth, LLM, integration-policy API, manifest) | Workers Build for staging; prod by hand (`pnpm deploy:prod`) |

### The shared contract surface (all npm, published from the monorepo via changesets)

| Package | Consumed by | Coupling |
|---|---|---|
| `@danmaku-anywhere/extension-protocol` ^0.1.0 | web app (messaging with the installed extension) | Runtime: the deployed web app talks to extensions of many versions |
| `@danmaku-anywhere/danmaku-model` ^0.2.0 | web app | Compile-time types only |
| `@danmaku-anywhere/integration-policy` ^0.1.0 | backend (npm) AND extension (monorepo workspace) | The extension and the backend must agree on the policy schema at runtime |

Everything else the web app needs is either in the web repo (`bangumi-api`) or on npm from third parties.

## 2. The four ways this can go badly wrong

1. **extension-protocol skew (highest stakes).** The web CLAUDE.md already names it: installed extensions can be older or newer than the app. A breaking RPC change published to npm and adopted by the web app breaks every user whose extension is one release behind. The protocol must stay additively backwards-compatible, or feature-detect before calling (the pattern #611 uses: `setHeaders` answers with a rule id; an old extension just doesn't answer).
2. **Silent npm drift.** Both new repos consume caret ranges (`^0.1.0`, `^0.2.0`) of 0.x packages, where npm treats every minor as compatible. A refactor inside the monorepo can change runtime behaviour without a major bump, and the next `pnpm install` in the web repo picks it up. The monorepo already guards itself with `minimumReleaseAge`; the consumers have no equivalent gate.
3. **integration-policy double consumption.** The extension validates policies from the workspace copy; the backend validates from npm. If a schema change lands in the monorepo but the backend's npm version lags, the two validators disagree and either the backend rejects valid policies or accepts invalid ones.
4. **PR mis-targeting.** `app/web/**` muscle memory is now wrong. #645, #646, and #611 all touch `app/web` — they must merge before #647, or their web-side commits get ported to the new repo by hand.

## 3. Contributor workflow redesign

### 3.1 Local layout: sibling checkouts, not subdirectories

```
C:\danmaku-anywhere            # monorepo (existing; extension + shared packages)
C:\danmaku-anywhere-web        # fork of Danmaku-Anywhere/web
C:\danmaku-anywhere-backend    # fork of Danmaku-Anywhere/backend
```

Each fork gets the established remote shape (origin = fork via the ghfast mirror, upstream = `Danmaku-Anywhere/<repo>`), helpers disabled, inline `gh` token — same as the monorepo fork.

```
gh repo fork Danmaku-Anywhere/web --clone=false
gh repo fork Danmaku-Anywhere/backend --clone=false
```

### 3.2 Change routing: "shared package changes go monorepo-first, always"

- Types or protocol changes → PR to the monorepo → changeset release → bump `^` version in web/backend → consume.
- The web app owns its own regressions: Bangumi surfaces, Kazumi UI, player. Those never touch the monorepo.
- `integration-policy` schema changes are the risky middle: they need coordinated bumps in two repos. Land the monorepo PR first, note in the PR body which consumer repos need the version bump, and do the bumps as separate small PRs.

### 3.3 The `local/all-features` integration branch becomes per-repo

A single integration branch can no longer span extension and web changes. Replace it with one integration branch per repo (`local/all-features` in the monorepo, same name in the web fork), and when a feature crosses both (e.g. a new RPC plus its web UI), keep a pairing note in the PR bodies rather than one mega-branch.

### 3.4 Local preview setup splits

The current recipe (`dev/preview-server.mjs`, extension built with `NODE_ENV=development`) loses its web half to the new repo. After the split:

- Web app dev: `pnpm start` in `C:\danmaku-anywhere-web` (per its CLAUDE.md; install is `pnpm install && pnpm build:packages`).
- Extension dev: unchanged, monorepo.
- Cross-repo verification (extension ↔ web messaging): run both at once — web dev server plus the development extension build pointed at it. Any breakage here is exactly risk 1, so this pairing is the manual gate for every protocol-touching change.
- Workers Builds now provides branch previews of the real deployed app for web PRs automatically, which replaces most manual web verification.

### 3.5 Porting plan for the open PRs

- Preferred path: #645 and #646 merge into the monorepo before #647 (both are CLEAN, green, and only touch `app/web`; #611 is the maintainer's own and touches the same tree, so it lands on the same clock).
- If #647 merges first: cherry-pick the `app/web` commits of #645 (`6506787b`, `c3342e32`, plus the earlier image commits) and #646 onto a branch in the web fork; `bangumi-api` path references don't change for #645/#646 since neither touches it. Retitle with the same DA ids (DA-771, DA-769) — ClickUp titles carry across repos.

### 3.6 Conventions per repo (verify before first PR to each)

Both new repos run `pr-quality.yml` + `pr-title-check.yml` only — no changesets, no extension builds. Titles follow `(app) description [DA-123]` in all three repos. Biome/pnpm conventions are identical to the monorepo; the web repo pins pnpm via `mise.toml`.

## 4. Suggestions worth raising upstream (optional, one message)

1. Pin or gate the `@danmaku-anywhere/*` deps in web/backend (exact pins, or Renovate with `minimumReleaseAge`), so monorepo internals can't leak into a deployed app within hours of publishing.
2. Keep a small compatibility matrix (extension version ↔ extension-protocol version ↔ web features) in the web repo's AGENTS.md, updated with each protocol change.
3. For `integration-policy`, consider the backend consuming the same commit the extension is built from in CI (a smoke job), so the two validators can't drift.

## 5. Not in scope

- Any change to the extension's storage/migration plan — governed by `architecture/1.6-compatibility-plan.md`.
- The maintainer's repo-split mechanics themselves (#647/#649 are done work to review, not to redesign).
