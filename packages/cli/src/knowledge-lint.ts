import path from 'node:path'
import { VaultCliError } from '@murphai/assistant-core/vault-cli-errors'
import {
  extractKnowledgeRelatedSlugs,
  extractKnowledgeSourcePaths,
  sameKnowledgeStringSet,
  type DerivedKnowledgeGraph,
  type DerivedKnowledgeGraphIssue,
  type DerivedKnowledgeNode,
} from '@murphai/query'
import { type KnowledgeLintProblem } from './knowledge-cli-contracts.js'

const FORBIDDEN_KNOWLEDGE_SOURCE_ROOTS = ['derived', '.runtime', 'assistant-state'] as const
const KNOWLEDGE_PROBLEM_SEVERITY_ORDER: Record<KnowledgeLintProblem['severity'], number> = {
  error: 0,
  warning: 1,
}

export async function collectKnowledgeLintProblems(input: {
  graph: DerivedKnowledgeGraph
  issues: readonly DerivedKnowledgeGraphIssue[]
  pathExists: (candidatePath: string) => Promise<boolean>
}): Promise<KnowledgeLintProblem[]> {
  const problems: KnowledgeLintProblem[] = input.issues.map((issue) => ({
    code: `parse_${issue.parser}`,
    message:
      issue.lineNumber !== undefined
        ? `${issue.reason} (line ${issue.lineNumber}).`
        : issue.reason,
    pagePath: issue.relativePath,
    slug: null,
    severity: 'error',
  }))
  const slugCounts = new Map<string, string[]>()

  for (const page of input.graph.nodes) {
    const duplicatePaths = slugCounts.get(page.slug) ?? []
    duplicatePaths.push(page.relativePath)
    slugCounts.set(page.slug, duplicatePaths)

    problems.push(...(await collectKnowledgePageProblems(page, input.graph, input.pathExists)))
  }

  for (const [slug, pagePaths] of slugCounts) {
    if (pagePaths.length <= 1) {
      continue
    }

    for (const pagePath of pagePaths) {
      problems.push({
        code: 'duplicate_slug',
        message: `Derived knowledge slug "${slug}" appears in multiple files.`,
        pagePath,
        slug,
        severity: 'error',
      })
    }
  }

  return sortKnowledgeProblems(problems)
}

export function requireUniqueKnowledgePageBySlug(
  graph: DerivedKnowledgeGraph,
  slug: string,
  action: 'compile' | 'reload' | 'show',
): DerivedKnowledgeNode | null {
  const matchingPages = graph.nodes.filter((node: DerivedKnowledgeNode) => node.slug === slug)
  if (matchingPages.length <= 1) {
    return matchingPages[0] ?? null
  }

  throw new VaultCliError(
    'knowledge_duplicate_slug',
    `Knowledge slug "${slug}" appears in multiple files and cannot be ${describeKnowledgeDuplicateSlugAction(action)} safely until the duplicate is resolved.`,
    {
      pagePaths: matchingPages.map((node: DerivedKnowledgeNode) => node.relativePath),
      slug,
    },
  )
}

export function assertKnowledgeSourcePathAllowed(sourcePath: string): void {
  const normalizedPath = normalizeKnowledgeSourcePolicyPath(sourcePath)
  if (!normalizedPath) {
    throw new VaultCliError(
      'knowledge_invalid_source_path',
      `Knowledge source path "${sourcePath}" must be a vault-relative file path.`,
      { sourcePath },
    )
  }

  if (isKnowledgeSourcePathAllowed(normalizedPath)) {
    return
  }

  throw new VaultCliError(
    'knowledge_forbidden_source_path',
    `Knowledge source path "${sourcePath}" points into derived or runtime state and must not be used for knowledge compilation.`,
    { sourcePath: normalizedPath },
  )
}

export function sortKnowledgeProblems(
  problems: readonly KnowledgeLintProblem[],
): KnowledgeLintProblem[] {
  return [...problems].sort((left, right) => {
    const severityComparison =
      KNOWLEDGE_PROBLEM_SEVERITY_ORDER[left.severity] -
      KNOWLEDGE_PROBLEM_SEVERITY_ORDER[right.severity]
    if (severityComparison !== 0) {
      return severityComparison
    }

    const pathComparison = left.pagePath.localeCompare(right.pagePath)
    if (pathComparison !== 0) {
      return pathComparison
    }

    return left.code.localeCompare(right.code)
  })
}

