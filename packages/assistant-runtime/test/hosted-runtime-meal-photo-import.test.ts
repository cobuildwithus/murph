import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mealPhotoImportMocks = vi.hoisted(() => ({
  ensureAutomaticMealCloseoutAutomation: vi.fn(async () => ({
    automationId: "automation_synthetic_meal_closeout",
  })),
}));

vi.mock("@murphai/assistant-engine", () => ({
  ensureAutomaticMealCloseoutAutomation:
    mealPhotoImportMocks.ensureAutomaticMealCloseoutAutomation,
}));

import {
  ID_PREFIXES,
  deterministicContractId,
  findEventByExternalRef,
  initializeVault,
} from "@murphai/core";
import { buildHostedExecutionMealPhotoCapturedWake } from "@murphai/hosted-execution";
import type { HostedRuntimeEffectsPort } from "../src/hosted-runtime/platform.ts";
import type { HostedMailboxResolvedImportItem } from "../src/hosted-runtime/mailbox-import.ts";
import { importHostedMealPhotoCapturedMailboxItem } from "../src/hosted-runtime/meal-photo-import.ts";

const CAPTURED_AT = "2026-07-12T21:15:00.000Z";
const CAPTURE_ID = "a".repeat(64);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const JPEG_SHA256 = createHash("sha256").update(JPEG_BYTES).digest("hex");
const cleanupPaths: string[] = [];

afterEach(async () => {
  mealPhotoImportMocks.ensureAutomaticMealCloseoutAutomation.mockReset();
  mealPhotoImportMocks.ensureAutomaticMealCloseoutAutomation.mockResolvedValue({
    automationId: "automation_synthetic_meal_closeout",
  });
  await Promise.all(
    cleanupPaths.splice(0).map((targetPath) =>
      rm(targetPath, { force: true, recursive: true })
    ),
  );
});

describe("hosted meal photo mailbox import", () => {
  it("imports one canonical meal idempotently and deletes staging only after checkpoint", async () => {
    const vaultRoot = await createTestVault();
    const readMealPhoto = vi.fn(async () => JPEG_BYTES);
    const deleteMealPhoto = vi.fn(async () => undefined);
    const effectsPort = createEffectsPort({ deleteMealPhoto, readMealPhoto });
    const item = createMealPhotoMailboxItem();
    const wake = createMealPhotoWake();

    const first = await importHostedMealPhotoCapturedMailboxItem({
      effectsPort,
      item,
      vaultRoot,
      wake,
    });

    expect(first.status).toBe("imported");
    expect(readMealPhoto).toHaveBeenCalledTimes(1);
    expect(deleteMealPhoto).not.toHaveBeenCalled();
    const stored = await findEventByExternalRef({
      resourceId: CAPTURE_ID,
      resourceType: "photo",
      system: "meal-photo-capture",
      vaultRoot,
    });
    expect(stored?.id).toBe(
      deterministicContractId(ID_PREFIXES.event, `meal-photo-capture:event:${CAPTURE_ID}`),
    );
    expect(stored?.externalRef?.version).toBe(JPEG_SHA256);

    const replay = await importHostedMealPhotoCapturedMailboxItem({
      effectsPort,
      item,
      vaultRoot,
      wake,
    });
    expect(replay.status).toBe("imported");
    expect(readMealPhoto).toHaveBeenCalledTimes(1);
    expect(
      mealPhotoImportMocks.ensureAutomaticMealCloseoutAutomation,
    ).toHaveBeenCalledTimes(2);
    expect(
      mealPhotoImportMocks.ensureAutomaticMealCloseoutAutomation,
    ).toHaveBeenCalledWith({
      defaultRoute: {
        channel: "linq",
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: "linq_home_thread",
        threadIsDirect: true,
      },
      routeValidationProfile: "hosted",
      vaultRoot,
    });

    if (first.status !== "imported" || !first.afterCheckpoint) {
      throw new Error("Expected an after-checkpoint meal photo cleanup effect.");
    }
    await expect(first.afterCheckpoint()).resolves.toEqual({
      attachmentEvidenceUpdated: null,
      kind: "meal_photo_cleanup",
      projectionUpdated: null,
      reasonCode: "meal_photo.deleted",
      status: "succeeded",
    });
    expect(deleteMealPhoto).toHaveBeenCalledWith("meal_photo_opaque_key");
  });

  it("rejects corrupt staged bytes without importing or deleting them", async () => {
    const vaultRoot = await createTestVault();
    const deleteMealPhoto = vi.fn(async () => undefined);
    const effectsPort = createEffectsPort({
      deleteMealPhoto,
      readMealPhoto: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0x00, 0xd9])),
    });

    const outcome = await importHostedMealPhotoCapturedMailboxItem({
      effectsPort,
      item: createMealPhotoMailboxItem(),
      vaultRoot,
      wake: createMealPhotoWake(),
    });

    expect(outcome).toEqual({
      reasonCode: "meal_photo.sha256_mismatch",
      retryable: false,
      status: "blocked",
    });
    expect(deleteMealPhoto).not.toHaveBeenCalled();
    await expect(findEventByExternalRef({
      resourceId: CAPTURE_ID,
      resourceType: "photo",
      system: "meal-photo-capture",
      vaultRoot,
    })).resolves.toBeNull();
  });

  it("retries when the platform has not configured staged-photo reads", async () => {
    const vaultRoot = await createTestVault();
    const outcome = await importHostedMealPhotoCapturedMailboxItem({
      effectsPort: createEffectsPort(),
      item: createMealPhotoMailboxItem(),
      vaultRoot,
      wake: createMealPhotoWake(),
    });

    expect(outcome).toEqual({
      reasonCode: "meal_photo.read_unavailable",
      retryable: true,
      status: "blocked",
    });
  });

  it("keeps the mailbox item retryable until the closeout automation is durable", async () => {
    const vaultRoot = await createTestVault();
    const readMealPhoto = vi.fn(async () => JPEG_BYTES);
    const deleteMealPhoto = vi.fn(async () => undefined);
    const effectsPort = createEffectsPort({ deleteMealPhoto, readMealPhoto });
    mealPhotoImportMocks.ensureAutomaticMealCloseoutAutomation.mockRejectedValueOnce(
      new Error("route unavailable"),
    );

    const first = await importHostedMealPhotoCapturedMailboxItem({
      effectsPort,
      item: createMealPhotoMailboxItem(),
      vaultRoot,
      wake: createMealPhotoWake(),
    });

    expect(first).toEqual({
      reasonCode: "meal_photo.closeout_automation_failed",
      retryable: true,
      status: "blocked",
    });
    expect(readMealPhoto).toHaveBeenCalledTimes(1);
    expect(deleteMealPhoto).not.toHaveBeenCalled();
    await expect(findEventByExternalRef({
      resourceId: CAPTURE_ID,
      resourceType: "photo",
      system: "meal-photo-capture",
      vaultRoot,
    })).resolves.not.toBeNull();

    const retry = await importHostedMealPhotoCapturedMailboxItem({
      effectsPort,
      item: createMealPhotoMailboxItem(),
      vaultRoot,
      wake: createMealPhotoWake(),
    });

    expect(retry.status).toBe("imported");
    expect(readMealPhoto).toHaveBeenCalledTimes(1);
    expect(
      mealPhotoImportMocks.ensureAutomaticMealCloseoutAutomation,
    ).toHaveBeenCalledTimes(2);
  });

  it("keeps capture retryable when current private route resolution is unavailable", async () => {
    const vaultRoot = await createTestVault();
    const readMealPhoto = vi.fn(async () => JPEG_BYTES);

    const outcome = await importHostedMealPhotoCapturedMailboxItem({
      effectsPort: createEffectsPort({
        readMealPhoto,
        resolveCurrentDirectRoute: undefined,
      }),
      item: createMealPhotoMailboxItem(),
      vaultRoot,
      wake: createMealPhotoWake(),
    });

    expect(outcome).toEqual({
      reasonCode: "meal_photo.closeout_automation_failed",
      retryable: true,
      status: "blocked",
    });
    expect(readMealPhoto).toHaveBeenCalledTimes(1);
    expect(
      mealPhotoImportMocks.ensureAutomaticMealCloseoutAutomation,
    ).not.toHaveBeenCalled();
  });
});

