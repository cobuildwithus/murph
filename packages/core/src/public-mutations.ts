import type { MetricSampleRecord } from "@murphai/contracts";
import {
  metricSampleRecordSchema,
  safeParseContract,
  VAULT_LAYOUT,
} from "@murphai/contracts";

import {
  addMeal as addMealInternal,
  dedupeDeviceEventsByExternalRef as dedupeDeviceEventsByExternalRefInternal,
  importDeviceBatch as importDeviceBatchInternal,
  importEventBatch as importEventBatchInternal,
  importDocument as importDocumentInternal,
  importSamples as importSamplesInternal,
} from "./mutations.ts";
import {
  promoteInboxExperimentNote as promoteInboxExperimentNoteInternal,
  promoteInboxJournal as promoteInboxJournalInternal,
} from "./canonical-mutations.ts";
import {
  inspectCanonicalWriteLock,
  withCanonicalWriteLock,
} from "./operations/canonical-write-lock.ts";
import {
  type CopyRawArtifactInput as RawCopyRawArtifactInput,
  prepareRawArtifact,
} from "./raw.ts";
import { importAssessmentResponse as importAssessmentResponseInternal } from "./assessment/storage.ts";
import { upsertAllergy as upsertAllergyInternal } from "./bank/allergies.ts";
import { upsertCondition as upsertConditionInternal } from "./bank/conditions.ts";
import { deleteFood as deleteFoodInternal, upsertFood as upsertFoodInternal } from "./bank/foods.ts";
import { upsertGoal as upsertGoalInternal } from "./bank/goals.ts";
import { upsertHabitatAspect as upsertHabitatAspectInternal } from "./bank/habitat.ts";
import { deleteProvider as deleteProviderInternal, upsertProvider as upsertProviderInternal } from "./bank/providers.ts";
import { deleteRecipe as deleteRecipeInternal, upsertRecipe as upsertRecipeInternal } from "./bank/recipes.ts";
import { upsertWorkoutFormat as upsertWorkoutFormatInternal } from "./bank/workout-formats.ts";
import {
  stopRegimen as stopRegimenInternal,
  upsertRegimen as upsertRegimenInternal,
} from "./bank/regimens.ts";
import { upsertProtocol as upsertProtocolInternal } from "./protocols.ts";
import { upsertFamilyMember as upsertFamilyMemberInternal } from "./family/api.ts";
import { upsertGeneticVariant as upsertGeneticVariantInternal } from "./genetics/api.ts";
import {
  appendBloodTest as appendBloodTestInternal,
  appendHistoryEvent as appendHistoryEventInternal,
  appendImmunization as appendImmunizationInternal,
  saveEncounterBundle as saveEncounterBundleInternal,
} from "./history/api.ts";
import {
  checkpointExperiment as checkpointExperimentInternal,
  createExperiment as createExperimentInternal,
  stopExperiment as stopExperimentInternal,
  updateExperiment as updateExperimentInternal,
  writeExperimentOutcome as writeExperimentOutcomeInternal,
} from "./domains/experiments.ts";
import {
  appendJournal as appendJournalInternal,
  ensureJournalDay as ensureJournalDayInternal,
  linkJournalEventIds as linkJournalEventIdsInternal,
  linkJournalStreams as linkJournalStreamsInternal,
  unlinkJournalEventIds as unlinkJournalEventIdsInternal,
  unlinkJournalStreams as unlinkJournalStreamsInternal,
} from "./domains/journal.ts";
import {
  addActivitySession as addActivitySessionInternal,
  addBodyMeasurement as addBodyMeasurementInternal,
  addCapture as addCaptureInternal,
  addCaptureWithLookup as addCaptureWithLookupInternal,
  addMeasurement as addMeasurementInternal,
  deleteEvent as deleteEventInternal,
  removeAutomaticMealPhoto as removeAutomaticMealPhotoInternal,
  upsertEvent as upsertEventInternal,
} from "./domains/events.ts";
import { updateVaultSummary as updateVaultSummaryInternal } from "./domains/vault-summary.ts";
import {
  repairJunctionWorkoutHeartRateZones as repairJunctionWorkoutHeartRateZonesInternal,
} from "./junction-hr-zone-repair.ts";
import {
  repairExperimentMediaInternal,
} from "./experiment-media-repair.ts";
import {
  updateAssistantPreferences as updateAssistantPreferencesInternal,
  updateWearablePreferences as updateWearablePreferencesInternal,
  updateWorkoutUnitPreferences as updateWorkoutUnitPreferencesInternal,
} from "./preferences.ts";
import { commitAuditedCanonicalWrite, type CanonicalMutationAuditInput } from "./audited-write.ts";
import { VaultError } from "./errors.ts";
import {
  initializeVault as initializeVaultInternal,
  loadVault as loadVaultInternal,
  repairVault as repairVaultInternal,
  validateVault as validateVaultInternal,
} from "./vault.ts";
import { toMonthlyShardRelativePath } from "./jsonl.ts";
import { sanitizePathSegment } from "./path-safety.ts";

