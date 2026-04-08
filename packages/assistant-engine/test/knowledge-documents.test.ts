import { describe, expect, it } from 'vitest'

import type { DerivedKnowledgeNode } from '@murphai/query'

import {
  buildKnowledgeMarkdown,
  buildKnowledgePageRelativePath,
  deriveKnowledgeTitle,
  extractKnowledgeRelatedSlugsFromBody,
  matchesKnowledgeFilter,
  normalizeKnowledgeBody,
  normalizeLibrarySlugInputs,
  normalizeRelatedSlugInputs,
  normalizeSourcePathInputs,
  toKnowledgeMetadata,
  toKnowledgePage,
} from '../src/knowledge/documents.ts'

describe('knowledge document helpers', () => {
  it('derives titles from explicit input, existing pages, body headings, slugs, or the default fallback', () => {
    const existingPage = createKnowledgeNode({
      slug: 'sleep-rhythm',
      title: 'Existing Sleep Rhythm',
    })

    expect(
      deriveKnowledgeTitle({
        title: '  Explicit Title  ',
        existingPage,
        body: '# Ignored',
        slug: 'ignored',
      }),
    ).toBe('Explicit Title')

    expect(
      deriveKnowledgeTitle({
        existingPage,
        body: '# Ignored',
        slug: 'ignored',
      }),
    ).toBe('Existing Sleep Rhythm')

    expect(
      deriveKnowledgeTitle({
        body: '# Circadian Alignment\n\nBody text.',
        slug: 'ignored',
      }),
    ).toBe('Circadian Alignment')

    expect(
      deriveKnowledgeTitle({
        body: 'No heading here.',
        slug: 'blood-sugar-basics',
      }),
    ).toBe('Blood Sugar Basics')

    expect(
      deriveKnowledgeTitle({
        body: 'No heading here.',
      }),
    ).toBe('Derived knowledge page')
  })

  it('normalizes knowledge bodies by removing frontmatter, leading headings, and generated sections', () => {
    const body = [
      '---',
      'title: Example',
      'summary: Ignore this metadata.',
      '---',
      '',
      '# Hydration',
      '',
      'Hydration helps recovery.',
      '',
      '## Related',
      '',
      '- [[sleep]]',
      '',
      '## Sources',
      '',
      '- `journal/hydration.md`',
      '',
      '## Notes',
      '',
      'Keep this section.',
    ].join('\n')

    const normalizedBody = normalizeKnowledgeBody(body)

    expect(normalizedBody).toContain('Hydration helps recovery.')
    expect(normalizedBody).toContain('## Notes\n\nKeep this section.')
    expect(normalizedBody).not.toContain('# Hydration')
    expect(normalizedBody).not.toContain('## Related')
    expect(normalizedBody).not.toContain('## Sources')
  })

  it('extracts body-only related slugs and normalizes metadata input helpers', () => {
    const body = [
      '---',
      'summary: Frontmatter should not count [[frontmatter-slug]]',
      '---',
      '',
      '# Recovery',
      '',
      'Links: [[sleep]], [[hydration]], [[sleep]], [[recovery]].',
    ].join('\n')

    expect(
      extractKnowledgeRelatedSlugsFromBody({
        body,
        slug: 'recovery',
      }),
    ).toEqual(['sleep', 'hydration'])

    expect(
      normalizeSourcePathInputs([' notes/recovery.md ', 'notes/recovery.md', '', 'journal/log.md']),
    ).toEqual(['notes/recovery.md', 'journal/log.md'])

    expect(
      normalizeRelatedSlugInputs([' Sleep Quality ', 'sleep-quality', 'recovery', 'Hydration '], 'recovery'),
    ).toEqual(['sleep-quality', 'hydration'])

    expect(
      normalizeLibrarySlugInputs([' Blood Sugar ', 'blood-sugar', 'Cardio Health']),
    ).toEqual(['blood-sugar', 'cardio-health'])
  })

  it('maps graph nodes into page metadata and rendered page bodies', () => {
    const page = createKnowledgeNode({
      title: 'Hydration',
      relatedSlugs: ['sleep', 'electrolytes'],
      sourcePaths: ['journal/hydration.md', 'bank/library/water.md'],
    })

    expect(buildKnowledgePageRelativePath('hydration')).toBe(
      'derived/knowledge/pages/hydration.md',
    )
    expect(toKnowledgeMetadata(page)).toMatchObject({
      slug: 'hydration',
      title: 'Hydration',
      pagePath: 'derived/knowledge/pages/hydration.md',
      relatedSlugs: ['sleep', 'electrolytes'],
      sourcePaths: ['journal/hydration.md', 'bank/library/water.md'],
    })
    expect(
      toKnowledgePage(page, '---\nslug: hydration\n---\n# Hydration'),
    ).toMatchObject({
      markdown: '---\nslug: hydration\n---\n# Hydration',
      body: [
        '# Hydration',
        '',
        'Hydration supports recovery and training.',
        '',
        '## Related',
        '',
        '- [[sleep]]',
        '- [[electrolytes]]',
        '',
        '## Sources',
        '',
        '- `journal/hydration.md`',
        '- `bank/library/water.md`',
      ].join('\n'),
    })
  })

  it('matches filters only after normalizing both page values and filters', () => {
    expect(matchesKnowledgeFilter('Concept Notes', 'concept-notes')).toBe(true)
    expect(matchesKnowledgeFilter('draft', null)).toBe(true)
    expect(matchesKnowledgeFilter('active', 'archived')).toBe(false)
  })

  it('builds markdown frontmatter without nulls or empty arrays and normalizes invalid list inputs to empty arrays', () => {
    const markdown = buildKnowledgeMarkdown({
      body: 'Hydration supports recovery.',
      compiledAt: '2026-04-08T10:00:00.000Z',
      librarySlugs: [],
      pageType: 'concept',
      relatedSlugs: [],
      slug: 'hydration',
      sourcePaths: ['journal/hydration.md'],
      status: 'active',
      summary: null,
      title: 'Hydration',
    })

    expect(markdown).toContain('compiledAt: 2026-04-08T10:00:00.000Z')
    expect(markdown).toContain('slug: hydration')
    expect(markdown).not.toContain('summary:')
    expect(markdown).not.toContain('librarySlugs:')
    expect(markdown).not.toContain('relatedSlugs:')

    expect(normalizeSourcePathInputs(null)).toEqual([])
    expect(normalizeRelatedSlugInputs(undefined, 'hydration')).toEqual([])
    expect(normalizeLibrarySlugInputs(undefined)).toEqual([])
  })
})

function createKnowledgeNode(
  overrides: Partial<DerivedKnowledgeNode> = {},
): DerivedKnowledgeNode {
  return {
    attributes: {},
    body: 'Hydration supports recovery and training.',
    compiledAt: '2026-04-08T10:00:00.000Z',
    librarySlugs: ['water'],
    pageType: 'concept',
    relativePath: 'derived/knowledge/pages/hydration.md',
    relatedSlugs: ['sleep'],
    slug: 'hydration',
    sourcePaths: ['journal/hydration.md'],
    status: 'active',
    summary: 'Hydration supports recovery and training.',
    title: 'Hydration',
    ...overrides,
  }
}
