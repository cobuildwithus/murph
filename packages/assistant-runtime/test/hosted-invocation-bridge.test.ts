import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import { fetchAndProcessHostedMailboxPrefix } from "../src/hosted-runtime/mailbox-import.ts";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import { createMealMediaStore, mediaFailure } from "./hosted-meal-media.harness.ts";
import type {
  HostedExecutionAssistantAskCompletedWake,
  HostedExecutionAssistantAskRequestedWake,
  HostedExecutionSystemWake,
} from "@murphai/hosted-execution/contracts";

import { HOSTED_RETIRED_MAILBOX_KINDS } from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRetiredMailboxKind,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceInvocationRequest,
} from "@murphai/hosted-execution/runtime-control";
import type { HostedWorkspaceRuntimeJobOptions } from "../src/hosted-runtime.ts";
import type {
  HostedRuntimeBridgeCheckpointLeaseErrorCode,
  HostedRuntimeBridgeCheckpointLeaseStage,
} from "../src/hosted-runtime/checkpoint-bridge.ts";

import type {
  HostedRuntimeBridgeReadCurrentLease,
  HostedWorkspaceMailboxPayloadDecodeResult,
  HostedWorkspaceMailboxPayloadDecoder,
  HostedWorkspaceSnapshotArchiveBuilder,
} from "../src/hosted-runtime/snapshot-bridge.ts";

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  access,
  cp,
  readFile,
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "@murphai/core";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantAskRequestedWake,
} from "@murphai/hosted-execution";

import {
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  createAssistantOutboxIntent,
  markAssistantOutboxIntentSentById,
} from "@murphai/assistant-engine/assistant-outbox";
import {
  readAssistantInputEvent,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import {
  saveAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";
import {
  initializeVault,
  addMeal,
  addMeasurement,
  readEvent,
  upsertEvent,
  deleteEvent,
  runMealPhotoMaintenance,
  withHostedCanonicalWritePort,
  withCanonicalWriteLock,
} from "@murphai/core";
import {
  persistCanonicalInboxCapture,
} from "@murphai/inboxd";
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from "@murphai/runtime-state/assistant-generated-deliveries";

import {
  HostedRuntimeCheckpointInterruptedByWakeError,
  type HostedRuntimePlatform,
} from "../src/hosted-runtime.ts";
import {
  HostedRuntimeBridgeCheckpointLeaseError,
  checkpointHostedRuntimeBridgeWebWorkspace,
  type HostedRuntimeBridgeCheckpointLease,
} from "../src/hosted-runtime/checkpoint-bridge.ts";
import {
  createHostedWorkspaceRuntimeBridgeJobOptions,
} from "../src/hosted-runtime/snapshot-bridge.ts";

import { publishHostedWorkspaceMediaReferencesForSnapshot, readHostedMediaReferenceCatalogue, writeHostedMediaReferenceCatalogue, resetHostedPhotoIntentsAfterColdRestore } from "../src/hosted-runtime/media-references.ts";
import { externalizeHostedCanonicalWriteMediaPayloads } from "../src/hosted-runtime/canonical-write-media.ts";
import { appendHostedCanonicalWriteReceiptToArtifactLog } from "../src/hosted-runtime/canonical-write-receipt-log.ts";

import {
  drainHostedRuntimeLogWritesBestEffort,
} from "../src/hosted-runtime/runtime-logs.ts";
import {
  enqueueHostedPendingAssistantInputId,
} from "../src/hosted-runtime/pending-input-index.ts";

import { createHostedArtifactMaterializer } from "../src/hosted-runtime/artifacts.ts";
import { createHostedMealMediaBudget, withHostedMealMediaRetry } from "../src/hosted-runtime/meal-media-maintenance.ts";

import { runHostedIdleCheckpointMaintenance } from "../src/hosted-runtime/idle-maintenance.ts";

const TEST_REQUEST = {
  attemptId: "attempt_bridge",
  leaseGeneration: "4",
  providerEgressToken: "provider-egress-token-bridge",
  userId: "member_bridge",
  workspaceVersion: "7",
} satisfies HostedWorkspaceInvocationRequest;

const WRITE_OPERATION_SCHEMA_VERSION = "murph.write-operation.v1";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await drainHostedRuntimeLogWritesBestEffort();
  vi.restoreAllMocks();
  await Promise.all(cleanupPaths.splice(0).map(async (target) => {
    await rm(target, { force: true, recursive: true });
  }));
});

describe("checkpoint bridge post-Web lease diagnostics", () => {
  const request = {
    attemptId: "attempt_synthetic_lease_diagnostic",
    expectedWorkspaceVersion: "930000000000000001",
    leaseGeneration: "940000000000000001",
    reason: "active_turn_input",
    snapshotRef: null,
  } satisfies HostedWorkspaceCheckpointRequest;
  const lease = {
    attemptId: request.attemptId,
    leaseGeneration: request.leaseGeneration,
    providerEgressToken: "synthetic-private-egress-token",
    userId: "member_synthetic_lease_diagnostic",
    workspaceVersion: request.expectedWorkspaceVersion,
  } satisfies HostedRuntimeBridgeCheckpointLease;
  const responseVersion = "930000000000000002";
  const differentVersion = "930000000000000003";
  const response = createCheckpointResponse({
    snapshotRef: null,
    userId: lease.userId,
    version: responseVersion,
  });

  for (const checkpointed of [true, false]) {
    for (const matchesResponse of [true, false]) {
      it(`projects checkpointed=${checkpointed}, matchesResponse=${matchesResponse} without new effects`, async () => {
        let liveLease: HostedRuntimeBridgeCheckpointLease = lease;
        const readCurrentLease = vi.fn(async () => liveLease);
        const checkpointWorkspace = vi.fn(async () => {
          liveLease = {
            ...lease,
            workspaceVersion: matchesResponse ? responseVersion : differentVersion,
          };
          return { ...response, checkpointed };
        });

        const error = await expectLeaseFailure(checkpointHostedRuntimeBridgeWebWorkspace({
          checkpointWorkspace,
          readCurrentLease,
          request,
          userId: lease.userId,
        }), { code: "stale_workspace_version", stage: "after_web_checkpoint" });

        expect(error.postWebCheckpoint).toEqual({
          responseCheckpointed: checkpointed,
          leaseMatchesResponse: matchesResponse,
        });
        expect(error.message).toBe(
          "Hosted runtime bridge checkpoint lease validation failed after_web_checkpoint.",
        );
        expect(readCurrentLease).toHaveBeenCalledTimes(2);
        expect(checkpointWorkspace).toHaveBeenCalledExactlyOnceWith(request);
        for (const sensitive of [
          ...Object.values(lease), responseVersion, differentVersion,
        ]) {
          expect(JSON.stringify(error)).not.toContain(sensitive);
        }
      });
    }

    it(`returns checkpointed=${checkpointed} responses unchanged when the lease has not drifted`, async () => {
      const checkpointResponse = { ...response, checkpointed };
      const checkpointWorkspace = vi.fn(async () => checkpointResponse);
      const readCurrentLease = vi.fn(async () => lease);
      await expect(checkpointHostedRuntimeBridgeWebWorkspace({
        checkpointWorkspace, readCurrentLease, request, userId: lease.userId,
      })).resolves.toBe(checkpointResponse);
      expect(checkpointResponse).not.toHaveProperty("postWebCheckpoint");
      expect(checkpointWorkspace).toHaveBeenCalledExactlyOnceWith(request);
      expect(readCurrentLease).toHaveBeenCalledTimes(2);
    });
  }

  it.each([
    ["missing_lease", null],
    ["stale_user", { ...lease, userId: "member_synthetic_other" }],
    ["stale_attempt", { ...lease, attemptId: "attempt_synthetic_other" }],
    ["stale_lease_generation", { ...lease, leaseGeneration: "940000000000000002" }],
    ["stale_workspace_version", { ...lease, workspaceVersion: responseVersion }],
  ] as const)("rejects pre-Web %s before checkpointing", async (code, liveLease) => {
    const readCurrentLease = vi.fn(async () => liveLease);
    const checkpointWorkspace = vi.fn(async () => response);
    const error = await expectLeaseFailure(checkpointHostedRuntimeBridgeWebWorkspace({
      checkpointWorkspace, readCurrentLease, request, userId: lease.userId,
    }), { code, stage: "before_web_checkpoint" });
    expect(error.postWebCheckpoint).toBeUndefined();
    expect(readCurrentLease).toHaveBeenCalledOnce();
    expect(checkpointWorkspace).not.toHaveBeenCalled();
  });

  it.each([
    ["missing_lease", null],
    ["stale_user", { ...lease, userId: "member_synthetic_other" }],
    ["stale_attempt", { ...lease, attemptId: "attempt_synthetic_other" }],
    ["stale_lease_generation", { ...lease, leaseGeneration: "940000000000000002" }],
  ] as const)("omits response metadata for post-Web %s", async (code, liveLease) => {
    const readCurrentLease = vi.fn<() => Promise<HostedRuntimeBridgeCheckpointLease | null>>()
      .mockResolvedValueOnce(lease)
      .mockResolvedValueOnce(liveLease);
    const checkpointWorkspace = vi.fn(async () => response);
    const error = await expectLeaseFailure(checkpointHostedRuntimeBridgeWebWorkspace({
      checkpointWorkspace, readCurrentLease, request, userId: lease.userId,
    }), { code, stage: "after_web_checkpoint" });
    expect(error.postWebCheckpoint).toBeUndefined();
    expect(readCurrentLease).toHaveBeenCalledTimes(2);
    expect(checkpointWorkspace).toHaveBeenCalledExactlyOnceWith(request);
  });

  it("preserves the response user check before the post-Web lease read", async () => {
    const readCurrentLease = vi.fn(async () => lease);
    const checkpointWorkspace = vi.fn(async () => ({
      ...response, workspace: { ...response.workspace, userId: "member_synthetic_other" },
    }));
    const error = await expectLeaseFailure(checkpointHostedRuntimeBridgeWebWorkspace({
      checkpointWorkspace, readCurrentLease, request, userId: lease.userId,
    }), { code: "workspace_user_mismatch", stage: "after_web_checkpoint" });
    expect(error.postWebCheckpoint).toBeUndefined();
    expect(readCurrentLease).toHaveBeenCalledOnce();
    expect(checkpointWorkspace).toHaveBeenCalledExactlyOnceWith(request);
  });

  it("rethrows a callback failure unchanged without a post-Web lease read", async () => {
    const failure = new Error("Synthetic Web checkpoint failure.");
    const readCurrentLease = vi.fn(async () => lease);
    const checkpointWorkspace = vi.fn(async () => { throw failure; });
    await expect(checkpointHostedRuntimeBridgeWebWorkspace({
      checkpointWorkspace, readCurrentLease, request, userId: lease.userId,
    })).rejects.toBe(failure);
    expect(failure).not.toHaveProperty("postWebCheckpoint");
    expect(readCurrentLease).toHaveBeenCalledOnce();
    expect(checkpointWorkspace).toHaveBeenCalledExactlyOnceWith(request);
  });
});

