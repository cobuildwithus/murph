import { describe, expectTypeOf, it } from 'vitest'
import type {
  KnowledgeGetResult as QueryKnowledgeGetResult,
  KnowledgeSearchResult as QueryKnowledgeSearchResult,
} from '@murphai/query'
import type {
  KnowledgeGetResult,
  KnowledgeSearchResult,
} from '../src/knowledge/contracts.ts'

describe('assistant-engine knowledge contract compatibility', () => {
  it('re-exports the query-owned knowledge result types without widening them', () => {
    expectTypeOf<KnowledgeSearchResult>().toEqualTypeOf<QueryKnowledgeSearchResult>()
    expectTypeOf<KnowledgeGetResult>().toEqualTypeOf<QueryKnowledgeGetResult>()
  })
})
