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
  importRuntimeControlSystemMailboxItemForTest,
  readConversationImportedSeq,
  readConversationImportedSeqs,
  removeTempRoot,
  requireEventIndex,
  stageAssistantInputEventForMailboxItem,
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
import {
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
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
import {
  createHostedWorkspaceRuntimeBridgeJobOptions,
  type HostedWorkspaceSnapshotArchiveBuilder,
} from "../src/hosted-runtime/snapshot-bridge.ts";
import {
  HostedRuntimeBridgeCheckpointLeaseError,
} from "../src/hosted-runtime/checkpoint-bridge.ts";
import type {
  RuntimeWakeSignal,
} from "../src/hosted-runtime/runtime-wake.ts";
import {
  HostedRuntimeArtifactReadError,
  type HostedRuntimeDeviceSyncPort,
  type HostedRuntimeMailboxPort,
  type HostedRuntimePlatform,
  type RuntimeLivenessPort,
  type HostedRuntimeWorkspacePort,
  type HostedRuntimeWorkspaceSnapshotPort,
} from "../src/hosted-runtime-contracts.ts";

describe("hosted workspace runtime entrypoint", () => {test("retained post-checkpoint consumed conversation replay checkpoints dirty import before returning", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    let assistantPhaseCalls = 0;
    let checkpointSnapshotCreated = false;
    let postCheckpointWakeConsumed = false;
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        if (checkpointSnapshotCreated && !postCheckpointWakeConsumed) {
          postCheckpointWakeConsumed = true;
          mailboxItems.push(createMailboxItem({
            consumedAt: TEST_NOW,
            id: "mailbox_item_post_checkpoint_consumed_replay",
            laneSeq: "1",
          }));
          return { notifiedAtEpochMs: 1_777_000_000_105 };
        }
        return null;
      },
      notify() {},
      wait(signal) {
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Runtime wake wait was aborted.", "AbortError"),
          );
        }
        return new Promise((_resolve, reject) => {
          const abort = () => {
            signal?.removeEventListener("abort", abort);
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("Runtime wake wait was aborted.", "AbortError"),
            );
          };
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_post_checkpoint_consumed_replay",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            checkpointSnapshotCreated = true;
            return {
              snapshotRef: createBundleRef({
                hash: `${checkpointRequests.length}`.repeat(64).slice(0, 64),
                key: `users/bundles/member-synthetic/post-checkpoint-consumed-replay-${checkpointRequests.length}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            assert.equal(item.durablyConsumed, true);
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
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls > 1) {
              throw new Error("Consumed replay should not start another assistant pass.");
            }
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.equal(postCheckpointWakeConsumed, true);
      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        ["mailbox.importItem:mailbox_item_post_checkpoint_consumed_replay"],
      );
      assert.equal(checkpointRequests.length, 2);
      assert.deepEqual(
        checkpointRequests.map((request) =>
          request.redactedStatus?.hostedMailboxConversationImportedSeq
        ),
        ["0", "1"],
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "1");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("foreground-pending idle checkpoint responses rerun the foreground pass before checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_checkpoint_foreground_pending_001",
        laneSeq: "1",
      }),
    ];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_foreground_pending",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: `${checkpointRequests.length}`.repeat(64).slice(0, 64),
                key: `users/bundles/member-synthetic/runtime-idle-checkpoint-foreground-pending-${checkpointRequests.length}.bundle.json`,
                size: 640,
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
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push(`workspace.checkpoint:${request.expectedWorkspaceVersion}`);
                checkpointRequests.push(request);
                if (checkpointRequests.length === 1) {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_checkpoint_foreground_pending_002",
                    laneSeq: "2",
                  }));
                  return {
                    checkpointConflictReason: "foreground_pending",
                    checkpointed: false,
                    workspace: createWorkspaceState({ version: "4" }),
                  };
                }
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    version: "5",
                  }),
                };
              },
            },
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(readConversationImportedSeqs(fetchRequests), ["0", "1"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_foreground_pending_001",
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_foreground_pending_002",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "4",
        "4",
      ]);
      assert.deepEqual(
        checkpointRequests.map(
          (request) => request.redactedStatus?.hostedMailboxConversationImportedSeq,
        ),
        ["1", "2"],
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("durable follow-up checkpoints yield to foreground-pending idle conflicts", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const dueWakeAt = new Date(Date.now() - 60_000).toISOString();
    const freshFutureWakeAt = new Date(Date.now() + 60_000).toISOString();
    const laterFutureWakeAt = new Date(Date.now() + 120_000).toISOString();
    const foregroundAfterCheckpointGate = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_forced_checkpoint_pending_001",
        laneSeq: "1",
      }));
      runtimeWakeSignal.notify();
      return {
        nextWakeAt: dueWakeAt,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_forced_checkpoint_foreground_pending",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(
              `snapshot:${snapshotInput.reason}:`
              + `${snapshotInput.expectedWorkspaceVersion ?? "unknown"}`,
            );
            return {
              snapshotRef: createBundleRef({
                hash: `${checkpointRequests.length + 1}`.repeat(64).slice(0, 64),
                key:
                  `users/bundles/member-synthetic/forced-checkpoint-foreground-pending-`
                  + `${checkpointRequests.length}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
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
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "0" }),
                };
              },
              async checkpoint(request) {
                const checkpointAttemptKind =
                  request.expectedWorkspaceVersion === "1"
                  && request.reason === "idle_shutdown"
                  && !events.includes(
                    "mailbox.importItem:mailbox_item_entrypoint_forced_checkpoint_pending_001",
                  )
                    ? "interrupt"
                    : "accept";
                events.push(
                  `workspace.checkpoint:${request.expectedWorkspaceVersion}:${request.reason}:`
                  + checkpointAttemptKind,
                );
                checkpointRequests.push(request);
                if (checkpointAttemptKind === "interrupt") {
                  return {
                    checkpointConflictReason: "foreground_pending",
                    checkpointed: false,
                    workspace: createWorkspaceState({ version: "1" }),
                  };
                }
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    snapshotRef: request.snapshotRef,
                    version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  }),
                };
              },
            },
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
              assert.ok(
                events.includes(
                  "mailbox.importItem:mailbox_item_entrypoint_forced_checkpoint_pending_001",
                ),
                events.join(","),
              );
              assert.notEqual(input.workspace?.nextWakeAt, dueWakeAt);
              assert.ok(
                !events.includes("workspace.checkpoint:1:idle_shutdown:accept"),
                events.join(","),
              );
              return {
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: freshFutureWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }
            if (assistantPass === 3) {
              assert.ok(
                events.includes(
                  "mailbox.importItem:mailbox_item_entrypoint_forced_checkpoint_pending_002",
                ),
                events.join(","),
              );
              assert.notEqual(input.workspace?.nextWakeAt, dueWakeAt);
              assert.ok(
                !events.includes("workspace.checkpoint:1:idle_shutdown:accept"),
                events.join(","),
              );
              return {
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: laterFutureWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }
            if (assistantPass === 4) {
              assert.ok(
                events.includes("workspace.checkpoint:1:idle_shutdown:accept"),
                events.join(","),
              );
              assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
              assert.equal(input.workspace?.nextWakeReason, "assistant");
              return {
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
              };
            }
            throw new Error("Committed forced checkpoint wake should be serviced after checkpoint.");
          },
          vaultRoot,
        },
      );

      await waitUntil(() => {
        assert.equal(events.includes("mailbox.afterCheckpoint:start"), true);
      }, 10_000);
      assert.ok(
        !events.includes("workspace.checkpoint:1:idle_shutdown:accept"),
        events.join(","),
      );
      const fetchCountBeforeSourceBlindWake =
        events.filter((event) => event === "mailbox.fetch").length;
      runtimeWakeSignal.notify();
      await waitUntil(() => {
        assert.ok(
          events.filter((event) => event === "mailbox.fetch").length
            > fetchCountBeforeSourceBlindWake,
        );
      });
      assert.ok(
        !events.includes("workspace.checkpoint:1:idle_shutdown:accept"),
        events.join(","),
      );
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_forced_checkpoint_pending_002",
        laneSeq: "2",
      }));
      runtimeWakeSignal.notify();
      await waitUntil(() => {
        assert.equal(events.includes("assistant:3"), true);
      });
      assert.ok(
        !events.includes("workspace.checkpoint:1:idle_shutdown:accept"),
        events.join(","),
      );
      foregroundAfterCheckpointGate.resolve();
      const result = await withRealTimeout(
        resultPromise,
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 4);
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_forced_checkpoint_pending_001",
        )
          < requireEventIndex(
            events,
            "snapshot:idle_shutdown:1",
          ),
      );
      assert.ok(
        !events.includes("workspace.checkpoint:1:idle_shutdown:interrupt"),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(events, "mailbox.importItem:mailbox_item_entrypoint_forced_checkpoint_pending_001")
          < requireEventIndex(events, "assistant:2"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(
            events,
            "mailbox.importItem:mailbox_item_entrypoint_forced_checkpoint_pending_002",
          ),
      );
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_forced_checkpoint_pending_002",
        )
          < requireEventIndex(events, "assistant:3"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:3")
          < requireEventIndex(events, "mailbox.afterCheckpoint:done"),
      );
      assert.ok(
        requireEventIndex(events, "mailbox.afterCheckpoint:done")
          < requireEventIndex(events, "workspace.checkpoint:1:idle_shutdown:accept"),
      );
      assert.ok(
        requireEventIndex(events, "workspace.checkpoint:1:idle_shutdown:accept")
          < requireEventIndex(events, "assistant:4"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:4")
          < requireEventIndex(events, "snapshot:idle_shutdown:2"),
      );
      assert.deepEqual(checkpointRequests.map((request) => [
        request.expectedWorkspaceVersion,
        request.reason,
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [
        ["0", "idle_shutdown", null, null],
        ["1", "idle_shutdown", dueWakeAt, "assistant"],
        ["2", "idle_shutdown", null, null],
      ]);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      foregroundAfterCheckpointGate.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wakes that interrupt snapshot publication rerun the foreground pass before checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_snapshot_wake_001",
        laneSeq: "1",
      }),
    ];
    let snapshotAttempt = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_snapshot_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotAttempt += 1;
            events.push(`snapshot:${snapshotAttempt}:${snapshotInput.reason}`);
            if (snapshotAttempt === 1) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_snapshot_wake_002",
                laneSeq: "2",
              }));
              throw new HostedRuntimeCheckpointInterruptedByWakeError();
            }
            return {
              snapshotRef: createBundleRef({
                hash: `${snapshotAttempt}`.repeat(64).slice(0, 64),
                key: `users/bundles/member-synthetic/runtime-idle-checkpoint-snapshot-wake-${snapshotAttempt}.bundle.json`,
                size: 640,
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
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push(`workspace.checkpoint:${request.expectedWorkspaceVersion}`);
                checkpointRequests.push(request);
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    version: "5",
                  }),
                };
              },
            },
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(events.filter((event) => event.startsWith("snapshot:")), [
        "snapshot:1:idle_shutdown",
        "snapshot:2:idle_shutdown",
      ]);
      assert.deepEqual(readConversationImportedSeqs(fetchRequests), ["0", "1"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_snapshot_wake_001",
        "mailbox.importItem:mailbox_item_entrypoint_snapshot_wake_002",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "4",
      ]);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "2",
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground wake processing does not wait for a raced snapshot-failure log", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-snapshot-log-wake-"),
    );
    const vaultRoot = path.join(workspaceRoot, "durable", "vault");
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const failureLogRelease = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const mailboxItems = [createMailboxItem({
      id: "mailbox_item_entrypoint_snapshot_failure_log_wake_001",
      laneSeq: "1",
    })];
    let activeSnapshotSignal: AbortSignal | null = null;
    let assistantPhaseCalls = 0;
    let completionCalls = 0;
    let failureLogSettled = false;
    let sessionStarts = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await mkdir(path.join(workspaceRoot, "durable", "home"), { recursive: true });
      await mkdir(path.join(workspaceRoot, "scratch"), { recursive: true });
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const workspaceSnapshotPort: NonNullable<
        HostedRuntimePlatform["workspaceSnapshotPort"]
      > = {
        async abortSnapshotSession() {
          throw new Error("A completion-attempted session must not be aborted.");
        },
        async completeSnapshotSession(input) {
          completionCalls += 1;
          events.push(`snapshot.complete:${completionCalls}`);
          if (completionCalls === 1) {
            throw new Error("Synthetic snapshot completion transport failure.");
          }
          return {
            checkpoint: {
              checkpointed: true,
              workspace: createWorkspaceState({
                redactedStatus: input.checkpointRequest.redactedStatus ?? null,
                snapshotRef: input.ref,
                version: "5",
              }),
            },
            snapshotRef: input.ref,
          };
        },
        async putSnapshotObjectDirect() {
          return {
            snapshotDirectR2PresignElapsedMs: 1,
            snapshotDirectR2PutElapsedMs: 1,
          };
        },
        async restoreWorkspaceSnapshot() {
          throw new Error("This test starts from a materialized workspace.");
        },
        async startSnapshotSession() {
          sessionStarts += 1;
          const snapshotId = `snapshot_failure_log_wake_${sessionStarts}`;
          const objectKey =
            `users/${TEST_USER_ID}/workspace-snapshots/${snapshotId}.snapshot.enc`;
          return {
            encryption: {
              aad: buildHostedWorkspaceSnapshotV2Aad({
                objectKey,
                snapshotId,
                userId: TEST_USER_ID,
              }),
              dataKeyBase64: "synthetic-data-key",
              ivBase64: "synthetic-iv",
              rootKeyId: "synthetic-root-key",
              scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
              wrappedDataKey: "synthetic-wrapped-data-key",
            },
            limits: {
              maxSinglePartEncryptedBytes: 1_024,
              warnEncryptedBytes: 512,
            },
            objectKey,
            snapshotId,
          };
        },
      };
      const basePlatform = createPlatform({
        events,
        logRequests,
        mailboxPort: createMailboxPort({
          events,
          fetchRequests,
          items: mailboxItems,
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({ version: "4" }),
        }),
        workspaceSnapshotPort,
      });
      const baseLogPort = basePlatform.logPort;
      assert.ok(baseLogPort);
      const platform: HostedRuntimePlatform = {
        ...basePlatform,
        logPort: {
          async write(request, context) {
            const response = await baseLogPort.write(request, context);
            if (request.entries.some((entry) =>
              entry.eventCode === "checkpoint.snapshot_failed"
            )) {
              events.push("snapshot.failure-log:blocked");
              await failureLogRelease.promise;
              failureLogSettled = true;
              events.push("snapshot.failure-log:settled");
            }
            return response;
          },
        },
      };
      const runtimeJobInput = createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_snapshot_failure_log_wake",
          idleCheckpointDelayMs: 1,
          leaseGeneration: "9",
          userId: TEST_USER_ID,
          workspaceVersion: "4",
        },
      });
      const runtimeConfig = runtimeJobInput.runtime;
      assert.ok(runtimeConfig);
      const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
        async buildEncryptedSnapshot(input) {
          activeSnapshotSignal = input.signal ?? null;
          const temporaryDirectoryPath = await mkdtemp(
            path.join(input.outputDir, "synthetic-snapshot-"),
          );
          const encryptedFilePath = path.join(
            temporaryDirectoryPath,
            "snapshot.enc",
          );
          await writeFile(encryptedFilePath, "encrypted snapshot", "utf8");
          return {
            compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
            encryptedByteSize: 18,
            encryptedFilePath,
            encryptedObjectSha256: "a".repeat(64),
            fileCount: input.archiveEntries.length,
            plaintextArchiveSha256: "b".repeat(64),
            temporaryDirectoryPath,
            totalPlainBytes: 18,
          };
        },
      };
      const bridgeOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
        decodeMailboxPayload: {
          async decode() {
            return {
              reasonCode: "unused_in_snapshot_control_test",
              retryable: false,
              status: "blocked",
            };
          },
        },
        platform,
        readCurrentLease: async () => ({
          attemptId: runtimeJobInput.request.attemptId,
          leaseGeneration: runtimeJobInput.request.leaseGeneration,
          providerEgressToken: runtimeJobInput.request.providerEgressToken ?? null,
          userId: runtimeJobInput.request.userId,
          workspaceVersion: runtimeJobInput.request.workspaceVersion,
        }),
        request: runtimeJobInput.request,
        runtime: runtimeConfig,
        snapshotArchiveBuilder,
        snapshotDiagnosticsHashSecret: "f".repeat(64),
        vaultRoot,
        waitForBackgroundAssistantWork: async () => undefined,
      });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(runtimeJobInput, {
        createCheckpointSnapshot: bridgeOptions.createCheckpointSnapshot,
        async importItem(item) {
          events.push(`mailbox.importItem:${item.item.laneSeq}`);
          return { status: "imported" };
        },
        platform,
        runtimeWakeSignal,
        async runAssistantPhase() {
          assistantPhaseCalls += 1;
          events.push(`assistant:${assistantPhaseCalls}`);
          return {
            checkpointReason: "assistant_runtime_commit" as const,
            progressed: true,
          };
        },
        vaultRoot,
      });

      await waitUntil(() => {
        assert.ok(events.includes("snapshot.failure-log:blocked"), events.join(","));
      }, 10_000);
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_snapshot_failure_log_wake_002",
        laneSeq: "2",
      }));
      runtimeWakeSignal.notify({ notifiedAtEpochMs: Date.now() });
      await waitUntil(() => {
        assert.equal(activeSnapshotSignal?.aborted, true);
        assert.ok(
          activeSnapshotSignal?.reason
            instanceof HostedRuntimeCheckpointInterruptedByWakeError,
        );
        assert.ok(events.includes("mailbox.importItem:2"), events.join(","));
        assert.ok(events.includes("assistant:2"), events.join(","));
      }, 10_000);
      assert.equal(failureLogSettled, false);
      assert.ok(
        requireEventIndex(events, "snapshot.failure-log:blocked")
          < requireEventIndex(events, "mailbox.importItem:2"),
      );
      assert.ok(
        requireEventIndex(events, "mailbox.importItem:2")
          < requireEventIndex(events, "assistant:2"),
      );

      failureLogRelease.resolve();
      const result = await withRealTimeout(
        resultPromise,
        10_000,
        () => `Runtime did not finish after failure-log release: ${events.join(",")}`,
      );
      assert.equal(result.status, "idle");
      assert.equal(failureLogSettled, true);
      assert.equal(completionCalls, 2);
      assert.equal(checkpointRequests.length, 0);
      const failureEntries = logRequests.flatMap((request) => request.entries)
        .filter((entry) => entry.eventCode === "checkpoint.snapshot_failed");
      assert.equal(failureEntries.length, 1);
      assert.equal(failureEntries[0]?.errorCode, "runtime_error");
      assert.equal(failureEntries[0]?.level, "error");
    } finally {
      failureLogRelease.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(workspaceRoot);
    }
  });

  test("unresolved checkpoint wakes keep the foreground window open for a later mailbox wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_snapshot_wake_window_001",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const mailboxPort = createMailboxPort({
      events,
      fetchRequests,
      items: mailboxItems,
    });
    const fetchMailbox = mailboxPort.fetch.bind(mailboxPort);
    let conversationFetchCount = 0;
    let lateWakeTimer: ReturnType<typeof setTimeout> | null = null;
    mailboxPort.fetch = async (request) => {
      const response = await fetchMailbox(request);
      if (request.lanes.some((lane) => lane.lane === "conversation")) {
        conversationFetchCount += 1;
        if (conversationFetchCount === 2) {
          lateWakeTimer = setTimeout(() => {
            mailboxItems.push(createMailboxItem({
              id: "mailbox_item_entrypoint_snapshot_wake_window_002",
              laneSeq: "2",
            }));
            runtimeWakeSignal.notify({ notifiedAtEpochMs: Date.now() });
          }, 100);
        }
      }
      return response;
    };
    let snapshotAttempt = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_wake_window",
            idleCheckpointDelayMs: 250,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotAttempt += 1;
            events.push(`snapshot:${snapshotAttempt}:${snapshotInput.reason}`);
            if (snapshotAttempt === 1) {
              throw new HostedRuntimeCheckpointInterruptedByWakeError({
                notification: { notifiedAtEpochMs: Date.now() },
              });
            }
            return {
              snapshotRef: createBundleRef({
                hash: `${snapshotAttempt}`.repeat(64).slice(0, 64),
                key:
                  "users/bundles/member-synthetic/"
                  + `runtime-idle-checkpoint-wake-window-${snapshotAttempt}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            events,
            logRequests,
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      assert.deepEqual(events.filter((event) => event.startsWith("snapshot:")), [
        "snapshot:1:idle_shutdown",
        "snapshot:2:idle_shutdown",
      ]);
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_snapshot_wake_window_002",
        ) < requireEventIndex(events, "snapshot:2:idle_shutdown"),
        events.join(","),
      );
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "4",
      ]);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "2",
      );
      const foregroundProbeLogs = logRequests
        .flatMap((request) => request.entries)
        .filter((entry) =>
          entry.eventCode === "mailbox.imported"
          && entry.redactedJson?.foregroundProbeOutcome === "no_runnable_work"
        );
      assert.deepEqual(foregroundProbeLogs.map((entry) => entry.redactedJson), [
        {
          assistantInputPresent: false,
          blockedCount: 0,
          checkpointDeferred: true,
          conversationImportedCount: 0,
          conversationSeqEnd: "1",
          conversationSeqStart: "1",
          fetchedCount: 0,
          foregroundProbeOutcome: "no_runnable_work",
          idleCheckpointTimerRearmed: true,
          importedCount: 0,
          runtimeWakePresent: true,
          stateChanged: false,
        },
      ]);
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      assert.equal(result.status, "idle");
    } finally {
      if (lateWakeTimer) {
        clearTimeout(lateWakeTimer);
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("rearms after a terminally skipped safe system continuation before a later conversation wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_safe_system_rearm_initial",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let lateWakeTimer: ReturnType<typeof setTimeout> | null = null;
    let snapshotAttempt = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_safe_system_rearm",
            idleCheckpointDelayMs: 250,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotAttempt += 1;
            events.push(`snapshot:${snapshotAttempt}:${snapshotInput.reason}`);
            if (snapshotAttempt === 1) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_safe_system_rearm_system",
                kind: "runtime.pending-effects-reconcile-requested",
                lane: "system",
                laneSeq: "1",
              }));
              throw new HostedRuntimeCheckpointInterruptedByWakeError({
                notification: { notifiedAtEpochMs: Date.now() },
              });
            }
            return {
              snapshotRef: createBundleRef({
                hash: `${snapshotAttempt}`.repeat(64).slice(0, 64),
                key:
                  "users/bundles/member-synthetic/"
                  + `runtime-safe-system-rearm-${snapshotAttempt}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.lane === "system") {
              lateWakeTimer = setTimeout(() => {
                mailboxItems.push(createMailboxItem({
                  id: "mailbox_item_entrypoint_safe_system_rearm_late",
                  laneSeq: "2",
                }));
                runtimeWakeSignal.notify({ notifiedAtEpochMs: Date.now() });
              }, 100);
              return {
                reasonCode: "synthetic_terminal_skip",
                status: "skipped",
              };
            }
            return { status: "imported" };
          },
          platform: createPlatform({
            events,
            logRequests,
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      assert.deepEqual(events.filter((event) => event.startsWith("snapshot:")), [
        "snapshot:1:idle_shutdown",
        "snapshot:2:idle_shutdown",
      ]);
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_safe_system_rearm_system",
        ) < requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_safe_system_rearm_late",
        ),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_safe_system_rearm_late",
        ) < requireEventIndex(events, "snapshot:2:idle_shutdown"),
        events.join(","),
      );
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "4",
      ]);
      const systemProbeLog = logRequests
        .flatMap((request) => request.entries)
        .find((entry) =>
          entry.eventCode === "mailbox.imported"
          && entry.redactedJson?.foregroundProbeOutcome === "no_runnable_work"
          && entry.redactedJson?.fetchedCount === 1
        );
      assert.equal(systemProbeLog?.redactedJson?.checkpointDeferred, true);
      assert.equal(systemProbeLog?.redactedJson?.idleCheckpointTimerRearmed, true);
      assert.equal(systemProbeLog?.redactedJson?.importedCount, 0);
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      assert.equal(result.redactedStatus?.hostedMailboxSystemImportedSeq, "1");
      assert.equal(result.status, "idle");
    } finally {
      if (lateWakeTimer) {
        clearTimeout(lateWakeTimer);
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("successful checkpoint conversation input hints immediately run the foreground path", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_checkpoint_hint_initial",
        laneSeq: "1",
      }),
    ];
    const durableEffectGate = createDeferred<void>();
    const lateImportObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;
    let snapshotAttempt = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_checkpoint_conversation_hint",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotAttempt += 1;
            events.push(`snapshot:${snapshotAttempt}:${snapshotInput.idleCheckpointTrigger}`);
            return {
              snapshotRef: createBundleRef({
                hash: `${snapshotAttempt}`.repeat(64).slice(0, 64),
                key:
                  "users/bundles/member-synthetic/"
                  + `runtime-checkpoint-conversation-hint-${snapshotAttempt}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.id === "mailbox_item_entrypoint_checkpoint_hint_late") {
              lateImportObserved.resolve();
            }
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                checkpointRequests.push(request);
                events.push(`workspace.checkpoint:${checkpointRequests.length}`);
                if (checkpointRequests.length === 1) {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_checkpoint_hint_late",
                    laneSeq: "2",
                  }));
                }
                return {
                  conversationInputAhead: checkpointRequests.length === 1,
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    version: `${4 + checkpointRequests.length}`,
                  }),
                };
              },
            },
          }),
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls > 2) {
              throw new Error("Checkpoint conversation hint should run one additional pass.");
            }
            return {
              ...(assistantPhaseCalls === 1
                ? {
                    afterCheckpoint: async () => ({
                      afterDurableCheckpoint: async () => {
                        events.push("durable-effect:start");
                        await durableEffectGate.promise;
                        events.push("durable-effect:done");
                      },
                      checkpointReason: "assistant_runtime_commit" as const,
                    }),
                  }
                : {}),
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );
      await withRealTimeout(
        lateImportObserved.promise,
        1_000,
        () => `Ahead conversation input waited behind a durable effect: ${events.join(",")}`,
      );
      assert.equal(events.includes("durable-effect:start"), false);
      durableEffectGate.resolve();
      const result = await resultPromise;

      assert.equal(assistantPhaseCalls, 2);
      assert.deepEqual(readConversationImportedSeqs(fetchRequests), ["0", "1"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_hint_initial",
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_hint_late",
      ]);
      assert.equal(checkpointRequests.length, 2);
      assert.deepEqual(events.filter((event) => event.startsWith("snapshot:")), [
        "snapshot:1:idle_window",
        "snapshot:2:idle_window",
      ]);
      assert.ok(
        requireEventIndex(events, "mailbox.importItem:mailbox_item_entrypoint_checkpoint_hint_late")
          < requireEventIndex(events, "durable-effect:start"),
      );
      assert.equal(result.status, "idle");
    } finally {
      durableEffectGate.resolve();
      await removeTempRoot(vaultRoot);
    }
  });

  test("shutdown after a snapshot wake interrupt commits without a metadata-only handoff", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_snapshot_shutdown_initial",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    let assistantPhaseCalls = 0;
    let snapshotAttempt = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_snapshot_wake_shutdown",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotAttempt += 1;
            events.push(`snapshot:${snapshotAttempt}:${snapshotInput.idleCheckpointTrigger}`);
            if (snapshotAttempt === 1) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_snapshot_shutdown_late",
                laneSeq: "2",
              }));
              runtimeWakeSignal.notify(1_777_000_000_155);
              const notification = runtimeWakeSignal.consumePending();
              shutdownController.abort(
                new DOMException("Synthetic container SIGTERM.", "AbortError"),
              );
              throw new HostedRuntimeCheckpointInterruptedByWakeError({
                notification,
              });
            }
            return {
              snapshotRef: createBundleRef({
                hash: `${snapshotAttempt}`.repeat(64).slice(0, 64),
                key:
                  "users/bundles/member-synthetic/"
                  + `runtime-snapshot-wake-shutdown-${snapshotAttempt}.bundle.json`,
                size: 640,
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
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls > 1) {
              throw new Error(
                "Snapshot-interrupted shutdown wake should be handed to replacement runtime.",
              );
            }
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(events.filter((event) => event.startsWith("snapshot:")), [
        "snapshot:1:idle_window",
        "snapshot:2:shutdown_signal",
      ]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_snapshot_shutdown_initial",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(checkpointRequests[0]?.runtimeWakePendingAtCheckpoint, true);
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(result.status, "idle");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  });

  test("shutdown foreground-pending checkpoint conflicts hand off a mailbox wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_shutdown_foreground_pending_initial",
        laneSeq: "1",
      }),
    ];
    const shutdownController = new AbortController();
    let assistantPhaseCalls = 0;
    let snapshotAttempt = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_shutdown_foreground_pending_mailbox",
              idleCheckpointDelayMs: 1,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotAttempt += 1;
              events.push(
                `snapshot:${snapshotAttempt}:${snapshotInput.idleCheckpointTrigger}`,
              );
              return {
                snapshotRef: createBundleRef({
                  hash: `${snapshotAttempt}`.repeat(64).slice(0, 64),
                  key:
                    "users/bundles/member-synthetic/"
                    + `shutdown-foreground-pending-${snapshotAttempt}.bundle.json`,
                  size: 640,
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
                fetchRequests,
                items: mailboxItems,
              }),
              workspacePort: {
                async read() {
                  events.push("workspace.read");
                  return {
                    fetchedAt: TEST_NOW,
                    workspace: createWorkspaceState({ version: "4" }),
                  };
                },
                async checkpoint(request) {
                  events.push(
                    `workspace.checkpoint:${checkpointRequests.length + 1}:`
                    + `${request.nextWakeReason ?? "none"}`,
                  );
                  checkpointRequests.push(request);
                  if (checkpointRequests.length === 1) {
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_shutdown_foreground_pending_late",
                      laneSeq: "2",
                    }));
                    shutdownController.abort(
                      new DOMException("Synthetic container SIGTERM.", "AbortError"),
                    );
                    return {
                      checkpointConflictReason: "foreground_pending",
                      checkpointed: false,
                      workspace: createWorkspaceState({ version: "4" }),
                    };
                  }
                  return {
                    checkpointed: true,
                    workspace: createWorkspaceState({
                      nextWakeAt: request.nextWakeAt ?? null,
                      nextWakeReason: request.nextWakeReason ?? null,
                      snapshotRef: request.snapshotRef,
                      version: "5",
                    }),
                  };
                },
              },
            }),
            async runAssistantPhase() {
              assistantPhaseCalls += 1;
              if (assistantPhaseCalls > 1) {
                throw new Error(
                  "Shutdown foreground-pending conflict should hand off to mailbox.",
                );
              }
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            },
            shutdownSignal: shutdownController.signal,
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["0"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_shutdown_foreground_pending_initial",
      ]);
      assert.deepEqual(events.filter((event) => event.startsWith("snapshot:")), [
        "snapshot:1:idle_window",
        "snapshot:2:shutdown_signal",
      ]);
      assert.equal(checkpointRequests.length, 2);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(checkpointRequests[1]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(checkpointRequests[1]?.nextWakeReason, "mailbox");
      assert.ok(checkpointRequests[1]?.nextWakeAt);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, checkpointRequests[1]?.nextWakeAt);
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  });

  test("a committed checkpoint response lost to its self-wake does not defer due assistant work for another idle window", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-committed-checkpoint-self-wake-"),
    );
    const vaultRoot = path.join(workspaceRoot, "durable", "vault");
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 180_000;
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    const firstCompletionResponseLost = createDeferred<void>();
    const firstSnapshotInterrupted = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    const startedAtMs = Date.parse(TEST_NOW);
    let assistantPhaseCalls = 0;
    let archiveBuilds = 0;
    let completionCalls = 0;
    let firstRemoteCommitAtMs: number | null = null;
    let firstSnapshotInterruptionReason: unknown = null;
    let remoteCommittedWorkspace: HostedWorkspaceState | null = null;
    let assistantServicedAtMs: number | null = null;
    let sessionStarts = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await mkdir(path.join(workspaceRoot, "durable", "home"), { recursive: true });
      await mkdir(path.join(workspaceRoot, "scratch"), { recursive: true });
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const workspaceSnapshotPort: NonNullable<
        HostedRuntimePlatform["workspaceSnapshotPort"]
      > = {
        async abortSnapshotSession() {
          throw new Error("A completion-attempted session must not be aborted.");
        },
        async completeSnapshotSession(input) {
          completionCalls += 1;
          events.push(`snapshot.complete:${completionCalls}`);
          if (remoteCommittedWorkspace === null) {
            remoteCommittedWorkspace = createWorkspaceState({
              nextWakeAt: input.checkpointRequest.nextWakeAt ?? null,
              nextWakeReason: input.checkpointRequest.nextWakeReason ?? null,
              redactedStatus: input.checkpointRequest.redactedStatus ?? null,
              snapshotRef: input.ref,
              version: "5",
            });
            events.push(`remote.commit:${remoteCommittedWorkspace.version}`);
          }
          if (completionCalls === 1) {
            firstRemoteCommitAtMs = Date.now();
            runtimeWakeSignal.notify({ notifiedAtEpochMs: Date.now() });
            await withRealTimeout(
              firstSnapshotInterrupted.promise,
              5_000,
              () => `Snapshot signal did not observe its self-wake: ${events.join(",")}`,
            );
            events.push("snapshot.response-lost:1");
            firstCompletionResponseLost.resolve();
            // Model the Cloudflare port's one exact internal transport replay;
            // the canonical result remains the already committed v5 workspace.
            completionCalls += 1;
            events.push(`snapshot.complete:${completionCalls}`);
          }
          return {
            checkpoint: {
              checkpointed: true,
              workspace: remoteCommittedWorkspace,
            },
            snapshotRef: input.ref,
          };
        },
        async putSnapshotObjectDirect() {
          return {
            snapshotDirectR2PresignElapsedMs: 1,
            snapshotDirectR2PutElapsedMs: 1,
          };
        },
        async restoreWorkspaceSnapshot() {
          throw new Error("This test starts from a materialized workspace.");
        },
        async startSnapshotSession() {
          sessionStarts += 1;
          const snapshotId = `committed_checkpoint_self_wake_${sessionStarts}`;
          const objectKey =
            `users/${TEST_USER_ID}/workspace-snapshots/${snapshotId}.snapshot.enc`;
          return {
            encryption: {
              aad: buildHostedWorkspaceSnapshotV2Aad({
                objectKey,
                snapshotId,
                userId: TEST_USER_ID,
              }),
              dataKeyBase64: "synthetic-data-key",
              ivBase64: "synthetic-iv",
              rootKeyId: "synthetic-root-key",
              scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
              wrappedDataKey: "synthetic-wrapped-data-key",
            },
            limits: {
              maxSinglePartEncryptedBytes: 1_024,
              warnEncryptedBytes: 512,
            },
            objectKey,
            snapshotId,
          };
        },
      };
      const platform = createPlatform({
        mailboxPort: createMailboxPort({
          events,
          items: [],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({
            nextWakeAt: TEST_NOW,
            nextWakeReason: "assistant",
            version: "4",
          }),
        }),
        workspaceSnapshotPort,
      });
      const runtimeJobInput = createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_committed_checkpoint_self_wake",
          idleCheckpointDelayMs,
          leaseGeneration: "9",
          userId: TEST_USER_ID,
          workspaceVersion: "4",
        },
      });
      const runtimeConfig = runtimeJobInput.runtime;
      assert.ok(runtimeConfig);
      const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
        async buildEncryptedSnapshot(input) {
          archiveBuilds += 1;
          if (archiveBuilds === 1) {
            assert.ok(input.signal);
            const recordInterruption = () => {
              firstSnapshotInterruptionReason = input.signal?.reason;
              events.push("snapshot.signal-aborted:1");
              firstSnapshotInterrupted.resolve();
            };
            if (input.signal.aborted) {
              recordInterruption();
            } else {
              input.signal.addEventListener("abort", recordInterruption, { once: true });
            }
          }
          const temporaryDirectoryPath = await mkdtemp(
            path.join(input.outputDir, "synthetic-snapshot-"),
          );
          const encryptedFilePath = path.join(
            temporaryDirectoryPath,
            "snapshot.enc",
          );
          await writeFile(encryptedFilePath, "encrypted snapshot", "utf8");
          return {
            compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
            encryptedByteSize: 18,
            encryptedFilePath,
            encryptedObjectSha256: "a".repeat(64),
            fileCount: input.archiveEntries.length,
            plaintextArchiveSha256: "b".repeat(64),
            temporaryDirectoryPath,
            totalPlainBytes: 18,
          };
        },
      };
      const bridgeOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
        decodeMailboxPayload: {
          async decode() {
            return {
              reasonCode: "unused_in_snapshot_control_test",
              retryable: false,
              status: "blocked",
            };
          },
        },
        platform,
        readCurrentLease: async () => ({
          attemptId: runtimeJobInput.request.attemptId,
          leaseGeneration: runtimeJobInput.request.leaseGeneration,
          providerEgressToken: runtimeJobInput.request.providerEgressToken ?? null,
          userId: runtimeJobInput.request.userId,
          workspaceVersion: runtimeJobInput.request.workspaceVersion,
        }),
        request: runtimeJobInput.request,
        runtime: runtimeConfig,
        snapshotArchiveBuilder,
        snapshotDiagnosticsHashSecret: "f".repeat(64),
        vaultRoot,
        waitForBackgroundAssistantWork: async () => undefined,
      });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(runtimeJobInput, {
        createCheckpointSnapshot: bridgeOptions.createCheckpointSnapshot,
        async importItem(item) {
          events.push(`mailbox.importItem:${item.item.id}`);
          return { status: "imported" };
        },
        platform,
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          assistantPhaseCalls += 1;
          events.push(
            `assistant.phase:${assistantPhaseCalls}:`
              + `${input.workspace?.nextWakeAt ?? "none"}:`
              + `${input.workspace?.nextWakeReason ?? "none"}`,
          );
          if (assistantPhaseCalls === 1) {
            assistantOneObserved.resolve();
            return {
              afterCheckpoint: async () => ({
                checkpointReason: "provider_cleanup",
                nextWakeAt: TEST_NOW,
                nextWakeReason: "assistant",
              }),
              checkpointReason: "canonical_runtime_commit",
              nextWakeAt: TEST_NOW,
              nextWakeReason: "assistant",
              progressed: true,
              redactedStatus: {
                hostedAssistantProgressed: true,
              },
            };
          }

          if (assistantPhaseCalls === 2) {
            assistantServicedAtMs = Date.now();
            assistantTwoObserved.resolve();
            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: null,
              nextWakeReason: null,
              progressed: true,
              redactedStatus: {
                hostedAssistantProgressed: true,
              },
            };
          }

          throw new Error("Interrupted same-key due wake should service exactly once.");
        },
        shutdownSignal: shutdownController.signal,
        vaultRoot,
      });

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      await withRealTimeout(
        firstCompletionResponseLost.promise,
        15_000,
        () => events.join(","),
      );
      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));

      assert.ok(
        requireEventIndex(events, "snapshot.complete:2")
          < requireEventIndex(events, `assistant.phase:2:${TEST_NOW}:assistant`),
      );
      assert.ok(
        requireEventIndex(events, "remote.commit:5")
          < requireEventIndex(events, "snapshot.response-lost:1"),
      );
      assert.ok(
        firstSnapshotInterruptionReason
          instanceof HostedRuntimeCheckpointInterruptedByWakeError,
      );
      assert.equal(checkpointRequests.length, 0);
      if (firstRemoteCommitAtMs === null || assistantServicedAtMs === null) {
        throw new Error(`Missing latency timestamp: ${events.join(",")}`);
      }
      const assistantDelayAfterRemoteCommitMs =
        assistantServicedAtMs - firstRemoteCommitAtMs;
      assert.ok(
        assistantDelayAfterRemoteCommitMs < idleCheckpointDelayMs,
        "A remotely committed checkpoint response lost to its self-wake "
          + "must not make due assistant work wait for another idle window: "
          + JSON.stringify({
            events,
            firstRemoteCommitAtMs: firstRemoteCommitAtMs - startedAtMs,
            assistantDelayAfterRemoteCommitMs,
            assistantServicedAtMs: assistantServicedAtMs - startedAtMs,
          }),
      );
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await resultPromise?.catch(() => undefined);
      vi.useRealTimers();
      await removeTempRoot(workspaceRoot);
    }
  });

  test("checkpoint publication wakes without mailbox work do not service non-assistant wakes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_checkpoint_publication_non_assistant",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: `${checkpointRequests.length}`.repeat(64).slice(0, 64),
                key:
                  "users/bundles/member-synthetic/"
                  + "runtime-checkpoint-publication-non-assistant.bundle.json",
                size: 640,
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
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace: (request) => {
                runtimeWakeSignal.notify();
                return createWorkspaceState({
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
              },
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              return {
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: TEST_NOW,
                nextWakeReason: "device-sync.reconcile",
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            }

            throw new Error("Checkpoint publication wake serviced a non-assistant wake.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [
        ["idle_shutdown", TEST_NOW, "device-sync.reconcile"],
      ]);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, TEST_NOW);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("post-checkpoint mailbox wake imports conversation before failing system item", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-post-checkpoint-mailbox-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_post_checkpoint_mailbox_system_failure",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "6".repeat(64),
                key:
                  "users/bundles/member-synthetic/"
                  + "runtime-post-checkpoint-mailbox-system-failure.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`import:${item.item.lane}:${item.item.laneSeq}`);
            if (item.item.lane === "system" && !imported.includes("conversation:1")) {
              throw new Error("Synthetic system import failure before conversation.");
            }
            if (item.item.lane === "conversation") {
              imported.push(`${item.item.lane}:${item.item.laneSeq}`);
              return {
                assistantInputId: await stageAssistantInputEventForMailboxItem({
                  item: item.item,
                  vaultRoot,
                }),
                status: "imported",
              };
            }
            return await importRuntimeControlSystemMailboxItemForTest({
              item: item.item,
              vaultRoot,
            });
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace: (request) => {
                if (mailboxItems.length === 0) {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_post_checkpoint_system_failure_system_001",
                    kind: "runtime.manual-requested",
                    lane: "system",
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:01.000Z",
                  }));
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_post_checkpoint_system_failure_conversation_001",
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:01.500Z",
                  }));
                  runtimeWakeSignal.notify();
                }
                return createWorkspaceState({
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
              },
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              return {
                checkpointReason: "canonical_runtime_commit",
                progressed: true,
              };
            }

            return {
              progressed: false,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(imported, ["conversation:1"]);
      assert.equal(assistantPhaseCalls, 2);
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "1");
      assert.ok(
        checkpointRequests.some((request) =>
          request.redactedStatus?.hostedMailboxConversationImportedSeq === "1"
        ),
      );
      assert.ok(
        requireEventIndex(events, "import:conversation:1")
        < requireEventIndex(events, "assistant.phase:2"),
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("stale workspace-version idle checkpoints rerun foreground before checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_stale_checkpoint_001",
        laneSeq: "1",
      }),
    ];
    let snapshotAttempt = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_stale_workspace",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotAttempt += 1;
            events.push(`snapshot:${snapshotAttempt}:${snapshotInput.reason}`);
            if (snapshotAttempt === 1) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_stale_checkpoint_002",
                laneSeq: "2",
              }));
              throw new HostedRuntimeBridgeCheckpointLeaseError(
                "stale_workspace_version",
                "before_snapshot",
              );
            }
            return {
              snapshotRef: createBundleRef({
                hash: `${snapshotAttempt}`.repeat(64).slice(0, 64),
                key: `users/bundles/member-synthetic/runtime-idle-checkpoint-stale-${snapshotAttempt}.bundle.json`,
                size: 640,
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
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push(`workspace.checkpoint:${request.expectedWorkspaceVersion}`);
                checkpointRequests.push(request);
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    version: "5",
                  }),
                };
              },
            },
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(events.filter((event) => event.startsWith("snapshot:")), [
        "snapshot:1:idle_shutdown",
        "snapshot:2:idle_shutdown",
      ]);
      assert.deepEqual(readConversationImportedSeqs(fetchRequests), ["0", "1"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_stale_checkpoint_001",
        "mailbox.importItem:mailbox_item_entrypoint_stale_checkpoint_002",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "4",
      ]);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "2",
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wakes pending after checkpoint are drained without a host checkpoint timer", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointResponse = createDeferred<HostedWorkspaceCheckpointResponse>();
    const pendingRuntimeWakeQueued = createDeferred<void>();
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_checkpoint_timer_001",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let checkpointCallCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_pending_wake_timer",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-pending-timer.bundle.json",
                size: 640,
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
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                checkpointCallCount += 1;
                events.push(`workspace.checkpoint:${request.expectedWorkspaceVersion}`);
                checkpointRequests.push(request);
                if (checkpointCallCount === 1) {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_checkpoint_timer_002",
                    laneSeq: "2",
                  }));
                  runtimeWakeSignal.notify();
                  pendingRuntimeWakeQueued.resolve();
                  return await checkpointResponse.promise;
                }
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    version: "6",
                  }),
                };
              },
            },
          }),
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        pendingRuntimeWakeQueued.promise,
        15_000,
        () => events.join(","),
      );
      checkpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({
          snapshotRef: checkpointRequests[0]!.snapshotRef,
          version: "5",
        }),
      });

      const result = await withRealTimeout(
        resultPromise,
        15_000,
        () => events.join(","),
      );

      assert.deepEqual(readConversationImportedSeqs(fetchRequests), ["0", "1"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_timer_001",
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_timer_002",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "4",
        "5",
      ]);
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      assert.equal(result.status, "idle");
    } finally {
      checkpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({ version: "5" }),
      });
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wake passes preserve earlier projected checkpoint metadata", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const assistantWakeAt = "2099-04-27T00:05:00.000Z";
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_accumulate_projection",
            idleCheckpointDelayMs: 25,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-accumulated.bundle.json",
                size: 640,
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
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              setTimeout(() => runtimeWakeSignal.notify(), 0);
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: assistantWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: assistantWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }

            return {};
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, assistantWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedAssistantNextWakeAt,
        assistantWakeAt,
      );
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedAssistantProgressed,
        true,
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, assistantWakeAt);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
        "assistant.phase:2",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wake no-progress hints do not replace earlier dirty wake metadata", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const earlierWakeAt = "2099-04-27T00:01:00.000Z";
    const laterWakeAt = "2099-04-27T00:05:00.000Z";
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_no_progress_hint",
            idleCheckpointDelayMs: 25,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-no-progress-hint.bundle.json",
                size: 640,
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
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              setTimeout(() => runtimeWakeSignal.notify(), 0);
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: earlierWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: earlierWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }

            return {
              nextWakeAt: laterWakeAt,
              progressed: false,
              redactedStatus: {
                hostedAssistantNextWakeAt: laterWakeAt,
                hostedAssistantProgressed: false,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, earlierWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, earlierWakeAt);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
        "assistant.phase:2",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("empty checkpoint wake preserves earlier checkpointed wake metadata", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const earlierWakeAt = "2099-04-27T00:01:00.000Z";
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_checkpoint_wake_no_progress_hint",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/runtime-checkpoint-wake-no-progress-hint.bundle.json",
                size: 640,
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
              items: [],
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                checkpointRequests.push(request);
                events.push("workspace.checkpoint");
                runtimeWakeSignal.notify();
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: "5",
                  }),
                };
              },
            },
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: earlierWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: earlierWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }

            throw new Error("Empty checkpoint wake should not run a no-progress assistant pass.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, earlierWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, earlierWakeAt);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("empty checkpoint wake does not clear previously checkpointed wake metadata", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const assistantWakeAt = "2099-04-27T00:05:00.000Z";
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_clear_projection",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: `${checkpointRequests.length}`.repeat(64).slice(0, 64),
                key: `users/bundles/member-synthetic/runtime-idle-checkpoint-clear-${checkpointRequests.length}.bundle.json`,
                size: 640,
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
              items: [],
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                checkpointRequests.push(request);
                events.push(`workspace.checkpoint:${checkpointRequests.length}`);
                if (checkpointRequests.length === 1) {
                  runtimeWakeSignal.notify();
                }
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: `${4 + checkpointRequests.length}`,
                  }),
                };
              },
            },
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: assistantWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: assistantWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }

            throw new Error("Empty checkpoint wake should not clear checkpointed metadata.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, assistantWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedAssistantNextWakeAt,
        assistantWakeAt,
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, assistantWakeAt);
      assert.equal(result.redactedStatus?.hostedAssistantNextWakeAt, assistantWakeAt);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wake pass can clear projected wake metadata before checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const assistantWakeAt = "2099-04-27T00:05:00.000Z";
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_idle_timer_clear",
            idleCheckpointDelayMs: 10_000,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-idle-timer-clear.bundle.json",
                size: 640,
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
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              setTimeout(() => runtimeWakeSignal.notify(), 10);
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: assistantWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: assistantWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }

            await new Promise((resolve) => setTimeout(resolve, 150));
            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: null,
              progressed: true,
              redactedStatus: {
                hostedAssistantNextWakeAt: null,
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
        "assistant.phase:2",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedAssistantNextWakeAt,
        null,
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.redactedStatus?.hostedAssistantNextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  });
