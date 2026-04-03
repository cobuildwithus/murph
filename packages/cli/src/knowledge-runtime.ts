import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveAssistantVaultPath } from '@murphai/assistant-core'
import { normalizeNullableString as normalizeOptionalText } from '@murphai/assistant-core/text/shared'
import { VaultCliError } from '@murphai/assistant-core/vault-cli-errors'
import { stringifyFrontmatterDocument } from '@murphai/core'
import {
  DERIVED_KNOWLEDGE_INDEX_PATH,
  DERIVED_KNOWLEDGE_PAGES_ROOT,
  readDerivedKnowledgeGraph,
  readDerivedKnowledgeGraphWithIssues,
  searchDerivedKnowledgeVault,
  type DerivedKnowledgeGraph,
  type DerivedKnowledgeNode,
} from '@murphai/query'
import {
  runReviewGptPrompt,
  saveVaultTextNote,
  type BuildReviewGptWarnings,
  type ReviewGptRuntimeDependencies,
} from './review-gpt-runtime.js'
import {
  type KnowledgeCompileResult,
  type KnowledgeIndexRebuildResult,
  type KnowledgeLintProblem,
  type KnowledgeLintResult,
  type KnowledgeListResult,
  type KnowledgePage,
  type KnowledgePageMetadata,
  type KnowledgeSearchResult,
  type KnowledgeShowResult,
} from './knowledge-cli-contracts.js'
import { type ResearchExecutionMode } from './research-cli-contracts.js'

const DEFAULT_KNOWLEDGE_MODE: ResearchExecutionMode = 'gpt-pro'
const DEFAULT_KNOWLEDGE_PAGE_TYPE = 'concept'
const DEFAULT_KNOWLEDGE_STATUS = 'active'
const MAX_KNOWLEDGE_SOURCE_FILES = 12
const MAX_KNOWLEDGE_SOURCE_CHARS = 16_000
const MAX_EXISTING_PAGE_CHARS = 18_000

interface KnowledgeSourceEntry {
  content: string
  relativePath: string
}

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
  const existingPage = graph.bySlug.get(slug) ?? null
  const title = deriveKnowledgeTitle({
    existingPage,
    prompt: input.prompt,
    slug,
    title: input.title,
  })
  const pageType =
    normalizeKnowledgeTag(input.pageType) ??
    normalizeKnowledgeTag(existingPage?.pageType) ??
    DEFAULT_KNOWLEDGE_PAGE_TYPE
  const status =
    normalizeKnowledgeTag(input.status) ??
    normalizeKnowledgeTag(existingPage?.status) ??
    DEFAULT_KNOWLEDGE_STATUS
  const existingSourcePaths = existingPage?.sourcePaths ?? []
  const explicitSourcePaths = normalizeSourcePathInputs(input.sourcePaths)
  const compileSourcePaths =
    explicitSourcePaths.length > 0 ? explicitSourcePaths : existingSourcePaths

  const sourceBundle = await collectKnowledgeSourceEntries(
    input.vault,
    compileSourcePaths,
    dependencies.readTextFile ?? defaultReadTextFile,
  )
  const sourcePaths = orderedUniqueStrings([
    ...existingSourcePaths,
    ...sourceBundle.entries.map((entry) => entry.relativePath),
  ])
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
  const relatedSlugs = extractKnowledgeRelatedSlugs(normalizedBody, slug)
  const markdown = buildKnowledgeMarkdown({
    body: normalizedBody,
    compiledAt: savedAt,
    mode: review.mode,
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
  const page = refreshedGraph.bySlug.get(slug)

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

  const pageType = normalizeKnowledgeTag(input.pageType)
  const status = normalizeKnowledgeTag(input.status)
  const result = await searchDerivedKnowledgeVault(input.vault, query, {
    limit: input.limit ?? undefined,
    pageType,
    status,
  })

  return {
    ...result,
    pageType,
    status,
    vault: input.vault,
  }
}

export async function listKnowledgePages(
  input: KnowledgeListInput,
): Promise<KnowledgeListResult> {
  const graph = await readDerivedKnowledgeGraph(input.vault)
  const pageType = normalizeKnowledgeTag(input.pageType)
  const status = normalizeKnowledgeTag(input.status)
  const pages = graph.nodes
    .filter((node) => matchesKnowledgeFilter(node.pageType, pageType))
    .filter((node) => matchesKnowledgeFilter(node.status, status))
    .map(toKnowledgeMetadata)

  return {
    pageCount: pages.length,
    pageType,
    pages,
    status,
    vault: input.vault,
  }
}

export async function showKnowledgePage(
  input: KnowledgeShowInput,
  dependencies: Pick<KnowledgeCompileDependencies, 'readTextFile'> = {},
): Promise<KnowledgeShowResult> {
  const graph = await readDerivedKnowledgeGraph(input.vault)
  const page = graph.bySlug.get(normalizeKnowledgeSlug(input.slug))

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
  const indexMarkdown = renderKnowledgeIndex(graph, now().toISOString())
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
      graph.nodes.flatMap((node) => (node.pageType ? [node.pageType] : [])),
    ),
    rebuilt: true,
    vault: input.vault,
  }
}

