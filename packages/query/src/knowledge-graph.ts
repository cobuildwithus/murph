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
import {
  DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT,
  extractKnowledgeFirstHeading,
  humanizeKnowledgeTag,
  orderedUniqueStrings,
  summarizeKnowledgeBody,
} from './knowledge-model.ts'
import {
  stripGeneratedKnowledgeSections,
  stripKnowledgeLeadingHeading,
} from './knowledge-format.ts'
import { searchDerivedKnowledgeGraph } from './knowledge-search.ts'
export { searchDerivedKnowledgeGraph } from './knowledge-search.ts'

export const DERIVED_KNOWLEDGE_ROOT = 'derived/knowledge'
export const DERIVED_KNOWLEDGE_PAGES_ROOT = `${DERIVED_KNOWLEDGE_ROOT}/pages`
export const DERIVED_KNOWLEDGE_INDEX_PATH = `${DERIVED_KNOWLEDGE_ROOT}/index.md`

export interface DerivedKnowledgeNode {
  attributes: FrontmatterObject
  body: string
  compiledAt: string | null
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

export interface DerivedKnowledgeSearchFilters {
  limit?: number
  pageType?: string | null
  status?: string | null
}

export interface DerivedKnowledgeSearchHit {
  compiledAt: string | null
  matchedTerms: string[]
  pagePath: string
  pageType: string | null
  relatedSlugs: string[]
  score: number
  slug: string
  snippet: string
  sourcePaths: string[]
  status: string | null
  summary: string | null
  title: string
}

export interface DerivedKnowledgeSearchResult {
  format: typeof DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT
  hits: DerivedKnowledgeSearchHit[]
  query: string
  total: number
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

export async function searchDerivedKnowledgeVault(
  vaultRoot: string,
  query: string,
  filters: DerivedKnowledgeSearchFilters = {},
): Promise<DerivedKnowledgeSearchResult> {
  const graph = await readDerivedKnowledgeGraph(vaultRoot)
  return searchDerivedKnowledgeGraph(graph, query, filters)
}

export function renderDerivedKnowledgeIndex(
  graph: DerivedKnowledgeGraph,
  generatedAt: string,
): string {
  const pagesByType = new Map<string, DerivedKnowledgeNode[]>()

  for (const node of graph.nodes) {
    const pageType = node.pageType ?? 'uncategorized'
    const pages = pagesByType.get(pageType) ?? []
    pages.push(node)
    pagesByType.set(pageType, pages)
  }

  const orderedTypes = [...pagesByType.keys()].sort((left, right) => {
    if (left === 'uncategorized') {
      return 1
    }
    if (right === 'uncategorized') {
      return -1
    }
    return left.localeCompare(right)
  })

  const lines = [
    '# Derived knowledge index',
    '',
    '_This wiki is model-authored, non-canonical, and rebuildable from local sources._',
    '',
    `_Generated:_ ${generatedAt}`,
    `_Pages:_ ${graph.nodes.length}`,
    '',
  ]

  if (graph.nodes.length === 0) {
    lines.push('No derived knowledge pages have been saved yet.', '')
    return lines.join('\n')
  }

  for (const pageType of orderedTypes) {
    lines.push(`## ${humanizeKnowledgeTag(pageType)}`, '')
    const nodes = pagesByType.get(pageType) ?? []

    for (const node of nodes) {
      lines.push(
        `- [${node.title}](pages/${path.posix.basename(node.relativePath)})${node.summary ? ` — ${node.summary}` : ''}`,
      )
      const details: string[] = []

      if (node.status) {
        details.push(`status: ${node.status}`)
      }
      if (node.relatedSlugs.length > 0) {
        details.push(
          `related: ${node.relatedSlugs
            .map((slug) => renderDerivedKnowledgePageLink(graph, slug))
            .join(', ')}`,
        )
      }
      if (node.sourcePaths.length > 0) {
        details.push(`sources: ${node.sourcePaths.length}`)
      }
      if (details.length > 0) {
        lines.push(`  - ${details.join(' · ')}`)
      }
    }

    lines.push('')
  }

  return lines.join('\n')
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
    extractKnowledgeFirstHeading(body) ??
    humanizeKnowledgeTag(slug)
  const narrativeBody = stripKnowledgeLeadingHeading(
    stripGeneratedKnowledgeSections(body),
  )
  const sourcePaths = orderedUniqueStrings(
    firstStringArray(source, ['sourcePaths']),
  )
  const relatedSlugs = orderedUniqueStrings(
    firstStringArray(source, ['relatedSlugs']),
  )

  return {
    node: {
      attributes,
      body: narrativeBody,
      compiledAt: firstString(source, ['compiledAt']),
      pageType: firstString(source, ['pageType']),
      relativePath,
      relatedSlugs,
      slug,
      sourcePaths,
      status: firstString(source, ['status']),
      summary: firstString(source, ['summary']) ?? summarizeKnowledgeBody(narrativeBody),
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

function renderDerivedKnowledgePageLink(
  graph: DerivedKnowledgeGraph,
  slug: string,
): string {
  const target = graph.bySlug.get(slug)
  if (!target) {
    return `\`${slug}\``
  }

  return `[${target.title}](pages/${path.posix.basename(target.relativePath)})`
}

function isKnowledgeSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
}