async function collectKnowledgePageProblems(
  page: DerivedKnowledgeNode,
  graph: DerivedKnowledgeGraph,
  pathExists: (candidatePath: string) => Promise<boolean>,
): Promise<KnowledgeLintProblem[]> {
  const problems: KnowledgeLintProblem[] = []
  const pagePath = page.relativePath
  const fileSlug = path.posix.basename(page.relativePath, '.md')

  if (page.body.trim().length === 0) {
    problems.push({
      code: 'empty_body',
      message: 'Knowledge page body is empty.',
      pagePath,
      slug: page.slug,
      severity: 'error',
    })
  }

  if (!page.pageType) {
    problems.push({
      code: 'missing_page_type',
      message: 'Knowledge page frontmatter should include `pageType`.',
      pagePath,
      slug: page.slug,
      severity: 'warning',
    })
  }

  if (!page.status) {
    problems.push({
      code: 'missing_status',
      message: 'Knowledge page frontmatter should include `status`.',
      pagePath,
      slug: page.slug,
      severity: 'warning',
    })
  }

  if (!page.summary) {
    problems.push({
      code: 'missing_summary',
      message: 'Knowledge page frontmatter should include `summary` or enough body text to derive one.',
      pagePath,
      slug: page.slug,
      severity: 'warning',
    })
  }

  if (page.slug !== fileSlug) {
    problems.push({
      code: 'slug_path_mismatch',
      message: `Knowledge page slug "${page.slug}" should match file name "${fileSlug}".`,
      pagePath,
      slug: page.slug,
      severity: 'warning',
    })
  }

  if (page.sourcePaths.length === 0) {
    problems.push({
      code: 'missing_sources',
      message: 'Knowledge page does not list any source paths.',
      pagePath,
      slug: page.slug,
      severity: 'warning',
    })
  }

  const frontmatterSourcePaths = readKnowledgeStringArrayAttribute(
    page.attributes,
    'sourcePaths',
  )
  const frontmatterRelatedSlugs = readKnowledgeStringArrayAttribute(
    page.attributes,
    'relatedSlugs',
  )
  const normalizedFrontmatterSourcePaths = collectNormalizedSourcePaths(
    frontmatterSourcePaths,
    pagePath,
    page.slug,
    problems,
  )
  const normalizedBodySourcePaths = collectNormalizedSourcePaths(
    extractKnowledgeSourcePaths(page.body),
    pagePath,
    page.slug,
    problems,
  )

  if (
    (normalizedFrontmatterSourcePaths.length > 0 || normalizedBodySourcePaths.length > 0) &&
    !sameKnowledgeStringSet(
      normalizedFrontmatterSourcePaths,
      normalizedBodySourcePaths,
    )
  ) {
    problems.push({
      code: 'source_paths_drift',
      message: 'Knowledge page frontmatter `sourcePaths` does not match the canonical `## Sources` section.',
      pagePath,
      slug: page.slug,
      severity: 'warning',
    })
  }

  const bodyRelatedSlugs = extractKnowledgeRelatedSlugs(page.body, page.slug)
  if (
    (frontmatterRelatedSlugs.length > 0 || bodyRelatedSlugs.length > 0) &&
    !sameKnowledgeStringSet(frontmatterRelatedSlugs, bodyRelatedSlugs)
  ) {
    problems.push({
      code: 'related_slugs_drift',
      message: 'Knowledge page frontmatter `relatedSlugs` does not match the canonical body wikilinks.',
      pagePath,
      slug: page.slug,
      severity: 'warning',
    })
  }

  for (const relatedSlug of page.relatedSlugs) {
    if (!graph.bySlug.has(relatedSlug)) {
      problems.push({
        code: 'missing_related_page',
        message: `Related slug "${relatedSlug}" does not exist in derived knowledge pages.`,
        pagePath,
        slug: page.slug,
        severity: 'warning',
      })
    }
  }

  for (const sourcePath of normalizedBodySourcePaths) {
    const sourceExists = await pathExists(sourcePath)
    if (!sourceExists) {
      problems.push({
        code: 'missing_source_path',
        message: `Source path "${sourcePath}" does not exist inside the vault.`,
        pagePath,
        slug: page.slug,
        severity: 'error',
      })
    }
  }

  return problems
}

function readKnowledgeStringArrayAttribute(
  attributes: Record<string, unknown>,
  key: string,
): string[] {
  const value = attributes[key]
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }

  if (!Array.isArray(value)) {
    return []
  }

  return value
    .flatMap((entry) => (typeof entry === 'string' ? [entry.trim()] : []))
    .filter((entry) => entry.length > 0)
}

function collectNormalizedSourcePaths(
  sourcePaths: readonly string[],
  pagePath: string,
  slug: string,
  problems: KnowledgeLintProblem[],
): string[] {
  const normalizedSourcePaths: string[] = []

  for (const rawSourcePath of sourcePaths) {
    const normalizedSourcePath = normalizeKnowledgeSourcePolicyPath(rawSourcePath)
    if (!normalizedSourcePath) {
      problems.push({
        code: 'invalid_source_path',
        message: `Source path "${rawSourcePath}" is not a valid vault-relative file path.`,
        pagePath,
        slug,
        severity: 'error',
      })
      continue
    }

    if (!isKnowledgeSourcePathAllowed(normalizedSourcePath)) {
      problems.push({
        code: 'forbidden_source_path',
        message: `Source path "${rawSourcePath}" points into derived or runtime state and must not be used for knowledge compilation.`,
        pagePath,
        slug,
        severity: 'error',
      })
      continue
    }

    normalizedSourcePaths.push(normalizedSourcePath)
  }

  return normalizedSourcePaths
}

function normalizeKnowledgeSourcePolicyPath(
  value: string | null | undefined,
): string | null {
  const trimmed = String(value ?? '').trim().replace(/\\/gu, '/')
  if (!trimmed || trimmed.startsWith('/')) {
    return null
  }

  if (/^[A-Za-z]:\//u.test(trimmed)) {
    return null
  }

  const normalized = path.posix.normalize(trimmed).replace(/^\.\/+/u, '')
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return null
  }

  return normalized
}

function isKnowledgeSourcePathAllowed(relativePath: string): boolean {
  const firstSegment = relativePath.split('/')[0] ?? ''
  return !FORBIDDEN_KNOWLEDGE_SOURCE_ROOTS.includes(
    firstSegment as (typeof FORBIDDEN_KNOWLEDGE_SOURCE_ROOTS)[number],
  )
}

function describeKnowledgeDuplicateSlugAction(
  action: 'compile' | 'reload' | 'show',
): string {
  switch (action) {
    case 'compile':
      return 'compiled'
    case 'reload':
      return 'reloaded'
    case 'show':
      return 'shown'
  }
}
