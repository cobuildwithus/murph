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
export {
  reconcileAutomationSupportSeries,
  reconcileAutomationSupportSeriesNamespace,
} from "./automation.ts";
export * from "./automation.ts";
export * from "./automation-availability.ts";
export * from "./scheduled-logs.ts";
export * from "./memory.ts";
export {
  readPreferencesDocument,
  resolvePreferencesDocumentPath,
} from "./preferences.ts";
export type {
  AssistantPersonalityPreferencesUpdate,
  AssistantPreferencesUpdate,
  PreferencesDocumentSnapshot,
} from "./preferences.ts";
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
  safeStatAndHashVaultFile,
  statAndHashVaultFile,
  statAndHashVaultFileInterruptible,
} from "./raw-artifact-integrity.ts";
export type { RawArtifactIntegrity } from "./raw-artifact-integrity.ts";
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
export type {
  JunctionWorkoutHeartRateZoneRepairResult,
  RepairJunctionWorkoutHeartRateZonesInput,
} from "./junction-hr-zone-repair.ts";

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
  readCanonicalEventAvailabilityInterruptible,
} from "./history/api.ts";
export type {
  CanonicalEventAvailabilitySummary,
  ReadCanonicalEventAvailabilityInput,
} from "./history/api.ts";
export {
  MAX_EXPERIMENT_LIFECYCLE_DOCUMENTS,
  readReferencedExperimentOutcome,
  readExperimentLifecycleFrontmatterDocuments,
  shouldAdvanceReferencedExperimentOutcome,
} from "./domains/experiments.ts";
export type {
  ReadReferencedExperimentOutcomeInput,
  ReadExperimentLifecycleFrontmatterResult,
} from "./domains/experiments.ts";
export {
  addActivitySession,
  addBodyMeasurement,
  addCapture,
  addCaptureWithLookup,
  addMeasurement,
  addMeal,
  appendImmunization,
  applyCanonicalWriteBatch,
  appendBloodTest,
  appendJournal,
  appendHistoryEvent,
  appendJsonlRecord,
  checkpointExperiment,
  copyRawArtifact,
  createExperiment,
  dedupeDeviceEventsByExternalRef,
  deleteEvent,
  deleteFood,
  deleteProvider,
  deleteRecipe,
  ensureJournalDay,
  importAssessmentResponse,
  importDeviceBatch,
  importDocument,
  importEventBatch,
  importSamples,
  initializeVault,
  linkJournalEventIds,
  linkJournalStreams,
  promoteInboxExperimentNote,
  promoteInboxJournal,
  removeAutomaticMealPhoto,
  repairJunctionWorkoutHeartRateZones,
  repairExperimentMedia,
  repairVault,
  saveEncounterBundle,
  stopExperiment,
  stopRegimen,
  unlinkJournalEventIds,
  unlinkJournalStreams,
  updateAssistantPreferences,
  updateWorkoutUnitPreferences,
  updateWearablePreferences,
  updateExperiment,
  writeExperimentOutcome,
  updateVaultSummary,
  upsertEvent,
  upsertFood,
  upsertProvider,
  upsertAllergy,
  upsertCondition,
  upsertFamilyMember,
  upsertGeneticVariant,
  upsertGoal,
  upsertHabitatAspect,
  upsertProtocol,
  upsertRegimen,
  upsertRecipe,
  upsertWorkoutFormat,
  validateVault,
} from "./public-mutations.ts";
export type {
  ExperimentMediaRepairBlocker,
  RepairExperimentMediaInput,
  RepairExperimentMediaResult,
} from "./experiment-media-repair.ts";
export {
  listHabitatAspects,
  readHabitatAspect,
} from "./bank/habitat.ts";
export type {
  HabitatRecord,
  UpsertHabitatAspectInput,
  UpsertHabitatAspectResult,
} from "./bank/habitat.ts";
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
  withCanonicalWriteLock,
  inspectCanonicalWriteLock,
  withCanonicalWriteLockScope,
  applyHostedCanonicalWriteReceipt,
  isProtectedCanonicalPath,
  listProtectedCanonicalPaths,
  listWriteOperationMetadataPaths,
  listWriteOperationMetadataPathsWithStageDirectories,
  pruneTerminalWriteOperationRecords,
  readRecoverableStoredWriteOperation,
  readStoredWriteOperation,
  readStoredWriteOperationJsonlAppendPayload,
  resolveHostedCanonicalWritePayloadFilePath,
  runCanonicalWrite,
  withHostedCanonicalWritePort,
  readHostedCanonicalWritePort,
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
  PruneTerminalWriteOperationRecordsInput,
  PruneTerminalWriteOperationRecordsResult,
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
  buildClinicalAssertionEventDraft,
  buildExperimentContextEventDraft,
  buildMeasurementEventDraft,
  buildInterventionSessionEventDraft,
  buildMedicationIntakeEventDraft,
  buildNoteEventDraft,
  buildObservationEventDraft,
  buildPublicEventRecord,
  CAPTURE_LOOKUP_INDEX_PATH,
  GENERATED_IMAGE_CAPTURE_RETENTION_DAYS,
  GENERATED_IMAGE_CAPTURE_RETENTION_WINDOW_MS,
  GENERATED_IMAGE_CAPTURE_PROVENANCE_SCHEMA,
  GENERATED_IMAGE_CAPTURE_SOURCE,
  GENERATED_IMAGE_CAPTURE_TAGS,
  findCaptureByLookup,
  findEventByExternalRef,
  readStoredCaptureLookupIndex,
  runGeneratedImageCaptureRetention,
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
  AddCaptureWithLookupInput,
  AddCaptureWithLookupResult,
  AddMeasurementInput,
  AddMeasurementResult,
  EventDraftByKind,
  FindCaptureByLookupResult,
  FindEventByExternalRefInput,
  PublicEventDraft,
  PublicWritableEventKind,
  RemoveAutomaticMealPhotoInput,
  RemoveAutomaticMealPhotoResult,
  RunGeneratedImageCaptureRetentionInput,
  RunGeneratedImageCaptureRetentionResult,
  StoredCaptureLookup,
  StoredCaptureLookupIndex,
  UpsertEventDraftInput,
  UpsertEventInput,
  UpsertEventPayloadInput,
  UpsertEventResult,
} from "./domains/events.ts";

