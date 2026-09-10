import { snapshotHostedPortableWorkspaceDelta } from "@murphai/runtime-state/node";
import type {
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
  HostedMailboxItem,
  HostedMailboxPayloadFetchRequest,
  HostedMailboxPayloadFetchResponse,
  HostedRuntimeLogRequest,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceReadResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedRuntimeMailboxPort,
  RuntimeLivenessPort,
  HostedRuntimeWorkspacePort,
  HostedRuntimeWorkspaceSnapshotPort,
  HostedRuntimePlatform,
} from "../src/hosted-runtime-contracts.ts";

import {
  TEST_NOW,
  TEST_USER_ID,
  assertPrivateDirectoryMode,
  continueRuntimeLiveness,
  createSnapshotFixtureRef,
  createVaultSnapshotBundle,
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
  mocks,
  readCheckpointConversationWatermark,
  readConversationImportedSeq,
  readConversationImportedSeqs,
  removeTempRoot,
  requireEventIndex,
  runHostedWorkspaceRuntimeJobInProcess,
  stagePendingLinqAssistantInputForMailboxItem,
  waitUntil,
  writeMailboxImportStateFile,
  writeSyntheticAssistantAutoReplyTerminalEvidence,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

import assert from "node:assert/strict";
import { mkdir,
  mkdtemp,
  readFile,
  writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  initializeVault,
  runCanonicalWrite,
} from "@murphai/core";
import {
  readAssistantInputEvent,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine/assistant-automation";
import {
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
  writeHostedBundleTextFile,
} from "@murphai/runtime-state/node";
import {
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  type HostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/runtime-control";

import { describe, expect, test, vi } from "vitest";
import {
  createCoalescingRuntimeWakeSignal,
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  HostedWorkspaceRunnerUserMismatchError,
} from "../src/hosted-runtime.ts";
import {
  startHostedWorkspaceRestorePreparation,
} from "../src/hosted-workspace-restore-preparation.ts";
import {
  compactHostedPendingAssistantInputIds,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  createEmptyHostedMailboxImportState,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
  HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import { drainHostedRuntimeLogWritesBestEffort } from "../src/hosted-runtime/runtime-logs.ts";

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
  test.each(["flat", "nested"] as const)("restores %s fixture vault roots while removing stale files", async (layout) => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-fixture-layout-"));
    const sourceVaultRoot = path.join(tempRoot, "source");
    const durableRoot = path.join(tempRoot, "durable");
    const vaultRelativePath = layout === "nested" ? "vault" : undefined;
    const vaultRoot = path.join(durableRoot, vaultRelativePath ?? "");

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceVaultRoot });
      const inputId = await stagePendingLinqAssistantInputForMailboxItem({
        item: createMailboxItem({ id: "mailbox_fixture_layout", laneSeq: "1" }),
        vaultRoot: sourceVaultRoot,
      });
      const snapshot = await createVaultSnapshotBundle({ vaultRoot: sourceVaultRoot });
      await mkdir(vaultRoot, { recursive: true });
      await writeFile(path.join(vaultRoot, "stale.md"), "remove me\n");
      const platform = createPlatform({
        artifactBytesByHash: new Map([[snapshot.hash, snapshot.bytes]]),
        mailboxPort: null,
        snapshotFixtureVaultRelativePath: vaultRelativePath,
        workspacePort: null,
      });
      assert.ok(platform.workspaceSnapshotPort);
      await platform.workspaceSnapshotPort.restoreWorkspaceSnapshot({
        durableRoot,
        ref: snapshot.snapshotRef,
        signal: null,
      });

      assert.equal(
        await readFile(path.join(vaultRoot, "vault.json"), "utf8"),
        await readFile(path.join(sourceVaultRoot, "vault.json"), "utf8"),
      );
      assert.ok(await readAssistantInputEvent({ inputId, vault: vaultRoot }));
      await assert.rejects(readFile(path.join(vaultRoot, "stale.md")), { code: "ENOENT" });
      if (layout === "nested") {
        await assert.rejects(readFile(path.join(durableRoot, "vault.json")), { code: "ENOENT" });
      }
    } finally {
      await removeTempRoot(tempRoot);
    }
  });

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
    const snapshotId = "snapshot-default-restore-path";
    const fixture = await createWorkspaceRestoreFixture(snapshotId);

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
      const checkpointBuilderInput =
        mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.mock.calls.at(-1)?.[0];
      assert.deepEqual(
        checkpointBuilderInput?.metadata.currentSnapshotRef,
        createWorkspaceSnapshotV2Ref(snapshotId),
      );
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
    mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.mockImplementation((...args) => {
      assert.ok(restoreBuilder);
      return { ...restoreBuilder(...args), createRequest, checkpoint: async () => createRequest() };
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
        snapshotRef: createSnapshotFixtureRef({
          hash: "b".repeat(64),
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
        snapshotRef: createSnapshotFixtureRef({
          hash: "5".repeat(64),
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
        if (fetchCount === 4) {
          assert.deepEqual(request.lanes.map((lane) => lane.lane), ["system"]);
        }
        const lateItem = createMailboxItem({
          id: "mailbox_item_entrypoint_late_active_turn",
          laneSeq: "1",
        });
        const itemVisible = request.lanes.some((lane) =>
          lane.lane === lateItem.lane
          && BigInt(lateItem.laneSeq) > BigInt(lane.importedSeq)
        );
        return {
          assistantProvider: "openai",
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
      assert.ok(requireEventIndex(events, "mailbox.fetch:1") < requireEventIndex(events, "import:1"));
      assert.deepEqual(events.filter((event) => !event.startsWith("mailbox.fetch:")), [
        "workspace.read",
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
              snapshotRef: createSnapshotFixtureRef({
                hash: "6".repeat(64),
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
          assistantProvider: "openai",
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
            snapshotRef: createSnapshotFixtureRef({
              hash,
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
              snapshotRef: createSnapshotFixtureRef({
                hash: "8".repeat(64),
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
        if (fetchCount === 4) {
          assert.deepEqual(request.lanes.map((lane) => lane.lane), ["system"]);
        }
        const itemVisible = request.lanes.some((lane) =>
          lane.lane === sidecarItem.lane
          && BigInt(sidecarItem.laneSeq) > BigInt(lane.importedSeq)
        );
        return {
          assistantProvider: "openai",
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
            snapshotRef: createSnapshotFixtureRef({
              hash: "6".repeat(64),
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
        "mailbox.fetch:4",
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
          hostedMailboxSystemFirstPendingDiagnostics: null,
          hostedMailboxSystemFirstPendingClassifierFailures: null,
          hostedMailboxSystemFirstPendingSeq: null,
          hostedMailboxSystemHandledThroughSeq: "0",
          hostedMailboxSystemImportedSeq: "0",
          hostedMailboxSystemDeviceSyncContinuationSeqs: [],
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
              snapshotRef: createSnapshotFixtureRef({
                hash: "c".repeat(64),
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
    await writeFile(path.join(sourceVaultRoot, "raw", "artifact.txt"), rawArtifactBytes);
    const sourceBundle = await snapshotHostedBundleRoots({
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
              snapshotRef: createSnapshotFixtureRef({
                hash: "d".repeat(64),
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
                snapshotRef: createSnapshotFixtureRef({
                  hash: bundleHash,
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
              snapshotRef: createSnapshotFixtureRef({
                hash: "e".repeat(64),
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
                snapshotRef: createSnapshotFixtureRef({
                  hash: bundle.hash,
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
            snapshotRef: createSnapshotFixtureRef({
              hash: bundle.hash,
              size: bundle.bytes.byteLength,
            }),
            version: "9",
          }),
        }),
      });
      assert.ok(platform.workspaceSnapshotPort);
      const snapshotPort = platform.workspaceSnapshotPort;
      const platformWithAppendDuringRestore: HostedRuntimePlatform = {
        ...platform,
        workspaceSnapshotPort: {
          ...snapshotPort,
          async restoreWorkspaceSnapshot(input) {
            await snapshotPort.restoreWorkspaceSnapshot(input);
            events.push("snapshot.restore");
            mailboxItems.push(createMailboxItem({
              id: "mailbox_item_entrypoint_prefetch_stale_new",
              laneSeq: "4",
            }));
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
              snapshotRef: createSnapshotFixtureRef({
                hash: "9".repeat(64),
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
        "snapshot.restore",
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
                snapshotRef: createSnapshotFixtureRef({
                  hash: "f".repeat(64),
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
                  snapshotRef: createSnapshotFixtureRef({
                    hash: bundle.hash,
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
      const baseRef = createSnapshotFixtureRef({
        hash: baseHash,
        size: baseBundle.byteLength,
      });
      artifactBytesByHash.set(baseHash, baseBundle);

      let currentWorkspace = createWorkspaceState({ snapshotRef: baseRef, version: "9" });
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
              const snapshot = await createVaultSnapshotBundle({ vaultRoot });
              artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
              return { snapshotRef: snapshot.snapshotRef };
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
      assert.deepEqual(artifactGetCalls, [baseHash]);
      artifactGetCalls.length = 0;

      await runOnce(2);
      assert.deepEqual(importedSeqs, ["1"]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(artifactGetCalls.length, 1);
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
      const baseRef = createSnapshotFixtureRef({
        hash: baseHash,
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
      const snapshot = await createVaultSnapshotBundle({ vaultRoot: sourceHotVaultRoot });
      artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
      const workspace = createWorkspaceState({ snapshotRef: snapshot.snapshotRef, version: "9" });
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
      assert.deepEqual(artifactGetCalls, [snapshot.hash]);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "1");
      assert.ok(requireEventIndex(events, "workspace.read") < requireEventIndex(events, "mailbox.fetch"));
      assert.ok(requireEventIndex(events, "mailbox.fetch") < requireEventIndex(events, "assistant"));
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceHotVaultRoot);
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
            snapshotRef: createSnapshotFixtureRef({
              hash: "e".repeat(64),
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
              snapshotRef: createSnapshotFixtureRef({
                hash: snapshotHash,
                size: 512,
              }),
              version: "2",
            }),
          }),
        }),
        vaultRoot: "synthetic-vault-root",
      }),
    ).rejects.toThrow(/Workspace snapshot fixture is unavailable/u);

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