export async function lintKnowledgePages(
  input: KnowledgeMaintenanceInput,
): Promise<KnowledgeLintResult> {
  const { graph, issues } = await readDerivedKnowledgeGraphWithIssues(input.vault)
  const problems: KnowledgeLintProblem[] = issues.map((issue) => ({
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

  for (const page of graph.nodes) {
    const pagePath = page.relativePath
    const fileSlug = path.posix.basename(page.relativePath, '.md')
    const duplicatePaths = slugCounts.get(page.slug) ?? []
    duplicatePaths.push(page.relativePath)
    slugCounts.set(page.slug, duplicatePaths)

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

    for (const sourcePath of page.sourcePaths) {
      const sourceExists = await knowledgePathExists(input.vault, sourcePath)
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

  return {
    ok: problems.every((problem) => problem.severity !== 'error'),
    pageCount: graph.nodes.length,
    problemCount: problems.length,
    problems: sortKnowledgeProblems(problems),
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
    const { text: truncatedContent, truncated } = truncateText(
      normalizedContent,
      MAX_KNOWLEDGE_SOURCE_CHARS,
    )
    const relativePath = toVaultRelativePath(vaultRoot, absolutePath)

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

function buildKnowledgeCompilePrompt(input: {
  existingPage: DerivedKnowledgeNode | null
  pageType: string
  prompt: string
  slug: string
  sourceEntries: readonly KnowledgeSourceEntry[]
  status: string
  title: string
}): string {
  const sections = [
    'You are compiling one page in Murph\'s local-first derived knowledge wiki.',
    'Return markdown only. Do not include YAML frontmatter and do not wrap the answer in code fences.',
    'Write a calm, inspectable dossier rather than coaching copy. Prefer source-backed synthesis, note uncertainty and contradictions, and avoid purity language, nagging, or protocol accumulation.',
    'Use clear markdown sections. Start with one H1 heading for the page title. Use `[[slug]]` wikilinks in a `## Related` section when another knowledge page would genuinely help. Do not include a `## Sources` section because the CLI appends that automatically.',
    ['Requested page metadata:', `- title: ${input.title}`, `- slug: ${input.slug}`, `- page type: ${input.pageType}`, `- status: ${input.status}`].join('\n'),
    ['User instruction:', input.prompt.trim()].join('\n\n'),
  ]

  if (input.existingPage) {
    sections.push(
      [
        'Existing saved page (update it instead of starting from scratch when useful):',
        `- path: ${input.existingPage.relativePath}`,
        `- title: ${input.existingPage.title}`,
        `- page type: ${input.existingPage.pageType ?? 'unknown'}`,
        `- status: ${input.existingPage.status ?? 'unknown'}`,
        '',
        truncateText(input.existingPage.body, MAX_EXISTING_PAGE_CHARS).text,
      ].join('\n'),
    )
  }

  if (input.sourceEntries.length === 0) {
    sections.push('No local source files were supplied for this compile. Rely on the user instruction and any existing page context only.')
  } else {
    sections.push(
      [
        'Local source files:',
        ...input.sourceEntries.flatMap((entry) => [
          `### ${entry.relativePath}`,
          '```text',
          entry.content,
          '```',
        ]),
      ].join('\n\n'),
    )
  }

  return sections.join('\n\n')
}

function buildKnowledgeMarkdown(input: {
  body: string
  compiledAt: string
  mode: ResearchExecutionMode
  pageType: string
  relatedSlugs: string[]
  slug: string
  sourcePaths: string[]
  status: string
  summary: string | null
  title: string
}): string {
  const attributes = compactRecord({
    compiledAt: input.compiledAt,
    compiler: 'review:gpt',
    mode: input.mode,
    pageType: input.pageType,
    relatedSlugs: input.relatedSlugs,
    slug: input.slug,
    sourcePaths: input.sourcePaths,
    status: input.status,
    summary: input.summary,
    title: input.title,
  })

  return stringifyFrontmatterDocument({
    attributes,
    body: appendKnowledgeSourcesSection(input.body, input.sourcePaths),
  })
}

function appendKnowledgeSourcesSection(body: string, sourcePaths: readonly string[]): string {
  if (sourcePaths.length === 0) {
    return `${body.trim()}\n`
  }

  return [
    body.trim(),
    '',
    '## Sources',
    '',
    ...sourcePaths.map((sourcePath) => `- \`${sourcePath}\``),
    '',
  ].join('\n')
}

function normalizeKnowledgeBody(response: string, title: string): string {
  let body = response.replace(/\r\n?/gu, '\n').trim()

  if (/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/u.test(body)) {
    body = body.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/u, '').trim()
  }

  body = stripGeneratedKnowledgeSection(body, ['Sources', 'Source notes', 'Source files'])

  if (/^#\s+/u.test(body)) {
    body = body.replace(/^#\s+[^\n]*$/mu, `# ${title}`)
  } else {
    body = `# ${title}\n\n${body}`
  }

  return body.trim()
}

function stripGeneratedKnowledgeSection(body: string, headings: readonly string[]): string {
  let normalized = body

  for (const heading of headings) {
    const pattern = new RegExp(
      `(^|\\n)##\\s+${escapeRegExp(heading)}\\s*\\n[\\s\\S]*?(?=\\n##\\s+|$)`,
      'giu',
    )
    normalized = normalized.replace(pattern, '$1').trim()
  }

  return normalized
}

function extractKnowledgeRelatedSlugs(body: string, currentSlug: string): string[] {
  const matches = body.matchAll(/\[\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\]/gu)
  const related = [] as string[]

  for (const match of matches) {
    const slug = match[1]?.trim()
    if (!slug || slug === currentSlug) {
      continue
    }
    related.push(slug)
  }

  return orderedUniqueStrings(related)
}

function summarizeKnowledgeBody(body: string): string | null {
  const paragraphs = body
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .filter((paragraph) => !paragraph.startsWith('#'))

  const firstParagraph = paragraphs[0] ?? null
  if (!firstParagraph) {
    return null
  }

  return truncateText(firstParagraph.replace(/\s+/gu, ' '), 220).text
}

function renderKnowledgeIndex(graph: DerivedKnowledgeGraph, generatedAt: string): string {
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
    lines.push('No derived knowledge pages have been compiled yet.', '')
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
            .map((slug) => renderKnowledgePageLink(graph, slug))
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

function renderKnowledgePageLink(graph: DerivedKnowledgeGraph, slug: string): string {
  const target = graph.bySlug.get(slug)
  if (!target) {
    return `\`${slug}\``
  }

  return `[${target.title}](pages/${path.posix.basename(target.relativePath)})`
}

function toKnowledgeMetadata(page: DerivedKnowledgeNode): KnowledgePageMetadata {
  return {
    compiler: page.compiler,
    compiledAt: page.compiledAt,
    mode: normalizeKnowledgeMode(page.mode),
    pagePath: page.relativePath,
    pageType: page.pageType,
    relatedSlugs: page.relatedSlugs,
    slug: page.slug,
    sourcePaths: page.sourcePaths,
    status: page.status,
    summary: page.summary,
    title: page.title,
  }
}

function toKnowledgePage(page: DerivedKnowledgeNode, markdown: string): KnowledgePage {
  return {
    ...toKnowledgeMetadata(page),
    body: page.body,
    markdown,
  }
}

function deriveKnowledgeTitle(input: {
  existingPage?: DerivedKnowledgeNode | null
  prompt: string
  slug?: string | null
  title?: string | null
}): string {
  const explicitTitle = normalizeOptionalText(input.title)
  if (explicitTitle) {
    return explicitTitle
  }

  if (input.existingPage?.title) {
    return input.existingPage.title
  }

  const normalizedPrompt = input.prompt.replace(/\s+/gu, ' ').trim()
  if (normalizedPrompt.length > 0) {
    return normalizedPrompt.length <= 80
      ? normalizedPrompt
      : `${normalizedPrompt.slice(0, 77).trimEnd()}...`
  }

  const slug = normalizeOptionalText(input.slug)
  return slug ? humanizeKnowledgeTag(slug) : 'Derived knowledge page'
}

function buildKnowledgePageRelativePath(slug: string): string {
  return path.posix.join(DERIVED_KNOWLEDGE_PAGES_ROOT, `${slug}.md`)
}

function normalizeKnowledgeSlug(value: string): string {
  const slug =
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'knowledge-page'

  return slug
}

function normalizeKnowledgeTag(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value)
  if (!normalized) {
    return null
  }

  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || null
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

function sortKnowledgeProblems(problems: readonly KnowledgeLintProblem[]): KnowledgeLintProblem[] {
  return [...problems].sort((left, right) => {
    const severityComparison = left.severity.localeCompare(right.severity)
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

async function saveKnowledgeText(input: {
  vault: string
  relativePath: string
  content: string
  operationType: string
  overwrite: boolean
  summary: string
}): Promise<void> {
  await saveVaultTextNote({
    vault: input.vault,
    relativePath: input.relativePath,
    content: input.content,
    operationType: input.operationType,
    overwrite: input.overwrite,
    summary: input.summary,
  })
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf8')
}

function toVaultRelativePath(vaultRoot: string, absolutePath: string): string {
  const relativePath = path.relative(path.resolve(vaultRoot), absolutePath)
  return relativePath.split(path.sep).join(path.posix.sep)
}

function normalizeSourceText(value: string): string {
  return String(value ?? '').replace(/\r\n?/gu, '\n').trim()
}

function truncateText(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) {
    return {
      text: value,
      truncated: false,
    }
  }

  return {
    text: `${value.slice(0, Math.max(0, limit - 17)).trimEnd()}\n\n[truncated locally]`,
    truncated: true,
  }
}

function compactRecord<TValue>(
  value: Record<string, TValue | TValue[] | null | undefined>,
): Record<string, TValue | TValue[]> {
  const compacted: Record<string, TValue | TValue[]> = {}

  for (const [key, current] of Object.entries(value)) {
    if (current === null || current === undefined) {
      continue
    }

    if (Array.isArray(current) && current.length === 0) {
      continue
    }

    compacted[key] = current
  }

  return compacted
}

function normalizeKnowledgeMode(value: string | null): ResearchExecutionMode | null {
  return value === 'deep-research' || value === 'gpt-pro' ? value : null
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

function humanizeKnowledgeTag(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
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
