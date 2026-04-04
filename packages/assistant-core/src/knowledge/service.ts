import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveAssistantVaultPath } from '../assistant-vault-paths.js'
import { VaultCliError } from '../vault-cli-errors.js'
import { loadIntegratedRuntime } from '../usecases/runtime.js'
import {
  DERIVED_KNOWLEDGE_INDEX_PATH,
  normalizeKnowledgeSlug,
  normalizeKnowledgeTag,
  orderedUniqueStrings,
  readDerivedKnowledgeGraph,
  readDerivedKnowledgeGraphWithIssues,
  renderDerivedKnowledgeIndex,
  searchDerivedKnowledgeVault,
  summarizeKnowledgeBody,
  type DerivedKnowledgeGraph,
  type DerivedKnowledgeGraphIssue,
  type DerivedKnowledgeNode,
} from '@murphai/query'
import {
  buildKnowledgeMarkdown,
  buildKnowledgePageRelativePath,
  deriveKnowledgeTitle,
  extractKnowledgeRelatedSlugsFromBody,
  matchesKnowledgeFilter,
  normalizeKnowledgeBody,
  normalizeRelatedSlugInputs,
  normalizeSourcePathInputs,
  toKnowledgeMetadata,
  toKnowledgePage,
} from './documents.js'
import {
  type KnowledgeGetResult,
  type KnowledgeIndexRebuildResult,
  type KnowledgeLintProblem,
  type KnowledgeLintResult,
  type KnowledgeListResult,
  type KnowledgeSearchResult,
  type KnowledgeUpsertResult,
} from './contracts.js'

const DEFAULT_KNOWLEDGE_PAGE_TYPE = 'concept'
const DEFAULT_KNOWLEDGE_STATUS = 'active'
const FORBIDDEN_KNOWLEDGE_SOURCE_ROOTS = ['derived', '.runtime', 'assistant-state'] as const
const KNOWLEDGE_PROBLEM_SEVERITY_ORDER: Record<KnowledgeLintProblem['severity'], number> = {
  error: 0,
  warning: 1,
}

export interface KnowledgeUpsertInput {
  body: string
  vault: string
  title?: string | null
  slug?: string | null
  pageType?: string | null
  relatedSlugs?: string[] | null
  status?: string | null
  sourcePaths?: string[] | null
}

export interface KnowledgeServiceDependencies {
  now?: () => Date
  readTextFile?: (filePath: string) => Promise<string>
  saveText?: (input: {
    vault: string
    relativePath: string
    content: string
    operationType: string
    overwrite: boolean
    summary: string
  }) => Promise<void>
}

export interface KnowledgeListInput {
  vault: string
  pageType?: string | null
  status?: string | null
}

export interface KnowledgeSearchInput {
  vault: string
  query: string
  limit?: number | null
  pageType?: string | null
  status?: string | null
}

export interface KnowledgeGetInput {
  vault: string
  slug: string
}

export interface KnowledgeMaintenanceInput {
  vault: string
}

interface NormalizedKnowledgeFilters {
  pageType: string | null
  status: string | null
}

export async function upsertKnowledgePage(
  input: KnowledgeUpsertInput,
  dependencies: KnowledgeServiceDependencies = {},
): Promise<KnowledgeUpsertResult> {
  const now = dependencies.now ?? (() => new Date())
  const savedAt = now().toISOString()
  const saveText = dependencies.saveText ?? saveKnowledgeText
  const { graph } = await readDerivedKnowledgeGraphWithIssues(input.vault)

  const initialTitle = deriveKnowledgeTitle({
    body: input.body,
    slug: input.slug,
    title: input.title,
  })
  const slug = normalizeKnowledgeSlug(input.slug ?? initialTitle)
  const existingPage = requireUniqueKnowledgePageBySlug(graph, slug, 'upsert')
  const title = deriveKnowledgeTitle({
    body: input.body,
    existingPage,
    slug,
    title: input.title,
  })
  const pageType = resolveKnowledgeMetadataTag(
    input.pageType,
    existingPage?.pageType,
    DEFAULT_KNOWLEDGE_PAGE_TYPE,
  )
  const status = resolveKnowledgeMetadataTag(
    input.status,
    existingPage?.status,
    DEFAULT_KNOWLEDGE_STATUS,
  )
  const existingSourcePaths = existingPage?.sourcePaths ?? []
  const explicitSourcePaths = normalizeSourcePathInputs(input.sourcePaths)
  const sourcePaths = await normalizeKnowledgeSourcePaths(
    input.vault,
    explicitSourcePaths.length > 0
      ? orderedUniqueStrings([...existingSourcePaths, ...explicitSourcePaths])
      : existingSourcePaths,
  )
  const normalizedBody = normalizeKnowledgeBody(input.body)
  const bodyRelatedSlugs = extractKnowledgeRelatedSlugsFromBody({
    body: input.body,
    slug,
  })
  const explicitRelatedSlugs = normalizeRelatedSlugInputs(input.relatedSlugs, slug)
  const relatedSlugs = orderedUniqueStrings([
    ...explicitRelatedSlugs,
    ...bodyRelatedSlugs,
  ])
  const markdown = buildKnowledgeMarkdown({
    body: normalizedBody,
    compiledAt: savedAt,
    pageType,
    relatedSlugs,
    slug,
    sourcePaths,
    status,
    summary: summarizeKnowledgeBody(normalizedBody),
    title,
  })
  const pageRelativePath = buildKnowledgePageRelativePath(slug)

  await saveText({
    vault: input.vault,
    relativePath: pageRelativePath,
    content: markdown,
    operationType: 'knowledge_page.write',
    overwrite: true,
    summary: `Upserted derived knowledge page "${title}".`,
  })

  const indexResult = await rebuildKnowledgeIndex(
    { vault: input.vault },
    {
      now: () => new Date(savedAt),
      saveText,
    },
  )
  const refreshedGraph = await readDerivedKnowledgeGraph(input.vault)
  const page = requireUniqueKnowledgePageBySlug(refreshedGraph, slug, 'reload')

  if (!page) {
    throw new VaultCliError(
      'knowledge_upsert_failed',
      `Knowledge page "${slug}" was written but could not be reloaded from the derived knowledge graph.`,
    )
  }

  return {
    vault: input.vault,
    indexPath: indexResult.indexPath,
    page: toKnowledgeMetadata(page),
    bodyLength: normalizedBody.length,
    savedAt,
  }
}

