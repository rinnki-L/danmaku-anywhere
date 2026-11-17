type PathSegment = { kind: 'key'; key: string } | { kind: 'wildcard' }

const KEY_CHAR = /[A-Za-z0-9_$-]/
const NUMERIC_KEY = /^\d+$/

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function findBracketEnd(expression: string, start: number): number {
  let quote: string | null = null
  let escaped = false
  for (let index = start + 1; index < expression.length; index++) {
    const char = expression[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote !== null) {
      if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === ']') {
      return index
    }
  }
  throw new Error(`Invalid JSONPath: ${expression}`)
}

function bracketKey(content: string): string | null {
  if (content === '*') {
    return null
  }
  if (NUMERIC_KEY.test(content)) {
    return content
  }
  if (
    content.length >= 2 &&
    ((content.startsWith("'") && content.endsWith("'")) ||
      (content.startsWith('"') && content.endsWith('"')))
  ) {
    return content.slice(1, -1)
  }
  throw new Error(`Unsupported JSONPath segment: [${content}]`)
}

function parseExpression(expression: string): PathSegment[] {
  if (expression.length === 0 || !expression.startsWith('$')) {
    throw new Error(`Invalid JSONPath: ${expression}`)
  }

  const segments: PathSegment[] = []
  let index = 1
  while (index < expression.length) {
    const char = expression[index]
    if (char === '.') {
      index += 1
      const start = index
      while (index < expression.length && KEY_CHAR.test(expression[index])) {
        index += 1
      }
      if (index === start) {
        throw new Error(`Invalid JSONPath: ${expression}`)
      }
      segments.push({ kind: 'key', key: expression.slice(start, index) })
      continue
    }
    if (char === '[') {
      const end = findBracketEnd(expression, index)
      const key = bracketKey(expression.slice(index + 1, end).trim())
      if (key === null) {
        segments.push({ kind: 'wildcard' })
      } else {
        segments.push({ kind: 'key', key })
      }
      index = end + 1
      continue
    }
    throw new Error(`Invalid JSONPath: ${expression}`)
  }
  return segments
}

export function readJsonPath(document: unknown, expression: string): unknown[] {
  const segments = parseExpression(expression)
  let values: unknown[] = [document]

  for (const segment of segments) {
    const next: unknown[] = []
    for (const value of values) {
      if (segment.kind === 'wildcard') {
        if (Array.isArray(value)) {
          next.push(...value)
        } else if (isRecord(value)) {
          next.push(...Object.values(value))
        }
        continue
      }
      if (isRecord(value)) {
        if (Object.hasOwn(value, segment.key)) {
          next.push(value[segment.key])
        }
      } else if (Array.isArray(value) && NUMERIC_KEY.test(segment.key)) {
        const item = value[Number(segment.key)]
        if (item !== undefined) {
          next.push(item)
        }
      }
    }
    values = next
  }
  return values
}

export function readJsonPathFirst(
  document: unknown,
  expression: string
): unknown {
  return readJsonPath(document, expression)[0]
}
