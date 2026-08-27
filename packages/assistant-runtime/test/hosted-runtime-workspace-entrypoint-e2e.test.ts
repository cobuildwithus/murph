import {
  TEST_NOW,
  createBundleRef,
  createDeferred,
  createDeviceSyncResolvedConfig,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createSnapshotDeviceSyncPort,
  createWorkspacePort,
  createWorkspaceRunRequest,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  ensureHostedBootstrapMetadataForSystemMailboxTest,
  importRuntimeControlSystemMailboxItemForTest,
  mocks,
  readCheckpointConversationWatermark,
  removeTempRoot,
  stagePendingLinqAssistantInputForMailboxItem,
  withRealTimeout,
  writeSyntheticAssistantAutoReplyTerminalEvidence,
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
  appendAssistantTranscriptEntries,
  createAssistantOutboxIntent,
  ensureAutomaticMealCloseoutAutomation,
  getAssistantCronStatus,
  listAssistantTranscriptEntries,
  MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
  listAssistantOutboxIntents,
  markAssistantOutboxIntentSentById,
  readAssistantContextSnapshotState,
  refreshAssistantContextSnapshotBestEffort,
  recordHostedMailboxAssistantInputItem,
  saveAssistantOutboxIntent,
  saveAssistantSession,
  type AssistantHostedImageGenerationLauncher,
  type RunAssistantAutomationPassInput,
} from "@murphai/assistant-engine";
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
import {
  collectHostedPendingAssistantInputMediaRetentionProtections,
  compactHostedPendingAssistantInputIds,
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
  inspectHostedPendingAssistantInputWakeCandidate,
  readHostedPendingAssistantInputIds,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  createEmptyHostedMailboxImportState,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
  HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
  type HostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import {
  resolveHostedPendingAssistantInputWakeAt,
} from "../src/hosted-runtime/pending-assistant-input.ts";

describe("hosted workspace runtime entrypoint", () => {test("e2e preserves device-sync follow-up wake and runs the scheduled alarm lane", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const firstCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const connectionId = "device_sync_connection_synthetic";
    const firstNow = "2026-04-27T00:00:00.000Z";
    const firstNextWakeAt = "2026-04-27T00:01:00.000Z";
    const secondNow = "2026-04-27T00:01:01.000Z";
    const secondNextWakeAt = "2026-04-27T00:02:00.000Z";
    const firstDeviceSyncPort = createSnapshotDeviceSyncPort({
      connectionId,
      nextReconcileAt: firstNextWakeAt,
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(firstNow));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const firstResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_device_sync_first",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:first:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/device-sync-first.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Scheduled device-sync wakes should not import mailbox items.");
          },
          platform: createPlatform({
            deviceSyncPort: firstDeviceSyncPort,
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: firstCheckpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: firstNow,
                nextWakeReason: "device-sync.reconcile",
                version: "0",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      const firstCheckpoint = firstCheckpointRequests.at(-1);
      assert.ok(firstCheckpoint);
      assert.equal(firstDeviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(firstResult.status, "scheduled");
      assert.equal(firstResult.nextWakeAt, firstNextWakeAt);
      assert.equal(firstCheckpoint.nextWakeAt, firstNextWakeAt);
      assert.equal(firstCheckpoint.nextWakeReason, "device-sync.reconcile");

      vi.setSystemTime(new Date(secondNow));
      const secondCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const secondDeviceSyncPort = createSnapshotDeviceSyncPort({
        connectionId,
        nextReconcileAt: secondNextWakeAt,
      });
      const secondResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_device_sync_follow_up",
            workspaceVersion: "1",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:second:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/device-sync-follow-up.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("No mailbox items should be imported for the follow-up alarm.");
          },
          platform: createPlatform({
            deviceSyncPort: secondDeviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: secondCheckpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: firstCheckpoint.nextWakeAt,
                nextWakeReason: "device-sync.reconcile",
                version: "1",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      const secondCheckpoint = secondCheckpointRequests.at(-1);
      assert.ok(secondCheckpoint);
      assert.equal(secondDeviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(secondResult.status, "scheduled");
      assert.equal(secondResult.nextWakeAt, secondNextWakeAt);
      assert.equal(secondCheckpoint.nextWakeAt, secondNextWakeAt);
      assert.equal(secondCheckpoint.nextWakeReason, "device-sync.reconcile");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("e2e preserves yielded device-sync retry after earlier pending assistant retry", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const checkpointSnapshotFrontierSelections: boolean[] = [];
    const connectionId = "device_sync_connection_pending_retry";
    const firstNow = "2026-04-27T00:00:00.000Z";
    const deviceSyncWakeAt = "2026-04-27T00:10:00.000Z";
    const yieldedRetryWakeAt = "2026-04-27T00:00:30.000Z";
    const followUpWakeAt = "2026-04-27T00:11:00.000Z";
    const idleCheckpointDelayMs = 90_000;
    const runtimeTransitionTimeoutMs = 15_000;
    const shutdownController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_device_sync_pending_retry_bootstrap",
        kind: "member.activated",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    const foregroundImported = createDeferred<void>();
    let pendingInputId: string | null = null;
    const deviceSyncPort = createSnapshotDeviceSyncPort({
      async onFetchSnapshot() {
        await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
        mailboxItems.push(createMailboxItem({
          id: "mailbox_item_entrypoint_device_sync_pending_retry",
          laneSeq: "1",
          occurredAt: "2026-04-27T00:00:01.000Z",
        }));
        runtimeWakeSignal.notify();
        await withRealTimeout(
          foregroundImported.promise,
          runtimeTransitionTimeoutMs,
          () => events.join(","),
        );
      },
      connectionId,
      nextReconcileAt: deviceSyncWakeAt,
    });

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(firstNow));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const firstPhaseFinished = createDeferred<void>();
      const secondPhaseFinished = createDeferred<void>();
      let assistantPhaseCalls = 0;
      const platform = createPlatform({
        deviceSyncPort,
        mailboxPort: createMailboxPort({ events, items: mailboxItems }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({
            nextWakeAt: firstNow,
            nextWakeReason: "device-sync.reconcile",
            version: "0",
          }),
        }),
      });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_device_sync_pending_retry",
            idleCheckpointDelayMs,
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            checkpointSnapshotFrontierSelections.push(
              snapshotInput.handledConversationFrontierSelected ?? false,
            );
            return {
              snapshotRef: createBundleRef({
                hash: "6".repeat(64),
                key: "users/bundles/member-synthetic/device-sync-pending-retry.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.lane !== "conversation") {
              await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
              return { status: "imported" };
            }

            pendingInputId ??= await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            await recordHostedMailboxAssistantInputItem({
              inputId: pendingInputId,
              mailboxItemId: item.item.id,
              vault: vaultRoot,
            });
            assert.ok(await resolveHostedPendingAssistantInputWakeAt({ vaultRoot }));
            foregroundImported.resolve();
            return {
              assistantInputId: pendingInputId,
              status: "imported",
            };
          },
          platform,
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              await deviceSyncPort.fetchSnapshot();
              assert.ok(pendingInputId);
              return {
                checkpointReason: "assistant_runtime_commit" as const,
                nextWakeAt: yieldedRetryWakeAt,
                nextWakeReason: "device-sync.reconcile",
                progressed: true,
                redactedStatus: {
                  deviceSyncRetryYielded: true,
                },
              };
            }

            assert.equal(assistantPhaseCalls, 2);
            assert.ok(pendingInputId);
            assert.deepEqual(
              input.initialAssistantInputBatch?.assistantInputIds,
              [pendingInputId],
            );
            await writeSyntheticAssistantAutoReplyTerminalEvidence({
              inputId: pendingInputId,
              vaultRoot,
            });
            shutdownController.abort();
            firstPhaseFinished.resolve();
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        firstPhaseFinished.promise,
        runtimeTransitionTimeoutMs,
        () => events.join(","),
      );
      assert.equal(assistantPhaseCalls, 2);
      assert.equal(checkpointRequests.length, 0);

      const result = await withRealTimeout(
        resultPromise,
        runtimeTransitionTimeoutMs,
        () => events.join(","),
      );
      const checkpoint = checkpointRequests.at(-1);
      assert.ok(checkpoint);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, yieldedRetryWakeAt);
      assert.equal(checkpoint.nextWakeAt, yieldedRetryWakeAt);
      assert.equal(checkpoint.nextWakeReason, "device-sync.reconcile");
      assert.deepEqual(checkpoint.handledConversationMailboxItemIds, [
        "mailbox_item_entrypoint_device_sync_pending_retry",
      ]);
      assert.deepEqual(checkpointSnapshotFrontierSelections, [true]);

      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(yieldedRetryWakeAt));

      const followUpCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const followUpDeviceSyncPort = createSnapshotDeviceSyncPort({
        connectionId,
        nextReconcileAt: followUpWakeAt,
      });
      const followUpResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_device_sync_after_pending_retry",
            workspaceVersion: "1",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:follow-up:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/device-sync-follow-up-after-retry.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
            return { status: "imported" };
          },
          platform: createPlatform({
            deviceSyncPort: followUpDeviceSyncPort,
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_device_sync_pending_retry_followup_bootstrap",
                  kind: "member.activated",
                  lane: "system",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: followUpCheckpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: checkpoint.nextWakeAt,
                nextWakeReason: "device-sync.reconcile",
                version: "1",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      const followUpCheckpoint = followUpCheckpointRequests.at(-1);
      assert.ok(followUpCheckpoint);
      assert.equal(followUpDeviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(followUpResult.status, "scheduled");
      assert.equal(followUpResult.nextWakeAt, followUpWakeAt);
      assert.equal(followUpCheckpoint.nextWakeAt, followUpWakeAt);
      assert.equal(followUpCheckpoint.nextWakeReason, "device-sync.reconcile");
    } finally {
      shutdownController.abort();
      vi.useRealTimers();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("e2e aborts a foreground projection stall after staging pending input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const checkpointWatermarks: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    const projectionStarted = createDeferred<void>();
    const projectionAborted = createDeferred<void>();
    const assistantSecondPassObserved = createDeferred<void>();
    const runtimeTransitionTimeoutMs = 15_000;
    let assistantPhaseCalls = 0;
    let conversationImportAttempts = 0;
    let pendingInputId: string | null = null;
    const projectionStall = createDeferred<never>();
    const projectionNeverResolved = projectionStall.promise;
    void projectionNeverResolved.catch(() => undefined);
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
    mocks.prepareHostedCodexAssistantProcess.mockClear();
    mocks.cancelPendingWarmCodexPreinitialization.mockClear();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_projection_stall_preempt",
            idleCheckpointDelayMs: 180_000,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            const watermark = await readCheckpointConversationWatermark(snapshotInput, vaultRoot);
            checkpointWatermarks.push(watermark);
            events.push(`snapshot:${snapshotInput.reason}:${watermark}`);
            return {
              snapshotRef: createBundleRef({
                hash: `${checkpointWatermarks.length}`.repeat(64),
                key: `users/bundles/member-synthetic/projection-stall-${checkpointWatermarks.length}.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            if (item.item.lane !== "conversation") {
              return { status: "imported" };
            }

            conversationImportAttempts += 1;
            events.push(`conversation-import:${conversationImportAttempts}`);
            if (conversationImportAttempts === 1) {
              pendingInputId = await stagePendingLinqAssistantInputForMailboxItem({
                item: item.item,
                vaultRoot,
              });
              context?.onConversationInputStaged?.("linq");
              assert.ok(context?.signal);
              const signal = context.signal;
              const rejectForAbort = () => {
                events.push("projection:aborted");
                projectionAborted.resolve();
                projectionStall.reject(
                  signal.reason ?? new DOMException("Projection aborted.", "AbortError"),
                );
              };
              if (signal.aborted) {
                rejectForAbort();
              } else {
                signal.addEventListener("abort", rejectForAbort, { once: true });
              }
              projectionStarted.resolve();
              return await projectionNeverResolved;
            }

            assert.equal(
              (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
              "0",
            );
            assert.ok(pendingInputId);
            assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), [
              pendingInputId,
            ]);
            return {
              assistantInputId: pendingInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
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
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant:${assistantPhaseCalls}`);

            if (assistantPhaseCalls === 1) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_projection_stall",
                laneSeq: "1",
                occurredAt: "2026-04-27T00:00:01.000Z",
              }));
              runtimeWakeSignal.notify();
              await withRealTimeout(
                projectionStarted.promise,
                runtimeTransitionTimeoutMs,
                () => events.join(","),
              );
              return {
                checkpointReason: "assistant_runtime_commit" as const,
                progressed: true,
              };
            }

            if (assistantPhaseCalls === 2) {
              await withRealTimeout(
                projectionAborted.promise,
                runtimeTransitionTimeoutMs,
                () => events.join(","),
              );
              assert.equal(conversationImportAttempts, 2);
              assert.ok(pendingInputId);
              assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), [
                pendingInputId,
              ]);
              assistantSecondPassObserved.resolve();
              shutdownController.abort();
              return {
                progressed: false,
              };
            }

            // The staged pending input is never terminally answered by this
            // stub, so the runtime may legitimately keep waking for it until
            // the shutdown signal engages; later passes are benign no-ops.
            return {
              progressed: false,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      void resultPromise.catch(() => undefined);

      await withRealTimeout(
        assistantSecondPassObserved.promise,
        runtimeTransitionTimeoutMs,
        () => events.join(","),
      );
      const result = await withRealTimeout(
        resultPromise,
        runtimeTransitionTimeoutMs,
        () => events.join(","),
      );

      // At least the stall pass and the reply-wake pass; the unanswered
      // pending input may legitimately draw extra benign passes while the
      // shutdown signal engages.
      assert.ok(assistantPhaseCalls >= 2);
      assert.equal(conversationImportAttempts, 2);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(
        mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length,
        0,
      );
      // The aborted first import must not have advanced the watermark: the
      // attempt-2 stub asserts it still read "0" before importing. Snapshot
      // ordering relative to that import is timing-dependent, so no assertion
      // on which watermark the first snapshot carried.
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "1");
      assert.ok(["idle", "scheduled"].includes(result.status));
      assert.deepEqual(
        logRequests
          .flatMap((request) => request.entries)
          .filter((entry) => entry.errorCode === "foreground_mailbox_import_failed")
          .map((entry) => entry.errorCode),
        [],
      );
      assert.ok(
        fetchRequests.filter((request) =>
          request.lanes.some((lane) =>
            lane.lane === "conversation" && lane.importedSeq === "0"
          )
        ).length >= 2,
      );
    } finally {
      projectionStall.reject(new DOMException("Projection cleanup.", "AbortError"));
      shutdownController.abort();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("e2e checkpoints pending-input retry when system mailbox records post-checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 25;
    const runtimeTransitionTimeoutMs = 15_000;
    const abortReason = new Error("pending retry observed before idle checkpoint");
    const runtimeAbortController = new AbortController();
    let resultPromise: Promise<unknown> | null = null;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const systemMailboxItem = createMailboxItem({
        dedupeKey: "runtime.manual-requested:pending-retry",
        id: "mailbox_item_entrypoint_runtime_control_pending_retry",
        kind: "runtime.manual-requested",
        lane: "system",
        laneSeq: "1",
      });

      const postCheckpointRecorded = createDeferred<void>();
      let pendingInputId: string | null = null;
      let assistantPhaseCalls = 0;
      const platform = createPlatform({
        mailboxPort: createMailboxPort({ events, items: [systemMailboxItem] }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({ version: "0" }),
        }),
      });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_pending_retry_system_mailbox_gate",
            idleCheckpointDelayMs,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "5".repeat(64),
                key: "users/bundles/member-synthetic/pending-retry-system-mailbox.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
            pendingInputId ??= await stagePendingLinqAssistantInputForMailboxItem({
              item: createMailboxItem({
                id: "mailbox_item_entrypoint_pending_retry_system_mailbox",
                laneSeq: "1",
              }),
              vaultRoot,
            });
            assert.ok(await resolveHostedPendingAssistantInputWakeAt({ vaultRoot }));
            return await importRuntimeControlSystemMailboxItemForTest({
              item: systemMailboxItem,
              vaultRoot,
            });
          },
          platform,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              assert.ok(pendingInputId);
              return {
                afterCheckpoint: async () => {
                  events.push("assistant.afterCheckpoint");
                  postCheckpointRecorded.resolve();
                  return {
                    checkpointReason: "system_mailbox_receipt" as const,
                    nextWakeAt: "2026-04-27T00:10:00.000Z",
                    nextWakeReason: "device-sync.reconcile",
                    redactedStatus: {
                      hostedSystemMailboxRecorded: 1,
                    },
                  };
                },
                checkpointReason: "system_mailbox_receipt" as const,
                nextWakeAt: "2026-04-27T00:00:30.000Z",
                nextWakeReason: "assistant",
                progressed: true,
                redactedStatus: {
                  pendingAssistantInputRetry: true,
                },
              };
            }
            runtimeAbortController.abort(abortReason);
            return {
              progressed: false,
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      ).catch((error: unknown) => error);

      await withRealTimeout(postCheckpointRecorded.promise, runtimeTransitionTimeoutMs, () =>
        events.join(",")
      );
      const result = await withRealTimeout(resultPromise, runtimeTransitionTimeoutMs, () =>
        events.join(",")
      );
      assert.equal(assistantPhaseCalls, 1, events.join(","));
      assert.ok(events.includes("snapshot:idle_shutdown"));
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, "2026-04-27T00:00:30.000Z");
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.notEqual(result, abortReason);
    } finally {
      if (!runtimeAbortController.signal.aborted) {
        runtimeAbortController.abort(abortReason);
      }
      vi.useRealTimers();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("parses additive workspace-invocation inputs and rejects legacy run-drain fields", () => {
    const parsed = parseHostedAssistantWorkspaceRuntimeJobInput({
      request: createWorkspaceRunRequest({
        workspace: createWorkspaceState({ version: "0" }),
      }),
      runtime: {
        forwardedEnv: {
          HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
        },
      },
    });

    assert.equal(parsed.request.attemptId, "attempt_synthetic_workspace_run");
    assert.equal(parsed.request.workspace?.version, "0");
    assert.deepEqual(parsed.runtime?.forwardedEnv, {
      HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
    });

    const nullWorkspaceParsed = parseHostedAssistantWorkspaceRuntimeJobInput({
      request: createWorkspaceRunRequest({
        workspace: null,
      }),
    });
    assert.equal(nullWorkspaceParsed.request.workspace, null);

    const timedParsed = parseHostedAssistantWorkspaceRuntimeJobInput({
      request: {
        ...createWorkspaceRunRequest(),
        idleCheckpointDelayMs: 180_000,
      },
    });
    assert.equal(timedParsed.request.idleCheckpointDelayMs, 180_000);

    expect(() =>
      parseHostedAssistantWorkspaceRuntimeJobInput({
        request: {
          ...createWorkspaceRunRequest(),
          reason: "browser_vault_refresh",
        },
      })
    ).toThrow("Hosted workspace invocation request.reason is no longer supported.");

    expect(() =>
      parseHostedAssistantWorkspaceRuntimeJobInput({
        request: {
          ...createWorkspaceRunRequest(),
          source: "manual",
        },
      })
    ).toThrow("Hosted workspace invocation request.source is no longer supported.");

    expect(() =>
      parseHostedAssistantWorkspaceRuntimeJobInput({
        request: {
          ...createWorkspaceRunRequest(),
          checkpointNextWakeAt: null,
        },
      })
    ).toThrow(
      "Hosted workspace invocation request.checkpointNextWakeAt is no longer supported.",
    );

    expect(() =>
      parseHostedAssistantWorkspaceRuntimeJobInput({
        request: {
          ...createWorkspaceRunRequest(),
          deadlineAt: "2026-04-27T00:10:00.000Z",
        },
      })
    ).toThrow(
      "Hosted workspace invocation request.deadlineAt is no longer supported.",
    );

    expect(() =>
      parseHostedAssistantWorkspaceRuntimeJobInput({
        request: {
          ...createWorkspaceRunRequest(),
          runDrain: {},
        },
      })
    ).toThrow(/runDrain is no longer supported/u);
  });
});