import type { DateInput, ValidationIssue } from "./types.ts";

export {
  deleteEventInternal as deleteEvent,
  removeAutomaticMealPhotoInternal as removeAutomaticMealPhoto,
  upsertEventInternal as upsertEvent,
};

export interface CanonicalTextWriteInput {
  relativePath: string;
  content: string;
  overwrite?: boolean;
  allowExistingMatch?: boolean;
}

export interface CanonicalJsonlAppendInput<TRecord extends object = Record<string, unknown>> {
  relativePath: string;
  record: TRecord;
}

export interface CanonicalRawCopyInput {
  targetRelativePath: string;
  sourcePath: string;
  originalFileName: string;
  mediaType: string;
  allowExistingMatch?: boolean;
}

export interface CanonicalRawContentInput {
  targetRelativePath: string;
  content: string | Uint8Array;
  originalFileName: string;
  mediaType: string;
  allowExistingMatch?: boolean;
}

export interface CanonicalDeleteInput {
  relativePath: string;
  allowRaw?: boolean;
  expectedTargetReceipt?: {
    sha256: string;
    byteLength: number;
  };
}

export interface ApplyCanonicalWriteBatchInput {
  vaultRoot: string;
  operationType: string;
  summary: string;
  occurredAt?: DateInput;
  audit: CanonicalMutationAuditInput;
  rawCopies?: CanonicalRawCopyInput[];
  rawContents?: CanonicalRawContentInput[];
  textWrites?: CanonicalTextWriteInput[];
  jsonlAppends?: CanonicalJsonlAppendInput[];
  deletes?: CanonicalDeleteInput[];
}

export interface ApplyCanonicalWriteBatchResult {
  rawCopies: string[];
  rawContents: string[];
  textWrites: string[];
  jsonlAppends: string[];
  deletes: string[];
}

function withCanonicalInputWriteLock<TInput extends { vaultRoot: string }, TResult>(
  input: TInput,
  operation: (input: TInput) => Promise<TResult>,
): Promise<TResult> {
  return withCanonicalWriteLock(input.vaultRoot, () => operation(input));
}

function hasStableCanonicalId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function buildStaleCanonicalWriteLockIssue(
  issue: Awaited<ReturnType<typeof inspectCanonicalWriteLock>>,
): ValidationIssue | null {
  if (issue.state !== "stale") {
    return null;
  }

  const detail = issue.metadata
    ? ` pid=${issue.metadata.pid} startedAt=${issue.metadata.startedAt} command=${issue.metadata.command}.`
    : "";

  return {
    code: "CANONICAL_WRITE_LOCK_STALE",
    message: `Canonical write lock is stale: ${issue.reason}.${detail}`,
    path: issue.relativePath,
    severity: "error",
  };
}

export async function initializeVault(
  input: Parameters<typeof initializeVaultInternal>[0],
): ReturnType<typeof initializeVaultInternal> {
  const normalizedInput = input ?? {};
  return withCanonicalWriteLock(normalizedInput.vaultRoot, () => initializeVaultInternal(normalizedInput));
}

