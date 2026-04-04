import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveAssistantVaultPath } from '@murphai/assistant-core'
import { loadIntegratedRuntime } from '@murphai/assistant-core/usecases/runtime'
import { VaultCliError } from '@murphai/assistant-core/vault-cli-errors'
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
  type DerivedKnowledgeNode,
} from '@murphai/query'
import {
  buildKnowledgeMarkdown,
  buildKnowledgePageRelativePath,
  deriveKnowledgeTitle,
  matchesKnowledgeFilter,
  normalizeKnowledgeBody,
  normalizeSourcePathInputs,
  toKnowledgeMetadata,
  toKnowledgePage,
} from './knowledge-documents.js'
import {
  type KnowledgeCompileResult,
  type KnowledgeIndexRebuildResult,
  type KnowledgeLintResult,
  type KnowledgeListResult,
  type KnowledgeSearchResult,
  type KnowledgeShowResult,
} from './knowledge-cli-contracts.js'
import {
  assertKnowledgeSourcePathAllowed,
  collectKnowledgeLintProblems,
  requireUniqueKnowledgePageBySlug,
} from './knowledge-lint.js'

const DEFAULT_KNOWLEDGE_COMPILER = 'assistant'
const DEFAULT_KNOWLEDGE_PAGE_TYPE = 'concept'
const DEFAULT_KNOWLEDGE_STATUS = 'active'

export interface KnowledgeCompileInput {
  body: string
  vault: string
  prompt: string
  title?: string | null
  slug?: string | null
  pageType?: string | null
  status?: string | null
  sourcePaths?: string[] | null
}

export interface KnowledgeCompileDependencies {
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

export interface KnowledgeShowInput {
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

export async function compileKnowledgePage(
  input: KnowledgeCompileInput,
  dependencies: KnowledgeCompileDependencies = {},
): Promise<KnowledgeCompileResult> {
  const now = dependencies.now ?? (() => new Date())
  const savedAt = now().toISOString()
  const saveText = dependencies.saveText ?? saveKnowledgeText
  const { graph } = await readDerivedKnowledgeGraphWithIssues(input.vault)

  const initialTitle = deriveKnowledgeTitle({
    prompt: input.prompt,
    title: input.title,
  })
  const slug = normalizeKnowledgeSlug(input.slug ?? initialTitle)
  const existingPage = requireUniqueKnowledgePageBySlug(graph, slug, 'compile')
  const title = deriveKnowledgeTitle({
    existingPage,
    prompt: input.prompt,
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
  const normalizedBody = normalizeKnowledgeBody(input.body, title)
  const markdown = buildKnowledgeMarkdown({
    body: normalizedBody,
    compiledAt: savedAt,
    compiler: DEFAULT_KNOWLEDGE_COMPILER,
    mode: null,
    pageType,
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
    summary: `Compiled derived knowledge page "${title}".`,
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
      'knowledge_compile_failed',
      `Knowledge page "${slug}" was written but could not be reloaded from the derived knowledge graph.`,
    )
  }

  return {
    vault: input.vault,
    indexPath: indexResult.indexPath,
    page: toKnowledgeMetadata(page),
    prompt: input.prompt.trim(),
    bodyLength: normalizedBody.length,
    savedAt,
    warnings: [],
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

export async function showKnowledgePage(
  input: KnowledgeShowInput,
  dependencies: Pick<KnowledgeCompileDependencies, 'readTextFile'> = {},
): Promise<KnowledgeShowResult> {
  const graph = await readDerivedKnowledgeGraph(input.vault)
  const page = requireUniqueKnowledgePageBySlug(
    graph,
    normalizeKnowledgeSlug(input.slug),
    'show',
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
  dependencies: Pick<KnowledgeCompileDependencies, 'now' | 'saveText'> = {},
): Promise<KnowledgeIndexRebuildResult> {
  const graph = await readDerivedKnowledgeGraph(input.vault)
  const now = dependencies.now ?? (() => new Date())
  const indexMarkdown = renderDerivedKnowledgeIndex(graph, now().toISOString())
  const saveText = dependencies.saveText ?? saveKnowledgeText

  await saveText({
    vault: input.vault,
    relativePath: DERIVED_KNOWLEDGE_INDEX_PATH,
    content: indexMarkdown,
    operationType: 'knowledge_index.write',
    overwrite: true,
    summary: 'Rebuilt the derived knowledge index.',
  })

  return {
    indexPath: DERIVED_KNOWLEDGE_INDEX_PATH,
    pageCount: graph.nodes.length,
    pageTypes: orderedUniqueStrings(
      graph.nodes.flatMap((node: DerivedKnowledgeNode) => (node.pageType ? [node.pageType] : [])),
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
    pathExists: async (candidatePath) => knowledgePathExists(input.vault, candidatePath),
  })

  return {
    ok: problems.every((problem) => problem.severity !== 'error'),
    pageCount: graph.nodes.length,
    problemCount: problems.length,
    problems,
    vault: input.vault,
  }
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
  preferredValue: string | null | undefined,
  fallbackValue: string | null | undefined,
  defaultValue: string,
): string {
  return (
    normalizeKnowledgeTag(preferredValue) ??
    normalizeKnowledgeTag(fallbackValue) ??
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

function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8')
}

function toVaultRelativePath(vaultRoot: string, absolutePath: string): string {
  const relativePath = path.relative(path.resolve(vaultRoot), absolutePath)
  return relativePath.split(path.sep).join(path.posix.sep)
}
