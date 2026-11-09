import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ensureAutomaticMealCloseoutAutomation,
} from "@murphai/assistant-engine";
import {
  ID_PREFIXES,
  addMeal,
  deterministicContractId,
  findEventByExternalRef,
  findMealHoldingUpload,
  linkUploadToMealWithSamePhoto,
} from "@murphai/core";
import type {
  HostedExecutionMealPhotoCapturedWake,
} from "@murphai/hosted-execution/contracts";

import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxPostCheckpointEffect,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type { HostedWorkspaceArtifactMaterializer } from "./models.ts";
import type { HostedRuntimeEffectsPort } from "./platform.ts";

const MEAL_PHOTO_EXTERNAL_SYSTEM = "meal-photo-capture";
const MEAL_PHOTO_EXTERNAL_RESOURCE_TYPE = "photo";
// A message photo Murph already holds; larger files aren't fetched to compare.
const LOGGED_MEAL_PHOTO_MAX_BYTES = 16 * 1024 * 1024;

export function isHostedManualMealPhotoWake(
  wake: HostedExecutionMealPhotoCapturedWake,
): boolean {
  return wake.eventId === `meal-photo:manual:${wake.mealPhoto.captureId}`;
}

interface HostedMealPhotoImportInput {
  effectsPort: HostedRuntimeEffectsPort;
  item: HostedMailboxResolvedImportItem;
  materializeWorkspaceArtifacts?: HostedWorkspaceArtifactMaterializer | null;
  signal?: AbortSignal | null;
  vaultRoot: string;
  wake: HostedExecutionMealPhotoCapturedWake;
}

export async function importHostedMealPhotoCapturedMailboxItem(
  input: HostedMealPhotoImportInput,
): Promise<HostedMailboxItemImportOutcome> {
  if (
    input.item.route.action !== "import-meal-photo"
    || input.item.item.kind !== "meal-photo.captured"
  ) {
    return blockedMealPhotoImport("meal_photo.route_mismatch", false);
  }

  if (
    input.wake.kind !== "meal-photo.captured"
    || input.wake.userId !== input.item.item.userId
    || input.wake.eventId !== input.item.item.dedupeKey
    || input.wake.occurredAt !== input.item.item.occurredAt
  ) {
    return blockedMealPhotoImport("meal_photo.decode_mismatch", false);
  }

  const externalRef = {
    resourceId: input.wake.mealPhoto.captureId,
    resourceType: MEAL_PHOTO_EXTERNAL_RESOURCE_TYPE,
    system: MEAL_PHOTO_EXTERNAL_SYSTEM,
    version: input.wake.mealPhoto.sha256,
  };

  let existing: Awaited<ReturnType<typeof findEventByExternalRef>>;
  try {
    existing = await findEventByExternalRef({
      resourceId: externalRef.resourceId,
      resourceType: externalRef.resourceType,
      system: externalRef.system,
      vaultRoot: input.vaultRoot,
    });
  } catch {
    return blockedMealPhotoImport("meal_photo.idempotency_read_failed", true);
  }

  if (existing) {
    if (existing.externalRef?.version !== input.wake.mealPhoto.sha256) {
      return blockedMealPhotoImport("meal_photo.capture_conflict", false);
    }
    return await mealPhotoAlreadyImported(input, "meal_photo.imported");
  }

  const readMealPhoto = input.effectsPort.readMealPhoto;
  if (!readMealPhoto) {
    return blockedMealPhotoImport("meal_photo.read_unavailable", true);
  }

  let bytes: Uint8Array | null;
  try {
    bytes = await readMealPhoto(input.wake.mealPhoto.mealPhotoKey);
  } catch {
    return blockedMealPhotoImport("meal_photo.read_failed", true);
  }
  if (!bytes) {
    return await importWithoutStagedPhoto(input);
  }

  const integrityFailure = validateMealPhotoBytes({
    bytes,
    expectedByteLength: input.wake.mealPhoto.byteLength,
    expectedSha256: input.wake.mealPhoto.sha256,
  });
  if (integrityFailure) {
    return blockedMealPhotoImport(integrityFailure, false);
  }

  const linked = await importAsMealAlreadyHoldingPhoto(input, bytes);
  if (linked) {
    return linked;
  }

  let temporaryDirectory: string;
  try {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "murph-meal-photo-"));
  } catch {
    return blockedMealPhotoImport("meal_photo.temporary_storage_failed", true);
  }
  const temporaryPhotoPath = path.join(temporaryDirectory, "meal.jpg");
  try {
    await writeFile(temporaryPhotoPath, bytes);
    await addMeal({
      uploadId: input.wake.mealPhoto.uploadId,
      eventId: deterministicContractId(
        ID_PREFIXES.event,
        `meal-photo-capture:event:${input.wake.mealPhoto.captureId}`,
      ),
      externalRef,
      mealId: deterministicContractId(
        ID_PREFIXES.meal,
        `meal-photo-capture:meal:${input.wake.mealPhoto.captureId}`,
      ),
      occurredAt: input.wake.mealPhoto.capturedAt,
      photoPath: temporaryPhotoPath,
      photoCapturedAt: input.wake.mealPhoto.capturedAt,
      source: "device",
      vaultRoot: input.vaultRoot,
    });
  } catch {
    return blockedMealPhotoImport("meal_photo.canonical_import_failed", true);
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true }).catch(() => undefined);
  }

  if (!(await automaticMealCloseoutIsReady({
    directRoute: input.wake.directRoute,
    vaultRoot: input.vaultRoot,
  }))) {
    return blockedMealPhotoImport("meal_photo.closeout_automation_failed", true);
  }

  return importedMealPhotoOutcome(input.effectsPort, input.wake.mealPhoto.mealPhotoKey);
}

