import { z } from 'zod'

export const zKazumiManifest = z.object({
  name: z.string(),
  version: z.string(),
  useNativePlayer: z.boolean(),
  author: z.string(),
  lastUpdate: z.number(),
})

export type KazumiManifest = z.output<typeof zKazumiManifest>

const zKazumiRuleMode = z.enum(['xpath', 'api']).prefault('xpath')

// A rule that searches or lists chapters through an API describes the request
// as a template (values reference @keyword for search and @source for
// chapters) and reads the response with JSONPath expressions. Unknown fields
// are kept because Kazumi grows the format independently of this schema.
const zKazumiApiRequest = z.looseObject({
  method: z.string().prefault('GET'),
  url: z.string().prefault(''),
  headers: z.record(z.string(), z.unknown()).prefault({}),
  query: z.record(z.string(), z.unknown()).prefault({}),
  bodyType: z.string().prefault('none'),
  body: z.unknown().optional(),
})

export type KazumiApiRequest = z.output<typeof zKazumiApiRequest>

export const zKazumiSearchApiConfig = z.looseObject({
  request: zKazumiApiRequest.prefault({}),
  listPath: z.string().prefault('$.data[*]'),
  namePath: z.string().prefault('$.name'),
  sourcePath: z.string().prefault('$.url'),
  sourceTemplate: z.string().prefault(''),
})

export type KazumiSearchApiConfig = z.output<typeof zKazumiSearchApiConfig>

export const zKazumiEpisodePage = z.looseObject({
  url: z.string().prefault(''),
  query: z.record(z.string(), z.unknown()).prefault({}),
})

export type KazumiEpisodePage = z.output<typeof zKazumiEpisodePage>

export const zKazumiChapterApiConfig = z.looseObject({
  request: zKazumiApiRequest.prefault({}),
  format: z.string().prefault('nested'),
  roadsPath: z.string().prefault('$.data.roads[*]'),
  roadNamePath: z.string().prefault('$.name'),
  episodesPath: z.string().prefault('$.episodes[*]'),
  episodeNamePath: z.string().prefault('$.name'),
  episodeUrlPath: z.string().prefault('$.url'),
  roadNamesPath: z.string().prefault(''),
  roadEpisodesPath: z.string().prefault(''),
  roadSeparator: z.string().prefault('$$$'),
  episodeSeparator: z.string().prefault('#'),
  fieldSeparator: z.string().prefault('$'),
  variables: z.record(z.string(), z.string()).prefault({}),
  episodePage: zKazumiEpisodePage.nullish(),
})

export type KazumiChapterApiConfig = z.output<typeof zKazumiChapterApiConfig>

const searchSelectors = [
  'searchURL',
  'searchList',
  'searchName',
  'searchResult',
] as const

const chapterSelectors = ['chapterRoads', 'chapterResult'] as const

type XPathSelector =
  | (typeof searchSelectors)[number]
  | (typeof chapterSelectors)[number]

// A rule that searches or lists chapters through an API leaves the matching
// XPath fields empty, so emptiness is only an error in xpath mode.
export const zKazumiPolicy = z
  .object({
    api: z.string(),
    type: z.string(),
    name: z.string().min(1),
    version: z.string(),
    muliSources: z.boolean().prefault(false),
    useWebview: z.boolean().prefault(false),
    useNativePlayer: z.boolean().prefault(false),
    usePost: z.boolean().prefault(false),
    useLegacyParser: z.boolean().prefault(false),
    userAgent: z.string().prefault(''),
    baseURL: z.string().min(1),
    searchMode: zKazumiRuleMode,
    chapterMode: zKazumiRuleMode,
    searchURL: z.string().prefault(''),
    searchList: z.string().prefault(''),
    searchName: z.string().prefault(''),
    searchResult: z.string().prefault(''),
    chapterRoads: z.string().prefault(''),
    chapterResult: z.string().prefault(''),
    referer: z.string().prefault(''),
    searchApiConfig: zKazumiSearchApiConfig.nullish(),
    chapterApiConfig: zKazumiChapterApiConfig.nullish(),
  })
  .superRefine((policy, ctx) => {
    const required: XPathSelector[] = []
    if (policy.searchMode === 'xpath') {
      required.push(...searchSelectors)
    }
    if (policy.chapterMode === 'xpath') {
      required.push(...chapterSelectors)
    }
    for (const key of required) {
      if (policy[key] === '') {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required in xpath mode`,
        })
      }
    }
  })

export type KazumiPolicy = z.output<typeof zKazumiPolicy>

// Whether every step of a rule opens a page and reads it with XPath, as
// opposed to a step that goes through an API. Rules stored before the mode
// fields existed have no mode at all, and are xpath rules.
export function isXPathPolicy(policy: KazumiPolicy): boolean {
  return policy.searchMode !== 'api' && policy.chapterMode !== 'api'
}
