import type {
  KazumiApiRequest,
  KazumiChapterApiConfig,
  KazumiChapterResult,
  KazumiPolicy,
  KazumiSearchApiConfig,
  KazumiSearchResult,
} from '@danmaku-anywhere/extension-protocol'
import { isRecord, readJsonPath, readJsonPathFirst } from './jsonPath.js'

type Variables = Record<string, unknown>

type PreparedRequest = {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  query: Record<string, unknown>
  bodyType: string
  body: unknown
}

const VARIABLE_PATTERN = /(?<![A-Za-z0-9_])@([A-Za-z_][A-Za-z0-9_]*)/g
const EXACT_VARIABLE_PATTERN = /^@([A-Za-z_][A-Za-z0-9_]*)$/

function stringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return typeof value === 'string' ? value.trim() : String(value)
}

function isHttpProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:'
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function toStringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(toRecord(value))) {
    result[key] = item === null || item === undefined ? '' : String(item)
  }
  return result
}

export function renderTemplate(
  template: string,
  variables: Variables,
  encode = false
): string {
  return template.replace(VARIABLE_PATTERN, (match, name: string) => {
    if (!Object.hasOwn(variables, name)) {
      throw new Error(`Missing template variable ${match}`)
    }
    const value = variables[name]
    const text = value === null || value === undefined ? '' : String(value)
    return encode ? encodeURIComponent(text) : text
  })
}

export function renderValue(value: unknown, variables: Variables): unknown {
  if (typeof value === 'string') {
    const exact = EXACT_VARIABLE_PATTERN.exec(value)
    if (exact) {
      const name = exact[1]
      if (!Object.hasOwn(variables, name)) {
        throw new Error(`Missing template variable @${name}`)
      }
      return variables[name]
    }
    return renderTemplate(value, variables)
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, variables))
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      result[renderTemplate(key, variables)] = renderValue(item, variables)
    }
    return result
  }
  return value
}

export function prepareRequest(
  config: KazumiApiRequest,
  variables: Variables
): PreparedRequest {
  const upperMethod = config.method.toUpperCase()
  let method: 'GET' | 'POST' = 'GET'
  if (upperMethod === 'POST') {
    method = 'POST'
  } else if (upperMethod !== 'GET') {
    throw new Error(`Unsupported API method: ${upperMethod}`)
  }

  const url = renderTemplate(config.url.trim(), variables, true)
  const parsed = new URL(url)
  if (!parsed.host) {
    throw new Error(`Invalid API url: ${url}`)
  }

  const hasBody = method === 'POST' && config.bodyType !== 'none'
  return {
    method,
    url,
    headers: toStringRecord(renderValue(config.headers, variables)),
    query: toRecord(renderValue(config.query, variables)),
    bodyType: config.bodyType,
    body: hasBody ? renderValue(config.body, variables) : undefined,
  }
}

