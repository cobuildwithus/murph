import { describe, expectTypeOf, it } from 'vitest'
import type {
  KnowledgeGetResult as QueryKnowledgeGetResult,
  KnowledgeSearchResult as QueryKnowledgeSearchResult,
} from '@murphai/query'
import type {
  KnowledgeGetResult,
  KnowledgeSearchResult,
} from '../src/knowledge.ts'

describe('assistant-engine knowledge contract compatibility', () => {
  it('re-exports the query-owned knowledge result types from the public knowledge surface without widening them', () => {
    expectTypeOf<KnowledgeSearchResult>().toEqualTypeOf<QueryKnowledgeSearchResult>()
    expectTypeOf<KnowledgeGetResult>().toEqualTypeOf<QueryKnowledgeGetResult>()
  })
})
