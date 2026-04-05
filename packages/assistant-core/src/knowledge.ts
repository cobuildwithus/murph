export {
  assertKnowledgeSourcePathAllowed,
  getKnowledgePage,
  lintKnowledgePages,
  listKnowledgePages,
  rebuildKnowledgeIndex,
  searchKnowledgePages,
  tailKnowledgeLog,
  upsertKnowledgePage,
  type KnowledgeGetInput,
  type KnowledgeListInput,
  type KnowledgeLogTailInput,
  type KnowledgeMaintenanceInput,
  type KnowledgeSearchInput,
  type KnowledgeServiceDependencies,
  type KnowledgeUpsertInput,
} from './knowledge/service.js'

export {
  matchesKnowledgeFilter,
  normalizeLibrarySlugInputs,
  normalizeRelatedSlugInputs,
  normalizeSourcePathInputs,
} from './knowledge/documents.js'

export type {
  KnowledgeGetResult,
  KnowledgeIndexRebuildResult,
  KnowledgeLogEntry,
  KnowledgeLogTailResult,
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
