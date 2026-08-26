import {
  TEST_NOW,
  TEST_USER_ID,
  createBundleRef,
  createDeferred,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  removeTempRoot,
  requireEventIndex,
  waitForFakeTimerScheduled,
  waitUntil,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

import assert from "node:assert/strict";
import { access, appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  addCaptureWithLookup,
  CURRENT_VAULT_FORMAT_VERSION,
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  buildIntegrationEvidencePart,
  buildIntegrationIngestRecord,
  findCaptureByLookup,
  initializeVault,
  patchAutomation,
  readHabitatAspect,
  readJsonlRecords,
  repairVault,
  runCanonicalWrite,
  showAutomation,
  upsertAutomation,
  validateVault,
} from "@murphai/core";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  readHostedRuntimeFailurePhaseCode,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxPayloadFetchRequest,
  type HostedMailboxPayloadFetchResponse,
  type HostedRuntimeRedactedJson,
  type HostedRuntimeLatencyTraceRequest,
  type HostedRuntimeLogRequest,
  type HostedRuntimeAssistantConfigurationControlRequest,
  type HostedRuntimeAssistantConfigurationSnapshot,
  type HostedRuntimeAssistantConfigurationToolResponse,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, test, vi } from "vitest";
import {
  createCoalescingRuntimeWakeSignal,
  HostedRuntimeCheckpointInterruptedByWakeError,
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  HostedWorkspaceRunnerUserMismatchError,
  drainHostedRuntimeDeferredUsageCompletionsBestEffort,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedWorkspaceRuntimeJobOptions,
  type HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
} from "../src/hosted-runtime.ts";

