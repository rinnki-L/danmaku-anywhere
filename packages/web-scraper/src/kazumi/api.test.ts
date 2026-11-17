import type { KazumiPolicy } from '@danmaku-anywhere/extension-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  executeRequest,
  kazumiGetChaptersApi,
  kazumiSearchApi,
  normalizeEpisodeUrl,
  parseChapters,
  parseSearch,
  prepareRequest,
  renderTemplate,
  renderValue,
} from './api.js'

const searchConfig = {
  listPath: '$.list[*]',
  namePath: '$.name',
  sourcePath: '$.id',
  sourceTemplate: '',
}

const chapterConfig = {
  format: 'nested',
  roadsPath: '$.data.roads[*]',
  episodesPath: '$.episodes[*]',
  episodeNamePath: '$.name',
  episodeUrlPath: '$.url',
  roadEpisodesPath: '',
  roadSeparator: '$$$',
  episodeSeparator: '#',
  fieldSeparator: '$',
  variables: {},
  episodePage: null,
}

const requestConfig = {
  method: 'GET',
  url: 'https://example.com/api/search',
  headers: {},
  query: {},
  bodyType: 'none',
  body: undefined,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('template rendering', () => {
  it('renders variables and encodes them when asked', () => {
    const variables = { keyword: 'a b&c', source: 42 }
    expect(renderTemplate('/search?q=@keyword&id=@source', variables)).toBe(
      '/search?q=a b&c&id=42'
    )
    expect(renderTemplate('/q/@keyword', variables, true)).toBe('/q/a%20b%26c')
    expect(renderTemplate('/play/@source', variables, true)).toBe('/play/42')
  })

  it('does not replace an at sign that follows a word character', () => {
    expect(renderTemplate('x@y', { y: 'no' })).toBe('x@y')
  })

  it('throws when a variable is missing', () => {
    expect(() => renderTemplate('@missing', {})).toThrow(
      'Missing template variable @missing'
    )
  })

  it('keeps the original type of an exact variable value', () => {
    expect(
      renderValue({ page: '@number', nested: ['@number'] }, { number: 3 })
    ).toEqual({ page: 3, nested: [3] })
  })
})

describe('prepareRequest', () => {
  it('renders query values for a GET request', () => {
    const request = prepareRequest(
      { ...requestConfig, query: { wd: '@keyword', mid: '1', page: 1 } },
      { keyword: 'fate' }
    )

    expect(request.method).toBe('GET')
    expect(request.query).toEqual({ wd: 'fate', mid: '1', page: 1 })
    expect(request.body).toBeUndefined()
  })

  it('renders url, headers and body for a POST json request', () => {
    const request = prepareRequest(
      {
        method: 'POST',
        url: 'https://api.example.com/rpc/@source',
        headers: { apikey: 'key' },
        query: {},
        bodyType: 'json',
        body: { p_id: '@source', page: 1 },
      },
      { source: 'abc' }
    )

    expect(request.url).toBe('https://api.example.com/rpc/abc')
    expect(request.headers).toEqual({ apikey: 'key' })
    expect(request.body).toEqual({ p_id: 'abc', page: 1 })
  })

  it('rejects unsupported methods and invalid urls', () => {
    expect(() =>
      prepareRequest({ ...requestConfig, method: 'PUT' }, {})
    ).toThrow()
    expect(() =>
      prepareRequest({ ...requestConfig, url: 'not-a-url' }, {})
    ).toThrow()
  })
})

describe('executeRequest', () => {
  it('appends query parameters and returns the response text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)

    const text = await executeRequest({
      method: 'GET',
      url: 'https://example.com/api',
      headers: { apikey: 'key' },
      query: { wd: 'fate', page: 1 },
      bodyType: 'none',
      body: undefined,
    })

    expect(text).toBe('{"ok":true}')
    const call = fetchMock.mock.calls[0]
    const url = call[0] as URL
    const init = call[1] as RequestInit
    expect(url.toString()).toBe('https://example.com/api?wd=fate&page=1')
    expect(init.method).toBe('GET')
  })

  it('sends cookies with API requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    await executeRequest({
      method: 'GET',
      url: 'https://example.com/api',
      headers: {},
      query: {},
      bodyType: 'none',
      body: undefined,
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('include')
  })

  it('serializes a POST json body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    await executeRequest({
      method: 'POST',
      url: 'https://api.example.com/rpc',
      headers: {},
      query: {},
      bodyType: 'json',
      body: { p_id: 'abc' },
    })

    const call = fetchMock.mock.calls[0]
    const init = call[1] as RequestInit
    expect(init.body).toBe('{"p_id":"abc"}')
    expect(new Headers(init.headers).get('content-type')).toBe(
      'application/json'
    )
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    )

    await expect(
      executeRequest({
        method: 'GET',
        url: 'https://example.com/api',
        headers: {},
        query: {},
        bodyType: 'none',
        body: undefined,
      })
    ).rejects.toThrow('API request failed: 503')
  })
})

describe('parseSearch', () => {
  it('builds detail urls from a source template', () => {
    const raw = JSON.stringify({
      list: [
        { name: 'A', id: 7 },
        { name: '', id: 8 },
      ],
    })

    expect(
      parseSearch(raw, {
        ...searchConfig,
        sourceTemplate: 'https://example.com/vod/@source.html',
      })
    ).toEqual([{ name: 'A', url: 'https://example.com/vod/7.html' }])
  })

  it('keeps the raw source when no template is set', () => {
    const raw = JSON.stringify([{ title: 'B', id: 'abc' }])

    expect(
      parseSearch(raw, {
        ...searchConfig,
        listPath: '$[*]',
        namePath: '$.title',
      })
    ).toEqual([{ name: 'B', url: 'abc' }])
  })
})