export async function executeRequest(
  request: PreparedRequest
): Promise<string> {
  const url = new URL(request.url)
  for (const [key, value] of Object.entries(request.query)) {
    if (value === null || value === undefined) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item))
      }
    } else {
      url.searchParams.append(key, String(value))
    }
  }

  const headers = new Headers(request.headers)
  const init: RequestInit = {
    method: request.method,
    headers,
    credentials: 'include',
  }
  if (request.method === 'POST' && request.body !== undefined) {
    if (!headers.has('content-type')) {
      headers.set(
        'content-type',
        request.bodyType === 'form'
          ? 'application/x-www-form-urlencoded'
          : 'application/json'
      )
    }
    if (request.bodyType === 'form') {
      init.body = new URLSearchParams(toStringRecord(request.body)).toString()
    } else {
      init.body = JSON.stringify(request.body)
    }
  }

  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${url.host}`)
  }
  return response.text()
}

export function parseSearch(
  raw: string,
  config: KazumiSearchApiConfig
): KazumiSearchResult[] {
  const document: unknown = JSON.parse(raw)
  const nodes = readJsonPath(document, config.listPath)
  const results: KazumiSearchResult[] = []
  for (const node of nodes) {
    const name = stringValue(readJsonPathFirst(node, config.namePath))
    const source = stringValue(readJsonPathFirst(node, config.sourcePath))
    if (!name || !source) {
      continue
    }
    const url = config.sourceTemplate
      ? config.sourceTemplate.replaceAll('@source', () =>
          encodeURIComponent(source)
        )
      : source
    results.push({ name, url })
  }
  return results
}

export function normalizeEpisodeUrl(baseUrl: string, raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    return ''
  }

  let resolved: URL
  try {
    resolved = new URL(trimmed, baseUrl)
  } catch {
    return trimmed
  }
  if (!resolved.host) {
    return trimmed
  }

  try {
    const base = new URL(baseUrl)
    if (
      isHttpProtocol(base.protocol) &&
      isHttpProtocol(resolved.protocol) &&
      resolved.protocol !== base.protocol &&
      resolved.host === base.host
    ) {
      resolved.protocol = base.protocol
    }
  } catch {
    return resolved.toString()
  }

  if (resolved.pathname.length > 1 && resolved.pathname.endsWith('/')) {
    resolved.pathname = resolved.pathname.replace(/\/+$/, '')
  }
  // Assigning an empty search removes the bare '?' URL keeps for an empty query.
  if (!resolved.search) {
    resolved.search = ''
  }
  if (resolved.href.endsWith('#')) {
    resolved.hash = ''
  }
  return resolved.toString()
}

function resolveEpisodeUrl(
  config: KazumiChapterApiConfig,
  variables: Variables,
  rawUrl: string,
  roadIndex: number,
  episodeIndex: number,
  baseUrl: string
): string {
  const page = config.episodePage
  if (!page) {
    return normalizeEpisodeUrl(baseUrl, rawUrl)
  }
  if (!page.url.trim()) {
    throw new Error('Episode page url template is empty')
  }

  const pageVariables: Variables = {
    ...variables,
    episodeUrl: rawUrl,
    roadIndex,
    roadNumber: roadIndex + 1,
    episodeIndex,
    episodeNumber: episodeIndex + 1,
  }
  const url = new URL(renderTemplate(page.url, pageVariables, true), baseUrl)
  const query = toStringRecord(renderValue(page.query, pageVariables))
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return normalizeEpisodeUrl(baseUrl, url.toString())
}

function parseNested(
  document: unknown,
  config: KazumiChapterApiConfig,
  variables: Variables,
  baseUrl: string
): KazumiChapterResult[][] {
  const hasRoads = config.roadsPath.trim().length > 0
  const roadNodes = hasRoads
    ? readJsonPath(document, config.roadsPath)
    : [document]
  const roads: KazumiChapterResult[][] = []

  for (const [roadIndex, roadNode] of roadNodes.entries()) {
    const episodes = readJsonPath(roadNode, config.episodesPath)
    const chapters: KazumiChapterResult[] = []
    for (const [episodeIndex, episodeNode] of episodes.entries()) {
      const name = stringValue(
        readJsonPathFirst(episodeNode, config.episodeNamePath)
      )
      const rawUrl = config.episodeUrlPath.trim()
        ? stringValue(readJsonPathFirst(episodeNode, config.episodeUrlPath))
        : ''
      const url = resolveEpisodeUrl(
        config,
        variables,
        rawUrl,
        roadIndex,
        episodeIndex,
        baseUrl
      )
      if (!url) {
        continue
      }
      chapters.push({ name: name || `第${episodeIndex + 1}集`, url })
    }
    if (chapters.length > 0) {
      roads.push(chapters)
    }
  }
  return roads
}

function parseDelimited(
  document: unknown,
  config: KazumiChapterApiConfig,
  variables: Variables,
  baseUrl: string
): KazumiChapterResult[][] {
  const episodes = stringValue(
    readJsonPathFirst(document, config.roadEpisodesPath)
  )
  if (!episodes) {
    return []
  }

  const roads: KazumiChapterResult[][] = []
  const groups = episodes.split(config.roadSeparator)
  for (const [roadIndex, group] of groups.entries()) {
    const chapters: KazumiChapterResult[] = []
    const entries = group.split(config.episodeSeparator)
    for (const [episodeIndex, entry] of entries.entries()) {
      const trimmed = entry.trim()
      if (!trimmed) {
        continue
      }
      const separatorIndex = trimmed.indexOf(config.fieldSeparator)
      if (separatorIndex < 0) {
        continue
      }
      const name = trimmed.slice(0, separatorIndex).trim()
      const rawUrl = trimmed
        .slice(separatorIndex + config.fieldSeparator.length)
        .trim()
      const url = resolveEpisodeUrl(
        config,
        variables,
        rawUrl,
        roadIndex,
        episodeIndex,
        baseUrl
      )
      if (!url) {
        continue
      }
      chapters.push({ name: name || `第${episodeIndex + 1}集`, url })
    }
    if (chapters.length > 0) {
      roads.push(chapters)
    }
  }
  return roads
}

export function parseChapters(
  raw: string,
  config: KazumiChapterApiConfig,
  source: string,
  baseUrl: string
): KazumiChapterResult[][] {
  const document: unknown = JSON.parse(raw)
  const variables: Variables = { source }
  for (const [key, path] of Object.entries(config.variables)) {
    const value = readJsonPathFirst(document, path)
    if (value === undefined) {
      throw new Error(`Missing chapter variable ${key}: ${path}`)
    }
    variables[key] = value
  }

  if (config.format === 'delimited') {
    return parseDelimited(document, config, variables, baseUrl)
  }
  return parseNested(document, config, variables, baseUrl)
}

export async function kazumiSearchApi(
  keyword: string,
  policy: KazumiPolicy
): Promise<KazumiSearchResult[]> {
  const config = policy.searchApiConfig
  if (!config) {
    throw new Error(`Policy ${policy.name} has no search API config`)
  }
  const request = prepareRequest(config.request, { keyword })
  return parseSearch(await executeRequest(request), config)
}

export async function kazumiGetChaptersApi(
  contentUrl: string,
  policy: KazumiPolicy
): Promise<KazumiChapterResult[][]> {
  const config = policy.chapterApiConfig
  if (!config) {
    throw new Error(`Policy ${policy.name} has no chapter API config`)
  }
  const request = prepareRequest(config.request, { source: contentUrl })
  return parseChapters(
    await executeRequest(request),
    config,
    contentUrl,
    policy.baseURL
  )
}