async function createTestVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-meal-photo-vault-"));
  cleanupPaths.push(vaultRoot);
  await initializeVault({
    title: "Meal Photo Test Vault",
    timezone: "UTC",
    vaultRoot,
  });
  return vaultRoot;
}

function createMealPhotoWake() {
  return buildHostedExecutionMealPhotoCapturedWake({
    byteLength: JPEG_BYTES.byteLength,
    captureId: CAPTURE_ID,
    capturedAt: CAPTURED_AT,
    eventId: "meal-photo:enrollment:capture",
    mealPhotoKey: "meal_photo_opaque_key",
    memberId: "member_synthetic_001",
    occurredAt: CAPTURED_AT,
    sha256: JPEG_SHA256,
  });
}

function createMealPhotoMailboxItem(): HostedMailboxResolvedImportItem {
  return {
    item: {
      createdAt: CAPTURED_AT,
      dedupeKey: "meal-photo:enrollment:capture",
      expiresAt: null,
      id: "item_synthetic_meal_photo",
      kind: "meal-photo.captured",
      lane: "system",
      laneSeq: "1",
      occurredAt: CAPTURED_AT,
      payloadBytes: 256,
      payloadInlineCiphertext: "ciphertext_synthetic_inline",
      payloadRef: null,
      payloadSchema: "murph.hosted-mailbox-item.v1",
      updatedAt: CAPTURED_AT,
      userId: "member_synthetic_001",
    },
    payload: {
      payloadCiphertext: "ciphertext_synthetic_inline",
      payloadSchema: "murph.hosted-mailbox-item.v1",
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "import-meal-photo",
      advanceProgress: true,
      itemRef: {
        id: "item_synthetic_meal_photo",
        kind: "meal-photo.captured",
        lane: "system",
        laneSeq: "1",
      },
      state: "route",
    },
  };
}

function createEffectsPort(
  overrides: Pick<
    HostedRuntimeEffectsPort,
    "deleteMealPhoto" | "readMealPhoto" | "resolveCurrentDirectRoute"
  > = {},
): HostedRuntimeEffectsPort {
  return {
    readRawEmailMessage: async () => null,
    resolveCurrentDirectRoute: async () => ({
      channel: "linq",
      threadId: "linq_home_thread",
    }),
    sendEmail: async () => undefined,
    ...overrides,
  };
}
