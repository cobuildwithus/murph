import path from 'node:path'
import {
  readMarkdownDocumentOutcome,
  walkRelativeFiles,
  type ParseFailure,
} from './health/loaders.ts'
import {
  asObject,
  compareNullableStrings,
  firstString,
  firstStringArray,
  type FrontmatterObject,
} from './health/shared.ts'

export const DERIVED_KNOWLEDGE_ROOT = 'derived/knowledge'
export const DERIVED_KNOWLEDGE_PAGES_ROOT = `${DERIVED_KNOWLEDGE_ROOT}/pages`
export const DERIVED_KNOWLEDGE_INDEX_PATH = `${DERIVED_KNOWLEDGE_ROOT}/index.md`

export interface DerivedKnowledgeNode {
  attributes: FrontmatterObject
  body: string
  compiledAt: string | null
  compiler: string | null
  mode: string | null
  pageType: string | null
  relativePath: string
  relatedSlugs: string[]
  slug: string
  sourcePaths: string[]
  status: string | null
  summary: string | null
  title: string
}

export interface DerivedKnowledgeGraph {
  bySlug: ReadonlyMap<string, DerivedKnowledgeNode>
  indexPath: string
  nodes: DerivedKnowledgeNode[]
  pagesRoot: string
}

export interface DerivedKnowledgeGraphIssue {
  lineNumber?: number
  parser: 'frontmatter' | 'json'
  reason: string
  relativePath: string
}

export interface DerivedKnowledgeGraphReadResult {
  graph: DerivedKnowledgeGraph
  issues: DerivedKnowledgeGraphIssue[]
}

interface DerivedKnowledgeNodeParseResult {
  issue?: DerivedKnowledgeGraphIssue
  node?: DerivedKnowledgeNode
}

export async function readDerivedKnowledgeGraph(
  vaultRoot: string,
): Promise<DerivedKnowledgeGraph> {
  return (await readDerivedKnowledgeGraphWithIssues(vaultRoot)).graph
}

export async function readDerivedKnowledgeGraphWithIssues(
  vaultRoot: string,
): Promise<DerivedKnowledgeGraphReadResult> {
  const relativePaths = await walkRelativeFiles(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT, '.md')
  const nodes: DerivedKnowledgeNode[] = []
  const issues: DerivedKnowledgeGraphIssue[] = []

  for (const relativePath of relativePaths) {
    const outcome = await readMarkdownDocumentOutcome(vaultRoot, relativePath)
    if (!outcome.ok) {
      issues.push(parseFailureToIssue(outcome))
      continue
    }

    const parsed = toDerivedKnowledgeNode(
      outcome.document.relativePath,
      outcome.document.body,
      outcome.document.attributes,
    )
    if (parsed.issue) {
      issues.push(parsed.issue)
    }
    if (parsed.node) {
      nodes.push(parsed.node)
    }
  }

  nodes.sort((left, right) => {
    const pageTypeComparison = compareNullableStrings(left.pageType, right.pageType)
    if (pageTypeComparison !== 0) {
      return pageTypeComparison
    }

    const titleComparison = left.title.localeCompare(right.title)
    if (titleComparison !== 0) {
      return titleComparison
    }

    return left.slug.localeCompare(right.slug)
  })

  return {
    graph: {
      bySlug: new Map(nodes.map((node) => [node.slug, node])),
      indexPath: DERIVED_KNOWLEDGE_INDEX_PATH,
      nodes,
      pagesRoot: DERIVED_KNOWLEDGE_PAGES_ROOT,
    },
    issues,
  }
}

function toDerivedKnowledgeNode(
  relativePath: string,
  body: string,
  attributes: FrontmatterObject,
): DerivedKnowledgeNodeParseResult {
  const source = asObject(attributes)
  if (!source) {
    return {}
  }

  const fileSlug = path.posix.basename(relativePath, '.md')
  const slug = firstString(source, ['slug']) ?? fileSlug
  if (!slug) {
    return {}
  }

  if (!isKnowledgeSlug(slug)) {
    return {
      issue: {
        parser: 'frontmatter',
        reason: `Invalid knowledge slug "${slug}".`,
        relativePath,
      },
    }
  }

  const title =
    firstString(source, ['title']) ??
    extractFirstHeading(body) ??
    humanizeSlug(slug)
  const frontmatterSourcePaths = orderedUniqueStrings(
    firstStringArray(source, ['sourcePaths', 'source_paths', 'sources']),
  )
  const bodySourcePaths = extractSourcePaths(body)
  const sourcePaths =
    bodySourcePaths.length > 0
      ? bodySourcePaths
      : frontmatterSourcePaths
  const frontmatterRelatedSlugs = orderedUniqueStrings(
    firstStringArray(source, ['relatedSlugs', 'related_slugs', 'related']),
  )
  const bodyRelatedSlugs = extractRelatedSlugs(body, slug)
  const relatedSlugs =
    bodyRelatedSlugs.length > 0
      ? bodyRelatedSlugs
      : frontmatterRelatedSlugs

  return {
    node: {
      attributes,
      body,
      compiledAt: firstString(source, ['compiledAt', 'compiled_at']),
      compiler: firstString(source, ['compiler']),
      mode: firstString(source, ['mode']),
      pageType: firstString(source, ['pageType', 'page_type', 'entityType', 'entity_type']),
      relativePath,
      relatedSlugs,
      slug,
      sourcePaths,
      status: firstString(source, ['status']),
      summary: firstString(source, ['summary']) ?? summarizeBody(body),
      title,
    },
  }
}

function parseFailureToIssue(failure: ParseFailure): DerivedKnowledgeGraphIssue {
  return {
    lineNumber: failure.lineNumber,
    parser: failure.parser,
    reason: failure.reason,
    relativePath: failure.relativePath,
  }
}

function summarizeBody(body: string): string | null {
  const normalized = body
    .split('\n')
    .map((line) => line.replace(/^#+\s+/u, '').trim())
    .filter(Boolean)
    .join(' ')

  if (!normalized) {
    return null
  }

  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`
}

function extractRelatedSlugs(body: string, currentSlug: string): string[] {
  const matches = body.matchAll(/\[\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\]/gu)
  const relatedSlugs: string[] = []

  for (const match of matches) {
    const relatedSlug = match[1]?.trim()
    if (!relatedSlug || relatedSlug === currentSlug) {
      continue
    }

    relatedSlugs.push(relatedSlug)
  }

  return orderedUniqueStrings(relatedSlugs)
}

function extractSourcePaths(body: string): string[] {
  const sectionMatch = /(?:^|\n)##\s+Sources\s*\n([\s\S]*?)(?=\n##\s+|$)/iu.exec(body)
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

function extractFirstHeading(body: string): string | null {
  for (const line of body.split('\n')) {
    const match = /^#\s+(.+?)\s*$/u.exec(line.trim())
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  return null
}

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isKnowledgeSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
}

function orderedUniqueStrings(values: readonly string[]): string[] {
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