export async function searchKnowledgePages(
  input: KnowledgeSearchInput,
): Promise<KnowledgeSearchResult> {
  const query = input.query.trim()
  if (query.length === 0) {
    throw new VaultCliError(
      'knowledge_search_query_required',
      'Knowledge search query must not be blank.',
    )
  }

  const filters = normalizeKnowledgeFilters(input)
  const result = await searchDerivedKnowledgeVault(input.vault, query, {
    limit: input.limit ?? undefined,
    pageType: filters.pageType,
    status: filters.status,
  })

  return {
    ...result,
    pageType: filters.pageType,
    status: filters.status,
    vault: input.vault,
  }
}

export async function listKnowledgePages(
  input: KnowledgeListInput,
): Promise<KnowledgeListResult> {
  const graph = await readDerivedKnowledgeGraph(input.vault)
  const filters = normalizeKnowledgeFilters(input)
  const pages = graph.nodes
    .filter((node: DerivedKnowledgeNode) => matchesKnowledgeFilter(node.pageType, filters.pageType))
    .filter((node: DerivedKnowledgeNode) => matchesKnowledgeFilter(node.status, filters.status))
    .map(toKnowledgeMetadata)

  return {
    pageCount: pages.length,
    pageType: filters.pageType,
    pages,
    status: filters.status,
    vault: input.vault,
  }
}

export async function getKnowledgePage(
  input: KnowledgeGetInput,
  dependencies: Pick<KnowledgeServiceDependencies, 'readTextFile'> = {},
): Promise<KnowledgeGetResult> {
  const graph = await readDerivedKnowledgeGraph(input.vault)
  const page = requireUniqueKnowledgePageBySlug(
    graph,
    normalizeKnowledgeSlug(input.slug),
    'get',
  )

  if (!page) {
    throw new VaultCliError(
      'knowledge_page_not_found',
      `No derived knowledge page exists for slug "${input.slug}".`,
    )
  }

  const absolutePath = await resolveAssistantVaultPath(input.vault, page.relativePath, 'file path')
  const markdown = await (dependencies.readTextFile ?? defaultReadTextFile)(absolutePath)

  return {
    page: toKnowledgePage(page, markdown),
    vault: input.vault,
  }
}

export async function rebuildKnowledgeIndex(
  input: KnowledgeMaintenanceInput,
  dependencies: Pick<KnowledgeServiceDependencies, 'now' | 'saveText'> = {},
): Promise<KnowledgeIndexRebuildResult> {
  const graph = await readDerivedKnowledgeGraph(input.vault)
  const generatedAt = (dependencies.now ?? (() => new Date()))().toISOString()
  const markdown = renderDerivedKnowledgeIndex(graph, generatedAt)

  await (dependencies.saveText ?? saveKnowledgeText)({
    vault: input.vault,
    relativePath: DERIVED_KNOWLEDGE_INDEX_PATH,
    content: markdown,
    operationType: 'knowledge_index.rebuild',
    overwrite: true,
    summary: 'Rebuilt the derived knowledge index.',
  })

  return {
    indexPath: DERIVED_KNOWLEDGE_INDEX_PATH,
    pageCount: graph.nodes.length,
    pageTypes: orderedUniqueStrings(
      graph.nodes
        .map((node: DerivedKnowledgeNode) => node.pageType)
        .filter((value): value is string => Boolean(value)),
    ),
    rebuilt: true,
    vault: input.vault,
  }
}

