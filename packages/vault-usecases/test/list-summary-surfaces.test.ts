import { describe, expect, it } from 'vitest'

import {
  toCommandListItem,
  toGenericListItem,
  toListEntity,
  type QueryRecord,
} from '../src/helpers.js'

function buildRecord(overrides: Partial<QueryRecord> = {}): QueryRecord {
  return {
    entityId: 'evt_01',
    primaryLookupId: 'evt_01',
    lookupIds: ['evt_01'],
    family: 'event',
    recordClass: 'ledger',
    kind: 'note',
    status: null,
    occurredAt: '2026-04-08T12:00:00Z',
    date: '2026-04-08',
    path: 'events/2026-04-08-note.md',
    title: 'Example note',
    body: null,
    attributes: {},
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: null,
    tags: [],
    ...overrides,
  }
}

describe('list summary surfaces', () => {
  it('derives an excerpt from markdown when a list entity omits one', () => {
    const item = toListEntity({
      id: 'evt_01',
      kind: 'note',
      title: 'Example note',
      occurredAt: '2026-04-08T12:00:00Z',
      path: 'events/2026-04-08-note.md',
      markdown: '# Heading\n\nBody text for the list surface.',
      data: {},
      links: [],
    })

    expect(item.excerpt).toBe('Heading Body text for the list surface.')
  })

  it('preserves an explicit excerpt instead of re-summarizing markdown', () => {
    const item = toListEntity({
      id: 'evt_01',
      kind: 'note',
      title: 'Example note',
      occurredAt: '2026-04-08T12:00:00Z',
      path: 'events/2026-04-08-note.md',
      markdown: '# Heading\n\nBody text for the list surface.',
      excerpt: 'Custom summary',
      data: {},
      links: [],
    })

    expect(item.excerpt).toBe('Custom summary')
  })

  it('lets callers suppress excerpts explicitly with null', () => {
    const item = toListEntity({
      id: 'evt_01',
      kind: 'note',
      title: 'Example note',
      occurredAt: '2026-04-08T12:00:00Z',
      path: 'events/2026-04-08-note.md',
      markdown: '# Heading\n\nBody text for the list surface.',
      excerpt: null,
      data: {},
      links: [],
    })

    expect(item).not.toHaveProperty('excerpt')
  })

  it('keeps helper-backed command list items aligned with show surfaces', () => {
    const item = toCommandListItem(
      buildRecord({
        family: 'sample',
        recordClass: 'sample',
        body: '## Sample\n\nGlucose was steady across the run.',
      }),
    )

    expect(item.excerpt).toBe('Sample Glucose was steady across the run.')
  })

  it('adds bounded excerpts to generic event list items when markdown exists', () => {
    const item = toGenericListItem(
      buildRecord({
        kind: 'document',
        body: '# Imported report\n\nThe main finding is here.',
      }),
    )

    expect(item.excerpt).toBe('Imported report The main finding is here.')
  })
})