describe("hosted workspace runtime entrypoint", () => {test("runs deferred durable checkpoint effects only after idle checkpoint succeeds", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: "2026-04-27T00:02:00.000Z",
        nextWakeReason: "device-sync.reconcile",
      };
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_durable_effect_success",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/durable-effect-success.bundle.json",
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
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: durableEffect,
                checkpointReason: "assistant_runtime_commit",
              }),
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(
        events.indexOf("workspace.checkpoint") < events.indexOf("durable-effect"),
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, "2026-04-27T00:02:00.000Z");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoint-gated due projected wakes wait for the idle delay before service", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const runtimeTransitionTimeoutMs = 15_000;
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    let firstCheckpointStartedAtMs: number | null = null;
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: "2026-04-27T00:02:00.000Z",
        nextWakeReason: "system-mailbox",
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
              attemptId: "attempt_synthetic_durable_effect_external_wake",
              idleCheckpointDelayMs: 180_000,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              firstCheckpointStartedAtMs ??= Date.now();
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "f".repeat(64),
                  key: "users/bundles/member-synthetic/durable-effect-external-wake.bundle.json",
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
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase() {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                assistantOneObserved.resolve();
                return {
                  afterCheckpoint: async () => {
                    runtimeWakeSignal.notify();
                    return {
                      afterDurableCheckpoint: durableEffect,
                      checkpointReason: "system_mailbox_receipt",
                      nextWakeAt: TEST_NOW,
                      nextWakeReason: "assistant",
                    };
                  },
                  checkpointReason: "system_mailbox_receipt",
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assistantTwoObserved.resolve();
                return {
                  progressed: false,
                };
              }

              throw new Error("Self-projected wake ran before durable effect checkpoint.");
            },
            vaultRoot,
          },
        ),
        runtimeTransitionTimeoutMs,
        () => events.join(","),
      );
      await withRealTimeout(assistantOneObserved.promise, runtimeTransitionTimeoutMs, () =>
        events.join(",")
      );
      await waitForFakeTimerScheduled(() => events.join(","));
      assert.equal(checkpointRequests.length, 0);
      assert.equal(assistantPass, 1);
      await vi.advanceTimersByTimeAsync(179_000);
      assert.equal(checkpointRequests.length, 0);
      assert.equal(assistantPass, 1);
      await vi.advanceTimersByTimeAsync(1_000);
      await withRealTimeout(assistantTwoObserved.promise, runtimeTransitionTimeoutMs, () =>
        events.join(",")
      );
      const result = await resultPromise;

      assert.equal(firstCheckpointStartedAtMs, Date.parse(TEST_NOW) + 180_000);
      assert.equal(assistantPass, 2);
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", TEST_NOW, "assistant"],
          ["idle_shutdown", TEST_NOW, "assistant"],
          ["idle_shutdown", "2026-04-27T00:02:00.000Z", "system-mailbox"],
        ],
      );
      assert.ok(events.indexOf("workspace.checkpoint") < events.indexOf("durable-effect"));
      assert.ok(events.indexOf("durable-effect") < events.indexOf("assistant:2"));
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, "2026-04-27T00:02:00.000Z");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("round1: durable-effect wake survives a due-assistant service pass that reschedules", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 1;
    const dueAssistantWakeAt = TEST_NOW;
    const durableWakeAt = "2026-04-27T00:02:00.000Z";
    const replacementWakeAt = new Date(Date.parse(TEST_NOW) + 1).toISOString();
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    const assistantThreeObserved = createDeferred<void>();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: durableWakeAt,
        nextWakeReason: "system-mailbox",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_round1_durable_wake_survives_reschedule",
              idleCheckpointDelayMs,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createBundleRef({
                  hash: String(snapshotCount).repeat(64).slice(0, 64),
                  key:
                    "users/bundles/member-synthetic/"
                    + `round1-durable-wake-survives-reschedule-${snapshotCount}.bundle.json`,
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
                vi.setSystemTime(new Date(replacementWakeAt));
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: replacementWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              assistantThreeObserved.resolve();
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
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      await withRealTimeout(assistantThreeObserved.promise, 15_000, () => events.join(","));
      const result = await resultPromise;

      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(
        checkpointRequests.some((request) => request.nextWakeAt === durableWakeAt)
          || result.nextWakeAt === durableWakeAt,
        events.join(","),
      );
      assert.deepEqual(events.filter((event) => event.startsWith("assistant:")), [
        "assistant:1:none",
        `assistant:2:${dueAssistantWakeAt}`,
        `assistant:3:${replacementWakeAt}`,
      ]);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, durableWakeAt);
      assert.equal(result.immediateRecheckRequested, true);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("round3: later durable wake still waits after due assistant service", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 180_000;
    const dueAssistantWakeAt = TEST_NOW;
    const durableWakeAt = "2026-04-27T00:02:00.000Z";
    const replacementWakeAt = "2026-04-27T00:10:00.000Z";
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    const checkpointStartedAtMs: number[] = [];
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];
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
              attemptId: "attempt_round3_hot_work_durable_reconcile_waits",
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
                snapshotRef: createBundleRef({
                  hash: `${checkpointStartedAtMs.length}`.repeat(64).slice(0, 64),
                  key:
                    "users/bundles/member-synthetic/"
                    + `round3-hot-work-durable-reconcile-${checkpointStartedAtMs.length}.bundle.json`,
                  size: 512,
                }),
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            platform: createPlatform({
              latencyTraceRequests,
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
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: replacementWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
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
      await waitForFakeTimerScheduled(() => events.join(","));

      assert.equal(checkpointRequests.length, 2, events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1);
      assert.equal(checkpointRequests.length, 2, events.join(","));
      await vi.advanceTimersByTimeAsync(1);
      const result = await resultPromise;

      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(checkpointStartedAtMs, [
        Date.parse(TEST_NOW) + idleCheckpointDelayMs,
        Date.parse(TEST_NOW) + idleCheckpointDelayMs,
        Date.parse(TEST_NOW) + idleCheckpointDelayMs * 2,
      ]);
      expect([...new Set(latencyTraceRequests
        .map((request) => request.event)
        .filter((event) =>
          event.type === "runtime_milestone"
          && event.milestone === "checkpoint_publication_expected_by"
        )
        .map((event) => event.at))]).toEqual([
        "2026-04-27T00:27:00.000Z",
        "2026-04-27T00:30:00.000Z",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", dueAssistantWakeAt, "assistant"],
          ["idle_shutdown", dueAssistantWakeAt, "assistant"],
          ["idle_shutdown", durableWakeAt, "system-mailbox"],
        ],
      );
      assert.deepEqual(events.filter((event) => event.startsWith("assistant:")), [
        "assistant:1:none",
        `assistant:2:${dueAssistantWakeAt}`,
      ]);
      const runtimeWakeIndex = requireEventIndex(
        events,
        "runtime-wake:after-follow-up-checkpoint",
      );
      const assistantTwoIndex = requireEventIndex(
        events,
        `assistant:2:${dueAssistantWakeAt}`,
      );
      assert.ok(
        events.slice(runtimeWakeIndex + 1, assistantTwoIndex).includes("mailbox.fetch"),
        events.join(","),
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, durableWakeAt);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("services a due wake blocked only by durable effects instead of exiting the attempt", async () => {
    // Incident shape (2026-07-03): a reply turn leaves a plain due assistant
    // wake (starved system-lane work) plus pending durable effects (consume
    // acks). The attempt must checkpoint, run the effects, service the
    // still-due wake in-attempt, and finish with a non-due return instead of
    // handing a due wake to the orchestrator, which has no prompt transport
    // for it.
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_effects_blocked_due_wake_001",
        laneSeq: "1",
      }),
    ];
    const dueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const foregroundAfterCheckpointGate = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {};
    });
    let assistantPass = 0;
    let snapshotCount = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_effects_blocked_due_wake",
            idleCheckpointDelayMs: 25,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotCount += 1;
            events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
            return {
              snapshotRef: createBundleRef({
                hash: String(snapshotCount).repeat(64),
                key: `users/bundles/member-synthetic/effects-blocked-due-wake-${snapshotCount}.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.id !== "mailbox_item_entrypoint_effects_blocked_due_wake_001") {
              return { status: "imported" };
            }

            return {
              afterCheckpoint: async () => {
                events.push("mailbox.afterCheckpoint:start");
                await foregroundAfterCheckpointGate.promise;
                events.push("mailbox.afterCheckpoint:done");
                return {
                  attachmentEvidenceUpdated: true,
                  kind: "inbox_projection",
                  projectionUpdated: true,
                  reasonCode: null,
                  status: "succeeded",
                };
              },
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPass += 1;
            events.push(`assistant:${assistantPass}`);

            if (assistantPass === 1) {
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: durableEffect,
                  checkpointReason: "system_mailbox_receipt",
                }),
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: dueWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            if (assistantPass === 2) {
              assert.ok(
                events.includes(
                  "mailbox.importItem:mailbox_item_entrypoint_effects_blocked_due_wake_002",
                ),
                events.join(","),
              );
              assert.notEqual(input.workspace?.nextWakeAt, dueWakeAt);
              assert.ok(
                !events.includes("workspace.checkpoint"),
                events.join(","),
              );
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
              };
            }

            if (assistantPass === 3) {
              // The service pass runs only after the checkpoint committed the
              // pending durable effects.
              assert.ok(events.includes("durable-effect"), events.join(","));
              assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
              assert.equal(input.workspace?.nextWakeReason, "assistant");
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
              };
            }

            throw new Error("Effects-blocked due wake should be serviced exactly once.");
          },
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      await waitUntil(() => {
        assert.equal(events.includes("mailbox.afterCheckpoint:start"), true, events.join(","));
      }, 10_000);
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_effects_blocked_due_wake_002",
        laneSeq: "2",
      }));
      runtimeWakeSignal.notify();
      await waitUntil(() => {
        assert.equal(events.includes("assistant:2"), true);
      });
      assert.ok(
        !events.includes("workspace.checkpoint"),
        events.join(","),
      );
      foregroundAfterCheckpointGate.resolve();

      const result = await withRealTimeout(
        resultPromise,
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 3, events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", "0", dueWakeAt, "assistant"],
          ["idle_shutdown", "1", null, null],
        ],
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "mailbox.afterCheckpoint:done"),
      );
      assert.ok(
        requireEventIndex(events, "mailbox.afterCheckpoint:done")
          < requireEventIndex(events, "snapshot:idle_shutdown:1"),
      );
      assert.ok(events.indexOf("snapshot:idle_shutdown:1") < events.indexOf("durable-effect"));
      assert.ok(events.indexOf("durable-effect") < events.indexOf("assistant:3"));
      assert.ok(events.indexOf("assistant:3") < events.indexOf("snapshot:idle_shutdown:2"));
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      foregroundAfterCheckpointGate.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("source-blind pre-checkpoint wakes preserve durable-effects-blocked due wakes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_effects_blocked_dirty_wake_001",
        laneSeq: "1",
      }),
    ];
    const dueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {};
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_effects_blocked_dirty_wake",
              idleCheckpointDelayMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createBundleRef({
                  hash: String(snapshotCount).repeat(64),
                  key:
                    `users/bundles/member-synthetic/effects-blocked-dirty-wake-`
                    + `${snapshotCount}.bundle.json`,
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: mailboxItems,
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => {
                    events.push("assistant.afterCheckpoint:1");
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_effects_blocked_dirty_wake_002",
                      laneSeq: "2",
                    }));
                    runtimeWakeSignal.notify();
                    return {
                      afterDurableCheckpoint: durableEffect,
                      checkpointReason: "system_mailbox_receipt",
                    };
                  },
                  checkpointReason: "system_mailbox_receipt",
                  nextWakeAt: dueWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.ok(
                  events.includes(
                    "mailbox.importItem:mailbox_item_entrypoint_effects_blocked_dirty_wake_002",
                  ),
                  events.join(","),
                );
                assert.notEqual(input.workspace?.nextWakeAt, dueWakeAt);
                assert.ok(
                  !events.includes("workspace.checkpoint"),
                  events.join(","),
                );
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              if (assistantPass === 3) {
                assert.ok(events.includes("durable-effect"), events.join(","));
                assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Effects-blocked dirty wake should be serviced exactly once.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 3, events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", "0", dueWakeAt, "assistant"],
          ["idle_shutdown", "1", null, null],
        ],
      );
      assert.ok(
        requireEventIndex(events, "assistant.afterCheckpoint:1")
          < requireEventIndex(
            events,
            "mailbox.importItem:mailbox_item_entrypoint_effects_blocked_dirty_wake_002",
          ),
      );
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_effects_blocked_dirty_wake_002",
        )
          < requireEventIndex(events, "assistant:2"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "snapshot:idle_shutdown:1"),
      );
      assert.ok(events.indexOf("snapshot:idle_shutdown:1") < events.indexOf("durable-effect"));
      assert.ok(events.indexOf("durable-effect") < events.indexOf("assistant:3"));
      assert.ok(events.indexOf("assistant:3") < events.indexOf("snapshot:idle_shutdown:2"));
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("source-blind competing wakes preserve durable-effects-blocked assistant wakes as checkpoint wakes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_competing_effects_blocked_wake_001",
        laneSeq: "1",
      }),
    ];
    const blockedWakeAt = new Date(Date.now() - 30_000).toISOString();
    const competingWakeAt = new Date(Date.now() - 60_000).toISOString();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {};
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_competing_effects_blocked_wake",
              idleCheckpointDelayMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createBundleRef({
                  hash: String(snapshotCount).repeat(64),
                  key:
                    `users/bundles/member-synthetic/competing-effects-blocked-wake-`
                    + `${snapshotCount}.bundle.json`,
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: mailboxItems,
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => {
                    events.push("assistant.afterCheckpoint:1");
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_competing_effects_blocked_wake_002",
                      laneSeq: "2",
                    }));
                    runtimeWakeSignal.notify();
                    return {
                      afterDurableCheckpoint: durableEffect,
                      checkpointReason: "system_mailbox_receipt",
                    };
                  },
                  checkpointReason: "system_mailbox_receipt",
                  nextWakeAt: blockedWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.ok(
                  events.includes(
                    "mailbox.importItem:mailbox_item_entrypoint_competing_effects_blocked_wake_002",
                  ),
                  events.join(","),
                );
                assert.notEqual(input.workspace?.nextWakeAt, blockedWakeAt);
                assert.ok(
                  !events.includes("workspace.checkpoint"),
                  events.join(","),
                );
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: competingWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 3) {
                assert.ok(events.includes("durable-effect"), events.join(","));
                assert.equal(input.workspace?.nextWakeAt, blockedWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Durable-effects-blocked wake should service once after checkpoint.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 3, events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", "0", blockedWakeAt, "assistant"],
          ["idle_shutdown", "1", null, null],
        ],
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "snapshot:idle_shutdown:1"),
      );
      assert.ok(events.indexOf("snapshot:idle_shutdown:1") < events.indexOf("durable-effect"));
      assert.ok(events.indexOf("durable-effect") < events.indexOf("assistant:3"));
      assert.ok(events.indexOf("assistant:3") < events.indexOf("snapshot:idle_shutdown:2"));
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("source-blind pre-checkpoint wakes preserve checkpoint-gated due assistant wakes as checkpoint wakes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_checkpoint_gated_dirty_wake_001",
        laneSeq: "1",
      }),
    ];
    const dueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_checkpoint_gated_dirty_wake",
              idleCheckpointDelayMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createBundleRef({
                  hash: String(snapshotCount).repeat(64),
                  key:
                    `users/bundles/member-synthetic/checkpoint-gated-dirty-wake-`
                    + `${snapshotCount}.bundle.json`,
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: mailboxItems,
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => {
                    events.push("assistant.afterCheckpoint:1");
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_checkpoint_gated_dirty_wake_002",
                      laneSeq: "2",
                    }));
                    runtimeWakeSignal.notify();
                    return {
                      checkpointReason: "system_mailbox_receipt",
                      nextWakeAt: dueWakeAt,
                      nextWakeReason: "assistant",
                    };
                  },
                  checkpointReason: "system_mailbox_receipt",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.ok(
                  events.includes(
                    "mailbox.importItem:mailbox_item_entrypoint_checkpoint_gated_dirty_wake_002",
                  ),
                  events.join(","),
                );
                assert.notEqual(input.workspace?.nextWakeAt, dueWakeAt);
                assert.ok(
                  !events.includes("workspace.checkpoint"),
                  events.join(","),
                );
                return {
                  browserVaultReplicaRefreshRequested: true,
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: dueWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 3) {
                assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                assert.ok(events.includes("workspace.checkpoint"), events.join(","));
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Checkpoint-gated dirty wake should service once after checkpoint.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 3, events.join(","));
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", "0", dueWakeAt, "assistant"],
          ["idle_shutdown", "1", null, null],
        ],
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "snapshot:idle_shutdown:1"),
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown:1")
          < requireEventIndex(events, "assistant:3"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:3")
          < requireEventIndex(events, "snapshot:idle_shutdown:2"),
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("services a durable-effect due assistant wake after forced follow-up checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const dueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: dueWakeAt,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_durable_effect_follow_up_due_wake",
            idleCheckpointDelayMs: 25,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotCount += 1;
            events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
            return {
              snapshotRef: createBundleRef({
                hash: String(snapshotCount).repeat(64),
                key: `users/bundles/member-synthetic/durable-effect-follow-up-due-wake-${snapshotCount}.bundle.json`,
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
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPass += 1;
            events.push(`assistant:${assistantPass}`);

            if (assistantPass === 1) {
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: durableEffect,
                  checkpointReason: "system_mailbox_receipt",
                }),
                checkpointReason: "system_mailbox_receipt",
                progressed: true,
              };
            }

            if (assistantPass === 2) {
              assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
              assert.equal(input.workspace?.nextWakeReason, "assistant");
              assert.ok(events.includes("durable-effect"), events.join(","));
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
              };
            }

            throw new Error("Durable-effect due wake should be serviced exactly once.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPass, 2, events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", "0", null, null],
          ["idle_shutdown", "1", dueWakeAt, "assistant"],
          ["idle_shutdown", "2", null, null],
        ],
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown:1")
          < requireEventIndex(events, "durable-effect"),
      );
      assert.ok(
        requireEventIndex(events, "durable-effect")
          < requireEventIndex(events, "snapshot:idle_shutdown:2"),
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown:2")
          < requireEventIndex(events, "assistant:2"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "snapshot:idle_shutdown:3"),
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fresh due assistant wake replaces checkpointed due wake after fresh post-checkpoint input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const dueWakeAt = new Date(Date.now() - 60_000).toISOString();
    const freshDueWakeAt = new Date(Date.now() - 30_000).toISOString();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: dueWakeAt,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_follow_up_fresh_due_wake",
              idleCheckpointDelayMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createBundleRef({
                  hash: String(snapshotCount).repeat(64),
                  key:
                    `users/bundles/member-synthetic/follow-up-fresh-due-wake-`
                    + `${snapshotCount}.bundle.json`,
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: mailboxItems,
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                checkpointWorkspace(request) {
                  const workspace = createWorkspaceState({
                    inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  });
                  if (request.expectedWorkspaceVersion === "1") {
                    events.push("runtime-wake:after-follow-up-checkpoint");
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_follow_up_fresh_due_input_001",
                      laneSeq: "1",
                    }));
                    runtimeWakeSignal.notify();
                  }
                  return workspace;
                },
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => ({
                    afterDurableCheckpoint: durableEffect,
                    checkpointReason: "system_mailbox_receipt",
                  }),
                  checkpointReason: "system_mailbox_receipt",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  invocationLocalAssistantWakeAt: freshDueWakeAt,
                  nextWakeAt: freshDueWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 3) {
                assert.equal(input.workspace?.nextWakeAt, freshDueWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Fresh due wake should run once after checkpoint.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 3, events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", "0", null, null],
          ["idle_shutdown", "1", dueWakeAt, "assistant"],
          ["idle_shutdown", "2", null, null],
        ],
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown:2")
          < requireEventIndex(events, "assistant:2"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "assistant:3"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:3")
          < requireEventIndex(events, "snapshot:idle_shutdown:3"),
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoints durable follow-up effects before servicing their due assistant wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const wakeA = new Date(Date.now() - 60_000).toISOString();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      runtimeWakeSignal.notify();
      return {
        nextWakeAt: wakeA,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_follow_up_preempted_replacement_wake",
              idleCheckpointDelayMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createBundleRef({
                  hash: String(snapshotCount).repeat(64),
                  key: `users/bundles/member-synthetic/follow-up-preempted-replacement-wake-${snapshotCount}.bundle.json`,
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
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => ({
                    afterDurableCheckpoint: durableEffect,
                    checkpointReason: "system_mailbox_receipt",
                  }),
                  checkpointReason: "system_mailbox_receipt",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.ok(events.includes("durable-effect"), events.join(","));
                assert.equal(input.workspace?.nextWakeAt, wakeA);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Durable-effect due wake should be serviced exactly once.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 2, events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", "0", null, null],
          ["idle_shutdown", "1", wakeA, "assistant"],
          ["idle_shutdown", "2", null, null],
        ],
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown:1")
          < requireEventIndex(events, "durable-effect"),
      );
      assert.ok(
        requireEventIndex(events, "durable-effect")
          < requireEventIndex(events, "snapshot:idle_shutdown:2"),
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown:2")
          < requireEventIndex(events, "assistant:2"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "snapshot:idle_shutdown:3"),
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("services an already-projected due assistant wake after durable follow-up checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const dueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: dueWakeAt,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_projected_follow_up_due_wake",
            idleCheckpointDelayMs: 25,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotCount += 1;
            events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
            return {
              snapshotRef: createBundleRef({
                hash: String(snapshotCount).repeat(64),
                key: `users/bundles/member-synthetic/projected-follow-up-due-wake-${snapshotCount}.bundle.json`,
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
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPass += 1;
            events.push(`assistant:${assistantPass}`);

            if (assistantPass === 1) {
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: durableEffect,
                  checkpointReason: "system_mailbox_receipt",
                }),
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: dueWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            if (assistantPass === 2) {
              assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
              assert.equal(input.workspace?.nextWakeReason, "assistant");
              assert.ok(events.includes("durable-effect"), events.join(","));
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
              };
            }

            throw new Error("Already-projected due wake should be serviced exactly once.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPass, 2, events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", "0", dueWakeAt, "assistant"],
          ["idle_shutdown", "1", dueWakeAt, "assistant"],
          ["idle_shutdown", "2", null, null],
        ],
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown:1")
          < requireEventIndex(events, "durable-effect"),
      );
      assert.ok(
        requireEventIndex(events, "durable-effect")
          < requireEventIndex(events, "snapshot:idle_shutdown:2"),
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown:2")
          < requireEventIndex(events, "assistant:2"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "snapshot:idle_shutdown:3"),
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("services a checkpoint-blocked projected assistant wake after idle checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const dueWakeAt = TEST_NOW;
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_checkpoint_blocked_due_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotCount += 1;
            events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
            return {
              snapshotRef: createBundleRef({
                hash: String(snapshotCount).repeat(64),
                key: `users/bundles/member-synthetic/checkpoint-blocked-due-wake-${snapshotCount}.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Checkpoint-blocked wake test should not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPass += 1;
            events.push(`assistant:${assistantPass}`);

            if (assistantPass === 1) {
              const redactedStatus: HostedRuntimeRedactedJson = {
                hostedOutboxPendingDeliveryEffects: 1,
              };
              return {
                afterCheckpoint: async () => ({
                  checkpointReason: "outbox_receipt",
                  nextWakeAt: dueWakeAt,
                  nextWakeReason: "assistant",
                  redactedStatus: {
                    hostedOutboxDeliverySent: 1,
                  },
                }),
                checkpointReason: "outbox_sending",
                progressed: true,
                redactedStatus,
              };
            }

            if (assistantPass === 2) {
              assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
              assert.equal(input.workspace?.nextWakeReason, "assistant");
              const redactedStatus: HostedRuntimeRedactedJson = {
                hostedAssistantProgressed: true,
                hostedAssistantNextWakeAt: null,
              };
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
                redactedStatus,
              };
            }

            throw new Error("Checkpoint-blocked wake should be serviced exactly once.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPass, 2);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", "0", dueWakeAt, "assistant"],
          ["idle_shutdown", "1", null, null],
        ],
      );
      assert.ok(
        events.indexOf("workspace.checkpoint") < events.indexOf("assistant:2"),
      );
      assert.ok(
        events.indexOf("assistant:2") < events.lastIndexOf("workspace.checkpoint"),
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("services a checkpointed plain due assistant wake before replacement", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const mintedWakeAt = new Date(Date.now() - 60_000).toISOString();
    const replacementWakeAt = new Date(Date.now() - 30_000).toISOString();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {};
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_replaced_plain_due_wake",
              idleCheckpointDelayMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createBundleRef({
                  hash: String(snapshotCount).repeat(64),
                  key: `users/bundles/member-synthetic/replaced-plain-due-wake-${snapshotCount}.bundle.json`,
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
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => {
                    runtimeWakeSignal.notify();
                    return {
                      afterDurableCheckpoint: durableEffect,
                      checkpointReason: "system_mailbox_receipt",
                      nextWakeAt: mintedWakeAt,
                      nextWakeReason: "assistant",
                    };
                  },
                  checkpointReason: "system_mailbox_receipt",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.equal(input.workspace?.nextWakeAt, mintedWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                assert.ok(events.includes("durable-effect"), events.join(","));
                return {
                  checkpointReason: "assistant_runtime_commit",
                  invocationLocalAssistantWakeAt: replacementWakeAt,
                  nextWakeAt: replacementWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 3) {
                assert.equal(input.workspace?.nextWakeAt, replacementWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Replaced plain due wake should be serviced exactly once.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 3, events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", "0", mintedWakeAt, "assistant"],
          ["idle_shutdown", "1", null, null],
        ],
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown:1")
          < requireEventIndex(events, "durable-effect"),
      );
      assert.ok(
        requireEventIndex(events, "durable-effect")
          < requireEventIndex(events, "assistant:2"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "assistant:3"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:3")
          < requireEventIndex(events, "snapshot:idle_shutdown:2"),
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  });
