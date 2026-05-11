import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
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
  createHostedPortableWorkspaceManifestFromBundle,
  snapshotHostedPortableWorkspaceDelta,
  snapshotHostedAssistantRuntimeHotState,
  snapshotHostedBundleRoots,
  writeHostedBundleTextFile,
} from "@murphai/runtime-state/node";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxPayloadFetchRequest,
  type HostedMailboxPayloadFetchResponse,
  type HostedRuntimeLogRequest,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceInvocationResult,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionLayeredSnapshotRef,
  buildHostedExecutionWorkingSnapshotRef,
  readHostedExecutionSnapshotBaseRef,
} from "@murphai/hosted-execution/parsers";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedWorkspaceSnapshotCheckpointRequestBuilder: vi.fn(),
  ensureHostedInboxSidecarReady: vi.fn(),
  snapshotHostedPortableWorkspaceDelta: vi.fn(),
}));

vi.mock("@murphai/runtime-state/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/runtime-state/node")>();

  return {
    ...actual,
    snapshotHostedPortableWorkspaceDelta:
      mocks.snapshotHostedPortableWorkspaceDelta.mockImplementation(
        actual.snapshotHostedPortableWorkspaceDelta,
      ),
  };
});

vi.mock("../src/hosted-runtime/context.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/context.ts")>();

  return {
    ...actual,
    ensureHostedInboxSidecarReady: mocks.ensureHostedInboxSidecarReady.mockImplementation(
      actual.ensureHostedInboxSidecarReady,
    ),
  };
});

vi.mock("../src/hosted-runtime/workspace-runner.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/workspace-runner.ts")>();

  return {
    ...actual,
    createHostedWorkspaceSnapshotCheckpointRequestBuilder:
      mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.mockImplementation(
        actual.createHostedWorkspaceSnapshotCheckpointRequestBuilder,
      ),
  };
});

