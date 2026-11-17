import type { KazumiPolicy } from '@danmaku-anywhere/extension-protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTab } from '../utils.js'
import { kazumiGetChapters, kazumiSearch } from './tasks.js'

/**
 * A rule whose search or chapter step runs through an API must reach the API
 * implementation without opening a tab; an xpath step still opens one. Rules
 * stored before the mode fields existed have no mode, and behave as xpath.
 */

const { searchApiMock, chaptersApiMock } = vi.hoisted(() => ({
  searchApiMock: vi.fn(),
  chaptersApiMock: vi.fn(),
}))

vi.mock('./api.js', () => ({
  kazumiSearchApi: searchApiMock,
  kazumiGetChaptersApi: chaptersApiMock,
}))

vi.mock('../utils.js', () => ({
  createTab: vi.fn(),
  createJob: vi.fn(),
  Logger: { debug: vi.fn() },
}))

const xpathPolicy: KazumiPolicy = {
  api: '4',
  type: 'anime',
  name: '7sefun',
  version: '1.3',
  muliSources: true,
  useWebview: true,
  useNativePlayer: true,
  usePost: false,
  useLegacyParser: false,
  userAgent: '',
  baseURL: 'https://www.7sefun.top/',
  searchMode: 'xpath',
  chapterMode: 'xpath',
  searchURL: 'https://www.7sefun.top/vodsearch/-------------.html?wd=@keyword',
  searchList: '//div',
  searchName: '//div[2]/text()',
  searchResult: '//a',
  chapterRoads: '//div',
  chapterResult: '//a',
  referer: '',
}

const apiSearchPolicy: KazumiPolicy = {
  ...xpathPolicy,
  name: 'dalvdm',
  searchMode: 'api',
  searchURL: '',
  searchList: '',
  searchName: '',
  searchResult: '',
}

const apiChapterPolicy: KazumiPolicy = {
  ...xpathPolicy,
  name: 'xfdmnext',
  chapterMode: 'api',
  chapterRoads: '',
  chapterResult: '',
}

describe('api mode routing', () => {
  beforeEach(() => {
    vi.mocked(createTab).mockReset()
    searchApiMock.mockReset()
    chaptersApiMock.mockReset()
  })

  it('kazumiSearch asks the API implementation for an api search rule', async () => {
    const results = [{ name: 'Show', url: 'https://example.com/show' }]
    searchApiMock.mockResolvedValue(results)

    await expect(kazumiSearch('keyword', apiSearchPolicy)).resolves.toEqual(
      results
    )
    expect(searchApiMock).toHaveBeenCalledWith('keyword', apiSearchPolicy)
    expect(createTab).not.toHaveBeenCalled()
  })

  it('kazumiGetChapters asks the API implementation for an api chapter rule', async () => {
    const roads = [[{ name: '1', url: 'https://example.com/1' }]]
    chaptersApiMock.mockResolvedValue(roads)

    await expect(
      kazumiGetChapters('https://example.com/show', apiChapterPolicy)
    ).resolves.toEqual(roads)
    expect(chaptersApiMock).toHaveBeenCalledWith(
      'https://example.com/show',
      apiChapterPolicy
    )
    expect(createTab).not.toHaveBeenCalled()
  })

  it('does not call the API implementation for an xpath rule', async () => {
    vi.mocked(createTab).mockRejectedValue(new Error('tab opened'))

    await expect(kazumiSearch('keyword', xpathPolicy)).rejects.toThrow(
      'tab opened'
    )
    expect(searchApiMock).not.toHaveBeenCalled()
  })

  it('kazumiGetChapters still runs for an api search rule with xpath chapters', async () => {
    vi.mocked(createTab).mockRejectedValue(new Error('tab opened'))

    await expect(
      kazumiGetChapters('https://example.com/show', apiSearchPolicy)
    ).rejects.toThrow('tab opened')
    expect(createTab).toHaveBeenCalledWith('https://example.com/show')
    expect(chaptersApiMock).not.toHaveBeenCalled()
  })
})

describe('rules stored before modes existed', () => {
  const { searchMode: _, chapterMode: __, ...withoutModes } = xpathPolicy
  const storedPolicy = withoutModes as KazumiPolicy

  beforeEach(() => {
    vi.mocked(createTab).mockReset()
    vi.mocked(createTab).mockRejectedValue(new Error('tab opened'))
  })

  it('kazumiSearch still opens the search page', async () => {
    await expect(kazumiSearch('keyword', storedPolicy)).rejects.toThrow(
      'tab opened'
    )
    expect(createTab).toHaveBeenCalledTimes(1)
  })

  it('kazumiGetChapters still opens the content page', async () => {
    await expect(
      kazumiGetChapters('https://example.com/show', storedPolicy)
    ).rejects.toThrow('tab opened')
    expect(createTab).toHaveBeenCalledWith('https://example.com/show')
  })
})