describe("createHostedWorkspaceRuntimeBridgeJobOptions", () => {
  it.each(["retry", "delete_immediately"])("a lost media reply leaves no orphan when the next action is %s", async (nextAction) => {
    const vaultRoot = await createVaultRoot();
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const photoPath = path.join(vaultRoot, "fixture.png");
    await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
    const capturedAt = "2030-01-01T12:00:00.000Z";
    const meal = await addMeal({ vaultRoot, photoPath, photoCapturedAt: capturedAt, occurredAt: capturedAt });
    const { platform } = createRuntimePlatform();
    const store = createMealMediaStore();
    let loseReply = true;
    store.hooks.after = async operation => {
      if (operation === "put" && loseReply) { loseReply = false; throw mediaFailure("Synthetic lost media reply"); }
    };
    platform.mediaStore = store.mediaStore;
    const idle = () => deliverPendingMealMediaForTest(vaultRoot, store.mediaStore);
    const port = { async persistCanonicalWrite(persistence: Parameters<typeof externalizeHostedCanonicalWriteMediaPayloads>[0]["persistence"]) {
      const externalized = await externalizeHostedCanonicalWriteMediaPayloads({ persistence, vaultRoot, mediaStore: platform.mediaStore });
      await appendHostedCanonicalWriteReceiptToArtifactLog({ ...externalized, artifactStore: platform.artifactStore, previousStatus: null });
    } };
    const maintain = () => withHostedCanonicalWritePort(port, () => runMealPhotoMaintenance({ vaultRoot, now: new Date("2030-04-01T12:00:00.000Z") }));
    const options = createBridgeOptions({ platform, vaultRoot });
    const checkpoint = () => options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    try { await maintain(); } catch (error) { expect(String(error)).toContain("Synthetic lost media reply"); }
    await idle();
    expect(store.bytes.size).toBe(1);
    // Reconciliation alone cannot invent a pointer lost before a canonical
    // commit. Deletion is allowed to arrive before any maintenance retry.
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: platform.mediaStore });
    if (nextAction === "retry") { await maintain(); await idle(); await checkpoint(); }
    await withHostedCanonicalWritePort(port, () => deleteEvent({ vaultRoot, eventId: meal.event.id }));
    await idle(); await checkpoint(); await checkpoint();
    expect(store.bytes.size).toBe(0);
    expect(store.activeUnlimited()).toBe(0);
  });

  it.each([false, true])("acknowledged upload and failed receipt converge after retirement (receiptStored=%s)", async receiptStored => {
    const vaultRoot = await createVaultRoot();
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const photoPath = path.join(vaultRoot, "fixture.png");
    await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
    const capturedAt = "2030-01-01T12:00:00.000Z";
    const meal = await addMeal({ vaultRoot, photoPath, photoCapturedAt: capturedAt, occurredAt: capturedAt });
    const { platform } = createRuntimePlatform();
    const store = createMealMediaStore(); platform.mediaStore = store.mediaStore;
    let failReceipt = true;
    const port = { async persistCanonicalWrite(persistence: Parameters<typeof externalizeHostedCanonicalWriteMediaPayloads>[0]["persistence"]) {
      const externalized = await externalizeHostedCanonicalWriteMediaPayloads({ persistence, vaultRoot, mediaStore: store.mediaStore });
      if (failReceipt) {
        // Seed the acknowledged legacy upload when the new writer defers it.
        const entry = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]!;
        if (entry.pendingUpload) await store.mediaStore.put({ ...entry, bytes: await readFile(path.join(vaultRoot, entry.relativePath)) });
      }
      await appendHostedCanonicalWriteReceiptToArtifactLog({ ...externalized, previousStatus: null,
        artifactStore: failReceipt ? { ...platform.artifactStore, async put(artifact) {
          if (receiptStored) await platform.artifactStore.put(artifact);
          throw new Error("Synthetic receipt response failure");
        } } : platform.artifactStore });
    } };
    const maintain = () => withHostedCanonicalWritePort(port, () => runMealPhotoMaintenance({ vaultRoot, now: new Date("2030-04-01T12:00:00.000Z") }));
    await expect(maintain()).rejects.toThrow("Synthetic receipt response failure");
    expect(store.bytes.size).toBe(1);
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: store.mediaStore });
    await deliverPendingMealMediaForTest(vaultRoot, store.mediaStore);
    expect(store.bytes.size).toBe(0);
    expect([...store.rows.values()].every(row => row.retired)).toBe(true);
    failReceipt = false;
    await expect(maintain()).resolves.toMatchObject({ retiredPhotoCount: 1, blockedMealCount: 0 });
    await deliverPendingMealMediaForTest(vaultRoot, store.mediaStore);
    await withHostedCanonicalWritePort(port, () => deleteEvent({ vaultRoot, eventId: meal.event.id }));
    await deliverPendingMealMediaForTest(vaultRoot, store.mediaStore);
    await createBridgeOptions({ platform, vaultRoot }).createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    await createBridgeOptions({ platform, vaultRoot }).createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    expect(store.bytes.size).toBe(0); expect(store.activeUnlimited()).toBe(0);
  });

  it.each(["rejected", "lost_response", "accepted"])("snapshot publication never delivers pending meal media: %s", async outcome => {
    const vaultRoot = await createVaultRoot();
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const photoPath = path.join(vaultRoot, "fixture.png");
    await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
    const capturedAt = "2030-01-01T12:00:00.000Z";
    await addMeal({ vaultRoot, photoPath, photoCapturedAt: capturedAt, occurredAt: capturedAt });
    await runMealPhotoMaintenance({ vaultRoot, now: new Date("2030-04-01T12:00:00.000Z") });
    const { calls, platform } = createRuntimePlatform();
    const store = createMealMediaStore(); platform.mediaStore = store.mediaStore;
    const complete = calls.completeSnapshotSession.getMockImplementation()!;
    calls.completeSnapshotSession.mockImplementationOnce(async input => {
      expect(store.calls).toEqual([]);
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]).toMatchObject({ pendingUpload: true });
      const completed = await complete(input);
      if (outcome === "lost_response") throw new Error("Synthetic lost checkpoint response");
      if (outcome === "rejected") completed.checkpoint.checkpointed = false;
      return completed;
    });
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const build = vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).getMockImplementation()!;
    vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mockImplementation(async input => {
      expect(input.archiveEntries.some(entry => entry.relativePath.endsWith("/hosted-media-refs.json"))).toBe(true);
      return build(input);
    });
    const options = createBridgeOptions({ platform, vaultRoot, snapshotArchiveBuilder });
    const checkpoint = () => options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    if (outcome === "lost_response") await expect(checkpoint()).rejects.toThrow("Synthetic lost checkpoint response");
    else await expect(checkpoint()).resolves.toMatchObject({ checkpoint: { checkpointed: outcome === "accepted" } });
    await checkpoint();
    expect(store.calls).toEqual([]);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]).toMatchObject({ pendingUpload: true });
  });

  it.each(["rejected", "lost_response", "accepted"])("new full-photo intents require exact checkpoint acceptance across warm idle passes: %s", async outcome => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      const vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const sourcePath = path.join(vaultRoot, "fixture.jpg");
      await writeFile(sourcePath, "synthetic photo bytes");
      const measurement = await addMeasurement({ vaultRoot, attachments: [{ role: "media_1", sourcePath }],
        draft: { title: "Synthetic measurement", occurredAt: "2030-01-01T12:00:00.000Z", measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
      const photo = measurement.event.attachments![0]!.relativePath;
      vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
      const { calls, platform } = createRuntimePlatform();
      const store = createMealMediaStore(); platform.mediaStore = store.mediaStore;
      const complete = calls.completeSnapshotSession.getMockImplementation()!;
      calls.completeSnapshotSession.mockImplementationOnce(async input => {
        // Even a warm idle pass inside completion cannot release discovery.
        await deliverPendingMealMediaForTest(vaultRoot, store.mediaStore);
        expect(store.calls).toEqual([]);
        expect(input.checkpointRequest.inboxMediaRetentionWakeAt).toBe("2030-01-09T13:00:00.000Z");
        expect(input.checkpointRequest.nextWakeReason).toBe("inbox_media_retention");
        const completed = await complete(input);
        if (outcome === "lost_response") throw new Error("Synthetic lost checkpoint response");
        if (outcome === "rejected") completed.checkpoint.checkpointed = false;
        return completed;
      });
      const builder = createSnapshotArchiveBuilder();
      const options = createBridgeOptions({ platform, vaultRoot, snapshotArchiveBuilder: builder });
      const checkpoint = () => options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
      if (outcome === "lost_response") await expect(checkpoint()).rejects.toThrow("Synthetic lost checkpoint response");
      else await checkpoint();
      expect(vi.mocked(builder.buildEncryptedSnapshot).mock.calls[0]![0].archiveEntries)
        .toContainEqual(expect.objectContaining({ relativePath: photo }));
      await deliverPendingMealMediaForTest(vaultRoot, store.mediaStore);
      expect(store.calls.filter(call => call.operation === "put")).toHaveLength(outcome === "accepted" ? 1 : 0);
      if (outcome !== "accepted") {
        await checkpoint();
        await deliverPendingMealMediaForTest(vaultRoot, store.mediaStore);
      }
      expect(store.calls.filter(call => call.operation === "put")).toHaveLength(1);
      await checkpoint();
      expect(vi.mocked(builder.buildEncryptedSnapshot).mock.lastCall![0].archiveEntries.some(entry => entry.relativePath === photo)).toBe(false);
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]?.pendingUpload).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it.each([false, true])("shell meal deletion waits for an accepted tombstone checkpoint (restart=%s)", async restart => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      const vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const photoPath = path.join(path.dirname(vaultRoot), "fixture.png");
      await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
      const meal = await addMeal({ vaultRoot, photoPath, photoCapturedAt: new Date().toISOString() });
      await runMealPhotoMaintenance({ vaultRoot });
      vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
      const f = createPhotoCheckpointFixture(vaultRoot);
      await f.checkpoint(); await deliverPendingMealMediaForTest(vaultRoot, f.store.mediaStore);
      await f.checkpoint();
      const settled = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries;
      expect(settled).toHaveLength(2);
      const originals = await Promise.all(settled.map(entry => readFile(path.join(vaultRoot, entry.relativePath))));
      const baseline = f.archive();
      const sparse = await restorePhotoCheckpoint(baseline);
      for (const entry of settled) await expectMissing(path.join(sparse, entry.relativePath));
      // The shell mutation has no in-process hosted canonical receipt publisher.
      await runPhotoFixtureCli(vaultRoot, ["meal", "delete", meal.mealId]);
      f.calls.completeSnapshotSession.mockImplementationOnce(async input => {
        expect(f.store.bytes.size).toBe(2);
        return { snapshotRef: input.ref, checkpoint: { ...createCheckpointResponse({ snapshotRef: input.ref,
          userId: TEST_REQUEST.userId, version: TEST_REQUEST.workspaceVersion }), checkpointed: false } };
      });
      expect((await f.checkpoint()).checkpoint?.checkpointed).toBe(false);
      await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: f.store.mediaStore });
      expect(f.store.bytes.size).toBe(2); // Warm retry is still fenced.
      const restored = await restorePhotoCheckpoint(baseline);
      const materialize = createHostedArtifactMaterializer({ vaultRoot: restored, operatorHomeRoot: restored, mediaStore: f.store.mediaStore });
      expect((await materialize(settled.map(entry => entry.relativePath))).missingArtifactPaths.size).toBe(0);
      for (const [index, entry] of settled.entries()) expect(await readFile(path.join(restored, entry.relativePath))).toEqual(originals[index]);
      expect((await readEvent({ vaultRoot: restored, eventId: meal.event.id })).event.lifecycle?.state).not.toBe("deleted");
      expect((await f.checkpoint()).checkpoint?.checkpointed).toBe(true);
      expect(f.store.bytes.size).toBe(2);
      const wake = f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest;
      expect(wake.nextWakeReason).toBe("inbox_media_retention");
      expect(wake.nextWakeAt).toBe("2030-01-09T13:00:00.000Z");
      expect(wake.inboxMediaRetentionWakeAt).toBe(wake.nextWakeAt);
      const target = restart ? await restorePhotoCheckpoint(f.archive()) : vaultRoot;
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot: target })).entries.every(entry => entry.retirementPending)).toBe(true);
      vi.setSystemTime(new Date(wake.nextWakeAt!));
      const idle = await runPhotoIdleMaintenance(target, f.store);
      const cleanup = createPhotoCheckpointFixture(target, f.store);
      await cleanup.checkpoint(idle);
      expect(f.store.bytes.size).toBe(0);
      expect([...f.store.rows.values()].every(row => row.retired)).toBe(true);
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot: target })).entries).toEqual([]);
      expect(cleanup.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest).toMatchObject({
        inboxMediaRetentionWakeAt: null, nextWakeAt: null, nextWakeReason: null,
      });
    } finally { vi.useRealTimers(); }
  });

  it.each(["meal", "measurement"] as const)("public secondary references cannot extend or recreate the %s directory owner's intent", async kind => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      const vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const sourcePath = path.join(path.dirname(vaultRoot), "fixture.png");
      await writeFile(sourcePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
      const draft = { title: "Synthetic measurement", occurredAt: new Date().toISOString(), measurements: [{ metric: "weight", value: 70, unit: "kg" }] };
      const owner = kind === "meal" ? await addMeal({ vaultRoot, photoPath: sourcePath, photoCapturedAt: new Date().toISOString() })
        : await addMeasurement({ vaultRoot, attachments: [{ role: "media_1", sourcePath }], draft });
      const photo = owner.event.attachments![0]!;
      if (kind === "meal") await runMealPhotoMaintenance({ vaultRoot });
      const inputPath = path.join(vaultRoot, "secondary.jsonl");
      await writeFile(inputPath, JSON.stringify({ ...draft, kind: "measurement", recordedAt: new Date().toISOString(), attachments: [photo] }) + "\n");
      await runPhotoFixtureCli(vaultRoot, ["event", "import-jsonl", "--input", `@${inputPath}`, "--apply"]);
      if (kind === "measurement") {
        await upsertEvent({ vaultRoot, allowSpecializedKindRewrite: true,
          payload: { ...owner.event, attachments: [], rawRefs: [] } });
        expect((await readEvent({ vaultRoot, eventId: owner.event.id })).event.attachments ?? []).toEqual([]);
      }
      vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
      const f = createPhotoCheckpointFixture(vaultRoot);
      await f.checkpoint(); await deliverPendingMealMediaForTest(vaultRoot, f.store.mediaStore);
      if (kind === "meal") {
        expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.find(entry => entry.relativePath === photo.relativePath)?.expiresAt)
          .toBe("2030-04-01T12:00:00.000Z");
        await runPhotoFixtureCli(vaultRoot, ["meal", "delete", owner.event.kind === "meal" ? owner.event.mealId : "unreachable"]);
      }
      for (let pass = 0; pass < 3; pass++) {
        await f.checkpoint(); await deliverPendingMealMediaForTest(vaultRoot, f.store.mediaStore);
      }
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual([]);
      expect(f.store.bytes.size).toBe(0);
      if (kind === "measurement") {
        expect(f.store.calls).toEqual([]);
        expect(f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest.nextWakeAt).toBeNull();
        const restored = await restorePhotoCheckpoint(f.archive());
        expect(await readFile(path.join(restored, photo.relativePath))).toEqual(await readFile(sourcePath));
      } else expect([...f.store.rows.values()].every(row => row.retired)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("an unprovable source manifest keeps attachments inline without blocking unrelated checkpoint changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      const vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const photoPath = path.join(path.dirname(vaultRoot), "photo.jpg"), manifestPath = path.join(path.dirname(vaultRoot), "manifest.json");
      await writeFile(photoPath, "synthetic photo"); await writeFile(manifestPath, '{"source":"synthetic"}');
      const measurement = await addMeasurement({ vaultRoot,
        attachments: [{ role: "media_1", sourcePath: photoPath }, { role: "source", sourcePath: manifestPath }],
        draft: { title: "Synthetic measurement", occurredAt: new Date().toISOString(), measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
      const files = measurement.event.attachments!;
      const expected = await Promise.all(files.map(file => readFile(path.join(vaultRoot, file.relativePath))));
      vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
      await writeFile(path.join(vaultRoot, "note.md"), "unrelated saved change");
      const f = createPhotoCheckpointFixture(vaultRoot);
      expect((await f.checkpoint()).checkpoint?.checkpointed).toBe(true);
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual([]);
      expect(f.store.calls).toEqual([]);
      const restored = await restorePhotoCheckpoint(f.archive());
      expect(await readFile(path.join(restored, "note.md"), "utf8")).toBe("unrelated saved change");
      for (const [index, file] of files.entries()) expect(await readFile(path.join(restored, file.relativePath))).toEqual(expected[index]);
    } finally { vi.useRealTimers(); }
  });

  it.each(["put", "discovery"] as const)("a photo stalled at %s stops dedicated wakes across cold restores and uploads on ordinary idle", async stall => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      let vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const sourcePath = path.join(path.dirname(vaultRoot), "photo.jpg"); await writeFile(sourcePath, "synthetic stalled photo");
      const measurement = await addMeasurement({ vaultRoot, attachments: [{ role: "media_1", sourcePath }],
        draft: { title: "Synthetic measurement", occurredAt: new Date().toISOString(), measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
      const photo = measurement.event.attachments![0]!.relativePath;
      vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
      let f = createPhotoCheckpointFixture(vaultRoot);
      await f.checkpoint();
      for (let attempt = 1; attempt <= 5; attempt++) {
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
        let started!: () => void;
        const reached = new Promise<void>(resolve => { started = resolve; });
        const discovery = stall === "discovery" ? vi.spyOn(core, "visitEventLedgerShardRecordsInterruptible")
          .mockImplementation(async () => { started(); return await new Promise(() => {}); }) : null;
        f.store.hooks.before = async operation => { if (stall === "put" && operation === "put") { started(); await new Promise(() => {}); } };
        const persistRetry = vi.fn(async () => {});
        const running = runPhotoIdleMaintenance(vaultRoot, f.store, { persistRetry });
        await reached; await vi.advanceTimersByTimeAsync(2_000);
        const idle = await running;
        discovery?.mockRestore();
        if (attempt >= 5) expect(idle.nextWakeAt).toBeUndefined();
        const now = Date.now(); vi.useRealTimers(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
        const checkpoint = await f.checkpoint(idle);
        const request = f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest;
        if (attempt < 5) expect(request.nextWakeReason).toBe("inbox_media_retention");
        else {
          expect(request.inboxMediaRetentionWakeAt).toBeNull();
          expect(request.nextWakeAt).toBeNull();
          const workspace = { ...checkpoint.checkpoint!.workspace, inboxMediaRetentionWakeAt: null };
          expect(await withHostedMealMediaRetry(workspace, vaultRoot)).toEqual(workspace);
        }
        const restored = await restorePhotoCheckpoint(f.archive());
        expect((await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).entries[0]).toMatchObject({ uploadAttempts: attempt, pendingUpload: true });
        expect(await readFile(path.join(restored, photo), "utf8")).toBe("synthetic stalled photo");
        vaultRoot = restored;
        f = createPhotoCheckpointFixture(vaultRoot, f.store);
      }
      expect(f.store.calls.filter(call => call.operation === "put")).toHaveLength(stall === "put" ? 5 : 0);
      f.store.hooks.before = undefined;
      const persistRetry = vi.fn(async () => {});
      const idle = await runPhotoIdleMaintenance(vaultRoot, f.store, { processingMode: "default", persistRetry });
      expect(persistRetry).not.toHaveBeenCalled();
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]).toMatchObject({ uploadAttempts: 6, pendingUpload: false });
      expect([...f.store.bytes.values()].map(bytes => Buffer.from(bytes).toString())).toEqual(["synthetic stalled photo"]);
      await f.checkpoint(idle);
      expect(f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest.nextWakeAt).toBeNull();
      const restored = await restorePhotoCheckpoint(f.archive());
      await expectMissing(path.join(restored, photo));
    } finally { vi.useRealTimers(); }
  });

  it("an identity error during maintenance stops dedicated wakes at the persisted attempt cap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      const vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const sourcePath = path.join(path.dirname(vaultRoot), "photo.jpg");
      await writeFile(sourcePath, "synthetic identity photo");
      const measurement = await addMeasurement({ vaultRoot, attachments: [{ role: "media_1", sourcePath }],
        draft: { title: "Synthetic measurement", occurredAt: new Date().toISOString(), measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
      const photo = measurement.event.attachments![0]!.relativePath;
      vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
      const f = createPhotoCheckpointFixture(vaultRoot);
      await f.checkpoint();
      const manifestPath = path.join(path.dirname(vaultRoot), "manifest.json");
      await writeFile(manifestPath, '{"source":"synthetic"}');
      await addMeasurement({ vaultRoot, draft: { id: measurement.event.id, title: "Synthetic measurement",
        occurredAt: measurement.event.occurredAt, measurements: measurement.event.measurements },
        attachments: [{ role: "source", sourcePath: manifestPath }] });
      await expect(core.canonicalRawArtifactMatches({ vaultRoot,
        ...(await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]!,
      })).rejects.toMatchObject({ code: "RAW_MANIFEST_INVALID" });
      for (let attempt = 1; attempt <= 6; attempt++) {
        const reportRetentionIssue = vi.fn(async () => {});
        const persistRetry = vi.fn(async () => {});
        const idle = await runPhotoIdleMaintenance(vaultRoot, f.store, { reportRetentionIssue, persistRetry });
        if (attempt < 5) {
          expect(idle.nextWakeReason).toBe("inbox_media_retention");
          expect(reportRetentionIssue).toHaveBeenCalledWith(expect.objectContaining({ stage: "meal_photos", outcome: "failed" }));
        } else expect(idle.nextWakeAt).toBeUndefined();
        if (attempt > 5) expect(persistRetry).not.toHaveBeenCalled();
        await f.checkpoint(idle);
        if (attempt >= 5) expect(f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest).toMatchObject({
          inboxMediaRetentionWakeAt: null, nextWakeAt: null, nextWakeReason: null,
        });
        const restored = await restorePhotoCheckpoint(f.archive());
        expect((await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).entries[0]).toMatchObject({ uploadAttempts: attempt, pendingUpload: true });
        expect(await readFile(path.join(restored, photo), "utf8")).toBe("synthetic identity photo");
      }
      expect(f.store.calls).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it("dedicated wakes give 32 healthy thumbnails a delivery turn before charging their attempts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      let vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const photoPath = path.join(path.dirname(vaultRoot), "fixture.png");
      await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
      for (let i = 0; i < 32; i++) await addMeal({ vaultRoot, photoPath, photoCapturedAt: new Date().toISOString() });
      vi.setSystemTime(new Date("2030-04-02T12:00:00.000Z"));
      await runMealPhotoMaintenance({ vaultRoot, maxMeals: 32 });
      let f = createPhotoCheckpointFixture(vaultRoot);
      await f.checkpoint();
      const thumbnails = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries;
      expect(thumbnails).toHaveLength(32);
      const expected = await Promise.all(thumbnails.map(entry => readFile(path.join(vaultRoot, entry.relativePath))));
      // Each delivery fits alone; the second record crosses the shared deadline.
      f.store.hooks.before = async op => { if (op === "record" || op === "put") vi.setSystemTime(Date.now() + 750); };
      for (let pass = 0; pass < 34; pass++) {
        const wake = f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest.inboxMediaRetentionWakeAt;
        if (!wake) break;
        vi.setSystemTime(new Date(wake));
        vaultRoot = await restorePhotoCheckpoint(f.archive());
        f = createPhotoCheckpointFixture(vaultRoot, f.store);
        await f.checkpoint(await runPhotoIdleMaintenance(vaultRoot, f.store));
      }
      for (const [index, entry] of thumbnails.entries()) expect(await f.store.mediaStore.get(entry, { purpose: "workspace_media_materialization" })).toEqual(expected[index]);
      const settled = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries;
      expect(settled.every(entry => entry.pendingUpload === false)).toBe(true);
      for (const entry of settled) {
        const turns = f.store.calls.filter(call => call.operation === "put" && call.mediaId === entry.mediaId).length;
        expect(turns).toBe(1);
        expect(entry.uploadAttempts ?? 0).toBeLessThanOrEqual(turns);
      }
      expect(f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest.inboxMediaRetentionWakeAt).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it.each([false, true])("rotation preserves scheduled delivery at four attempts after cold restore (cleanupFirst=%s)", async cleanupFirst => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      let vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const photoPath = path.join(path.dirname(vaultRoot), "fixture.png");
      await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
      const meals = [];
      for (let i = 0; i < 2; i++) meals.push(await addMeal({ vaultRoot, photoPath, photoCapturedAt: new Date().toISOString() }));
      vi.setSystemTime(new Date("2030-04-02T12:00:00.000Z"));
      await runMealPhotoMaintenance({ vaultRoot, maxMeals: 2 });
      let f = createPhotoCheckpointFixture(vaultRoot);
      await f.checkpoint();
      const catalogue = await readHostedMediaReferenceCatalogue({ vaultRoot });
      const [thumbnail, tombstone] = catalogue.entries.sort((a, b) => a.mediaId.localeCompare(b.mediaId));
      const expected = await readFile(path.join(vaultRoot, thumbnail!.relativePath));
      // Pending cleanup models a lost PUT acknowledgement before canonical deletion.
      await f.store.mediaStore.record!(tombstone!);
      await f.store.mediaStore.put({ ...tombstone!, bytes: await readFile(path.join(vaultRoot, tombstone!.relativePath)) });
      const owner = core.inferRawAssetOwnerFromDirectory(path.posix.dirname(tombstone!.relativePath))!;
      await deleteEvent({ vaultRoot, eventId: meals.find(meal => meal.event.mealId === owner.id)!.event.id });
      thumbnail!.uploadAttempts = 4;
      catalogue.mealUploadCursor = cleanupFirst ? thumbnail!.mediaId : tombstone!.mediaId;
      await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue });
      await f.checkpoint();
      f.store.hooks.before = async () => { vi.setSystemTime(Date.now() + 750); };
      let wakes = 0;
      for (; wakes < 3; wakes++) {
        const wake = f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest.inboxMediaRetentionWakeAt;
        if (!wake) break;
        vi.setSystemTime(new Date(wake));
        vaultRoot = await restorePhotoCheckpoint(f.archive());
        f = createPhotoCheckpointFixture(vaultRoot, f.store);
        const idle = await runPhotoIdleMaintenance(vaultRoot, f.store);
        if (!idle.nextWakeAt) expect(await f.store.mediaStore.get(thumbnail!, { purpose: "workspace_media_materialization" })).toEqual(expected);
        await f.checkpoint(idle);
      }
      expect(wakes).toBe(2);
      expect(f.store.rows.get(tombstone!.mediaId)?.retired).toBe(true);
      expect(await f.store.mediaStore.get(tombstone!, { purpose: "workspace_media_materialization" })).toBeNull();
      expect(await f.store.mediaStore.get(thumbnail!, { purpose: "workspace_media_materialization" })).toEqual(expected);
      const settled = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries;
      expect(settled).toEqual([expect.objectContaining({ mediaId: thumbnail!.mediaId, pendingUpload: false })]);
      expect(settled[0]!.uploadAttempts).toBeLessThanOrEqual(5);
      expect(f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest.inboxMediaRetentionWakeAt).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("scheduled rotation delivers a healthy thumbnail while DELETE repeatedly exceeds the deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      let vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const photoPath = path.join(path.dirname(vaultRoot), "fixture.png");
      await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
      const meals = [];
      for (let i = 0; i < 2; i++) meals.push(await addMeal({ vaultRoot, photoPath, photoCapturedAt: new Date().toISOString() }));
      vi.setSystemTime(new Date("2030-04-02T12:00:00.000Z"));
      await runMealPhotoMaintenance({ vaultRoot, maxMeals: 2 });
      let f = createPhotoCheckpointFixture(vaultRoot);
      await f.checkpoint();
      const catalogue = await readHostedMediaReferenceCatalogue({ vaultRoot });
      const [tombstone, thumbnail] = catalogue.entries.sort((a, b) => a.mediaId.localeCompare(b.mediaId));
      const expected = await readFile(path.join(vaultRoot, thumbnail!.relativePath));
      await f.store.mediaStore.record!(tombstone!);
      await f.store.mediaStore.put({ ...tombstone!, bytes: await readFile(path.join(vaultRoot, tombstone!.relativePath)) });
      const owner = core.inferRawAssetOwnerFromDirectory(path.posix.dirname(tombstone!.relativePath))!;
      await deleteEvent({ vaultRoot, eventId: meals.find(meal => meal.event.mealId === owner.id)!.event.id });
      catalogue.mealUploadCursor = thumbnail!.mediaId;
      await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue });
      await f.checkpoint();
      let deleteAttempts = 0;
      f.store.hooks.before = async op => {
        if (op === "delete") {
          deleteAttempts += 1;
          vi.setSystemTime(Date.now() + 2_001);
          throw mediaFailure("Synthetic DELETE timeout");
        }
      };
      for (let wakeNumber = 0; wakeNumber < 3; wakeNumber++) {
        const wake = f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest.inboxMediaRetentionWakeAt;
        expect(wake).not.toBeNull();
        vi.setSystemTime(new Date(wake!));
        vaultRoot = await restorePhotoCheckpoint(f.archive());
        f = createPhotoCheckpointFixture(vaultRoot, f.store);
        await f.checkpoint(await runPhotoIdleMaintenance(vaultRoot, f.store));
      }
      expect(deleteAttempts).toBeGreaterThanOrEqual(2);
      expect(await f.store.mediaStore.get(thumbnail!, { purpose: "workspace_media_materialization" })).toEqual(expected);
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toContainEqual(expect.objectContaining({
        mediaId: tombstone!.mediaId, pendingUpload: true,
      }));
      expect(f.store.rows.get(tombstone!.mediaId)?.retired).toBe(false);
      f.store.hooks.before = undefined;
      const wake = f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest.inboxMediaRetentionWakeAt;
      expect(wake).not.toBeNull();
      vi.setSystemTime(new Date(wake!));
      vaultRoot = await restorePhotoCheckpoint(f.archive());
      f = createPhotoCheckpointFixture(vaultRoot, f.store);
      await f.checkpoint(await runPhotoIdleMaintenance(vaultRoot, f.store));
      expect(await f.store.mediaStore.get(tombstone!, { purpose: "workspace_media_materialization" })).toBeNull();
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual([
        expect.objectContaining({ mediaId: thumbnail!.mediaId, pendingUpload: false }),
      ]);
      expect(f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest).toMatchObject({
        inboxMediaRetentionWakeAt: null, nextWakeAt: null, nextWakeReason: null,
      });
    } finally { vi.useRealTimers(); }
  });

  it.each([false, true])("a cold-restored pending tombstone above the cap settles in rotation despite stalled discovery (mixed=%s)", async mixed => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      let vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const photoPath = path.join(path.dirname(vaultRoot), "fixture.png");
      await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
      const meal = await addMeal({ vaultRoot, photoPath, photoCapturedAt: new Date().toISOString() });
      const fullPath = meal.event.attachments![0]!.relativePath;
      if (mixed) await addMeasurement({ vaultRoot, attachments: [{ role: "media_1", sourcePath: photoPath }],
        draft: { title: "Synthetic measurement", occurredAt: new Date().toISOString(), measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
      await runMealPhotoMaintenance({ vaultRoot });
      vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
      let f = createPhotoCheckpointFixture(vaultRoot);
      await f.checkpoint();
      const catalogue = await readHostedMediaReferenceCatalogue({ vaultRoot });
      const full = catalogue.entries.find(entry => entry.relativePath === fullPath)!;
      // Model a lost full-photo PUT acknowledgement and an already settled thumbnail.
      for (const entry of catalogue.entries.filter(entry => entry.relativePath.startsWith("raw/meals/"))) {
        await f.store.mediaStore.record!(entry);
        await f.store.mediaStore.put({ ...entry, bytes: await readFile(path.join(vaultRoot, entry.relativePath)) });
        if (entry !== full) entry.pendingUpload = false;
      }
      full.uploadAttempts = 6;
      // Put the live entry first so stalled discovery must yield to cleanup next wake.
      catalogue.mealUploadCursor = full.mediaId;
      await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue });
      vi.setSystemTime(new Date("2030-04-02T12:00:00.000Z"));
      await runMealPhotoMaintenance({ vaultRoot });
      expect(await core.canonicalRawArtifactIsPrivacyTombstone({ vaultRoot, relativePath: fullPath })).toBe(true);
      await f.checkpoint();
      for (let wakeNumber = 0; wakeNumber < (mixed ? 2 : 1); wakeNumber++) {
        const wake = f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest.inboxMediaRetentionWakeAt;
        expect(wake).not.toBeNull();
        vi.setSystemTime(new Date(wake!));
        vaultRoot = await restorePhotoCheckpoint(f.archive());
        f = createPhotoCheckpointFixture(vaultRoot, f.store);
        expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.find(entry => entry.mediaId === full.mediaId))
          .toMatchObject({ pendingUpload: true, uploadAttempts: 6 });
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
        const discovery = vi.spyOn(core, "visitEventLedgerShardRecordsInterruptible").mockImplementation(async () => {
          await vi.advanceTimersByTimeAsync(2_000);
          return await new Promise(() => {});
        });
        f.store.hooks.before = async op => {
          if (op === "delete") expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.some(entry => entry.mediaId === full.mediaId)).toBe(true);
        };
        const idle = await runPhotoIdleMaintenance(vaultRoot, f.store);
        expect(discovery).toHaveBeenCalledTimes(mixed ? 1 : 0);
        discovery.mockRestore();
        const now = Date.now(); vi.useRealTimers(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
        await f.checkpoint(idle);
      }
      expect(await f.store.mediaStore.get(full, { purpose: "workspace_media_materialization" })).toBeNull();
      expect(f.store.rows.get(full.mediaId)?.retired).toBe(true);
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.some(entry => entry.mediaId === full.mediaId)).toBe(false);
      if (mixed) {
        const restored = await restorePhotoCheckpoint(f.archive());
        const live = (await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).entries.find(entry => entry.relativePath.startsWith("raw/measurements/"))!;
        expect(live.pendingUpload).toBe(true);
        expect(await readFile(path.join(restored, live.relativePath))).toEqual(await readFile(photoPath));
        expect(f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest.nextWakeReason).toBe("inbox_media_retention");
      } else expect(f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest).toMatchObject({
        inboxMediaRetentionWakeAt: null, nextWakeAt: null, nextWakeReason: null,
      });
    } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
  });

  it("a tombstoned thumbnail retains its cleanup wake after a lost PUT acknowledgement and exhausted attempts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      let vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const photoPath = path.join(path.dirname(vaultRoot), "fixture.png");
      await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
      const meal = await addMeal({ vaultRoot, photoPath, photoCapturedAt: new Date().toISOString() });
      await runMealPhotoMaintenance({ vaultRoot });
      let f = createPhotoCheckpointFixture(vaultRoot);
      await f.checkpoint();
      f.store.hooks.after = async op => { if (op === "put") throw mediaFailure("Synthetic lost PUT acknowledgement"); };
      await runPhotoIdleMaintenance(vaultRoot, f.store);
      expect(f.store.bytes.size).toBe(1);
      expect(f.store.activeUnlimited()).toBe(1);
      f.store.hooks.after = undefined;
      const catalogue = await readHostedMediaReferenceCatalogue({ vaultRoot });
      catalogue.entries[0]!.uploadAttempts = 5;
      await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue });
      await deleteEvent({ vaultRoot, eventId: meal.event.id });
      f.store.hooks.before = async op => { if (op === "record") { vi.setSystemTime(Date.now() + 2_000); throw mediaFailure("Synthetic registration outage"); } };
      for (let pass = 0; pass < 4; pass++) {
        await f.checkpoint(await runPhotoIdleMaintenance(vaultRoot, f.store));
        const wake = f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest.inboxMediaRetentionWakeAt;
        expect(wake).not.toBeNull();
        vi.setSystemTime(new Date(wake!));
        vaultRoot = await restorePhotoCheckpoint(f.archive());
        f = createPhotoCheckpointFixture(vaultRoot, f.store);
        expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries[0]).toMatchObject({ pendingUpload: true, uploadAttempts: 6 + pass });
      }
      f.store.sweep(Date.now());
      expect(f.store.activeUnlimited()).toBe(1); expect(f.store.bytes.size).toBe(1);
      f.store.hooks.before = undefined;
      await f.checkpoint(await runPhotoIdleMaintenance(vaultRoot, f.store));
      expect(f.store.calls.filter(call => call.operation === "put")).toHaveLength(1);
      expect(f.store.calls.at(-2)).toMatchObject({ operation: "record", expiresAt: new Date(0).toISOString() });
      expect(f.store.calls.at(-1)?.operation).toBe("delete");
      expect(f.store.bytes.size).toBe(0);
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual([]);
      expect(f.calls.completeSnapshotSession.mock.lastCall![0].checkpointRequest).toMatchObject({ inboxMediaRetentionWakeAt: null, nextWakeAt: null });
    } finally { vi.useRealTimers(); }
  });

  it.each(["media", "authority"] as const)("retirement DELETE handles %s failures at the checkpoint boundary", async failure => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      const vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const photoPath = path.join(path.dirname(vaultRoot), "fixture.png");
      await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
      const meal = await addMeal({ vaultRoot, photoPath, photoCapturedAt: new Date().toISOString() });
      await runMealPhotoMaintenance({ vaultRoot });
      vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
      const f = createPhotoCheckpointFixture(vaultRoot);
      await f.checkpoint(); await deliverPendingMealMediaForTest(vaultRoot, f.store.mediaStore);
      await f.checkpoint();
      await deleteEvent({ vaultRoot, eventId: meal.event.id });
      await f.checkpoint();
      const pointers = (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries;
      expect(pointers).toHaveLength(2); expect(pointers.every(entry => entry.retirementPending)).toBe(true);
      await writeFile(path.join(vaultRoot, "note.md"), "unrelated synthetic change");
      const error = failure === "media" ? mediaFailure("Synthetic DELETE unavailable")
        : Object.assign(new Error("Synthetic stale authority"), { code: "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY" });
      f.store.hooks.before = async op => { if (op === "delete") throw error; };
      if (failure === "authority") {
        const completed = f.calls.completeSnapshotSession.mock.calls.length;
        await expect(f.checkpoint()).rejects.toBe(error);
        expect(f.calls.completeSnapshotSession).toHaveBeenCalledTimes(completed);
        return;
      }
      expect((await f.checkpoint()).checkpoint?.checkpointed).toBe(true);
      expect(f.store.bytes.size).toBe(2);
      const restored = await restorePhotoCheckpoint(f.archive());
      expect(await readFile(path.join(restored, "note.md"), "utf8")).toBe("unrelated synthetic change");
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).entries).toEqual(pointers);
      f.store.hooks.before = undefined;
      const retry = createPhotoCheckpointFixture(restored, f.store);
      await retry.checkpoint();
      expect(f.store.bytes.size).toBe(0);
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).entries).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it.each(["authority", "unexpected", "media"] as const)("idle photo maintenance propagates control failures and records only item failures: %s", async failure => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T12:00:00.000Z"));
      const vaultRoot = await createVaultRoot();
      await initializeVault({ vaultRoot, timezone: "UTC" });
      const sourcePath = path.join(path.dirname(vaultRoot), "photo.jpg"); await writeFile(sourcePath, "synthetic photo");
      await addMeasurement({ vaultRoot, attachments: [{ role: "media_1", sourcePath }],
        draft: { title: "Synthetic measurement", occurredAt: new Date().toISOString(), measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
      vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
      const f = createPhotoCheckpointFixture(vaultRoot); await f.checkpoint();
      const error = failure === "media" ? mediaFailure() : failure === "authority"
        ? Object.assign(new Error("Synthetic stale authority"), { code: "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY" }) : new Error("Synthetic unexpected failure");
      f.store.hooks.before = async () => { throw error; };
      const reportRetentionIssue = vi.fn(async () => {});
      const laterMaintenance = vi.spyOn(core, "runGeneratedImageCaptureRetention");
      const running = runPhotoIdleMaintenance(vaultRoot, f.store, { reportRetentionIssue });
      if (failure === "media") {
        expect(await running).toMatchObject({ nextWakeReason: "inbox_media_retention" });
        expect(reportRetentionIssue).toHaveBeenCalledWith(expect.objectContaining({ stage: "meal_photos", outcome: "failed" }));
      } else {
        await expect(running).rejects.toBe(error);
        expect(reportRetentionIssue).not.toHaveBeenCalled();
      }
      expect(laterMaintenance).not.toHaveBeenCalled();
      expect(f.store.calls.map(call => call.operation)).toEqual(["record"]);
    } finally { vi.useRealTimers(); }
  });

  it("fails closed when the mailbox decoder is missing", () => {
    const { platform } = createRuntimePlatform();

    expect(() => createHostedWorkspaceRuntimeBridgeJobOptions({
      platform,
      request: TEST_REQUEST,
      runtime: {},
      snapshotArchiveBuilder: createSnapshotArchiveBuilder(),
      vaultRoot: path.join(tmpdir(), "hosted-invocation-bridge-unused"),
      waitForBackgroundAssistantWork: async () => undefined,
    })).toThrow("Hosted mailbox payload decoder is required for this invocation.");
  });

  it("rejects a pre-v2 checkpoint baseline before starting a snapshot session", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const artifactGet = vi.spyOn(platform.artifactStore, "get");
    const options = createBridgeOptions({
      platform,
      request: {
        ...TEST_REQUEST,
        workspace: createCheckpointResponse({
          snapshotRef: { hash: "a".repeat(64), key: "legacy/base", size: 1, updatedAt: "2026-05-01T00:00:00.000Z" },
          userId: TEST_REQUEST.userId,
          version: TEST_REQUEST.workspaceVersion,
        }).workspace,
      },
      vaultRoot,
    });
    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .rejects.toThrow("requires a v2 snapshot reference");
    expect(calls.startSnapshotSession).not.toHaveBeenCalled();
    expect(artifactGet).not.toHaveBeenCalled();
  });

  it.each(["missing", "empty", "directory", "missing-root"])("rejects a replacement with %s canonical vault metadata before archive upload", async (kind) => {
    const vaultRoot = await createVaultRoot();
    await writeFile(path.join(vaultRoot, "vault.json"), "{}");
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const options = createBridgeOptions({ platform, vaultRoot, snapshotArchiveBuilder });
    const baseline = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    await rm(path.join(vaultRoot, "vault.json"));
    if (kind === "empty") await writeFile(path.join(vaultRoot, "vault.json"), "");
    if (kind === "directory") await mkdir(path.join(vaultRoot, "vault.json"));
    if (kind === "missing-root") await rm(vaultRoot, { recursive: true });
    vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mockClear();
    calls.putSnapshotObjectDirect.mockClear();
    calls.completeSnapshotSession.mockClear();

    await expect(options.createCheckpointSnapshot({
      ...createCheckpointInput("idle_shutdown"), currentSnapshotRef: baseline.snapshotRef,
    })).rejects.toMatchObject({ code: "workspace_snapshot_vault_missing" });
    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).not.toHaveBeenCalled();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
    expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
  });

  it("allows canonical file deletion while retaining vault metadata in a replacement", async () => {
    const vaultRoot = await createVaultRoot();
    await writeFile(path.join(vaultRoot, "vault.json"), "{}");
    const { calls, platform } = createRuntimePlatform();
    const options = createBridgeOptions({ platform, vaultRoot });
    const baseline = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    await rm(path.join(vaultRoot, "note.md"));
    await expect(options.createCheckpointSnapshot({
      ...createCheckpointInput("idle_shutdown"), currentSnapshotRef: baseline.snapshotRef,
    })).resolves.toHaveProperty("snapshotRef");
    expect(calls.completeSnapshotSession).toHaveBeenCalledTimes(2);
  });

  it("waits for assistant background work before snapshot publication", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    let releaseBackgroundWork!: () => void;
    const backgroundWorkFinished = new Promise<void>((resolve) => {
      releaseBackgroundWork = resolve;
    });
    const waitForBackgroundAssistantWork = vi.fn(
      async () => await backgroundWorkFinished,
    );
    const options = createBridgeOptions({
      platform,
      vaultRoot,
      waitForBackgroundAssistantWork,
    });

    const checkpoint = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    );
    await vi.waitFor(() => {
      expect(waitForBackgroundAssistantWork).toHaveBeenCalledExactlyOnceWith(null);
    });
    expect(calls.startSnapshotSession).not.toHaveBeenCalled();

    releaseBackgroundWork();
    await expect(checkpoint).resolves.toMatchObject({
      snapshotRef: {
        snapshotId: "snapshot_bridge",
      },
    });
    expect(calls.startSnapshotSession).toHaveBeenCalledOnce();
  });

  it("forwards checkpoint interruption without opening a snapshot session", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const checkpointAbort = new AbortController();
    const interruption = new Error("checkpoint interrupted");
    const waitForBackgroundAssistantWork = vi.fn(
      async (signal: AbortSignal | null) => {
        expect(signal).toBe(checkpointAbort.signal);
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );
    const options = createBridgeOptions({
      platform,
      vaultRoot,
      waitForBackgroundAssistantWork,
    });

    const checkpoint = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: checkpointAbort.signal },
    );
    await vi.waitFor(() => {
      expect(waitForBackgroundAssistantWork).toHaveBeenCalledExactlyOnceWith(
        checkpointAbort.signal,
      );
    });

    checkpointAbort.abort(interruption);
    await expect(checkpoint).rejects.toBe(interruption);
    expect(calls.startSnapshotSession).not.toHaveBeenCalled();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
    expect(calls.logWrite).not.toHaveBeenCalled();
  });

  it("retains background work across checkpoint interruption before publishing the retry", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    let releaseBackgroundWork!: () => void;
    const retainedBackgroundWork = new Promise<void>((resolve) => {
      releaseBackgroundWork = resolve;
    });
    const waitForBackgroundAssistantWork = vi.fn(
      async (signal: AbortSignal | null) => {
        if (!signal) {
          await retainedBackgroundWork;
          return;
        }
        await Promise.race([
          retainedBackgroundWork,
          new Promise<void>((_resolve, reject) => {
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
        ]);
      },
    );
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
      waitForBackgroundAssistantWork,
    });
    const firstCheckpointAbort = new AbortController();
    const interruption = new Error("checkpoint interrupted");

    const firstCheckpoint = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: firstCheckpointAbort.signal },
    );
    await vi.waitFor(() => {
      expect(waitForBackgroundAssistantWork).toHaveBeenCalledExactlyOnceWith(
        firstCheckpointAbort.signal,
      );
    });
    firstCheckpointAbort.abort(interruption);
    await expect(firstCheckpoint).rejects.toBe(interruption);

    const retryCheckpoint = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    );
    await vi.waitFor(() => {
      expect(waitForBackgroundAssistantWork).toHaveBeenCalledTimes(2);
    });
    expect(waitForBackgroundAssistantWork).toHaveBeenLastCalledWith(null);
    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).not.toHaveBeenCalled();
    expect(calls.startSnapshotSession).not.toHaveBeenCalled();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();

    releaseBackgroundWork();
    await expect(retryCheckpoint).resolves.toMatchObject({
      snapshotRef: {
        snapshotId: "snapshot_bridge",
      },
    });
    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).toHaveBeenCalledOnce();
    expect(calls.startSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).toHaveBeenCalledOnce();
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
  });

  it("rejects non-idle checkpoints before opening a snapshot session", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const options = createBridgeOptions({
      platform,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("import"),
    )).rejects.toThrow(
      "Hosted workspace snapshot construction is idle-shutdown only.",
    );
    await expect(options.createCheckpointSnapshot(
      // @ts-expect-error Intentionally verifies the JavaScript boundary fails closed.
      createCheckpointInput("canonical_runtime_commit"),
    )).rejects.toThrow(
      "Hosted workspace snapshot construction is idle-shutdown only.",
    );

    expect(calls.startSnapshotSession).not.toHaveBeenCalled();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();
    expect(calls.logWrite).not.toHaveBeenCalled();
  });

  const staleLeaseMutations = [
    {
      code: "stale_attempt",
      mutate: (lease: HostedRuntimeBridgeCheckpointLease) => ({
        ...lease,
        attemptId: "attempt_stale",
      }),
    },
    {
      code: "stale_lease_generation",
      mutate: (lease: HostedRuntimeBridgeCheckpointLease) => ({
        ...lease,
        leaseGeneration: "5",
      }),
    },
    {
      code: "stale_workspace_version",
      mutate: (lease: HostedRuntimeBridgeCheckpointLease) => ({
        ...lease,
        workspaceVersion: "8",
      }),
    },
    {
      code: "stale_user",
      mutate: (lease: HostedRuntimeBridgeCheckpointLease) => ({
        ...lease,
        userId: "member_stale",
      }),
    },
  ] satisfies readonly {
    code: HostedRuntimeBridgeCheckpointLeaseErrorCode;
    mutate(lease: HostedRuntimeBridgeCheckpointLease): HostedRuntimeBridgeCheckpointLease;
  }[];

  const staleLeaseStages = [
    {
      expectedAbortCount: 0,
      expectedCompleteCount: 0,
      expectedPutCount: 0,
      expectedStartCount: 0,
      staleReadIndex: 1,
      stage: "before_snapshot",
    },
    {
      expectedAbortCount: 1,
      expectedCompleteCount: 0,
      expectedPutCount: 0,
      expectedStartCount: 1,
      staleReadIndex: 2,
      stage: "before_direct_r2_put",
    },
    {
      expectedAbortCount: 1,
      expectedCompleteCount: 0,
      expectedPutCount: 1,
      expectedStartCount: 1,
      staleReadIndex: 3,
      stage: "before_web_checkpoint",
    },
  ] satisfies readonly {
    expectedAbortCount: number;
    expectedCompleteCount: number;
    expectedPutCount: number;
    expectedStartCount: number;
    staleReadIndex: number;
    stage: HostedRuntimeBridgeCheckpointLeaseStage;
  }[];

  for (const stageCase of staleLeaseStages) {
    for (const staleMutation of staleLeaseMutations) {
      it(`rejects ${staleMutation.code} at ${stageCase.stage}`, async () => {
        const vaultRoot = await createVaultRoot();
        const { calls, platform } = createRuntimePlatform();
        let readCount = 0;
        const currentLease = createLease();
        const readCurrentLease = vi.fn(async () => {
          readCount += 1;
          return readCount === stageCase.staleReadIndex
            ? staleMutation.mutate(currentLease)
            : currentLease;
        });
        const options = createBridgeOptions({
          platform,
          readCurrentLease,
          vaultRoot,
        });

        const error = await expectLeaseFailure(
          options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")),
          {
            code: staleMutation.code,
            stage: stageCase.stage,
          },
        );

        expect(error.postWebCheckpoint).toBeUndefined();
        expect(calls.startSnapshotSession).toHaveBeenCalledTimes(
          stageCase.expectedStartCount,
        );
        expect(calls.putSnapshotObjectDirect).toHaveBeenCalledTimes(
          stageCase.expectedPutCount,
        );
        expect(calls.completeSnapshotSession).toHaveBeenCalledTimes(
          stageCase.expectedCompleteCount,
        );
        expect(calls.abortSnapshotSession).toHaveBeenCalledTimes(
          stageCase.expectedAbortCount,
        );
      });
    }
  }

  it.each(
    ([
      { phase: "session_start_request", stage: "session" },
      { phase: "session_complete_request", stage: "checkpoint" },
    ] as const).flatMap(({ phase, stage }) => [
      ...([
        ["normal", 6_000, 6_000],
        ["long", 120_000, 120_000],
        ["zero", 0, 0],
        ["largest safe integer", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
        ["absent", undefined, undefined],
        ["null", null, undefined],
        ["string", "120000", undefined],
        ["negative", -1, undefined],
        ["fractional", 1.5, undefined],
        ["NaN", Number.NaN, undefined],
        ["infinite", Number.POSITIVE_INFINITY, undefined],
        ["negative infinite", Number.NEGATIVE_INFINITY, undefined],
        ["unsafe integer", Number.MAX_SAFE_INTEGER + 1, undefined],
      ] as const).map(([label, timeoutMs, expectedTimeoutMs]) => ({
        label,
        phase,
        stage,
        timeoutMs,
        expectedPhase: phase,
        expectedTimeoutMs,
      })),
      {
        label: "unknown phase",
        phase: `${phase}_unknown`,
        stage,
        timeoutMs: 120_000,
        expectedPhase: undefined,
        expectedTimeoutMs: undefined,
      },
      {
        label: "non-string phase",
        phase: 120_000,
        stage,
        timeoutMs: 120_000,
        expectedPhase: undefined,
        expectedTimeoutMs: undefined,
      },
    ]),
  )("preserves safe snapshot $stage diagnostics with $label metadata", async ({
    phase,
    stage,
    timeoutMs,
    expectedPhase,
    expectedTimeoutMs,
  }) => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const failure = Object.assign(new Error("Synthetic snapshot session failure."), {
      phase,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    if (stage === "session") {
      calls.startSnapshotSession.mockRejectedValueOnce(failure);
    } else {
      calls.completeSnapshotSession.mockRejectedValueOnce(failure);
    }
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    )).rejects.toBe(failure);

    const lifecycleEntries = calls.logWrite.mock.calls
      .flatMap(([request]) => request.entries)
      .filter((entry) => entry.eventCode.startsWith("checkpoint.snapshot_"));
    expect(lifecycleEntries).toEqual([
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        redactedJson: expect.objectContaining({
          snapshotMode: "workspace_snapshot_v2",
          snapshotStage: stage,
        }),
      }),
    ]);
    const redactedJson = lifecycleEntries[0]?.redactedJson;
    const expectedPrefix = stage === "session"
      ? "snapshotSessionStart"
      : "snapshotSessionComplete";
    for (const prefix of ["snapshotSessionStart", "snapshotSessionComplete"]) {
      if (prefix === expectedPrefix && expectedPhase !== undefined) {
        expect(redactedJson).toHaveProperty(`${prefix}FailurePhase`, expectedPhase);
      } else {
        expect(redactedJson).not.toHaveProperty(`${prefix}FailurePhase`);
      }
      if (prefix === expectedPrefix && expectedTimeoutMs !== undefined) {
        expect(redactedJson).toHaveProperty(`${prefix}TimeoutMs`, expectedTimeoutMs);
      } else {
        expect(redactedJson).not.toHaveProperty(`${prefix}TimeoutMs`);
      }
    }
    expect(redactedJson).not.toHaveProperty("snapshotUploadFailurePhase");
  });

  it.each([
    { phase: "synthetic-private-upload-phase", shape: "own" },
    { phase: 42, shape: "own" },
    { phase: undefined, shape: "own" },
    { phase: "upload_transfer", shape: "inherited" },
    { phase: "upload_transfer", shape: "accessor" },
  ])("omits untrusted upload failure phase metadata: $shape / $phase", async ({ phase, shape }) => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const failure = new Error("Synthetic snapshot upload failure.");
    const phaseGetter = vi.fn(() => phase);
    if (shape === "inherited") {
      Object.setPrototypeOf(failure, Object.assign(new Error(), { phase }));
    } else {
      Object.defineProperty(failure, "phase", {
        enumerable: true,
        ...(shape === "accessor" ? { get: phaseGetter } : { value: phase }),
      });
    }
    calls.putSnapshotObjectDirect.mockRejectedValueOnce(failure);
    const options = createBridgeOptions({ platform, vaultRoot });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    )).rejects.toBe(failure);

    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    const failures = entries.filter((entry) => entry.eventCode === "checkpoint.snapshot_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.redactedJson).toHaveProperty("snapshotStage", "upload");
    expect(failures[0]?.redactedJson).not.toHaveProperty("snapshotUploadFailurePhase");
    expect(JSON.stringify(entries)).not.toContain("synthetic-private-upload-phase");
    expect(phaseGetter).not.toHaveBeenCalled();
  });

  it("emits one bounded failure record at each fixed snapshot lifecycle stage", async () => {
    const failureCases = [
      { sessionPhase: "session_start_request", stage: "session" },
      { sessionPhase: "session_start_response_decode", stage: "session" },
      { stage: "archive" },
      { uploadPhase: "upload_prepare", stage: "upload" },
      { uploadPhase: "upload_presign", stage: "upload" },
      { uploadPhase: "upload_transfer", stage: "upload" },
      { uploadPhase: "upload_receipt", stage: "upload" },
      { stage: "checkpoint" },
    ] as const;

    for (const failureCase of failureCases) {
      const expectedStage = failureCase.stage;
      const vaultRoot = await createVaultRoot();
      const { calls, platform } = createRuntimePlatform();
      const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
      const failure = new Error(
        `Synthetic ${expectedStage} failure.`,
      );
      if (expectedStage === "session") {
        Object.assign(failure, {
          phase: failureCase.sessionPhase,
          timeoutMs: 6_000,
        });
      } else if (expectedStage === "upload") {
        Object.assign(failure, { phase: failureCase.uploadPhase, timeoutMs: 6_000 });
      } else if (expectedStage === "checkpoint") {
        Object.assign(failure, {
          phase: "session_complete_request",
          timeoutMs: 30_000,
        });
      }

      if (expectedStage === "session") {
        calls.startSnapshotSession.mockRejectedValueOnce(failure);
      } else if (expectedStage === "archive") {
        vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot)
          .mockRejectedValueOnce(failure);
      } else if (expectedStage === "upload") {
        calls.putSnapshotObjectDirect.mockRejectedValueOnce(failure);
      } else {
        calls.completeSnapshotSession.mockRejectedValueOnce(failure);
      }

      const options = createBridgeOptions({
        platform,
        snapshotArchiveBuilder,
        vaultRoot,
      });

      await expect(options.createCheckpointSnapshot(
        createCheckpointInput("idle_shutdown"),
      )).rejects.toBe(failure);

      const lifecycleEntries = calls.logWrite.mock.calls
        .flatMap(([request]) => request.entries)
        .filter((entry) => entry.eventCode.startsWith("checkpoint.snapshot_"));
      expect(lifecycleEntries).toEqual([
        expect.objectContaining({
          eventCode: "checkpoint.snapshot_failed",
          redactedJson: expect.objectContaining({
            snapshotMode: "workspace_snapshot_v2",
            ...(expectedStage === "session"
              ? {
                  snapshotSessionStartElapsedMs: expect.any(Number),
                  snapshotSessionStartFailurePhase: failureCase.sessionPhase,
                  snapshotSessionStartTimeoutMs: 6_000,
                }
              : expectedStage === "checkpoint"
                ? {
                    snapshotSessionCompleteElapsedMs: expect.any(Number),
                    snapshotSessionCompleteFailurePhase: "session_complete_request",
                    snapshotSessionCompleteTimeoutMs: 30_000,
                  }
              : {}),
            snapshotStage: expectedStage,
            ...(expectedStage === "upload"
              ? { snapshotUploadFailurePhase: failureCase.uploadPhase }
              : {}),
          }),
        }),
      ]);
      expect(lifecycleEntries[0]?.redactedJson).not.toHaveProperty("snapshotUploadTimeoutMs");
      expect(lifecycleEntries.some((entry) =>
        entry.eventCode === "checkpoint.snapshot_plan"
        || entry.eventCode === "checkpoint.snapshot_started"
      )).toBe(false);
    }
  });

  it("retains local checkpoint-recording failure provenance without inventing a timeout", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const recordFailureCause = Object.freeze(
      new Error("Synthetic local checkpoint recording cause."),
    );
    const failure = Object.assign(
      new Error("Hosted workspace snapshot session start failed.", {
        cause: recordFailureCause,
      }),
      { phase: "session_complete_record_checkpoint" },
    );
    calls.completeSnapshotSession.mockRejectedValueOnce(failure);
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder: createSnapshotArchiveBuilder(),
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    )).rejects.toBe(failure);

    expect(failure.cause).toBe(recordFailureCause);
    const lifecycleEntries = calls.logWrite.mock.calls
      .flatMap(([request]) => request.entries)
      .filter((entry) => entry.eventCode === "checkpoint.snapshot_failed");
    expect(lifecycleEntries).toEqual([
      expect.objectContaining({
        redactedJson: expect.objectContaining({
          snapshotSessionCompleteElapsedMs: expect.any(Number),
          snapshotSessionCompleteFailurePhase: "session_complete_record_checkpoint",
          snapshotStage: "checkpoint",
        }),
      }),
    ]);
    expect(lifecycleEntries[0]?.redactedJson).not.toHaveProperty(
      "snapshotSessionCompleteTimeoutMs",
    );
  });

  it("does not wait for the queued finished record before returning a checkpoint", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    let releaseFinishedLog!: () => void;
    const finishedLogGate = new Promise<void>((resolve) => {
      releaseFinishedLog = resolve;
    });
    let signalFinishedLogStarted!: () => void;
    const finishedLogStarted = new Promise<void>((resolve) => {
      signalFinishedLogStarted = resolve;
    });
    let finishedLogSettled = false;
    calls.logWrite.mockImplementationOnce(async (request) => {
      signalFinishedLogStarted();
      await finishedLogGate;
      finishedLogSettled = true;
      return { loggedCount: request.entries.length };
    });
    const options = createBridgeOptions({
      platform,
      vaultRoot,
    });
    const checkpoint = Promise.resolve(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    ));

    let pendingLogDrain: Promise<void> | null = null;
    try {
      await expect(Promise.race([
        checkpoint.then(() => "checkpoint"),
        finishedLogStarted.then(() => "log write"),
      ])).resolves.toBe("checkpoint");
      pendingLogDrain = drainHostedRuntimeLogWritesBestEffort();
      await expect(Promise.race([
        finishedLogStarted.then(() => "log write"),
        pendingLogDrain.then(() => "drain"),
      ])).resolves.toBe("log write");
      expect(calls.logWrite).toHaveBeenCalledOnce();
      expect(finishedLogSettled).toBe(false);
      await expect(checkpoint).resolves.toMatchObject({
        snapshotRef: {
          snapshotId: "snapshot_bridge",
        },
      });
    } finally {
      releaseFinishedLog();
      await pendingLogDrain;
      await checkpoint;
    }

    expect(finishedLogSettled).toBe(true);
  });

  it("keeps snapshot outcomes independent from an unavailable log port", async () => {
    const successfulVaultRoot = await createVaultRoot();
    const successfulRuntime = createRuntimePlatform();
    successfulRuntime.platform.logPort = null;
    const successfulOptions = createBridgeOptions({
      platform: successfulRuntime.platform,
      vaultRoot: successfulVaultRoot,
    });

    await expect(successfulOptions.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    )).resolves.toMatchObject({
      snapshotRef: {
        snapshotId: "snapshot_bridge",
      },
    });
    expect(successfulRuntime.calls.logWrite).not.toHaveBeenCalled();

    const failedVaultRoot = await createVaultRoot();
    const failedRuntime = createRuntimePlatform();
    failedRuntime.platform.logPort = null;
    const failure = new Error("Synthetic archive failure without logging.");
    const failedOptions = createBridgeOptions({
      platform: failedRuntime.platform,
      snapshotArchiveBuilder: {
        buildEncryptedSnapshot: vi.fn(async () => {
          throw failure;
        }),
      },
      vaultRoot: failedVaultRoot,
    });

    await expect(failedOptions.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    )).rejects.toBeInstanceOf(Error);
    expect(failedRuntime.calls.logWrite).not.toHaveBeenCalled();
  });

  it("aborts the snapshot session when archive construction fails before checkpoint", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async () => {
        throw new Error("Synthetic archive failure.");
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    )).rejects.toThrow("Synthetic archive failure.");

    expect(calls.startSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
    expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
  });

  it("preserves an exact frozen runtime-wake interruption during snapshot upload", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const controller = new AbortController();
    const interruption = Object.freeze(new HostedRuntimeCheckpointInterruptedByWakeError());
    calls.putSnapshotObjectDirect.mockImplementationOnce(async ({ signal }) => {
      controller.abort(interruption);
      throw signal?.reason;
    });
    const options = createBridgeOptions({ platform, vaultRoot });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    )).rejects.toBe(interruption);
    await drainHostedRuntimeLogWritesBestEffort();

    const entries = calls.logWrite.mock.calls
      .flatMap(([request]) => request.entries)
      .filter((entry) => entry.eventCode.startsWith("checkpoint.snapshot_"));
    expect(entries).toEqual([
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_preempted",
        redactedJson: expect.objectContaining({
          snapshotStage: "upload",
          snapshotOutcomeKind: "expected_preemption",
        }),
      }),
    ]);
    expect(entries[0]?.redactedJson).not.toHaveProperty("snapshotUploadFailurePhase");
    expect(interruption).not.toHaveProperty("phase");
    expect(calls.putSnapshotObjectDirect).toHaveBeenCalledOnce();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
    expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
  });

  it("does not let snapshot-session abort cleanup block checkpoint interruption", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    calls.abortSnapshotSession.mockImplementationOnce(async () => {
      return await new Promise<never>(() => {});
    });
    const controller = new AbortController();
    const interruption = new HostedRuntimeCheckpointInterruptedByWakeError({
      message: "private checkpoint wake detail",
    });
    let resolveArchiveStarted: (() => void) | undefined;
    const archiveStarted = new Promise<void>((resolve) => {
      resolveArchiveStarted = resolve;
    });
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async (input) => {
        expect(input.signal).toBe(controller.signal);
        resolveArchiveStarted?.();
        const signal = input.signal;
        if (!signal) {
          throw new Error("Checkpoint signal was not propagated to archive construction.");
        }
        return await new Promise<never>((_resolve, reject) => {
          const rejectWithInterruption = () => {
            reject(signal.reason);
          };
          if (signal.aborted) {
            rejectWithInterruption();
            return;
          }
          signal.addEventListener("abort", rejectWithInterruption, {
            once: true,
          });
        });
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    const snapshot = Promise.resolve(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    ));
    const snapshotOutcome = snapshot.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );
    await archiveStarted;
    controller.abort(interruption);
    let promptRejectionTimeout: ReturnType<typeof setTimeout> | undefined;
    const promptOutcome = await Promise.race([
      snapshotOutcome,
      new Promise<{ status: "timeout" }>((resolve) => {
        promptRejectionTimeout = setTimeout(() => {
          resolve({ status: "timeout" });
        }, 250);
      }),
    ]);
    if (promptRejectionTimeout) {
      clearTimeout(promptRejectionTimeout);
    }
    expect(promptOutcome.status).toBe("rejected");
    if (promptOutcome.status === "rejected") {
      expect(promptOutcome.error).toBe(interruption);
    }

    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).toHaveBeenCalledOnce();
    expect(calls.startSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
    await drainHostedRuntimeLogWritesBestEffort();
    await vi.waitFor(() => {
      const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
      expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_preempted"))
        .toBe(true);
    });
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    const lifecycleEntries = entries.filter((entry) =>
      entry.eventCode.startsWith("checkpoint.snapshot_"));
    expect(lifecycleEntries).toHaveLength(1);
    const [preemptionEntry] = lifecycleEntries;
    expect(preemptionEntry).toMatchObject({
      errorCode: "runtime_wake_during_checkpoint",
      eventCode: "checkpoint.snapshot_preempted",
      level: "info",
      redactedJson: expect.objectContaining({
        errorCode: "runtime_wake_during_checkpoint",
        snapshotInterruptedBeforeCommit: true,
        snapshotOutcomeKind: "expected_preemption",
        snapshotPreemptionKind: "runtime_wake",
        snapshotStage: "archive",
      }),
    });
    expect(JSON.stringify(preemptionEntry)).not.toContain(
      "private checkpoint wake detail",
    );
  });

  it("keeps a real archive failure actionable when a runtime wake races it", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const controller = new AbortController();
    const interruption = new HostedRuntimeCheckpointInterruptedByWakeError();
    const snapshotFailure = new Error("snapshot construction failed independently");
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async () => {
        controller.abort(interruption);
        throw snapshotFailure;
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    )).rejects.toBe(interruption);

    await vi.waitFor(() => {
      const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
      expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_failed"))
        .toBe(true);
    });
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        level: "warn",
        redactedJson: expect.objectContaining({
          errorCode: "runtime_error",
          snapshotInterruptedBeforeCommit: true,
        }),
      }),
    ]));
    expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_preempted"))
      .toBe(false);
  });

  it("keeps a distinct runtime-wake error instance actionable", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const controller = new AbortController();
    const activeInterruption =
      new HostedRuntimeCheckpointInterruptedByWakeError();
    const distinctFailure = new HostedRuntimeCheckpointInterruptedByWakeError({
      message: "distinct checkpoint failure",
    });
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async () => {
        controller.abort(activeInterruption);
        throw distinctFailure;
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    )).rejects.toBe(activeInterruption);

    await vi.waitFor(() => {
      const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
      expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_failed"))
        .toBe(true);
    });
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        level: "warn",
        redactedJson: expect.objectContaining({
          snapshotInterruptedBeforeCommit: true,
        }),
      }),
    ]));
    expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_preempted"))
      .toBe(false);
  });

  it("returns a runtime wake before a raced completion-failure log settles", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const controller = new AbortController();
    const interruption = new HostedRuntimeCheckpointInterruptedByWakeError();
    const completionFailure = new Error("snapshot completion transport failed");
    let releaseFailureLog!: () => void;
    const failureLogGate = new Promise<void>((resolve) => {
      releaseFailureLog = resolve;
    });
    let settledFailureLogWrites = 0;
    calls.logWrite.mockImplementation(async (request) => {
      if (request.entries.some((entry) =>
        entry.eventCode === "checkpoint.snapshot_failed"
      )) {
        await failureLogGate;
        settledFailureLogWrites += 1;
      }
      return { loggedCount: request.entries.length };
    });
    calls.completeSnapshotSession.mockRejectedValueOnce(completionFailure);
    const options = createBridgeOptions({
      platform,
      vaultRoot,
    });

    const checkpoint = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    );
    await vi.waitFor(() => {
      const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
      expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_failed"))
        .toBe(true);
    });
    controller.abort(interruption);
    await expect(checkpoint).rejects.toBe(interruption);
    expect(settledFailureLogWrites).toBe(0);

    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    const failureEntries = entries.filter((entry) =>
      entry.eventCode === "checkpoint.snapshot_failed"
    );
    expect(failureEntries).toEqual([
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        level: "error",
        redactedJson: expect.objectContaining({
          errorCode: "runtime_error",
        }),
      }),
    ]);
    expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_preempted"))
      .toBe(false);
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();

    releaseFailureLog();
    await vi.waitFor(() => {
      expect(settledFailureLogWrites).toBe(1);
    });
  });

  it("returns a late runtime wake before a pre-commit session abort settles", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const controller = new AbortController();
    const interruption = new HostedRuntimeCheckpointInterruptedByWakeError();
    const archiveFailure = new Error("snapshot archive failed");
    let releaseSessionAbort!: () => void;
    const sessionAbortGate = new Promise<void>((resolve) => {
      releaseSessionAbort = resolve;
    });
    let sessionAbortSettled = false;
    calls.abortSnapshotSession.mockImplementationOnce(async () => {
      await sessionAbortGate;
      sessionAbortSettled = true;
    });
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async () => {
        throw archiveFailure;
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    const checkpoint = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    );
    await vi.waitFor(() => {
      expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
    });
    controller.abort(interruption);
    await expect(checkpoint).rejects.toBe(interruption);
    expect(sessionAbortSettled).toBe(false);

    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(entries.filter((entry) =>
      entry.eventCode === "checkpoint.snapshot_failed"
    )).toHaveLength(1);
    expect(entries.some((entry) => entry.eventCode === "checkpoint.snapshot_preempted"))
      .toBe(false);

    releaseSessionAbort();
    await vi.waitFor(() => {
      expect(sessionAbortSettled).toBe(true);
    });
  });

  it("propagates checkpoint interruption into runtime-owned symlink cleanup", async () => {
    const vaultRoot = await createVaultRoot();
    const workspaceRoot = path.dirname(path.dirname(vaultRoot));
    const runtimeRoot = path.join(
      workspaceRoot,
      "durable",
      "home",
      ".codex-hosted",
      "nested",
    );
    const symlinkTarget = path.join(workspaceRoot, "runtime-symlink-target.txt");
    const symlinkPaths = [
      path.join(runtimeRoot, "first-link"),
      path.join(runtimeRoot, "second-link"),
    ];
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(symlinkTarget, "runtime-owned symlink target\n", "utf8");
    await Promise.all(symlinkPaths.map(async (symlinkPath) => {
      await symlink(symlinkTarget, symlinkPath);
    }));

    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const controller = new AbortController();
    const interruption = new Error("Synthetic foreground cleanup interruption.");
    const nativeThrowIfAborted = controller.signal.throwIfAborted.bind(
      controller.signal,
    );
    let untouchedPathAtInterruption: string | null = null;
    Object.defineProperty(controller.signal, "throwIfAborted", {
      configurable: true,
      value() {
        const remainingPaths = symlinkPaths.filter((symlinkPath) =>
          existsSync(symlinkPath)
        );
        if (!controller.signal.aborted && remainingPaths.length === 1) {
          [untouchedPathAtInterruption] = remainingPaths;
          controller.abort(interruption);
        }
        nativeThrowIfAborted();
      },
    });
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
      { signal: controller.signal },
    )).rejects.toBe(interruption);

    expect(symlinkPaths.filter((symlinkPath) => existsSync(symlinkPath)))
      .toEqual([untouchedPathAtInterruption]);
    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).not.toHaveBeenCalled();
    expect(calls.startSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).not.toHaveBeenCalled();
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
  });

  it("redacts snapshot lifecycle safe error messages before writing runtime logs", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const rawPath = "/tmp/private-hosted-runtime/token";
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async () => {
        throw new Error(
          `HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON must be configured for ${rawPath}.`,
        );
      }),
    };
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(
      {
        ...createCheckpointInput("idle_shutdown"),
        handledConversationFrontierSelected: true,
        nextDefaultProcessingWakeAt: "invalid synthetic wake value",
        nextDefaultProcessingWakeReason: "assistant",
        systemMailboxProgressGeneration: "1",
      },
    )).rejects.toThrow("HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON");

    const failureEntry = calls.logWrite.mock.calls
      .flatMap(([request]) => request.entries)
      .find((entry) => entry.eventCode === "checkpoint.snapshot_failed");
    const redactedJson = failureEntry?.redactedJson ?? {};
    expect(redactedJson).toMatchObject({
      handledConversationFrontierSelected: true,
      nextDefaultProcessingWakeState: "invalid",
      nextDefaultProcessingWakeOffsetMs: null,
    });
    expect(redactedJson).not.toHaveProperty("webCheckpointAccepted");
    expect(calls.completeSnapshotSession).not.toHaveBeenCalled();
    expect(JSON.stringify(redactedJson)).not.toContain(rawPath);
    expect(JSON.stringify(redactedJson)).not.toContain("invalid synthetic wake value");
    expect(JSON.stringify(redactedJson)).toContain("<redacted-path>");
  });

  it("marks the local workspace clean for warm reuse after successful v2 checkpoint", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const options = createBridgeOptions({
      platform,
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    );

    expect(result.localWorkspaceCleanForWarmReuse).toBe(true);
    expect(calls.putSnapshotObjectDirect).toHaveBeenCalledOnce();
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();
    await drainHostedRuntimeLogWritesBestEffort();
    const entries = calls.logWrite.mock.calls
      .flatMap(([request]) => request.entries)
      .filter((entry) => entry.eventCode.startsWith("checkpoint.snapshot_"));
    expect(entries).toEqual([
      expect.objectContaining({ eventCode: "checkpoint.snapshot_finished" }),
    ]);
    expect(entries[0]?.redactedJson).not.toHaveProperty("snapshotUploadFailurePhase");
  });

  it("excludes unreferenced Codex rollouts without deleting live local state", async () => {
    const vaultRoot = await createVaultRoot();
    const operatorHomeRoot = path.join(path.dirname(vaultRoot), "home");
    const rolloutRelativePath = path.join(
      ".codex-hosted",
      "sessions",
      "2026",
      "07",
      "13",
      "rollout-2026-07-13T20-00-00-00000000-0000-4000-8000-000000000542.jsonl",
    );
    const rolloutPath = path.join(operatorHomeRoot, rolloutRelativePath);
    await mkdir(path.dirname(rolloutPath), { recursive: true });
    await writeFile(
      rolloutPath,
      '{"membership":"private-membership-sentinel"}\n',
      "utf8",
    );
    const { platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    await expectPresent(rolloutPath);
    const archiveInput = vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot)
      .mock.calls[0]?.[0];
    expect(archiveInput?.archiveEntries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: rolloutRelativePath.split(path.sep).join(path.posix.sep),
        root: "operator-home",
      }),
    ]));
  });

  it("holds the canonical write lock through snapshot publication", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    let signalArchiveStarted: () => void = () => undefined;
    const archiveStarted = new Promise<void>((resolve) => {
      signalArchiveStarted = resolve;
    });
    let releaseArchive: () => void = () => undefined;
    const archiveBlocked = new Promise<void>((resolve) => {
      releaseArchive = resolve;
    });
    const baseArchiveBuilder = createSnapshotArchiveBuilder();
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      buildEncryptedSnapshot: vi.fn(async (input) => {
        signalArchiveStarted();
        await archiveBlocked;
        return await baseArchiveBuilder.buildEncryptedSnapshot(input);
      }),
    };
    let signalPublicationStarted: () => void = () => undefined;
    const publicationStarted = new Promise<void>((resolve) => {
      signalPublicationStarted = resolve;
    });
    let releasePublication: () => void = () => undefined;
    const publicationBlocked = new Promise<void>((resolve) => {
      releasePublication = resolve;
    });
    calls.completeSnapshotSession.mockImplementationOnce(async (input) => {
      signalPublicationStarted();
      await publicationBlocked;
      return {
        checkpoint: createCheckpointResponse({
          snapshotRef: input.ref,
          userId: TEST_REQUEST.userId,
          version: TEST_REQUEST.workspaceVersion,
        }),
        snapshotRef: input.ref,
      };
    });
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    const snapshot = options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    );
    await archiveStarted;

    let canonicalWriterEntered = false;
    const canonicalWrite = withCanonicalWriteLock(vaultRoot, async () => {
      canonicalWriterEntered = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(canonicalWriterEntered).toBe(false);

    releaseArchive();
    await publicationStarted;
    expect(canonicalWriterEntered).toBe(false);

    releasePublication();
    await snapshot;
    await canonicalWrite;
    expect(canonicalWriterEntered).toBe(true);
  });

  it.each([
    { label: "legacy omitted", wakeAt: undefined, state: "omitted", offsetMs: null },
    { label: "explicitly absent", wakeAt: null, state: "none", offsetMs: null },
    { label: "overdue", wakeAt: "2026-04-08T12:00:00.000Z", state: "due", offsetMs: -3_600_000 },
    { label: "due now", wakeAt: "2026-04-08T13:00:00.000Z", state: "due", offsetMs: 0 },
    { label: "future", wakeAt: "2026-04-08T14:00:00.000Z", state: "future", offsetMs: 3_600_000 },
  ])("records a $label default wake alongside a future system wake", async ({ wakeAt, state, offsetMs }) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-04-08T13:00:00.000Z"));
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const options = createBridgeOptions({ platform, vaultRoot });
    await options.createCheckpointSnapshot({
      ...createCheckpointInput("idle_shutdown"),
      nextWakeAt: "2026-04-08T13:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      ...(wakeAt === undefined ? {} : {
        nextDefaultProcessingWakeAt: wakeAt,
        nextDefaultProcessingWakeReason: wakeAt === null ? null : "assistant",
        systemMailboxProgressGeneration: "1",
      }),
    });

    await drainHostedRuntimeLogWritesBestEffort();
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(entries.find((entry) => entry.eventCode === "checkpoint.snapshot_finished"))
      .toMatchObject({
        redactedJson: {
          nextWakeState: "future",
          nextWakeOffsetMs: 60_000,
          nextDefaultProcessingWakeState: state,
          nextDefaultProcessingWakeOffsetMs: offsetMs,
          nextDefaultProcessingWakeReasonPresent: wakeAt != null,
          systemMailboxProgressGenerationPresent: wakeAt !== undefined,
          webCheckpointAccepted: true,
        },
      });
    const checkpointRequest = calls.completeSnapshotSession.mock.calls[0]?.[0].checkpointRequest;
    expect(checkpointRequest?.nextWakeAt).toBe("2026-04-08T13:01:00.000Z");
    expect(checkpointRequest?.nextDefaultProcessingWakeAt).toBe(wakeAt);
    expect(checkpointRequest).not.toHaveProperty("nextDefaultProcessingWakeState");
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
  });

  it("retains one finished lifecycle record with checkpoint metadata", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const options = createBridgeOptions({
      platform,
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot({
      ...createCheckpointInput("idle_shutdown"),
      handledConversationFrontierSelected: true,
      handledConversationMailboxItemIds: ["item_terminal_7"],
      idleCheckpointTrigger: "shutdown_signal",
      runtimeWakePendingAtCheckpoint: false,
    });

    expect(result).toMatchObject({
      checkpoint: {
        checkpointed: true,
      },
      localWorkspaceCleanForWarmReuse: true,
      snapshotRef: {
        snapshotId: "snapshot_bridge",
      },
    });
    expect(result.checkpoint).toEqual(createCheckpointResponse({
      snapshotRef: result.snapshotRef,
      userId: TEST_REQUEST.userId,
      version: TEST_REQUEST.workspaceVersion,
    }));

    const checkpointRequest =
      calls.completeSnapshotSession.mock.calls[0]?.[0].checkpointRequest;
    expect(checkpointRequest?.handledConversationMailboxItemIds).toEqual([
      "item_terminal_7",
    ]);
    expect(checkpointRequest).not.toHaveProperty(
      "handledConversationFrontierSelected",
    );
    expect(checkpointRequest?.idleCheckpointTrigger).toBe("shutdown_signal");
    expect(checkpointRequest?.runtimeWakePendingAtCheckpoint).toBe(false);

    await drainHostedRuntimeLogWritesBestEffort();
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(JSON.stringify(entries)).not.toContain("item_terminal_7");
    const lifecycleEntries = entries.filter((entry) =>
      entry.eventCode.startsWith("checkpoint.snapshot_"));
    expect(lifecycleEntries).toEqual([
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_finished",
        redactedJson: expect.objectContaining({
          handledConversationFrontierSelected: true,
          handledConversationMailboxItemCount: 1,
          idleCheckpointTrigger: "shutdown_signal",
          nextWakeAtPresent: false,
          nextWakeReasonPresent: false,
          redactedStatusPresent: true,
          runtimeWakePendingAtCheckpoint: false,
          snapshotArchiveBuildElapsedMs: expect.any(Number),
          snapshotDirectR2PresignElapsedMs: 1,
          snapshotDirectR2PutElapsedMs: 2,
          snapshotDirectR2UploadElapsedMs: expect.any(Number),
          snapshotElapsedMs: expect.any(Number),
          snapshotMode: "workspace_snapshot_v2",
          snapshotSessionCompleteElapsedMs: expect.any(Number),
          snapshotSessionStartElapsedMs: expect.any(Number),
          webCheckpointAccepted: true,
          workspaceSnapshotEncryptedBytes: 18,
          workspaceSnapshotFileCount: expect.any(Number),
          workspaceSnapshotPlainBytes: 9,
        }),
      }),
    ]);
    expect(entries.some((entry) =>
      entry.eventCode === "checkpoint.snapshot_plan"
      || entry.eventCode === "checkpoint.snapshot_started"
    )).toBe(false);
  });

  it("uses the current checkpoint expected workspace version for bridge snapshots", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const advancedLease = {
      ...createLease(),
      workspaceVersion: "8",
    };
    const options = createBridgeOptions({
      platform,
      readCurrentLease: async () => advancedLease,
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot({
      ...createCheckpointInput("idle_shutdown"),
      expectedWorkspaceVersion: "8",
    });

    expect(result.localWorkspaceCleanForWarmReuse).toBe(true);
    expect(calls.startSnapshotSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedWorkspaceVersion: "8",
      }),
    );
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();
  });

  it("prunes stale terminal write-operation records before v2 snapshot archive planning", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const staleOperationPaths = await writeManyStaleCommittedOperationRecords(vaultRoot);
    const activeOperationPath = await writeOperationRecord(vaultRoot, {
      operationId: "op_active_protected",
      status: "staged",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    const uncheckpointedCommittedOperationPath = await writeOperationRecord(vaultRoot, {
      operationId: "op_uncheckpointed_committed",
      status: "committed",
      updatedAt: "2026-06-10T00:00:00.000Z",
    });
    const uncheckpointedCommittedStageRoot =
      ".runtime/operations/op_uncheckpointed_committed";
    const uncheckpointedCommittedPayloadPath =
      `${uncheckpointedCommittedStageRoot}/payloads/residue.txt`;
    await mkdir(path.join(vaultRoot, uncheckpointedCommittedStageRoot, "payloads"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, uncheckpointedCommittedPayloadPath),
      "uncheckpointed residue\n",
      "utf8",
    );
    const request = createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z");
    const options = createBridgeOptions({
      platform,
      request,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) => entry.relativePath === staleOperationPaths.oldest)).toBe(false);
    expect(archiveEntries.some((entry) => entry.relativePath === staleOperationPaths.newest)).toBe(false);
    expect(archiveEntries.some((entry) => entry.relativePath === activeOperationPath)).toBe(true);
    expect(archiveEntries.some((entry) => entry.relativePath === uncheckpointedCommittedOperationPath)).toBe(true);
    expect(archiveEntries.some((entry) => entry.relativePath === uncheckpointedCommittedPayloadPath)).toBe(true);
    await expectMissing(path.join(vaultRoot, staleOperationPaths.oldest));
    await expectMissing(path.join(vaultRoot, staleOperationPaths.newest));
    await expectPresent(path.join(vaultRoot, activeOperationPath));
    await expectPresent(path.join(vaultRoot, uncheckpointedCommittedOperationPath));
    await expectPresent(path.join(vaultRoot, uncheckpointedCommittedStageRoot));
  });

  it("retains inbox videos alongside audio in v2 snapshots for later turns", async () => {
    const vaultRoot = await createVaultRoot();
    const now = "2026-06-10T00:00:00.000Z";
    await initializeVault({ createdAt: now, vaultRoot });
    const persisted = await persistCanonicalInboxCapture({
      captureId: "cap_snapshot_transient_video",
      eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VK",
      input: {
        actor: { isSelf: false },
        attachments: [
          {
            data: Buffer.from("synthetic-video-bytes"),
            fileName: "clip.mp4",
            kind: "video",
            mime: "video/mp4",
          },
          {
            data: Buffer.from("synthetic-audio-bytes"),
            fileName: "voice.mp3",
            kind: "audio",
            mime: "audio/mpeg",
          },
        ],
        externalId: "msg-snapshot-transient-video",
        occurredAt: now,
        raw: {},
        receivedAt: now,
        source: "telegram",
        text: "synthetic mixed media",
        thread: {
          id: "thread-snapshot-transient-video",
          isDirect: true,
        },
      },
      storedAt: now,
      vaultRoot,
    });
    const videoPath = persisted.stored.attachments[0]?.storedPath ?? "";
    const audioPath = persisted.stored.attachments[1]?.storedPath ?? "";
    expect(videoPath).not.toBe("");
    expect(audioPath).not.toBe("");
    const { platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const options = createBridgeOptions({
      platform,
      request: createInvocationRequestWithWorkspaceCheckpoint(now),
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) =>
      entry.root === "vault" && entry.relativePath === videoPath
    )).toBe(true);
    expect(archiveEntries.some((entry) =>
      entry.root === "vault" && entry.relativePath === audioPath
    )).toBe(true);
    await expectPresent(path.join(vaultRoot, videoPath));
  });

  it("prunes settled assistant runtime residue before v2 snapshot archive planning", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const residuePaths = await writeSettledAssistantInputResidue(vaultRoot);
    const options = createBridgeOptions({
      platform,
      request: createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z"),
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) => entry.relativePath === residuePaths.inputEvent)).toBe(false);
    expect(archiveEntries.some((entry) => entry.relativePath === residuePaths.evidence)).toBe(false);
    await expectMissing(path.join(vaultRoot, residuePaths.inputEvent));
    await expectMissing(path.join(vaultRoot, residuePaths.evidence));
  });

  it("keeps disabled-channel nonterminal input residue in an idle snapshot", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const residuePaths = await writeDisabledPendingAssistantInputResidue(vaultRoot);
    const options = createBridgeOptions({
      platform,
      request: createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z"),
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) => entry.relativePath === residuePaths.inputEvent)).toBe(true);
    expect(archiveEntries.some((entry) => entry.relativePath === residuePaths.pendingIndex)).toBe(true);
    await expectPresent(path.join(vaultRoot, residuePaths.inputEvent));
    await expectPresent(path.join(vaultRoot, residuePaths.pendingIndex));
    await expect(readAssistantInputEvent({
      inputId: residuePaths.inputId,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      replyTarget: {
        channel: "linq",
        threadId: "thread-disabled-residue",
      },
    });
  });

  it("prunes only quiescent runtime deliveries before archive planning", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const orphanRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/orphan.pdf`;
    const orphanContents = Buffer.from("unreferenced generated delivery\n");
    const activeRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/active.pdf`;
    const activeContents = Buffer.from("active generated delivery\n");
    const nestedRef =
      `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/legacy/report.zip`;
    const nestedContents = Buffer.from("legacy nested generated delivery\n");
    const legacyRef = "exports/assistant-deliveries/base-era.pdf";
    const legacyContents = Buffer.from("ordinary pre-existing vault file\n");
    await mkdir(path.dirname(path.join(vaultRoot, orphanRef)), { recursive: true });
    await mkdir(path.dirname(path.join(vaultRoot, legacyRef)), { recursive: true });
    await writeFile(path.join(vaultRoot, orphanRef), orphanContents);
    await writeFile(path.join(vaultRoot, activeRef), activeContents);
    await mkdir(path.dirname(path.join(vaultRoot, nestedRef)), { recursive: true });
    await writeFile(path.join(vaultRoot, nestedRef), nestedContents);
    await writeFile(path.join(vaultRoot, legacyRef), legacyContents);
    await createAssistantOutboxIntent({
      channel: "linq",
      identityId: "identity-generated-delivery",
      media: [{
        approvalGeneration: null,
        approvalId: null,
        contentType: "application/pdf",
        filename: "active.pdf",
        kind: "vault_file",
        ref: activeRef,
        sha256: createHash("sha256").update(activeContents).digest("hex"),
        sizeBytes: activeContents.byteLength,
      }],
      message: "Generated delivery",
      sessionId: "session-generated-delivery",
      threadId: "thread-generated-delivery",
      threadIsDirect: true,
      turnId: "turn-generated-delivery",
      vault: vaultRoot,
    });
    const options = createBridgeOptions({
      platform,
      request: createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z"),
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) => entry.relativePath === orphanRef)).toBe(false);
    expect(archiveEntries.some((entry) => entry.relativePath === activeRef)).toBe(true);
    expect(archiveEntries.some((entry) => entry.relativePath === nestedRef)).toBe(true);
    expect(archiveEntries.some((entry) => entry.relativePath === legacyRef)).toBe(true);
    await expectMissing(path.join(vaultRoot, orphanRef));
    await expectPresent(path.join(vaultRoot, activeRef));
    await expectPresent(path.join(vaultRoot, nestedRef));
    await expectPresent(path.join(vaultRoot, legacyRef));

    await drainHostedRuntimeLogWritesBestEffort();
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(entries.some((entry) =>
      entry.redactedJson?.prunedAssistantRuntimeGeneratedDeliveryFileCount === 1
      && entry.redactedJson?.prunedAssistantRuntimeGeneratedDeliveryBytes
        === orphanContents.byteLength
      && entry.redactedJson
        ?.assistantRuntimeGeneratedDeliveryNestedEntriesRetained === 1
    )).toBe(true);
  });

  it("prunes terminal deliveries when unrelated assistant residue cleanup fails", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const terminalRef =
      `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/terminal.pdf`;
    const activeRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/active.pdf`;
    const terminalContents = Buffer.from("terminal generated delivery\n");
    const activeContents = Buffer.from("active generated delivery\n");
    await mkdir(path.dirname(path.join(vaultRoot, terminalRef)), {
      recursive: true,
    });
    await writeFile(path.join(vaultRoot, terminalRef), terminalContents);
    await writeFile(path.join(vaultRoot, activeRef), activeContents);
    const terminalIntent = await createAssistantOutboxIntent({
      channel: "linq",
      identityId: "identity-terminal-generated-delivery",
      media: [{
        approvalGeneration: null,
        approvalId: null,
        contentType: "application/pdf",
        filename: "terminal.pdf",
        kind: "vault_file",
        ref: terminalRef,
        sha256: createHash("sha256").update(terminalContents).digest("hex"),
        sizeBytes: terminalContents.byteLength,
      }],
      message: "Terminal generated delivery",
      sessionId: "session-terminal-generated-delivery",
      threadId: "thread-terminal-generated-delivery",
      threadIsDirect: true,
      turnId: "turn-terminal-generated-delivery",
      vault: vaultRoot,
    });
    await expect(markAssistantOutboxIntentSentById({
      delivery: {
        channel: "linq",
        idempotencyKey: "terminal-generated-delivery",
        messageLength: terminalIntent.message.length,
        providerMessageId: "message-terminal-generated-delivery",
        providerThreadId: "thread-terminal-generated-delivery",
        sentAt: "2026-06-10T00:00:00.000Z",
        target: "thread-terminal-generated-delivery",
        targetKind: "thread",
      },
      intentId: terminalIntent.intentId,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      deliveryConfirmationPending: false,
      status: "sent",
    });
    await createAssistantOutboxIntent({
      channel: "linq",
      identityId: "identity-active-generated-delivery",
      media: [{
        approvalGeneration: null,
        approvalId: null,
        contentType: "application/pdf",
        filename: "active.pdf",
        kind: "vault_file",
        ref: activeRef,
        sha256: createHash("sha256").update(activeContents).digest("hex"),
        sizeBytes: activeContents.byteLength,
      }],
      message: "Active generated delivery",
      sessionId: "session-active-generated-delivery",
      threadId: "thread-active-generated-delivery",
      threadIsDirect: true,
      turnId: "turn-active-generated-delivery",
      vault: vaultRoot,
    });
    const pendingInputsRef =
      ".runtime/operations/assistant/hosted-pending-inputs.json";
    const pendingInputsPath = path.join(vaultRoot, pendingInputsRef);
    await mkdir(path.dirname(pendingInputsPath), { recursive: true });
    await writeFile(pendingInputsPath, "{ not-json", "utf8");
    const options = createBridgeOptions({
      platform,
      request: createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z"),
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) => entry.relativePath === terminalRef))
      .toBe(false);
    expect(archiveEntries.some((entry) => entry.relativePath === activeRef))
      .toBe(true);
    expect(archiveEntries.some((entry) => entry.relativePath === pendingInputsRef))
      .toBe(true);
    await expectMissing(path.join(vaultRoot, terminalRef));
    await expectPresent(path.join(vaultRoot, activeRef));
    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).toHaveBeenCalledOnce();
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();
    await drainHostedRuntimeLogWritesBestEffort();
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(entries.some((entry) =>
      entry.eventCode === "checkpoint.snapshot_finished"
      && entry.redactedJson?.prunedAssistantRuntimeGeneratedDeliveryFileCount === 1
      && entry.redactedJson?.prunedAssistantRuntimeGeneratedDeliveryBytes
        === terminalContents.byteLength
      && entry.redactedJson?.prunedAssistantRuntimeResidueFileCount === 1
    )).toBe(true);
  });

  it("prunes unrelated generated deliveries when an active delivery file is missing", async () => {
    const vaultRoot = await createVaultRoot();
    const activeRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/missing.pdf`;
    const orphanRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/orphan.pdf`;
    const activeContents = Buffer.from("missing active generated delivery\n");
    const orphanContents = Buffer.from("orphan generated delivery\n");
    await createAssistantOutboxIntent({
      channel: "linq",
      identityId: "identity-missing-generated-delivery",
      media: [{
        approvalGeneration: null,
        approvalId: null,
        contentType: "application/pdf",
        filename: "missing.pdf",
        kind: "vault_file",
        ref: activeRef,
        sha256: createHash("sha256").update(activeContents).digest("hex"),
        sizeBytes: activeContents.byteLength,
      }],
      message: "Missing active generated delivery",
      sessionId: "session-missing-generated-delivery",
      threadId: "thread-missing-generated-delivery",
      threadIsDirect: true,
      turnId: "turn-missing-generated-delivery",
      vault: vaultRoot,
    });
    await mkdir(path.dirname(path.join(vaultRoot, orphanRef)), { recursive: true });
    await writeFile(path.join(vaultRoot, orphanRef), orphanContents);
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).toHaveBeenCalledOnce();
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();
    await expectMissing(path.join(vaultRoot, orphanRef));
    await drainHostedRuntimeLogWritesBestEffort();
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(entries.some((entry) =>
      entry.eventCode === "checkpoint.snapshot_finished"
      && entry.redactedJson?.assistantRuntimeGeneratedDeliveryActiveFilesMissing === 1
      && entry.redactedJson?.assistantRuntimeGeneratedDeliveryFilesScanned === 1
      && entry.redactedJson?.prunedAssistantRuntimeGeneratedDeliveryFileCount === 1
      && entry.redactedJson?.prunedAssistantRuntimeGeneratedDeliveryBytes
        === orphanContents.byteLength
      && entry.redactedJson?.assistantRuntimeGeneratedDeliveryPruneFailed !== true
    )).toBe(true);
  });

  it("records a closed diagnostic code when generated-delivery cleanup fails", async () => {
    const vaultRoot = await createVaultRoot();
    const generatedDeliveryRoot = path.join(
      vaultRoot,
      ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
    );
    await mkdir(path.dirname(generatedDeliveryRoot), { recursive: true });
    await writeFile(generatedDeliveryRoot, "invalid generated-delivery root\n");
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const options = createBridgeOptions({
      platform,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    expect(snapshotArchiveBuilder.buildEncryptedSnapshot).toHaveBeenCalledOnce();
    expect(calls.putSnapshotObjectDirect).toHaveBeenCalledOnce();
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    await drainHostedRuntimeLogWritesBestEffort();
    const entries = calls.logWrite.mock.calls.flatMap(([request]) => request.entries);
    expect(entries.some((entry) =>
      entry.eventCode === "checkpoint.snapshot_finished"
      && entry.redactedJson?.assistantRuntimeGeneratedDeliveryPruneFailed === true
      && entry.redactedJson?.assistantRuntimeGeneratedDeliveryPruneErrorCode
        === "root_not_directory"
    )).toBe(true);
  });

  it("continues checkpoint publication when terminal write-operation pruning fails", async () => {
    const vaultRoot = await createVaultRoot();
    const { calls, platform } = createRuntimePlatform();
    const snapshotArchiveBuilder = createSnapshotArchiveBuilder();
    const staleOperationPaths = await writeManyStaleCommittedOperationRecords(vaultRoot);
    const operationDirectory = path.join(vaultRoot, ".runtime", "operations");
    const request = createInvocationRequestWithWorkspaceCheckpoint("2026-06-10T00:00:00.000Z");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const options = createBridgeOptions({
      platform,
      request,
      snapshotArchiveBuilder,
      vaultRoot,
    });

    await chmod(operationDirectory, 0o500);
    try {
      await expect(options.createCheckpointSnapshot(
        createCheckpointInput("idle_shutdown"),
      )).resolves.toMatchObject({
        localWorkspaceCleanForWarmReuse: true,
      });
    } finally {
      await chmod(operationDirectory, 0o700);
    }

    const archiveEntries =
      vi.mocked(snapshotArchiveBuilder.buildEncryptedSnapshot).mock.calls[0]?.[0]
        .archiveEntries ?? [];
    expect(archiveEntries.some((entry) => entry.relativePath === staleOperationPaths.oldest)).toBe(true);
    await expectPresent(path.join(vaultRoot, staleOperationPaths.oldest));
    expect(calls.completeSnapshotSession).toHaveBeenCalledOnce();
    expect(calls.abortSnapshotSession).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.some(([payload]) =>
      typeof payload === "string" &&
      payload.includes("Hosted workspace terminal write-operation cleanup failed.")
    )).toBe(true);
  });

  it("keeps mailbox decode mismatches blocked and route mismatches deferred", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const options = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: createMemberChannelsWake({
          userId: "member_other",
        }),
      }),
      platform,
      vaultRoot,
    });

    await expect(options.importItem(createSystemMailboxImportItem())).resolves.toEqual({
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    });
    await expect(options.importItem(createSystemMailboxImportItem({
      routeAction: "import-conversation-message",
    }))).resolves.toEqual({
      reasonCode: "cloudflare_bridge.unhandled_mailbox_route",
      status: "deferred",
    });
  });

  it("matches mailbox occurred-at identity by instant across ISO precision", async () => {
    const equivalentVaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const equivalentOptions = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: createMemberChannelsWake({
          occurredAt: "2026-05-01T00:00:00Z",
        }),
      }),
      platform,
      vaultRoot: equivalentVaultRoot,
    });

    await expect(equivalentOptions.importItem(
      createSystemMailboxImportItem(),
    )).resolves.toMatchObject({ status: "imported" });

    const mismatchedOptions = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: createMemberChannelsWake({
          occurredAt: "2026-05-01T00:00:01Z",
        }),
      }),
      platform,
      vaultRoot: await createVaultRoot(),
    });
    await expect(mismatchedOptions.importItem(
      createSystemMailboxImportItem(),
    )).resolves.toEqual({
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    });
  });

  it.each([
    ["vault-share.delivery", "import-vault-share-delivery"],
    ["vault-share.revoke", "import-vault-share-revoke"],
  ] as const)(
    "consumes retired %s rows without decoding or recreating local shared data",
    async (kind, routeAction) => {
      const vaultRoot = await createVaultRoot();
      const { platform } = createRuntimePlatform();
      const mailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder = {
        decode: vi.fn(async () => {
          throw new Error("Retired vault-share payloads must not be decoded.");
        }),
      };
      const options = createBridgeOptions({
        mailboxPayloadDecoder,
        platform,
        vaultRoot,
      });

      await expect(options.importItem(
        createRetiredVaultShareMailboxImportItem({ kind, routeAction }),
      )).resolves.toEqual({
        reasonCode: "vault_share.retired_direct_snapshot",
        status: "skipped",
      });
      expect(mailboxPayloadDecoder.decode).not.toHaveBeenCalled();
      await expect(access(path.join(vaultRoot, "derived", "vault-share")))
        .rejects.toThrow();
      await expect(access(path.join(vaultRoot, "vault-share")))
        .rejects.toThrow();
    },
  );

  it.each(HOSTED_RETIRED_MAILBOX_KINDS)("consumes retired %s rows without decoding or importing them", async (kind) => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const mailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder = {
      decode: vi.fn(async () => {
        throw new Error("Retired payloads must not be decoded.");
      }),
    };
    const options = createBridgeOptions({
      mailboxPayloadDecoder,
      platform,
      vaultRoot,
    });

    await expect(options.importItem(
      createRetiredMailboxImportItem(kind),
    )).resolves.toEqual({
      reasonCode: "mailbox.kind_retired",
      status: "skipped",
    });
    expect(mailboxPayloadDecoder.decode).not.toHaveBeenCalled();
  });

  it.each(["creative-response", "creative-response-text"] as const)("terminally consumes fresh %s from an old Web and imports the active successor", async (notificationPromptProfile) => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "retired-creative", memberId: TEST_REQUEST.userId,
      occurredAt: "2026-05-01T00:00:00.000Z",
      notification: {
        notificationPromptProfile, instructions: "Retired synthetic creative work.",
        route: { actorId: null, channel: "telegram", delivery: { kind: "thread", target: "synthetic-group" }, identityId: "synthetic-group", threadId: "synthetic-group", threadIsDirect: false },
      },
    });
    const retired = {
      ...createSystemMailboxImportItem().item,
      dedupeKey: wake.eventId, id: "retired-creative", kind: wake.kind,
      payloadInlineCiphertext: "synthetic-retired-payload", payloadRef: null, payloadSchema: "murph.hosted-mailbox-item.v1",
    };
    const active = { ...createSystemMailboxImportItem().item, laneSeq: "2", payloadInlineCiphertext: "synthetic-active-payload", payloadRef: null, payloadSchema: "murph.hosted-mailbox-item.v1" };
    const decoder = vi.fn(async (input: { payloadCiphertext: string }) => ({
      status: "decoded" as const,
      wake: parseHostedExecutionWake(input.payloadCiphertext === "synthetic-retired-payload" ? wake : createMemberChannelsWake()),
    }));
    const options = createBridgeOptions({ mailboxPayloadDecoder: { decode: decoder }, platform, vaultRoot });
    const result = await fetchAndProcessHostedMailboxPrefix({
      expectedUserId: TEST_REQUEST.userId,
      importItem: options.importItem,
      lanes: ["system"],
      limitPerLane: 10,
      mailboxPort: {
        async fetch() { return { fetchedAt: wake.occurredAt, items: [retired, active], maxSeqByLane: [{ lane: "system", maxSeq: "2" }], userId: TEST_REQUEST.userId }; },
        async fetchPayload() { throw new Error("Inline payloads must not fetch a sidecar."); },
      },
      now: () => wake.occurredAt,
      requestId: "synthetic-retirement-import",
      state: createEmptyHostedMailboxImportState(),
    });
    expect(decoder).toHaveBeenCalledTimes(2);
    expect(result.blocked).toEqual([]);
    expect(result.state.watermarks.system).toBe("2");
    expect(result.importedCount).toBe(1);
    expect(result.state.recentStatuses.map(({ seq, status, reasonCode }) => ({ seq, status, reasonCode }))).toEqual([
      { seq: "1", status: "skipped", reasonCode: "mailbox.notification_profile_retired" },
      { seq: "2", status: "imported", reasonCode: "system_mailbox.queued" },
    ]);
    expect((await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => item.itemId)).toEqual([active.id]);
  });

  it("rejects active rows mislabeled as retired without decoding them", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const mailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder = {
      decode: vi.fn(async () => {
        throw new Error("Mismatched retired routes must not be decoded.");
      }),
    };
    const options = createBridgeOptions({ mailboxPayloadDecoder, platform, vaultRoot });
    const item = createRetiredMailboxImportItem(HOSTED_RETIRED_MAILBOX_KINDS[0]);
    item.item.kind = "member.activated";
    item.route.itemRef.kind = "member.activated";

    await expect(options.importItem(item)).resolves.toEqual({
      reasonCode: "mailbox.retired_kind_mismatch",
      retryable: false,
      status: "blocked",
    });
    expect(mailboxPayloadDecoder.decode).not.toHaveBeenCalled();
  });

  it("binds paired Assistant Ask payloads to the mailbox row id and expiry", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const wakes = [
      createAssistantAskRequestedWake(),
      createAssistantAskCompletedWake(),
    ];

    for (const wake of wakes) {
      const options = createBridgeOptions({
        mailboxPayloadDecoder: createMailboxPayloadDecoder({
          status: "decoded",
          wake,
        }),
        platform,
        vaultRoot,
      });

      await expect(options.importItem(createAssistantAskMailboxImportItem(wake, {
        id: `${wake.eventId}_different_row`,
      }))).resolves.toEqual({
        reasonCode: "payload.decode_mismatch",
        retryable: false,
        status: "blocked",
      });
      await expect(options.importItem(createAssistantAskMailboxImportItem(wake, {
        expiresAt: "2026-07-15T12:11:00.000Z",
      }))).resolves.toEqual({
        reasonCode: "payload.decode_mismatch",
        retryable: false,
        status: "blocked",
      });

      const matchingResult = await options.importItem(
        createAssistantAskMailboxImportItem(wake),
      );
      expect(matchingResult).not.toMatchObject({
        reasonCode: "payload.decode_mismatch",
      });
    }
  });

  it("admits only joined-group asks on the dirty-window fast path", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const consentedWake = createConsentedMemberAssistantAskRequestedWake();
    const consentedOptions = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: consentedWake,
      }),
      platform,
      vaultRoot,
    });

    await expect(consentedOptions.importItem(
      createAssistantAskMailboxImportItem(consentedWake),
      { assistantAskRequestTargetKind: "joined_group" },
    )).resolves.toEqual({
      reasonCode: "assistant_ask.target_not_admitted",
      status: "deferred",
    });

    const joinedWake = createAssistantAskRequestedWake();
    const joinedOptions = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: joinedWake,
      }),
      platform,
      vaultRoot,
    });
    await expect(joinedOptions.importItem(
      createAssistantAskMailboxImportItem(joinedWake),
      { assistantAskRequestTargetKind: "joined_group" },
    )).resolves.toMatchObject({ status: "imported" });
  });

  it("admits every accepted-input completion on the dirty-window fast path", async () => {
    const vaultRoot = await createVaultRoot();
    const { platform } = createRuntimePlatform();
    const reviewedWake = buildHostedExecutionAssistantAskCompletedWake({
      ask: {
        expiresAt: "2026-07-15T12:10:00.000Z",
        origin: {
          assistantInputId: "ain_0123456789abcdef0123456789abcdef",
          kind: "accepted_input",
          sessionId: "session_group",
        },
        question: "What exercises are assigned today?",
        requestId: "haask_consented_request_bridge",
        result: {
          answer: "Three sets of squats.",
          outcome: "answered",
        },
        targetLabel: null,
      },
      eventId: "haask_reviewed_completion_bridge",
      memberId: TEST_REQUEST.userId,
      occurredAt: "2026-07-15T12:05:00.000Z",
    });
    const reviewedOptions = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: reviewedWake,
      }),
      platform,
      vaultRoot,
    });

    await expect(reviewedOptions.importItem(
      createAssistantAskMailboxImportItem(reviewedWake),
    )).resolves.toMatchObject({ status: "imported" });

    const joinedWake = createAssistantAskCompletedWake();
    const joinedOptions = createBridgeOptions({
      mailboxPayloadDecoder: createMailboxPayloadDecoder({
        status: "decoded",
        wake: joinedWake,
      }),
      platform,
      vaultRoot,
    });
    await expect(joinedOptions.importItem(
      createAssistantAskMailboxImportItem(joinedWake),
    )).resolves.toMatchObject({ status: "imported" });
  });
});

function createBridgeOptions(input: {
  mailboxPayloadDecoder?: HostedWorkspaceMailboxPayloadDecoder;
  platform: HostedRuntimePlatform;
  readCurrentLease?: HostedRuntimeBridgeReadCurrentLease;
  request?: HostedWorkspaceInvocationRequest;
  snapshotArchiveBuilder?: HostedWorkspaceSnapshotArchiveBuilder;
  vaultRoot: string;
  waitForBackgroundAssistantWork?: (signal: AbortSignal | null) => Promise<void>;
}): HostedWorkspaceRuntimeJobOptions {
  const request = input.request ?? TEST_REQUEST;
  return createHostedWorkspaceRuntimeBridgeJobOptions({
    decodeMailboxPayload: input.mailboxPayloadDecoder ?? createMailboxPayloadDecoder({
      status: "decoded",
      wake: createMemberChannelsWake(),
    }),
    platform: input.platform,
    readCurrentLease: input.readCurrentLease ?? (() => createLease(request)),
    request,
    runtime: {},
    snapshotArchiveBuilder: input.snapshotArchiveBuilder ?? createSnapshotArchiveBuilder(),
    snapshotDiagnosticsHashSecret: "f".repeat(64),
    vaultRoot: input.vaultRoot,
    waitForBackgroundAssistantWork:
      input.waitForBackgroundAssistantWork ?? (async () => undefined),
  });
}

function createInvocationRequestWithWorkspaceCheckpoint(
  checkpointedAt: string,
): HostedWorkspaceInvocationRequest {
  return {
    ...TEST_REQUEST,
    workspace: {
      checkpointedAt,
      createdAt: "2026-05-01T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: checkpointedAt,
      userId: TEST_REQUEST.userId,
      version: TEST_REQUEST.workspaceVersion,
    },
  };
}

async function createVaultRoot(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-invocation-bridge-"));
  cleanupPaths.push(workspaceRoot);
  const vaultRoot = path.join(workspaceRoot, "durable", "vault");
  await mkdir(path.join(workspaceRoot, "durable", "home"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "scratch"), { recursive: true });
  await mkdir(vaultRoot, { recursive: true });
  await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
  return vaultRoot;
}

async function writeManyStaleCommittedOperationRecords(
  vaultRoot: string,
): Promise<{ newest: string; oldest: string }> {
  let newest = "";
  let oldest = "";
  for (let index = 0; index < 101; index += 1) {
    const relativePath = await writeOperationRecord(vaultRoot, {
      operationId: `op_stale_terminal_${String(index).padStart(3, "0")}`,
      status: "committed",
      updatedAt: new Date(Date.UTC(2026, 5, 1, 0, index, 0)).toISOString(),
    });
    if (index === 0) {
      oldest = relativePath;
    }
    newest = relativePath;
  }
  return { newest, oldest };
}

async function writeOperationRecord(
  vaultRoot: string,
  input: {
    operationId: string;
    status: "committed" | "rolled_back" | "staged";
    updatedAt: string;
  },
): Promise<string> {
  const operationDirectory = path.join(vaultRoot, ".runtime", "operations");
  await mkdir(operationDirectory, { recursive: true });
  const relativePath = `.runtime/operations/${input.operationId}.json`;
  await writeFile(
    path.join(vaultRoot, relativePath),
    `${JSON.stringify({
      actions: [],
      createdAt: input.updatedAt,
      occurredAt: input.updatedAt,
      operationId: input.operationId,
      operationType: "test_operation",
      schemaVersion: WRITE_OPERATION_SCHEMA_VERSION,
      status: input.status,
      summary: "test operation",
      updatedAt: input.updatedAt,
    }, null, 2)}\n`,
    "utf8",
  );
  return relativePath;
}

async function writeSettledAssistantInputResidue(
  vaultRoot: string,
): Promise<{ evidence: string; inputEvent: string }> {
  const recordedAt = "2026-01-01T00:00:00.000Z";
  const event = await upsertAssistantInputEvent({
    now: new Date(recordedAt),
    vault: vaultRoot,
    event: {
      content: {
        text: "old hosted input",
      },
      conversation: {
        accountId: null,
        actorId: "actor-residue",
        actorIsSelf: false,
        source: "email",
        threadId: "thread-residue",
        threadIsDirect: true,
      },
      occurredAt: recordedAt,
      receivedAt: recordedAt,
      replyTarget: {
        channel: "email",
        messageId: "message-residue",
        threadId: "thread-residue",
      },
      sourceRef: {
        dedupeKey: "dedupe-residue",
        eventId: "event-residue",
        itemId: "item-residue",
        kind: "hosted-mailbox",
        lane: "conversation",
        laneSeq: "1",
        payloadSchema: "test-payload",
        payloadSource: "inline",
        source: "hosted-mailbox",
        wakeSchema: "test-wake",
      },
    },
  });
  const inputEvent = `.runtime/operations/assistant/input-events/${event.inputId}.json`;
  const evidence = `.runtime/operations/assistant/auto-reply/evidence/${encodeURIComponent(event.inputId)}.json`;
  await mkdir(path.dirname(path.join(vaultRoot, evidence)), { recursive: true });
  await writeFile(
    path.join(vaultRoot, evidence),
    `${JSON.stringify({
      captureId: event.inputId,
      groupCaptureIds: [event.inputId],
      groupId: `group_${event.inputId}`,
      groupInputIds: [event.inputId],
      inputId: event.inputId,
      primaryCaptureId: event.inputId,
      primaryInputId: event.inputId,
      providerCleanup: {
        linqMessageIds: [],
        queuedAt: null,
      },
      recordedAt,
      schema: "murph.assistant-auto-reply-terminal-evidence.v1",
      terminal: {
        kind: "suppressed",
        reason: "already-handled",
      },
    })}\n`,
    "utf8",
  );
  return { evidence, inputEvent };
}

async function writeDisabledPendingAssistantInputResidue(
  vaultRoot: string,
): Promise<{ inputEvent: string; inputId: string; pendingIndex: string }> {
  const recordedAt = "2026-01-01T00:00:00.000Z";
  await saveAssistantAutomationState(vaultRoot, {
    autoReply: [{
      channel: "linq",
      eligibleAfter: null,
      enabledAt: recordedAt,
    }],
    updatedAt: recordedAt,
    version: 1,
  });
  const event = await upsertAssistantInputEvent({
    now: new Date(recordedAt),
    vault: vaultRoot,
    event: {
      content: {
        text: "old disabled-channel hosted input",
      },
      conversation: {
        accountId: null,
        actorId: "actor-disabled-residue",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread-disabled-residue",
        threadIsDirect: true,
      },
      occurredAt: recordedAt,
      receivedAt: recordedAt,
      replyTarget: {
        channel: "linq",
        messageId: "message-disabled-residue",
        threadId: "thread-disabled-residue",
      },
      sourceRef: {
        dedupeKey: "dedupe-disabled-residue",
        eventId: "event-disabled-residue",
        itemId: "item-disabled-residue",
        kind: "hosted-mailbox",
        lane: "conversation",
        laneSeq: "2",
        payloadSchema: "test-payload",
        payloadSource: "inline",
        source: "hosted-mailbox",
        wakeSchema: "test-wake",
      },
    },
  });
  await enqueueHostedPendingAssistantInputId({
    inputId: event.inputId,
    vaultRoot,
  });
  await saveAssistantAutomationState(vaultRoot, {
    autoReply: [],
    updatedAt: "2026-01-01T00:01:00.000Z",
    version: 1,
  });

  return {
    inputEvent: `.runtime/operations/assistant/input-events/${event.inputId}.json`,
    inputId: event.inputId,
    pendingIndex: ".runtime/operations/assistant/hosted-pending-inputs.json",
  };
}

async function expectPresent(absolutePath: string): Promise<void> {
  await access(absolutePath);
}

async function expectMissing(absolutePath: string): Promise<void> {
  await expect(access(absolutePath)).rejects.toMatchObject({
    code: "ENOENT",
  });
}

function createLease(
  request: HostedWorkspaceInvocationRequest = TEST_REQUEST,
): HostedRuntimeBridgeCheckpointLease {
  return {
    attemptId: request.attemptId,
    leaseGeneration: request.leaseGeneration,
    providerEgressToken: request.providerEgressToken ?? null,
    userId: request.userId,
    workspaceVersion: request.workspaceVersion,
  };
}

function createCheckpointInput<const Reason extends HostedWorkspaceCheckpointRequest["reason"]>(
  reason: Reason,
) {
  const state = {
    recentStatuses: [],
    watermarks: {
      conversation: "0",
      system: "0",
    },
  };

  return {
    importResult: {
      blocked: [],
      consumedSeqByLane: {
        conversation: null,
        system: null,
      },
      fetchedCount: 0,
      importedCount: 0,
      state,
    },
    previousState: state,
    reason,
    redactedStatus: {},
    state,
  };
}

function createSnapshotArchiveBuilder(): HostedWorkspaceSnapshotArchiveBuilder {
  return {
    buildEncryptedSnapshot: vi.fn(async (input) => {
      const temporaryDirectoryPath = await mkdtemp(path.join(input.outputDir, "snapshot-"));
      const encryptedFilePath = path.join(temporaryDirectoryPath, "snapshot.enc");
      await writeFile(encryptedFilePath, "encrypted snapshot", "utf8");
      return {
        compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
        encryptedByteSize: 18,
        encryptedFilePath,
        encryptedObjectSha256: "a".repeat(64),
        fileCount: input.archiveEntries.length,
        plaintextArchiveSha256: "b".repeat(64),
        temporaryDirectoryPath,
        totalPlainBytes: 9,
      };
    }),
  };
}

type WorkspaceSnapshotPort = NonNullable<HostedRuntimePlatform["workspaceSnapshotPort"]>;
type RuntimeLogPort = NonNullable<HostedRuntimePlatform["logPort"]>;

function createRuntimePlatform(): {
  calls: {
    abortSnapshotSession: ReturnType<typeof vi.fn<WorkspaceSnapshotPort["abortSnapshotSession"]>>;
    completeSnapshotSession: ReturnType<typeof vi.fn<WorkspaceSnapshotPort["completeSnapshotSession"]>>;
    logWrite: ReturnType<typeof vi.fn<RuntimeLogPort["write"]>>;
    putSnapshotObjectDirect: ReturnType<typeof vi.fn<WorkspaceSnapshotPort["putSnapshotObjectDirect"]>>;
    startSnapshotSession: ReturnType<typeof vi.fn<WorkspaceSnapshotPort["startSnapshotSession"]>>;
  };
  platform: HostedRuntimePlatform;
} {
  const objectKey = "users/member_bridge/workspace-snapshots/snapshot_bridge.snapshot.enc";
  const snapshotId = "snapshot_bridge";
  const startSnapshotSession = vi.fn(async (
    _input: Parameters<WorkspaceSnapshotPort["startSnapshotSession"]>[0],
  ) => ({
    encryption: {
      aad: buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId: TEST_REQUEST.userId,
      }),
      dataKeyBase64: "data-key-base64",
      ivBase64: "iv-base64",
      rootKeyId: "root_key_bridge",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped-data-key",
    },
    limits: {
      maxSinglePartEncryptedBytes: 1024,
      warnEncryptedBytes: 512,
    },
    objectKey,
    snapshotId,
  }));
  const putSnapshotObjectDirect = vi.fn(async (
    _input: Parameters<WorkspaceSnapshotPort["putSnapshotObjectDirect"]>[0],
  ) => ({
    snapshotDirectR2PresignElapsedMs: 1,
    snapshotDirectR2PutElapsedMs: 2,
  }));
  const completeSnapshotSession = vi.fn(async (
    input: Parameters<WorkspaceSnapshotPort["completeSnapshotSession"]>[0],
  ) => ({
    checkpoint: createCheckpointResponse({
      snapshotRef: input.ref,
      userId: TEST_REQUEST.userId,
      version: TEST_REQUEST.workspaceVersion,
    }),
    snapshotRef: input.ref,
  }));
  const abortSnapshotSession = vi.fn(async (
    _input: Parameters<WorkspaceSnapshotPort["abortSnapshotSession"]>[0],
  ) => {});
  const logWrite = vi.fn(async (
    input: Parameters<RuntimeLogPort["write"]>[0],
  ) => ({
    loggedCount: input.entries.length,
  }));

  return {
    calls: {
      abortSnapshotSession,
      completeSnapshotSession,
      logWrite,
      putSnapshotObjectDirect,
      startSnapshotSession,
    },
    platform: {
      artifactStore: {
        get: async () => null,
        put: async () => {},
      },
      effectsPort: {
        readRawEmailMessage: async () => null,
        sendEmail: async () => {},
      },
      logPort: {
        write: logWrite,
      },
      workspaceSnapshotPort: {
        abortSnapshotSession,
        completeSnapshotSession,
        putSnapshotObjectDirect,
        restoreWorkspaceSnapshot: async () => {},
        startSnapshotSession,
      },
    },
  };
}

function createMailboxPayloadDecoder(
  result: HostedWorkspaceMailboxPayloadDecodeResult,
): HostedWorkspaceMailboxPayloadDecoder {
  return {
    decode: vi.fn(async () => result),
  };
}

function createMemberChannelsWake(input: {
  eventId?: string;
  occurredAt?: string;
  userId?: string;
} = {}): HostedExecutionSystemWake {
  return {
    eventId: input.eventId ?? "event_bridge",
    kind: "member.channels.updated",
    memberChannels: {
      email: true,
      linq: false,
      telegram: false,
    },
    occurredAt: input.occurredAt ?? "2026-05-01T00:00:00.000Z",
    userId: input.userId ?? TEST_REQUEST.userId,
  };
}

function createAssistantAskRequestedWake(): HostedExecutionAssistantAskRequestedWake {
  return buildHostedExecutionAssistantAskRequestedWake({
    ask: {
      expiresAt: "2026-07-15T12:10:00.000Z",
      originAssistantInputId: "ain_0123456789abcdef0123456789abcdef",
      originSessionId: "session_private",
      question: "What exercises are assigned today?",
      target: {
        kind: "joined_group",
        membershipId: "hgrpm_generation_bridge",
        requestedLabel: "100 Club",
      },
    },
    eventId: "haask_request_bridge",
    memberId: TEST_REQUEST.userId,
    occurredAt: "2026-07-15T12:00:00.000Z",
  });
}

function createConsentedMemberAssistantAskRequestedWake():
HostedExecutionAssistantAskRequestedWake {
  return buildHostedExecutionAssistantAskRequestedWake({
    ask: {
      expiresAt: "2026-07-15T12:10:00.000Z",
      origin: {
        assistantInputId: "ain_0123456789abcdef0123456789abcdef",
        kind: "accepted_input",
        sessionId: "session_private",
      },
      question: "What exercises are assigned today?",
      target: {
        grantId: "grant_bridge",
        kind: "consented_member",
        membershipId: "hgrpm_generation_bridge",
        permissionDigest: "d".repeat(64),
      },
    },
    eventId: "haask_consented_request_bridge",
    memberId: TEST_REQUEST.userId,
    occurredAt: "2026-07-15T12:00:00.000Z",
  });
}

function createAssistantAskCompletedWake(): HostedExecutionAssistantAskCompletedWake {
  return buildHostedExecutionAssistantAskCompletedWake({
    ask: {
      expiresAt: "2026-07-15T12:10:00.000Z",
      originAssistantInputId: "ain_0123456789abcdef0123456789abcdef",
      originSessionId: "session_private",
      question: "What exercises are assigned today?",
      requestId: "haask_request_bridge",
      result: {
        answer: "Squats plus the pelvic sequence.",
        outcome: "answered",
      },
      targetLabel: "100 Club",
    },
    eventId: "haask_completion_bridge",
    memberId: TEST_REQUEST.userId,
    occurredAt: "2026-07-15T12:05:00.000Z",
  });
}

function createAssistantAskMailboxImportItem(
  wake: HostedExecutionAssistantAskRequestedWake | HostedExecutionAssistantAskCompletedWake,
  overrides: {
    expiresAt?: string;
    id?: string;
  } = {},
): Parameters<HostedWorkspaceRuntimeJobOptions["importItem"]>[0] {
  const routeAction = wake.kind === "assistant.ask.requested"
    ? "run-assistant-ask"
    : "continue-assistant-ask";
  const base = createSystemMailboxImportItem();
  return {
    ...base,
    item: {
      ...base.item,
      dedupeKey: wake.eventId,
      expiresAt: overrides.expiresAt ?? wake.ask.expiresAt,
      id: overrides.id ?? wake.eventId,
      kind: wake.kind,
      occurredAt: wake.occurredAt,
      userId: wake.userId,
    },
    route: {
      action: routeAction,
      advanceProgress: true,
      itemRef: {
        id: overrides.id ?? wake.eventId,
        kind: wake.kind,
        lane: "system",
        laneSeq: base.item.laneSeq,
      },
      state: "route",
    },
  };
}

function createSystemMailboxImportItem(input: {
  routeAction?: "apply-member-channels-update" | "import-conversation-message";
} = {}): Parameters<HostedWorkspaceRuntimeJobOptions["importItem"]>[0] {
  const routeAction = input.routeAction ?? "apply-member-channels-update";
  return {
    item: {
      createdAt: "2026-05-01T00:00:00.000Z",
      dedupeKey: "event_bridge",
      expiresAt: null,
      id: "mailbox_item_bridge",
      kind: "member.channels.updated",
      lane: "system",
      laneSeq: "1",
      occurredAt: "2026-05-01T00:00:00.000Z",
      payloadBytes: 32,
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_bridge",
      payloadSchema: "murph.hosted-mailbox-item-payload.v1",
      updatedAt: "2026-05-01T00:00:00.000Z",
      userId: TEST_REQUEST.userId,
    },
    payload: {
      payloadCiphertext: "opaque-mailbox-payload",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: "request_bridge_mailbox",
      source: "sidecar",
      status: "resolved",
    },
    route: {
      action: routeAction,
      advanceProgress: true,
      itemRef: {
        id: "mailbox_item_bridge",
        kind: "member.channels.updated",
        lane: "system",
        laneSeq: "1",
      },
      state: "route",
    },
  };
}

function createRetiredVaultShareMailboxImportItem(input: {
  kind: "vault-share.delivery" | "vault-share.revoke";
  routeAction: "import-vault-share-delivery" | "import-vault-share-revoke";
}): Parameters<HostedWorkspaceRuntimeJobOptions["importItem"]>[0] {
  const base = createSystemMailboxImportItem();
  const id = `retired_${input.kind.replaceAll(".", "_")}`;
  return {
    ...base,
    item: {
      ...base.item,
      dedupeKey: id,
      id,
      kind: input.kind,
    },
    route: {
      action: input.routeAction,
      advanceProgress: true,
      itemRef: {
        id,
        kind: input.kind,
        lane: "system",
        laneSeq: base.item.laneSeq,
      },
      state: "route",
    },
  };
}

function createRetiredMailboxImportItem(kind: HostedRetiredMailboxKind): Parameters<
  HostedWorkspaceRuntimeJobOptions["importItem"]
>[0] {
  const base = createSystemMailboxImportItem();
  const id = "retired_mailbox_item";
  return {
    ...base,
    item: {
      ...base.item,
      dedupeKey: id,
      id,
      kind,
    },
    route: {
      action: "skip-retired-mailbox-item",
      advanceProgress: true,
      itemRef: {
        id,
        kind,
        lane: "system",
        laneSeq: base.item.laneSeq,
      },
      state: "route",
    },
  };
}

function createCheckpointResponse(input: {
  snapshotRef: HostedWorkspaceCheckpointRequest["snapshotRef"];
  userId: string;
  version: string;
}): HostedWorkspaceCheckpointResponse {
  return {
    checkpointed: true,
    workspace: {
      checkpointedAt: "2026-05-01T00:00:01.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: input.snapshotRef,
      updatedAt: "2026-05-01T00:00:01.000Z",
      userId: input.userId,
      version: input.version,
    },
  };
}

async function expectLeaseFailure(
  operation: unknown,
  expected: {
    code: HostedRuntimeBridgeCheckpointLeaseErrorCode;
    stage: HostedRuntimeBridgeCheckpointLeaseStage;
  },
): Promise<HostedRuntimeBridgeCheckpointLeaseError> {
  let thrown: unknown;
  try {
    await operation;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(HostedRuntimeBridgeCheckpointLeaseError);
  if (!(thrown instanceof HostedRuntimeBridgeCheckpointLeaseError)) {
    throw new Error("Expected hosted runtime bridge checkpoint lease failure.");
  }
  expect(thrown.code).toBe(expected.code);
  expect(thrown.stage).toBe(expected.stage);
  return thrown;
}


async function deliverPendingMealMediaForTest(vaultRoot: string, mediaStore: NonNullable<HostedRuntimePlatform["mediaStore"]>) {
  // Baseline-compatible regression: old writers PUT during receipt preparation;
  // only v2 writers publish pending intent and use the subsequent idle owner.
  if (!(await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.some(entry => entry.pendingUpload)) return;
  const { runHostedMealMediaMaintenance, createHostedMealMediaBudget } = await import("../src/hosted-runtime/meal-media-maintenance.ts");
  await runHostedMealMediaMaintenance({ vaultRoot, mediaStore,
    signal: new AbortController().signal, budget: createHostedMealMediaBudget(), persistRetry: async () => {} });
}

// Exercise the real checkpoint inventory and bytes with a tar transport double;
// only encryption and the remote snapshot service are replaced in these tests.
function createPhotoCheckpointFixture(vaultRoot: string, store = createMealMediaStore()) {
  const { calls, platform } = createRuntimePlatform();
  platform.mediaStore = store.mediaStore;
  const start = calls.startSnapshotSession.getMockImplementation()!;
  calls.startSnapshotSession.mockImplementation(async input => ({ ...await start(input),
    limits: { maxSinglePartEncryptedBytes: 10_000_000, warnEncryptedBytes: 10_000_000 } }));
  let archive: Buffer;
  const builder = createSnapshotArchiveBuilder();
  const build = vi.mocked(builder.buildEncryptedSnapshot).getMockImplementation()!;
  vi.mocked(builder.buildEncryptedSnapshot).mockImplementation(async input => {
    const result = await build(input);
    const stage = path.join(result.temporaryDirectoryPath, "stage");
    await mkdir(stage);
    for (const entry of input.archiveEntries) {
      const destination = path.join(stage, entry.archivePath);
      if (entry.kind === "directory") await mkdir(destination, { recursive: true });
      else { await mkdir(path.dirname(destination), { recursive: true }); await cp(entry.absolutePath, destination); }
    }
    await promisify(execFile)("tar", ["-cf", result.encryptedFilePath, "-C", stage, "."]);
    archive = await readFile(result.encryptedFilePath);
    return { ...result, encryptedByteSize: archive.length };
  });
  const options = createBridgeOptions({ platform, vaultRoot, snapshotArchiveBuilder: builder });
  return { calls, store, archive: () => archive,
    checkpoint: (wake: { nextWakeAt?: string; nextWakeReason?: "inbox_media_retention" } = {}) => options.createCheckpointSnapshot({
      ...createCheckpointInput("idle_shutdown"), nextWakeAt: wake.nextWakeAt ?? null,
      nextWakeReason: wake.nextWakeReason ?? null, inboxMediaRetentionWakeAt: wake.nextWakeAt ?? null,
    }) };
}
function runPhotoIdleMaintenance(vaultRoot: string, store: ReturnType<typeof createMealMediaStore>, options: {
  processingMode?: Parameters<typeof runHostedIdleCheckpointMaintenance>[0]["processingMode"];
  persistRetry?: (retryAt: string, signal: AbortSignal) => Promise<void>;
  reportRetentionIssue?: Parameters<typeof runHostedIdleCheckpointMaintenance>[0]["reportRetentionIssue"];
} = {}) {
  return runHostedIdleCheckpointMaintenance({ vaultRoot, credentialSource: "platform", memberId: "member_synthetic",
    model: null, providerName: null, pendingWork: false, processingMode: options.processingMode ?? "inbox_media_retention",
    recordUsage: null, resolveAssistantSessionId: null, shutdownSignal: null, wakeSignal: null,
    reportRetentionIssue: options.reportRetentionIssue,
    mealMedia: { mediaStore: store.mediaStore, budget: createHostedMealMediaBudget(), persistRetry: options.persistRetry ?? (async () => {}) } });
}
async function restorePhotoCheckpoint(archive: Buffer): Promise<string> {
  const vaultRoot = await createVaultRoot();
  const durableRoot = path.dirname(vaultRoot);
  await rm(durableRoot, { recursive: true }); await mkdir(durableRoot);
  const archivePath = path.join(path.dirname(durableRoot), "restore.tar"); await writeFile(archivePath, archive);
  await promisify(execFile)("tar", ["-xf", archivePath, "-C", durableRoot]);
  resetHostedPhotoIntentsAfterColdRestore(vaultRoot);
  return vaultRoot;
}
async function runPhotoFixtureCli(vaultRoot: string, args: string[]): Promise<void> {
  const bin = fileURLToPath(new URL("../../cli/dist/bin.js", import.meta.url));
  try {
    await promisify(execFile)(process.execPath, [bin, ...args, "--vault", vaultRoot, "--format", "json"], {
      cwd: vaultRoot, env: { PATH: process.env.PATH, HOME: vaultRoot }, timeout: 30_000,
    });
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error) throw new Error(String(error.stdout).replaceAll(vaultRoot, "<VAULT>"));
    throw error;
  }
}