import {
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  HostedWorkspaceRuntimeLivenessRejectedError,
  HostedWorkspaceRunnerUserMismatchError,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
} from "../src/hosted-runtime.ts";
import {
  ensureHostedInboxSidecarReady,
} from "../src/hosted-runtime/context.ts";
import {
  markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort,
} from "../src/hosted-runtime/workspace-restore.ts";
import {
  createEmptyHostedMailboxImportState,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
  HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
  readHostedMailboxImportState,
  type HostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import type {
  HostedRuntimeMailboxPort,
  HostedRuntimePlatform,
  RuntimeLivenessPort,
  RuntimeLivenessTouchResult,
  HostedRuntimeWorkspacePort,
} from "../src/hosted-runtime-contracts.ts";

const TEST_NOW = "2026-04-27T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_workspace_entrypoint";
const TEST_HOSTED_CODEX_FORWARDED_ENV = {
  HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
  HOSTED_ASSISTANT_PROVIDER: "openai",
  OPENAI_API_KEY: "test-vercel-key",
} as const;

function continueRuntimeLiveness(): RuntimeLivenessTouchResult {
  return {
    instruction: { kind: "continue" },
    ok: true,
  };
}

function yieldRuntimeLiveness(nextWakeAt: string | null): RuntimeLivenessTouchResult {
  return {
    instruction: {
      kind: "yield",
      nextWakeAt,
      status: "scheduled",
    },
    inputAvailable: true,
    nextAlarmAt: nextWakeAt,
    ok: true,
    pendingNudge: true,
  };
}

function requireMailboxSnapshotInput(
  input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
) {
  if (!("state" in input) || !("previousState" in input)) {
    throw new Error("Expected mailbox checkpoint snapshot input.");
  }
  return input;
}

describe("hosted workspace runtime entrypoint", () => {
  test("reads workspace, imports mailbox prefix, snapshots through the semantic checkpoint builder, and checkpoints", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const items = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_001",
        laneSeq: "1",
      }),
    ];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      events,
      workspace: createWorkspaceState({ version: "0" }),
    });
    const mailboxPort = createMailboxPort({ events, items });
    const imported: Array<{ id: string; route: string }> = [];
    const ambientHome = process.env.HOME;

    try {
      const ensureHostedInboxSidecarReadyImpl =
        mocks.ensureHostedInboxSidecarReady.getMockImplementation();
      assert.ok(ensureHostedInboxSidecarReadyImpl);
      mocks.ensureHostedInboxSidecarReady.mockImplementationOnce(async (input) => {
        events.push("sidecar.ready");
        assert.equal(input.bestEffort, true);
        assert.equal(input.rebuild, false);
        assert.equal(input.requestId, "hosted-workspace-invocation:attempt_synthetic_workspace_entrypoint");
        assert.equal(input.vaultRoot, path.resolve(vaultRoot));
        return await ensureHostedInboxSidecarReadyImpl(input);
      });

      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_workspace_entrypoint",
            budget: {
              maxMailboxItems: 10,
            },
            leaseGeneration: "7",
            reason: "nudge",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            const state = await readHostedMailboxImportState({ vaultRoot });
            events.push(`snapshot:${state.watermarks.conversation}`);
            assert.equal(requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation, "1");
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/workspace-entrypoint.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            assert.equal(process.env.VAULT, path.resolve(vaultRoot));
            assert.notEqual(process.env.HOME, ambientHome);
            imported.push({
              id: item.item.id,
              route: item.route.action,
            });
            events.push(`import:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort,
            workspacePort,
          }),
          vaultRoot,
        });
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:mailbox_item_entrypoint_001",
        "sidecar.ready",
      ]);
      assert.deepEqual(imported, [
        {
          id: "mailbox_item_entrypoint_001",
          route: "import-conversation-message",
        },
      ]);
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(result, {
        deferredCheckpointRequired: true,
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 1,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runs idle-shutdown checkpoint without mailbox, sidecar, assistant, or usage work", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      events,
      workspace: createWorkspaceState({
        redactedStatus: {
          preservedStatus: true,
        },
        version: "4",
      }),
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            assert.equal(snapshotInput.reason, "idle_shutdown");
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/idle-shutdown.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            workspacePort,
          }),
          vaultRoot,
        });

      assert.deepEqual(events, [
        "workspace.read",
        "snapshot:idle_shutdown",
        "workspace.checkpoint",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.attemptId, "attempt_synthetic_idle_shutdown");
      assert.equal(checkpointRequests[0]?.expectedWorkspaceVersion, "4");
      assert.equal(checkpointRequests[0]?.leaseGeneration, "9");
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.deepEqual(checkpointRequests[0]?.redactedStatus, {
        preservedStatus: true,
      });
      assert.deepEqual(result, {
        idleShutdownCheckpointed: true,
        redactedStatus: {
          preservedStatus: true,
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("preserves future workspace wake during idle-shutdown checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      checkpointWorkspace: (request) => createWorkspaceState({
        nextWakeAt: request.nextWakeAt ?? null,
        nextWakeReason: request.nextWakeReason ?? null,
        redactedStatus: request.redactedStatus ?? null,
        snapshotRef: request.snapshotRef,
        version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
      }),
      events,
      workspace: createWorkspaceState({
        nextWakeAt: "2026-04-20T08:10:00.000Z",
        nextWakeReason: "device-sync.reconcile",
        version: "4",
      }),
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_future_wake",
            checkpointNextWakeAt: "2026-04-20T08:10:00.000Z",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            assert.equal(snapshotInput.reason, "idle_shutdown");
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/idle-shutdown.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            workspacePort,
          }),
          vaultRoot,
        });

      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, "2026-04-20T08:10:00.000Z");
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.deepEqual(result, {
        idleShutdownCheckpointed: true,
        nextWakeAt: "2026-04-20T08:10:00.000Z",
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("publishes restored mailbox watermarks during idle-shutdown checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const restoredState = createEmptyHostedMailboxImportState();
    restoredState.watermarks.conversation = "546";
    restoredState.watermarks.system = "7";
    const workspaceSnapshotRef = createBundleRef({
      hash: "e".repeat(64),
      key: "users/bundles/member-synthetic/idle-shutdown-source.bundle.json",
      size: 640,
    });
    const redactedStatus = {
      hostedMailboxConversationImportedSeq: "444",
      hostedMailboxFetchedCount: 50,
      hostedMailboxSystemImportedSeq: "0",
      preservedStatus: true,
    };
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      events,
      workspace: createWorkspaceState({
        redactedStatus,
        snapshotRef: workspaceSnapshotRef,
        version: "4",
      }),
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await writeMailboxImportStateFile(vaultRoot, restoredState);
      await markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort({
        snapshotRef: workspaceSnapshotRef,
        vaultRoot,
      });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_mailbox_status",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            assert.equal(snapshotInput.reason, "idle_shutdown");
            assert.deepEqual(snapshotInput.redactedStatus, {
              ...redactedStatus,
              hostedMailboxConversationImportedSeq: "546",
              hostedMailboxSystemImportedSeq: "7",
            });
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/idle-shutdown.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            workspacePort,
          }),
          vaultRoot,
        });

      assert.equal(checkpointRequests.length, 1);
      assert.deepEqual(checkpointRequests[0]?.redactedStatus, {
        ...redactedStatus,
        hostedMailboxConversationImportedSeq: "546",
        hostedMailboxSystemImportedSeq: "7",
      });
      assert.deepEqual(result, {
        idleShutdownCheckpointed: true,
        redactedStatus: {
          ...redactedStatus,
          hostedMailboxConversationImportedSeq: "546",
          hostedMailboxSystemImportedSeq: "7",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("skips idle-shutdown checkpoint when the live warm snapshot marker is missing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      events,
      workspace: createWorkspaceState({
        snapshotRef: createBundleRef({
          hash: "f".repeat(64),
          key: "users/bundles/member-synthetic/idle-shutdown-missing-warm.bundle.json",
          size: 640,
        }),
        version: "4",
      }),
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_missing_warm_workspace",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Idle-shutdown checkpoint must not snapshot without warm workspace.");
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            workspacePort,
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(events, ["workspace.read"]);
      assert.equal(checkpointRequests.length, 0);
      assert.deepEqual(result, {
        idleShutdownCheckpointSkipped: "warm_workspace_unavailable",
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("skips stale idle-shutdown checkpoint workspace versions without throwing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      events,
      workspace: createWorkspaceState({
        version: "5",
      }),
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_stale_workspace",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Idle-shutdown checkpoint must not snapshot stale workspace versions.");
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            workspacePort,
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(events, ["workspace.read"]);
      assert.equal(checkpointRequests.length, 0);
      assert.deepEqual(result, {
        idleShutdownCheckpointSkipped: "warm_workspace_unavailable",
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoints null-bootstrap idle-shutdown work when no workspace row exists", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_no_workspace",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            assert.equal(snapshotInput.reason, "idle_shutdown");
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/null-bootstrap-idle-shutdown.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: null,
            }),
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(events, [
        "workspace.read",
        "snapshot:idle_shutdown",
        "workspace.checkpoint",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.expectedWorkspaceVersion, "0");
      assert.deepEqual(result, {
        idleShutdownCheckpointed: true,
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("skips idle-shutdown checkpoint when pre-snapshot liveness reports input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let touchCalls = 0;
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        touchCalls += 1;
        events.push(`heartbeat:${touchCalls}`);
        if (touchCalls === 1) {
          return continueRuntimeLiveness();
        }
        return {
          inputAvailable: true,
          nextAlarmAt: "2026-04-27T00:00:45.000Z",
          ok: true,
          pendingNudge: true,
        };
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_liveness",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Idle-shutdown checkpoint must not snapshot after input appears.");
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            runtimeLivenessIntervalMs: 1,
            runtimeLivenessPort,
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push("workspace.checkpoint.start");
                checkpointRequests.push(request);
                await new Promise<void>((resolve) => {
                  setTimeout(resolve, 25);
                });
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

      assert.deepEqual(result, {
        nextWakeAt: "2026-04-27T00:00:45.000Z",
        status: "scheduled",
      });
      assert.equal(checkpointRequests.length, 0);
      assert.equal(touchCalls, 2);
      assert.deepEqual(events, [
        "heartbeat:1",
        "workspace.read",
        "heartbeat:2",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("skips idle-shutdown checkpoint commit when liveness reports input during snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let touchCalls = 0;
    let releaseSnapshot: () => void = () => undefined;
    const snapshotReleased = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    const snapshotAttempts: Promise<void>[] = [];
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        touchCalls += 1;
        events.push(`heartbeat:${touchCalls}`);
        if (touchCalls < 3) {
          return continueRuntimeLiveness();
        }
        return {
          inputAvailable: true,
          nextAlarmAt: "2026-04-27T00:00:45.000Z",
          ok: true,
          pendingNudge: true,
        };
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_snapshot_liveness",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            events.push("snapshot.start");
            const snapshotAttempt = (async () => {
              await vi.waitFor(() => expect(touchCalls).toBeGreaterThanOrEqual(3));
              await snapshotReleased;
              events.push("snapshot.finish");
            })();
            snapshotAttempts.push(snapshotAttempt);
            await snapshotAttempt;
            return {
              snapshotRef: buildHostedExecutionLayeredSnapshotRef({
                base: createBundleRef({
                  hash: "sha256:base",
                  key: "users/bundles/member-synthetic/base.bundle.json",
                  size: 1,
                }),
                hot: createBundleRef({
                  hash: "sha256:hot",
                  key: "users/bundles/member-synthetic/hot.bundle.json",
                  size: 1,
                }),
              }),
            };
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            runtimeLivenessIntervalMs: 1,
            runtimeLivenessPort,
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push("workspace.checkpoint");
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

      assert.deepEqual(result, {
        nextWakeAt: "2026-04-27T00:00:45.000Z",
        status: "scheduled",
      });
      assert.equal(checkpointRequests.length, 0);
      assert.deepEqual(events.slice(0, 3), [
        "heartbeat:1",
        "workspace.read",
        "heartbeat:2",
      ]);
      assert.ok(events.includes("heartbeat:3"));
      assert.equal(events.includes("workspace.checkpoint"), false);
      assert.equal(events.includes("snapshot.finish"), false);
      releaseSnapshot();
      await Promise.all(snapshotAttempts.map((attempt) => attempt.catch(() => undefined)));
      assert.equal(events.includes("workspace.checkpoint"), false);
    } finally {
      releaseSnapshot();
      await Promise.all(snapshotAttempts.map((attempt) => attempt.catch(() => undefined)));
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns scheduled promptly when liveness reports input while checkpoint RPC never resolves", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let checkpointStarted!: () => void;
    const checkpointStartedPromise = new Promise<void>((resolve) => {
      checkpointStarted = resolve;
    });
    let checkpointInFlight = false;
    let pendingReported = false;
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        if (checkpointInFlight && !pendingReported) {
          pendingReported = true;
          events.push("heartbeat:pending");
          return {
            inputAvailable: true,
            nextAlarmAt: "2026-04-27T00:00:45.000Z",
            ok: true,
            pendingNudge: true,
          };
        }
        events.push("heartbeat:ok");
        return continueRuntimeLiveness();
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_checkpoint_race",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            events.push("snapshot");
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/idle-shutdown-race.bundle.json",
                size: 256,
              }),
            };
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            runtimeLivenessIntervalMs: 1,
            runtimeLivenessPort,
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push("workspace.checkpoint.start");
                checkpointRequests.push(request);
                checkpointInFlight = true;
                checkpointStarted();
                return await new Promise<HostedWorkspaceCheckpointResponse>(() => undefined);
              },
            },
          }),
          vaultRoot,
        },
      );

      await checkpointStartedPromise;
      await vi.waitFor(() => expect(pendingReported).toBe(true));
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const result = await Promise.race([
        resultPromise,
        new Promise<"timeout">((resolve) => {
          timeout = setTimeout(() => resolve("timeout"), 100);
          timeout.unref?.();
        }),
      ]);
      if (timeout) {
        clearTimeout(timeout);
      }
      assert.deepEqual(result, {
        nextWakeAt: "2026-04-27T00:00:45.000Z",
        status: "scheduled",
      });
      assert.equal(checkpointRequests.length, 1);
      assert.ok(events.includes("heartbeat:pending"));
      assert.equal(events.includes("workspace.checkpoint.finish"), false);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns scheduled when an in-flight idle-shutdown checkpoint resolves uncommitted after liveness reports input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let checkpointStarted!: () => void;
    let releaseCheckpoint!: () => void;
    const checkpointStartedPromise = new Promise<void>((resolve) => {
      checkpointStarted = resolve;
    });
    const releaseCheckpointPromise = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    let checkpointInFlight = false;
    let pendingReported = false;
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        if (checkpointInFlight && !pendingReported) {
          pendingReported = true;
          events.push("heartbeat:pending");
          return {
            inputAvailable: true,
            nextAlarmAt: "2026-04-27T00:00:45.000Z",
            ok: true,
            pendingNudge: true,
          };
        }
        events.push("heartbeat:ok");
        return continueRuntimeLiveness();
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_checkpoint_race_uncommitted",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            events.push("snapshot");
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/idle-shutdown-race-uncommitted.bundle.json",
                size: 256,
              }),
            };
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            runtimeLivenessIntervalMs: 1,
            runtimeLivenessPort,
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push("workspace.checkpoint.start");
                checkpointRequests.push(request);
                checkpointInFlight = true;
                checkpointStarted();
                await releaseCheckpointPromise;
                events.push("workspace.checkpoint.finish");
                return {
                  checkpointed: false,
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

      await checkpointStartedPromise;
      await vi.waitFor(() => expect(pendingReported).toBe(true));
      await expect(resultPromise).resolves.toEqual({
        nextWakeAt: "2026-04-27T00:00:45.000Z",
        status: "scheduled",
      });
      assert.equal(checkpointRequests.length, 1);
      assert.ok(events.includes("heartbeat:pending"));
      assert.equal(events.includes("workspace.checkpoint.finish"), false);
      releaseCheckpoint();
      await vi.waitFor(() => expect(events).toContain("workspace.checkpoint.finish"));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns scheduled when an in-flight idle-shutdown checkpoint later rejects after liveness reports input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let checkpointStarted!: () => void;
    let releaseCheckpoint!: () => void;
    const checkpointStartedPromise = new Promise<void>((resolve) => {
      checkpointStarted = resolve;
    });
    const releaseCheckpointPromise = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    let checkpointInFlight = false;
    let pendingReported = false;
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        if (checkpointInFlight && !pendingReported) {
          pendingReported = true;
          events.push("heartbeat:pending");
          return {
            inputAvailable: true,
            nextAlarmAt: "2026-04-27T00:00:45.000Z",
            ok: true,
            pendingNudge: true,
          };
        }
        events.push("heartbeat:ok");
        return continueRuntimeLiveness();
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_checkpoint_race_reject",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            events.push("snapshot");
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/idle-shutdown-race-reject.bundle.json",
                size: 256,
              }),
            };
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            runtimeLivenessIntervalMs: 1,
            runtimeLivenessPort,
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push("workspace.checkpoint.start");
                checkpointRequests.push(request);
                checkpointInFlight = true;
                checkpointStarted();
                await releaseCheckpointPromise;
                events.push("workspace.checkpoint.reject");
                throw new Error("Synthetic checkpoint RPC failure.");
              },
            },
          }),
          vaultRoot,
        },
      );

      await checkpointStartedPromise;
      await vi.waitFor(() => expect(pendingReported).toBe(true));
      await expect(resultPromise).resolves.toEqual({
        nextWakeAt: "2026-04-27T00:00:45.000Z",
        status: "scheduled",
      });
      assert.equal(checkpointRequests.length, 1);
      releaseCheckpoint();
      await vi.waitFor(() => expect(events).toContain("workspace.checkpoint.reject"));
      assert.ok(events.includes("heartbeat:pending"));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns scheduled when an in-flight idle-shutdown checkpoint commits for another user after liveness reports input", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-parent-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const events: string[] = [];
    let checkpointStarted!: () => void;
    let releaseCheckpoint!: () => void;
    const checkpointStartedPromise = new Promise<void>((resolve) => {
      checkpointStarted = resolve;
    });
    const releaseCheckpointPromise = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    let checkpointInFlight = false;
    let pendingReported = false;
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        if (checkpointInFlight && !pendingReported) {
          pendingReported = true;
          return {
            inputAvailable: true,
            nextAlarmAt: "2026-04-27T00:00:45.000Z",
            ok: true,
            pendingNudge: true,
          };
        }
        return continueRuntimeLiveness();
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_checkpoint_wrong_user",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: buildHostedExecutionLayeredSnapshotRef({
                base: createBundleRef({
                  hash: "f".repeat(64),
                  key: "users/bundles/member-synthetic/idle-shutdown-wrong-user-base.bundle.json",
                  size: 256,
                }),
                hot: createBundleRef({
                  hash: "a".repeat(64),
                  key: "users/bundles/member-synthetic/idle-shutdown-wrong-user-hot.bundle.json",
                  size: 128,
                }),
              }),
            };
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            runtimeLivenessIntervalMs: 1,
            runtimeLivenessPort,
            workspacePort: {
              async read() {
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                checkpointInFlight = true;
                checkpointStarted();
                await releaseCheckpointPromise;
                events.push("workspace.checkpoint.finish");
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    userId: "member_synthetic_other",
                    version: "5",
                  }),
                };
              },
            },
          }),
          vaultRoot,
        },
      );

      await checkpointStartedPromise;
      await vi.waitFor(() => expect(pendingReported).toBe(true));
      await expect(resultPromise).resolves.toEqual({
        nextWakeAt: "2026-04-27T00:00:45.000Z",
        status: "scheduled",
      });
      releaseCheckpoint();
      await vi.waitFor(() => expect(events).toContain("workspace.checkpoint.finish"));
      await assert.rejects(readFile(
        path.join(
          path.dirname(path.resolve(vaultRoot)),
          ".hosted-workspace-hot-restore-cache.json",
        ),
        "utf8",
      ));
    } finally {
      await removeTempRoot(parentRoot);
    }
  });

  test("fails closed when an in-flight idle-shutdown checkpoint commits for another user without liveness interruption", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-shutdown-checkpoint-"));
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await expect(runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_idle_shutdown_checkpoint_wrong_user_no_liveness",
            leaseGeneration: "9",
            reason: "idle_shutdown_checkpoint",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/idle-shutdown-wrong-user.bundle.json",
                size: 256,
              }),
            };
          },
          async importItem() {
            throw new Error("Idle-shutdown checkpoint must not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: null,
            workspacePort: {
              async read() {
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    userId: "member_synthetic_other",
                    version: "5",
                  }),
                };
              },
            },
          }),
          vaultRoot,
        },
      )).rejects.toThrow(
        "Hosted mailbox import checkpoint returned an unexpected user.",
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("starts runtime liveness before workspace read and stops it after completion", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests: [],
      events,
      workspace: createWorkspaceState({ nextWakeAt: null, version: "0" }),
    });
    const mailboxPort = createMailboxPort({
      events,
      items: [],
    });
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        events.push("heartbeat");
        return continueRuntimeLiveness();
      },
    };

    try {
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
          attemptId: "attempt_synthetic_workspace_entrypoint",
          leaseGeneration: "7",
          reason: "nudge",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
        }),
      {
        async createCheckpointSnapshot() {
          events.push("snapshot");
          return {
            snapshotRef: createBundleRef({
              hash: "b".repeat(64),
              key: "users/bundles/member-synthetic/workspace-entrypoint-heartbeat.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem() {
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort,
          runtimeLivenessPort,
          workspacePort,
        }),
        vaultRoot,
      });

      assert.deepEqual(events.slice(0, 2), ["heartbeat", "workspace.read"]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fails closed while waiting for the initial runtime liveness heartbeat", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const initialTouch = createDeferred<Awaited<ReturnType<RuntimeLivenessPort["touch"]>>>();
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        events.push("heartbeat");
        return await initialTouch.promise;
      },
    };

    try {
      const run = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run after rejected liveness.");
        },
        async importItem() {
          throw new Error("Import should not run after rejected liveness.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          runtimeLivenessPort,
          workspacePort: {
            async checkpoint() {
              throw new Error("Checkpoint should not run after rejected liveness.");
            },
            async read() {
              events.push("workspace.read");
              return {
                fetchedAt: TEST_NOW,
                workspace: createWorkspaceState({ version: "0" }),
              };
            },
          },
        }),
        vaultRoot,
      });

      await waitUntil(() => assert.deepEqual(events, ["heartbeat"]));
      initialTouch.resolve({
        ok: false,
        reason: "stale_attempt",
      });

      await expect(run).rejects.toBeInstanceOf(HostedWorkspaceRuntimeLivenessRejectedError);
      assert.deepEqual(events, ["heartbeat"]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns scheduled when initial foreground liveness reports fresh input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const freshInputWakeAt = "2026-04-27T00:00:03.000Z";
    let touchCalls = 0;
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        touchCalls += 1;
        events.push(`heartbeat:${touchCalls}`);
        return {
          inputAvailable: true,
          nextAlarmAt: freshInputWakeAt,
          ok: true,
          pendingNudge: true,
        };
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_initial_foreground_liveness",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Foreground work must not checkpoint.");
          },
          async importItem() {
            throw new Error("No mailbox items should be imported.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            runtimeLivenessIntervalMs: 1,
            runtimeLivenessPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(result, {
        nextWakeAt: freshInputWakeAt,
        status: "scheduled",
      });
      assert.equal(touchCalls, 1);
      assert.deepEqual(events, ["heartbeat:1"]);
      assert.equal(checkpointRequests.length, 0);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("passes liveness cancellation into mailbox imports before import side effects", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    let touchCalls = 0;
    let importSideEffects = 0;
    let importStarted = false;
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        touchCalls += 1;
        events.push(`heartbeat:${touchCalls}`);
        if (touchCalls === 1 || !importStarted) {
          return continueRuntimeLiveness();
        }
        return {
          ok: false,
          reason: "stale_attempt",
        };
      },
    };

    try {
      const run = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run after rejected liveness.");
        },
        async importItem(_item, context) {
          importStarted = true;
          events.push("import.start");
          await new Promise<void>((resolve, reject) => {
            const signal = context?.signal ?? null;
            if (!signal) {
              reject(new Error("Import should receive liveness signal."));
              return;
            }
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener("abort", () => {
              events.push("import.abort");
              resolve();
            }, { once: true });
          });
          if (context?.signal?.aborted) {
            return {
              reasonCode: "liveness.aborted",
              status: "deferred",
            };
          }
          importSideEffects += 1;
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({
            events,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_liveness_import",
              }),
            ],
          }),
          runtimeLivenessIntervalMs: 100,
          runtimeLivenessPort,
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot,
      });
      const runResult = run.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ error, ok: false as const }),
      );

      await waitUntil(() => assert.ok(events.includes("import.start"), events.join(",")), 5_000);
      const result = await runResult;
      assert.equal(result.ok, false);
      assert.ok(result.error instanceof HostedWorkspaceRuntimeLivenessRejectedError);
      assert.equal(importSideEffects, 0);
      assert.equal(events[0], "heartbeat:1");
      assert.ok(events.indexOf("import.start") < events.indexOf("heartbeat:2"));
      assert.ok(events.indexOf("heartbeat:2") < events.indexOf("import.abort"));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("keeps foreground assistant work running when liveness reports only a pending nudge", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const freshInputWakeAt = "2026-04-27T00:00:03.000Z";
    let assistantStarted = false;
    let touchCalls = 0;
    const releaseAssistant = createDeferred<void>();
    let resultPromise: Promise<HostedWorkspaceInvocationResult> | null = null;
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        touchCalls += 1;
        events.push(`heartbeat:${touchCalls}`);
        if (!assistantStarted) {
          return continueRuntimeLiveness();
        }
        return {
          nextAlarmAt: freshInputWakeAt,
          ok: true,
          pendingNudge: true,
        };
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const activeRun = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          throw new Error("Foreground assistant work must not checkpoint.");
        },
        async importItem(item) {
          events.push(`import:${item.item.id}`);
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({
            events,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_fresh_input_preempts_active_work",
                laneSeq: "1",
              }),
            ],
          }),
          runtimeLivenessIntervalMs: 1,
          runtimeLivenessPort,
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        async runAssistantPhase() {
          assistantStarted = true;
          events.push("assistant.start");
          await releaseAssistant.promise;
          events.push("assistant.finish");
          return { progressed: false };
        },
        vaultRoot,
      });
      resultPromise = activeRun;
      let activeRunSettled = false;
      void activeRun.then(() => {
        activeRunSettled = true;
      }, () => {
        activeRunSettled = true;
      });

      await waitUntil(
        () => assert.ok(assistantStarted, events.join(",")),
        5_000,
      );
      await waitUntil(
        () => assert.ok(touchCalls >= 2, events.join(",")),
        5_000,
      );
      assert.equal(activeRunSettled, false);

      releaseAssistant.resolve();
      const result = await activeRun;
      assert.equal(result.status, "idle");
      assert.equal(events.includes("assistant.finish"), true);
      assert.ok(touchCalls >= 2);
    } finally {
      releaseAssistant.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("runs assistant outbox phase after restored mailbox checkpoint with restored vault root", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}:${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`);
          return {
            snapshotRef: createBundleRef({
              hash: snapshotInput.reason === "import" ? "1".repeat(64) : "2".repeat(64),
              key: `users/bundles/member-synthetic/${snapshotInput.reason}.bundle.json`,
              size: 512,
            }),
          };
        },
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({
            events,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_assistant_phase",
                laneSeq: "1",
              }),
            ],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: null,
          }),
        }),
        async runAssistantPhase(input) {
          assert.equal(input.restored.vaultRoot, path.resolve(vaultRoot));
          assert.equal(process.env.VAULT, path.resolve(vaultRoot));
          assert.equal(
            (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
            "1",
          );
          events.push("assistant");
          return {
            checkpointReason: "outbox_sending",
            progressed: true,
            redactedStatus: {
              hostedAssistantProgressed: true,
            },
          };
        },
        vaultRoot,
      });

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:1",
        "assistant",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("defers alarm mailbox import when an active alarm absorbs pending conversation work", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            reason: "alarm",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`);
            return {
              snapshotRef: createBundleRef({
                hash: snapshotInput.reason === "import" ? "3".repeat(64) : "4".repeat(64),
                key: `users/bundles/member-synthetic/${snapshotInput.reason}.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`import:${item.item.laneSeq}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_alarm_absorbed_pending_work",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: TEST_NOW,
                nextWakeReason: "assistant",
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            assert.equal(
              (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
              "1",
            );
            events.push("assistant");
            return {
              checkpointReason: "outbox_sending",
              progressed: true,
              redactedStatus: {
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:1",
        "assistant",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("keeps exact hosted canonical writes local without foreground workspace checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactPutCalls: Array<{ byteLength: number; sha256: string }> = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const artifactLabelsByHash = new Map<string, string>();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const platform = createPlatform({
        artifactBytesByHash,
        artifactLabelsByHash,
        artifactPutCalls,
        events,
        mailboxPort: createMailboxPort({
          events,
          items: [],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({ version: "0" }),
        }),
      });

      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}`);
          assert.equal(snapshotInput.reason, "canonical_runtime_commit");
          const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({ vaultRoot });
          const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
          artifactLabelsByHash.set(hotHash, "canonical-hot-state");
          artifactBytesByHash.set(hotHash, hotSnapshot.bundle);
          return {
            snapshotRef: createBundleRef({
              hash: hotHash,
              key: "users/bundles/member-synthetic/canonical-hot.bundle.json",
              size: hotSnapshot.bundle.byteLength,
            }),
          };
        },
        async importItem() {
          throw new Error("Mailbox import should not run without mailbox items.");
        },
        platform,
        async runAssistantPhase(input) {
          await runCanonicalWrite({
            vaultRoot: input.restored.vaultRoot,
            operationType: "hosted_canonical_write_test",
            summary: "Persist hosted canonical write receipt.",
            occurredAt: TEST_NOW,
            mutate: async ({ batch }) => {
              await batch.stageTextWrite("journal/2026-04-27.md", "exact hosted note\n");
            },
          });
          return { progressed: false };
        },
        vaultRoot,
      });

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.equal(artifactPutCalls.length, 0);
      assert.equal(
        await readFile(path.join(vaultRoot, "journal", "2026-04-27.md"), "utf8"),
        "exact hosted note\n",
      );
      const receiptRoot = path.join(
        resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
        "receipts",
        "canonical-writes",
      );
      await assert.rejects(readdir(receiptRoot));
    } finally {
      await removeTempRoot(vaultRoot);
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

  test("normal foreground turns complete even when checkpoint construction or checkpointing would fail or hang", async () => {
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
          const checkpointActiveTurnInput = input.platform.checkpointActiveTurnInput;
          if (typeof checkpointActiveTurnInput !== "function") {
            throw new Error("Expected hosted active-turn checkpoint to be installed.");
          }
          await checkpointActiveTurnInput({
            acceptedInputIds: ["input_synthetic_foreground_active_turn"],
            providerRequestOrdinal: 0,
            requestId: "request_synthetic_foreground_active_turn",
            sessionId: "session_synthetic_foreground_active_turn",
            turnId: "turn_synthetic_foreground_active_turn",
            vault: vaultRoot,
          });
          return {
            checkpointReason: "assistant_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
      });

      await expect(Promise.race([
        resultPromise,
        checkpointStarted.promise.then(() => ({
          status: "checkpoint_called",
        })),
      ])).resolves.toMatchObject({
        status: "idle",
      });

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "runtime.log:mailbox.imported",
        "assistant.phase",
        "runtime.log:checkpoint.runtime_residue_deferred",
        "runtime.log:checkpoint.runtime_residue_deferred",
      ]);
      assert.deepEqual(checkpointRequests, []);
      const deferredLogs = logRequests.flatMap((request) => request.entries)
        .filter((entry) => entry.eventCode === "checkpoint.runtime_residue_deferred");
      assert.deepEqual(deferredLogs.map((entry) => entry.redactedJson), [
        {
          checkpointPhase: "active_turn_input",
          checkpointReason: "active_turn_acceptance",
        },
        {
          checkpointPhase: "assistant",
          checkpointReason: "assistant_runtime_commit",
        },
      ]);
      expect(mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder).not.toHaveBeenCalled();
      expect(createRequest).not.toHaveBeenCalled();
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
      assert.equal(snapshotInput.reason, "activation_bootstrap");
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
      assert.equal(result.deferredCheckpointRequired, true);
      assert.deepEqual(checkpointRequests, []);
      expect(createCheckpointSnapshot).not.toHaveBeenCalled();
      expect(events).not.toContain("workspace.checkpoint");
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

  test("normal foreground active-turn refresh does not build a checkpoint request", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const createCheckpointSnapshot = vi.fn(async () => {
      throw new Error("Foreground active-turn refresh should not build checkpoint snapshots.");
    });
    let fetchCount = 0;

    const mailboxPort: HostedRuntimeMailboxPort = {
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchCount += 1;
        events.push(`mailbox.fetch:${fetchCount}`);
        const lateItem = createMailboxItem({
          id: "mailbox_item_entrypoint_late_active_turn",
          laneSeq: "1",
        });
        return {
          fetchedAt: TEST_NOW,
          items: fetchCount === 1 ? [] : [lateItem],
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: fetchCount === 1 ? lane.importedSeq : "1",
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
        async runAssistantPhase(input) {
          const refreshMailbox = input.platform.refreshMailboxForActiveTurnInput;
          if (typeof refreshMailbox !== "function") {
            throw new Error("Expected hosted mailbox refresh to be installed.");
          }
          const refresh = await refreshMailbox({
            requestId: "request_synthetic_entrypoint_active_turn_refresh",
          });
          assert.deepEqual(refresh, {
            progressed: true,
            reason: "ingested_input",
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
        "import:1",
      ]);
      assert.deepEqual(checkpointRequests, []);
      expect(createCheckpointSnapshot).not.toHaveBeenCalled();
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

  test("restores existing workspace snapshot before mailbox import", async () => {
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
      await ensureHostedInboxSidecarReady({
        bestEffort: false,
        rebuild: false,
        requestId: "request_mark_sidecar_ready_before_cold_restore",
        vaultRoot,
      });
      const ensureHostedInboxSidecarReadyImpl =
        mocks.ensureHostedInboxSidecarReady.getMockImplementation();
      assert.ok(ensureHostedInboxSidecarReadyImpl);
      mocks.ensureHostedInboxSidecarReady.mockImplementationOnce(async (input) => {
        events.push("sidecar.ready");
        assert.equal(input.rebuild, true);
        assert.equal(input.requestId, "hosted-workspace-invocation:attempt_synthetic_workspace_run");
        assert.equal(input.vaultRoot, path.resolve(vaultRoot));
        return await ensureHostedInboxSidecarReadyImpl(input);
      });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
          workspaceVersion: "9",
        },
        }),
      {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`);
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

      assert.deepEqual(artifactGetCalls, [bundleHash, rawArtifactHash]);
      assert.deepEqual(imported, ["4"]);
      assert.equal(fetchRequests.length, 1);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "3");
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "sidecar.ready",
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
              reason: "manual",
              workspaceVersion: "9",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(
                `snapshot:${snapshotInput.reason}:${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`,
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
      ]);
      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.expectedWorkspaceVersion,
      ]), [
      ]);
      assert.equal(
        await readFile(path.join(vaultRoot, "note.md"), "utf8"),
        "current note\n",
      );
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");

      artifactGetCalls.length = 0;
      events.length = 0;
      await runOnce(2);

      assert.deepEqual(artifactGetCalls, []);
      assert.deepEqual(imported, ["4"]);
      assert.equal(fetchRequests.length, 2);
      assert.equal(readConversationImportedSeq(fetchRequests[1]), "4");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "assistant",
      ]);
      assert.deepEqual(checkpointRequests, []);
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
            events.push(`snapshot:${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`);
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
          async get(sha256) {
            const bytes = await platform.artifactStore.get(sha256);
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
            events.push(`snapshot:${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`);
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
              events.push(`snapshot:${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`);
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
        committedAt: TEST_NOW,
        createdAt: TEST_NOW,
        occurredAt: TEST_NOW,
        operationId: "op_synthetic_canonical_restore",
        operationType: "hosted_canonical_write_test",
        schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
        summary: "Restore hosted canonical write receipt.",
        updatedAt: TEST_NOW,
      }, null, 2)}\n`, "utf8");
      const receiptHash = sha256Hex(receiptBytes);
      const receiptLogBytes = Buffer.from(`${JSON.stringify({
        entries: [
          {
            byteSize: receiptBytes.byteLength,
            sha256: receiptHash,
          },
        ],
        schema: "murph.hosted-canonical-write-receipt-log.v1",
      }, null, 2)}\n`, "utf8");
      const receiptLogHash = sha256Hex(receiptLogBytes);
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
        [receiptHash, receiptBytes],
        [receiptLogHash, receiptLogBytes],
      ]);

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "9",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Snapshot should not run while validating restore.");
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
                  hostedCanonicalWriteReceiptLogEntryCount: 1,
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

      assert.deepEqual(artifactGetCalls, [baseHash, hotHash, receiptLogHash, receiptHash, exactPayloadHash]);
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
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceHotVaultRoot);
    }
  });

  test("keeps the hot restore cache warm after no-progress alarms", async () => {
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
              reason: "alarm",
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
      ]);
      artifactGetCalls.length = 0;

      await runOnce();
      assert.deepEqual(artifactGetCalls, []);
      assert.equal(checkpointRequests.length, 0);
      artifactGetCalls.length = 0;

      await runOnce();
      assert.deepEqual(artifactGetCalls, []);
      assert.equal(checkpointRequests.length, 0);
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceHotVaultRoot);
    }
  });

  test("preserves deferred mailbox watermarks across warm foreground restores", async () => {
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

      const workspace = createWorkspaceState({
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
      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        events,
        mailboxPort: createMailboxPort({
          events,
          fetchRequests,
          items: [mailboxItem],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace,
        }),
      });

      const runOnce = async (attempt: number) =>
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_warm_mailbox_restore_${attempt}`,
              workspaceVersion: workspace.version,
            },
          }),
          {
            async createCheckpointSnapshot() {
              throw new Error("Foreground mailbox import should not checkpoint.");
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
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(artifactGetCalls, [baseHash, hotHash]);
      artifactGetCalls.length = 0;

      await runOnce(2);
      assert.deepEqual(importedSeqs, ["1"]);
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(artifactGetCalls, []);
      const secondFetch = fetchRequests.at(-1);
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
        path: "raw/assistant-input/example/preview.txt",
      },
      {
        bytes: Buffer.from("{\"schema\":\"example\"}\n", "utf8"),
        path: "derived/inbox/example/attachment/manifest.json",
      },
      {
        bytes: Buffer.from("assistant-input-derived-summary\n", "utf8"),
        path: "derived/assistant-input/example/summary.txt",
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
            assert.equal(
              await readFile(path.join(vaultRoot, eagerArtifactSpec.path), "utf8"),
              "capture-artifact\n",
            );
            for (const spec of artifactSpecs) {
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

      const mailboxFetchIndex = requireEventIndex(events, "mailbox.fetch");
      assert.ok(events.indexOf("artifact.get:eager-raw-capture") < mailboxFetchIndex);
      for (const [index] of artifactHashes.entries()) {
        assert.equal(events.includes(`artifact.get:restored-artifact-${index}`), false);
      }
      assert.deepEqual(artifactGetCalls, [bundleHash, eagerArtifactHash]);
      assert.equal(checkpointRequests.length, 0);
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
      const ensureHostedInboxSidecarReadyImpl =
        mocks.ensureHostedInboxSidecarReady.getMockImplementation();
      assert.ok(ensureHostedInboxSidecarReadyImpl);
      mocks.ensureHostedInboxSidecarReady.mockImplementationOnce(async (input) => {
        events.push("sidecar.ready");
        return await ensureHostedInboxSidecarReadyImpl(input);
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
              events.push(`snapshot.create:${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`);
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
      const sidecarIndex = requireEventIndex(events, "sidecar.ready");
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
      assert.equal(artifactPutCalls.length, 0);
      assert.ok(mailboxFetchIndex < mailboxImportedLogIndex);
      assert.ok(mailboxImportedLogIndex < sidecarIndex);
      assert.equal(stageSummary["workspace.read"]?.count, 1);
      assert.equal(stageSummary["artifact.get"]?.count, 1);
      assert.equal(stageSummary["mailbox.fetch"]?.count, 1);
      assert.equal(stageSummary["mailbox.importItem"]?.count, mailboxItemCount);
      assert.equal(stageSummary["snapshot.create"]?.count ?? 0, 0);
      assert.equal(stageSummary["artifact.put"]?.count ?? 0, 0);
      assert.equal(stageSummary["workspace.checkpoint"]?.count ?? 0, 0);
      assert.ok((stageSummary["runtime.log.write"]?.count ?? 0) >= 1);
      for (const key of Object.keys(mailboxImportedLog.redactedJson ?? {})) {
        assert.doesNotMatch(key, /(?:body|cipher|file|id|path|payload|ref)/iu);
      }
      assert.equal(mailboxImportedLog.redactedJson?.fetchedCount, mailboxItemCount);
      assert.equal(mailboxImportedLog.redactedJson?.importedCount, mailboxItemCount);
      assert.equal(mailboxImportedLog.redactedJson?.checkpointDeferred, true);
      assert.equal(mailboxImportedLog.redactedJson?.checkpointed, false);
      assert.equal(mailboxImportedLog.redactedJson?.conversationSeqEnd, String(mailboxItemCount));
      if (process.env.HOSTED_PREIMPORT_PROFILE === "1") {
        console.info("hosted pre-import local profile", stageSummary);
      }
      assert.deepEqual(result, {
        deferredCheckpointRequired: true,
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: String(mailboxItemCount),
          hostedMailboxFetchedCount: mailboxItemCount,
          hostedMailboxImportedCount: mailboxItemCount,
          hostedMailboxRetryableBlockedCount: 0,
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
            `snapshot:${requireMailboxSnapshotInput(snapshotInput).previousState.watermarks.conversation}->${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`,
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

  test("reports mailbox budget exhaustion only after deferring an overflow item", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
          budget: {
            maxMailboxItems: 1,
          },
        },
        }),
      {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`);
          return {
            snapshotRef: createBundleRef({
              hash: "b".repeat(64),
              key: "users/bundles/member-synthetic/workspace-budget.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem(item) {
          imported.push(item.item.id);
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({
            events,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_budget_001",
                laneSeq: "1",
              }),
              createMailboxItem({
                createdAt: "9999-01-01T00:00:00.000Z",
                id: "mailbox_item_entrypoint_budget_002",
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
        vaultRoot,
      });

      assert.deepEqual(imported, ["mailbox_item_entrypoint_budget_001"]);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
      ]);
      assert.equal(checkpointRequests.length, 0);
      const mailboxRetryWakeAt = result.nextWakeAt;
      assert.match(mailboxRetryWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.deepEqual(result, {
        deferredCheckpointRequired: true,
        nextWakeAt: mailboxRetryWakeAt,
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxFetchedCount: 2,
          hostedMailboxImportedCount: 1,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "budget_exhausted",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns mailbox retry wake for a pure retryable sidecar block without foreground checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];
    const sidecarItem = createMailboxItem({
      id: "mailbox_item_entrypoint_sidecar_retry",
      laneSeq: "1",
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_entrypoint_sidecar_retry",
    });
    const baseMailboxPort = createMailboxPort({
      events,
      items: [sidecarItem],
    });

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`);
          return {
            snapshotRef: createBundleRef({
              hash: "d".repeat(64),
              key: "users/bundles/member-synthetic/workspace-sidecar-retry.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem(item) {
          imported.push(item.item.id);
          return { status: "imported" };
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
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot,
      });

      assert.deepEqual(imported, []);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "mailbox.fetchPayload",
      ]);
      assert.equal(checkpointRequests.length, 0);
      const mailboxRetryWakeAt = result.nextWakeAt;
      assert.match(mailboxRetryWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.deepEqual(result, {
        nextWakeAt: mailboxRetryWakeAt,
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

  test("returns next wake from the checkpointed workspace after import commits", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousWakeAt = "2099-04-27T00:05:00.000Z";
    const events: string[] = [];

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          return {
            snapshotRef: createBundleRef({
              hash: "c".repeat(64),
              key: "users/bundles/member-synthetic/workspace-cleared-wake.bundle.json",
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
                id: "mailbox_item_entrypoint_wake_001",
                laneSeq: "1",
              }),
            ],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            checkpointWorkspace(request) {
              return createWorkspaceState({
                nextWakeAt: null,
                nextWakeReason: null,
                redactedStatus: request.redactedStatus ?? null,
                snapshotRef: request.snapshotRef,
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
              });
            },
            events,
            workspace: createWorkspaceState({
              nextWakeAt: previousWakeAt,
              nextWakeReason: "alarm",
              version: "0",
            }),
          }),
        }),
        async runAssistantPhase() {
          return { progressed: false };
        },
        vaultRoot,
      });

      assert.equal(result.nextWakeAt, previousWakeAt);
      assert.equal(result.status, "scheduled");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns scheduled when no mailbox import runs and the workspace has a future wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const nextWakeAt = "2099-04-27T00:05:00.000Z";

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run without mailbox state changes.");
        },
        async importItem() {
          throw new Error("Import should not run when no mailbox items are fetched.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({
              nextWakeAt,
              nextWakeReason: "alarm",
              version: "0",
            }),
          }),
        }),
        vaultRoot,
      });

      assert.deepEqual(events, ["workspace.read", "mailbox.fetch", "mailbox.fetch"]);
      assert.deepEqual(result, {
        nextWakeAt,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("clears consumed alarm wake when the assistant phase ends idle", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const staleWakeAt = "2026-04-27T00:05:00.000Z";

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
          reason: "alarm",
        },
        }),
      {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}:${requireMailboxSnapshotInput(snapshotInput).state.watermarks.conversation}`);
          return {
            snapshotRef: createBundleRef({
              hash: "7".repeat(64),
              key: "users/bundles/member-synthetic/alarm-idle.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem() {
          throw new Error("Import should not run when no mailbox items are fetched.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: createWorkspaceState({
              nextWakeAt: staleWakeAt,
              nextWakeReason: "assistant",
              version: "0",
            }),
          }),
        }),
        vaultRoot,
      });

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), []);
      assert.deepEqual(result, {
        deferredCheckpointRequired: true,
        nextWakeAt: null,
        redactedStatus: {
          hostedAssistantNextWakeAt: null,
          hostedAssistantProgressed: true,
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
          hostedOutboxPendingDeliveryEffects: 0,
          hostedOutboxTerminalizedSending: 0,
          hostedSystemMailboxPrepared: 0,
          hostedSystemMailboxRetryableFailed: 0,
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("parses additive workspace-invocation inputs and rejects legacy run-drain fields", () => {
    const parsed = parseHostedAssistantWorkspaceRuntimeJobInput({
      request: createWorkspaceRunRequest(),
      runtime: {
        forwardedEnv: {
          HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
        },
      },
    });

    assert.equal(parsed.request.attemptId, "attempt_synthetic_workspace_run");
    assert.equal(parsed.request.reason, "nudge");
    assert.deepEqual(parsed.runtime?.forwardedEnv, {
      HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
    });

    const idleParsed = parseHostedAssistantWorkspaceRuntimeJobInput({
      request: {
        ...createWorkspaceRunRequest(),
        checkpointNextWakeAt: "2026-04-20T08:10:00.000Z",
        reason: "idle_shutdown_checkpoint",
      },
    });
    assert.equal(idleParsed.request.reason, "idle_shutdown_checkpoint");
    assert.equal(idleParsed.request.checkpointNextWakeAt, "2026-04-20T08:10:00.000Z");
    expect(() =>
      parseHostedAssistantWorkspaceRuntimeJobInput({
        request: {
          ...createWorkspaceRunRequest(),
          checkpointNextWakeAt: null,
        },
      })
    ).toThrow(
      "Hosted assistant workspace runtime job request.checkpointNextWakeAt is only supported for idle_shutdown_checkpoint.",
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

function createPlatform(input: {
  artifactBytesByHash?: ReadonlyMap<string, Uint8Array>;
  artifactGetCalls?: string[];
  artifactLabelsByHash?: ReadonlyMap<string, string>;
  artifactPutCalls?: Array<{ byteLength: number; sha256: string }>;
  events?: string[];
  logRequests?: HostedRuntimeLogRequest[];
  mailboxPort: HostedRuntimeMailboxPort | null;
  runtimeLivenessIntervalMs?: number | null;
  runtimeLivenessPort?: RuntimeLivenessPort | null;
  stageSamples?: StageTimingSample[];
  workspacePort: HostedRuntimeWorkspacePort | null;
}): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get(sha256) {
        return await measureStage(input.stageSamples, "artifact.get", async () => {
          input.artifactGetCalls?.push(sha256);
          input.events?.push(`artifact.get:${readArtifactEventLabel(input.artifactLabelsByHash, sha256)}`);
          return input.artifactBytesByHash?.get(sha256) ?? null;
        });
      },
      async put(artifact) {
        await measureStage(input.stageSamples, "artifact.put", async () => {
          input.artifactPutCalls?.push({
            byteLength: artifact.bytes.byteLength,
            sha256: artifact.sha256,
          });
          input.events?.push(
            `artifact.put:${readArtifactEventLabel(input.artifactLabelsByHash, artifact.sha256)}`,
          );
        });
        return undefined;
      },
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
    },
    ...(input.logRequests
      ? {
          logPort: {
            async write(request: HostedRuntimeLogRequest) {
              await measureStage(input.stageSamples, "runtime.log.write", async () => {
                input.logRequests?.push(request);
                for (const entry of request.entries) {
                  input.events?.push(`runtime.log:${entry.eventCode}`);
                }
              });
              return { loggedCount: request.entries.length };
            },
          },
        }
      : {}),
    ...(input.mailboxPort ? { mailboxPort: input.mailboxPort } : {}),
    ...(input.runtimeLivenessIntervalMs
      ? { runtimeLivenessIntervalMs: input.runtimeLivenessIntervalMs }
      : {}),
    ...(input.runtimeLivenessPort ? { runtimeLivenessPort: input.runtimeLivenessPort } : {}),
    ...(input.workspacePort ? { workspacePort: input.workspacePort } : {}),
  };
}

interface StageTimingSample {
  elapsedMs: number;
  stage: string;
}

interface StageTimingSummary {
  count: number;
  elapsedMs: number;
}

async function measureStage<T>(
  samples: StageTimingSample[] | undefined,
  stage: string,
  run: () => Promise<T> | T,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    samples?.push({
      elapsedMs: Math.max(0, performance.now() - startedAt),
      stage,
    });
  }
}

function summarizeStageTimings(
  samples: readonly StageTimingSample[],
): Record<string, StageTimingSummary> {
  return samples.reduce<Record<string, StageTimingSummary>>((summary, sample) => {
    const existing = summary[sample.stage] ?? {
      count: 0,
      elapsedMs: 0,
    };
    summary[sample.stage] = {
      count: existing.count + 1,
      elapsedMs: existing.elapsedMs + sample.elapsedMs,
    };
    return summary;
  }, {});
}

function readArtifactEventLabel(
  labelsByHash: ReadonlyMap<string, string> | undefined,
  sha256: string,
): string {
  return labelsByHash?.get(sha256) ?? "unlabeled-artifact";
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireEventIndex(events: readonly string[], event: string): number {
  const index = events.indexOf(event);
  assert.notEqual(index, -1, `Expected event ${event} among ${events.length} recorded events.`);
  return index;
}

function readConversationImportedSeq(request: HostedMailboxFetchRequest | undefined): string | null {
  return request?.lanes.find((lane) => lane.lane === "conversation")?.importedSeq ?? null;
}

function createMailboxImportStateBundle(input: HostedMailboxImportState): {
  bytes: Uint8Array;
  hash: string;
} {
  const bytes = writeMailboxImportStateToBundle(null, input);

  return {
    bytes,
    hash: sha256HostedBundleHex(bytes),
  };
}

function writeMailboxImportStateToBundle(
  bytes: Uint8Array | null,
  input: HostedMailboxImportState,
): Uint8Array {
  return writeHostedBundleTextFile({
    bytes,
    kind: "vault",
    path: HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
    root: "vault",
    text: JSON.stringify({
      schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
      schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
      value: input,
    }),
  });
}

async function writeMailboxImportStateFile(
  vaultRoot: string,
  input: HostedMailboxImportState,
): Promise<void> {
  const statePath = path.join(vaultRoot, HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({
      schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
      schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
      value: input,
    }),
  );
}

function createMailboxPort(input: {
  events: string[];
  fetchRequests?: HostedMailboxFetchRequest[];
  items: HostedMailboxItem[];
  stageSamples?: StageTimingSample[];
}): HostedRuntimeMailboxPort {
  return {
    async fetch(request: HostedMailboxFetchRequest): Promise<HostedMailboxFetchResponse> {
      return await measureStage(input.stageSamples, "mailbox.fetch", async () => {
        input.events.push("mailbox.fetch");
        input.fetchRequests?.push(request);
        return {
          fetchedAt: TEST_NOW,
          items: input.items.filter((item) =>
            request.lanes.some((lane) =>
              lane.lane === item.lane && BigInt(item.laneSeq) > BigInt(lane.importedSeq)
            )
          ),
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: input.items
              .filter((item) => item.lane === lane.lane)
              .reduce((maxSeq, item) =>
                BigInt(item.laneSeq) > BigInt(maxSeq) ? item.laneSeq : maxSeq,
              lane.importedSeq),
          })),
          userId: TEST_USER_ID,
        };
      });
    },
    async fetchPayload(
      request: HostedMailboxPayloadFetchRequest,
    ): Promise<HostedMailboxPayloadFetchResponse> {
      return await measureStage(input.stageSamples, "mailbox.fetchPayload", async () => ({
        fetchedAt: TEST_NOW,
        payload: {
          createdAt: TEST_NOW,
          mailboxItemId: request.mailboxItemId,
          payloadCiphertext: "ciphertext_synthetic_sidecar",
          payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
          userId: TEST_USER_ID,
        },
      }));
    },
  };
}

