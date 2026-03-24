import { appendJsonlRecord as appendJsonlRecordInternal } from "./jsonl.js";
import {
  addMeal as addMealInternal,
  importDeviceBatch as importDeviceBatchInternal,
  importDocument as importDocumentInternal,
  importSamples as importSamplesInternal,
} from "./mutations.js";
import {
  promoteInboxExperimentNote as promoteInboxExperimentNoteInternal,
  promoteInboxJournal as promoteInboxJournalInternal,
} from "./canonical-mutations.js";
import {
  acquireCanonicalWriteLock,
  inspectCanonicalWriteLock,
} from "./operations/canonical-write-lock.js";
import { runCanonicalWrite } from "./operations/write-batch.js";
import { copyRawArtifact as copyRawArtifactInternal } from "./raw.js";
import { importAssessmentResponse as importAssessmentResponseInternal } from "./assessment/storage.js";
import { upsertAllergy as upsertAllergyInternal } from "./bank/allergies.js";
import { upsertCondition as upsertConditionInternal } from "./bank/conditions.js";
import { upsertGoal as upsertGoalInternal } from "./bank/goals.js";
import { upsertProvider as upsertProviderInternal } from "./bank/providers.js";
import { upsertRecipe as upsertRecipeInternal } from "./bank/recipes.js";
import {
  stopRegimenItem as stopRegimenItemInternal,
  upsertRegimenItem as upsertRegimenItemInternal,
} from "./bank/regimens.js";
import { upsertFamilyMember as upsertFamilyMemberInternal } from "./family/api.js";
import { upsertGeneticVariant as upsertGeneticVariantInternal } from "./genetics/api.js";
import {
  appendBloodTest as appendBloodTestInternal,
  appendHistoryEvent as appendHistoryEventInternal,
} from "./history/api.js";
import {
  checkpointExperiment as checkpointExperimentInternal,
  createExperiment as createExperimentViaLegacyMutationsInternal,
  stopExperiment as stopExperimentViaCanonicalMutationsInternal,
  updateExperiment as updateExperimentViaCanonicalMutationsInternal,
} from "./domains/experiments.js";
import {
  appendJournal as appendJournalInternal,
  ensureJournalDay as ensureJournalDayInternal,
  linkJournalEventIds as linkJournalEventIdsInternal,
  linkJournalStreams as linkJournalStreamsInternal,
  unlinkJournalEventIds as unlinkJournalEventIdsInternal,
  unlinkJournalStreams as unlinkJournalStreamsInternal,
} from "./domains/journal.js";
import { upsertEvent as upsertEventInternal } from "./domains/events.js";
import { updateVaultSummary as updateVaultSummaryInternal } from "./domains/vault-summary.js";
import {
  appendProfileSnapshot as appendProfileSnapshotInternal,
  rebuildCurrentProfile as rebuildCurrentProfileInternal,
} from "./profile/storage.js";
import { VaultError } from "./errors.js";
import {
  initializeVault as initializeVaultInternal,
  loadVault as loadVaultInternal,
  validateVault as validateVaultInternal,
} from "./vault.js";

import type { DateInput, ValidationIssue } from "./types.js";

interface CanonicalTextWriteInput {
  relativePath: string;
  content: string;
  overwrite?: boolean;
  allowExistingMatch?: boolean;
}

interface CanonicalJsonlAppendInput<TRecord extends object = Record<string, unknown>> {
  relativePath: string;
  record: TRecord;
}

interface CanonicalDeleteInput {
  relativePath: string;
}

interface ApplyCanonicalWriteBatchInput {
  vaultRoot: string;
  operationType: string;
  summary: string;
  occurredAt?: DateInput;
  textWrites?: CanonicalTextWriteInput[];
  jsonlAppends?: CanonicalJsonlAppendInput[];
  deletes?: CanonicalDeleteInput[];
}

interface ApplyCanonicalWriteBatchResult {
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
    code: "HB_CANONICAL_WRITE_LOCK_STALE",
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
  return withCanonicalWriteLock(input.vaultRoot, () => appendJsonlRecordInternal(input));
}

