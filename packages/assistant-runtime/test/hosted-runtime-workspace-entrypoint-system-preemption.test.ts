import {
  TEST_NOW,
  TEST_USER_ID,
  createBrowserVaultReplicaRef,
  createBundleRef,
  createDeferred,
  createDeviceSyncResolvedConfig,
  createEmptyDeviceSyncPort,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createSnapshotDeviceSyncPort,
  createVaultSnapshotBundle,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  enqueueDeviceSyncSystemMailboxItemForTest,
  mocks,
  readConversationImportedSeqs,
  removeTempRoot,
  requireEventIndex,
  waitUntil,
  withRealTimeout,
  writeMailboxImportStateFile,
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
  VAULT_LAYOUT,
} from "@murphai/contracts";
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
import type {
  RuntimeWakeSignal,
} from "../src/hosted-runtime/runtime-wake.ts";
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
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  HostedRuntimeArtifactReadError,
  type HostedRuntimeDeviceSyncPort,
  type HostedRuntimeMailboxPort,
  type HostedRuntimePlatform,
  type RuntimeLivenessPort,
  type HostedRuntimeWorkspacePort,
  type HostedRuntimeWorkspaceSnapshotPort,
} from "../src/hosted-runtime-contracts.ts";

describe("hosted workspace runtime entrypoint", () => {test("fresh foreground input before system mailbox work preempts the model-free pass", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const baseDeviceSyncPort = createEmptyDeviceSyncPort();
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:preempt-before",
      id: "mailbox_item_system_mailbox_device_preempt_before",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-preempt-before-before.bundle.json",
        vaultRoot,
      });
      const baseMailboxPort = createMailboxPort({
        events,
        fetchRequests,
        items: [],
      });
      const mailboxPort: HostedRuntimeMailboxPort = {
        ...baseMailboxPort,
        async fetch(request) {
          fetchRequests.push(request);
          return await new Promise<HostedMailboxFetchResponse>(() => undefined);
        },
      };
      runtimeWakeSignal.notify({ requestedProcessingMode: "default" });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_device_preempt_before",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Preempted system mailbox work must not checkpoint.");
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort: baseDeviceSyncPort,
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            throw new Error("System mailbox mode must not enter assistant phase.");
          },
          vaultRoot,
        },
      );
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(baseDeviceSyncPort.fetchSnapshotCalls, 0);
      assert.equal(baseDeviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.deepEqual(fetchRequests, []);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length, 0);
      assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 1);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("fresh foreground input interrupts the initial system mailbox fetch before import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const fetchStarted = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const baseDeviceSyncPort = createEmptyDeviceSyncPort();
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:preempt-fetch",
      id: "mailbox_item_system_mailbox_device_preempt_fetch",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const observedMailboxFetch: { signal: AbortSignal | null } = { signal: null };

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-preempt-fetch-before.bundle.json",
        vaultRoot,
      });
      const baseMailboxPort = createMailboxPort({
        events,
        fetchRequests,
        items: [],
      });
      const mailboxPort: HostedRuntimeMailboxPort = {
        ...baseMailboxPort,
        async fetch(request, context) {
          fetchRequests.push(request);
          observedMailboxFetch.signal = context?.signal ?? null;
          assert.ok(observedMailboxFetch.signal);
          fetchStarted.resolve();
          return await new Promise<HostedMailboxFetchResponse>((_resolve, reject) => {
            const abort = () => reject(observedMailboxFetch.signal?.reason);
            if (observedMailboxFetch.signal?.aborted) {
              abort();
              return;
            }
            observedMailboxFetch.signal?.addEventListener("abort", abort, { once: true });
          });
        },
      };

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_device_preempt_fetch",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Interrupted system mailbox fetch must not checkpoint.");
          },
          async importItem() {
            throw new Error("Interrupted system mailbox fetch must not import a row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort: baseDeviceSyncPort,
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            throw new Error("System mailbox mode must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      await withRealTimeout(
        fetchStarted.promise,
        1_000,
        () => "System mailbox fetch did not start.",
      );
      runtimeWakeSignal.notify({ requestedProcessingMode: "default" });
      const result = await withRealTimeout(
        resultPromise,
        1_000,
        () => "System mailbox fetch did not yield to foreground input.",
      );

      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(observedMailboxFetch.signal?.aborted, true);
      assert.equal(baseDeviceSyncPort.fetchSnapshotCalls, 0);
      assert.equal(baseDeviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.equal(fetchRequests.length, 1);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length, 0);
      assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 1);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("preserves default ownership when the initial mailbox fetch wins the wake race", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const baseDeviceSyncPort = createEmptyDeviceSyncPort();
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:fetch-race",
      id: "mailbox_item_system_mailbox_fetch_race",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-fetch-race-before.bundle.json",
        vaultRoot,
      });
      const baseMailboxPort = createMailboxPort({
        events,
        fetchRequests,
        items: [],
      });
      const mailboxPort: HostedRuntimeMailboxPort = {
        ...baseMailboxPort,
        async fetch(request) {
          runtimeWakeSignal.notify({ requestedProcessingMode: "default" });
          return await baseMailboxPort.fetch(request);
        },
      };

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_fetch_race",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("A restored default wake must preempt system mailbox work.");
          },
          async importItem() {
            throw new Error("The synthetic fetch returns no new mailbox rows.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort: baseDeviceSyncPort,
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            throw new Error("System mailbox mode must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(baseDeviceSyncPort.fetchSnapshotCalls, 0);
      assert.equal(baseDeviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.equal(fetchRequests.length, 1);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length, 0);
      assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 1);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground input during a blocked system pass yields after checkpointing the bounded unit once", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const foregroundWakeSent = createDeferred<void>();
    const mailboxItems: HostedMailboxItem[] = [];
    const foregroundItem = createMailboxItem({
      id: "mailbox_item_system_mailbox_blocked_foreground_upgrade",
      laneSeq: "1",
      occurredAt: "2026-04-27T00:00:01.000Z",
    });
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:preempt-during",
      id: "mailbox_item_system_mailbox_device_preempt_during",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const deviceSyncPort = createSnapshotDeviceSyncPort({
      connectionId: "device_sync_connection_preempt_during",
      nextReconcileAt: "2026-04-27T00:05:00.000Z",
      onApplyUpdates: () => {
        mailboxItems.push(foregroundItem);
        events.push("foreground.wake");
        runtimeWakeSignal.notify();
        foregroundWakeSent.resolve();
      },
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-preempt-during-before.bundle.json",
        vaultRoot,
      });

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            assistantExecutionBlocked: true,
            attemptId: "attempt_synthetic_system_mailbox_device_preempt_during",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-device-preempt-during.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error(
              "The system-mailbox owner must yield before importing foreground work.",
            );
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: mailboxItems }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            throw new Error(
              "The system-mailbox owner must yield before entering the assistant phase.",
            );
          },
          vaultRoot,
        },
      );
      await withRealTimeout(
        foregroundWakeSent.promise,
        45_000,
        () => `System-mailbox work did not reach foreground wake: ${events.join(",")}`,
      );
      const result = await withRealTimeout(
        resultPromise,
        5_000,
        () => `System-mailbox owner did not yield promptly: ${events.join(",")}`,
      );

      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(deviceSyncPort.applyUpdatesCalls, 1);
      assert.ok(checkpointRequests.length >= 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, TEST_NOW);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.notEqual(result.status, "failed");
      const state = await readHostedSystemMailboxState(vaultRoot);
      expect(state.pending).toEqual(expect.arrayContaining([
        expect.objectContaining({
          itemId: deviceItem.id,
          nextAttemptAt: null,
          status: "recording",
        }),
        expect.objectContaining({
          nextAttemptAt: "2026-04-27T00:00:30.000Z",
          routeAction: "run-device-sync-wake",
          status: "pending",
        }),
      ]));
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("host abort after system device-sync apply still checkpoints canonical progress", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("synthetic host abort after device-sync apply");
    let browserPublishCalls = 0;
    let browserWriteCalls = 0;
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:host-abort-after-apply",
      id: "mailbox_item_system_mailbox_device_host_abort_after_apply",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const deviceSyncPort = createSnapshotDeviceSyncPort({
      connectionId: "device_sync_connection_host_abort_after_apply",
      nextReconcileAt: "2026-04-27T00:05:00.000Z",
      onApplyUpdates: async () => {
        await runCanonicalWrite({
          mutate: async ({ batch }) => {
            await batch.stageTextWrite(
              "audit/system-mailbox-device-sync-apply.md",
              "system mailbox device-sync canonical progress\n",
            );
          },
          occurredAt: TEST_NOW,
          operationType: "hosted_system_mailbox_device_sync_apply_test",
          summary: "Persist system mailbox device-sync apply progress",
          vaultRoot,
        });
        hostAbortController.abort(hostAbortReason);
      },
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-host-abort-after-apply-before.bundle.json",
        vaultRoot,
      });

      await assert.rejects(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_system_mailbox_device_host_abort_after_apply",
              processingMode: "system_mailbox",
              workspaceVersion: "0",
            },
            resolvedConfig: createDeviceSyncResolvedConfig(),
          }),
          {
            async createCheckpointSnapshot() {
              return {
                snapshotRef: createBundleRef({
                  hash: "e".repeat(64),
                  key: "users/bundles/member-synthetic/system-mailbox-device-host-abort-after-apply.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem() {
              throw new Error("Already-imported system mailbox work should not import a new row.");
            },
            platform: createPlatform({
              artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
              browserVaultReplicaPort: {
                async publishRef({ replicaRef }) {
                  browserPublishCalls += 1;
                  events.push("browser-vault.publish");
                  return {
                    published: true,
                    workspace: createWorkspaceState({
                      browserVaultReplicaRef: replicaRef,
                      version: "1",
                    }),
                  };
                },
                async write({ replica }) {
                  browserWriteCalls += 1;
                  events.push("browser-vault.write");
                  return createBrowserVaultReplicaRef(replica);
                },
              },
              deviceSyncPort,
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({
                  snapshotRef: restoredWorkspace.snapshotRef,
                  version: "0",
                }),
              }),
            }),
            signal: hostAbortController.signal,
            async runAssistantPhase() {
              throw new Error("System mailbox mode must not enter assistant phase.");
            },
            vaultRoot,
          },
        ),
        hostAbortReason,
      );

      assert.equal(hostAbortController.signal.aborted, true);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(deviceSyncPort.applyUpdatesCalls, 1);
      assert.equal(browserWriteCalls, 0);
      assert.equal(browserPublishCalls, 0);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "canonical_runtime_commit",
        "canonical_runtime_commit",
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.expectedWorkspaceVersion, "0");
      assert.equal(checkpointRequests[1]?.expectedWorkspaceVersion, "1");
      assert.equal(checkpointRequests[2]?.expectedWorkspaceVersion, "2");
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.equal(
        typeof checkpointRequests[1]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );
      assert.equal(
        checkpointRequests[2]?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "0",
      );
      assert.equal(typeof checkpointRequests[2]?.nextWakeAt, "string");
      // The canonical write may make an immediate assistant snapshot refresh
      // earlier than the device continuation; either wake must be checkpointed.
      assert.match(
        checkpointRequests[2]?.nextWakeReason ?? "",
        /^(assistant|device-sync\.reconcile)$/u,
      );
      const retainedState = await readHostedSystemMailboxState(vaultRoot);
      const retained = retainedState.pending.find((item) => item.itemId === deviceItem.id);
      assert.equal(retained?.status, "recording");
      assert.deepEqual(retained?.postCheckpointRecord, {
        kind: "device-sync.dirty-processed-batch",
        nextWakeAt: "2026-04-27T00:05:00.000Z",
        records: [],
      });
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    "before-delivery",
    "active-delivery",
  ] as const)("exact host abort at %s stops system projection admission before replacement", async (
    abortAt,
  ) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("synthetic host abort during system projection");
    const scopeResolutionStarted = createDeferred<void>();
    const scopeResolutionRelease = createDeferred<void>();
    const projectionStarted = createDeferred<void>();
    const projectionRelease = createDeferred<void>();
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:host-abort-system-projection",
      id: "mailbox_item_system_mailbox_host_abort_projection",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const baseDeviceSyncPort = createEmptyDeviceSyncPort();
    let dirtyAckCalls = 0;
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...baseDeviceSyncPort,
      async ackDirtyStateProcessed(request) {
        dirtyAckCalls += 1;
        events.push("device-sync.dirty-ack");
        return {
          connectionId: request.connectionId,
          dirtyRevision: request.processedRevision,
          nextWakeAt: null,
          processedRevision: request.processedRevision,
          recorded: true,
          stillDirty: false,
          userId: TEST_USER_ID,
        };
      },
    };
    const deliveredProjectionKinds: string[] = [];
    let activeProjectionCalls = 0;
    let peakActiveProjectionCalls = 0;
    let scopeResolutionBlocked = false;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.summarizeWearableSleepRuntime.mockResolvedValue([]);
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) =>
          item.itemId === deviceItem.id
            ? {
                ...item,
                postCheckpointRecord: {
                  connectionId: "device_sync_connection_host_abort_projection",
                  kind: "device-sync.dirty-processed" as const,
                  processedDirtyPayloadIds: ["dirty_payload_host_abort_projection"],
                  processedRevision: "8",
                },
                status: "recording" as const,
              }
            : item
        ),
      }));
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-host-abort-projection-before.bundle.json",
        vaultRoot,
      });
      const artifactBytesByHash = new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]);
      let snapshotIndex = 0;
      const createRunOptions = (
        workspace: HostedWorkspaceState,
        signal?: AbortSignal,
      ) => ({
        async createCheckpointSnapshot() {
          snapshotIndex += 1;
          const snapshot = await createVaultSnapshotBundle({
            key:
              `users/bundles/member-synthetic/system-mailbox-host-abort-projection-after-${snapshotIndex}.bundle.json`,
            vaultRoot,
          });
          artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
          return { snapshotRef: snapshot.snapshotRef };
        },
        async importItem() {
          throw new Error("Already-imported recording work should not import a new row.");
        },
        platform: createPlatform({
          artifactBytesByHash,
          deviceSyncPort,
          mailboxPort: createMailboxPort({ events, items: [] }),
          vaultSharePort: {
            async listActiveProjectionScopes() {
              if (abortAt === "before-delivery" && !scopeResolutionBlocked) {
                scopeResolutionBlocked = true;
                scopeResolutionStarted.resolve();
                await scopeResolutionRelease.promise;
              }
              return {
                generationTokensByProjectionScopeKey: {
                  "profile-name.v0": "a".repeat(43),
                  "time-zone.v0": "b".repeat(43),
                  "sleep-times.v0": "c".repeat(43),
                },
                projectionKinds: [
                  "profile-name.v0" as const,
                  "time-zone.v0" as const,
                  "sleep-times.v0" as const,
                ],
                projectionScopes: [
                  { projectionKind: "profile-name.v0" as const },
                  { projectionKind: "time-zone.v0" as const },
                  { projectionKind: "sleep-times.v0" as const },
                ],
              };
            },
            async deliver(request) {
              deliveredProjectionKinds.push(request.projectionKind);
              activeProjectionCalls += 1;
              peakActiveProjectionCalls = Math.max(
                peakActiveProjectionCalls,
                activeProjectionCalls,
              );
              events.push(`vault-share.deliver:start:${request.projectionKind}`);
              try {
                if (
                  abortAt === "active-delivery"
                  && deliveredProjectionKinds.length === 1
                ) {
                  projectionStarted.resolve();
                  await projectionRelease.promise;
                }
                events.push(`vault-share.deliver:done:${request.projectionKind}`);
                return { status: "delivered" as const };
              } finally {
                activeProjectionCalls -= 1;
              }
            },
          },
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace,
          }),
        }),
        ...(signal ? { signal } : {}),
        async runAssistantPhase() {
          throw new Error("System mailbox recording must not enter assistant phase.");
        },
        vaultRoot,
      });
      const createRuntimeInput = (attemptId: string, workspaceVersion: string) =>
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId,
            processingMode: "system_mailbox",
            workspaceVersion,
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        });
      const initialWorkspace = createWorkspaceState({
        snapshotRef: restoredWorkspace.snapshotRef,
        version: "0",
      });

      const interruptedRun = runHostedWorkspaceRuntimeJobInProcess(
        createRuntimeInput(
          "attempt_synthetic_system_mailbox_host_abort_projection",
          "0",
        ),
        createRunOptions(initialWorkspace, hostAbortController.signal),
      );
      if (abortAt === "before-delivery") {
        await withRealTimeout(
          scopeResolutionStarted.promise,
          5_000,
          () => events.join(","),
        );
      } else {
        await withRealTimeout(
          projectionStarted.promise,
          5_000,
          () => events.join(","),
        );
      }
      let interruptedRunSettled = false;
      void interruptedRun.then(
        () => {
          interruptedRunSettled = true;
        },
        () => {
          interruptedRunSettled = true;
        },
      );
      hostAbortController.abort(hostAbortReason);
      await Promise.resolve();
      assert.equal(interruptedRunSettled, false);
      if (abortAt === "before-delivery") {
        assert.deepEqual(deliveredProjectionKinds, []);
        scopeResolutionRelease.resolve();
      } else {
        assert.deepEqual(deliveredProjectionKinds, ["profile-name.v0"]);
        projectionRelease.resolve();
      }
      await expect(withRealTimeout(
        interruptedRun,
        5_000,
        () => events.join(","),
      )).rejects.toBe(hostAbortReason);

      assert.deepEqual(
        deliveredProjectionKinds,
        abortAt === "before-delivery" ? [] : ["profile-name.v0"],
      );
      assert.equal(dirtyAckCalls, 0);
      assert.equal(activeProjectionCalls, 0);
      assert.equal(checkpointRequests.length, 1);
      const retainedItem = (await readHostedSystemMailboxState(vaultRoot)).pending.find(
        (item) => item.itemId === deviceItem.id,
      );
      assert.equal(retainedItem?.status, "recording");
      assert.ok(retainedItem?.postCheckpointRecord);
      const durableRecordingCheckpoint = checkpointRequests[0];
      assert.ok(durableRecordingCheckpoint);
      const resumedWorkspace = createWorkspaceState({
        inboxMediaRetentionWakeAt:
          durableRecordingCheckpoint.inboxMediaRetentionWakeAt ?? null,
        nextWakeAt: durableRecordingCheckpoint.nextWakeAt ?? null,
        nextWakeReason: durableRecordingCheckpoint.nextWakeReason ?? null,
        redactedStatus: durableRecordingCheckpoint.redactedStatus ?? null,
        snapshotRef: durableRecordingCheckpoint.snapshotRef,
        version: "1",
      });

      await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createRuntimeInput(
            "attempt_synthetic_system_mailbox_host_abort_projection_replacement",
            "1",
          ),
          createRunOptions(resumedWorkspace),
        ),
        5_000,
        () => events.join(","),
      );

      assert.deepEqual(deliveredProjectionKinds, [
        ...(abortAt === "active-delivery" ? ["profile-name.v0"] : []),
        "profile-name.v0",
        "time-zone.v0",
        "sleep-times.v0",
      ]);
      assert.equal(peakActiveProjectionCalls, 1);
      assert.equal(dirtyAckCalls, 1);
      if (abortAt === "active-delivery") {
        assert.ok(
          requireEventIndex(events, "vault-share.deliver:done:profile-name.v0")
            < events.lastIndexOf("vault-share.deliver:start:profile-name.v0"),
          events.join(","),
        );
      }
      assert.ok(
        requireEventIndex(events, "vault-share.deliver:done:sleep-times.v0")
          < requireEventIndex(events, "device-sync.dirty-ack"),
        events.join(","),
      );
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
    } finally {
      scopeResolutionRelease.resolve();
      projectionRelease.resolve();
      hostAbortController.abort(hostAbortReason);
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoint-reported foreground input defers system mailbox post-checkpoint recording", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:preempt-recording",
      id: "mailbox_item_system_mailbox_device_preempt_recording",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const baseDeviceSyncPort = createEmptyDeviceSyncPort();
    let dirtyAckCalls = 0;
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...baseDeviceSyncPort,
      async ackDirtyStateProcessed() {
        dirtyAckCalls += 1;
        throw new Error("Foreground preemption must defer the device-sync dirty ack.");
      },
    };

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) =>
          item.itemId === deviceItem.id
            ? {
                ...item,
                postCheckpointRecord: {
                  connectionId: "device_sync_connection_preempt_recording",
                  kind: "device-sync.dirty-processed" as const,
                  processedDirtyPayloadIds: ["dirty_payload_preempt_recording"],
                  processedRevision: "8",
                },
                status: "recording" as const,
              }
            : item
        ),
      }));
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-preempt-recording-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_device_preempt_recording",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-device-preempt-recording.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointResponse(request) {
                return {
                  checkpointed: true,
                  conversationInputAhead: true,
                  workspace: createWorkspaceState({
                    inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  }),
                };
              },
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            throw new Error("System mailbox mode must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(dirtyAckCalls, 0);
      assert.equal(checkpointRequests.length, 1);
      const state = await readHostedSystemMailboxState(vaultRoot);
      assert.ok(state.pending.some((item) =>
        item.itemId === deviceItem.id && item.status === "recording"
      ));
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("exact wake interrupts dirty acknowledgement and a later system pass resumes it", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const acknowledgementStarted = createDeferred<void>();
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:interrupt-recording",
      id: "mailbox_item_system_mailbox_device_interrupt_recording",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const followUpWakeAt = "2026-04-27T00:03:00.000Z";
    const baseDeviceSyncPort = createEmptyDeviceSyncPort();
    let dirtyAckCalls = 0;
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...baseDeviceSyncPort,
      async ackDirtyStateProcessed(request) {
        dirtyAckCalls += 1;
        if (dirtyAckCalls === 1) {
          const signal = request.signal;
          assert.ok(signal);
          acknowledgementStarted.resolve();
          await new Promise<void>((_resolve, reject) => {
            const abort = () => reject(
              signal.reason instanceof Error
                ? signal.reason
                : new DOMException("Synthetic dirty acknowledgement aborted.", "AbortError"),
            );
            if (signal.aborted) {
              abort();
              return;
            }
            signal.addEventListener("abort", abort, { once: true });
          });
          throw new Error("Interrupted dirty acknowledgement unexpectedly continued.");
        }
        return {
          connectionId: request.connectionId,
          dirtyRevision: "9",
          nextWakeAt: followUpWakeAt,
          processedRevision: request.processedRevision,
          recorded: true,
          stillDirty: true,
          userId: TEST_USER_ID,
        };
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) =>
          item.itemId === deviceItem.id
            ? {
                ...item,
                postCheckpointRecord: {
                  connectionId: "device_sync_connection_interrupt_recording",
                  kind: "device-sync.dirty-processed" as const,
                  processedDirtyPayloadIds: ["dirty_payload_interrupt_recording"],
                  processedRevision: "8",
                },
                status: "recording" as const,
              }
            : item
        ),
      }));
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-interrupt-recording.bundle.json",
        vaultRoot,
      });
      const artifactBytesByHash = new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]);
      let snapshotIndex = 0;
      const createRunOptions = (
        wakeSignal: RuntimeWakeSignal,
        workspace: HostedWorkspaceState,
      ) => ({
        async createCheckpointSnapshot() {
          snapshotIndex += 1;
          const snapshot = await createVaultSnapshotBundle({
            key: `users/bundles/member-synthetic/system-mailbox-device-interrupt-recording-after-${snapshotIndex}.bundle.json`,
            vaultRoot,
          });
          artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
          return { snapshotRef: snapshot.snapshotRef };
        },
        async importItem() {
          throw new Error("Already-imported recording work should not import a new row.");
        },
        platform: createPlatform({
          artifactBytesByHash,
          deviceSyncPort,
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace,
          }),
        }),
        runtimeWakeSignal: wakeSignal,
        async runAssistantPhase() {
          throw new Error("System mailbox recording must not enter assistant phase.");
        },
        vaultRoot,
      });
      const createRuntimeInput = (attemptId: string, workspaceVersion: string) =>
        createWorkspaceRuntimeJobInput({
        request: {
          attemptId,
          processingMode: "system_mailbox",
          workspaceVersion,
        },
        resolvedConfig: createDeviceSyncResolvedConfig(),
      });
      const initialWorkspace = createWorkspaceState({
        snapshotRef: restoredWorkspace.snapshotRef,
        version: "0",
      });

      const interruptedRun = runHostedWorkspaceRuntimeJobInProcess(
        createRuntimeInput(
          "attempt_synthetic_system_mailbox_device_interrupt_recording",
          "0",
        ),
        createRunOptions(runtimeWakeSignal, initialWorkspace),
      );
      await acknowledgementStarted.promise;
      runtimeWakeSignal.notify({ requestedProcessingMode: "default" });
      const interruptedResult = await withRealTimeout(
        interruptedRun,
        1_000,
        () => "System mailbox did not release promptly after an exact wake interrupted dirty acknowledgement.",
      );

      assert.equal(interruptedResult.immediateRecheckRequested, true);
      assert.equal(interruptedResult.nextWakeReason, "assistant");
      assert.equal(dirtyAckCalls, 1);
      const interruptedState = await readHostedSystemMailboxState(vaultRoot);
      const retainedItem = interruptedState.pending.find((item) => item.itemId === deviceItem.id);
      assert.equal(retainedItem?.status, "recording");
      assert.equal(retainedItem?.nextAttemptAt, null);
      assert.ok(retainedItem?.postCheckpointRecord);
      assert.equal(checkpointRequests.length, 1);
      const durableRecordingCheckpoint = checkpointRequests[0];
      assert.ok(durableRecordingCheckpoint);
      const resumedWorkspace = createWorkspaceState({
        inboxMediaRetentionWakeAt:
          durableRecordingCheckpoint.inboxMediaRetentionWakeAt ?? null,
        nextWakeAt: durableRecordingCheckpoint.nextWakeAt ?? null,
        nextWakeReason: durableRecordingCheckpoint.nextWakeReason ?? null,
        redactedStatus: durableRecordingCheckpoint.redactedStatus ?? null,
        snapshotRef: durableRecordingCheckpoint.snapshotRef,
        version: "1",
      });

      const resumedResult = await runHostedWorkspaceRuntimeJobInProcess(
        createRuntimeInput(
          "attempt_synthetic_system_mailbox_device_resume_recording",
          "1",
        ),
        createRunOptions(createCoalescingRuntimeWakeSignal(), resumedWorkspace),
      );

      assert.equal(dirtyAckCalls, 2);
      assert.equal(resumedResult.nextWakeAt, followUpWakeAt);
      assert.equal(resumedResult.nextWakeReason, "device-sync.reconcile");
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, followUpWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "device-sync.reconcile");
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("system projection retries a preempted suffix and a definitive failed scope without starving later scopes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const projectionStarted = createDeferred<void>();
    const projectionRelease = createDeferred<void>();
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:projection-interrupt-recording",
      id: "mailbox_item_system_mailbox_projection_interrupt_recording",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const baseDeviceSyncPort = createEmptyDeviceSyncPort();
    let dirtyAckCalls = 0;
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...baseDeviceSyncPort,
      async ackDirtyStateProcessed(request) {
        dirtyAckCalls += 1;
        events.push("device-sync.dirty-ack");
        return {
          connectionId: request.connectionId,
          dirtyRevision: request.processedRevision,
          nextWakeAt: null,
          processedRevision: request.processedRevision,
          recorded: true,
          stillDirty: false,
          userId: TEST_USER_ID,
        };
      },
    };
    let projectionCalls = 0;
    let activeProjectionCalls = 0;
    let peakActiveProjectionCalls = 0;
    const projectedKinds: string[] = [];
    const projectedWorkspaceVersions: string[] = [];

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.summarizeWearableSleepRuntime.mockResolvedValue([]);
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const metadataPath = path.join(vaultRoot, VAULT_LAYOUT.metadata);
      const metadata = {
        createdAt: TEST_NOW,
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        timezone: "UTC",
        title: "Projection ownership test",
        vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4G",
      };
      await mkdir(path.dirname(metadataPath), { recursive: true });
      await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`, "utf8");
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) =>
          item.itemId === deviceItem.id
            ? {
                ...item,
                postCheckpointRecord: {
                  connectionId: "device_sync_connection_projection_interrupt",
                  kind: "device-sync.dirty-processed" as const,
                  processedDirtyPayloadIds: ["dirty_payload_projection_interrupt"],
                  processedRevision: "8",
                },
                status: "recording" as const,
              }
            : item
        ),
      }));
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-projection-interrupt-before.bundle.json",
        vaultRoot,
      });
      const artifactBytesByHash = new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]);
      let snapshotIndex = 0;
      const createRunOptions = (
        wakeSignal: RuntimeWakeSignal,
        workspace: HostedWorkspaceState,
      ) => ({
        async createCheckpointSnapshot() {
          snapshotIndex += 1;
          const snapshot = await createVaultSnapshotBundle({
            key: `users/bundles/member-synthetic/system-mailbox-projection-interrupt-after-${snapshotIndex}.bundle.json`,
            vaultRoot,
          });
          artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
          return { snapshotRef: snapshot.snapshotRef };
        },
        async importItem() {
          throw new Error("Already-imported recording work should not import a new row.");
        },
        platform: createPlatform({
          artifactBytesByHash,
          deviceSyncPort,
          mailboxPort: createMailboxPort({ events, fetchRequests, items: [] }),
          vaultSharePort: {
            async listActiveProjectionScopes() {
              return {
                generationTokensByProjectionScopeKey: {
                  "profile-name.v0": "a".repeat(43),
                  "time-zone.v0": "b".repeat(43),
                  "sleep-times.v0": "c".repeat(43),
                },
                projectionKinds: [
                  "profile-name.v0" as const,
                  "time-zone.v0" as const,
                  "sleep-times.v0" as const,
                ],
                projectionScopes: [
                  { projectionKind: "profile-name.v0" as const },
                  { projectionKind: "time-zone.v0" as const },
                  { projectionKind: "sleep-times.v0" as const },
                ],
              };
            },
            async deliver(request) {
              projectionCalls += 1;
              projectedKinds.push(request.projectionKind);
              projectedWorkspaceVersions.push(request.sourceWorkspaceVersion);
              events.push(`vault-share.deliver:start:${projectionCalls}`);
              activeProjectionCalls += 1;
              peakActiveProjectionCalls = Math.max(
                peakActiveProjectionCalls,
                activeProjectionCalls,
              );
              try {
                if (projectionCalls === 1) {
                  projectionStarted.resolve();
                  await projectionRelease.promise;
                }
                const status = projectionCalls === 3
                  ? "scope-failed" as const
                  : "delivered" as const;
                events.push(`vault-share.deliver:done:${projectionCalls}:${status}`);
                return { status };
              } finally {
                activeProjectionCalls -= 1;
              }
            },
          },
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace,
          }),
        }),
        runtimeWakeSignal: wakeSignal,
        async runAssistantPhase() {
          throw new Error("An empty system-mailbox wake must not enter assistant phase.");
        },
        vaultRoot,
      });
      const createRuntimeInput = (attemptId: string, workspaceVersion: string) =>
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId,
            processingMode: "system_mailbox",
            workspaceVersion,
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        });
      const initialWorkspace = createWorkspaceState({
        snapshotRef: restoredWorkspace.snapshotRef,
        version: "0",
      });

      const interruptedRun = runHostedWorkspaceRuntimeJobInProcess(
        createRuntimeInput(
          "attempt_synthetic_system_mailbox_projection_interrupt_recording",
          "0",
        ),
        createRunOptions(runtimeWakeSignal, initialWorkspace),
      );
      await projectionStarted.promise;
      let interruptedRunSettled = false;
      void interruptedRun.then(
        () => {
          interruptedRunSettled = true;
        },
        () => {
          interruptedRunSettled = true;
        },
      );
      runtimeWakeSignal.notify();
      await Promise.resolve();
      assert.equal(interruptedRunSettled, false);
      assert.equal(projectionCalls, 1);
      assert.equal(activeProjectionCalls, 1);
      assert.equal(
        fetchRequests.some((request) =>
          request.requestId.includes(":system-mailbox-foreground-upgrade")
        ),
        false,
      );
      projectionRelease.resolve();
      const interruptedResult = await withRealTimeout(
        interruptedRun,
        5_000,
        () => "System mailbox did not release after its owned projection completed.",
      );

      assert.equal(interruptedResult.immediateRecheckRequested, true);
      assert.equal(dirtyAckCalls, 0);
      assert.equal(events.includes("device-sync.dirty-ack"), false);
      const interruptedState = await readHostedSystemMailboxState(vaultRoot);
      const retainedItem = interruptedState.pending.find((item) => item.itemId === deviceItem.id);
      assert.equal(retainedItem?.status, "recording");
      assert.ok(retainedItem?.postCheckpointRecord);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(projectionCalls, 1);
      assert.equal(activeProjectionCalls, 0);
      assert.ok(
        events.includes("vault-share.deliver:done:1:delivered"),
        events.join(","),
      );
      const durableRecordingCheckpoint = checkpointRequests[0];
      assert.ok(durableRecordingCheckpoint);
      const resumedWorkspace = createWorkspaceState({
        inboxMediaRetentionWakeAt:
          durableRecordingCheckpoint.inboxMediaRetentionWakeAt ?? null,
        nextWakeAt: durableRecordingCheckpoint.nextWakeAt ?? null,
        nextWakeReason: durableRecordingCheckpoint.nextWakeReason ?? null,
        redactedStatus: durableRecordingCheckpoint.redactedStatus ?? null,
        snapshotRef: durableRecordingCheckpoint.snapshotRef,
        version: "1",
      });

      await runHostedWorkspaceRuntimeJobInProcess(
        createRuntimeInput(
          "attempt_synthetic_system_mailbox_projection_resume_recording",
          "1",
        ),
        createRunOptions(createCoalescingRuntimeWakeSignal(), resumedWorkspace),
      );

      assert.equal(projectionCalls, 4);
      assert.deepEqual(projectedKinds, [
        "profile-name.v0",
        "profile-name.v0",
        "time-zone.v0",
        "sleep-times.v0",
      ]);
      assert.deepEqual(projectedWorkspaceVersions, ["1", "2", "2", "2"]);
      assert.equal(peakActiveProjectionCalls, 1);
      assert.equal(dirtyAckCalls, 0);
      assert.ok(
        requireEventIndex(events, "vault-share.deliver:done:1:delivered")
          < requireEventIndex(events, "vault-share.deliver:start:2"),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(events, "vault-share.deliver:done:3:scope-failed")
          < requireEventIndex(events, "vault-share.deliver:start:4"),
        events.join(","),
      );
      const failedState = await readHostedSystemMailboxState(vaultRoot);
      const failedItem = failedState.pending.find((item) => item.itemId === deviceItem.id);
      assert.equal(failedItem?.status, "recording");
      assert.equal(typeof failedItem?.nextAttemptAt, "string");
      assert.ok(failedItem?.postCheckpointRecord);
      assert.equal(checkpointRequests.length, 2);
      const failedRecordingCheckpoint = checkpointRequests[1];
      assert.ok(failedRecordingCheckpoint);
      const recoveredWorkspace = createWorkspaceState({
        inboxMediaRetentionWakeAt:
          failedRecordingCheckpoint.inboxMediaRetentionWakeAt ?? null,
        nextWakeAt: failedRecordingCheckpoint.nextWakeAt ?? null,
        nextWakeReason: failedRecordingCheckpoint.nextWakeReason ?? null,
        redactedStatus: failedRecordingCheckpoint.redactedStatus ?? null,
        snapshotRef: failedRecordingCheckpoint.snapshotRef,
        version: "2",
      });

      vi.setSystemTime(new Date(Date.parse(TEST_NOW) + 60_000));
      await runHostedWorkspaceRuntimeJobInProcess(
        createRuntimeInput(
          "attempt_synthetic_system_mailbox_projection_recovery_recording",
          "2",
        ),
        createRunOptions(createCoalescingRuntimeWakeSignal(), recoveredWorkspace),
      );

      assert.equal(projectionCalls, 7);
      assert.deepEqual(projectedKinds.slice(4), [
        "profile-name.v0",
        "time-zone.v0",
        "sleep-times.v0",
      ]);
      assert.deepEqual(projectedWorkspaceVersions.slice(4), ["3", "3", "3"]);
      assert.equal(peakActiveProjectionCalls, 1);
      assert.equal(dirtyAckCalls, 1);
      assert.ok(
        requireEventIndex(events, "vault-share.deliver:done:7:delivered")
          < requireEventIndex(events, "device-sync.dirty-ack"),
        events.join(","),
      );
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
    } finally {
      projectionRelease.resolve();
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox hands a newly due assistant cron past an older device-sync wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const now = "2026-04-27T14:00:00.000Z";
    const staleDeviceSyncWakeAt = "2026-04-27T13:59:00.000Z";
    const automationId = "automation_01JQ8PWXP5A68SQM1W0GYM41WA";
    const deviceSyncPort = createSnapshotDeviceSyncPort({
      connectionId: "device_sync_connection_due_assistant_handoff",
      nextReconcileAt: "2026-04-27T14:05:00.000Z",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(now));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await upsertAutomation({
        automationId,
        continuityPolicy: "fresh",
        instructions: "Send one synthetic experiment reminder.",
        now: new Date("2026-04-27T13:58:00.000Z"),
        route: {
          channel: "linq",
          deliveryTarget: "synthetic_direct_chat",
          identityId: null,
          participantId: null,
          threadId: "synthetic_direct_chat",
          threadIsDirect: true,
        },
        schedule: {
          at: "2026-04-27T13:59:30.000Z",
          kind: "at",
        },
        status: "active",
        title: "Synthetic due reminder",
        vaultRoot,
      });
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/due-assistant-system-handoff-before.bundle.json",
        vaultRoot,
      });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_due_assistant_system_handoff",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/due-assistant-system-handoff.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("No mailbox items should be imported for this handoff.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleDeviceSyncWakeAt,
                nextWakeReason: "device-sync.reconcile",
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox handoff must return before assistant execution.");
          },
          vaultRoot,
        },
      );

      assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.nextWakeAt, now);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, now);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("blocked system mailbox device work replays its due reminder once after policy restoration", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const now = "2026-04-27T14:00:00.000Z";
    const retainedDeviceWakeAt = "2026-04-27T14:00:30.000Z";
    const staleDeviceSyncWakeAt = "2026-04-27T13:59:00.000Z";
    const automationId = "automation_01JQ8PWXP5A68SQM1W0GYM41WB";
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:blocked-assistant-handoff",
      id: "mailbox_item_system_mailbox_device_blocked_assistant_handoff",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const retainedDeviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:blocked-assistant-retained-continuation",
      id: "mailbox_item_system_mailbox_device_blocked_assistant_retained_continuation",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "2",
    });
    const deviceSyncPort = createEmptyDeviceSyncPort();

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(now));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await upsertAutomation({
        automationId,
        continuityPolicy: "fresh",
        instructions: "Send one synthetic experiment reminder.",
        now: new Date("2026-04-27T13:58:00.000Z"),
        route: {
          channel: "linq",
          deliveryTarget: "synthetic_direct_chat",
          identityId: null,
          participantId: null,
          threadId: "synthetic_direct_chat",
          threadIsDirect: true,
        },
        schedule: {
          at: "2026-04-27T13:59:30.000Z",
          kind: "at",
        },
        status: "active",
        title: "Synthetic blocked reminder",
        vaultRoot,
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: retainedDeviceItem,
        vaultRoot,
      });
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) =>
          item.itemId === retainedDeviceItem.id
            ? {
                ...item,
                nextAttemptAt: retainedDeviceWakeAt,
              }
            : item
        ),
      }));
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "2";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/blocked-assistant-system-handoff-before.bundle.json",
        vaultRoot,
      });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            assistantExecutionBlocked: true,
            attemptId: "attempt_synthetic_blocked_assistant_system_handoff",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/blocked-assistant-system-handoff.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleDeviceSyncWakeAt,
                nextWakeReason: "device-sync.reconcile",
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Blocked system mailbox work must not enter assistant execution.");
          },
          vaultRoot,
        },
      );

      assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => ({
          itemId: item.itemId,
          nextAttemptAt: item.nextAttemptAt,
          wakeEventId: item.wake.eventId,
        })),
        [{
          itemId: retainedDeviceItem.id,
          nextAttemptAt: retainedDeviceWakeAt,
          wakeEventId: retainedDeviceItem.dedupeKey,
        }],
      );
      assert.equal(result.immediateRecheckRequested, undefined);
      assert.equal(result.nextWakeAt, retainedDeviceWakeAt);
      assert.equal(result.nextWakeReason, "device-sync.reconcile");
      assert.equal(result.status, "scheduled");
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, retainedDeviceWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "device-sync.reconcile");
      const cronStatus = await getAssistantCronStatus(vaultRoot, {
        turnEnvironment: {
          currentWorkingDirectory: null,
          env: {
            MURPH_HOSTED_RUNTIME_PROCESS: "1",
            VAULT: vaultRoot,
          },
        },
      });
      assert.equal(cronStatus.nextRunAt, "2026-04-27T13:59:30.000Z");
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);

      const retainedDeviceWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/blocked-assistant-retained-device-before.bundle.json",
        vaultRoot,
      });
      vi.setSystemTime(new Date(retainedDeviceWakeAt));
      const retainedDeviceResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            assistantExecutionBlocked: true,
            attemptId: "attempt_synthetic_blocked_assistant_retained_device",
            processingMode: "system_mailbox",
            workspaceVersion: "1",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/blocked-assistant-retained-device.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Retained system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([
              [retainedDeviceWorkspace.hash, retainedDeviceWorkspace.bytes],
            ]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: result.nextWakeAt,
                nextWakeReason: result.nextWakeReason ?? null,
                snapshotRef: retainedDeviceWorkspace.snapshotRef,
                version: "1",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Repeated blocked device work must not enter assistant execution.");
          },
          vaultRoot,
        },
      );

      assert.equal(deviceSyncPort.fetchSnapshotCalls, 2);
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
      assert.equal(retainedDeviceResult.immediateRecheckRequested, undefined);
      assert.equal(retainedDeviceResult.nextWakeAt, retainedDeviceWakeAt);
      assert.equal(retainedDeviceResult.nextWakeReason, "assistant");
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, retainedDeviceWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);

      const restoredPolicyWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/blocked-assistant-policy-restored-before.bundle.json",
        vaultRoot,
      });
      let assistantPhaseCalls = 0;
      const restoredResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_blocked_assistant_policy_restored",
            workspaceVersion: "2",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/blocked-assistant-policy-restored.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Policy restoration should not import duplicate mailbox work.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([
              [restoredPolicyWorkspace.hash, restoredPolicyWorkspace.bytes],
            ]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: retainedDeviceResult.nextWakeAt,
                nextWakeReason: retainedDeviceResult.nextWakeReason ?? null,
                snapshotRef: restoredPolicyWorkspace.snapshotRef,
                version: "2",
              }),
            }),
          }),
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            assert.equal(
              (await getAssistantCronStatus(vaultRoot, {
                turnEnvironment: {
                  currentWorkingDirectory: null,
                  env: {
                    MURPH_HOSTED_RUNTIME_PROCESS: "1",
                    VAULT: vaultRoot,
                  },
                },
              })).nextRunAt,
              "2026-04-27T13:59:30.000Z",
            );
            const intent = await createAssistantOutboxIntent({
              channel: "linq",
              dedupeToken: `automation:${automationId}:2026-04-27T13:59:30.000Z`,
              explicitTarget: "synthetic_direct_chat",
              identityId: null,
              message: "Synthetic reminder delivered after policy restoration.",
              sessionId: "session_blocked_assistant_policy_restored",
              threadId: "synthetic_direct_chat",
              threadIsDirect: true,
              turnId: "turn_blocked_assistant_policy_restored",
              turnTrigger: "automation-auto-reply",
              vault: vaultRoot,
            });
            const sentIntent = await markAssistantOutboxIntentSentById({
              delivery: {
                channel: "linq",
                idempotencyKey: "linq-blocked-assistant-policy-restored",
                messageLength: intent.message.length,
                providerMessageId: "linq-blocked-assistant-policy-restored",
                providerThreadId: "synthetic_direct_chat",
                sentAt: retainedDeviceWakeAt,
                target: "synthetic_direct_chat",
                targetKind: "explicit",
              },
              intentId: intent.intentId,
              vault: vaultRoot,
            });
            assert.equal(sentIntent?.status, "sent");
            await patchAutomation({
              lookup: automationId,
              now: new Date(retainedDeviceWakeAt),
              status: "archived",
              vaultRoot,
            });
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.equal(restoredResult.status, "idle");
      const sentIntents = (await listAssistantOutboxIntents(vaultRoot))
        .filter((intent) => intent.status === "sent");
      assert.equal(sentIntents.length, 1);
      assert.equal((await showAutomation({ automationId, vaultRoot }))?.status, "archived");
      assert.equal(
        (await getAssistantCronStatus(vaultRoot, {
          turnEnvironment: {
            currentWorkingDirectory: null,
            env: {
              MURPH_HOSTED_RUNTIME_PROCESS: "1",
              VAULT: vaultRoot,
            },
          },
        })).nextRunAt,
        null,
      );

      const terminalWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/blocked-assistant-policy-terminal-before.bundle.json",
        vaultRoot,
      });
      let terminalAssistantPhaseCalls = 0;
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_blocked_assistant_policy_terminal",
            workspaceVersion: "3",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/blocked-assistant-policy-terminal.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Terminal replay should not import mailbox work.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[terminalWorkspace.hash, terminalWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: null,
                nextWakeReason: null,
                snapshotRef: terminalWorkspace.snapshotRef,
                version: "3",
              }),
            }),
          }),
          async runAssistantPhase() {
            terminalAssistantPhaseCalls += 1;
            assert.equal(
              (await getAssistantCronStatus(vaultRoot, {
                turnEnvironment: {
                  currentWorkingDirectory: null,
                  env: {
                    MURPH_HOSTED_RUNTIME_PROCESS: "1",
                    VAULT: vaultRoot,
                  },
                },
              })).nextRunAt,
              null,
            );
            assert.equal(
              (await listAssistantOutboxIntents(vaultRoot)).filter((intent) =>
                intent.status === "sent"
              ).length,
              1,
            );
            return { progressed: false };
          },
          vaultRoot,
        },
      );
      assert.equal(terminalAssistantPhaseCalls, 1);
      assert.equal(
        (await listAssistantOutboxIntents(vaultRoot)).filter((intent) =>
          intent.status === "sent"
        ).length,
        1,
      );
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox yields device sync when its projected assistant cron becomes due", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchStarted = createDeferred<void>();
    const now = "2026-04-27T14:00:00.000Z";
    const reminderAt = "2026-04-27T14:00:01.000Z";
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:assistant-deadline",
      id: "mailbox_item_system_mailbox_device_assistant_deadline",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const deviceSyncPort = createSnapshotDeviceSyncPort({
      connectionId: "device_sync_connection_assistant_deadline",
      nextReconcileAt: "2026-04-27T14:05:00.000Z",
      onFetchSnapshot: async (signal) => {
        fetchStarted.resolve();
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(signal?.reason);
          if (signal?.aborted) {
            abort();
            return;
          }
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    });

    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date(now));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await upsertAutomation({
        automationId: "automation_01JQ8PWXP5A68SQM1W0GYM41WZ",
        continuityPolicy: "fresh",
        instructions: "Send one deadline-sensitive reminder.",
        now: new Date("2026-04-27T13:58:00.000Z"),
        route: {
          channel: "linq",
          deliveryTarget: "synthetic_direct_chat",
          identityId: null,
          participantId: null,
          threadId: "synthetic_direct_chat",
          threadIsDirect: true,
        },
        schedule: { at: reminderAt, kind: "at" },
        status: "active",
        title: "Synthetic deadline reminder",
        vaultRoot,
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-assistant-deadline-before.bundle.json",
        vaultRoot,
      });

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_device_assistant_deadline",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-device-assistant-deadline.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: now,
                nextWakeReason: "device-sync.reconcile",
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox mode must hand off rather than execute assistant work.");
          },
          vaultRoot,
        },
      );

      await fetchStarted.promise;
      vi.setSystemTime(new Date(Date.parse(reminderAt) - 25));
      await vi.advanceTimersByTimeAsync(25);
      const result = await resultPromise;

      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.nextWakeAt, reminderAt);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(deviceSyncPort.applyUpdatesCalls, 0);
      const state = await readHostedSystemMailboxState(vaultRoot);
      assert.equal(state.pending.length, 1);
      assert.equal(state.pending[0]?.itemId, deviceItem.id);
      assert.equal(state.pending[0]?.status, "pending");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox stops the projection suffix when its assistant cron becomes due", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const projectionStarted = createDeferred<void>();
    const projectionRelease = createDeferred<void>();
    const now = "2026-04-27T14:00:00.000Z";
    const reminderAt = "2026-04-27T14:00:01.000Z";
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:projection-assistant-deadline",
      id: "mailbox_item_system_mailbox_projection_assistant_deadline",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const deviceSyncPort = createEmptyDeviceSyncPort();
    let projectionCalls = 0;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(now));
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await upsertAutomation({
        automationId: "automation_01JQ8PWXP5A68SQM1W0GYM41WX",
        continuityPolicy: "fresh",
        instructions: "Send one projection deadline reminder.",
        now: new Date("2026-04-27T13:58:00.000Z"),
        route: {
          channel: "linq",
          deliveryTarget: "synthetic_direct_chat",
          identityId: null,
          participantId: null,
          threadId: "synthetic_direct_chat",
          threadIsDirect: true,
        },
        schedule: { at: reminderAt, kind: "at" },
        status: "active",
        title: "Synthetic projection deadline reminder",
        vaultRoot,
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-projection-assistant-deadline-before.bundle.json",
        vaultRoot,
      });

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_projection_assistant_deadline",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-projection-assistant-deadline.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            vaultSharePort: {
              async listActiveProjectionScopes() {
                return {
                  generationTokensByProjectionScopeKey: {
                    "profile-name.v0": "a".repeat(43),
                    "time-zone.v0": "b".repeat(43),
                  },
                  projectionKinds: [
                    "profile-name.v0" as const,
                    "time-zone.v0" as const,
                  ],
                  projectionScopes: [
                    { projectionKind: "profile-name.v0" as const },
                    { projectionKind: "time-zone.v0" as const },
                  ],
                };
              },
              async deliver() {
                projectionCalls += 1;
                if (projectionCalls === 1) {
                  projectionStarted.resolve();
                  await projectionRelease.promise;
                }
                return { status: "delivered" as const };
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: now,
                nextWakeReason: "device-sync.reconcile",
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox mode must hand off rather than execute assistant work.");
          },
          vaultRoot,
        },
      );

      await projectionStarted.promise;
      vi.setSystemTime(new Date(reminderAt));
      projectionRelease.resolve();
      const result = await resultPromise;

      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.nextWakeAt, reminderAt);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(projectionCalls, 1);
      expect(mocks.refreshHostedBrowserVaultReplicaFromRuntime).not.toHaveBeenCalled();
      const state = await readHostedSystemMailboxState(vaultRoot);
      const retained = state.pending.find((item) => item.itemId === deviceItem.id);
      assert.equal(retained?.status, "recording");
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "0",
      );
    } finally {
      projectionRelease.resolve();
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox caps an in-flight browser refresh at its assistant cron deadline", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const nowMs = Date.parse("2026-04-27T14:00:00.000Z");
    const reminderAt = new Date(nowMs + 25).toISOString();
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:browser-refresh-assistant-deadline",
      id: "mailbox_item_system_mailbox_browser_refresh_assistant_deadline",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const refreshImplementation =
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.getMockImplementation();

    mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(async (input) => {
      assert.equal(input.deadlineMs, Date.parse(reminderAt));
      vi.setSystemTime(new Date(reminderAt));
      return {
        source: { fileCount: 0, totalBytes: 0 },
        status: "deferred_timeout" as const,
      };
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(nowMs));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await upsertAutomation({
        automationId: "automation_01JQ8PWXP5A68SQM1W0GYM41WY",
        continuityPolicy: "fresh",
        instructions: "Send one browser refresh deadline reminder.",
        now: new Date("2026-04-27T13:58:00.000Z"),
        route: {
          channel: "linq",
          deliveryTarget: "synthetic_direct_chat",
          identityId: null,
          participantId: null,
          threadId: "synthetic_direct_chat",
          threadIsDirect: true,
        },
        schedule: { at: reminderAt, kind: "at" },
        status: "active",
        title: "Synthetic browser refresh deadline reminder",
        vaultRoot,
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-browser-refresh-assistant-deadline-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_browser_refresh_assistant_deadline",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-browser-refresh-assistant-deadline.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: new Date(nowMs).toISOString(),
                nextWakeReason: "device-sync.reconcile",
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox mode must hand off rather than execute assistant work.");
          },
          vaultRoot,
        },
      );

      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.nextWakeAt, reminderAt);
      assert.equal(result.nextWakeReason, "assistant");
      expect(mocks.refreshHostedBrowserVaultReplicaFromRuntime).toHaveBeenCalledTimes(1);
      const state = await readHostedSystemMailboxState(vaultRoot);
      const retained = state.pending.find((item) => item.itemId === deviceItem.id);
      assert.equal(retained?.status, "recording");
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "0",
      );
    } finally {
      const restoreRefreshImplementation =
        refreshImplementation
        ?? mocks.actualRefreshHostedBrowserVaultReplicaFromRuntime;
      if (restoreRefreshImplementation) {
        mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(
          restoreRefreshImplementation,
        );
      }
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not import initial conversation messages while cold bootstrap is deferred", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const imported: string[] = [];

    const conversationItem = createMailboxItem({
      id: "mailbox_item_entrypoint_deferred_image_only_001",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "1",
    });
    const systemItem = createMailboxItem({
      id: "mailbox_item_entrypoint_deferred_member_activated_001",
      kind: "member.activated",
      lane: "system",
      laneSeq: "1",
    });

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_deferred_cold_conversation_bootstrap",
            budget: {
              maxMailboxItems: 10,
            },
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Deferred bootstrap should not checkpoint unchanged mailbox state.");
          },
          async importItem(item) {
            imported.push(`${item.item.lane}:${item.item.kind}`);
            return {
              reasonCode: "bootstrap.deferred",
              status: "deferred",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [conversationItem, systemItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Deferred bootstrap should not run assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)), [
        ["system", "conversation"],
      ]);
      assert.deepEqual(imported, [
        "system:member.activated",
      ]);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(typeof result.nextWakeAt, "string");
      assert.deepEqual(result, {
        nextWakeAt: result.nextWakeAt,
        nextWakeReason: "mailbox",
        redactedStatus: {
          hostedMailboxBlockedCount: 2,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 2,
          hostedMailboxImportedCount: 0,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 2,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("stops before assistant runtime when cold bootstrap is deferred without conversation", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const imported: string[] = [];
    const systemItem = createMailboxItem({
      id: "mailbox_item_entrypoint_system_deferred_only_001",
      kind: "member.activated",
      lane: "system",
      laneSeq: "1",
    });

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_deferred_system_bootstrap_only",
            budget: {
              maxMailboxItems: 10,
            },
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Deferred system bootstrap should not checkpoint unchanged mailbox state.");
          },
          async importItem(item) {
            imported.push(`${item.item.lane}:${item.item.kind}`);
            return {
              reasonCode: "bootstrap.deferred",
              status: "deferred",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [systemItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Deferred system bootstrap should not run assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)), [
        ["system", "conversation"],
      ]);
      assert.deepEqual(imported, [
        "system:member.activated",
      ]);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(typeof result.nextWakeAt, "string");
      assert.deepEqual(result, {
        nextWakeAt: result.nextWakeAt,
        nextWakeReason: "mailbox",
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 0,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not resolve initial conversation payloads before cold bootstrap exists", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const imported: string[] = [];
    const conversationItem = createMailboxItem({
      id: "mailbox_item_entrypoint_unbootstrapped_image_only_001",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "1",
      payloadInlineCiphertext: null,
      payloadRef: "payload_ref_synthetic_conversation",
    });
    const baseMailboxPort = createMailboxPort({
      events,
      fetchRequests,
      items: [conversationItem],
    });
    const mailboxPort: HostedRuntimeMailboxPort = {
      ...baseMailboxPort,
      async fetchPayload() {
        events.push("mailbox.fetchPayload");
        throw new Error("Cold bootstrap should defer before conversation payload fetch.");
      },
    };

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_unbootstrapped_conversation_payload",
            budget: {
              maxMailboxItems: 10,
            },
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Unbootstrapped conversation deferral should not checkpoint.");
          },
          async importItem(item) {
            imported.push(`${item.item.lane}:${item.item.kind}`);
            throw new Error("Unbootstrapped conversation deferral should not import.");
          },
          platform: createPlatform({
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Unbootstrapped conversation deferral should not run assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)), [
        ["system", "conversation"],
      ]);
      assert.deepEqual(imported, []);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(typeof result.nextWakeAt, "string");
      assert.deepEqual(result, {
        nextWakeAt: result.nextWakeAt,
        nextWakeReason: "mailbox",
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 0,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoints dirty mailbox imports after the runtime idle window", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      events,
      workspace: createWorkspaceState({ version: "4" }),
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            assert.equal(snapshotInput.reason, "idle_shutdown");
            assert.equal(
              snapshotInput.redactedStatus?.hostedMailboxConversationImportedSeq,
              "1",
            );
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            events.push("mailbox.importItem");
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort,
          }),
          vaultRoot,
        },
      );

      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.attemptId, "attempt_synthetic_runtime_idle_checkpoint");
      assert.equal(checkpointRequests[0]?.expectedWorkspaceVersion, "4");
      assert.equal(checkpointRequests[0]?.leaseGeneration, "9");
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 1,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemHandledThroughSeq: "0",
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground stale assistant wake does not keep dirty runtime ahead of idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const staleWakeAt = "2026-04-26T23:59:59.000Z";

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_foreground_stale_assistant_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/foreground-stale-wake.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            deviceSyncPort,
            events,
            logRequests,
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [
                createMailboxItem({
                  id: "mailbox_item_foreground_stale_wake_001",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleWakeAt,
                nextWakeReason: "assistant",
                version: "4",
              }),
            }),
          }),
          vaultRoot,
        },
      );
      const assistantPass = logRequests
        .flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "assistant.pass_finished");

      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_foreground_stale_wake_001",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(assistantPass?.redactedJson?.deviceSyncSkipped, true);
      assert.equal(assistantPass?.redactedJson?.nextWakeAtPresent, false);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wakes reset the idle checkpoint window before checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const idleWakeImportContextMilestones: unknown[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_001",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let wakeQueued = false;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_wake",
            idleCheckpointDelayMs: 5,
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
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-wake.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item, context) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.id === "mailbox_item_entrypoint_002") {
              idleWakeImportContextMilestones.push(
                structuredClone(context?.latencyMilestones ?? null),
              );
            }
            if (!wakeQueued) {
              wakeQueued = true;
              setTimeout(() => {
                mailboxItems.push(createMailboxItem({
                  id: "mailbox_item_entrypoint_002",
                  laneSeq: "2",
                }));
                runtimeWakeSignal.notify();
              }, 0);
            }
            return { status: "imported" };
          },
          latencyMilestones: {
            phaseBreakdown: {
              schemaVersion: 1,
              orchestration: {
                freshStartInvocationAcceptedAtEpochMs: 1_776_999_999_990,
                freshStartRequestedAtEpochMs: 1_776_999_999_900,
              },
              dispatch: {
                invokeReceivedAtEpochMs: 1_777_000_000_000,
                containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
              },
              boot: { nodeStartupMs: 4321 },
            },
            runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          },
          platform: createPlatform({
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
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            return {
              progressed: false,
              redactedStatus: {},
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(readConversationImportedSeqs(fetchRequests), ["0", "1"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_001",
        "mailbox.importItem:mailbox_item_entrypoint_002",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "2",
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      expect(idleWakeImportContextMilestones).toEqual([
        expect.objectContaining({
          phaseBreakdown: expect.objectContaining({
            schemaVersion: 1,
            dispatch: {
              invokeReceivedAtEpochMs: 1_777_000_000_000,
              containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
            },
            boot: expect.objectContaining({
              nodeStartupMs: 4321,
              restoreWasCold: expect.any(Boolean),
            }),
            wake: expect.objectContaining({
              runtimeWakeNotifiedAtEpochMs: expect.any(Number),
              foregroundWaitResolvedAtEpochMs: expect.any(Number),
              foregroundImportStartedAtEpochMs: expect.any(Number),
            }),
          }),
          runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          runtimePhaseStartedAt: expect.any(String),
          workspaceRestoreDoneAt: expect.any(String),
        }),
      ]);
      expect(
        (idleWakeImportContextMilestones[0] as { phaseBreakdown?: Record<string, unknown> })
          .phaseBreakdown,
      ).not.toHaveProperty("orchestration");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("no-progress runtime wakes do not postpone the dirty idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 50;
    const wakeTimers: ReturnType<typeof setTimeout>[] = [];
    let wakeTimersStarted = false;
    let checkpointExpectationCountAtWakeStart = 0;
    const countCheckpointExpectations = () =>
      latencyTraceRequests.filter((request) =>
        request.event.type === "runtime_milestone"
        && request.event.milestone === "checkpoint_publication_expected_by"
      ).length;
    const startNoProgressWakes = () => {
      if (wakeTimersStarted) {
        return;
      }
      wakeTimersStarted = true;
      checkpointExpectationCountAtWakeStart = countCheckpointExpectations();
      for (const delayMs of [2, 8, 14, 20]) {
        wakeTimers.push(setTimeout(() => runtimeWakeSignal.notify(), delayMs));
      }
    };
    const clearWakeTimers = () => {
      while (wakeTimers.length > 0) {
        clearTimeout(wakeTimers.pop());
      }
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_no_progress_wakes",
            idleCheckpointDelayMs,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            clearWakeTimers();
            return {
              snapshotRef: createBundleRef({
                hash: "4".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-no-progress-wakes.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            startNoProgressWakes();
            return { status: "imported" };
          },
          platform: createPlatform({
            latencyTraceRequests,
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_no_progress_wake_001",
                  laneSeq: "1",
                }),
              ],
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

      assert.equal(
        countCheckpointExpectations() - checkpointExpectationCountAtWakeStart,
        1,
        "dirty import publishes one deadline and empty wake probes publish none",
      );
      assert.ok(fetchRequests.length > 1);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_no_progress_wake_001",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "1");
    } finally {
      clearWakeTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("dirty runtime wakes use projected wake state before the idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const staleWakeAt = "2000-04-27T00:05:00.000Z";
    const idleCheckpointDelayMs = 50;
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_projected_wake",
            idleCheckpointDelayMs,
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
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-projected-wake.bundle.json",
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
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleWakeAt,
                nextWakeReason: "assistant",
                version: "4",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            events.push("assistant.phase:start");
            assistantPhaseCalls += 1;
            events.push(
              `assistant.phase:${assistantPhaseCalls}:${input.workspace?.nextWakeAt ?? "none"}`,
            );
            if (input.workspace?.nextWakeAt === staleWakeAt) {
              if (assistantPhaseCalls === 1) {
                runtimeWakeSignal.notify();
              }
              return {
                checkpointReason: "canonical_runtime_commit",
                nextWakeAt: null,
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            }

            return {
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(result.status, "idle");
      assert.ok(fetchRequests.length > 1);
      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events
          .filter((event) => event.startsWith("assistant.phase:"))
          .filter((event) => event.includes(staleWakeAt)),
        [`assistant.phase:1:${staleWakeAt}`],
      );
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("projected runtime wakes use projected wake state before the idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const staleWakeAt = "2000-04-27T00:05:00.000Z";
    const projectedWakeAt = new Date(Date.now() + 15).toISOString();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_projected_runtime_wake",
            idleCheckpointDelayMs: 75,
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
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-projected-runtime-wake.bundle.json",
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
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleWakeAt,
                nextWakeReason: "assistant",
                version: "4",
              }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push(
              `assistant.phase:${assistantPhaseCalls}:${input.workspace?.nextWakeAt ?? "none"}`,
            );
            if (input.workspace?.nextWakeAt === staleWakeAt) {
              return {
                checkpointReason: "canonical_runtime_commit",
                nextWakeAt: projectedWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            }

            return {
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(result.status, "scheduled");
      assert.ok(fetchRequests.length > 1);
      assert.ok(assistantPhaseCalls > 1);
      assert.deepEqual(
        events
          .filter((event) => event.startsWith("assistant.phase:"))
          .filter((event) => event.includes(staleWakeAt)),
        [`assistant.phase:1:${staleWakeAt}`],
      );
      assert.ok(events.includes(`assistant.phase:2:${projectedWakeAt}`));
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, projectedWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.nextWakeAt, projectedWakeAt);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("source-blind runtime wakes cannot replay stale committed assistant wakes before checkpoint", async () => {
    const staleWakeAt = "2000-04-27T00:05:00.000Z";
    const cases: {
      name: string;
      initialWakeReason: "assistant" | null;
      nextWakeAt: string | null;
      nextWakeReason: "assistant" | null;
      status: "idle" | "scheduled";
      systemItemId: string | null;
    }[] = [
      {
        initialWakeReason: "assistant",
        name: "replacement",
        nextWakeAt: new Date(Date.now() + 60_000).toISOString(),
        nextWakeReason: "assistant",
        status: "scheduled",
        systemItemId: null,
      },
      {
        initialWakeReason: "assistant",
        name: "clear",
        nextWakeAt: null,
        nextWakeReason: null,
        status: "idle",
        systemItemId: "mailbox_item_entrypoint_source_blind_clear_system",
      },
      {
        initialWakeReason: null,
        name: "clear-null-reason",
        nextWakeAt: null,
        nextWakeReason: null,
        status: "idle",
        systemItemId: "mailbox_item_entrypoint_source_blind_null_reason_system",
      },
    ];

    for (const scenario of cases) {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
      const events: string[] = [];
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const fetchRequests: HostedMailboxFetchRequest[] = [];
      const mailboxItems: HostedMailboxItem[] = [];
      const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
      let assistantPhaseCalls = 0;

      try {
        await initializeVault({ createdAt: TEST_NOW, vaultRoot });
        const result = await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId:
                `attempt_synthetic_runtime_source_blind_dirty_${scenario.name}_wake`,
              idleCheckpointDelayMs: 50,
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
                  key:
                    "users/bundles/member-synthetic/"
                    + `runtime-source-blind-dirty-${scenario.name}-wake.bundle.json`,
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
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({
                  nextWakeAt: staleWakeAt,
                  nextWakeReason: scenario.initialWakeReason,
                  version: "4",
                }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              events.push(
                `assistant.phase:${assistantPhaseCalls}:${input.workspace?.nextWakeAt ?? "none"}`,
              );
              if (input.workspace?.nextWakeAt === staleWakeAt) {
                if (assistantPhaseCalls > 1) {
                  throw new Error("Stale committed assistant wake replayed before checkpoint.");
                }
                if (scenario.systemItemId) {
                  mailboxItems.push(createMailboxItem({
                    id: scenario.systemItemId,
                    kind: "member.channels.updated",
                    lane: "system",
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:01.000Z",
                  }));
                }
                setTimeout(() => runtimeWakeSignal.notify(), 0);
                return {
                  checkpointReason: "canonical_runtime_commit",
                  nextWakeAt: scenario.nextWakeAt,
                  nextWakeReason: scenario.nextWakeReason,
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantProgressed: true,
                  },
                };
              }

              return {
                progressed: false,
                redactedStatus: {
                  hostedAssistantProgressed: false,
                },
              };
            },
            vaultRoot,
          },
        );

        assert.equal(result.status, scenario.status);
        assert.ok(fetchRequests.length > 1);
        assert.ok(checkpointRequests.length >= 1);
        const assistantEvents = events.filter((event) =>
          event.startsWith("assistant.phase:")
        );
        assert.deepEqual(
          assistantEvents.filter((event) => event.includes(staleWakeAt)),
          [`assistant.phase:1:${staleWakeAt}`],
        );
        const expectsPostCheckpointPass = scenario.systemItemId !== null;
        assert.equal(assistantEvents.length, expectsPostCheckpointPass ? 2 : 1);
        if (expectsPostCheckpointPass) {
          assert.ok(
            requireEventIndex(events, "snapshot:idle_shutdown")
              < requireEventIndex(events, assistantEvents[1] ?? ""),
          );
        }
        if (scenario.nextWakeAt && expectsPostCheckpointPass) {
          assert.equal(assistantEvents[1], `assistant.phase:2:${scenario.nextWakeAt}`);
        }
        assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
        assert.equal(checkpointRequests[0]?.nextWakeAt, scenario.nextWakeAt);
        assert.equal(checkpointRequests[0]?.nextWakeReason, scenario.nextWakeReason);
        assert.equal(result.nextWakeAt, scenario.nextWakeAt);
        if (scenario.systemItemId) {
          const systemImportEvent = `mailbox.importItem:${scenario.systemItemId}`;
          assert.ok(events.includes(systemImportEvent), events.join(","));
          assert.ok(
            requireEventIndex(events, "snapshot:idle_shutdown")
              < requireEventIndex(events, systemImportEvent),
          );
        } else {
          assert.equal(checkpointRequests.length, 1);
        }
      } finally {
        await removeTempRoot(vaultRoot);
      }
    }
  });

  // === COLLAPSE INVARIANT SUITE (assert observable behavior only) ===

  });
