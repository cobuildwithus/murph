export {
  BASELINE_EVENT_KINDS,
  BASELINE_SAMPLE_STREAMS,
  CURRENT_VAULT_FORMAT_VERSION,
  DEFAULT_TIMEZONE,
  ID_PREFIXES,
  REQUIRED_DIRECTORIES,
  VAULT_LAYOUT,
  VAULT_SCHEMA_VERSION,
} from "./constants.ts";
export { VaultError, isVaultError } from "./errors.ts";
export * from "./automation.ts";
export * from "./memory.ts";
export {
  assertPathWithinVault,
  assertPathWithinVaultOnDisk,
  normalizeOpaquePathSegment,
  normalizeRelativeVaultPath,
  normalizeVaultRoot,
  resolveVaultPath,
  resolveVaultPathOnDisk,
} from "./path-safety.ts";
export { walkVaultFiles } from "./fs.ts";
export {
  buildAttachmentCompatibilityProjections,
  cleanupStagedEventAttachments,
  prepareEventAttachments,
  stageEventAttachments,
  stagePreparedEventAttachmentsInBatch,
} from "./event-attachments.ts";
export type {
  EventAttachmentOwnerKind,
  EventAttachmentSourceInput,
  PreparedEventAttachment,
} from "./event-attachments.ts";
export { readJsonlRecords, toMonthlyShardRelativePath } from "./jsonl.ts";
export { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.ts";
export { loadVault } from "./vault.ts";
export {
  addActivitySession,
  addBodyMeasurement,
  addMeal,
  applyCanonicalWriteBatch,
  appendBloodTest,
  appendJournal,
  appendHistoryEvent,
  appendJsonlRecord,
  appendProfileSnapshot,
  checkpointExperiment,
  copyRawArtifact,
  createExperiment,
  deleteEvent,
  deleteFood,
  deleteProvider,
  deleteRecipe,
  ensureJournalDay,
  importAssessmentResponse,
  importDeviceBatch,
  importDocument,
  importSamples,
  initializeVault,
  linkJournalEventIds,
  linkJournalStreams,
  promoteInboxExperimentNote,
  promoteInboxJournal,
  repairVault,
  upgradeVault,
  rebuildCurrentProfile,
  stopExperiment,
  stopProtocolItem,
  unlinkJournalEventIds,
  unlinkJournalStreams,
  updateExperiment,
  updateVaultSummary,
  upsertEvent,
  upsertFood,
  upsertProvider,
  upsertAllergy,
  upsertCondition,
  upsertFamilyMember,
  upsertGeneticVariant,
  upsertGoal,
  upsertRecipe,
  upsertWorkoutFormat,
  upsertProtocolItem,
  validateVault,
} from "./public-mutations.ts";
export {
  listWorkoutFormats,
  readWorkoutFormat,
} from "./bank/workout-formats.ts";
export type {
  WorkoutFormatRecord,
} from "./bank/types.ts";
export type {
  ApplyCanonicalWriteBatchInput,
  ApplyCanonicalWriteBatchResult,
  CanonicalDeleteInput,
  CanonicalJsonlAppendInput,
  CanonicalRawContentInput,
  CanonicalRawCopyInput,
  CanonicalTextWriteInput,
} from "./public-mutations.ts";
export {
  acquireCanonicalWriteLock,
  CANONICAL_WRITE_LOCK_DIRECTORY,
  CANONICAL_WRITE_LOCK_METADATA_PATH,
  inspectCanonicalWriteLock,
  isProtectedCanonicalPath,
  listProtectedCanonicalPaths,
  listWriteOperationMetadataPaths,
  readRecoverableStoredWriteOperation,
  readStoredWriteOperation,
} from "./operations/index.ts";
export type {
  CanonicalWriteLockHandle,
  CanonicalWriteLockInspection,
  CanonicalWriteLockMetadata,
  RecoverableStoredWriteOperation,
} from "./operations/index.ts";
export type { ResolvedVaultPath } from "./path-safety.ts";
export {
  listAssessmentResponses,
  projectAssessmentResponse,
  readAssessmentResponse,
  ASSESSMENT_LEDGER_DIRECTORY,
  ASSESSMENT_RESPONSE_SCHEMA_VERSION,
} from "./assessment/index.ts";
export {
  listProfileSnapshots,
  readCurrentProfile,
} from "./profile/storage.ts";
export type {
  AllergyProposal,
  AssessmentProposalSource,
  AssessmentResponseProposal,
  AssessmentResponseRecord,
  ConditionProposal,
  FamilyMemberProposal,
  GeneticVariantProposal,
  GoalProposal,
  HistoryEventProposal,
  ImportAssessmentResponseInput,
  ProfileSnapshotProposal,
  ProtocolProposal,
} from "./assessment/index.ts";
export * from "./bank/index.ts";
export * from "./profile/index.ts";
export * from "./history/index.ts";
export * from "./family/index.ts";
export * from "./genetics/index.ts";

export * from "./shares.ts";
export {
  buildActivitySessionEventDraft,
  buildBodyMeasurementEventDraft,
  buildInterventionSessionEventDraft,
  buildMedicationIntakeEventDraft,
  buildNoteEventDraft,
  buildObservationEventDraft,
  buildPublicEventRecord,
  buildSleepSessionEventDraft,
  buildSupplementIntakeEventDraft,
  buildSymptomEventDraft,
} from "./domains/events.ts";
export type {
  AddActivitySessionInput,
  AddActivitySessionResult,
  AddBodyMeasurementInput,
  AddBodyMeasurementResult,
  EventDraftByKind,
  PublicEventDraft,
  PublicWritableEventKind,
  UpsertEventDraftInput,
  UpsertEventInput,
  UpsertEventPayloadInput,
} from "./domains/events.ts";
