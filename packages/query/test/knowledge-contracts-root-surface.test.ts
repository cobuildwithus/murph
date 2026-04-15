import { describe, expect, it } from 'vitest'

import * as query from '../src/index.ts'
import * as knowledgeContracts from '../src/knowledge-contracts.ts'

describe('query knowledge contract root surface', () => {
  it('re-exports the knowledge result schemas from the owner root barrel', () => {
    const schemaPairs = [
      ['knowledgeGetResultSchema', query.knowledgeGetResultSchema, knowledgeContracts.knowledgeGetResultSchema],
      ['knowledgeIndexRebuildResultSchema', query.knowledgeIndexRebuildResultSchema, knowledgeContracts.knowledgeIndexRebuildResultSchema],
      ['knowledgeLintProblemSchema', query.knowledgeLintProblemSchema, knowledgeContracts.knowledgeLintProblemSchema],
      ['knowledgeLintResultSchema', query.knowledgeLintResultSchema, knowledgeContracts.knowledgeLintResultSchema],
      ['knowledgeListResultSchema', query.knowledgeListResultSchema, knowledgeContracts.knowledgeListResultSchema],
      ['knowledgeLogEntrySchema', query.knowledgeLogEntrySchema, knowledgeContracts.knowledgeLogEntrySchema],
      ['knowledgeLogTailResultSchema', query.knowledgeLogTailResultSchema, knowledgeContracts.knowledgeLogTailResultSchema],
      ['knowledgePageMetadataSchema', query.knowledgePageMetadataSchema, knowledgeContracts.knowledgePageMetadataSchema],
      ['knowledgePageReferenceSchema', query.knowledgePageReferenceSchema, knowledgeContracts.knowledgePageReferenceSchema],
      ['knowledgePageSchema', query.knowledgePageSchema, knowledgeContracts.knowledgePageSchema],
      ['knowledgeSearchHitSchema', query.knowledgeSearchHitSchema, knowledgeContracts.knowledgeSearchHitSchema],
      ['knowledgeSearchResultSchema', query.knowledgeSearchResultSchema, knowledgeContracts.knowledgeSearchResultSchema],
      ['knowledgeUpsertResultSchema', query.knowledgeUpsertResultSchema, knowledgeContracts.knowledgeUpsertResultSchema],
    ] as const

    for (const [name, rootExport, ownerExport] of schemaPairs) {
      expect(rootExport, `${name} should stay on @murphai/query's root barrel`).toBe(ownerExport)
    }
  })
})
