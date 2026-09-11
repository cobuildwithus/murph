import {
  TEST_NOW,
  TEST_USER_ID,
  createDeferred,
  createMailboxPort,
  createPlatform,
  createSnapshotFixtureRef,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  removeTempRoot,
  waitForFakeTimerScheduled,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { test, vi } from "vitest";
import {
  createCoalescingRuntimeWakeSignal,
  runHostedWorkspaceRuntimeJobInProcess,
} from "../src/hosted-runtime.ts";

test("metadata-only post-checkpoint reconciliation does not rearm the idle window", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const idleCheckpointDelayMs = 180_000;
  const dueAssistantWakeAt = TEST_NOW;
  const durableWakeAt = "2026-04-27T00:20:00.000Z";
  const replacementWakeAt = "2026-04-27T00:10:00.000Z";
  const assistantOneObserved = createDeferred<void>();
  const assistantTwoObserved = createDeferred<void>();
  const checkpointStartedAtMs: number[] = [];
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const durableEffect = vi.fn(async () => {
    events.push("durable-effect");
    return {
      nextWakeAt: durableWakeAt,
      nextWakeReason: "system-mailbox",
      requiresFollowUpCheckpoint: true,
    };
  });
  let assistantPass = 0;

  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  try {
    vi.setSystemTime(new Date(TEST_NOW));
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });

    const resultPromise = withRealTimeout(
      runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_metadata_only_checkpoint_timing",
            idleCheckpointDelayMs,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            checkpointStartedAtMs.push(Date.now());
            events.push(`snapshot:${snapshotInput.reason}:${checkpointStartedAtMs.length}`);
            return {
              snapshotRef: createSnapshotFixtureRef({
                hash: `${checkpointStartedAtMs.length}`.repeat(64).slice(0, 64),
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace: (request) => {
                if (checkpointRequests.length === 2) {
                  events.push("runtime-wake:after-follow-up-checkpoint");
                  runtimeWakeSignal.notify();
                }
                return createWorkspaceState({
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
              },
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            assistantPass += 1;
            events.push(
              `assistant:${assistantPass}:${input.workspace?.nextWakeAt ?? "none"}`,
            );

            if (assistantPass === 1) {
              assistantOneObserved.resolve();
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: durableEffect,
                  checkpointReason: "system_mailbox_receipt",
                  nextWakeAt: dueAssistantWakeAt,
                  nextWakeReason: "assistant",
                }),
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: dueAssistantWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            if (assistantPass === 2) {
              assistantTwoObserved.resolve();
              return {
                nextWakeAt: replacementWakeAt,
                nextWakeReason: "assistant",
                progressed: false,
                runtimeProjectionCheckpointRequested: true,
              };
            }

            return {
              progressed: false,
            };
          },
          vaultRoot,
        },
      ),
      15_000,
      () => events.join(","),
    );

    await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
    await waitForFakeTimerScheduled(() => events.join(","));
    await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
    await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
    await Promise.race([
      waitForFakeTimerScheduled(() => events.join(",")),
      resultPromise,
    ]);
    await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
    await resultPromise;

    assert.equal(durableEffect.mock.calls.length, 1);
    assert.deepEqual(checkpointStartedAtMs, [
      Date.parse(TEST_NOW) + idleCheckpointDelayMs,
      Date.parse(TEST_NOW) + idleCheckpointDelayMs,
      Date.parse(TEST_NOW) + idleCheckpointDelayMs,
    ]);
    const finalCheckpoint = checkpointRequests.at(-1);
    assert.deepEqual(
      [finalCheckpoint?.nextWakeAt, finalCheckpoint?.nextWakeReason],
      [replacementWakeAt, "assistant"],
    );
  } finally {
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});

test("metadata-only reconciliation preserves an active foreground quiet window", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-metadata-active-window-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const checkpointStartedAtMs: number[] = [];
  const idleCheckpointDelayMs = 180_000;
  const metadataPassDelayMs = 60_000;
  const replacementWakeAt = "2026-04-27T00:20:00.000Z";
  const firstPassObserved = createDeferred<void>();
  const metadataPassObserved = createDeferred<void>();
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  let assistantPass = 0;

  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  try {
    vi.setSystemTime(new Date(TEST_NOW));
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const resultPromise = withRealTimeout(
      runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({ request: { idleCheckpointDelayMs } }),
        {
          async createCheckpointSnapshot() {
            checkpointStartedAtMs.push(Date.now());
            return { snapshotRef: createSnapshotFixtureRef({ hash: "c".repeat(64), size: 512 }) };
          },
          async importItem() { return { status: "imported" }; },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPass += 1;
            events.push(`assistant:${assistantPass}`);
            if (assistantPass === 1) {
              setTimeout(() => runtimeWakeSignal.notify(), metadataPassDelayMs);
              firstPassObserved.resolve();
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: "2026-04-27T00:10:00.000Z",
                nextWakeReason: "assistant",
                progressed: true,
              };
            }
            metadataPassObserved.resolve();
            return {
              nextWakeAt: replacementWakeAt,
              nextWakeReason: "assistant",
              progressed: false,
              runtimeProjectionCheckpointRequested: true,
            };
          },
          vaultRoot,
        },
      ),
      15_000,
      () => events.join(","),
    );

    await withRealTimeout(firstPassObserved.promise, 15_000, () => events.join(","));
    await waitForFakeTimerScheduled(() => events.join(","));
    await vi.advanceTimersByTimeAsync(metadataPassDelayMs);
    await withRealTimeout(metadataPassObserved.promise, 15_000, () => events.join(","));
    await waitForFakeTimerScheduled(() => events.join(","));
    assert.equal(checkpointRequests.length, 0);
    await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - metadataPassDelayMs - 1);
    assert.equal(checkpointRequests.length, 0);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.race([resultPromise, waitForFakeTimerScheduled(() => events.join(","))]);
    await vi.advanceTimersByTimeAsync(metadataPassDelayMs);
    await resultPromise;

    assert.equal(assistantPass, 2);
    assert.deepEqual(checkpointStartedAtMs, [Date.parse(TEST_NOW) + idleCheckpointDelayMs]);
    const finalCheckpoint = checkpointRequests.at(-1);
    assert.deepEqual(
      [finalCheckpoint?.nextWakeAt, finalCheckpoint?.nextWakeReason],
      [replacementWakeAt, "assistant"],
    );
  } finally {
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});
