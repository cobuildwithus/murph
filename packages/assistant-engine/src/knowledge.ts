/**
 * Service-only knowledge entrypoint.
 *
 * Query-owned result contracts stay on @murphai/query so callers do not pick
 * up shared knowledge schemas through @murphai/assistant-engine/knowledge.
 */
export {
  appendKnowledgePageSection,
  getKnowledgePage,
  lintKnowledgePages,
  listKnowledgePages,
  rebuildKnowledgeIndex,
  searchKnowledgePages,
  tailKnowledgeLog,
  upsertKnowledgePage,
  type KnowledgeAppendSectionInput,
  type KnowledgeGetInput,
  type KnowledgeListInput,
  type KnowledgeLogTailInput,
  type KnowledgeMaintenanceInput,
  type KnowledgeSearchInput,
  type KnowledgeServiceDependencies,
  type KnowledgeUpsertInput,
} from './knowledge/service.js'
