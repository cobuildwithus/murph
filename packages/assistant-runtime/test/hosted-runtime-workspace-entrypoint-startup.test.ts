import {
  HOSTED_CONTAINER_CA_ENV_KEYS,
  HOSTED_UNSTABLE_PROCESS_ENV_KEYS,
  TEST_NOW,
  TEST_USER_ID,
  createAssistantAskRequestedWake,
  createAssistantProviderUsageDraft,
  createBundleRef,
  createDeferred,
  createMailboxItem,
  createMailboxPort,
  createOpenAiProbeCertificateFiles,
  createPlatform,
  createResolvedAssistantAskSystemMailboxItem,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceSnapshotV2Ref,
  createWorkspaceState,
  ensureHostedBootstrapMetadataForSystemMailboxTest,
  importRuntimeControlSystemMailboxItemForTest,
  mocks,
  readCapturedRuntimePhaseLogs,
  removeTempRoot,
  requireEventIndex,
  runOpenAiHttpsProbe,
  stageAssistantInputEventForMailboxItem,
  startOpenAiProbeServer,
  waitUntil,
  withRealTimeout,
  writeMailboxImportStateFile,
  writeSyntheticAssistantAutoReplyTerminalEvidence,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

import type {
  OpenAiHttpsProbeResult,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

import assert from "node:assert/strict";
import { access, appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
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
  drainHostedRuntimeLogWritesBestEffort,
} from "../src/hosted-runtime/runtime-logs.ts";
import {
  createHostedAssistantTurnEnvironment,
  normalizeHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/environment.ts";
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
  enqueueHostedSystemMailboxItem,
} from "../src/hosted-runtime/system-mailbox.ts";
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

describe("hosted workspace runtime entrypoint", () => {
  test("records one terminal event after an empty system-mailbox invocation", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const logRequests: HostedRuntimeLogRequest[] = [];
    const attemptId = "attempt_synthetic_empty_system_mailbox_finished";

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await writeMailboxImportStateFile(
        vaultRoot,
        createEmptyHostedMailboxImportState(),
      );
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId,
            leaseGeneration: "7",
            processingMode: "system_mailbox",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/empty-system-mailbox.bundle.json",
                size: 128,
              }),
            };
          },
          async importItem() {
            throw new Error("An empty system-mailbox invocation must not import an item.");
          },
          platform: createPlatform({
            logRequests,
            mailboxPort: createMailboxPort({ events: [], items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events: [],
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("An empty system-mailbox invocation must not run the assistant.");
          },
          vaultRoot,
        },
      );
      await drainHostedRuntimeLogWritesBestEffort();

      assert.equal(result.status, "idle");
      const entries = logRequests.flatMap((request) => request.entries);
      const imported = entries.filter((entry) =>
        entry.attemptId === attemptId
        && entry.eventCode === "mailbox.imported"
      );
      assert.equal(imported.length, 1);
      assert.equal(imported[0]?.redactedJson?.fetchedCount, 0);
      assert.equal(imported[0]?.redactedJson?.importedCount, 0);
      assert.equal(imported[0]?.redactedJson?.stateChanged, false);
      assert.deepEqual(
        entries.filter((entry) =>
          entry.attemptId === attemptId
          && entry.eventCode === "runtime.invocation_finished"
        ).map((entry) => entry.redactedJson),
        [{ processingMode: "system_mailbox" }],
      );
    } finally {
      await drainHostedRuntimeLogWritesBestEffort();
      await removeTempRoot(vaultRoot);
    }
  });

  test("rejects a blocked runtime when the host signal aborts", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("host request aborted");
    const workspaceReadStarted = createDeferred<void>();
    const workspaceReadRelease = createDeferred<HostedWorkspaceReadResponse>();
    const logRequests: HostedRuntimeLogRequest[] = [];
    const attemptId = "attempt_synthetic_host_abort";
    const resultPromise = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: {
        attemptId,
        leaseGeneration: "7",
        userId: TEST_USER_ID,
        workspaceVersion: "0",
      },
    }), {
      async createCheckpointSnapshot() {
        throw new Error("Host abort test should not checkpoint.");
      },
      async importItem() {
        throw new Error("Host abort test should not import mailbox items.");
      },
      platform: createPlatform({
        logRequests,
        mailboxPort: createMailboxPort({ events: [], items: [] }),
        workspacePort: {
          async read() {
            workspaceReadStarted.resolve();
            return await workspaceReadRelease.promise;
          },
          async checkpoint() {
            throw new Error("Host abort test should not checkpoint workspace.");
          },
        },
      }),
      signal: hostAbortController.signal,
      vaultRoot,
    }).catch((error: unknown) => error);

    try {
      await workspaceReadStarted.promise;
      hostAbortController.abort(hostAbortReason);

      const timeout = new Error("Timed out waiting for host abort propagation.");
      const outcome = await Promise.race([
        resultPromise,
        new Promise<unknown>((resolve) => setTimeout(() => resolve(timeout), 250)),
      ]);
      assert.equal(outcome, hostAbortReason);
      await drainHostedRuntimeLogWritesBestEffort();
      assert.equal(
        logRequests.flatMap((request) => request.entries).some((entry) =>
          entry.attemptId === attemptId
          && entry.eventCode === "runtime.invocation_finished"
        ),
        false,
      );
    } finally {
      workspaceReadRelease.resolve({
        fetchedAt: TEST_NOW,
        workspace: createWorkspaceState({ version: "0" }),
      });
      await resultPromise.catch(() => undefined);
      await drainHostedRuntimeLogWritesBestEffort();
      await removeTempRoot(vaultRoot);
    }
  });

  test("links host abort into active idle-checkpoint construction", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("host aborted during checkpoint construction");
    const snapshotStarted = createDeferred<void>();
    const snapshotAborted = createDeferred<unknown>();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_host_abort_during_checkpoint",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(_snapshotInput, context) {
            const signal = context?.signal;
            assert.ok(signal, "Checkpoint construction must receive a linked abort signal.");
            snapshotStarted.resolve();
            return await new Promise<never>((_resolve, reject) => {
              const rejectForAbort = () => {
                snapshotAborted.resolve(signal.reason);
                reject(signal.reason);
              };
              if (signal.aborted) {
                rejectForAbort();
                return;
              }
              signal.addEventListener("abort", rejectForAbort, { once: true });
            });
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events: [],
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events: [],
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              progressed: true,
            };
          },
          signal: hostAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        snapshotStarted.promise,
        10_000,
        () => "Idle checkpoint construction did not start.",
      );
      hostAbortController.abort(hostAbortReason);

      assert.equal(
        await withRealTimeout(
          snapshotAborted.promise,
          10_000,
          () => "Host abort did not reach checkpoint construction.",
        ),
        hostAbortReason,
      );
      assert.equal(await resultPromise.catch((error: unknown) => error), hostAbortReason);
      assert.equal(checkpointRequests.length, 0);
    } finally {
      hostAbortController.abort(hostAbortReason);
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("keeps runner ownership until an aborted initial mailbox import settles", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("host request aborted during mailbox import");
    const importStarted = createDeferred<void>();
    const importRelease = createDeferred<void>();
    let settled = false;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_host_abort_during_mailbox_import",
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Aborted mailbox import should not checkpoint.");
          },
          async importItem() {
            importStarted.resolve();
            await importRelease.promise;
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events: [],
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events: [],
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          signal: hostAbortController.signal,
          vaultRoot,
        },
      );
      void resultPromise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await importStarted.promise;
      hostAbortController.abort(hostAbortReason);
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(settled, false);

      importRelease.resolve();
      await assert.rejects(resultPromise, (error) => error === hostAbortReason);
      assert.equal(settled, true);
    } finally {
      importRelease.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("preserves the host abort reason when an awaited local mutation rejects", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("host request aborted during mailbox import");
    const importFailure = new Error("mailbox import failed after host abort");
    const importStarted = createDeferred<void>();
    const importRelease = createDeferred<void>();
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_host_abort_before_mailbox_import_failure",
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Aborted mailbox import should not checkpoint.");
          },
          async importItem() {
            importStarted.resolve();
            await importRelease.promise;
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events: [],
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events: [],
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          signal: hostAbortController.signal,
          vaultRoot,
        },
      );

      await importStarted.promise;
      hostAbortController.abort(hostAbortReason);
      importRelease.reject(importFailure);

      await assert.rejects(resultPromise, (error) => error === hostAbortReason);
    } finally {
      importRelease.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("keeps runner ownership until aborted Codex config preparation settles", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("host request aborted during Codex config prep");
    const prepareStarted = createDeferred<void>();
    const prepareRelease = createDeferred<void>();
    const prepareHostedCodexRuntimeEnvironmentImpl =
      mocks.prepareHostedCodexRuntimeEnvironment.getMockImplementation();
    let settled = false;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    assert.ok(prepareHostedCodexRuntimeEnvironmentImpl);
    mocks.prepareHostedCodexRuntimeEnvironment.mockImplementationOnce(async (input) => {
      prepareStarted.resolve();
      await prepareRelease.promise;
      return await prepareHostedCodexRuntimeEnvironmentImpl(input);
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_host_abort_during_codex_prepare",
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Aborted Codex preparation should not checkpoint.");
          },
          async importItem() {
            throw new Error("Aborted Codex preparation should not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events: [], items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events: [],
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          signal: hostAbortController.signal,
          vaultRoot,
        },
      );
      void resultPromise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await prepareStarted.promise;
      hostAbortController.abort(hostAbortReason);
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(settled, false);

      prepareRelease.resolve();
      await assert.rejects(resultPromise, (error) => error === hostAbortReason);
      assert.equal(settled, true);
    } finally {
      prepareRelease.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not prepare Codex before a replyable conversation is staged", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const snapshotRef = createWorkspaceSnapshotV2Ref(
      "snapshot-codex-preinitialization-early-return",
    );
    const sidecarItem = createMailboxItem({
      id: "mailbox_item_codex_preinitialization_early_return",
      laneSeq: "1",
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:codex-preinitialization-early-return",
    });
    const baseMailboxPort = createMailboxPort({
      events,
      items: [sidecarItem],
    });
    mocks.prepareHostedCodexAssistantProcess.mockClear();
    mocks.cancelPendingWarmCodexPreinitialization.mockClear();

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          forwardedEnv: {
            HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
            HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
            HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
          },
          request: {
            attemptId: "attempt_synthetic_codex_preinitialization_overlap",
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Retry-only mailbox scheduling should not checkpoint.");
          },
          async importItem() {
            throw new Error("Unavailable mailbox payload should not import.");
          },
          platform: createPlatform({
            mailboxPort: {
              ...baseMailboxPort,
              async fetchPayload(): Promise<HostedMailboxPayloadFetchResponse> {
                events.push("mailbox.fetchPayload");
                return {
                  fetchedAt: TEST_NOW,
                  payload: null,
                  unavailable: {
                    code: "not_found",
                    retryable: true,
                  },
                };
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef,
                version: "0",
              }),
            }),
            workspaceSnapshotPort: {
              async abortSnapshotSession() {
                throw new Error("Early-return test should not abort snapshots.");
              },
              async completeSnapshotSession() {
                throw new Error("Early-return test should not complete snapshots.");
              },
              async putSnapshotObjectDirect() {
                throw new Error("Early-return test should not upload snapshots.");
              },
              async restoreWorkspaceSnapshot(input) {
                await initializeVault({
                  createdAt: TEST_NOW,
                  vaultRoot: input.durableRoot,
                });
              },
              async startSnapshotSession() {
                throw new Error("Early-return test should not start snapshots.");
              },
            },
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(checkpointRequests, []);
      assert.equal(
        mocks.prepareHostedCodexAssistantProcess.mock.calls.length,
        0,
      );
      assert.equal(mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length, 0);
      assert.ok(events.includes("mailbox.fetchPayload"));
      assert.ok(!events.includes("codex.preinitialize"));
      assert.ok(!events.includes("codex.workspace-boundary"));
      assert.equal(result.status, "scheduled");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("joins staged Codex preparation before the workspace snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const snapshotRef = createWorkspaceSnapshotV2Ref(
      "snapshot-codex-preinitialization-snapshot-join",
    );
    const conversationItem = createMailboxItem({
      id: "mailbox_item_codex_preinitialization_snapshot_join",
      laneSeq: "1",
    });
    const preparationStarted = createDeferred<void>();
    const preparationRelease = createDeferred<void>();
    const mailboxProjectionFinished = createDeferred<void>();
    const prepareHostedCodexRuntimeEnvironmentImpl =
      mocks.prepareHostedCodexRuntimeEnvironment.getMockImplementation();
    let preparedRuntimeEnv: Readonly<Record<string, string>> | null = null;
    let preparedOperatorHomeRoot: string | null = null;
    let assistantInputId: string | null = null;
    let conversationInputStaged = false;
    let snapshotStarted = false;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    assert.ok(prepareHostedCodexRuntimeEnvironmentImpl);
    mocks.prepareHostedCodexRuntimeEnvironment.mockImplementationOnce(async (input) => {
      const prepared = await prepareHostedCodexRuntimeEnvironmentImpl(input);
      preparedOperatorHomeRoot = input.operatorHomeRoot;
      preparedRuntimeEnv = prepared.runtimeEnv;
      return prepared;
    });
    mocks.prepareHostedCodexAssistantProcess.mockClear();
    mocks.cancelPendingWarmCodexPreinitialization.mockClear();
    mocks.prepareHostedCodexAssistantProcess.mockImplementationOnce(async () => {
      events.push("codex.preinitialize.start");
      preparationStarted.resolve();
      await preparationRelease.promise;
      events.push("codex.preinitialize.admitted");
      return {
        cancelPending: async () => {
          events.push("codex.preinitialize.cancel");
          await mocks.cancelPendingWarmCodexPreinitialization();
        },
      };
    });

    try {
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_codex_preinitialization_snapshot_join",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            snapshotStarted = true;
            events.push("snapshot");
            return {
              snapshotRef: createBundleRef({
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/codex-preinitialization-snapshot-join.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            assistantInputId ??= await stageAssistantInputEventForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            if (!conversationInputStaged) {
              conversationInputStaged = true;
              events.push("mailbox.staged");
              assert.ok(context?.onConversationInputStaged);
              context.onConversationInputStaged("linq");
              await preparationStarted.promise;
              events.push("mailbox.projection.done");
              mailboxProjectionFinished.resolve();
            }
            return {
              assistantInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [conversationItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef,
                version: "0",
              }),
            }),
            workspaceSnapshotPort: {
              async abortSnapshotSession() {
                throw new Error("Snapshot-join test should not abort snapshots.");
              },
              async completeSnapshotSession() {
                throw new Error("Snapshot-join test should not complete snapshot sessions.");
              },
              async putSnapshotObjectDirect() {
                throw new Error("Snapshot-join test should not upload snapshot objects directly.");
              },
              async restoreWorkspaceSnapshot(input) {
                await initializeVault({
                  createdAt: TEST_NOW,
                  vaultRoot: input.durableRoot,
                });
              },
              async startSnapshotSession() {
                throw new Error("Snapshot-join test should not start snapshot sessions.");
              },
            },
          }),
          async runAssistantPhase(input) {
            events.push("assistant.foreground");
            assert.ok(assistantInputId);
            assert.deepEqual(
              input.initialAssistantInputBatch?.assistantInputIds
                ?? input.initialMailboxImport.importResult.assistantInputIds,
              [assistantInputId],
            );
            await writeSyntheticAssistantAutoReplyTerminalEvidence({
              inputId: assistantInputId,
              vaultRoot,
            });
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      await withRealTimeout(
        mailboxProjectionFinished.promise,
        15_000,
        () => events.join(","),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(snapshotStarted, false);

      preparationRelease.resolve();
      const result = await withRealTimeout(
        resultPromise,
        15_000,
        () => events.join(","),
      );
      const preparationInput =
        mocks.prepareHostedCodexAssistantProcess.mock.calls.at(-1)?.[0];
      assert.ok(preparationInput);
      assert.ok(preparedOperatorHomeRoot);
      assert.ok(preparedRuntimeEnv);
      assert.deepEqual(
        preparationInput.env,
        createHostedAssistantTurnEnvironment({
          operatorHomeRoot: preparedOperatorHomeRoot,
          runtimeEnv: preparedRuntimeEnv,
          vaultRoot,
        }).env,
      );
      assert.equal(preparationInput.workingDirectory, vaultRoot);
      assert.equal(preparationInput.signal?.aborted, false);
      assert.ok(
        events.indexOf("mailbox.staged")
          < events.indexOf("codex.preinitialize.start"),
      );
      assert.ok(
        events.indexOf("codex.preinitialize.start")
          < events.indexOf("mailbox.projection.done"),
      );
      assert.ok(
        events.indexOf("codex.preinitialize.cancel")
          < events.indexOf("snapshot"),
      );
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 1);
      assert.equal(
        mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length,
        1,
      );
      assert.equal(result.status, "idle");
    } finally {
      preparationRelease.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("falls back to foreground startup when Codex preparation rejects before admission", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const preparationFailure = new Error("Synthetic Codex preparation failure.");
    const snapshotRef = createWorkspaceSnapshotV2Ref(
      "snapshot-codex-preinitialization-fallback",
    );
    const conversationItem = createMailboxItem({
      id: "mailbox_item_codex_preinitialization_fallback",
      laneSeq: "1",
    });
    const preparationAttempted = createDeferred<void>();
    let assistantInputId: string | null = null;
    let assistantPhaseCalls = 0;

    mocks.prepareHostedCodexAssistantProcess.mockClear();
    mocks.cancelPendingWarmCodexPreinitialization.mockClear();
    mocks.prepareHostedCodexAssistantProcess.mockImplementationOnce(async () => {
      events.push("codex.preinitialize.reject");
      preparationAttempted.resolve();
      throw preparationFailure;
    });

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_codex_preinitialization_fallback",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            events.push("snapshot");
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/codex-preinitialization-fallback.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            events.push("mailbox.import");
            assistantInputId = await stageAssistantInputEventForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            assert.ok(context?.onConversationInputStaged);
            context.onConversationInputStaged("linq");
            await withRealTimeout(
              preparationAttempted.promise,
              15_000,
              () => events.join(","),
            );
            events.push("mailbox.projection.done");
            return {
              assistantInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [conversationItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef,
                version: "0",
              }),
            }),
            workspaceSnapshotPort: {
              async abortSnapshotSession() {
                throw new Error("Fallback test should not abort snapshots.");
              },
              async completeSnapshotSession() {
                throw new Error("Fallback test should not complete snapshot sessions.");
              },
              async putSnapshotObjectDirect() {
                throw new Error("Fallback test should not upload snapshot objects directly.");
              },
              async restoreWorkspaceSnapshot(input) {
                await initializeVault({
                  createdAt: TEST_NOW,
                  vaultRoot: input.durableRoot,
                });
              },
              async startSnapshotSession() {
                throw new Error("Fallback test should not start snapshot sessions.");
              },
            },
          }),
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push("assistant.foreground");
            assert.ok(assistantInputId);
            assert.deepEqual(
              input.initialAssistantInputBatch?.assistantInputIds
                ?? input.initialMailboxImport.importResult.assistantInputIds,
              [assistantInputId],
            );
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 1);
      assert.ok(
        events.indexOf("mailbox.import")
          < events.indexOf("codex.preinitialize.reject"),
      );
      assert.ok(
        events.indexOf("codex.preinitialize.reject")
          < events.indexOf("mailbox.projection.done"),
      );
      assert.ok(
        events.indexOf("mailbox.projection.done")
          < events.indexOf("assistant.foreground"),
      );
      assert.equal(assistantPhaseCalls, 1);
      assert.equal(
        mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length,
        0,
      );
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    {
      expectedCriticalPath: false,
      name: "a conversation import without a fresh assistant input",
      outcome: "imported_without_input",
    },
    {
      expectedCriticalPath: false,
      name: "retryable blocked conversation work",
      outcome: "retryable_blocked",
    },
    {
      expectedCriticalPath: true,
      name: "a fresh assistant input",
      outcome: "fresh_input",
    },
  ] as const)("admits provider-start timing only for $name", async (scenario) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-provider-start-timing-admission-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const conversationItem = createMailboxItem({
      id: `mailbox_item_provider_start_timing_${scenario.outcome}`,
      laneSeq: "1",
    });
    const observedCriticalPathPresence: boolean[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await stageAssistantInputEventForMailboxItem({
        item: createMailboxItem({
          id: `mailbox_item_provider_start_timing_background_${scenario.outcome}`,
          laneSeq: "99",
          occurredAt: "2026-04-26T23:59:59.000Z",
        }),
        threadId: `thread_provider_start_timing_background_${scenario.outcome}`,
        vaultRoot,
      });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: `attempt_provider_start_timing_${scenario.outcome}`,
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "5".repeat(64),
                key: `users/bundles/member-synthetic/provider-start-timing-${scenario.outcome}.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem(item) {
            if (scenario.outcome === "retryable_blocked") {
              return {
                reasonCode: "synthetic_retryable_conversation_import",
                retryable: true,
                status: "blocked" as const,
              };
            }
            if (scenario.outcome === "fresh_input") {
              return {
                assistantInputId: await stageAssistantInputEventForMailboxItem({
                  item: item.item,
                  threadId: "thread_provider_start_timing_fresh",
                  vaultRoot,
                }),
                status: "imported" as const,
              };
            }
            return { status: "imported" as const };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [conversationItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            if (input.providerStartCriticalPath) {
              assert.equal(
                typeof input.providerStartCriticalPath
                  .foregroundPassStartedAtMonotonicMs,
                "number",
              );
              assert.equal(
                typeof input.providerStartCriticalPath
                  .workspaceForegroundPassStartedAtMonotonicMs,
                "number",
              );
              assert.equal(
                typeof input.providerStartCriticalPath
                  .assistantPhaseCallbackStartedAtMonotonicMs,
                "number",
              );
            }
            observedCriticalPathPresence.push(
              input.providerStartCriticalPath !== null
                && input.providerStartCriticalPath !== undefined,
            );
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      assert.ok(observedCriticalPathPresence.length > 0);
      assert.equal(
        observedCriticalPathPresence[0],
        scenario.expectedCriticalPath,
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("lets the first staged email veto later generic preparation", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let assistantPhaseCalls = 0;

    mocks.prepareHostedCodexAssistantProcess.mockClear();
    mocks.cancelPendingWarmCodexPreinitialization.mockClear();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_email_first_preinitialization_veto",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            events.push("snapshot");
            return {
              snapshotRef: createBundleRef({
                hash: "6".repeat(64),
                key: "users/bundles/member-synthetic/email-first-preinitialization-veto.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            const assistantInputId = await stageAssistantInputEventForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            const channel = item.item.laneSeq === "1" ? "email" : "linq";
            events.push(`mailbox.staged:${channel}`);
            context?.onConversationInputStaged?.(channel);
            return {
              assistantInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_email_first_preinitialization_veto",
                  laneSeq: "1",
                }),
                createMailboxItem({
                  id: "mailbox_item_linq_second_preinitialization_veto",
                  laneSeq: "2",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            const inputIds =
              input.initialAssistantInputBatch?.assistantInputIds
              ?? input.initialMailboxImport.importResult.assistantInputIds
              ?? [];
            assert.ok(inputIds.length > 0);
            for (const inputId of inputIds) {
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId,
                vaultRoot,
              });
            }
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.staged:")),
        ["mailbox.staged:email", "mailbox.staged:linq"],
      );
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(
        mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length,
        0,
      );
      assert.ok(assistantPhaseCalls >= 1);
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("keeps runner ownership until aborted foreground mailbox projection settles", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("host request aborted during foreground projection");
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const projectionStarted = createDeferred<void>();
    const projectionRelease = createDeferred<void>();
    const mailboxItems: HostedMailboxItem[] = [];
    let assistantPhaseCalls = 0;
    let settled = false;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_host_abort_during_foreground_projection",
            idleCheckpointDelayMs: 180_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Aborted foreground projection should not checkpoint.");
          },
          async importItem(item) {
            if (item.item.lane !== "conversation") {
              return { status: "imported" };
            }

            projectionStarted.resolve();
            await projectionRelease.promise;
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events: [],
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events: [],
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls === 1) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_host_abort_foreground_projection",
                laneSeq: "1",
                occurredAt: "2026-04-27T00:00:01.000Z",
              }));
              runtimeWakeSignal.notify();
              await projectionStarted.promise;
              hostAbortController.abort(hostAbortReason);
            }
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              progressed: true,
            };
          },
          signal: hostAbortController.signal,
          vaultRoot,
        },
      );
      void resultPromise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await projectionStarted.promise;
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(settled, false);

      projectionRelease.resolve();
      await assert.rejects(resultPromise, (error) => error === hostAbortReason);
      assert.equal(settled, true);
    } finally {
      projectionRelease.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("keeps foreground authority while a detached ask runs and drains it before shutdown snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const askStarted = createDeferred<void>();
    const childExitRelease = createDeferred<void>();
    const foregroundStarted = createDeferred<void>();
    const foregroundRelease = createDeferred<void>();
    const shutdownController = new AbortController();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
    let snapshotStarted = false;

    mocks.executeReadOnlyAssistantAsk.mockImplementationOnce(async (askInput) => {
      events.push("ask.started");
      askInput.onProviderUsage?.({
        stage: "answer",
        usage: createAssistantProviderUsageDraft({
          providerRequestOutcome: "aborted",
        }),
      });
      askStarted.resolve();
      return await new Promise((_resolve, reject) => {
        const abort = async () => {
          events.push("ask.aborted");
          await childExitRelease.promise;
          events.push("ask.exited");
          reject(askInput.abortSignal?.reason);
        };
        if (askInput.abortSignal?.aborted) {
          void abort();
          return;
        }
        askInput.abortSignal?.addEventListener("abort", () => void abort(), { once: true });
      });
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const askItem = createMailboxItem({
        dedupeKey: "ask_event_entrypoint_concurrent",
        id: "mailbox_item_entrypoint_concurrent_ask",
        kind: "assistant.ask.requested",
        lane: "system",
        laneSeq: "1",
      });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_detached_ask_concurrency",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            snapshotStarted = true;
            events.push("snapshot.started");
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/detached-ask-concurrency.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            assert.equal(item.route.action, "run-assistant-ask");
            return await enqueueHostedSystemMailboxItem({
              item,
              vaultRoot,
              wake: createAssistantAskRequestedWake({
                eventId: askItem.dedupeKey,
              }),
            });
          },
          platform: {
            ...createPlatform({
              assistantAskPort: {
                async request(request) {
                  if (request.action === "complete") {
                    events.push("ask.completed");
                    return { action: "complete", status: "completed" };
                  }
                  events.push("ask.prepared");
                  return {
                    action: "prepare",
                    question: "What is today's group workout?",
                    status: "ready",
                    targetLabel: "100 Club",
                  };
                },
              },
              mailboxPort: createMailboxPort({ events, items: [askItem] }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            usageRecordPort: {
              async recordUsage(record) {
                events.push("usage.record");
                return { platformAiUsageAllowedAfter: true, recorded: true, usageId: record.usageId };
              },
            },
          },
          async runAssistantPhase() {
            events.push("foreground.started");
            foregroundStarted.resolve();
            await foregroundRelease.promise;
            events.push("foreground.finished");
            shutdownController.abort(new Error("Synthetic shutdown after foreground reply."));
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      await Promise.all([askStarted.promise, foregroundStarted.promise]);
      assert.equal(snapshotStarted, false);
      foregroundRelease.resolve();
      await waitUntil(() => assert.ok(events.includes("ask.aborted")));
      assert.equal(events.includes("foreground.finished"), true);
      assert.equal(snapshotStarted, false);

      childExitRelease.resolve();
      const result = await withRealTimeout(resultPromise, 30_000, () => events.join(","));
      assert.ok(
        requireEventIndex(events, "foreground.finished")
          < requireEventIndex(events, "ask.aborted"),
      );
      assert.ok(
        requireEventIndex(events, "ask.exited")
          < requireEventIndex(events, "snapshot.started"),
      );
      assert.ok(
        requireEventIndex(events, "workspace.checkpoint")
          < requireEventIndex(events, "usage.record"),
      );
      assert.equal(result.status, "scheduled");
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => [
          item.itemId,
          item.status,
        ]),
        [[askItem.id, "pending"]],
      );
    } finally {
      foregroundRelease.resolve();
      childExitRelease.resolve();
      shutdownController.abort(new Error("Test cleanup."));
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  }, 45_000);

  test("lets an approved joined-group detached ask settle beside live foreground input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const firstAskStarted = createDeferred<void>();
    const firstAskRelease = createDeferred<void>();
    const foregroundStarted = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems = [
      createMailboxItem({
        dedupeKey: "ask_event_entrypoint_approved_foreground_first",
        id: "mailbox_item_entrypoint_approved_foreground_first",
        kind: "assistant.ask.requested",
        lane: "system",
        laneSeq: "1",
      }),
      createMailboxItem({
        dedupeKey: "ask_event_entrypoint_approved_foreground_second",
        id: "mailbox_item_entrypoint_approved_foreground_second",
        kind: "assistant.ask.requested",
        lane: "system",
        laneSeq: "2",
      }),
    ];
    const conversationItem = createMailboxItem({
      id: "mailbox_item_entrypoint_approved_foreground_conversation",
      lane: "conversation",
      laneSeq: "1",
      occurredAt: "2026-04-27T00:00:01.000Z",
    });
    let firstAskAbortObserved = false;
    let conversationAssistantInputId: string | null = null;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    mocks.executeReadOnlyAssistantAsk
      .mockImplementationOnce(async (askInput) => {
        events.push("ask.first.started");
        firstAskStarted.resolve();
        askInput.abortSignal?.addEventListener("abort", () => {
          firstAskAbortObserved = true;
          events.push("ask.first.aborted");
        }, { once: true });
        await firstAskRelease.promise;
        assert.equal(firstAskAbortObserved, false);
        events.push("ask.first.settled");
        return { answer: "Synthetic first answer.", outcome: "answered" };
      })
      .mockImplementationOnce(async () => {
        events.push("ask.second.started");
        return { answer: "Synthetic second answer.", outcome: "answered" };
      });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_approved_ask_foreground",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            events.push("snapshot.started");
            return {
              snapshotRef: createBundleRef({
                hash: "5".repeat(64),
                key: "users/bundles/member-synthetic/approved-ask-foreground.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            if (item.route.action === "run-assistant-ask") {
              return await enqueueHostedSystemMailboxItem({
                item,
                vaultRoot,
                wake: createAssistantAskRequestedWake({
                  eventId: item.item.dedupeKey,
                }),
              });
            }
            assert.equal(item.item.id, conversationItem.id);
            context?.onConversationInputStaged?.("linq");
            conversationAssistantInputId = await stageAssistantInputEventForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            events.push("conversation.imported");
            return {
              assistantInputId: conversationAssistantInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            assistantAskPort: {
              async request(request) {
                if (request.action === "complete") {
                  events.push(`ask.complete:${request.requestId}`);
                  if (
                    request.requestId
                      === "ask_event_entrypoint_approved_foreground_second"
                  ) {
                    shutdownController.abort(
                      new Error("Stop after approved foreground ask proof."),
                    );
                  }
                  return { action: "complete", status: "completed" };
                }
                events.push(`ask.prepare:${request.requestId}`);
                return {
                  action: "prepare",
                  question: "What is today's group workout?",
                  status: "ready",
                  targetLabel: "100 Club",
                };
              },
            },
            mailboxPort: createMailboxPort({ events, items: mailboxItems }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            if (!conversationAssistantInputId) {
              events.push("foreground.empty");
              return { progressed: false };
            }
            events.push("foreground.started");
            input.latestAssistantInputBatch?.();
            foregroundStarted.resolve();
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        firstAskStarted.promise,
        30_000,
        () => events.join(","),
      );
      mailboxItems.push(conversationItem);
      runtimeWakeSignal.notify();
      await withRealTimeout(
        foregroundStarted.promise,
        30_000,
        () => events.join(","),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(firstAskAbortObserved, false);

      firstAskRelease.resolve();
      const result = await withRealTimeout(
        resultPromise,
        30_000,
        () => events.join(","),
      );
      assert.ok(
        requireEventIndex(events, "foreground.started")
          < requireEventIndex(events, "ask.first.settled"),
      );
      assert.ok(
        requireEventIndex(events, "ask.complete:ask_event_entrypoint_approved_foreground_first")
          < requireEventIndex(events, "ask.prepare:ask_event_entrypoint_approved_foreground_second"),
      );
      assert.equal(firstAskAbortObserved, false);
      assert.ok(result.status === "idle" || result.status === "scheduled");
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending,
        [],
      );
    } finally {
      firstAskRelease.resolve();
      shutdownController.abort(new Error("Test cleanup."));
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  }, 45_000);

  test("starts a detached model before lazily reading the Web-owned shared snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const snapshotRef = createWorkspaceSnapshotV2Ref(
      "snapshot-detached-share-regrant",
    );
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    let assistantPhaseCalls = 0;
    let restoreCallCount = 0;

    try {
      const askItem = createMailboxItem({
        dedupeKey: "ask_event_entrypoint_share_regrant",
        id: "mailbox_item_entrypoint_share_regrant",
        kind: "assistant.ask.requested",
        lane: "system",
        laneSeq: "1",
      });
      mocks.executeReadOnlyAssistantAsk.mockImplementationOnce(async (askInput) => {
        events.push("ask.model.started");
        assert.equal(events.includes("share.snapshot.read"), false);
        const shared = await askInput.groupSharedReader?.request({
          projectionScopes: [{ projectionKind: "steps-days.v0" }],
        });
        assert.deepEqual(shared, {
          members: [{
            currentTurnHandles: [],
            displayName: null,
            memberId: "member_shared_regrant",
            participantId: "participant_shared_regrant",
            projections: [{
              dataStatus: "missing",
              grantStatus: "granted",
              projectionScope: { projectionKind: "steps-days.v0" },
              projectionScopeKey: "steps-days.v0",
              records: [],
            }],
          }],
          requestedProjectionScopeKeys: ["steps-days.v0"],
          status: "ok",
        });
        return { answer: "Current shared data only.", outcome: "answered" };
      });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_detached_share_regrant",
              idleCheckpointDelayMs: 120_000,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot() {
              return {
                snapshotRef: createBundleRef({
                  hash: "8".repeat(64),
                  key: "users/bundles/member-synthetic/detached-share-regrant.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem() {
              throw new Error("Restored detached ask test should not import mailbox items.");
            },
            platform: createPlatform({
              assistantAskPort: {
                async request(request) {
                  if (request.action === "complete") {
                    events.push("ask.completed");
                    shutdownController.abort(new Error("Stop after detached ask completion."));
                    return { action: "complete", status: "completed" };
                  }
                  events.push("ask.prepared");
                  return {
                    action: "prepare",
                    question: "What current shared data is available?",
                    status: "ready",
                    targetLabel: "100 Club",
                  };
                },
              },
              groupToolPort: {
                async request(request) {
                  assert.deepEqual(request, {
                    action: "read_shared",
                    projectionScopes: [{ projectionKind: "steps-days.v0" }],
                  });
                  events.push("share.snapshot.read");
                  return {
                    action: "read_shared",
                    result: {
                      members: [{
                        currentTurnHandles: [],
                        displayName: null,
                        memberId: "member_shared_regrant",
                        participantId: "participant_shared_regrant",
                        projections: [{
                          dataStatus: "missing",
                          grantStatus: "granted",
                          projectionScope: { projectionKind: "steps-days.v0" },
                          projectionScopeKey: "steps-days.v0",
                          records: [],
                        }],
                      }],
                      requestedProjectionScopeKeys: ["steps-days.v0"],
                      status: "ok",
                    },
                  };
                },
              },
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ snapshotRef, version: "0" }),
              }),
              workspaceSnapshotPort: {
                async abortSnapshotSession() {
                  throw new Error("Restored detached ask test should not abort snapshots.");
                },
                async completeSnapshotSession() {
                  throw new Error("Restored detached ask test should not complete snapshots.");
                },
                async putSnapshotObjectDirect() {
                  throw new Error("Restored detached ask test should not upload snapshots.");
                },
                async restoreWorkspaceSnapshot(input) {
                  restoreCallCount += 1;
                  await initializeVault({
                    createdAt: TEST_NOW,
                    vaultRoot: input.durableRoot,
                  });
                  await enqueueHostedSystemMailboxItem({
                    item: createResolvedAssistantAskSystemMailboxItem(askItem),
                    vaultRoot: input.durableRoot,
                    wake: createAssistantAskRequestedWake({
                      eventId: askItem.dedupeKey,
                    }),
                  });
                  assert.deepEqual(
                    (await readHostedSystemMailboxState(input.durableRoot)).pending.map(
                      (item) => item.itemId,
                    ),
                    [askItem.id],
                  );
                  runtimeWakeSignal.notify();
                },
                async startSnapshotSession() {
                  throw new Error("Restored detached ask test should not start snapshots.");
                },
              },
            }),
            async runAssistantPhase() {
              assistantPhaseCalls += 1;
              events.push("foreground.finished");
              return assistantPhaseCalls === 1
                ? {
                    checkpointReason: "assistant_runtime_commit",
                    progressed: true,
                  }
                : { progressed: false };
            },
            runtimeWakeSignal,
            shutdownSignal: shutdownController.signal,
            vaultRoot,
          },
        ),
        30_000,
        () => events.join(","),
      );

      assert.ok(
        requireEventIndex(events, "foreground.finished")
          < requireEventIndex(events, "ask.model.started"),
      );
      assert.ok(
        requireEventIndex(events, "ask.model.started")
          < requireEventIndex(events, "share.snapshot.read"),
      );
      assert.ok(events.includes("ask.completed"));
      assert.ok(assistantPhaseCalls >= 1);
      assert.equal(restoreCallCount, 1);
      assert.ok(result.status === "idle" || result.status === "scheduled");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 45_000);

  test("lets a detached model handle lazy Web-owned shared snapshot unavailability", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const snapshotRef = createWorkspaceSnapshotV2Ref(
      "snapshot-detached-share-authority-unavailable",
    );
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const executeCallCountBefore = mocks.executeReadOnlyAssistantAsk.mock.calls.length;
    let restoreCallCount = 0;

    try {
      const askItem = createMailboxItem({
        dedupeKey: "ask_event_entrypoint_share_authority_unavailable",
        id: "mailbox_item_entrypoint_share_authority_unavailable",
        kind: "assistant.ask.requested",
        lane: "system",
        laneSeq: "1",
      });
      mocks.executeReadOnlyAssistantAsk.mockImplementationOnce(async (askInput) => {
        events.push("ask.model.started");
        assert.equal(events.includes("share.snapshot.unavailable"), false);
        assert.ok(askInput.groupSharedReader);
        const shared = await askInput.groupSharedReader.request({
          projectionScopes: [{ projectionKind: "steps-days.v0" }],
        });
        assert.deepEqual(shared, {
          status: "unavailable",
          unavailableReason: "control_plane_unavailable",
        });
        return { outcome: "cannot_answer" };
      });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_detached_share_authority_unavailable",
              idleCheckpointDelayMs: 120_000,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot() {
              return {
                snapshotRef: createBundleRef({
                  hash: "7".repeat(64),
                  key:
                    "users/bundles/member-synthetic/"
                    + "detached-share-authority-unavailable.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem() {
              throw new Error("Restored detached ask test should not import mailbox items.");
            },
            platform: createPlatform({
              assistantAskPort: {
                async request(request) {
                  if (request.action === "complete") {
                    events.push("ask.completed");
                    shutdownController.abort(new Error("Stop after detached ask completion."));
                    return { action: "complete", status: "completed" };
                  }
                  return {
                    action: "prepare",
                    question: "This question must remain queued.",
                    status: "ready",
                    targetLabel: "100 Club",
                  };
                },
              },
              groupToolPort: {
                async request(request) {
                  assert.deepEqual(request, {
                    action: "read_shared",
                    projectionScopes: [{ projectionKind: "steps-days.v0" }],
                  });
                  events.push("share.snapshot.unavailable");
                  return {
                    action: "read_shared",
                    result: {
                      status: "unavailable",
                      unavailableReason: "control_plane_unavailable",
                    },
                  };
                },
              },
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ snapshotRef, version: "0" }),
              }),
              workspaceSnapshotPort: {
                async abortSnapshotSession() {
                  throw new Error("Restored detached ask test should not abort snapshots.");
                },
                async completeSnapshotSession() {
                  throw new Error("Restored detached ask test should not complete snapshots.");
                },
                async putSnapshotObjectDirect() {
                  throw new Error("Restored detached ask test should not upload snapshots.");
                },
                async restoreWorkspaceSnapshot(input) {
                  restoreCallCount += 1;
                  await initializeVault({
                    createdAt: TEST_NOW,
                    vaultRoot: input.durableRoot,
                  });
                  await enqueueHostedSystemMailboxItem({
                    item: createResolvedAssistantAskSystemMailboxItem(askItem),
                    vaultRoot: input.durableRoot,
                    wake: createAssistantAskRequestedWake({
                      eventId: askItem.dedupeKey,
                    }),
                  });
                  assert.deepEqual(
                    (await readHostedSystemMailboxState(input.durableRoot)).pending.map(
                      (item) => item.itemId,
                    ),
                    [askItem.id],
                  );
                  runtimeWakeSignal.notify();
                },
                async startSnapshotSession() {
                  throw new Error("Restored detached ask test should not start snapshots.");
                },
              },
            }),
            async runAssistantPhase() {
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            },
            runtimeWakeSignal,
            shutdownSignal: shutdownController.signal,
            vaultRoot,
          },
        ),
        30_000,
        () => events.join(","),
      );

      assert.ok(events.includes("share.snapshot.unavailable"));
      assert.equal(
        mocks.executeReadOnlyAssistantAsk.mock.calls.length,
        executeCallCountBefore + 1,
      );
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => ({
          itemId: item.itemId,
          status: item.status,
        })),
        [],
      );
      assert.equal(restoreCallCount, 1);
      assert.ok(result.status === "idle" || result.status === "scheduled");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 45_000);

  test("resumes detached asks imported after a checkpoint without starting one inside the snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const askStarted = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems = [
      createMailboxItem({
        dedupeKey: "runtime_manual_before_late_ask",
        id: "mailbox_item_entrypoint_before_late_ask",
        kind: "runtime.manual-requested",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    const lateAskItem = createMailboxItem({
      dedupeKey: "ask_event_entrypoint_after_checkpoint",
      id: "mailbox_item_entrypoint_after_checkpoint_ask",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "2",
      occurredAt: "2026-04-27T00:00:01.000Z",
    });
    let assistantPhaseCalls = 0;
    let snapshotActive = false;

    mocks.executeReadOnlyAssistantAsk.mockImplementationOnce(async (askInput) => {
      assert.equal(snapshotActive, false);
      events.push("late-ask.started");
      askStarted.resolve();
      queueMicrotask(() => {
        shutdownController.abort(new Error("Stop after post-checkpoint ask started."));
      });
      return await new Promise((_resolve, reject) => {
        const abort = () => {
          events.push("late-ask.exited");
          reject(askInput.abortSignal?.reason);
        };
        if (askInput.abortSignal?.aborted) {
          abort();
          return;
        }
        askInput.abortSignal?.addEventListener("abort", abort, { once: true });
      });
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_detached_ask_after_checkpoint",
              idleCheckpointDelayMs: 1,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot() {
              snapshotActive = true;
              events.push(`snapshot.${checkpointRequests.length + 1}.started`);
              await Promise.resolve();
              snapshotActive = false;
              events.push(`snapshot.${checkpointRequests.length + 1}.finished`);
              return {
                snapshotRef: createBundleRef({
                  hash: `${checkpointRequests.length + 1}`.repeat(64).slice(0, 64),
                  key:
                    "users/bundles/member-synthetic/"
                    + `detached-ask-after-checkpoint-${checkpointRequests.length + 1}.bundle.json`,
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              if (item.route.action === "run-assistant-ask") {
                await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
                return await enqueueHostedSystemMailboxItem({
                  item,
                  vaultRoot,
                  wake: createAssistantAskRequestedWake({
                    eventId: lateAskItem.dedupeKey,
                  }),
                });
              }
              return await importRuntimeControlSystemMailboxItemForTest({
                item: item.item,
                vaultRoot,
              });
            },
            platform: createPlatform({
              assistantAskPort: {
                async request(request) {
                  if (request.action === "complete") {
                    return { action: "complete", status: "completed" };
                  }
                  return {
                    action: "prepare",
                    question: "What changed after the checkpoint?",
                    status: "ready",
                    targetLabel: "100 Club",
                  };
                },
              },
              mailboxPort: createMailboxPort({ events, items: mailboxItems }),
              workspacePort: {
                async read() {
                  return {
                    fetchedAt: TEST_NOW,
                    workspace: createWorkspaceState({ version: "0" }),
                  };
                },
                async checkpoint(request) {
                  checkpointRequests.push(request);
                  events.push(`workspace.checkpoint.${checkpointRequests.length}`);
                  if (checkpointRequests.length === 1) {
                    queueMicrotask(() => {
                      mailboxItems.push(lateAskItem);
                      runtimeWakeSignal.notify();
                    });
                  }
                  return {
                    checkpointed: true,
                    workspace: createWorkspaceState({
                      nextWakeAt: request.nextWakeAt ?? null,
                      nextWakeReason: request.nextWakeReason ?? null,
                      redactedStatus: request.redactedStatus ?? null,
                      snapshotRef: request.snapshotRef,
                      version: String(checkpointRequests.length),
                    }),
                  };
                },
              },
            }),
            runtimeWakeSignal,
            async runAssistantPhase() {
              assistantPhaseCalls += 1;
              events.push(`foreground.${assistantPhaseCalls}`);
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            },
            shutdownSignal: shutdownController.signal,
            vaultRoot,
          },
        ),
        45_000,
        () => events.join(","),
      );

      assert.ok(events.includes("late-ask.started"), events.join(","));
      assert.ok(
        requireEventIndex(events, "workspace.checkpoint.1")
          < requireEventIndex(events, "late-ask.started"),
      );
      assert.ok(
        requireEventIndex(events, "snapshot.1.finished")
          < requireEventIndex(events, "late-ask.started"),
      );
      assert.ok(
        requireEventIndex(events, "late-ask.exited")
          < requireEventIndex(events, "snapshot.2.started"),
      );
      assert.equal(result.status, "scheduled");
      assert.equal(assistantPhaseCalls, 2);
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 60_000);

  test("emits metadata-only phase boundary logs for runtime startup", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_phase_boundaries",
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }), {
        async createCheckpointSnapshot() {
          throw new Error("Phase-boundary test should not checkpoint.");
        },
        async importItem() {
          throw new Error("Phase-boundary test should not import mailbox items.");
        },
        platform: createPlatform({
          latencyTraceRequests,
          mailboxPort: createMailboxPort({ events: [], fetchRequests, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events: [],
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot,
      });

      const phaseLogs = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_phase_boundaries",
        spy: consoleInfo,
      });

      assert.deepEqual(phaseLogs.map((entry) => [
        entry.details.runtimePhase,
        entry.details.runtimePhaseStatus,
      ]), [
        ["workspace.read", "start"],
        ["workspace.read", "done"],
        ["workspace.restore", "start"],
        ["workspace.restore", "done"],
        ["codex.prepare", "start"],
        ["codex.prepare", "done"],
        ["mailbox.import.initial", "start"],
        ["mailbox.import.initial", "done"],
        ["foreground.pass", "start"],
        ["foreground.pass", "done"],
        ["runtime.return", "done"],
      ]);
      expect(phaseLogs.map((entry) => entry.details.runtimePhaseOrdinal)).toEqual(
        Array.from({ length: phaseLogs.length }, (_value, index) => index + 1),
      );
      const codexPrepareDoneLog = phaseLogs.find((entry) =>
        entry.details.runtimePhase === "codex.prepare"
        && entry.details.runtimePhaseStatus === "done"
      );
      assert.equal(
        codexPrepareDoneLog?.details.codexEffectiveModelProviderId,
        "hosted-openai",
      );
      expect(codexPrepareDoneLog?.details).toEqual(expect.objectContaining({
        codexProviderRequestMaxRetries: 4,
        codexProviderStreamIdleTimeoutMs: 90_000,
        codexProviderStreamMaxRetries: 0,
        codexProviderTransportMode: "codex-native-provider-transport",
      }));
      expect(phaseLogs.every((entry) =>
        typeof entry.details.runtimeElapsedMs === "number"
      )).toBe(true);
      expect(phaseLogs[1]?.details.runtimePhaseDurationMs).toEqual(expect.any(Number));
      assert.equal(phaseLogs.every((entry) => entry.userId === null), true);
      assert.equal(
        phaseLogs.some((entry) => JSON.stringify(entry).includes(TEST_USER_ID)),
        false,
      );
      expect(phaseLogs[1]?.details).toEqual(expect.objectContaining({
        actualWorkspaceVersion: "0",
        workspacePresent: true,
      }));
      expect(phaseLogs.find((entry) =>
        entry.details.runtimePhase === "mailbox.import.initial"
        && entry.details.runtimePhaseStatus === "done"
      )?.details).toEqual(expect.objectContaining({
        fetchedCount: 0,
        importedCount: 0,
      }));
      expect(latencyTraceRequests.map((request) => request.event)).toEqual([
        expect.objectContaining({
          milestone: "mailbox_import_done",
          runtimeAttemptId: "attempt_synthetic_phase_boundaries",
          source: "linq",
          type: "runtime_milestone",
        }),
      ]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "system" },
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleInfo.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  test("marks restored legacy vault migration dirty for the hosted checkpoint path", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const snapshotRef = createWorkspaceSnapshotV2Ref("snapshot-legacy-vault-format-migration");
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let restoreCallCount = 0;

    try {
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_legacy_vault_format_migration",
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }), {
        async createCheckpointSnapshot() {
          const metadataPath = path.join(vaultRoot, VAULT_LAYOUT.metadata);
          const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
          assert.equal(metadata.formatVersion, CURRENT_VAULT_FORMAT_VERSION);
          return {
            snapshotRef: createWorkspaceSnapshotV2Ref(
              "snapshot-legacy-vault-format-migration-checkpoint",
            ),
          };
        },
        async importItem() {
          throw new Error("Legacy vault format migration test should not import mailbox items.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events: [],
            workspace: createWorkspaceState({ snapshotRef, version: "0" }),
          }),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("Legacy vault format migration test should not abort snapshots.");
            },
            async completeSnapshotSession() {
              throw new Error("Legacy vault format migration test should not complete snapshots.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("Legacy vault format migration test should not upload snapshots.");
            },
            async restoreWorkspaceSnapshot(input) {
              restoreCallCount += 1;
              await initializeVault({ createdAt: TEST_NOW, vaultRoot: input.durableRoot });
              const metadataPath = path.join(input.durableRoot, VAULT_LAYOUT.metadata);
              const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
              await writeFile(
                metadataPath,
                `${JSON.stringify({ ...metadata, formatVersion: 1 }, null, 2)}\n`,
                "utf8",
              );
            },
            async startSnapshotSession() {
              throw new Error("Legacy vault format migration test should not start snapshots.");
            },
          },
        }),
        vaultRoot,
      });

      assert.equal(restoreCallCount, 1);
      const metadataPath = path.join(vaultRoot, VAULT_LAYOUT.metadata);
      const migratedMetadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
      assert.equal(migratedMetadata.formatVersion, CURRENT_VAULT_FORMAT_VERSION);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("repairs an exact interrupted integration ingest archive before serving the restored vault", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const snapshotRef = createWorkspaceSnapshotV2Ref("snapshot-interrupted-ingest-archive");
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logicalPath = "ledger/integration-ingests/2026/2026-03.jsonl";

    try {
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_interrupted_ingest_archive",
          leaseGeneration: "8",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }), {
        async createCheckpointSnapshot() {
          await assert.rejects(access(path.join(vaultRoot, logicalPath)));
          await access(path.join(vaultRoot, `${logicalPath}.gz`));
          return {
            snapshotRef: createWorkspaceSnapshotV2Ref(
              "snapshot-interrupted-ingest-archive-checkpoint",
            ),
          };
        },
        async importItem() {
          throw new Error("Interrupted archive recovery test should not import mailbox items.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events: [],
            workspace: createWorkspaceState({ snapshotRef, version: "0" }),
          }),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("Interrupted archive recovery test should not abort snapshots.");
            },
            async completeSnapshotSession() {
              throw new Error("Interrupted archive recovery test should not complete snapshots.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("Interrupted archive recovery test should not upload snapshots.");
            },
            async restoreWorkspaceSnapshot(input) {
              await initializeVault({ createdAt: TEST_NOW, vaultRoot: input.durableRoot });
              const part = buildIntegrationEvidencePart({
                content: JSON.stringify({ meal: "synthetic" }),
                fileName: "synthetic-meal.json",
                mediaType: "application/json",
                role: "meal-summary",
              });
              const record = buildIntegrationIngestRecord({
                eventCount: 0,
                eventIdsComplete: true,
                eventOutputs: [],
                id: "xfm_11111111111111111111111111",
                importedAt: "2026-03-12T09:00:00.000Z",
                parts: [part],
                provider: "ios-meals",
                sampleCount: 0,
                sampleIds: [],
                sampleIdsComplete: true,
                source: "import",
              });
              const content = `${JSON.stringify(record)}\n`;
              const rawPath = path.join(input.durableRoot, logicalPath);
              await mkdir(path.dirname(rawPath), { recursive: true });
              await writeFile(rawPath, content, "utf8");
              await writeFile(`${rawPath}.gz`, gzipSync(content));
            },
            async startSnapshotSession() {
              throw new Error("Interrupted archive recovery test should not start snapshots.");
            },
          },
        }),
        vaultRoot,
      });

      await assert.rejects(access(path.join(vaultRoot, logicalPath)));
      await access(path.join(vaultRoot, `${logicalPath}.gz`));
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("preserves member-action outcome recording on the guarded mailbox port", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const recordedOutcomes: Array<
      Parameters<NonNullable<HostedRuntimeMailboxPort["recordMemberActionOutcome"]>>[0]
    > = [];
    const mailboxPort: HostedRuntimeMailboxPort = {
      ...createMailboxPort({
        events,
        items: [createMailboxItem({
          id: "mailbox_item_entrypoint_member_action_outcome_port",
          laneSeq: "1",
        })],
      }),
      async recordMemberActionOutcome(outcome) {
        recordedOutcomes.push(outcome);
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_member_action_outcome_port",
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            return {
              snapshotRef: createBundleRef({
                hash: snapshotInput.reason === "import" ? "5".repeat(64) : "6".repeat(64),
                key: `users/bundles/member-synthetic/${snapshotInput.reason}-member-action-outcome-port.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            const recordMemberActionOutcome =
              input.runtime.platform.mailboxPort?.recordMemberActionOutcome;
            assert.ok(recordMemberActionOutcome);
            await recordMemberActionOutcome({
              actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
              completedAt: TEST_NOW,
              reason: null,
              schemaVersion: 1,
              status: "applied",
            });
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

      assert.deepEqual(recordedOutcomes, [{
        actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
        completedAt: TEST_NOW,
        reason: null,
        schemaVersion: 1,
        status: "applied",
      }]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("passes stable container CA env into hosted Codex runtime env", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const containerCaPath = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
    const previousEnv = new Map([
      ...HOSTED_CONTAINER_CA_ENV_KEYS,
      ...HOSTED_UNSTABLE_PROCESS_ENV_KEYS,
    ].map((key) => [key, process.env[key]]));
    const runtimeEnvs: Readonly<Record<string, string>>[] = [];

    try {
      for (const key of HOSTED_CONTAINER_CA_ENV_KEYS) {
        process.env[key] = containerCaPath;
      }
      for (const key of HOSTED_UNSTABLE_PROCESS_ENV_KEYS) {
        process.env[key] = `/tmp/synthetic-runtime-${key.toLowerCase()}-churn`;
      }
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_container_ca_env",
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            return {
              snapshotRef: createBundleRef({
                hash: snapshotInput.reason === "import" ? "3".repeat(64) : "4".repeat(64),
                key: `users/bundles/member-synthetic/${snapshotInput.reason}-ca-env.bundle.json`,
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
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_container_ca_env",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            runtimeEnvs.push(input.runtimeEnv);
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

      assert.equal(runtimeEnvs.length, 1);
      for (const key of HOSTED_CONTAINER_CA_ENV_KEYS) {
        assert.equal(runtimeEnvs[0]?.[key], containerCaPath);
      }
      for (const key of HOSTED_UNSTABLE_PROCESS_ENV_KEYS) {
        assert.equal(runtimeEnvs[0]?.[key], undefined);
      }
    } finally {
      for (const [key, value] of previousEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("projects trusted app rollout gates into the assistant turn env", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const runtimeEnvs: Readonly<Record<string, string>>[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          forwardedEnv: {
            MURPH_ANDROID_APP_ENABLED: "1",
          },
          platformEnv: {
            MURPH_ANDROID_APP_ENABLED: "1",
            MURPH_WEARABLE_TREND_CARDS_ENABLED: "1",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            return {
              snapshotRef: createBundleRef({
                hash: snapshotInput.reason === "import" ? "5".repeat(64) : "6".repeat(64),
                key: `users/bundles/member-synthetic/${snapshotInput.reason}-android-gate.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events: [],
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_android_gate",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events: [],
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            runtimeEnvs.push(input.runtimeEnv);
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

      assert.equal(runtimeEnvs.length, 1);
      assert.equal(runtimeEnvs[0]?.MURPH_ANDROID_APP_ENABLED, "1");
      assert.equal(
        runtimeEnvs[0]?.MURPH_WEARABLE_TREND_CARDS_ENABLED,
        "1",
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("uses hosted Codex runtime CA env for intercepted OpenAI HTTPS requests", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const certRoot = await mkdtemp(path.join(tmpdir(), "murph-openai-ca-probe-"));
    const certFiles = await createOpenAiProbeCertificateFiles(certRoot);
    const previousEnv = new Map(HOSTED_CONTAINER_CA_ENV_KEYS.map((key) => [
      key,
      process.env[key],
    ]));
    const probeResults: OpenAiHttpsProbeResult[] = [];
    let openAiServer: Awaited<ReturnType<typeof startOpenAiProbeServer>> | null = null;

    try {
      for (const key of HOSTED_CONTAINER_CA_ENV_KEYS) {
        process.env[key] = certFiles.caCertPath;
      }
      const server = await startOpenAiProbeServer(certFiles);
      openAiServer = server;
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          forwardedEnv: {
            OPENAI_API_KEY: "__cloudflare_injected__",
          },
          request: {
            attemptId: "attempt_synthetic_openai_https_ca_probe",
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            return {
              snapshotRef: createBundleRef({
                hash: snapshotInput.reason === "import" ? "5".repeat(64) : "6".repeat(64),
                key: `users/bundles/member-synthetic/${snapshotInput.reason}-openai-ca-probe.bundle.json`,
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
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_openai_https_ca_probe",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            probeResults.push(await runOpenAiHttpsProbe({
              runtimeEnv: input.runtimeEnv,
              url: `https://api.openai.com:${server.port}/v1/responses`,
            }));
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

      assert.deepEqual(probeResults, [
        {
          body: "ok",
          caConfigured: true,
          ok: true,
          status: 200,
        },
      ]);
    } finally {
      for (const [key, value] of previousEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await openAiServer?.close();
      await removeTempRoot(certRoot);
      await removeTempRoot(vaultRoot);
    }
  });

  test("uses invocation workspace state without a startup workspace-port read", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const suppliedWorkspace = createWorkspaceState({ version: "0" });
    const logRequests: HostedRuntimeLogRequest[] = [];
    const attemptId = "attempt_synthetic_invocation_workspace";

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspace: suppliedWorkspace,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Invocation workspace state test should not checkpoint.");
          },
          async importItem() {
            throw new Error("Invocation workspace state test should not import mailbox items.");
          },
          platform: createPlatform({
            logRequests,
            mailboxPort: createMailboxPort({ events: [], items: [] }),
            workspacePort: {
              async read() {
                throw new Error("Invocation workspace state should avoid startup workspace read.");
              },
              async checkpoint() {
                throw new Error("Invocation workspace state test should not checkpoint.");
              },
            },
          }),
          vaultRoot,
        },
      );
      await drainHostedRuntimeLogWritesBestEffort();

      assert.equal(result.status, "idle");
      assert.deepEqual(
        logRequests.flatMap((request) => request.entries).filter((entry) =>
          entry.attemptId === attemptId
          && entry.eventCode === "runtime.invocation_finished"
        ).map((entry) => entry.redactedJson),
        [{ processingMode: "default" }],
      );
    } finally {
      await drainHostedRuntimeLogWritesBestEffort();
      await removeTempRoot(vaultRoot);
    }
  });

  });
