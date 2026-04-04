import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveAssistantVaultPath } from '@murphai/assistant-core'
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
  runReviewGptPrompt,
  saveVaultTextNote,
  type BuildReviewGptWarnings,
  type ReviewGptRuntimeDependencies,
} from './review-gpt-runtime.js'
import {
  buildKnowledgeCompilePrompt,
  buildKnowledgeMarkdown,
  buildKnowledgePageRelativePath,
  deriveKnowledgeTitle,
  normalizeKnowledgeBody,
  toKnowledgeMetadata,
  toKnowledgePage,
  truncateContextText,
  type KnowledgeSourceEntry,
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
import { type ResearchExecutionMode } from './research-cli-contracts.js'

const DEFAULT_KNOWLEDGE_MODE: ResearchExecutionMode = 'gpt-pro'
const DEFAULT_KNOWLEDGE_PAGE_TYPE = 'concept'
const DEFAULT_KNOWLEDGE_STATUS = 'active'
const MAX_KNOWLEDGE_SOURCE_FILES = 12
const MAX_KNOWLEDGE_SOURCE_CHARS = 16_000

export interface KnowledgeCompileInput {
  vault: string
  prompt: string
  title?: string | null
  slug?: string | null
  pageType?: string | null
  status?: string | null
  sourcePaths?: string[] | null
  mode?: ResearchExecutionMode | null
  chat?: string | null
  browserPath?: string | null
  timeout?: string | null
  waitTimeout?: string | null
}

export interface KnowledgeCompileDependencies extends ReviewGptRuntimeDependencies {
  now?: () => Date
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
  const compileSourcePaths = orderedUniqueStrings([
    ...existingSourcePaths,
    ...explicitSourcePaths,
  ])

  const sourceBundle = await collectKnowledgeSourceEntries(
    input.vault,
    compileSourcePaths,
    dependencies.readTextFile ?? defaultReadTextFile,
  )
  const sourcePaths = sourceBundle.entries.map((entry) => entry.relativePath)
  const knowledgePrompt = buildKnowledgeCompilePrompt({
    existingPage,
    pageType,
    prompt: input.prompt,
    slug,
    sourceEntries: sourceBundle.entries,
    status,
    title,
  })
  const review = await runReviewGptPrompt(
    {
      vault: input.vault,
      prompt: knowledgePrompt,
      mode: input.mode ?? DEFAULT_KNOWLEDGE_MODE,
      chat: input.chat,
      browserPath: input.browserPath,
      timeout: input.timeout,
      waitTimeout: input.waitTimeout,
    },
    dependencies,
    {
      buildWarnings: buildKnowledgeWarnings,
    },
  )

  const normalizedBody = normalizeKnowledgeBody(review.response, title)
  const markdown = buildKnowledgeMarkdown({
    body: normalizedBody,
    compiledAt: savedAt,
    mode: review.mode,
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
    mode: review.mode,
    page: toKnowledgeMetadata(page),
    prompt: input.prompt.trim(),
    responseLength: review.responseLength,
    savedAt,
    warnings: [...review.warnings, ...sourceBundle.warnings],
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

async function collectKnowledgeSourceEntries(
  vaultRoot: string,
  sourcePaths: readonly string[],
  readTextFile: (filePath: string) => Promise<string>,
): Promise<{ entries: KnowledgeSourceEntry[]; warnings: string[] }> {
  const warnings: string[] = []
  const entries: KnowledgeSourceEntry[] = []
  const limitedSourcePaths = sourcePaths.slice(0, MAX_KNOWLEDGE_SOURCE_FILES)

  if (sourcePaths.length > MAX_KNOWLEDGE_SOURCE_FILES) {
    warnings.push(
      `Knowledge compile only included the first ${MAX_KNOWLEDGE_SOURCE_FILES} source paths in this run.`,
    )
  }

  for (const sourcePath of limitedSourcePaths) {
    const absolutePath = await resolveAssistantVaultPath(vaultRoot, sourcePath, 'file path')
    const relativePath = toVaultRelativePath(vaultRoot, absolutePath)
    assertKnowledgeSourcePathAllowed(relativePath)
    let content: string

    try {
      content = await readTextFile(absolutePath)
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

    const normalizedContent = normalizeSourceText(content)
    const { text: truncatedContent, truncated } = truncateContextText(
      normalizedContent,
      MAX_KNOWLEDGE_SOURCE_CHARS,
    )

    if (truncated) {
      warnings.push(
        `Knowledge source "${relativePath}" was truncated to ${MAX_KNOWLEDGE_SOURCE_CHARS} characters before compilation.`,
      )
    }

    entries.push({
      content: truncatedContent,
      relativePath,
    })
  }

  return {
    entries,
    warnings,
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

function normalizeSourcePathInputs(value: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return orderedUniqueStrings(
    value
      .map((entry) => String(entry ?? '').trim())
      .filter((entry) => entry.length > 0),
  )
}

function matchesKnowledgeFilter(value: string | null | undefined, filter: string | null): boolean {
  if (!filter) {
    return true
  }

  return normalizeKnowledgeTag(value) === filter
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

function saveKnowledgeText(input: {
  vault: string
  relativePath: string
  content: string
  operationType: string
  overwrite: boolean
  summary: string
}): Promise<void> {
  return saveVaultTextNote({
    vault: input.vault,
    relativePath: input.relativePath,
    content: input.content,
    operationType: input.operationType,
    overwrite: input.overwrite,
    summary: input.summary,
  })
}

function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8')
}

function toVaultRelativePath(vaultRoot: string, absolutePath: string): string {
  const relativePath = path.relative(path.resolve(vaultRoot), absolutePath)
  return relativePath.split(path.sep).join(path.posix.sep)
}

function normalizeSourceText(value: string): string {
  return String(value ?? '').replace(/\r\n?/gu, '\n').trim()
}

const buildKnowledgeWarnings: BuildReviewGptWarnings = (input) => {
  const account = input.defaults?.account ?? null
  const planCode =
    typeof account?.planCode === 'string' ? account.planCode.trim().toLowerCase() : null
  const planName =
    typeof account?.planName === 'string' && account.planName.trim().length > 0
      ? account.planName.trim()
      : null

  if (input.mode === 'gpt-pro') {
    if (planCode === 'pro') {
      return []
    }

    if (planName) {
      return [
        `Knowledge compile targets GPT Pro mode and may fail because the saved assistant account is ${planName}, not Pro.`,
      ]
    }

    return [
      'Knowledge compile targets GPT Pro mode and may fail because Murph could not verify a saved Pro assistant account on this machine.',
    ]
  }

  if (planCode === 'free' || planCode === 'guest') {
    return [
      `Knowledge compile uses Deep Research and may be unavailable or more limited on the saved ${planName ?? 'Free'} account.`,
    ]
  }

  return []
}
