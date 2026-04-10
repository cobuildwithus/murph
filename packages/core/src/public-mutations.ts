import { appendJsonlRecord as appendJsonlRecordInternal } from "./jsonl.ts";
import {
  addMeal as addMealInternal,
  importDeviceBatch as importDeviceBatchInternal,
  importDocument as importDocumentInternal,
  importSamples as importSamplesInternal,
} from "./mutations.ts";
import {
  promoteInboxExperimentNote as promoteInboxExperimentNoteInternal,
  promoteInboxJournal as promoteInboxJournalInternal,
} from "./canonical-mutations.ts";
import {
  acquireCanonicalWriteLock,
  inspectCanonicalWriteLock,
} from "./operations/canonical-write-lock.ts";
import {
  canonicalPathResource,
  dedupeCanonicalResources,
  withCanonicalResourceLocks,
} from "./operations/canonical-resource-lock.ts";
import { runCanonicalWrite } from "./operations/write-batch.ts";
import {
  copyRawArtifact as copyRawArtifactInternal,
  prepareRawArtifact,
} from "./raw.ts";
import { importAssessmentResponse as importAssessmentResponseInternal } from "./assessment/storage.ts";
import { upsertAllergy as upsertAllergyInternal } from "./bank/allergies.ts";
import { upsertCondition as upsertConditionInternal } from "./bank/conditions.ts";
import { deleteFood as deleteFoodInternal, upsertFood as upsertFoodInternal } from "./bank/foods.ts";
import { upsertGoal as upsertGoalInternal } from "./bank/goals.ts";
import { deleteProvider as deleteProviderInternal, upsertProvider as upsertProviderInternal } from "./bank/providers.ts";
import { deleteRecipe as deleteRecipeInternal, upsertRecipe as upsertRecipeInternal } from "./bank/recipes.ts";
import { upsertWorkoutFormat as upsertWorkoutFormatInternal } from "./bank/workout-formats.ts";
import {
  stopProtocolItem as stopProtocolItemInternal,
  upsertProtocolItem as upsertProtocolItemInternal,
} from "./bank/protocols.ts";
import { upsertFamilyMember as upsertFamilyMemberInternal } from "./family/api.ts";
import { upsertGeneticVariant as upsertGeneticVariantInternal } from "./genetics/api.ts";
import {
  appendBloodTest as appendBloodTestInternal,
  appendHistoryEvent as appendHistoryEventInternal,
} from "./history/api.ts";
import {
  checkpointExperiment as checkpointExperimentInternal,
  createExperiment as createExperimentInternal,
  stopExperiment as stopExperimentInternal,
  updateExperiment as updateExperimentInternal,
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
  deleteEvent as deleteEventInternal,
  upsertEvent as upsertEventInternal,
} from "./domains/events.ts";
import { updateVaultSummary as updateVaultSummaryInternal } from "./domains/vault-summary.ts";
import {
  updateWearablePreferences as updateWearablePreferencesInternal,
  updateWorkoutUnitPreferences as updateWorkoutUnitPreferencesInternal,
} from "./preferences.ts";
import { VaultError } from "./errors.ts";
import {
  initializeVault as initializeVaultInternal,
  loadVault as loadVaultInternal,
  repairVault as repairVaultInternal,
  validateVault as validateVaultInternal,
} from "./vault.ts";

import type { DateInput, ValidationIssue } from "./types.ts";

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
}