export async function validateVault(
  input: Parameters<typeof validateVaultInternal>[0],
): ReturnType<typeof validateVaultInternal> {
  const normalizedInput = input ?? {};
  const result = await validateVaultInternal(normalizedInput);
  const inspection = await inspectCanonicalWriteLock(normalizedInput.vaultRoot ?? process.cwd());
  const issue = buildStaleCanonicalWriteLockIssue(inspection);

  if (!issue) {
    return result;
  }

  return {
    ...result,
    valid: false,
    issues: [...result.issues, issue],
  };
}

export async function appendJsonlRecord<TRecord extends Record<string, unknown>>(input: {
  vaultRoot: string;
  relativePath: string;
  record: TRecord;
}): Promise<TRecord> {
  if (!input.record || typeof input.record !== "object" || Array.isArray(input.record)) {
    throw new VaultError("VAULT_INVALID_RECORD", "JSONL records must be plain objects.", {
      relativePath: input.relativePath,
    });
  }

  await applyCanonicalWriteBatch({
    vaultRoot: input.vaultRoot,
    operationType: "jsonl_append",
    summary: `Append JSONL record to ${input.relativePath}`,
    audit: {
      action: "jsonl_append",
      commandName: "core.appendJsonlRecord",
      summary: `Appended JSONL record to ${input.relativePath}.`,
    },
    jsonlAppends: [
      {
        relativePath: input.relativePath,
        record: input.record,
      },
    ],
  });

  return input.record;
}

export async function appendMetricSample(input: {
  vaultRoot: string;
  record: MetricSampleRecord;
}): Promise<MetricSampleRecord> {
  const result = safeParseContract(metricSampleRecordSchema, input.record);
  if (!result.success) {
    throw new VaultError("SAMPLE_INVALID", `Metric sample failed contract validation. ${JSON.stringify(result.errors)}`, {
      errors: result.errors,
    });
  }

  const metricSegment = sanitizePathSegment(input.record.metric, "metric sample metric");
  const relativePath = toMonthlyShardRelativePath(
    `${VAULT_LAYOUT.metricSampleLedgerDirectory}/${metricSegment}`,
    input.record.recordedAt,
    "recordedAt",
  );

  return appendJsonlRecord({
    vaultRoot: input.vaultRoot,
    relativePath,
    record: input.record,
  });
}

export async function appendMetricSamples(input: {
  vaultRoot: string;
  records: readonly MetricSampleRecord[];
}): Promise<MetricSampleRecord[]> {
  const output: MetricSampleRecord[] = [];
  for (const record of input.records) output.push(await appendMetricSample({ vaultRoot: input.vaultRoot, record }));
  return output;
}

