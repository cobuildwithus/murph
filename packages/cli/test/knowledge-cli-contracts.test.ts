import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  knowledgeLintResultSchema,
  knowledgeLogTailResultSchema,
  knowledgePageSchema,
  knowledgeSearchResultSchema,
} from '../src/knowledge-cli-contracts.js'

test('knowledge search result schema locks the canonical derived-search format', () => {
  const parsed = knowledgeSearchResultSchema.parse({
    format: 'murph.knowledge-search.v1',
    hits: [
      {
        compiledAt: '2026-04-08T00:00:00.000Z',
        librarySlugs: ['sleep-architecture'],
        matchedTerms: ['magnesium', 'sleep'],
        pagePath: 'derived/knowledge/pages/magnesium-and-sleep.md',
        pageType: 'note',
        relatedSlugs: ['sleep-duration'],
        score: 0.88,
        slug: 'magnesium-and-sleep',
        snippet: 'Magnesium improved sleep continuity in repeated notes.',
        sourcePaths: ['research/2026/04/sleep-note.md'],
        status: 'draft',
        summary: 'Observed sleep continuity improvement.',
        title: 'Magnesium and sleep continuity',
      },
    ],
    pageType: null,
    query: 'magnesium sleep',
    status: null,
    total: 1,
    vault: './vault',
  })

  assert.equal(parsed.hits[0]?.slug, 'magnesium-and-sleep')
  assert.equal(parsed.hits[0]?.matchedTerms.length, 2)

  assert.throws(() =>
    knowledgeSearchResultSchema.parse({
      ...parsed,
      format: 'knowledge.search.results.v2',
    }),
  )
})

test('knowledge page, lint, and log-tail contracts accept the canonical nullable metadata surface', () => {
  const page = knowledgePageSchema.parse({
    body: 'Stable notes about sleep continuity.',
    compiledAt: null,
    librarySlugs: [],
    markdown: '# Sleep continuity\n\nStable notes about sleep continuity.\n',
    pagePath: 'derived/knowledge/pages/sleep-continuity.md',
    pageType: null,
    relatedSlugs: [],
    slug: 'sleep-continuity',
    sourcePaths: ['research/2026/04/sleep-note.md'],
    status: null,
    summary: null,
    title: 'Sleep continuity',
  })
  const lintResult = knowledgeLintResultSchema.parse({
    ok: false,
    pageCount: 1,
    problemCount: 1,
    problems: [
      {
        code: 'missing-summary',
        message: 'Summary is required for published pages.',
        pagePath: page.pagePath,
        slug: page.slug,
        severity: 'warning',
      },
    ],
    vault: './vault',
  })
  const logTail = knowledgeLogTailResultSchema.parse({
    count: 1,
    entries: [
      {
        action: 'upsert',
        block: 'frontmatter',
        occurredAt: '2026-04-08T00:00:00.000Z',
        title: 'Sleep continuity',
      },
    ],
    limit: 200,
    logPath: 'derived/knowledge/log.jsonl',
    vault: './vault',
  })

  assert.equal(page.summary, null)
  assert.equal(lintResult.problems[0]?.severity, 'warning')
  assert.equal(logTail.limit, 200)

  assert.throws(() =>
    knowledgeLintResultSchema.parse({
      ...lintResult,
      problems: [
        {
          ...lintResult.problems[0],
          severity: 'info',
        },
      ],
    }),
  )
  assert.throws(() =>
    knowledgeLogTailResultSchema.parse({
      ...logTail,
      limit: 201,
    }),
  )
})