describe('parseChapters', () => {
  it('builds nested chapters from an episode page template', () => {
    const raw = JSON.stringify({
      sources: [
        {
          name: 'line1',
          episodes: [
            { title: '1', id: 'e1' },
            { title: '2', id: 'e2' },
          ],
        },
      ],
    })

    expect(
      parseChapters(
        raw,
        {
          ...chapterConfig,
          roadsPath: '$.sources[*]',
          episodesPath: '$.episodes[*]',
          episodeNamePath: '$.title',
          episodeUrlPath: '$.id',
          episodePage: {
            url: 'https://next.example.com/anime/@source/play/@episodeUrl',
            query: {},
          },
        },
        'anime-1',
        'https://next.example.com/'
      )
    ).toEqual([
      [
        { name: '1', url: 'https://next.example.com/anime/anime-1/play/e1' },
        { name: '2', url: 'https://next.example.com/anime/anime-1/play/e2' },
      ],
    ])
  })

  it('falls back to 第N集 when an episode has no name', () => {
    const raw = JSON.stringify({
      episodes: [{ name: '', id: 'e1' }, { id: 'e2' }],
    })

    expect(
      parseChapters(
        raw,
        {
          ...chapterConfig,
          roadsPath: '',
          episodeUrlPath: '$.id',
        },
        'source',
        'https://example.com/'
      )
    ).toEqual([
      [
        { name: '第1集', url: 'https://example.com/e1' },
        { name: '第2集', url: 'https://example.com/e2' },
      ],
    ])
  })

  it('normalizes direct episode urls against the base url', () => {
    const raw = JSON.stringify({
      data: { episodes: [{ name: 'EP1', url: '/watch/1' }] },
    })

    expect(
      parseChapters(
        raw,
        {
          ...chapterConfig,
          roadsPath: '',
          episodesPath: '$.data.episodes[*]',
        },
        'x',
        'https://www.example.com/'
      )
    ).toEqual([[{ name: 'EP1', url: 'https://www.example.com/watch/1' }]])
  })

  it('parses delimited chapter strings into separate roads', () => {
    const raw = JSON.stringify({
      info: {
        vod_play_from: '线路1$$$线路2',
        vod_play_url:
          '第1集$https://cdn.example.com/1.m3u8#第2集$/watch/2$$$第1集$/watch/3',
      },
    })

    expect(
      parseChapters(
        raw,
        {
          ...chapterConfig,
          format: 'delimited',
          roadEpisodesPath: '$.info.vod_play_url',
        },
        '123',
        'https://cdn.example.com/'
      )
    ).toEqual([
      [
        { name: '第1集', url: 'https://cdn.example.com/1.m3u8' },
        { name: '第2集', url: 'https://cdn.example.com/watch/2' },
      ],
      [{ name: '第1集', url: 'https://cdn.example.com/watch/3' }],
    ])
  })

  it('exposes named response variables to the episode page', () => {
    const raw = JSON.stringify({
      meta: { slug: 'abc' },
      episodes: [{ name: '1', url: '' }],
    })

    expect(
      parseChapters(
        raw,
        {
          ...chapterConfig,
          roadsPath: '',
          episodesPath: '$.episodes[*]',
          episodeUrlPath: '',
          variables: { slug: '$.meta.slug' },
          episodePage: {
            url: 'https://example.com/@slug/@episodeIndex',
            query: {},
          },
        },
        'x',
        'https://example.com/'
      )
    ).toEqual([[{ name: '1', url: 'https://example.com/abc/0' }]])
  })
})

describe('api rule entry points', () => {
  const apiPolicyWithoutConfig = {
    name: 'no-api-config',
    baseURL: 'https://example.com/',
    searchMode: 'api',
    chapterMode: 'api',
  } as KazumiPolicy

  it('refuses an api search rule without a request config', async () => {
    await expect(
      kazumiSearchApi('keyword', apiPolicyWithoutConfig)
    ).rejects.toThrow('has no search API config')
  })

  it('refuses an api chapter rule without a request config', async () => {
    await expect(
      kazumiGetChaptersApi('https://example.com/show', apiPolicyWithoutConfig)
    ).rejects.toThrow('has no chapter API config')
  })
})

describe('normalizeEpisodeUrl', () => {
  it('resolves relative paths and removes a trailing slash', () => {
    expect(normalizeEpisodeUrl('https://example.com/', '/watch/1/')).toBe(
      'https://example.com/watch/1'
    )
  })

  it('unifies the protocol of same host urls and drops an empty query', () => {
    expect(
      normalizeEpisodeUrl('https://example.com/', 'http://example.com/watch/2?')
    ).toBe('https://example.com/watch/2')
  })

  it('keeps a real query', () => {
    expect(normalizeEpisodeUrl('https://example.com/', '/watch/2?a=1')).toBe(
      'https://example.com/watch/2?a=1'
    )
  })

  it('drops empty query and fragment markers', () => {
    expect(normalizeEpisodeUrl('https://example.com/', '/watch/3?#')).toBe(
      'https://example.com/watch/3'
    )
  })

  it('returns an empty string for blank input', () => {
    expect(normalizeEpisodeUrl('https://example.com/', '  ')).toBe('')
  })
})