export async function applyCanonicalWriteBatch(
  input: ApplyCanonicalWriteBatchInput,
): Promise<ApplyCanonicalWriteBatchResult> {
  const rawCopies = input.rawCopies ?? [];
  const rawContents = input.rawContents ?? [];
  const textWrites = input.textWrites ?? [];
  const jsonlAppends = input.jsonlAppends ?? [];
  const deletes = input.deletes ?? [];

  if (
    rawCopies.length === 0 &&
    rawContents.length === 0 &&
    textWrites.length === 0 &&
    jsonlAppends.length === 0 &&
    deletes.length === 0
  ) {
    throw new VaultError(
      "CANONICAL_WRITE_EMPTY",
      "Canonical write batch requires at least one staged action.",
    );
  }

  await loadVaultInternal({ vaultRoot: input.vaultRoot });

  const result = await commitAuditedCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: input.operationType,
    summary: input.summary,
    occurredAt: input.occurredAt,
    audit: input.audit,
    mutate: async ({ batch }) => {
      for (const rawCopy of rawCopies) {
        await batch.stageRawCopy({
          sourcePath: rawCopy.sourcePath,
          targetRelativePath: rawCopy.targetRelativePath,
          originalFileName: rawCopy.originalFileName,
          mediaType: rawCopy.mediaType,
          allowExistingMatch: rawCopy.allowExistingMatch,
        });
      }

      for (const rawContent of rawContents) {
        if (typeof rawContent.content === "string") {
          await batch.stageRawText({
            targetRelativePath: rawContent.targetRelativePath,
            originalFileName: rawContent.originalFileName,
            mediaType: rawContent.mediaType,
            content: rawContent.content,
            allowExistingMatch: rawContent.allowExistingMatch,
          });
          continue;
        }

        await batch.stageRawBytes({
          targetRelativePath: rawContent.targetRelativePath,
          originalFileName: rawContent.originalFileName,
          mediaType: rawContent.mediaType,
          content: rawContent.content,
          allowExistingMatch: rawContent.allowExistingMatch,
        });
      }

      for (const textWrite of textWrites) {
        await batch.stageTextWrite(textWrite.relativePath, textWrite.content, {
          overwrite: textWrite.overwrite,
          allowExistingMatch: textWrite.allowExistingMatch,
        });
      }

      for (const jsonlAppend of jsonlAppends) {
        await batch.stageJsonlAppend(
          jsonlAppend.relativePath,
          `${JSON.stringify(jsonlAppend.record)}\n`,
        );
      }

      for (const deletion of deletes) {
        await batch.stageDelete(deletion.relativePath, {
          allowRaw: deletion.allowRaw,
          expectedTargetReceipt: deletion.expectedTargetReceipt,
        });
      }

      const changes = [
        ...rawCopies.map((entry) => ({
          path: entry.targetRelativePath,
          op: "copy" as const,
        })),
        ...rawContents.map((entry) => ({
          path: entry.targetRelativePath,
          op: "create" as const,
        })),
        ...textWrites.map((entry) => ({
          path: entry.relativePath,
          op: entry.overwrite ? "update" as const : "create" as const,
        })),
        ...jsonlAppends.map((entry) => ({
          path: entry.relativePath,
          op: "append" as const,
        })),
        ...deletes.map((entry) => ({
          path: entry.relativePath,
          op: "delete" as const,
        })),
      ];

      return {
        result: {
          rawCopies: rawCopies.map((entry) => entry.targetRelativePath),
          rawContents: rawContents.map((entry) => entry.targetRelativePath),
          textWrites: textWrites.map((entry) => entry.relativePath),
          jsonlAppends: jsonlAppends.map((entry) => entry.relativePath),
          deletes: deletes.map((entry) => entry.relativePath),
        },
        changes,
      };
    },
  });

  return result.result;
}

export async function copyRawArtifact(
  input: RawCopyRawArtifactInput,
): Promise<ReturnType<typeof prepareRawArtifact>> {
  const artifact = prepareRawArtifact({
    sourcePath: input.sourcePath,
    owner: input.owner,
    occurredAt: input.occurredAt,
    role: input.role,
    targetName: input.targetName,
  });
  await applyCanonicalWriteBatch({
    vaultRoot: input.vaultRoot,
    operationType: "raw_copy",
    summary: `Copy raw artifact ${artifact.relativePath}`,
    occurredAt: input.occurredAt,
    audit: {
      action: "raw_copy",
      commandName: "core.copyRawArtifact",
      summary: `Copied raw artifact ${artifact.relativePath}.`,
    },
    rawCopies: [
      {
        sourcePath: input.sourcePath,
        targetRelativePath: artifact.relativePath,
        originalFileName: artifact.originalFileName,
        mediaType: artifact.mediaType,
        allowExistingMatch: input.allowExistingMatch,
      },
    ],
  });
  return artifact;
}

export async function ensureJournalDay(
  input: Parameters<typeof ensureJournalDayInternal>[0],
): ReturnType<typeof ensureJournalDayInternal> {
  return withCanonicalInputWriteLock(input, ensureJournalDayInternal);
}

export async function appendJournal(
  input: Parameters<typeof appendJournalInternal>[0],
): ReturnType<typeof appendJournalInternal> {
  return withCanonicalInputWriteLock(input, appendJournalInternal);
}

export async function linkJournalEventIds(
  input: Parameters<typeof linkJournalEventIdsInternal>[0],
): ReturnType<typeof linkJournalEventIdsInternal> {
  return withCanonicalInputWriteLock(input, linkJournalEventIdsInternal);
}

export async function unlinkJournalEventIds(
  input: Parameters<typeof unlinkJournalEventIdsInternal>[0],
): ReturnType<typeof unlinkJournalEventIdsInternal> {
  return withCanonicalInputWriteLock(input, unlinkJournalEventIdsInternal);
}

