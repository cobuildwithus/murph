import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  KnowledgeGetResult as SharedKnowledgeGetResult,
  KnowledgeSearchResult as SharedKnowledgeSearchResult,
} from '@murphai/query'

import {
  knowledgeSearchResultSchema,
  knowledgeShowResultSchema,
  type KnowledgeSearchResult,
  type KnowledgeShowResult,
} from '../src/knowledge-cli-contracts.ts'

describe('knowledge cli contracts', () => {
  it('keeps the CLI boundary schemas aligned with the shared query-owned result types', () => {
    const parsed = knowledgeSearchResultSchema.parse({
      format: 'murph.knowledge-search.v1',
      hits: [{
        compiledAt: '2026-04-08T00:00:00.000Z',
        librarySlugs: ['hydration'],
        matchedTerms: ['hydration'],
        pagePath: 'derived/knowledge/pages/hydration.md',
        pageType: 'concept',
        relatedSlugs: ['electrolytes'],
        score: 0.98,
        slug: 'hydration',
        snippet: 'Hydration supports recovery.',
        sourcePaths: ['vault/notes/hydration.md'],
        status: 'active',
        summary: 'Hydration basics.',
        title: 'Hydration',
      }],
      pageType: 'concept',
      query: 'hydration',
      status: 'active',
      total: 1,
      vault: '/vault',
    })

    const page = knowledgeShowResultSchema.parse({
      page: {
        body: 'Hydration supports recovery.',
        compiledAt: '2026-04-08T00:00:00.000Z',
        librarySlugs: ['hydration'],
        markdown: '# Hydration\n\nHydration supports recovery.',
        pagePath: 'derived/knowledge/pages/hydration.md',
        pageType: 'concept',
        relatedSlugs: ['electrolytes'],
        slug: 'hydration',
        sourcePaths: ['vault/notes/hydration.md'],
        status: 'active',
        summary: 'Hydration basics.',
        title: 'Hydration',
      },
      vault: '/vault',
    })

    expect(parsed.hits[0]?.slug).toBe('hydration')
    expect(page.page.title).toBe('Hydration')
    expectTypeOf<KnowledgeSearchResult>().toEqualTypeOf<SharedKnowledgeSearchResult>()
    expectTypeOf<KnowledgeShowResult>().toEqualTypeOf<SharedKnowledgeGetResult>()
  })
})
