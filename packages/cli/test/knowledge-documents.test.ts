import { describe, expect, it } from 'vitest'

import {
  matchesKnowledgeFilter,
  normalizeSourcePathInputs,
} from '@murphai/assistant-engine/knowledge'

describe('normalizeSourcePathInputs', () => {
  it('trims, drops blanks, and preserves unique source paths in first-seen order', () => {
    expect(
      normalizeSourcePathInputs([
        ' research/notes/sleep.md ',
        '',
        'research/notes/magnesium.md',
        'research/notes/sleep.md',
        '   ',
      ]),
    ).toEqual(['research/notes/sleep.md', 'research/notes/magnesium.md'])
  })

  it('returns an empty list for non-array inputs', () => {
    expect(normalizeSourcePathInputs(null)).toEqual([])
    expect(normalizeSourcePathInputs(undefined)).toEqual([])
  })
})

describe('matchesKnowledgeFilter', () => {
  it('treats a missing filter as a pass-through', () => {
    expect(matchesKnowledgeFilter(' Concept ', null)).toBe(true)
  })

  it('normalizes the value before comparing against the provided filter token', () => {
    expect(matchesKnowledgeFilter(' Concept ', 'concept')).toBe(true)
    expect(matchesKnowledgeFilter('Concept', ' concept ')).toBe(false)
    expect(matchesKnowledgeFilter('archived', 'active')).toBe(false)
  })
})