export async function linkJournalStreams(
  input: Parameters<typeof linkJournalStreamsInternal>[0],
): ReturnType<typeof linkJournalStreamsInternal> {
  return withCanonicalInputWriteLock(input, linkJournalStreamsInternal);
}

export async function unlinkJournalStreams(
  input: Parameters<typeof unlinkJournalStreamsInternal>[0],
): ReturnType<typeof unlinkJournalStreamsInternal> {
  return withCanonicalInputWriteLock(input, unlinkJournalStreamsInternal);
}

export async function createExperiment(
  input: Parameters<typeof createExperimentInternal>[0],
): ReturnType<typeof createExperimentInternal> {
  return withCanonicalInputWriteLock(input, createExperimentInternal);
}

export async function updateExperiment(
  input: Parameters<typeof updateExperimentInternal>[0],
): ReturnType<typeof updateExperimentInternal> {
  return withCanonicalInputWriteLock(input, updateExperimentInternal);
}

export async function writeExperimentOutcome(
  input: Parameters<typeof writeExperimentOutcomeInternal>[0],
): ReturnType<typeof writeExperimentOutcomeInternal> {
  return withCanonicalInputWriteLock(input, writeExperimentOutcomeInternal);
}

export async function checkpointExperiment(
  input: Parameters<typeof checkpointExperimentInternal>[0],
): ReturnType<typeof checkpointExperimentInternal> {
  return withCanonicalInputWriteLock(input, checkpointExperimentInternal);
}

export async function stopExperiment(
  input: Parameters<typeof stopExperimentInternal>[0],
): ReturnType<typeof stopExperimentInternal> {
  return withCanonicalInputWriteLock(input, stopExperimentInternal);
}

export async function importDocument(
  input: Parameters<typeof importDocumentInternal>[0],
): ReturnType<typeof importDocumentInternal> {
  return input.reuseExact === true
    ? withCanonicalInputWriteLock(input, importDocumentInternal)
    : importDocumentInternal(input);
}

export async function addMeal(
  input: Parameters<typeof addMealInternal>[0],
): ReturnType<typeof addMealInternal> {
  return hasStableCanonicalId(input.mealId) || hasStableCanonicalId(input.eventId)
    ? withCanonicalInputWriteLock(input, addMealInternal)
    : addMealInternal(input);
}

export async function addActivitySession(
  input: Parameters<typeof addActivitySessionInternal>[0],
): ReturnType<typeof addActivitySessionInternal> {
  return hasStableCanonicalId(input.draft.id)
    ? withCanonicalInputWriteLock(input, addActivitySessionInternal)
    : addActivitySessionInternal(input);
}

export async function addBodyMeasurement(
  input: Parameters<typeof addBodyMeasurementInternal>[0],
): ReturnType<typeof addBodyMeasurementInternal> {
  return hasStableCanonicalId(input.draft.id)
    ? withCanonicalInputWriteLock(input, addBodyMeasurementInternal)
    : addBodyMeasurementInternal(input);
}

export async function addCapture(
  input: Parameters<typeof addCaptureInternal>[0],
): ReturnType<typeof addCaptureInternal> {
  return hasStableCanonicalId(input.draft.id)
    ? withCanonicalInputWriteLock(input, addCaptureInternal)
    : addCaptureInternal(input);
}

export async function addCaptureWithLookup(
  input: Parameters<typeof addCaptureWithLookupInternal>[0],
): ReturnType<typeof addCaptureWithLookupInternal> {
  return withCanonicalInputWriteLock(input, addCaptureWithLookupInternal);
}

export async function addMeasurement(
  input: Parameters<typeof addMeasurementInternal>[0],
): ReturnType<typeof addMeasurementInternal> {
  return hasStableCanonicalId(input.draft.id)
    ? withCanonicalInputWriteLock(input, addMeasurementInternal)
    : addMeasurementInternal(input);
}

export async function importSamples(
  input: Parameters<typeof importSamplesInternal>[0],
): ReturnType<typeof importSamplesInternal> {
  return withCanonicalInputWriteLock(input, importSamplesInternal);
}

