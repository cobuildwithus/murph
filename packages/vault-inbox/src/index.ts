/**
 * Dedicated vault, inbox, and knowledge app/usecase surface.
 */

export {
  createIntegratedInboxServices,
  type InboxServices,
} from './inbox-services.js'

export {
  createIntegratedVaultServices,
  createUnwiredVaultServices,
  type CommandContext,
  type CoreWriteServices,
  type DeviceSyncServices,
  type ImporterServices,
  type QueryServices,
  type VaultServices,
} from './vault-services.js'

export {
  assertKnowledgeSourcePathAllowed,
  getKnowledgePage,
  lintKnowledgePages,
  listKnowledgePages,
  matchesKnowledgeFilter,
  normalizeRelatedSlugInputs,
  normalizeSourcePathInputs,
  rebuildKnowledgeIndex,
  searchKnowledgePages,
  upsertKnowledgePage,
  type KnowledgeGetInput,
  type KnowledgeGetResult,
  type KnowledgeIndexRebuildResult,
  type KnowledgeLintProblem,
  type KnowledgeLintResult,
  type KnowledgeListInput,
  type KnowledgeListResult,
  type KnowledgePage,
  type KnowledgePageMetadata,
  type KnowledgePageReference,
  type KnowledgeSearchHit,
  type KnowledgeSearchInput,
  type KnowledgeSearchResult,
  type KnowledgeServiceDependencies,
  type KnowledgeUpsertInput,
  type KnowledgeUpsertResult,
} from './knowledge.js'