/**
 * The phone also captures photos the member texted Murph: that capture joins
 * the meal already holding its photo. The member's own send from the app stays
 * a meal of its own. Null leaves the ordinary import to run.
 */
async function importAsMealAlreadyHoldingPhoto(
  input: HostedMealPhotoImportInput,
  bytes: Uint8Array,
): Promise<HostedMailboxItemImportOutcome | null> {
  if (isHostedManualMealPhotoWake(input.wake)) {
    return null;
  }
  let loggedMealId: string | null;
  try {
    loggedMealId = await linkUploadToMealWithSamePhoto({
      capturedAt: input.wake.mealPhoto.capturedAt,
      jpeg: bytes,
      materialize: input.materializeWorkspaceArtifacts
        ? materializeVaultFile(input.materializeWorkspaceArtifacts, input.signal ?? null)
        : null,
      signal: input.signal ?? null,
      uploadId: captureUploadId(input.wake),
      vaultRoot: input.vaultRoot,
    });
  } catch {
    // Unsure whether a meal holds it: a retry beats a duplicate.
    return blockedMealPhotoImport("meal_photo.already_logged_check_failed", true);
  }
  return loggedMealId ? await mealPhotoAlreadyImported(input, "meal_photo.already_logged") : null;
}

/**
 * Staging is cleared once the capture is in a meal. A replay after that finds
 * its meal by the upload, which a linked texted meal holds instead of the
 * capture's external ref.
 */
async function importWithoutStagedPhoto(
  input: HostedMealPhotoImportInput,
): Promise<HostedMailboxItemImportOutcome> {
  let mealId: string | null;
  try {
    mealId = await findMealHoldingUpload({
      signal: input.signal ?? null,
      uploadId: captureUploadId(input.wake),
      vaultRoot: input.vaultRoot,
    });
  } catch {
    return blockedMealPhotoImport("meal_photo.idempotency_read_failed", true);
  }
  return mealId
    ? await mealPhotoAlreadyImported(input, "meal_photo.already_logged")
    : blockedMealPhotoImport("meal_photo.missing", true);
}

/** The capture has its meal: keep the evening closeout on and clear staging. */
async function mealPhotoAlreadyImported(
  input: HostedMealPhotoImportInput,
  reasonCode: string,
): Promise<HostedMailboxItemImportOutcome> {
  if (!(await automaticMealCloseoutIsReady({
    directRoute: input.wake.directRoute,
    vaultRoot: input.vaultRoot,
  }))) {
    return blockedMealPhotoImport("meal_photo.closeout_automation_failed", true);
  }
  return importedMealPhotoOutcome(input.effectsPort, input.wake.mealPhoto.mealPhotoKey, reasonCode);
}