function createWorkspacePort(input: {
  checkpointRequests: HostedWorkspaceCheckpointRequest[];
  checkpointWorkspace?: (request: HostedWorkspaceCheckpointRequest) => HostedWorkspaceState;
  events: string[];
  stageSamples?: StageTimingSample[];
  workspace: HostedWorkspaceState | null;
}): HostedRuntimeWorkspacePort {
  return {
    async read(): Promise<HostedWorkspaceReadResponse> {
      return await measureStage(input.stageSamples, "workspace.read", async () => {
        input.events.push("workspace.read");
        return {
          fetchedAt: TEST_NOW,
          workspace: input.workspace,
        };
      });
    },
    async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
      return await measureStage(input.stageSamples, "workspace.checkpoint", async () => {
        input.events.push("workspace.checkpoint");
        input.checkpointRequests.push(request);
        return {
          checkpointed: true,
          workspace: input.checkpointWorkspace
            ? input.checkpointWorkspace(request)
            : createWorkspaceState({
                redactedStatus: request.redactedStatus ?? null,
                snapshotRef: request.snapshotRef,
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
              }),
        };
      });
    },
  };
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: `dedupe_${overrides.id ?? "mailbox_item_entrypoint_001"}`,
    expiresAt: null,
    id: "mailbox_item_entrypoint_001",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_synthetic_inline",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    ...overrides,
  };
}

