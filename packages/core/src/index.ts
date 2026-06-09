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
export { deterministicContractId } from "./ids.ts";
export * from "./automation.ts";
export * from "./scheduled-logs.ts";
export * from "./memory.ts";
export {
  readPreferencesDocument,
  resolvePreferencesDocumentPath,
} from "./preferences.ts";
export type { PreferencesDocumentSnapshot } from "./preferences.ts";
export {
  assertPathWithinVault,
  assertPathWithinVaultOnDisk,
  normalizeOpaquePathSegment,
  normalizeRelativeVaultPath,
  normalizeVaultRoot,
  resolveVaultPath,
  resolveVaultPathOnDisk,
} from "./path-safety.ts";
export { walkVaultFiles, walkVaultFilesInterruptible } from "./fs.ts";
export {
  hashWearableRawPayload,
  stableStringifyWearableRawPayload,
} from "./wearable-raw-payload-hash.ts";
export type {
  WearableRawPayloadJsonValue,
} from "./wearable-raw-payload-hash.ts";
export {
  LEGACY_WEARABLE_RAW_ENVELOPE_ROLE_PREFIX,
  compactLegacyWearableReceiptEnvelopes,
  detectLegacyWearableReceiptCompaction,
} from "./wearable-receipts.ts";
export type {
  CompactLegacyWearableReceiptEnvelopesInput,
  CompactLegacyWearableReceiptEnvelopesResult,
  DetectLegacyWearableReceiptCompactionInput,
  LegacyWearableReceiptCompactionDetection,
} from "./wearable-receipts.ts";
export {
  detectWearableStorageMigrationCandidates,
  pruneWearableDenseRawTimeseries,
  runWearableStorageMigrationPass,
} from "./wearable-storage-migration.ts";
export type {
  DetectWearableStorageMigrationCandidatesInput,
  PruneWearableDenseRawTimeseriesInput,
  RunWearableStorageMigrationPassInput,
  WearableStorageMigrationDetection,
  WearableStorageMigrationResult,
} from "./wearable-storage-migration.ts";

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
  addCapture,
  addMeasurement,
  addMeal,
  applyCanonicalWriteBatch,
  appendBloodTest,
  appendJournal,
  appendHistoryEvent,
  appendJsonlRecord,
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
  stopExperiment,
  stopRegimen,
  unlinkJournalEventIds,
  unlinkJournalStreams,
  updateWorkoutUnitPreferences,
  updateWearablePreferences,
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
  upsertProtocol,
  upsertRegimen,
  upsertRecipe,
  upsertWorkoutFormat,
  validateVault,
} from "./public-mutations.ts";
export {
  listWorkoutFormats,
  readWorkoutFormat,
} from "./bank/workout-formats.ts";
export type {
  WorkoutFormatRecord,
} from "./bank/types.ts";
export {
  listRegimens,
  readRegimen,
} from "./bank/regimens.ts";
export {
  listProtocols,
  readProtocol,
  PROTOCOL_DOC_TYPE,
  PROTOCOL_ID_PREFIX,
  PROTOCOL_SCHEMA_VERSION,
  PROTOCOLS_DIRECTORY,
} from "./protocols.ts";
export type {
  ProtocolDocument,
  ProtocolFrontmatter,
  ProtocolRecord,
  ReadProtocolInput,
  UpsertProtocolInput,
  UpsertProtocolResult,
} from "./protocols.ts";
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
  acquireCanonicalResourceLock,
  CANONICAL_RESOURCE_LOCK_DIRECTORY,
  CANONICAL_RESOURCE_LOCK_METADATA_BASENAME,
  canonicalLogicalResource,
  canonicalPathResource,
  dedupeCanonicalResources,
  withCanonicalResourceLocks,
  acquireCanonicalWriteLock,
  CANONICAL_WRITE_LOCK_DIRECTORY,
  CANONICAL_WRITE_LOCK_METADATA_PATH,
  HOSTED_CANONICAL_WRITE_RECEIPT_DIRECTORY_ENV,
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  inspectCanonicalWriteLock,
  withCanonicalWriteLockScope,
  applyHostedCanonicalWriteReceipt,
  isProtectedCanonicalPath,
  listProtectedCanonicalPaths,
  listWriteOperationMetadataPaths,
  readRecoverableStoredWriteOperation,
  readStoredWriteOperation,
  resolveHostedCanonicalWritePayloadFilePath,
  runCanonicalWrite,
  withHostedCanonicalWritePort,
} from "./operations/index.ts";
export type {
  CanonicalMutationResource,
  CanonicalResourceLockHandle,
  CanonicalResourceLockMetadata,
  CanonicalWriteLockHandle,
  CanonicalWriteLockInspection,
  CanonicalWriteLockMetadata,
  HostedCanonicalWritePayload,
  HostedCanonicalWritePort,
  HostedCanonicalWritePersistenceInput,
  HostedCanonicalWriteReceipt,
  HostedCanonicalWriteReceiptAction,
  HostedCanonicalWriteReceiptContentRef,
  RecoverableStoredWriteOperation,
} from "./operations/index.ts";
export {
  buildRawImportManifest,
  parseRawImportManifest,
  resolveRawManifestPath,
} from "./operations/raw-manifests.ts";
export {
  inferRawAssetOwnerFromDirectory,
  prepareInlineRawArtifact,
  prepareRawArtifact,
  rawDirectoryMatchesOwner,
  resolveRawAssetDirectory,
} from "./raw.ts";
export type { ResolvedVaultPath } from "./path-safety.ts";
export {
  listAssessmentResponses,
  projectAssessmentResponse,
  readAssessmentResponse,
  ASSESSMENT_LEDGER_DIRECTORY,
  ASSESSMENT_RESPONSE_SCHEMA_VERSION,
} from "./assessment/index.ts";
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
  ProtocolProposal,
} from "./assessment/index.ts";
export * from "./bank/index.ts";
export * from "./history/index.ts";
export * from "./family/index.ts";
export * from "./genetics/index.ts";

export {
  buildActivitySessionEventDraft,
  buildBodyMeasurementEventDraft,
  buildExperimentContextEventDraft,
  buildMeasurementEventDraft,
  buildInterventionSessionEventDraft,
  buildMedicationIntakeEventDraft,
  buildNoteEventDraft,
  buildObservationEventDraft,
  buildPublicEventRecord,
  findEventByExternalRef,
  buildSleepSessionEventDraft,
  buildSupplementIntakeEventDraft,
  buildSymptomEventDraft,
} from "./domains/events.ts";
export type {
  AddActivitySessionInput,
  AddActivitySessionResult,
  AddBodyMeasurementInput,
  AddBodyMeasurementResult,
  AddCaptureInput,
  AddCaptureResult,
  AddMeasurementInput,
  AddMeasurementResult,
  EventDraftByKind,
  FindEventByExternalRefInput,
  PublicEventDraft,
  PublicWritableEventKind,
  UpsertEventDraftInput,
  UpsertEventInput,
  UpsertEventPayloadInput,
} from "./domains/events.ts";
