import {
  TEST_NOW,
  TEST_USER_ID,
  assertPrivateDirectoryMode,
  continueRuntimeLiveness,
  createBundleRef,
  createDeferred,
  createMailboxImportStateBundle,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createWorkspacePort,
  createWorkspaceRunRequest,
  createWorkspaceRuntimeJobInput,
  createWorkspaceSnapshotV2Ref,
  createWorkspaceState,
  describeCheckpointConversationWatermarkTransition,
  measureStage,
  mocks,
  readCheckpointConversationWatermark,
  readConversationImportedSeq,
  readConversationImportedSeqs,
  removeTempRoot,
  requireEventIndex,
  runHostedWorkspaceRuntimeJobInProcess,
  sha256Hex,
  stagePendingLinqAssistantInputForMailboxItem,
  summarizeStageTimings,
  waitUntil,
  writeMailboxImportStateFile,
  writeSyntheticAssistantAutoReplyTerminalEvidence,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

import type {
  StageTimingSample,
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
  readAssistantInputEvent,
  shouldGroupAdjacentAssistantInputCandidates,
  updateAssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
  writeAssistantAutoReplyReplyTerminalEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import {
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  createHostedPortableWorkspaceManifestFromBundle,
  listPendingAssistantRuntimeIssueRecords,
  restoreHostedBundleRoots,
  restoreHostedExecutionContext,
  snapshotHostedPortableWorkspaceDelta,
  snapshotHostedAssistantRuntimeHotState,
  snapshotHostedBundleRoots,
  writePendingAssistantRuntimeIssueRecord,
  writeHostedBundleTextFile,
} from "@murphai/runtime-state/node";
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
  buildHostedExecutionLayeredSnapshotRef,
  buildHostedExecutionWorkingSnapshotRef,
  isHostedWorkspaceSnapshotV2Ref,
  readHostedExecutionSnapshotBaseRef,
} from "@murphai/hosted-execution/parsers";
import { describe, expect, test, vi } from "vitest";
import {
  createCoalescingRuntimeWakeSignal,
  HostedRuntimeCheckpointInterruptedByWakeError,
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  HostedWorkspaceRunnerUserMismatchError,
  drainHostedRuntimeDeferredUsageCompletionsBestEffort,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  type HostedWorkspaceRuntimeJobOptions,
  type HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
} from "../src/hosted-runtime.ts";
import {
  startHostedWorkspaceRestorePreparation,
} from "../src/hosted-workspace-restore-preparation.ts";
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
import { drainHostedRuntimeLogWritesBestEffort } from "../src/hosted-runtime/runtime-logs.ts";
import {
  HostedRuntimeArtifactReadError,
  type HostedRuntimeDeviceSyncPort,
  type HostedRuntimeMailboxPort,
  type HostedRuntimePlatform,
  type RuntimeLivenessPort,
  type HostedRuntimeWorkspacePort,
  type HostedRuntimeWorkspaceSnapshotPort,
} from "../src/hosted-runtime-contracts.ts";

async function createWorkspaceRestoreFixture(snapshotId: string) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
  const events: string[] = [];
  const mailboxStarted = createDeferred<void>();
  const mailboxRelease = createDeferred<void>();
  const baseMailboxPort = createMailboxPort({ events, items: [] });
  const mailboxPort: HostedRuntimeMailboxPort = {
    ...baseMailboxPort,
    async fetch(request) {
      mailboxStarted.resolve();
      await mailboxRelease.promise;
      return await baseMailboxPort.fetch(request);
    },
  };
  const restoreWorkspaceSnapshot = vi.fn(async (
    input: Parameters<HostedRuntimeWorkspaceSnapshotPort["restoreWorkspaceSnapshot"]>[0],
  ) => {
    events.push("workspace.restore");
    await initializeVault({ createdAt: TEST_NOW, vaultRoot: input.durableRoot });
  });
  const platform = createPlatform({
    events,
    mailboxPort,
    workspacePort: createWorkspacePort({
      checkpointRequests: [],
      events,
      workspace: createWorkspaceState({
        snapshotRef: createWorkspaceSnapshotV2Ref(snapshotId),
        version: "0",
      }),
    }),
    workspaceSnapshotPort: {
      async abortSnapshotSession() {
        throw new Error("Restore seam test must not abort snapshots.");
      },
      async completeSnapshotSession() {
        throw new Error("Restore seam test must not complete snapshots.");
      },
      async putSnapshotObjectDirect() {
        throw new Error("Restore seam test must not upload snapshots.");
      },
      restoreWorkspaceSnapshot,
      async startSnapshotSession() {
        throw new Error("Restore seam test must not start snapshots.");
      },
    },
  });

  return {
    events,
    job: createWorkspaceRuntimeJobInput(),
    mailboxRelease,
    mailboxStarted,
    platform,
    restoreWorkspaceSnapshot,
    vaultRoot,
  };
}