export async function lintKnowledgePages(
  input: KnowledgeMaintenanceInput,
): Promise<KnowledgeLintResult> {
  const { graph, issues } = await readDerivedKnowledgeGraphWithIssues(input.vault)
  const problems = await collectKnowledgeLintProblems({
    graph,
    issues,
    pathExists: async (candidatePath) =>
      await knowledgePathExists(input.vault, candidatePath),
  })

  return {
    ok: !problems.some((problem) => problem.severity === 'error'),
    pageCount: graph.nodes.length,
    problemCount: problems.length,
    problems,
    vault: input.vault,
  }
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
    `Knowledge source path "${sourcePath}" points into derived or runtime state and must not be used for knowledge upserts.`,
    { sourcePath: normalizedPath },
  )
}

export function requireUniqueKnowledgePageBySlug(
  graph: DerivedKnowledgeGraph,
  slug: string,
  action: 'get' | 'reload' | 'upsert',
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

async function collectKnowledgeLintProblems(input: {
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
      message: 'Knowledge page frontmatter does not list any source paths.',
      pagePath,
      slug: page.slug,
      severity: 'warning',
    })
  }

  const normalizedSourcePaths = collectNormalizedSourcePaths(
    page.sourcePaths,
    pagePath,
    page.slug,
    problems,
  )

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

  for (const sourcePath of normalizedSourcePaths) {
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

function normalizeKnowledgeFilters(input: {
  pageType?: string | null
  status?: string | null
}): NormalizedKnowledgeFilters {
  return {
    pageType: normalizeKnowledgeTag(input.pageType),
    status: normalizeKnowledgeTag(input.status),
  }
}

function resolveKnowledgeMetadataTag(
  explicitValue: string | null | undefined,
  existingValue: string | null | undefined,
  defaultValue: string,
): string {
  return (
    normalizeKnowledgeTag(explicitValue) ??
    normalizeKnowledgeTag(existingValue) ??
    normalizeKnowledgeTag(defaultValue) ??
    defaultValue
  )
}

async function knowledgePathExists(vaultRoot: string, candidatePath: string): Promise<boolean> {
  try {
    const absolutePath = await resolveAssistantVaultPath(vaultRoot, candidatePath, 'file path')
    await access(absolutePath)
    return true
  } catch {
    return false
  }
}

async function normalizeKnowledgeSourcePaths(
  vaultRoot: string,
  sourcePaths: readonly string[],
): Promise<string[]> {
  const normalizedSourcePaths: string[] = []

  for (const sourcePath of sourcePaths) {
    const absolutePath = await resolveAssistantVaultPath(vaultRoot, sourcePath, 'file path')
    const relativePath = toVaultRelativePath(vaultRoot, absolutePath)
    assertKnowledgeSourcePathAllowed(relativePath)

    try {
      const stats = await stat(absolutePath)
      if (!stats.isFile()) {
        throw new Error('Path is not a file.')
      }
    } catch (error) {
      throw new VaultCliError(
        'knowledge_source_unreadable',
        `Could not read knowledge source path "${sourcePath}".`,
        {
          cause:
            error instanceof Error && error.message.length > 0
              ? error.message
              : String(error),
          sourcePath,
        },
      )
    }

    normalizedSourcePaths.push(relativePath)
  }

  return orderedUniqueStrings(normalizedSourcePaths)
}

async function saveKnowledgeText(input: {
  vault: string
  relativePath: string
  content: string
  operationType: string
  overwrite: boolean
  summary: string
}): Promise<void> {
  const runtime = await loadIntegratedRuntime()
  await runtime.core.applyCanonicalWriteBatch({
    vaultRoot: input.vault,
    operationType: input.operationType,
    summary: input.summary,
    textWrites: [
      {
        relativePath: input.relativePath,
        content: input.content,
        overwrite: input.overwrite,
      },
    ],
  })
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf8')
}

function toVaultRelativePath(vaultRoot: string, absolutePath: string): string {
  const relativePath = path.relative(path.resolve(vaultRoot), absolutePath)
  return relativePath.split(path.sep).join(path.posix.sep)
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
        message: `Source path "${rawSourcePath}" points into derived or runtime state and must not be used for knowledge pages.`,
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

function sortKnowledgeProblems(
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
  action: 'get' | 'reload' | 'upsert',
): string {
  switch (action) {
    case 'get':
      return 'shown'
    case 'reload':
      return 'reloaded'
    case 'upsert':
      return 'upserted'
  }
}