export async function upsertProvider(
  input: Parameters<typeof upsertProviderInternal>[0],
): ReturnType<typeof upsertProviderInternal> {
  return withCanonicalInputWriteLock(input, upsertProviderInternal);
}

export async function upsertHabitatAspect(
  input: Parameters<typeof upsertHabitatAspectInternal>[0],
): ReturnType<typeof upsertHabitatAspectInternal> {
  return withCanonicalInputWriteLock(input, upsertHabitatAspectInternal);
}

export async function deleteProvider(
  input: Parameters<typeof deleteProviderInternal>[0],
): ReturnType<typeof deleteProviderInternal> {
  return withCanonicalInputWriteLock(input, deleteProviderInternal);
}

export async function updateVaultSummary(
  input: Parameters<typeof updateVaultSummaryInternal>[0],
): ReturnType<typeof updateVaultSummaryInternal> {
  return updateVaultSummaryInternal(input);
}

export async function repairVault(
  input: Parameters<typeof repairVaultInternal>[0] = {},
): ReturnType<typeof repairVaultInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => repairVaultInternal(input));
}

export async function repairJunctionWorkoutHeartRateZones(
  input: Parameters<typeof repairJunctionWorkoutHeartRateZonesInternal>[0],
): ReturnType<typeof repairJunctionWorkoutHeartRateZonesInternal> {
  return withCanonicalInputWriteLock(input, repairJunctionWorkoutHeartRateZonesInternal);
}

export async function repairExperimentMedia(
  input: Parameters<typeof repairExperimentMediaInternal>[0],
): ReturnType<typeof repairExperimentMediaInternal> {
  return withCanonicalInputWriteLock(input, repairExperimentMediaInternal);
}

export async function promoteInboxJournal(
  input: Parameters<typeof promoteInboxJournalInternal>[0],
): ReturnType<typeof promoteInboxJournalInternal> {
  return withCanonicalInputWriteLock(input, promoteInboxJournalInternal);
}

export async function promoteInboxExperimentNote(
  input: Parameters<typeof promoteInboxExperimentNoteInternal>[0],
): ReturnType<typeof promoteInboxExperimentNoteInternal> {
  return withCanonicalInputWriteLock(input, promoteInboxExperimentNoteInternal);
}

export async function importDeviceBatch(
  input: Parameters<typeof importDeviceBatchInternal>[0],
): ReturnType<typeof importDeviceBatchInternal> {
  return withCanonicalInputWriteLock(input, importDeviceBatchInternal);
}

export async function dedupeDeviceEventsByExternalRef(
  input: Parameters<typeof dedupeDeviceEventsByExternalRefInternal>[0],
): ReturnType<typeof dedupeDeviceEventsByExternalRefInternal> {
  return withCanonicalInputWriteLock(input, dedupeDeviceEventsByExternalRefInternal);
}

export async function importEventBatch(
  input: Parameters<typeof importEventBatchInternal>[0],
): ReturnType<typeof importEventBatchInternal> {
  return withCanonicalInputWriteLock(input, importEventBatchInternal);
}

export async function importAssessmentResponse(
  input: Parameters<typeof importAssessmentResponseInternal>[0],
): ReturnType<typeof importAssessmentResponseInternal> {
  return importAssessmentResponseInternal(input);
}

export async function updateWorkoutUnitPreferences(
  input: Parameters<typeof updateWorkoutUnitPreferencesInternal>[0],
): ReturnType<typeof updateWorkoutUnitPreferencesInternal> {
  return updateWorkoutUnitPreferencesInternal(input);
}

export async function updateWearablePreferences(
  input: Parameters<typeof updateWearablePreferencesInternal>[0],
): ReturnType<typeof updateWearablePreferencesInternal> {
  return updateWearablePreferencesInternal(input);
}

export async function updateAssistantPreferences(
  input: Parameters<typeof updateAssistantPreferencesInternal>[0],
): ReturnType<typeof updateAssistantPreferencesInternal> {
  return updateAssistantPreferencesInternal(input);
}

export async function appendHistoryEvent(
  input: Parameters<typeof appendHistoryEventInternal>[0],
): ReturnType<typeof appendHistoryEventInternal> {
  return hasStableCanonicalId(input.eventId)
    ? withCanonicalInputWriteLock(input, appendHistoryEventInternal)
    : appendHistoryEventInternal(input);
}

