import path from 'node:path'
import { stringifyFrontmatterDocument } from '@murphai/core'
import {
  DERIVED_KNOWLEDGE_PAGES_ROOT,
  extractKnowledgeFirstHeading,
  extractKnowledgeRelatedSlugs,
  humanizeKnowledgeTag,
  normalizeKnowledgeSlug,
  normalizeKnowledgeTag,
  orderedUniqueStrings,
  renderKnowledgePageBody,
  stripGeneratedKnowledgeSections,
  stripKnowledgeLeadingHeading,
  type KnowledgePage,
  type KnowledgePageMetadata,
  type DerivedKnowledgeNode,
} from '@murphai/query'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'

export function deriveKnowledgeTitle(input: {
  body?: string | null
  existingPage?: DerivedKnowledgeNode | null
  slug?: string | null
  title?: string | null
}): string {
  const explicitTitle = normalizeNullableString(input.title)
  if (explicitTitle) {
    return explicitTitle
  }

  if (input.existingPage?.title) {
    return input.existingPage.title
  }

  const bodyTitle = extractKnowledgeFirstHeading(stripLeadingKnowledgeFrontmatter(input.body))
  if (bodyTitle) {
    return bodyTitle
  }

  const slug = normalizeNullableString(input.slug)
  return slug ? humanizeKnowledgeTag(slug) : 'Derived knowledge page'
}

export function normalizeKnowledgeBody(value: string): string {
  const withoutFrontmatter = stripLeadingKnowledgeFrontmatter(value)
  const withoutGeneratedSections = stripGeneratedKnowledgeSections(withoutFrontmatter)
  return stripKnowledgeLeadingHeading(withoutGeneratedSections)
}

export function extractKnowledgeRelatedSlugsFromBody(input: {
  body: string
  slug: string
}): string[] {
  return extractKnowledgeRelatedSlugs(
    stripLeadingKnowledgeFrontmatter(input.body),
    normalizeKnowledgeSlug(input.slug),
  )
}

export function buildKnowledgeMarkdown(input: {
  body: string
  compiledAt: string
  librarySlugs: string[]
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
    librarySlugs: input.librarySlugs,
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
    body: renderKnowledgePageBody({
      title: input.title,
      body: input.body,
      relatedSlugs: input.relatedSlugs,
      sourcePaths: input.sourcePaths,
    }),
  })
}

export function buildKnowledgePageRelativePath(slug: string): string {
  return path.posix.join(DERIVED_KNOWLEDGE_PAGES_ROOT, `${slug}.md`)
}

export function toKnowledgeMetadata(page: DerivedKnowledgeNode): KnowledgePageMetadata {
  return {
    compiledAt: page.compiledAt,
    librarySlugs: page.librarySlugs,
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
    body: renderKnowledgePageBody({
      title: page.title,
      body: page.body,
      relatedSlugs: page.relatedSlugs,
      sourcePaths: page.sourcePaths,
    }).trim(),
    markdown,
  }
}

export function normalizeSourcePathInputs(value: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return orderedUniqueStrings(
    value
      .map((entry) => String(entry ?? '').trim())
      .filter((entry) => entry.length > 0),
  )
}

export function normalizeRelatedSlugInputs(
  value: readonly string[] | null | undefined,
  currentSlug: string,
): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return orderedUniqueStrings(
    value
      .map((entry) => normalizeKnowledgeSlug(entry))
      .filter((entry) => entry.length > 0 && entry !== currentSlug),
  )
}

export function normalizeLibrarySlugInputs(
  value: readonly string[] | null | undefined,
): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return orderedUniqueStrings(
    value
      .map((entry) => normalizeKnowledgeSlug(entry))
      .filter((entry) => entry.length > 0),
  )
}

export function matchesKnowledgeFilter(
  value: string | null | undefined,
  filter: string | null,
): boolean {
  if (!filter) {
    return true
  }

  return normalizeKnowledgeTag(value) === filter
}

function stripLeadingKnowledgeFrontmatter(value: string | null | undefined): string {
  const normalized = String(value ?? '').replace(/\r\n?/gu, '\n').trim()
  return normalized.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/u, '').trim()
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
