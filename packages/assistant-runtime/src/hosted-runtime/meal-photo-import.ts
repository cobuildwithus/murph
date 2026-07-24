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
} from "@murphai/core";
import type {
  HostedExecutionMealPhotoCapturedWake,
} from "@murphai/hosted-execution/contracts";

import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxPostCheckpointEffect,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type { HostedRuntimeEffectsPort } from "./platform.ts";

const MEAL_PHOTO_EXTERNAL_SYSTEM = "meal-photo-capture";
const MEAL_PHOTO_EXTERNAL_RESOURCE_TYPE = "photo";

export async function importHostedMealPhotoCapturedMailboxItem(input: {
  effectsPort: HostedRuntimeEffectsPort;
  item: HostedMailboxResolvedImportItem;
  vaultRoot: string;
  wake: HostedExecutionMealPhotoCapturedWake;
}): Promise<HostedMailboxItemImportOutcome> {
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
    if (!(await automaticMealCloseoutIsReady({
      directRoute: input.wake.directRoute,
      vaultRoot: input.vaultRoot,
    }))) {
      return blockedMealPhotoImport("meal_photo.closeout_automation_failed", true);
    }
    return importedMealPhotoOutcome(input.effectsPort, input.wake.mealPhoto.mealPhotoKey);
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
    return blockedMealPhotoImport("meal_photo.missing", true);
  }

  const integrityFailure = validateMealPhotoBytes({
    bytes,
    expectedByteLength: input.wake.mealPhoto.byteLength,
    expectedSha256: input.wake.mealPhoto.sha256,
  });
  if (integrityFailure) {
    return blockedMealPhotoImport(integrityFailure, false);
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
): HostedMailboxItemImportOutcome {
  const afterCheckpoint = createMealPhotoCleanupEffect(effectsPort, mealPhotoKey);
  return {
    ...(afterCheckpoint ? { afterCheckpoint } : {}),
    reasonCode: "meal_photo.imported",
    status: "imported",
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