export async function applyCanonicalWriteBatch(
  input: ApplyCanonicalWriteBatchInput,
): Promise<ApplyCanonicalWriteBatchResult> {
  const textWrites = input.textWrites ?? [];
  const jsonlAppends = input.jsonlAppends ?? [];
  const deletes = input.deletes ?? [];

  if (textWrites.length === 0 && jsonlAppends.length === 0 && deletes.length === 0) {
    throw new VaultError(
      "HB_CANONICAL_WRITE_EMPTY",
      "Canonical write batch requires at least one staged action.",
    );
  }

  return withCanonicalWriteLock(input.vaultRoot, async () => {
    await loadVaultInternal({ vaultRoot: input.vaultRoot });

    return runCanonicalWrite({
      vaultRoot: input.vaultRoot,
      operationType: input.operationType,
      summary: input.summary,
      occurredAt: input.occurredAt,
      mutate: async ({ batch }) => {
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
          textWrites: textWrites.map((entry) => entry.relativePath),
          jsonlAppends: jsonlAppends.map((entry) => entry.relativePath),
          deletes: deletes.map((entry) => entry.relativePath),
        };
      },
    });
  });
}

export async function copyRawArtifact(
  input: Parameters<typeof copyRawArtifactInternal>[0],
): ReturnType<typeof copyRawArtifactInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => copyRawArtifactInternal(input));
}

export async function ensureJournalDay(
  input: Parameters<typeof ensureJournalDayInternal>[0],
): ReturnType<typeof ensureJournalDayInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => ensureJournalDayInternal(input));
}

export async function appendJournal(
  input: Parameters<typeof appendJournalInternal>[0],
): ReturnType<typeof appendJournalInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => appendJournalInternal(input));
}

export async function linkJournalEventIds(
  input: Parameters<typeof linkJournalEventIdsInternal>[0],
): ReturnType<typeof linkJournalEventIdsInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => linkJournalEventIdsInternal(input));
}

export async function unlinkJournalEventIds(
  input: Parameters<typeof unlinkJournalEventIdsInternal>[0],
): ReturnType<typeof unlinkJournalEventIdsInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => unlinkJournalEventIdsInternal(input));
}

export async function linkJournalStreams(
  input: Parameters<typeof linkJournalStreamsInternal>[0],
): ReturnType<typeof linkJournalStreamsInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => linkJournalStreamsInternal(input));
}

export async function unlinkJournalStreams(
  input: Parameters<typeof unlinkJournalStreamsInternal>[0],
): ReturnType<typeof unlinkJournalStreamsInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => unlinkJournalStreamsInternal(input));
}

export async function createExperiment(
  input: Parameters<typeof createExperimentViaLegacyMutationsInternal>[0],
): ReturnType<typeof createExperimentViaLegacyMutationsInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => createExperimentViaLegacyMutationsInternal(input));
}

export async function updateExperiment(
  input: Parameters<typeof updateExperimentViaCanonicalMutationsInternal>[0],
): ReturnType<typeof updateExperimentViaCanonicalMutationsInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => updateExperimentViaCanonicalMutationsInternal(input));
}

export async function checkpointExperiment(
  input: Parameters<typeof checkpointExperimentInternal>[0],
): ReturnType<typeof checkpointExperimentInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => checkpointExperimentInternal(input));
}

export async function stopExperiment(
  input: Parameters<typeof stopExperimentViaCanonicalMutationsInternal>[0],
): ReturnType<typeof stopExperimentViaCanonicalMutationsInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => stopExperimentViaCanonicalMutationsInternal(input));
}

export async function importDocument(
  input: Parameters<typeof importDocumentInternal>[0],
): ReturnType<typeof importDocumentInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => importDocumentInternal(input));
}

export async function addMeal(
  input: Parameters<typeof addMealInternal>[0],
): ReturnType<typeof addMealInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => addMealInternal(input));
}

export const importMeal = addMeal;

