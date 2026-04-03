import path from 'node:path'
import { normalizeNullableString as normalizeOptionalText } from '@murphai/assistant-core/text/shared'
import { stringifyFrontmatterDocument } from '@murphai/core'
import {
  DERIVED_KNOWLEDGE_PAGES_ROOT,
  type DerivedKnowledgeNode,
  humanizeDerivedKnowledgeValue,
} from '@murphai/query'
import {
  type KnowledgePage,
  type KnowledgePageMetadata,
} from './knowledge-cli-contracts.js'
import { type ResearchExecutionMode } from './research-cli-contracts.js'

const MAX_EXISTING_PAGE_CHARS = 18_000
const LOCAL_CONTEXT_TRUNCATION_SUFFIX = '\n\n[truncated locally]'

export interface KnowledgeSourceEntry {
  content: string
  relativePath: string
}

export function deriveKnowledgeTitle(input: {
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
  return slug ? humanizeDerivedKnowledgeValue(slug) : 'Derived knowledge page'
}

export function buildKnowledgeCompilePrompt(input: {
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
    [
      'Requested page metadata:',
      `- title: ${input.title}`,
      `- slug: ${input.slug}`,
      `- page type: ${input.pageType}`,
      `- status: ${input.status}`,
    ].join('\n'),
    ['User instruction:', input.prompt.trim()].join('\n\n'),
  ]

  if (input.existingPage) {
    const existingBody = stripGeneratedKnowledgeSection(input.existingPage.body, [
      'Sources',
      'Source notes',
      'Source files',
    ])

    sections.push(
      [
        'Existing saved page (update it instead of starting from scratch when useful):',
        `- path: ${input.existingPage.relativePath}`,
        `- title: ${input.existingPage.title}`,
        `- page type: ${input.existingPage.pageType ?? 'unknown'}`,
        `- status: ${input.existingPage.status ?? 'unknown'}`,
        '',
        truncateContextText(existingBody, MAX_EXISTING_PAGE_CHARS).text,
      ].join('\n'),
    )
  }

  if (input.sourceEntries.length === 0) {
    sections.push(
      'No local source files were supplied for this compile. Rely on the user instruction and any existing page context only.',
    )
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

export function normalizeKnowledgeBody(response: string, title: string): string {
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

export function buildKnowledgeMarkdown(input: {
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

export function buildKnowledgePageRelativePath(slug: string): string {
  return path.posix.join(DERIVED_KNOWLEDGE_PAGES_ROOT, `${slug}.md`)
}

export function toKnowledgeMetadata(page: DerivedKnowledgeNode): KnowledgePageMetadata {
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

export function toKnowledgePage(page: DerivedKnowledgeNode, markdown: string): KnowledgePage {
  return {
    ...toKnowledgeMetadata(page),
    body: page.body,
    markdown,
  }
}

export function truncateContextText(
  value: string,
  limit: number,
): { text: string; truncated: boolean } {
  if (value.length <= limit) {
    return {
      text: value,
      truncated: false,
    }
  }

  const textLimit = Math.max(0, limit - LOCAL_CONTEXT_TRUNCATION_SUFFIX.length)
  return {
    text: `${value.slice(0, textLimit).trimEnd()}${LOCAL_CONTEXT_TRUNCATION_SUFFIX}`,
    truncated: true,
  }
}

function normalizeKnowledgeMode(value: string | null): ResearchExecutionMode | null {
  return value === 'deep-research' || value === 'gpt-pro' ? value : null
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
