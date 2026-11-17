import { describe, expect, it } from 'vitest'
import { readJsonPath, readJsonPathFirst } from './jsonPath.js'

const document = {
  data: {
    records: [
      { title: 'one', id: 1 },
      { title: 'two', id: 2 },
    ],
  },
  list: ['a', 'b'],
  'odd-key': { name: 'quoted' },
}

describe('readJsonPath', () => {
  it('reads dotted and indexed keys', () => {
    expect(readJsonPath(document, '$.data.records[0].title')).toEqual(['one'])
    expect(readJsonPath([{ id: 7 }], '$[0].id')).toEqual([7])
  })

  it('reads wildcards in arrays and objects', () => {
    expect(readJsonPath(document, '$.data.records[*].id')).toEqual([1, 2])
    expect(readJsonPath(document, '$.list[*]')).toEqual(['a', 'b'])
    expect(readJsonPath({ a: 1, b: 2 }, '$[*]')).toEqual([1, 2])
  })

  it('reads quoted keys and a bare root', () => {
    expect(readJsonPath(document, "$['odd-key'].name")).toEqual(['quoted'])
    expect(readJsonPath(document, '$')).toEqual([document])
  })

  it('returns an empty result for a missing key', () => {
    expect(readJsonPath(document, '$.missing.path')).toEqual([])
    expect(readJsonPathFirst(document, '$.missing.path')).toBeUndefined()
  })

  it('rejects unsupported expressions', () => {
    expect(() => readJsonPath(document, 'data.records')).toThrow()
    expect(() => readJsonPath(document, '$.records[?(@.id)]')).toThrow()
    expect(() => readJsonPath(document, '$.list[')).toThrow()
    expect(() => readJsonPath(document, '$..id')).toThrow()
  })
})