function createWorkspaceRunRequest(
  overrides: Partial<HostedWorkspaceInvocationRequest> = {},
): HostedWorkspaceInvocationRequest {
  return {
    attemptId: "attempt_synthetic_workspace_run",
    leaseGeneration: "1",
    reason: "nudge" as const,
    userId: TEST_USER_ID,
    workspaceVersion: "0",
    ...overrides,
  };
}

function createWorkspaceRuntimeJobInput(input: {
  forwardedEnv?: Readonly<Record<string, string>>;
  request?: Partial<HostedWorkspaceInvocationRequest>;
} = {}) {
  return {
    request: createWorkspaceRunRequest(input.request),
    runtime: {
      forwardedEnv: {
        ...TEST_HOSTED_CODEX_FORWARDED_ENV,
        ...(input.forwardedEnv ?? {}),
      },
    },
  };
}

function createWorkspaceState(overrides: Partial<HostedWorkspaceState> = {}): HostedWorkspaceState {
  return {
    checkpointedAt: TEST_NOW,
    createdAt: TEST_NOW,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: null,
    snapshotRef: null,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    version: "0",
    ...overrides,
  };
}

async function assertPrivateDirectoryMode(directoryPath: string): Promise<void> {
  const directoryMode = (await stat(directoryPath)).mode & 0o777;
  assert.equal(directoryMode, 0o700);
}

function createBundleRef(input: {
  hash: string;
  key: string;
  size: number;
}): HostedExecutionBundleRef {
  return {
    hash: input.hash,
    key: input.key,
    size: input.size,
    updatedAt: TEST_NOW,
  };
}

async function removeTempRoot(root: string): Promise<void> {
  await rm(root, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: 50,
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

async function waitUntil(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for assertion.");
}