function captureUploadId(wake: HostedExecutionMealPhotoCapturedWake): string {
  return wake.mealPhoto.uploadId ?? wake.mealPhoto.captureId;
}

async function automaticMealCloseoutIsReady(input: {
  directRoute: HostedExecutionMealPhotoCapturedWake["directRoute"];
  vaultRoot: string;
}): Promise<boolean> {
  try {
    const emailDeliveryTarget = input.directRoute.channel === "email"
      ? input.directRoute.deliveryTarget
      : null;
    const directThreadId = input.directRoute.channel === "email"
      ? null
      : input.directRoute.threadId;
    await ensureAutomaticMealCloseoutAutomation({
      defaultRoute: {
        channel: input.directRoute.channel,
        deliverySource: null,
        deliveryTarget: emailDeliveryTarget,
        identityId: null,
        participantId: null,
        threadId: directThreadId,
        threadIsDirect: true,
      },
      routeValidationProfile: "hosted",
      vaultRoot: input.vaultRoot,
    });
    return true;
  } catch {
    return false;
  }
}

function validateMealPhotoBytes(input: {
  bytes: Uint8Array;
  expectedByteLength: number;
  expectedSha256: string;
}): string | null {
  if (input.bytes.byteLength !== input.expectedByteLength) {
    return "meal_photo.byte_length_mismatch";
  }
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (sha256 !== input.expectedSha256) {
    return "meal_photo.sha256_mismatch";
  }
  if (
    input.bytes.byteLength < 4
    || input.bytes[0] !== 0xff
    || input.bytes[1] !== 0xd8
    || input.bytes[input.bytes.byteLength - 2] !== 0xff
    || input.bytes[input.bytes.byteLength - 1] !== 0xd9
  ) {
    return "meal_photo.invalid_jpeg";
  }
  return null;
}

function importedMealPhotoOutcome(
  effectsPort: HostedRuntimeEffectsPort,
  mealPhotoKey: string,
  reasonCode = "meal_photo.imported",
): HostedMailboxItemImportOutcome {
  const afterCheckpoint = createMealPhotoCleanupEffect(effectsPort, mealPhotoKey);
  return {
    ...(afterCheckpoint ? { afterCheckpoint } : {}),
    reasonCode,
    status: "imported",
  };
}

/** True when the file is local, false when it is gone for good; throws when unknown. */
function materializeVaultFile(
  materialize: HostedWorkspaceArtifactMaterializer,
  signal: AbortSignal | null,
): (relativePath: string) => Promise<boolean> {
  return async (relativePath) => {
    const key = `vault:${relativePath}`;
    const result = await materialize([key], {
      maxFileBytes: LOGGED_MEAL_PHOTO_MAX_BYTES,
      maxTotalDownloadBytes: LOGGED_MEAL_PHOTO_MAX_BYTES,
      signal,
    });
    const unavailable = result.missingArtifactPaths.get(key);
    if (unavailable === "transport") throw new Error("Meal photo transfer failed.");
    return unavailable === undefined && result.materializedArtifactPaths.has(key);
  };
}

function createMealPhotoCleanupEffect(
  effectsPort: HostedRuntimeEffectsPort,
  mealPhotoKey: string,
): HostedMailboxPostCheckpointEffect | null {
  const deleteMealPhoto = effectsPort.deleteMealPhoto;
  if (!deleteMealPhoto) {
    return null;
  }

  return async () => {
    await deleteMealPhoto(mealPhotoKey);
    return {
      attachmentEvidenceUpdated: null,
      kind: "meal_photo_cleanup",
      projectionUpdated: null,
      reasonCode: "meal_photo.deleted",
      status: "succeeded",
    };
  };
}

function blockedMealPhotoImport(
  reasonCode: string,
  retryable: boolean,
): HostedMailboxItemImportOutcome {
  return {
    reasonCode,
    retryable,
    status: "blocked",
  };
}