export async function appendBloodTest(
  input: Parameters<typeof appendBloodTestInternal>[0],
): ReturnType<typeof appendBloodTestInternal> {
  return hasStableCanonicalId(input.eventId)
    ? withCanonicalInputWriteLock(input, appendBloodTestInternal)
    : appendBloodTestInternal(input);
}

export async function appendImmunization(
  input: Parameters<typeof appendImmunizationInternal>[0],
): ReturnType<typeof appendImmunizationInternal> {
  return hasStableCanonicalId(input.eventId)
    ? withCanonicalInputWriteLock(input, appendImmunizationInternal)
    : appendImmunizationInternal(input);
}

export async function saveEncounterBundle(
  input: Parameters<typeof saveEncounterBundleInternal>[0],
): ReturnType<typeof saveEncounterBundleInternal> {
  return withCanonicalInputWriteLock(input, saveEncounterBundleInternal);
}

export async function upsertFamilyMember(
  input: Parameters<typeof upsertFamilyMemberInternal>[0],
): ReturnType<typeof upsertFamilyMemberInternal> {
  return withCanonicalInputWriteLock(input, upsertFamilyMemberInternal);
}

export async function upsertGeneticVariant(
  input: Parameters<typeof upsertGeneticVariantInternal>[0],
): ReturnType<typeof upsertGeneticVariantInternal> {
  return withCanonicalInputWriteLock(input, upsertGeneticVariantInternal);
}

export async function upsertAllergy(
  input: Parameters<typeof upsertAllergyInternal>[0],
): ReturnType<typeof upsertAllergyInternal> {
  return withCanonicalInputWriteLock(input, upsertAllergyInternal);
}

export async function upsertCondition(
  input: Parameters<typeof upsertConditionInternal>[0],
): ReturnType<typeof upsertConditionInternal> {
  return withCanonicalInputWriteLock(input, upsertConditionInternal);
}

export async function upsertGoal(
  input: Parameters<typeof upsertGoalInternal>[0],
): ReturnType<typeof upsertGoalInternal> {
  return withCanonicalInputWriteLock(input, upsertGoalInternal);
}

export async function upsertRecipe(
  input: Parameters<typeof upsertRecipeInternal>[0],
): ReturnType<typeof upsertRecipeInternal> {
  return withCanonicalInputWriteLock(input, upsertRecipeInternal);
}

export async function deleteRecipe(
  input: Parameters<typeof deleteRecipeInternal>[0],
): ReturnType<typeof deleteRecipeInternal> {
  return withCanonicalInputWriteLock(input, deleteRecipeInternal);
}

export async function upsertFood(
  input: Parameters<typeof upsertFoodInternal>[0],
): ReturnType<typeof upsertFoodInternal> {
  return withCanonicalInputWriteLock(input, upsertFoodInternal);
}

export async function deleteFood(
  input: Parameters<typeof deleteFoodInternal>[0],
): ReturnType<typeof deleteFoodInternal> {
  return withCanonicalInputWriteLock(input, deleteFoodInternal);
}

export async function upsertWorkoutFormat(
  input: Parameters<typeof upsertWorkoutFormatInternal>[0],
): ReturnType<typeof upsertWorkoutFormatInternal> {
  return withCanonicalInputWriteLock(input, upsertWorkoutFormatInternal);
}

export async function upsertRegimen(
  input: Parameters<typeof upsertRegimenInternal>[0],
): ReturnType<typeof upsertRegimenInternal> {
  return withCanonicalInputWriteLock(input, upsertRegimenInternal);
}

export async function stopRegimen(
  input: Parameters<typeof stopRegimenInternal>[0],
): ReturnType<typeof stopRegimenInternal> {
  return withCanonicalInputWriteLock(input, stopRegimenInternal);
}

export async function upsertProtocol(
  input: Parameters<typeof upsertProtocolInternal>[0],
): ReturnType<typeof upsertProtocolInternal> {
  return withCanonicalInputWriteLock(input, upsertProtocolInternal);
}
