const KNOWLEDGE_SUMMARY_MAX_CHARS = 220

export const DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT = 'murph.knowledge-search.v1' as const

export function orderedUniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const uniqueValues: string[] = []

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      uniqueValues.push(value)
    }
  }

  return uniqueValues
}

export function normalizeKnowledgeSlug(value: string): string {
  const slug =
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'knowledge-page'

  return slug
}

export function normalizeKnowledgeTag(
  value: string | null | undefined,
): string | null {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    return null
  }

  const token = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  return token || null
}

export function extractKnowledgeRelatedSlugs(
  body: string,
  currentSlug: string,
): string[] {
  const matches = String(body ?? '').matchAll(/\[\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\]/gu)
  const relatedSlugs: string[] = []

  for (const match of matches) {
    const slug = match[1]?.trim()
    if (!slug || slug === currentSlug) {
      continue
    }

    relatedSlugs.push(slug)
  }

  return orderedUniqueStrings(relatedSlugs)
}

export function extractKnowledgeSourcePaths(body: string): string[] {
  const sectionMatch = /(?:^|\n)##\s+Sources\s*\n([\s\S]*?)(?=\n##\s+|$)/iu.exec(
    String(body ?? ''),
  )
  if (!sectionMatch?.[1]) {
    return []
  }

  const sourcePaths: string[] = []
  for (const line of sectionMatch[1].split('\n')) {
    const match = /^[-*]\s+`([^`]+)`\s*$/u.exec(line.trim())
    if (!match?.[1]) {
      continue
    }

    sourcePaths.push(match[1].trim())
  }

  return orderedUniqueStrings(sourcePaths)
}

export function extractKnowledgeFirstHeading(body: string): string | null {
  for (const line of body.split('\n')) {
    const match = /^#\s+(.+?)\s*$/u.exec(line.trim())
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  return null
}

export function summarizeKnowledgeBody(body: string): string | null {
  const normalized = String(body ?? '')
    .split('\n')
    .map((line) => line.replace(/^#+\s+/u, '').trim())
    .filter(Boolean)
    .join(' ')

  if (!normalized) {
    return null
  }

  return truncateSummaryText(normalized, KNOWLEDGE_SUMMARY_MAX_CHARS)
}

export function sameKnowledgeStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false
  }

  const rightValues = new Set(right)
  return left.every((value) => rightValues.has(value))
}

export function humanizeKnowledgeTag(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function truncateSummaryText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value
  }

  if (limit <= 3) {
    return '.'.repeat(limit)
  }

  return `${value.slice(0, limit - 3).trimEnd()}...`
}