export async function importSamples(
  input: Parameters<typeof importSamplesInternal>[0],
): ReturnType<typeof importSamplesInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => importSamplesInternal(input));
}

export async function upsertProvider(
  input: Parameters<typeof upsertProviderInternal>[0],
): ReturnType<typeof upsertProviderInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => upsertProviderInternal(input));
}

export async function upsertEvent(
  input: Parameters<typeof upsertEventInternal>[0],
): ReturnType<typeof upsertEventInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => upsertEventInternal(input));
}

export async function updateVaultSummary(
  input: Parameters<typeof updateVaultSummaryInternal>[0],
): ReturnType<typeof updateVaultSummaryInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => updateVaultSummaryInternal(input));
}

export async function promoteInboxJournal(
  input: Parameters<typeof promoteInboxJournalInternal>[0],
): ReturnType<typeof promoteInboxJournalInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => promoteInboxJournalInternal(input));
}

export async function promoteInboxExperimentNote(
  input: Parameters<typeof promoteInboxExperimentNoteInternal>[0],
): ReturnType<typeof promoteInboxExperimentNoteInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => promoteInboxExperimentNoteInternal(input));
}

export async function importDeviceBatch(
  input: Parameters<typeof importDeviceBatchInternal>[0],
): ReturnType<typeof importDeviceBatchInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => importDeviceBatchInternal(input));
}

export async function importAssessmentResponse(
  input: Parameters<typeof importAssessmentResponseInternal>[0],
): ReturnType<typeof importAssessmentResponseInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => importAssessmentResponseInternal(input));
}

export async function appendProfileSnapshot(
  input: Parameters<typeof appendProfileSnapshotInternal>[0],
): ReturnType<typeof appendProfileSnapshotInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => appendProfileSnapshotInternal(input));
}

export async function rebuildCurrentProfile(
  input: Parameters<typeof rebuildCurrentProfileInternal>[0],
): ReturnType<typeof rebuildCurrentProfileInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => rebuildCurrentProfileInternal(input));
}

export async function appendHistoryEvent(
  input: Parameters<typeof appendHistoryEventInternal>[0],
): ReturnType<typeof appendHistoryEventInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => appendHistoryEventInternal(input));
}

export async function appendBloodTest(
  input: Parameters<typeof appendBloodTestInternal>[0],
): ReturnType<typeof appendBloodTestInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => appendBloodTestInternal(input));
}

export async function upsertFamilyMember(
  input: Parameters<typeof upsertFamilyMemberInternal>[0],
): ReturnType<typeof upsertFamilyMemberInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => upsertFamilyMemberInternal(input));
}

export async function upsertGeneticVariant(
  input: Parameters<typeof upsertGeneticVariantInternal>[0],
): ReturnType<typeof upsertGeneticVariantInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => upsertGeneticVariantInternal(input));
}

export async function upsertAllergy(
  input: Parameters<typeof upsertAllergyInternal>[0],
): ReturnType<typeof upsertAllergyInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => upsertAllergyInternal(input));
}

export async function upsertCondition(
  input: Parameters<typeof upsertConditionInternal>[0],
): ReturnType<typeof upsertConditionInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => upsertConditionInternal(input));
}

export async function upsertGoal(
  input: Parameters<typeof upsertGoalInternal>[0],
): ReturnType<typeof upsertGoalInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => upsertGoalInternal(input));
}

export async function upsertRecipe(
  input: Parameters<typeof upsertRecipeInternal>[0],
): ReturnType<typeof upsertRecipeInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => upsertRecipeInternal(input));
}

export async function upsertRegimenItem(
  input: Parameters<typeof upsertRegimenItemInternal>[0],
): ReturnType<typeof upsertRegimenItemInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => upsertRegimenItemInternal(input));
}

export async function stopRegimenItem(
  input: Parameters<typeof stopRegimenItemInternal>[0],
): ReturnType<typeof stopRegimenItemInternal> {
  return withCanonicalWriteLock(input.vaultRoot, () => stopRegimenItemInternal(input));
}
