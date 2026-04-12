import { describe, expect, it } from 'vitest'

import * as knowledgeSurface from '../src/knowledge.ts'

describe('assistant-engine knowledge entrypoint', () => {
  it('exports only service operations', () => {
    expect(Object.keys(knowledgeSurface).sort()).toEqual([
      'getKnowledgePage',
      'lintKnowledgePages',
      'listKnowledgePages',
      'rebuildKnowledgeIndex',
      'searchKnowledgePages',
      'tailKnowledgeLog',
      'upsertKnowledgePage',
    ])
  })
})