export interface ApplyCanonicalWriteBatchInput {
  vaultRoot: string;
  operationType: string;
  summary: string;
  occurredAt?: DateInput;
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

async function withCanonicalWriteLock<TResult>(
  vaultRoot: string | undefined,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  const lock = await acquireCanonicalWriteLock(vaultRoot ?? process.cwd());

  try {
    return await operation();
  } finally {
    await lock.release();
  }
}

function withCanonicalInputWriteLock<TInput extends { vaultRoot: string }, TResult>(
  input: TInput,
  operation: (input: TInput) => Promise<TResult>,
): Promise<TResult> {
  return withCanonicalWriteLock(input.vaultRoot, () => operation(input));
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

export async function appendJsonlRecord<TRecord extends object>(input: {
  vaultRoot: string;
  relativePath: string;
  record: TRecord;
}): Promise<TRecord> {
  return withCanonicalResourceLocks({
    vaultRoot: input.vaultRoot,
    resources: [canonicalPathResource(input.relativePath)],
    run: async () => appendJsonlRecordInternal(input),
  });
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

  const resources = dedupeCanonicalResources([
    ...rawCopies.map((entry) => canonicalPathResource(entry.targetRelativePath)),
    ...rawContents.map((entry) => canonicalPathResource(entry.targetRelativePath)),
    ...textWrites.map((entry) => canonicalPathResource(entry.relativePath)),
    ...jsonlAppends.map((entry) => canonicalPathResource(entry.relativePath)),
    ...deletes.map((entry) => canonicalPathResource(entry.relativePath)),
  ]);

  return withCanonicalResourceLocks({
    vaultRoot: input.vaultRoot,
    resources,
    run: async () => {
      await loadVaultInternal({ vaultRoot: input.vaultRoot });

      return runCanonicalWrite({
        vaultRoot: input.vaultRoot,
        operationType: input.operationType,
        summary: input.summary,
        occurredAt: input.occurredAt,
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
            await batch.stageDelete(deletion.relativePath);
          }

          return {
            rawCopies: rawCopies.map((entry) => entry.targetRelativePath),
            rawContents: rawContents.map((entry) => entry.targetRelativePath),
            textWrites: textWrites.map((entry) => entry.relativePath),
            jsonlAppends: jsonlAppends.map((entry) => entry.relativePath),
            deletes: deletes.map((entry) => entry.relativePath),
          };
        },
      });
    },
  });
}

export async function copyRawArtifact(
  input: Parameters<typeof copyRawArtifactInternal>[0],
): ReturnType<typeof copyRawArtifactInternal> {
  return withCanonicalResourceLocks({
    vaultRoot: input.vaultRoot,
    resources: dedupeCanonicalResources([
      prepareRawArtifact({
        sourcePath: input.sourcePath,
        owner: input.owner,
        occurredAt: input.occurredAt,
        role: input.role,
        targetName: input.targetName,
      }).relativePath,
    ].map((relativePath) => canonicalPathResource(relativePath))),
    run: async () => await copyRawArtifactInternal(input),
  });
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
  return withCanonicalInputWriteLock(input, importDocumentInternal);
}

export async function addMeal(
  input: Parameters<typeof addMealInternal>[0],
): ReturnType<typeof addMealInternal> {
  return withCanonicalInputWriteLock(input, addMealInternal);
}

export async function addActivitySession(
  input: Parameters<typeof addActivitySessionInternal>[0],
): ReturnType<typeof addActivitySessionInternal> {
  return withCanonicalInputWriteLock(input, addActivitySessionInternal);
}

export async function addBodyMeasurement(
  input: Parameters<typeof addBodyMeasurementInternal>[0],
): ReturnType<typeof addBodyMeasurementInternal> {
  return withCanonicalInputWriteLock(input, addBodyMeasurementInternal);
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

export async function deleteProvider(
  input: Parameters<typeof deleteProviderInternal>[0],
): ReturnType<typeof deleteProviderInternal> {
  return withCanonicalInputWriteLock(input, deleteProviderInternal);
}

export async function upsertEvent(
  input: Parameters<typeof upsertEventInternal>[0],
): ReturnType<typeof upsertEventInternal> {
  return withCanonicalInputWriteLock(input, upsertEventInternal);
}

export async function deleteEvent(
  input: Parameters<typeof deleteEventInternal>[0],
): ReturnType<typeof deleteEventInternal> {
  return withCanonicalInputWriteLock(input, deleteEventInternal);
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

export async function importAssessmentResponse(
  input: Parameters<typeof importAssessmentResponseInternal>[0],
): ReturnType<typeof importAssessmentResponseInternal> {
  return withCanonicalInputWriteLock(input, importAssessmentResponseInternal);
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

export async function appendHistoryEvent(
  input: Parameters<typeof appendHistoryEventInternal>[0],
): ReturnType<typeof appendHistoryEventInternal> {
  return withCanonicalInputWriteLock(input, appendHistoryEventInternal);
}

export async function appendBloodTest(
  input: Parameters<typeof appendBloodTestInternal>[0],
): ReturnType<typeof appendBloodTestInternal> {
  return withCanonicalInputWriteLock(input, appendBloodTestInternal);
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

export async function upsertProtocolItem(
  input: Parameters<typeof upsertProtocolItemInternal>[0],
): ReturnType<typeof upsertProtocolItemInternal> {
  return withCanonicalInputWriteLock(input, upsertProtocolItemInternal);
}

export async function stopProtocolItem(
  input: Parameters<typeof stopProtocolItemInternal>[0],
): ReturnType<typeof stopProtocolItemInternal> {
  return withCanonicalInputWriteLock(input, stopProtocolItemInternal);
}
