export {
  assertKnowledgeSourcePathAllowed,
  getKnowledgePage,
  lintKnowledgePages,
  listKnowledgePages,
  rebuildKnowledgeIndex,
  searchKnowledgePages,
  upsertKnowledgePage,
  type KnowledgeGetInput,
  type KnowledgeListInput,
  type KnowledgeMaintenanceInput,
  type KnowledgeSearchInput,
  type KnowledgeServiceDependencies,
  type KnowledgeUpsertInput,
} from './knowledge/service.js'

export {
  matchesKnowledgeFilter,
  normalizeRelatedSlugInputs,
  normalizeSourcePathInputs,
} from './knowledge/documents.js'

export type {
  KnowledgeGetResult,
  KnowledgeIndexRebuildResult,
  KnowledgeLintProblem,
  KnowledgeLintResult,
  KnowledgeListResult,
  KnowledgePage,
  KnowledgePageMetadata,
  KnowledgePageReference,
  KnowledgeSearchHit,
  KnowledgeSearchResult,
  KnowledgeUpsertResult,
} from './knowledge/contracts.js'