describe("hosted workspace runtime entrypoint", () => {
  test("waits for and consumes the exact prepared restore once before later runtime work", async () => {
    const fixture = await createWorkspaceRestoreFixture("snapshot-prepared-restore-gate");
    const preparation = startHostedWorkspaceRestorePreparation({
      job: fixture.job,
      platform: fixture.platform,
      signal: null,
      vaultRoot: fixture.vaultRoot,
    });
    const preparedResult = await preparation.promise;
    const preparedGate = createDeferred<typeof preparedResult>();
    const preparedWorkspaceRestore = {
      ...preparation,
      promise: preparedGate.promise,
    };

    try {
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(fixture.job, {
        async createCheckpointSnapshot() {
          throw new Error("Prepared restore gate test should not checkpoint.");
        },
        async importItem() {
          throw new Error("Prepared restore gate test should not import mailbox items.");
        },
        platform: fixture.platform,
        preparedWorkspaceRestore,
        vaultRoot: fixture.vaultRoot,
      });

      assert.deepEqual(fixture.events, ["workspace.read", "workspace.restore"]);
      expect(fixture.restoreWorkspaceSnapshot).toHaveBeenCalledOnce();

      preparedGate.resolve(preparedResult);
      await fixture.mailboxStarted.promise;

      assert.deepEqual(fixture.events, ["workspace.read", "workspace.restore"]);
      expect(fixture.restoreWorkspaceSnapshot).toHaveBeenCalledOnce();

      fixture.mailboxRelease.resolve();
      const result = await resultPromise;

      assert.equal(result.status, "idle");
      assert.equal(fixture.events.filter((event) => event === "workspace.read").length, 1);
      assert.equal(fixture.events.filter((event) => event === "workspace.restore").length, 1);
      assert.ok(fixture.events.includes("mailbox.fetch"));
      expect(fixture.restoreWorkspaceSnapshot).toHaveBeenCalledOnce();
    } finally {
      fixture.mailboxRelease.resolve();
      await removeTempRoot(fixture.vaultRoot);
    }
  });

  test("propagates prepared restore rejection before later runtime work", async () => {
    const fixture = await createWorkspaceRestoreFixture(
      "snapshot-prepared-restore-rejection",
    );
    const preparation = startHostedWorkspaceRestorePreparation({
      job: fixture.job,
      platform: fixture.platform,
      signal: null,
      vaultRoot: fixture.vaultRoot,
    });
    const preparedResult = await preparation.promise;
    const preparedGate = createDeferred<typeof preparedResult>();
    const preparedFailure = new Error("Synthetic prepared restore failure.");

    try {
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(fixture.job, {
        async createCheckpointSnapshot() {
          throw new Error("Rejected prepared restore must not checkpoint.");
        },
        async importItem() {
          throw new Error("Rejected prepared restore must not import mailbox items.");
        },
        platform: fixture.platform,
        preparedWorkspaceRestore: {
          ...preparation,
          promise: preparedGate.promise,
        },
        vaultRoot: fixture.vaultRoot,
      });

      assert.deepEqual(fixture.events, ["workspace.read", "workspace.restore"]);
      preparedGate.reject(preparedFailure);

      await expect(resultPromise).rejects.toBe(preparedFailure);
      assert.deepEqual(fixture.events, ["workspace.read", "workspace.restore"]);
      expect(fixture.restoreWorkspaceSnapshot).toHaveBeenCalledOnce();
    } finally {
      fixture.mailboxRelease.resolve();
      await removeTempRoot(fixture.vaultRoot);
    }
  });

  test("retains the default workspace read and restore path without prepared work", async () => {
    const fixture = await createWorkspaceRestoreFixture("snapshot-default-restore-path");

    try {
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(fixture.job, {
        async createCheckpointSnapshot() {
          throw new Error("Default restore path test should not checkpoint.");
        },
        async importItem() {
          throw new Error("Default restore path test should not import mailbox items.");
        },
        platform: fixture.platform,
        vaultRoot: fixture.vaultRoot,
      });

      await fixture.mailboxStarted.promise;
      assert.deepEqual(fixture.events, ["workspace.read", "workspace.restore"]);
      expect(fixture.restoreWorkspaceSnapshot).toHaveBeenCalledOnce();

      fixture.mailboxRelease.resolve();
      const result = await resultPromise;
      assert.equal(result.status, "idle");
      assert.equal(fixture.events.filter((event) => event === "workspace.read").length, 1);
      assert.equal(fixture.events.filter((event) => event === "workspace.restore").length, 1);
      assert.ok(fixture.events.includes("mailbox.fetch"));
    } finally {
      fixture.mailboxRelease.resolve();
      await removeTempRoot(fixture.vaultRoot);
    }
  });

  test("does not run assistant outbox phase when mailbox import fails before checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    let assistantPhaseCalled = false;

    try {
      await expect(
        runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
          async createCheckpointSnapshot() {
            throw new Error("Snapshot should not run after failed mailbox import.");
          },
          async importItem() {
            events.push("import");
            throw new Error("Synthetic mailbox import failure.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_import_failure",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events,
              workspace: null,
            }),
          }),
          async runAssistantPhase() {
            assistantPhaseCalled = true;
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        }),
      ).rejects.toThrow(/Synthetic mailbox import failure/u);

      assert.equal(assistantPhaseCalled, false);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fails closed when required workspace-invocation ports are absent", async () => {
    const input = {
      request: createWorkspaceRunRequest(),
    };
    const vaultRoot = "synthetic-vault-root";
    const importItem = async () => {
      throw new Error("Import should not run without required ports.");
    };
    const createCheckpointSnapshot = async () => ({
      snapshotRef: null,
    });
    let livenessTouches = 0;
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        livenessTouches += 1;
        return continueRuntimeLiveness();
      },
    };

    await expect(
      runHostedWorkspaceRuntimeJobInProcess(input, {
        createCheckpointSnapshot,
        importItem,
        platform: createPlatform({
          mailboxPort: null,
          runtimeLivenessPort,
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events: [],
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot,
      }),
    ).rejects.toThrow(/mailbox port must be injected/u);

    await expect(
      runHostedWorkspaceRuntimeJobInProcess(input, {
        createCheckpointSnapshot,
        importItem,
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          runtimeLivenessPort,
          workspacePort: null,
        }),
        vaultRoot,
      }),
    ).rejects.toThrow(/workspace port must be injected/u);

    await expect(
      runHostedWorkspaceRuntimeJobInProcess(input, {
        createCheckpointSnapshot,
        importItem,
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          runtimeLivenessPort,
          workspacePort: {
            async checkpoint(): Promise<HostedWorkspaceCheckpointResponse> {
              throw new Error("Checkpoint should not run without workspace read.");
            },
          },
        }),
        vaultRoot,
      }),
    ).rejects.toThrow(/workspace port must support read/u);
    assert.equal(livenessTouches, 0);
  });

  test("dirty foreground turns fail closed when the idle checkpoint request cannot be built", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const createCheckpointSnapshot = vi.fn(async () => {
      throw new Error("Foreground test should not build checkpoint snapshots.");
    });
    const createRequest = vi.fn(() => {
      throw new Error("Foreground test should not build checkpoint requests.");
    });
    const restoreBuilder =
      mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.getMockImplementation();
    const restorePortableSnapshot =
      mocks.snapshotHostedPortableWorkspaceDelta.getMockImplementation();
    mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.mockClear();
    mocks.snapshotHostedPortableWorkspaceDelta.mockClear();
    mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.mockImplementation(() => {
      return { createRequest };
    });
    mocks.snapshotHostedPortableWorkspaceDelta.mockImplementation(() => {
      throw new Error("Foreground test should not snapshot portable workspace deltas.");
    });
    const checkpointStarted = createDeferred<void>();
    const checkpointResponse = createDeferred<HostedWorkspaceCheckpointResponse>();
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    const workspacePort = {
      async read(): Promise<HostedWorkspaceReadResponse> {
        events.push("workspace.read");
        return {
          fetchedAt: TEST_NOW,
          workspace: createWorkspaceState({ version: "0" }),
        };
      },
      async checkpoint(request: HostedWorkspaceCheckpointRequest): Promise<HostedWorkspaceCheckpointResponse> {
        events.push("workspace.checkpoint");
        checkpointRequests.push(request);
        checkpointStarted.resolve();
        return await checkpointResponse.promise;
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        createCheckpointSnapshot,
        async importItem() {
          throw new Error("Import should not run without mailbox items.");
        },
        platform: createPlatform({
          events,
          mailboxPort: createMailboxPort({ events, items: [] }),
          logRequests,
          workspacePort,
        }),
        async runAssistantPhase(input) {
          events.push("assistant.phase");
          assert.equal("checkpointActiveTurnInput" in input.platform, false);
          assert.equal("refreshMailboxForActiveTurnInput" in input.platform, false);
          return {
            checkpointReason: "assistant_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
      });

      await expect(resultPromise).rejects.toThrow(
        "Foreground test should not build checkpoint requests.",
      );
      await drainHostedRuntimeLogWritesBestEffort();

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "mailbox.fetch",
        "assistant.phase",
        "runtime.log:mailbox.imported",
        "runtime.log:mailbox.imported",
        "runtime.log:checkpoint.runtime_residue_deferred",
      ]);
      assert.deepEqual(checkpointRequests, []);
      const deferredLogs = logRequests.flatMap((request) => request.entries)
        .filter((entry) => entry.eventCode === "checkpoint.runtime_residue_deferred");
      assert.deepEqual(deferredLogs.map((entry) => entry.redactedJson), [
        {
          checkpointPhase: "assistant",
          checkpointReason: "assistant_runtime_commit",
        },
      ]);
      expect(mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder).toHaveBeenCalled();
      expect(createRequest).toHaveBeenCalledOnce();
      expect(mocks.snapshotHostedPortableWorkspaceDelta).not.toHaveBeenCalled();
      expect(createCheckpointSnapshot).not.toHaveBeenCalled();
    } finally {
      if (restoreBuilder) {
        mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.mockImplementation(
          restoreBuilder,
        );
      }
      if (restorePortableSnapshot) {
        mocks.snapshotHostedPortableWorkspaceDelta.mockImplementation(
          restorePortableSnapshot,
        );
      }
      checkpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({ version: "1" }),
      });
      if (resultPromise) {
        await Promise.race([
          resultPromise.catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 10)),
        ]);
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("normal foreground turns fail closed on every checkpoint-capable runtime surface", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const checkpointRequest: HostedWorkspaceCheckpointRequest = {
      attemptId: "attempt_foreground_tripwire",
      expectedWorkspaceVersion: "0",
      leaseGeneration: "1",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "assistant_runtime_commit",
      redactedStatus: null,
      snapshotRef: null,
    };
    const activationBootstrapCheckpointRequest: HostedWorkspaceCheckpointRequest = {
      ...checkpointRequest,
      reason: "activation_bootstrap",
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await expect(
        runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
          async createCheckpointSnapshot() {
            throw new Error("Foreground test should not build checkpoint snapshots.");
          },
          async importItem() {
            throw new Error("Import should not run without mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            await assert.rejects(
              () => input.platform.workspacePort!.checkpoint(checkpointRequest),
              /Foreground hosted runner must not checkpoint workspace/u,
            );
            await assert.rejects(
              () => input.runtime.platform.workspacePort!.checkpoint(checkpointRequest),
              /Foreground hosted runner must not checkpoint workspace/u,
            );
            await assert.rejects(
              () => input.platform.workspacePort!.checkpoint(activationBootstrapCheckpointRequest),
              /Foreground hosted runner must not checkpoint workspace/u,
            );
            await assert.rejects(
              () => input.runtime.platform.workspacePort!.checkpoint(activationBootstrapCheckpointRequest),
              /Foreground hosted runner must not checkpoint workspace/u,
            );
            return {};
          },
          vaultRoot,
        }),
      ).resolves.toMatchObject({
        status: "idle",
      });

      assert.deepEqual(checkpointRequests, []);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground member activation defers bootstrap checkpointing to idle shutdown", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const createCheckpointSnapshot = vi.fn(async (snapshotInput) => {
      events.push(`snapshot:${snapshotInput.reason}`);
      assert.equal(snapshotInput.reason, "idle_shutdown");
      return {
        snapshotRef: createBundleRef({
          hash: "b".repeat(64),
          key: "users/bundles/member-synthetic/activation-bootstrap.bundle.json",
          size: 512,
        }),
      };
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        createCheckpointSnapshot,
        async importItem(item) {
          events.push(`import:${item.item.lane}:${item.item.laneSeq}`);
          return { status: "imported" };
        },
        platform: createPlatform({
          events,
          mailboxPort: createMailboxPort({
            events,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_activation",
                kind: "member.activated",
                lane: "system",
                laneSeq: "1",
              }),
            ],
          }),
          logRequests,
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        async runAssistantPhase() {
          events.push("assistant.phase");
          return {
            checkpointReason: "activation_bootstrap",
            progressed: true,
            redactedStatus: {
              hostedAssistantProgressed: true,
            },
          };
        },
        vaultRoot,
      });

      assert.equal(result.status, "idle");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      expect(createCheckpointSnapshot).toHaveBeenCalledOnce();
      expect(events).toContain("workspace.checkpoint");
      expect(events).not.toContain("snapshot:activation_bootstrap");
      const assistantDeferredLogs = logRequests.flatMap((request) => request.entries)
        .filter((entry) =>
          entry.eventCode === "checkpoint.runtime_residue_deferred"
          && entry.redactedJson?.checkpointPhase === "assistant"
        );
      assert.deepEqual(assistantDeferredLogs.map((entry) => entry.redactedJson), [
        {
          checkpointPhase: "assistant",
          checkpointReason: "activation_bootstrap",
        },
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground runtime wake import waits until idle before checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const createCheckpointSnapshot = vi.fn(async (snapshotInput) => {
      events.push(`snapshot:${snapshotInput.reason}`);
      assert.equal(snapshotInput.reason, "idle_shutdown");
      return {
        snapshotRef: createBundleRef({
          hash: "5".repeat(64),
          key: "users/bundles/member-synthetic/foreground-runtime-wake.bundle.json",
          size: 512,
        }),
      };
    });
    let fetchCount = 0;
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    const mailboxPort: HostedRuntimeMailboxPort = {
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchCount += 1;
        events.push(`mailbox.fetch:${fetchCount}`);
        const lateItem = createMailboxItem({
          id: "mailbox_item_entrypoint_late_active_turn",
          laneSeq: "1",
        });
        const itemVisible = request.lanes.some((lane) =>
          lane.lane === lateItem.lane
          && BigInt(lateItem.laneSeq) > BigInt(lane.importedSeq)
        );
        return {
          fetchedAt: TEST_NOW,
          items: fetchCount === 1 || !itemVisible ? [] : [lateItem],
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: fetchCount !== 1 && lane.lane === lateItem.lane
              ? "1"
              : lane.importedSeq,
          })),
          userId: TEST_USER_ID,
        };
      },
      async fetchPayload(
        request: HostedMailboxPayloadFetchRequest,
      ): Promise<HostedMailboxPayloadFetchResponse> {
        return {
          fetchedAt: TEST_NOW,
          payload: {
            createdAt: TEST_NOW,
            mailboxItemId: request.mailboxItemId,
            payloadCiphertext: "ciphertext_synthetic_sidecar",
            payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
            userId: TEST_USER_ID,
          },
        };
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        createCheckpointSnapshot,
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
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
        runtimeWakeSignal,
        async runAssistantPhase() {
          runtimeWakeSignal.notify();
          await waitUntil(() => {
            assert.equal(events.includes("import:1"), true);
          });
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
            redactedStatus: {
              hostedMailboxConversationImportedSeq: "0",
              hostedMailboxSystemImportedSeq: "999",
            },
          };
        },
        vaultRoot,
      });

      assert.equal(result.status, "idle");
      assert.ok(result.redactedStatus);
      assert.equal(result.redactedStatus["hostedMailboxConversationImportedSeq"], "1");
      assert.equal(result.redactedStatus["hostedMailboxSystemImportedSeq"], "0");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch:1",
        "mailbox.fetch:2",
        "mailbox.fetch:3",
        "import:1",
        "snapshot:idle_shutdown",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      expect(createCheckpointSnapshot).toHaveBeenCalledOnce();
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("mailbox progress checkpoints derive imported cursors from local state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput(),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "6".repeat(64),
                key: "users/bundles/member-synthetic/mailbox-cursor-derivation.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            const mailboxState = await readHostedMailboxImportState({ vaultRoot });
            await writeHostedMailboxImportState({
              state: {
                ...mailboxState,
                watermarks: {
                  ...mailboxState.watermarks,
                  conversation: "1",
                },
              },
              vaultRoot,
            });
            await runCanonicalWrite({
              vaultRoot,
              operationType: "hosted_mailbox_cursor_projection_test",
              summary: "Persist the mailbox cursor projection test receipt.",
              occurredAt: TEST_NOW,
              mutate: async ({ batch }) => {
                await batch.stageTextWrite(
                  "journal/mailbox-cursor-projection.md",
                  "mailbox cursor projection\n",
                );
              },
            });
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
              redactedStatus: {
                hostedMailboxConversationImportedSeq: "0",
                hostedMailboxSystemImportedSeq: "999",
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(result.status, "idle");
      assert.equal(
        checkpointRequests[0]?.redactedStatus
          ?.hostedMailboxConversationImportedSeq,
        "1",
      );
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemImportedSeq,
        "0",
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("shutdown checkpoints an accepted foreground input for one restored successor", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "murph-foreground-shutdown-handoff-"));
    const firstVaultRoot = path.join(root, "first-vault");
    const secondVaultRoot = path.join(root, "second-vault");
    const events: string[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const firstCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const secondCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const lateInputStaged = createDeferred<void>();
    const shutdownController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const generatedMedia = {
      alt: "Generated physical note",
      contentType: "image/jpeg" as const,
      filename: "generated-physical-note.jpg",
      kind: "vault_image" as const,
      ref: "raw/captures/2026/04/generated-physical-note.jpg",
      sha256: "7".repeat(64),
      sizeBytes: 24,
      source: "gpt-image-2",
    };
    let fetchCount = 0;
    let firstAssistantPhaseCalls = 0;
    let imageProviderInvocationCount = 0;
    let secondAssistantPhaseCalls = 0;
    let stagedInputId: string | null = null;
    const mailboxPort: HostedRuntimeMailboxPort = {
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchCount += 1;
        events.push(`mailbox.fetch:${fetchCount}`);
        const lateItem = createMailboxItem({
          id: "mailbox_item_entrypoint_shutdown_late_active_turn",
          laneSeq: "1",
        });
        const itemVisible = request.lanes.some((lane) =>
          lane.lane === lateItem.lane
          && BigInt(lateItem.laneSeq) > BigInt(lane.importedSeq)
        );
        return {
          fetchedAt: TEST_NOW,
          items: fetchCount === 1 || !itemVisible ? [] : [lateItem],
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: fetchCount !== 1 && lane.lane === lateItem.lane
              ? "1"
              : lane.importedSeq,
          })),
          userId: TEST_USER_ID,
        };
      },
      async fetchPayload(
        request: HostedMailboxPayloadFetchRequest,
      ): Promise<HostedMailboxPayloadFetchResponse> {
        return {
          fetchedAt: TEST_NOW,
          payload: {
            createdAt: TEST_NOW,
            mailboxItemId: request.mailboxItemId,
            payloadCiphertext: "ciphertext_synthetic_sidecar",
            payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
            userId: TEST_USER_ID,
          },
        };
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: firstVaultRoot });

      const firstResult = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.idleCheckpointTrigger}`);
          assert.equal(snapshotInput.reason, "idle_shutdown");
          assert.equal(snapshotInput.idleCheckpointTrigger, "shutdown_signal");
          const bundle = await snapshotHostedBundleRoots({
            kind: "vault",
            roots: [{ root: firstVaultRoot, rootKey: "vault" }],
          });
          assert.ok(bundle);
          const hash = sha256HostedBundleHex(bundle);
          artifactBytesByHash.set(hash, bundle);
          return {
            snapshotRef: createBundleRef({
              hash,
              key: "users/bundles/member-synthetic/foreground-runtime-wake-shutdown.bundle.json",
              size: bundle.byteLength,
            }),
          };
        },
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          stagedInputId = await stagePendingLinqAssistantInputForMailboxItem({
            item: item.item,
            threadId: "thread_shutdown_late_active_turn",
            vaultRoot: firstVaultRoot,
          });
          lateInputStaged.resolve();
          return {
            assistantInputId: stagedInputId,
            status: "imported",
          };
        },
        platform: createPlatform({
          artifactBytesByHash,
          mailboxPort,
          workspacePort: createWorkspacePort({
            checkpointRequests: firstCheckpointRequests,
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        runtimeWakeSignal,
        async runAssistantPhase() {
          firstAssistantPhaseCalls += 1;
          assert.equal(firstAssistantPhaseCalls, 1);
          runtimeWakeSignal.notify();
          await lateInputStaged.promise;
          assert.equal(events.includes("import:1"), true);
          assert.ok(stagedInputId);
          shutdownController.abort(
            new DOMException("Synthetic container SIGTERM.", "AbortError"),
          );
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
            redactedStatus: {
              hostedMailboxConversationImportedSeq: "0",
              hostedMailboxSystemImportedSeq: "999",
            },
          };
        },
        shutdownSignal: shutdownController.signal,
        vaultRoot: firstVaultRoot,
      });

      assert.equal(firstAssistantPhaseCalls, 1);
      assert.equal(firstResult.status, "scheduled");
      assert.equal(firstResult.nextWakeReason, "assistant");
      assert.ok(firstResult.redactedStatus);
      assert.equal(firstResult.redactedStatus["hostedMailboxConversationImportedSeq"], "1");
      assert.equal(firstResult.redactedStatus["hostedMailboxSystemImportedSeq"], "0");
      assert.ok(
        events.indexOf("import:1") >= 0
          && events.indexOf("import:1") < events.indexOf("snapshot:shutdown_signal"),
        events.join(","),
      );
      assert.deepEqual(firstCheckpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(firstCheckpointRequests[0]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(firstCheckpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(firstCheckpointRequests[0]?.nextWakeAt, firstResult.nextWakeAt);
      assert.ok(stagedInputId);
      assert.deepEqual(
        await compactHostedPendingAssistantInputIds({ vaultRoot: firstVaultRoot }),
        [stagedInputId],
      );

      const secondWorkspace = createWorkspaceState({
        nextWakeAt: firstResult.nextWakeAt,
        nextWakeReason: "assistant",
        snapshotRef: firstCheckpointRequests[0]?.snapshotRef ?? null,
        version: "1",
      });
      const secondResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_foreground_shutdown_handoff_second",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "8",
            userId: TEST_USER_ID,
            workspaceVersion: secondWorkspace.version,
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/foreground-runtime-wake-restored.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("The restored handoff must not require a new mailbox item.");
          },
          platform: createPlatform({
            artifactBytesByHash,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: secondCheckpointRequests,
              events,
              workspace: secondWorkspace,
            }),
          }),
          async runAssistantPhase(phaseInput) {
            secondAssistantPhaseCalls += 1;
            let assistantInputId: string;
            let releaseProviderInputs: (() => void) | null = null;

            if (secondAssistantPhaseCalls === 1) {
              assert.ok(stagedInputId);
              assistantInputId = stagedInputId;
              const restoredInput = await readAssistantInputEvent({
                inputId: assistantInputId,
                vault: secondVaultRoot,
              });
              assert.equal(restoredInput?.inputId, stagedInputId);
              assert.equal(
                restoredInput?.conversation?.threadId,
                "thread_shutdown_late_active_turn",
              );
              const release =
                await phaseInput.beforeProviderAcceptedInputs?.({
                  turnId: "turn_hosted_runtime_test",
                  acceptedInputs: [{
                    id: assistantInputId,
                    source: "assistant-input",
                  }],
                });
              releaseProviderInputs = release ?? null;
              assert.equal(
                phaseInput.imageGenerationLauncher?.launch({
                  continuationSessionId: "asst_foreground_shutdown_handoff",
                  operationId: "image_operation_foreground_shutdown_handoff",
                  originAssistantInputId: assistantInputId,
                  originAssistantInputIdExact: true,
                  scopeId: "session_foreground_shutdown_handoff",
                  async run() {
                    imageProviderInvocationCount += 1;
                    return {
                      media: generatedMedia,
                      runtimeIssue: null,
                      savedImageRef: generatedMedia.ref,
                    };
                  },
                }),
                "started",
              );
            } else if (secondAssistantPhaseCalls === 2) {
              const pendingInputIds = await compactHostedPendingAssistantInputIds({
                vaultRoot: secondVaultRoot,
              });
              assert.equal(pendingInputIds.length, 1);
              assistantInputId = pendingInputIds[0]!;
              assert.notEqual(assistantInputId, stagedInputId);
              const completion = await readAssistantInputEvent({
                inputId: assistantInputId,
                vault: secondVaultRoot,
              });
              assert.equal(
                completion?.conversation?.threadId,
                "thread_shutdown_late_active_turn",
              );
              assert.equal(
                completion?.sourceRef.kind === "hosted-mailbox"
                  ? completion.sourceRef.payloadSchema
                  : null,
                "murph.hosted-image-completion.v1",
              );
              const release =
                await phaseInput.beforeProviderAcceptedInputs?.({
                  turnId: "turn_hosted_runtime_test",
                  acceptedInputs: [{
                    id: assistantInputId,
                    source: "assistant-input",
                  }],
                });
              releaseProviderInputs = release ?? null;
            } else {
              throw new Error("Unexpected extra restored foreground phase.");
            }

            await writeSyntheticAssistantAutoReplyTerminalEvidence({
              inputId: assistantInputId,
              vaultRoot: secondVaultRoot,
            });
            await releaseProviderInputs?.();
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              foregroundReplyFailed: 0,
              nextWakeAt: null,
              progressed: true,
            };
          },
          vaultRoot: secondVaultRoot,
        },
      );

      assert.equal(secondAssistantPhaseCalls, 2);
      assert.equal(imageProviderInvocationCount, 1);
      assert.equal(secondResult.nextWakeReason, "inbox_media_retention");
      assert.deepEqual(
        await compactHostedPendingAssistantInputIds({ vaultRoot: secondVaultRoot }),
        [],
      );
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(root);
    }
  }, 30_000);

  test("foreground runtime wake retryable blocks schedule the next mailbox wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let fetchCount = 0;
    const sidecarItem = createMailboxItem({
      id: "mailbox_item_entrypoint_late_sidecar_retry",
      laneSeq: "1",
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_entrypoint_late_sidecar_retry",
    });

    const mailboxPort: HostedRuntimeMailboxPort = {
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchCount += 1;
        events.push(`mailbox.fetch:${fetchCount}`);
        const itemVisible = request.lanes.some((lane) =>
          lane.lane === sidecarItem.lane
          && BigInt(sidecarItem.laneSeq) > BigInt(lane.importedSeq)
        );
        return {
          fetchedAt: TEST_NOW,
          items: fetchCount === 1 || !itemVisible ? [] : [sidecarItem],
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: fetchCount !== 1 && lane.lane === sidecarItem.lane
              ? "1"
              : lane.importedSeq,
          })),
          userId: TEST_USER_ID,
        };
      },
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
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}`);
          assert.equal(snapshotInput.reason, "idle_shutdown");
          return {
            snapshotRef: createBundleRef({
              hash: "6".repeat(64),
              key: "users/bundles/member-synthetic/foreground-runtime-wake-retry.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem() {
          throw new Error("Retryable sidecar block must not import the item.");
        },
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        runtimeWakeSignal,
        async runAssistantPhase() {
          runtimeWakeSignal.notify();
          await waitUntil(() => {
            assert.equal(events.includes("mailbox.fetchPayload"), true);
          });
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
      });

      const mailboxRetryWakeAt = result.nextWakeAt;
      assert.match(mailboxRetryWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch:1",
        "mailbox.fetch:2",
        "mailbox.fetch:3",
        "mailbox.fetchPayload",
        "snapshot:idle_shutdown",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(result, {
        nextWakeAt: mailboxRetryWakeAt,
        nextWakeReason: "mailbox",
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 0,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemHandledThroughSeq: "0",
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fails closed when workspace read returns a stale version before mailbox fetch", async () => {
    const events: string[] = [];

    await expect(
      runHostedWorkspaceRuntimeJobInProcess({
        request: createWorkspaceRunRequest({
          workspaceVersion: "5",
        }),
      }, {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run after stale workspace read.");
        },
        async importItem() {
          throw new Error("Import should not run after stale workspace read.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({ version: "6" }),
          }),
        }),
        vaultRoot: "synthetic-vault-root",
      }),
    ).rejects.toBeInstanceOf(HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError);
    assert.deepEqual(events, ["workspace.read"]);
  });

  test("fails closed before snapshot restore when workspace read returns another user", async () => {
    const events: string[] = [];
    const artifactGetCalls: string[] = [];

    await expect(
      runHostedWorkspaceRuntimeJobInProcess({
        request: createWorkspaceRunRequest(),
      }, {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run after workspace user mismatch.");
        },
        async importItem() {
          throw new Error("Import should not run after workspace user mismatch.");
        },
        platform: createPlatform({
          artifactGetCalls,
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/other-user.bundle.json",
                size: 512,
              }),
              userId: "member_synthetic_workspace_other",
              version: "0",
            }),
          }),
        }),
        vaultRoot: "synthetic-vault-root",
      }),
    ).rejects.toBeInstanceOf(HostedWorkspaceRunnerUserMismatchError);

    assert.deepEqual(events, ["workspace.read"]);
    assert.deepEqual(artifactGetCalls, []);
  });

  test("restores a workspace before incremental mailbox import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-source-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const restoredState = createEmptyHostedMailboxImportState();
    restoredState.watermarks.conversation = "3";
    await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceVaultRoot });
    await mkdir(path.join(sourceVaultRoot, "raw"), { recursive: true });
    const rawArtifactBytes = Buffer.from("synthetic artifact", "utf8");
    const rawArtifactHash = sha256HostedBundleHex(rawArtifactBytes);
    await writeFile(path.join(sourceVaultRoot, "raw", "artifact.txt"), rawArtifactBytes);
    const sourceBundle = await snapshotHostedBundleRoots({
      externalizeFile: async (file) => {
        if (file.path !== "raw/artifact.txt") {
          return null;
        }

        return {
          byteSize: file.bytes.byteLength,
          sha256: sha256HostedBundleHex(file.bytes),
        };
      },
      kind: "vault",
      roots: [
        {
          root: sourceVaultRoot,
          rootKey: "vault",
        },
      ],
    });
    const bundle = writeHostedBundleTextFile({
      bytes: sourceBundle,
      kind: "vault",
      path: HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
      root: "vault",
      text: JSON.stringify({
        schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
        schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
        value: restoredState,
      }),
    });
    const bundleHash = sha256HostedBundleHex(bundle);
    const artifactBytesByHash = new Map([
      [bundleHash, bundle],
      [rawArtifactHash, rawArtifactBytes],
    ]);
    const imported: string[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "9",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/restored-after-import.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            imported.push(item.item.laneSeq);
            events.push("mailbox.import");
            return { status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash,
            artifactGetCalls,
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_restored_old",
                  laneSeq: "3",
                }),
                createMailboxItem({
                  id: "mailbox_item_entrypoint_restored_new",
                  laneSeq: "4",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                redactedStatus: {
                  hostedMailboxConversationImportedSeq: "0",
                  hostedMailboxSystemImportedSeq: "0",
                },
                snapshotRef: createBundleRef({
                  hash: bundleHash,
                  key: "users/bundles/member-synthetic/restored-before-import.bundle.json",
                  size: bundle.byteLength,
                }),
                version: "9",
              }),
            }),
          }),
          vaultRoot,
        });

      assert.deepEqual(artifactGetCalls, [bundleHash]);
      assert.deepEqual(imported, ["4"]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "3", lane: "conversation" },
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
      assert.equal(readConversationImportedSeqs(fetchRequests).length, 1);
      assert.deepEqual(fetchRequests[0]?.lanes, [
        { importedSeq: "3", lane: "conversation" },
        { importedSeq: "0", lane: "system" },
      ]);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "3");
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "mailbox.import",
        "mailbox.fetch",
        "snapshot:4",
        "workspace.checkpoint",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceVaultRoot);
    }
  });

  test("restores working snapshots without bootstrap checkpoint before mailbox import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceBaseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-base-"));
    const sourceCurrentVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-current-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];

    try {
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
      const baseState = createEmptyHostedMailboxImportState();
      baseState.watermarks.conversation = "2";
      await writeMailboxImportStateFile(sourceBaseVaultRoot, baseState);
      const baseSourceBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseSourceBundle);
      const baseBundle = baseSourceBundle;
      const baseHash = sha256HostedBundleHex(baseBundle);
      const baseManifest = createHostedPortableWorkspaceManifestFromBundle(baseBundle);

      await writeFile(path.join(sourceCurrentVaultRoot, "note.md"), "current note\n", "utf8");
      const currentState = createEmptyHostedMailboxImportState();
      currentState.watermarks.conversation = "3";
      await writeMailboxImportStateFile(sourceCurrentVaultRoot, currentState);
      const delta = await snapshotHostedPortableWorkspaceDelta({
        baseManifest,
        baseSnapshotHash: baseHash,
        vaultRoot: sourceCurrentVaultRoot,
      });
      assert.equal(delta.kind, "changed");
      const deltaHash = sha256HostedBundleHex(delta.bundle);
      const artifactBytesByHash = new Map([
        [baseHash, baseBundle],
        [deltaHash, delta.bundle],
      ]);

      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        mailboxPort: createMailboxPort({
          events,
          fetchRequests,
          items: [
            createMailboxItem({
              id: "mailbox_item_entrypoint_legacy_current",
              laneSeq: "3",
            }),
            createMailboxItem({
              id: "mailbox_item_entrypoint_legacy_next",
              laneSeq: "4",
            }),
          ],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({
            redactedStatus: {
              hostedMailboxConversationImportedSeq: "3",
            },
            snapshotRef: buildHostedExecutionWorkingSnapshotRef({
              base: createBundleRef({
                hash: baseHash,
                key: "users/bundles/member-synthetic/base.bundle.json",
                size: baseBundle.byteLength,
              }),
              delta: createBundleRef({
                hash: deltaHash,
                key: "users/bundles/member-synthetic/delta.bundle.json",
                size: delta.bundle.byteLength,
              }),
            }),
            version: "9",
          }),
        }),
      });
      const runOnce = async (attempt: number) =>
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_working_snapshot_restore_${attempt}`,
              workspaceVersion: "9",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(
                `snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`,
              );
              return {
                snapshotRef: createBundleRef({
                  hash: snapshotInput.reason === "activation_bootstrap"
                    ? "b".repeat(64)
                    : "c".repeat(64),
                  key: `users/bundles/member-synthetic/${snapshotInput.reason}.bundle.json`,
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              imported.push(item.item.laneSeq);
              events.push(`import:${item.item.laneSeq}`);
              return { status: "imported" };
            },
            platform,
            async runAssistantPhase() {
              events.push("assistant");
              return { progressed: false };
            },
            vaultRoot,
          },
        );

      await runOnce(1);

      assert.deepEqual(artifactGetCalls, [baseHash, baseHash, deltaHash]);
      assert.deepEqual(imported, ["4"]);
      assert.equal(fetchRequests.length, 1);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "3");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:4",
        "assistant",
        "snapshot:idle_shutdown:4",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.expectedWorkspaceVersion,
      ]), [
        ["idle_shutdown", "9"],
      ]);
      assert.equal(
        await readFile(path.join(vaultRoot, "note.md"), "utf8"),
        "current note\n",
      );
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");

      artifactGetCalls.length = 0;
      events.length = 0;
      await runOnce(2);

      assert.deepEqual(
        artifactGetCalls,
        artifactGetCalls.length === 0 ? [] : [baseHash, baseHash, deltaHash],
      );
      assert.deepEqual(imported, ["4", "4"]);
      assert.equal(fetchRequests.length, 2);
      assert.equal(readConversationImportedSeq(fetchRequests[1]), "3");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:4",
        "assistant",
        "snapshot:idle_shutdown:4",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
        "idle_shutdown",
      ]);
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceCurrentVaultRoot);
    }
  });

  test("fetches mailbox rows from the authoritative restored watermark", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const restoredState = createEmptyHostedMailboxImportState();
    restoredState.watermarks.conversation = "3";
    const bundle = createMailboxImportStateBundle(restoredState);
    const imported: string[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "9",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/prefetch-reused-after-import.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            imported.push(item.item.laneSeq);
            return { status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[bundle.hash, bundle.bytes]]),
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_prefetch_old",
                  laneSeq: "3",
                }),
                createMailboxItem({
                  id: "mailbox_item_entrypoint_prefetch_new",
                  laneSeq: "4",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                redactedStatus: {
                  hostedMailboxConversationImportedSeq: "3",
                  hostedMailboxSystemImportedSeq: "0",
                },
                snapshotRef: createBundleRef({
                  hash: bundle.hash,
                  key: "users/bundles/member-synthetic/prefetch-reused-before-import.bundle.json",
                  size: bundle.bytes.byteLength,
                }),
                version: "9",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(imported, ["4"]);
      assert.equal(fetchRequests.length, 1);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "3");
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "snapshot:4",
        "workspace.checkpoint",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not let a stale pre-restore mailbox read hide a conversation item appended during restore", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const restoredState = createEmptyHostedMailboxImportState();
    restoredState.watermarks.conversation = "3";
    const bundle = createMailboxImportStateBundle(restoredState);
    const mailboxItems: HostedMailboxItem[] = [];
    const imported: string[] = [];
    const artifactLabelsByHash = new Map([[bundle.hash, "workspace-bundle"]]);

    try {
      const platform = createPlatform({
        artifactBytesByHash: new Map([[bundle.hash, bundle.bytes]]),
        artifactLabelsByHash,
        mailboxPort: createMailboxPort({
          events,
          fetchRequests,
          items: mailboxItems,
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({
            redactedStatus: {
              hostedMailboxConversationImportedSeq: "3",
              hostedMailboxSystemImportedSeq: "0",
            },
            snapshotRef: createBundleRef({
              hash: bundle.hash,
              key: "users/bundles/member-synthetic/prefetch-stale-before-import.bundle.json",
              size: bundle.bytes.byteLength,
            }),
            version: "9",
          }),
        }),
      });
      const platformWithAppendDuringRestore: HostedRuntimePlatform = {
        ...platform,
        artifactStore: {
          ...platform.artifactStore,
          async get(sha256, context) {
            const bytes = await platform.artifactStore.get(sha256, context);
            if (sha256 === bundle.hash && mailboxItems.length === 0) {
              events.push("artifact.get:workspace-bundle");
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_prefetch_stale_new",
                laneSeq: "4",
              }));
            }
            return bytes;
          },
        },
      };

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "9",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/prefetch-stale-after-import.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            imported.push(item.item.laneSeq);
            return { status: "imported" };
          },
          platform: platformWithAppendDuringRestore,
          vaultRoot,
        },
      );

      assert.deepEqual(imported, ["4"]);
      assert.equal(fetchRequests.length, 1);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "3");
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");
      assert.deepEqual(events, [
        "workspace.read",
        "artifact.get:workspace-bundle",
        "mailbox.fetch",
        "snapshot:4",
        "workspace.checkpoint",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("falls back to restored mailbox state for incomplete or malformed existing-workspace hints", async () => {
    const redactedStatuses: Array<HostedWorkspaceState["redactedStatus"]> = [
      null,
      {
        hostedMailboxConversationImportedSeq: "3",
      },
      {
        hostedMailboxConversationImportedSeq: "not-a-seq",
        hostedMailboxSystemImportedSeq: "0",
      },
    ];
    for (const redactedStatus of redactedStatuses) {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
      const events: string[] = [];
      const fetchRequests: HostedMailboxFetchRequest[] = [];
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const restoredState = createEmptyHostedMailboxImportState();
      restoredState.watermarks.conversation = "3";
      const bundle = createMailboxImportStateBundle(restoredState);
      const imported: string[] = [];

      try {
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              workspaceVersion: "9",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "f".repeat(64),
                  key: "users/bundles/member-synthetic/malformed-prefetch-after-import.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              imported.push(item.item.laneSeq);
              return { status: "imported" };
            },
            platform: createPlatform({
              artifactBytesByHash: new Map([[bundle.hash, bundle.bytes]]),
              mailboxPort: createMailboxPort({
                events,
                fetchRequests,
                items: [
                  createMailboxItem({
                    id: "mailbox_item_entrypoint_malformed_old",
                    laneSeq: "3",
                  }),
                  createMailboxItem({
                    id: "mailbox_item_entrypoint_malformed_new",
                    laneSeq: "4",
                  }),
                ],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({
                  redactedStatus,
                  snapshotRef: createBundleRef({
                    hash: bundle.hash,
                    key: "users/bundles/member-synthetic/malformed-prefetch-before-import.bundle.json",
                    size: bundle.bytes.byteLength,
                  }),
                  version: "9",
                }),
              }),
            }),
            vaultRoot,
          },
        );

        assert.deepEqual(imported, ["4"]);
        assert.equal(fetchRequests.length, 1);
        assert.equal(readConversationImportedSeq(fetchRequests[0]), "3");
        assert.deepEqual(events, [
          "workspace.read",
          "mailbox.fetch",
          "snapshot:4",
          "workspace.checkpoint",
        ]);
      } finally {
        await removeTempRoot(vaultRoot);
      }
    }
  });

  test("restores base snapshots and authoritative latest hot state before mailbox import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceBaseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-base-"));
    const sourceHotVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-hot-"));
    const events: string[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      const baseAssistantRoot = resolveAssistantStatePaths(sourceBaseVaultRoot).assistantStateRoot;
      await mkdir(path.join(baseAssistantRoot, "outbox"), { recursive: true });
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
      await writeFile(
        path.join(baseAssistantRoot, "outbox", "intent-old.json"),
        "{\"intent\":\"old\"}\n",
        "utf8",
      );
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);

      const hotAssistantRoot = resolveAssistantStatePaths(sourceHotVaultRoot).assistantStateRoot;
      await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
      await writeFile(
        path.join(hotAssistantRoot, "sessions", "session-latest.json"),
        "{\"session\":\"latest\"}\n",
        "utf8",
      );
      const exactPayload = Buffer.from("restored exact hosted note\n", "utf8");
      const exactPayloadHash = sha256Hex(exactPayload);
      const olderPayload = Buffer.from("older restored hosted note\n", "utf8");
      const olderPayloadHash = sha256Hex(olderPayload);
      const receiptBytes = Buffer.from(`${JSON.stringify({
        actions: [
          {
            byteLength: exactPayload.byteLength,
            contentRef: {
              byteSize: exactPayload.byteLength,
              sha256: exactPayloadHash,
            },
            effect: "create",
            kind: "text_upsert",
            sha256: exactPayloadHash,
            targetRelativePath: "journal/2026-04-28.md",
          },
        ],
        committedAt: "2026-04-28T00:00:00.000Z",
        createdAt: "2026-04-28T00:00:00.000Z",
        occurredAt: "2026-04-28T00:00:00.000Z",
        operationId: "op_synthetic_canonical_restore",
        operationType: "hosted_canonical_write_test",
        schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
        summary: "Restore hosted canonical write receipt.",
        updatedAt: "2026-04-28T00:00:00.000Z",
      }, null, 2)}\n`, "utf8");
      const receiptHash = sha256Hex(receiptBytes);
      const olderReceiptBytes = Buffer.from(`${JSON.stringify({
        actions: [
          {
            byteLength: olderPayload.byteLength,
            contentRef: {
              byteSize: olderPayload.byteLength,
              sha256: olderPayloadHash,
            },
            effect: "create",
            kind: "text_upsert",
            sha256: olderPayloadHash,
            targetRelativePath: "journal/2026-04-28.md",
          },
        ],
        committedAt: "2026-04-28T00:30:00+01:00",
        createdAt: "2026-04-28T00:30:00+01:00",
        occurredAt: "2026-04-28T00:30:00+01:00",
        operationId: "op_synthetic_canonical_restore_old",
        operationType: "hosted_canonical_write_test",
        schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
        summary: "Restore older hosted canonical write receipt.",
        updatedAt: "2026-04-28T00:30:00+01:00",
      }, null, 2)}\n`, "utf8");
      const olderReceiptHash = sha256Hex(olderReceiptBytes);
      const receiptLogBytes = Buffer.from(`${JSON.stringify({
        entries: [
          {
            byteSize: olderReceiptBytes.byteLength,
            sha256: olderReceiptHash,
          },
          {
            byteSize: receiptBytes.byteLength,
            sha256: receiptHash,
          },
        ],
        schema: "murph.hosted-canonical-write-receipt-log.v1",
      }, null, 2)}\n`, "utf8");
      const receiptLogHash = sha256Hex(receiptLogBytes);
      const idleSnapshotRef = createWorkspaceSnapshotV2Ref(
        "snapshot-restored-base-hot-and-receipts-idle",
      );
      const forgedLocalReceiptRoot = path.join(hotAssistantRoot, "receipts", "canonical-writes");
      const forgedLocalPayload = Buffer.from("forged local receipt\n", "utf8");
      const forgedLocalPayloadHash = sha256Hex(forgedLocalPayload);
      await mkdir(path.join(forgedLocalReceiptRoot, "payloads"), { recursive: true });
      await writeFile(
        path.join(forgedLocalReceiptRoot, "payloads", `${forgedLocalPayloadHash}.bin`),
        forgedLocalPayload,
      );
      await writeFile(
        path.join(forgedLocalReceiptRoot, "op_forged_local_restore.json"),
        `${JSON.stringify({
          actions: [
            {
              byteLength: forgedLocalPayload.byteLength,
              contentRef: {
                byteSize: forgedLocalPayload.byteLength,
                sha256: forgedLocalPayloadHash,
              },
              effect: "create",
              kind: "text_upsert",
              sha256: forgedLocalPayloadHash,
              targetRelativePath: "journal/forged-local.md",
            },
          ],
          committedAt: TEST_NOW,
          createdAt: TEST_NOW,
          occurredAt: TEST_NOW,
          operationId: "op_forged_local_restore",
          operationType: "hosted_canonical_write_test",
          schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
          summary: "Forged local receipt.",
          updatedAt: TEST_NOW,
        }, null, 2)}\n`,
        "utf8",
      );
      const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        vaultRoot: sourceHotVaultRoot,
      });
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const artifactBytesByHash = new Map([
        [baseHash, baseBundle],
        [hotHash, hotSnapshot.bundle],
        [exactPayloadHash, exactPayload],
        [olderPayloadHash, olderPayload],
        [receiptHash, receiptBytes],
        [olderReceiptHash, olderReceiptBytes],
        [receiptLogHash, receiptLogBytes],
      ]);

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "9",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            assert.equal(snapshotInput.reason, "idle_shutdown");
            return { snapshotRef: idleSnapshotRef };
          },
          async importItem() {
            throw new Error("Mailbox import should not run without mailbox items.");
          },
          platform: createPlatform({
            artifactBytesByHash,
            artifactGetCalls,
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                redactedStatus: {
                  hostedCanonicalWriteReceiptLogByteSize: receiptLogBytes.byteLength,
                  hostedCanonicalWriteReceiptLogEntryCount: 2,
                  hostedCanonicalWriteReceiptLogSha256: receiptLogHash,
                },
                snapshotRef: buildHostedExecutionLayeredSnapshotRef({
                  base: createBundleRef({
                    hash: baseHash,
                    key: "users/bundles/member-synthetic/base.bundle.json",
                    size: baseBundle.byteLength,
                  }),
                  hot: createBundleRef({
                    hash: hotHash,
                    key: "users/bundles/member-synthetic/hot.bundle.json",
                    size: hotSnapshot.bundle.byteLength,
                  }),
                }),
                version: "9",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(artifactGetCalls.slice(0, 3), [
        baseHash,
        hotHash,
        receiptLogHash,
      ]);
      assert.deepEqual(
        artifactGetCalls
          .filter((hash) => hash === olderReceiptHash || hash === receiptHash),
        [olderReceiptHash, receiptHash],
      );
      assert.deepEqual([...artifactGetCalls.slice(3)].sort(), [
        olderReceiptHash,
        olderPayloadHash,
        receiptHash,
        exactPayloadHash,
      ].sort());
      assert.ok(
        artifactGetCalls.indexOf(olderReceiptHash)
          < artifactGetCalls.indexOf(olderPayloadHash),
      );
      assert.ok(
        artifactGetCalls.indexOf(receiptHash)
          < artifactGetCalls.indexOf(exactPayloadHash),
      );
      assert.equal(await readFile(path.join(vaultRoot, "note.md"), "utf8"), "base note\n");
      assert.equal(
        await readFile(path.join(vaultRoot, "journal", "2026-04-28.md"), "utf8"),
        "restored exact hosted note\n",
      );
      await assert.rejects(readFile(path.join(vaultRoot, "journal", "forged-local.md"), "utf8"));
      await assert.rejects(
        readFile(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent-old.json"), "utf8"),
      );
      assert.equal(
        await readFile(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session-latest.json"), "utf8"),
        "{\"session\":\"latest\"}\n",
      );
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.expectedWorkspaceVersion, "9");
      assert.deepEqual(checkpointRequests[0]?.snapshotRef, idleSnapshotRef);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        undefined,
      );
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogByteSize,
        undefined,
      );
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogEntryCount,
        undefined,
      );
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceHotVaultRoot);
    }
  });

  test("cold-restores legacy snapshots after no-progress alarms", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceBaseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-base-"));
    const sourceHotVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-hot-"));
    const events: string[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceBaseVaultRoot });
      await writeFile(path.join(sourceBaseVaultRoot, "base-note.md"), "base\n", "utf8");
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const baseRef = createBundleRef({
        hash: baseHash,
        key: "users/bundles/member-synthetic/no-progress-base.bundle.json",
        size: baseBundle.byteLength,
      });
      artifactBytesByHash.set(baseHash, baseBundle);

      const hotAssistantRoot = resolveAssistantStatePaths(sourceHotVaultRoot).assistantStateRoot;
      await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
      await writeFile(
        path.join(hotAssistantRoot, "sessions", "session-initial.json"),
        "{\"session\":\"initial\"}\n",
        "utf8",
      );
      const initialHotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        vaultRoot: sourceHotVaultRoot,
      });
      const initialHotHash = sha256HostedBundleHex(initialHotSnapshot.bundle);
      const initialHotRef = createBundleRef({
        hash: initialHotHash,
        key: "users/bundles/member-synthetic/no-progress-hot-initial.bundle.json",
        size: initialHotSnapshot.bundle.byteLength,
      });
      artifactBytesByHash.set(initialHotHash, initialHotSnapshot.bundle);

      let currentWorkspace = createWorkspaceState({
        snapshotRef: buildHostedExecutionLayeredSnapshotRef({
          base: baseRef,
          hot: initialHotRef,
        }),
        version: "9",
      });
      const workspacePort: HostedRuntimeWorkspacePort = {
        async read() {
          events.push("workspace.read");
          return {
            fetchedAt: TEST_NOW,
            workspace: currentWorkspace,
          };
        },
        async checkpoint(request) {
          events.push("workspace.checkpoint");
          checkpointRequests.push(request);
          currentWorkspace = createWorkspaceState({
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            version: String(BigInt(currentWorkspace.version) + 1n),
          });
          return {
            checkpointed: true,
            workspace: currentWorkspace,
          };
        },
      };
      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        events,
        mailboxPort: createMailboxPort({
          events,
          items: [],
        }),
        workspacePort,
      });
      let firstRun = true;
      const runOnce = async () =>
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_no_progress_cache_${checkpointRequests.length}`,
              workspaceVersion: currentWorkspace.version,
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({ vaultRoot });
              const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
              artifactBytesByHash.set(hotHash, hotSnapshot.bundle);
              return {
                snapshotRef: buildHostedExecutionLayeredSnapshotRef({
                  base: baseRef,
                  hot: createBundleRef({
                    hash: hotHash,
                    key: `users/bundles/member-synthetic/no-progress-hot-${hotHash}.bundle.json`,
                    size: hotSnapshot.bundle.byteLength,
                  }),
                }),
              };
            },
            async importItem() {
              throw new Error("Mailbox import should not run without mailbox items.");
            },
            platform,
            async runAssistantPhase() {
              if (!firstRun) {
                return { progressed: false };
              }
              firstRun = false;
              const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
              await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
              await writeFile(
                path.join(assistantRoot, "sessions", "session-checkpointed.json"),
                "{\"session\":\"checkpointed\"}\n",
                "utf8",
              );
              return {
                checkpointReason: "canonical_runtime_commit",
                progressed: true,
              };
            },
            vaultRoot,
          },
        );

      await runOnce();
      assert.deepEqual(artifactGetCalls, [baseHash, initialHotHash]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      artifactGetCalls.length = 0;

      await runOnce();
      assert.equal(artifactGetCalls.length, 2);
      assert.equal(artifactGetCalls[0], baseHash);
      assert.equal(checkpointRequests.length, 1);
      artifactGetCalls.length = 0;

      await runOnce();
      assert.equal(artifactGetCalls.length, 2);
      assert.equal(artifactGetCalls[0], baseHash);
      assert.equal(checkpointRequests.length, 1);
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceHotVaultRoot);
    }
  });

  test("preserves checkpointed mailbox watermarks across clean warm foreground restores", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceBaseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-base-"));
    const sourceHotVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-hot-"));
    const events: string[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const importedSeqs: string[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceBaseVaultRoot });
      await writeFile(path.join(sourceBaseVaultRoot, "base-note.md"), "base\n", "utf8");
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const baseRef = createBundleRef({
        hash: baseHash,
        key: "users/bundles/member-synthetic/warm-mailbox-base.bundle.json",
        size: baseBundle.byteLength,
      });
      artifactBytesByHash.set(baseHash, baseBundle);

      const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        vaultRoot: sourceHotVaultRoot,
      });
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const hotRef = createBundleRef({
        hash: hotHash,
        key: "users/bundles/member-synthetic/warm-mailbox-hot.bundle.json",
        size: hotSnapshot.bundle.byteLength,
      });
      artifactBytesByHash.set(hotHash, hotSnapshot.bundle);

      let currentWorkspace = createWorkspaceState({
        snapshotRef: buildHostedExecutionLayeredSnapshotRef({
          base: baseRef,
          hot: hotRef,
        }),
        version: "9",
      });
      const mailboxItem = createMailboxItem({
        id: "mailbox_item_warm_restore_001",
        laneSeq: "1",
      });
      const workspacePort: HostedRuntimeWorkspacePort = {
        async read() {
          events.push("workspace.read");
          return {
            fetchedAt: TEST_NOW,
            workspace: currentWorkspace,
          };
        },
        async checkpoint(request) {
          events.push("workspace.checkpoint");
          checkpointRequests.push(request);
          currentWorkspace = createWorkspaceState({
            nextWakeAt: request.nextWakeAt ?? null,
            nextWakeReason: request.nextWakeReason ?? null,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            version: String(BigInt(currentWorkspace.version) + 1n),
          });
          return {
            checkpointed: true,
            workspace: currentWorkspace,
          };
        },
      };
      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        events,
        mailboxPort: createMailboxPort({
          events,
          fetchRequests,
          items: [mailboxItem],
        }),
        workspacePort,
      });

      const runOnce = async (attempt: number) =>
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_warm_mailbox_restore_${attempt}`,
              workspaceVersion: currentWorkspace.version,
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              assert.equal(snapshotInput.reason, "idle_shutdown");
              const currentHotSnapshot = await snapshotHostedAssistantRuntimeHotState({
                vaultRoot,
              });
              const currentHotHash = sha256HostedBundleHex(currentHotSnapshot.bundle);
              artifactBytesByHash.set(currentHotHash, currentHotSnapshot.bundle);
              return {
                snapshotRef: buildHostedExecutionLayeredSnapshotRef({
                  base: baseRef,
                  hot: createBundleRef({
                    hash: currentHotHash,
                    key: `users/bundles/member-synthetic/warm-mailbox-hot-${currentHotHash}.bundle.json`,
                    size: currentHotSnapshot.bundle.byteLength,
                  }),
                }),
              };
            },
            async importItem(item) {
              importedSeqs.push(item.item.laneSeq);
              return { status: "imported" };
            },
            platform,
            async runAssistantPhase() {
              return { progressed: false };
            },
            vaultRoot,
          },
        );

      await runOnce(1);
      assert.deepEqual(importedSeqs, ["1"]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(artifactGetCalls, [baseHash, hotHash]);
      artifactGetCalls.length = 0;

      await runOnce(2);
      assert.deepEqual(importedSeqs, ["1"]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(artifactGetCalls.length, 2);
      assert.equal(artifactGetCalls[0], baseHash);
      const secondFetch = fetchRequests
        .filter((request) => request.lanes.some((lane) => lane.lane === "conversation"))
        .at(-1);
      assert.ok(secondFetch);
      assert.equal(
        secondFetch.lanes.find((lane) => lane.lane === "conversation")?.importedSeq,
        "1",
      );
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceHotVaultRoot);
    }
  });

  test("runs assistant phase from restored staged input when mailbox watermark is already current", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceBaseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-base-"));
    const sourceHotVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-hot-"));
    const events: string[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const importedSeqs: string[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceBaseVaultRoot });
      await writeFile(path.join(sourceBaseVaultRoot, "base-note.md"), "base\n", "utf8");
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const baseRef = createBundleRef({
        hash: baseHash,
        key: "users/bundles/member-synthetic/cold-restore-base.bundle.json",
        size: baseBundle.byteLength,
      });
      artifactBytesByHash.set(baseHash, baseBundle);

      await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceHotVaultRoot });
      const stagedInput = await upsertAssistantInputEvent({
        vault: sourceHotVaultRoot,
        event: {
          content: {
            text: "staged hosted Linq input",
            userMessageContent: [
              {
                text: "staged hosted Linq input",
                type: "text",
              },
            ],
          },
          conversation: {
            accountId: "acct_staged_linq",
            actorId: "actor_staged_linq",
            actorIsSelf: false,
            source: "linq",
            threadId: "thread_staged_linq",
            threadIsDirect: true,
          },
          occurredAt: TEST_NOW,
          receivedAt: TEST_NOW,
          replyTarget: {
            channel: "linq",
            messageId: "msg_staged_linq",
            threadId: "thread_staged_linq",
          },
          sourceRef: {
            dedupeKey: "dedupe_staged_linq",
            eventId: "evt_staged_linq",
            itemId: "mailbox_item_cold_restore_001",
            kind: "hosted-mailbox",
            lane: "conversation",
            laneSeq: "1",
            payloadSchema: "payload.v1",
            payloadSource: "inline",
            source: "hosted-mailbox",
            wakeSchema: "wake.v1",
          },
        },
      });
      const restoredState = createEmptyHostedMailboxImportState();
      restoredState.watermarks.conversation = "1";
      await writeMailboxImportStateFile(sourceHotVaultRoot, restoredState);
      const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        vaultRoot: sourceHotVaultRoot,
      });
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const hotRef = createBundleRef({
        hash: hotHash,
        key: "users/bundles/member-synthetic/cold-restore-hot.bundle.json",
        size: hotSnapshot.bundle.byteLength,
      });
      artifactBytesByHash.set(hotHash, hotSnapshot.bundle);

      const workspace = createWorkspaceState({
        snapshotRef: buildHostedExecutionLayeredSnapshotRef({
          base: baseRef,
          hot: hotRef,
        }),
        version: "9",
      });
      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        events,
        mailboxPort: createMailboxPort({
          events,
          fetchRequests,
          items: [
            createMailboxItem({
              id: "mailbox_item_cold_restore_001",
              laneSeq: "1",
            }),
          ],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace,
        }),
      });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_cold_restore_staged_input",
            workspaceVersion: workspace.version,
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Cold-restore foreground replay should not checkpoint.");
          },
          async importItem(item) {
            importedSeqs.push(item.item.laneSeq);
            return { status: "imported" };
          },
          platform,
          async runAssistantPhase() {
            events.push("assistant");
            const restoredInput = await readAssistantInputEvent({
              inputId: stagedInput.inputId,
              vault: vaultRoot,
            });
            assert.equal(restoredInput?.inputId, stagedInput.inputId);
            assert.equal(restoredInput?.sourceRef.kind, "hosted-mailbox");
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(importedSeqs, []);
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(artifactGetCalls, [baseHash, hotHash]);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "1");
      assert.ok(requireEventIndex(events, "workspace.read") < requireEventIndex(events, "mailbox.fetch"));
      assert.ok(requireEventIndex(events, "mailbox.fetch") < requireEventIndex(events, "assistant"));
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceHotVaultRoot);
    }
  });

  test("defers raw and derived snapshot artifacts before mailbox import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-artifact-"));
    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-source-artifact-"));
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const artifactLabelsByHash = new Map<string, string>();
    const eagerArtifactSpec = {
      bytes: Buffer.from("capture-artifact\n", "utf8"),
      path: "raw/captures/example/capture.bin",
    } as const;
    const artifactSpecs = [
      {
        bytes: Buffer.from("pdf-binary-artifact\n", "utf8"),
        path: "raw/inbox/example/scan.pdf",
      },
      {
        bytes: Buffer.from("assistant-input-preview\n", "utf8"),
        path: "raw/inbox/example/preview.txt",
      },
      {
        bytes: Buffer.from("{\"schema\":\"example\"}\n", "utf8"),
        path: "derived/inbox/example/attachment/manifest.json",
      },
      {
        bytes: Buffer.from("assistant-input-derived-summary\n", "utf8"),
        path: "derived/inbox/example/attachment/summary.txt",
      },
    ] as const;

    for (const spec of [eagerArtifactSpec, ...artifactSpecs]) {
      const sourceArtifactPath = path.join(sourceVaultRoot, spec.path);
      await mkdir(path.dirname(sourceArtifactPath), { recursive: true });
      await writeFile(sourceArtifactPath, spec.bytes);
    }

    const eagerArtifactHash = sha256HostedBundleHex(eagerArtifactSpec.bytes);
    artifactLabelsByHash.set(eagerArtifactHash, "eager-raw-capture");
    const artifactHashes = artifactSpecs.map((spec) => sha256HostedBundleHex(spec.bytes));
    artifactHashes.forEach((hash, index) => {
      artifactLabelsByHash.set(hash, `restored-artifact-${index}`);
    });
    const sourceBundle = await snapshotHostedBundleRoots({
      externalizeFile: async (file) => {
        const spec = [eagerArtifactSpec, ...artifactSpecs].find((entry) => entry.path === file.path);
        if (!spec) {
          return null;
        }

        return {
          byteSize: file.bytes.byteLength,
          sha256: sha256HostedBundleHex(file.bytes),
        };
      },
      kind: "vault",
      roots: [
        {
          root: sourceVaultRoot,
          rootKey: "vault",
        },
      ],
    });
    assert.ok(sourceBundle);
    const bundleHash = sha256HostedBundleHex(sourceBundle);
    artifactLabelsByHash.set(bundleHash, "workspace-bundle");
    const artifactBytesByHash = new Map<string, Uint8Array>(
      [
        [eagerArtifactHash, eagerArtifactSpec.bytes],
        ...artifactSpecs.map((spec, index) => [artifactHashes[index]!, spec.bytes] as const),
      ],
    );
    artifactBytesByHash.set(bundleHash, sourceBundle);

    try {
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "9",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/restored-artifact.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            for (const spec of [eagerArtifactSpec, ...artifactSpecs]) {
              const restoredArtifactPath = path.join(vaultRoot, spec.path);
              await assert.rejects(readFile(restoredArtifactPath, "utf8"));
            }
            return { status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash,
            artifactGetCalls,
            artifactLabelsByHash,
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_restored_artifact",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: createBundleRef({
                  hash: bundleHash,
                  key: "users/bundles/member-synthetic/restored-artifact-before-import.bundle.json",
                  size: sourceBundle.byteLength,
                }),
                version: "9",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      await drainHostedRuntimeLogWritesBestEffort();
      const mailboxFetchIndex = requireEventIndex(events, "mailbox.fetch");
      assert.equal(events.includes("artifact.get:eager-raw-capture"), false);
      for (const [index] of artifactHashes.entries()) {
        assert.equal(events.includes(`artifact.get:restored-artifact-${index}`), false);
      }
      assert.ok(mailboxFetchIndex >= 0);
      assert.deepEqual(artifactGetCalls, [bundleHash]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceVaultRoot);
    }
  });

  test("profiles pre-import work with many restored artifacts and mailbox messages", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-load-"));
    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-source-load-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactGetCalls: string[] = [];
    const artifactPutCalls: Array<{ byteLength: number; sha256: string }> = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const events: string[] = [];
    const stageSamples: StageTimingSample[] = [];
    const artifactLabelsByHash = new Map<string, string>();
    const externalArtifactCount = 48;
    const inlineFileCount = 80;
    const mailboxItemCount = 75;
    const artifactSpecs: Array<{ bytes: Uint8Array; label: string; path: string }> = [];
    const inlineFileSpecs: Array<{ text: string; path: string }> = [];

    try {
      for (let index = 0; index < externalArtifactCount; index += 1) {
        const label = `artifact-${String(index + 1).padStart(3, "0")}`;
        const artifactPath = `raw/inbox/pre-import-load/${label}.bin`;
        const bytes = Buffer.from(
          `${label}\n${"synthetic attachment bytes ".repeat(64)}\n`,
          "utf8",
        );
        artifactSpecs.push({
          bytes,
          label,
          path: artifactPath,
        });
        const sourceArtifactPath = path.join(sourceVaultRoot, artifactPath);
        await mkdir(path.dirname(sourceArtifactPath), { recursive: true });
        await writeFile(sourceArtifactPath, bytes);
      }

      for (let index = 0; index < inlineFileCount; index += 1) {
        const notePath = path.join(
          sourceVaultRoot,
          "bank",
          "pre-import-load",
          `note-${String(index + 1).padStart(3, "0")}.md`,
        );
        const noteText = `# Synthetic note ${index + 1}\n\n${"workspace restore metadata ".repeat(48)}\n`;
        inlineFileSpecs.push({
          path: path.join("bank", "pre-import-load", `note-${String(index + 1).padStart(3, "0")}.md`),
          text: noteText,
        });
        await mkdir(path.dirname(notePath), { recursive: true });
        await writeFile(notePath, noteText, "utf8");
      }

      const artifactSpecByPath = new Map(artifactSpecs.map((spec) => [spec.path, spec]));
      const artifactHashes = artifactSpecs.map((spec) => {
        const sha256 = sha256HostedBundleHex(spec.bytes);
        artifactLabelsByHash.set(sha256, spec.label);
        return sha256;
      });
      const sourceBundle = await snapshotHostedBundleRoots({
        externalizeFile: async (file) => {
          const spec = artifactSpecByPath.get(file.path);
          if (!spec) {
            return null;
          }

          return {
            byteSize: file.bytes.byteLength,
            sha256: sha256HostedBundleHex(file.bytes),
          };
        },
        kind: "vault",
        roots: [
          {
            root: sourceVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(sourceBundle);
      const bundleHash = sha256HostedBundleHex(sourceBundle);
      artifactLabelsByHash.set(bundleHash, "workspace-bundle");
      const artifactBytesByHash = new Map<string, Uint8Array>(
        artifactSpecs.map((spec, index) => [artifactHashes[index]!, spec.bytes]),
      );
      artifactBytesByHash.set(bundleHash, sourceBundle);
      const mailboxItems = Array.from({ length: mailboxItemCount }, (_, index) =>
        createMailboxItem({
          id: `mailbox_item_entrypoint_load_${String(index + 1).padStart(3, "0")}`,
          laneSeq: String(index + 1),
          payloadBytes: 256,
        })
      );
      const importedSeqs: string[] = [];
      const mailboxPort = createMailboxPort({
        events,
        items: mailboxItems,
        stageSamples,
      });
      const workspacePort = createWorkspacePort({
        checkpointRequests,
        events,
        stageSamples,
        workspace: createWorkspaceState({
          redactedStatus: {
            hostedMailboxConversationImportedSeq: "0",
            hostedMailboxSystemImportedSeq: "0",
          },
          snapshotRef: createBundleRef({
            hash: bundleHash,
            key: "users/bundles/member-synthetic/pre-import-load.bundle.json",
            size: sourceBundle.byteLength,
          }),
          version: "12",
        }),
      });
      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        artifactLabelsByHash,
        artifactPutCalls,
        events,
        logRequests,
        mailboxPort,
        stageSamples,
        workspacePort,
      });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_workspace_preimport_load",
            budget: {
              maxMailboxItems: mailboxItemCount,
            },
            leaseGeneration: "3",
            workspaceVersion: "12",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            return await measureStage(stageSamples, "snapshot.create", async () => {
              events.push(`snapshot.create:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
              assert.equal(
                (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
                String(mailboxItemCount),
              );
              const snapshotBytes = await snapshotHostedBundleRoots({
                kind: "vault",
                roots: [
                  {
                    root: vaultRoot,
                    rootKey: "vault",
                  },
                ],
              });
              if (!snapshotBytes) {
                throw new Error("Expected checkpoint snapshot bytes.");
              }
              const snapshotHash = sha256HostedBundleHex(snapshotBytes);
              artifactLabelsByHash.set(snapshotHash, "checkpoint-snapshot");
              await platform.artifactStore.put({
                bytes: snapshotBytes,
                sha256: snapshotHash,
              });
              return {
                snapshotRef: createBundleRef({
                  hash: snapshotHash,
                  key: "users/bundles/member-synthetic/pre-import-load-after-import.bundle.json",
                  size: snapshotBytes.byteLength,
                }),
              };
            });
          },
          async importItem(item) {
            return await measureStage(stageSamples, "mailbox.importItem", async () => {
              importedSeqs.push(item.item.laneSeq);
              events.push(`import:${item.item.laneSeq}`);
              if (importedSeqs.length === 1) {
                for (const spec of artifactSpecs) {
                  await assert.rejects(readFile(path.join(vaultRoot, spec.path), "utf8"));
                }
                for (const spec of inlineFileSpecs) {
                  assert.equal(await readFile(path.join(vaultRoot, spec.path), "utf8"), spec.text);
                }
              }
              return { status: "imported" };
            });
          },
          platform,
          vaultRoot,
        },
      );

      const mailboxFetchIndex = requireEventIndex(events, "mailbox.fetch");
      const firstArtifactFetchIndex = requireEventIndex(events, "artifact.get:workspace-bundle");
      const importedEvents = events.filter((event) => event.startsWith("import:"));
      const mailboxImportedLogIndex = requireEventIndex(events, "runtime.log:mailbox.imported");
      const mailboxImportedLog = logRequests
        .flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.imported");
      const stageSummary = summarizeStageTimings(stageSamples);
      assert.ok(mailboxImportedLog);

      assert.equal(events[0], "workspace.read");
      assert.ok(firstArtifactFetchIndex < mailboxFetchIndex);
      assert.deepEqual(artifactGetCalls, [bundleHash]);
      for (const artifactHash of artifactHashes) {
        assert.equal(
          events.includes(`artifact.get:${artifactLabelsByHash.get(artifactHash)}`),
          false,
        );
      }
      assert.equal(importedEvents.length, mailboxItemCount);
      assert.deepEqual(importedSeqs, mailboxItems.map((item) => item.laneSeq));
      assert.equal(artifactPutCalls.length, 1);
      assert.ok(mailboxFetchIndex < mailboxImportedLogIndex);
      assert.equal(stageSummary["workspace.read"]?.count, 1);
      assert.equal(stageSummary["artifact.get"]?.count, 1);
      assert.equal(stageSummary["mailbox.fetch"]?.count, 1);
      assert.equal(stageSummary["mailbox.importItem"]?.count, mailboxItemCount);
      assert.equal(stageSummary["snapshot.create"]?.count ?? 0, 1);
      assert.equal(stageSummary["artifact.put"]?.count ?? 0, 1);
      assert.equal(stageSummary["workspace.checkpoint"]?.count ?? 0, 1);
      assert.ok((stageSummary["runtime.log.write"]?.count ?? 0) >= 1);
      for (const key of Object.keys(mailboxImportedLog.redactedJson ?? {})) {
        assert.doesNotMatch(key, /(?:body|cipher|file|id|path|payload|ref)/iu);
      }
      assert.equal(mailboxImportedLog.redactedJson?.fetchedCount, mailboxItemCount);
      assert.equal(mailboxImportedLog.redactedJson?.importedCount, mailboxItemCount);
      assert.equal(mailboxImportedLog.redactedJson?.checkpointDeferred, true);
      assert.equal(mailboxImportedLog.redactedJson?.checkpointed, false);
      assert.equal(mailboxImportedLog.redactedJson?.conversationSeqEnd, String(mailboxItemCount));
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: String(mailboxItemCount),
          hostedMailboxFetchedCount: mailboxItemCount,
          hostedMailboxImportedCount: mailboxItemCount,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemHandledThroughSeq: "0",
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceVaultRoot);
    }
  });

  test("creates a null-bootstrap local workspace when no snapshot exists", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const artifactGetCalls: string[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(
            `snapshot:${await describeCheckpointConversationWatermarkTransition(snapshotInput, vaultRoot)}`,
          );
          return {
            snapshotRef: createBundleRef({
              hash: "e".repeat(64),
              key: "users/bundles/member-synthetic/null-bootstrap.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem() {
          events.push("import");
          return { status: "imported" };
        },
        platform: createPlatform({
          artifactGetCalls,
          mailboxPort: createMailboxPort({
            events,
            fetchRequests,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_null_bootstrap",
                laneSeq: "1",
              }),
            ],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: null,
          }),
        }),
        vaultRoot,
      });

      assert.deepEqual(artifactGetCalls, []);
      assert.equal(
        fetchRequests[0]?.lanes.find((lane) => lane.lane === "conversation")?.importedSeq,
        "0",
      );
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import",
        "snapshot:idle->1",
        "workspace.checkpoint",
      ]);
      await assertPrivateDirectoryMode(vaultRoot);
      await assertPrivateDirectoryMode(
        resolveAssistantStatePaths(path.resolve(vaultRoot)).assistantStateRoot,
      );
      await assertPrivateDirectoryMode(
        path.join(path.dirname(path.resolve(vaultRoot)), `${path.basename(vaultRoot)}-operator-home`),
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fails closed before mailbox fetch when an existing snapshot is unavailable", async () => {
    const events: string[] = [];
    const artifactGetCalls: string[] = [];
    const snapshotHash = "f".repeat(64);

    await expect(
      runHostedWorkspaceRuntimeJobInProcess({
        request: createWorkspaceRunRequest({
          workspaceVersion: "2",
        }),
      }, {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run when restore fails.");
        },
        async importItem() {
          throw new Error("Import should not run when restore fails.");
        },
        platform: createPlatform({
          artifactGetCalls,
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({
              snapshotRef: createBundleRef({
                hash: snapshotHash,
                key: "users/bundles/member-synthetic/missing.bundle.json",
                size: 512,
              }),
              version: "2",
            }),
          }),
        }),
        vaultRoot: "synthetic-vault-root",
      }),
    ).rejects.toThrow(/snapshot restore failed/u);

    assert.deepEqual(events, ["workspace.read"]);
    assert.deepEqual(artifactGetCalls, [snapshotHash]);
  });

  test("fails closed before workspace read when runtime budget is requested", async () => {
    const events: string[] = [];

    await expect(
      runHostedWorkspaceRuntimeJobInProcess({
        request: createWorkspaceRunRequest({
          budget: {
            maxRuntimeMs: 30_000,
          },
        }),
      }, {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run with unsupported runtime budget.");
        },
        async importItem() {
          throw new Error("Import should not run with unsupported runtime budget.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot: "synthetic-vault-root",
      }),
    ).rejects.toThrow(/budget\.maxRuntimeMs is not supported yet/u);
    assert.deepEqual(events, []);
  });

  });