export {
  MAX_INTEGRATION_EVIDENCE_PART_BYTES,
  MAX_INTEGRATION_INGEST_BYTES,
  MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES,
  MAX_INTEGRATION_INGEST_PARTS,
  MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES,
  MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES,
  archiveClosedIntegrationIngestShards,
  assertIntegrationIngestRecordIntegrity,
  buildIntegrationEvidencePart,
  buildIntegrationIngestAppendPlan,
  buildIntegrationIngestRecord,
  compactIntegrationIngestReceipt,
  integrationIngestShardPath,
  listIntegrationIngestsForEvent,
  parseIntegrationIngestAppendPayload,
  readArchivedIntegrationIngestShardText,
  readIntegrationEvidencePart,
  readIntegrationIngestById,
  readIntegrationIngestEntries,
  recoverInterruptedClosedIntegrationIngestArchives,
  stableSerializeIntegrationIngest,
  stageIntegrationIngestAppendPlan,
} from "./integration-ingests.ts";
export type {
  ArchiveClosedIntegrationIngestShardsInput,
  ArchiveClosedIntegrationIngestShardsResult,
  ArchivedIntegrationIngestShardText,
  BuildIntegrationEvidencePartInput,
  BuildIntegrationIngestAppendPlanOptions,
  BuildIntegrationIngestRecordInput,
  IntegrationIngestAppendPlan,
  RecoverInterruptedClosedIntegrationIngestArchivesInput,
  RecoverInterruptedClosedIntegrationIngestArchivesResult,
  StoredIntegrationIngestEntry,
} from "./integration-ingests.ts";
export * from "./integration-ingest-migration.ts";
