import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import {
  resolveAssistantStatePaths,
  resolveRuntimePaths,
  sha256HostedBundleHex,
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
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionLayeredSnapshotRef,
  readHostedExecutionSnapshotBaseRef,
} from "@murphai/hosted-execution/parsers";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureHostedInboxSidecarReady: vi.fn(),
}));

vi.mock("../src/hosted-runtime/context.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/context.ts")>();

  return {
    ...actual,
    ensureHostedInboxSidecarReady: mocks.ensureHostedInboxSidecarReady.mockImplementation(
      actual.ensureHostedInboxSidecarReady,
    ),
  };
});

import {
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  HostedWorkspaceRuntimeLivenessRejectedError,
  HostedWorkspaceRunnerUserMismatchError,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  runHostedWorkspaceRuntimeJobInProcess,
} from "../src/hosted-runtime.ts";
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
  HostedRuntimeWorkspacePort,
} from "../src/hosted-runtime-contracts.ts";

const TEST_NOW = "2026-04-27T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_workspace_entrypoint";
const TEST_HOSTED_CODEX_FORWARDED_ENV = {
  HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
  HOSTED_ASSISTANT_PROVIDER: "openai",
  OPENAI_API_KEY: "test-vercel-key",
} as const;

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

    try {
      const ensureHostedInboxSidecarReadyImpl =
        mocks.ensureHostedInboxSidecarReady.getMockImplementation();
      assert.ok(ensureHostedInboxSidecarReadyImpl);
      mocks.ensureHostedInboxSidecarReady.mockImplementationOnce(async (input) => {
        events.push("sidecar.ready");
        assert.equal(input.bestEffort, true);
        assert.equal(input.rebuild, true);
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
            assert.equal(snapshotInput.state.watermarks.conversation, "1");
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/workspace-entrypoint.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
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
        "snapshot:1",
        "workspace.checkpoint",
        "sidecar.ready",
      ]);
      assert.deepEqual(imported, [
        {
          id: "mailbox_item_entrypoint_001",
          route: "import-conversation-message",
        },
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.attemptId, "attempt_synthetic_workspace_entrypoint");
      assert.equal(checkpointRequests[0]?.expectedWorkspaceVersion, "0");
      assert.equal(checkpointRequests[0]?.leaseGeneration, "7");
      assert.equal(checkpointRequests[0]?.reason, "import");
      const baseSnapshotRef = readHostedExecutionSnapshotBaseRef(
        checkpointRequests[0]?.snapshotRef ?? null,
      );
      assert.equal(
        baseSnapshotRef?.key,
        "users/bundles/member-synthetic/workspace-entrypoint.bundle.json",
      );
      assert.deepEqual(result, {
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
      const runtimePaths = resolveRuntimePaths(vaultRoot);
      await stat(runtimePaths.inboxConfigPath);
      await stat(runtimePaths.inboxDbPath);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
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
        return { ok: true };
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
      await rm(vaultRoot, { force: true, recursive: true });
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
      await rm(vaultRoot, { force: true, recursive: true });
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
          return { ok: true };
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
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("runs assistant outbox phase after restored mailbox checkpoint with restored vault root", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}:${snapshotInput.state.watermarks.conversation}`);
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
        "snapshot:import:1",
        "workspace.checkpoint",
        "assistant",
        "snapshot:outbox_sending:1",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "import",
        "outbox_sending",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1"],
      );
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
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
      await rm(vaultRoot, { force: true, recursive: true });
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
        return { ok: true };
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
    await mkdir(path.join(sourceVaultRoot, "raw"), { recursive: true });
    await writeFile(path.join(sourceVaultRoot, "raw", "artifact.txt"), "synthetic artifact", "utf8");
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
    const artifactBytesByHash = new Map([[bundleHash, bundle]]);
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
          events.push(`snapshot:${snapshotInput.state.watermarks.conversation}`);
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

      assert.deepEqual(artifactGetCalls, [bundleHash]);
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
      await rm(vaultRoot, { force: true, recursive: true });
      await rm(sourceVaultRoot, { force: true, recursive: true });
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
            events.push(`snapshot:${snapshotInput.state.watermarks.conversation}`);
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
      await rm(vaultRoot, { force: true, recursive: true });
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
            events.push(`snapshot:${snapshotInput.state.watermarks.conversation}`);
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
      await rm(vaultRoot, { force: true, recursive: true });
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
              events.push(`snapshot:${snapshotInput.state.watermarks.conversation}`);
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
        await rm(vaultRoot, { force: true, recursive: true });
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
      const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        vaultRoot: sourceHotVaultRoot,
      });
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const artifactBytesByHash = new Map([
        [baseHash, baseBundle],
        [hotHash, hotSnapshot.bundle],
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

      assert.deepEqual(artifactGetCalls, [baseHash, hotHash]);
      assert.equal(await readFile(path.join(vaultRoot, "note.md"), "utf8"), "base note\n");
      await assert.rejects(
        readFile(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent-old.json"), "utf8"),
      );
      assert.equal(
        await readFile(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session-latest.json"), "utf8"),
        "{\"session\":\"latest\"}\n",
      );
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
      await rm(sourceBaseVaultRoot, { force: true, recursive: true });
      await rm(sourceHotVaultRoot, { force: true, recursive: true });
    }
  });

  test("restores raw inbox artifacts from workspace snapshots before mailbox import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-artifact-"));
    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-source-artifact-"));
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
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

    for (const spec of artifactSpecs) {
      const sourceArtifactPath = path.join(sourceVaultRoot, spec.path);
      await mkdir(path.dirname(sourceArtifactPath), { recursive: true });
      await writeFile(sourceArtifactPath, spec.bytes);
    }

    const artifactHashes = artifactSpecs.map((spec) => sha256HostedBundleHex(spec.bytes));
    const sourceBundle = await snapshotHostedBundleRoots({
      externalizeFile: async (file) => {
        const spec = artifactSpecs.find((entry) => entry.path === file.path);
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
    const artifactBytesByHash = new Map<string, Uint8Array>(
      artifactSpecs.map((spec, index) => [artifactHashes[index]!, spec.bytes]),
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
            for (const spec of artifactSpecs) {
              const restoredArtifactPath = path.join(vaultRoot, spec.path);
              assert.equal(await readFile(restoredArtifactPath, "utf8"), spec.bytes.toString("utf8"));
            }
            return { status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash,
            artifactGetCalls,
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

      expect(artifactGetCalls).toHaveLength(artifactSpecs.length + 1);
      expect(artifactGetCalls).toEqual(
        expect.arrayContaining([bundleHash, ...artifactHashes]),
      );
      assert.equal(checkpointRequests.length, 1);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
      await rm(sourceVaultRoot, { force: true, recursive: true });
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
              events.push(`snapshot.create:${snapshotInput.state.watermarks.conversation}`);
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
                  assert.equal(
                    await readFile(path.join(vaultRoot, spec.path), "utf8"),
                    Buffer.from(spec.bytes).toString("utf8"),
                  );
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
      const snapshotIndex = requireEventIndex(events, `snapshot.create:${mailboxItemCount}`);
      const checkpointUploadIndex = requireEventIndex(events, "artifact.put:checkpoint-snapshot");
      const checkpointIndex = requireEventIndex(events, "workspace.checkpoint");
      const mailboxImportedLogIndex = requireEventIndex(events, "runtime.log:mailbox.imported");
      const sidecarIndex = requireEventIndex(events, "sidecar.ready");
      const mailboxImportedLog = logRequests
        .flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.imported");
      const stageSummary = summarizeStageTimings(stageSamples);
      assert.ok(mailboxImportedLog);

      assert.equal(events[0], "workspace.read");
      assert.ok(firstArtifactFetchIndex < mailboxFetchIndex);
      assert.equal(artifactGetCalls.length, externalArtifactCount + 1);
      assert.equal(importedEvents.length, mailboxItemCount);
      assert.deepEqual(importedSeqs, mailboxItems.map((item) => item.laneSeq));
      assert.equal(artifactPutCalls.length, 1);
      assert.ok(mailboxFetchIndex < snapshotIndex);
      assert.ok(snapshotIndex < checkpointUploadIndex);
      assert.ok(checkpointUploadIndex < checkpointIndex);
      assert.ok(checkpointIndex < mailboxImportedLogIndex);
      assert.ok(mailboxImportedLogIndex < sidecarIndex);
      assert.equal(stageSummary["workspace.read"]?.count, 1);
      assert.equal(stageSummary["artifact.get"]?.count, externalArtifactCount + 1);
      assert.equal(stageSummary["mailbox.fetch"]?.count, 1);
      assert.equal(stageSummary["mailbox.importItem"]?.count, mailboxItemCount);
      assert.equal(stageSummary["snapshot.create"]?.count, 1);
      assert.equal(stageSummary["artifact.put"]?.count, 1);
      assert.equal(stageSummary["workspace.checkpoint"]?.count, 1);
      assert.ok((stageSummary["runtime.log.write"]?.count ?? 0) >= 1);
      for (const key of Object.keys(mailboxImportedLog.redactedJson ?? {})) {
        assert.doesNotMatch(key, /(?:body|cipher|file|id|path|payload|ref)/iu);
      }
      assert.equal(mailboxImportedLog.redactedJson?.fetchedCount, mailboxItemCount);
      assert.equal(mailboxImportedLog.redactedJson?.importedCount, mailboxItemCount);
      assert.equal(mailboxImportedLog.redactedJson?.checkpointed, true);
      assert.equal(mailboxImportedLog.redactedJson?.conversationSeqEnd, String(mailboxItemCount));
      if (process.env.HOSTED_PREIMPORT_PROFILE === "1") {
        console.info("hosted pre-import local profile", stageSummary);
      }
      assert.deepEqual(result, {
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
      await rm(vaultRoot, { force: true, recursive: true });
      await rm(sourceVaultRoot, { force: true, recursive: true });
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
            `snapshot:${snapshotInput.previousState.watermarks.conversation}->${snapshotInput.state.watermarks.conversation}`,
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
        "snapshot:0->1",
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
      await rm(vaultRoot, { force: true, recursive: true });
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
          events.push(`snapshot:${snapshotInput.state.watermarks.conversation}`);
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
        "snapshot:1",
        "workspace.checkpoint",
      ]);
      assert.equal(checkpointRequests.length, 1);
      const mailboxRetryWakeAt = checkpointRequests[0]?.nextWakeAt;
      assert.match(mailboxRetryWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "mailbox");
      assert.deepEqual(checkpointRequests[0]?.redactedStatus, {
        hostedMailboxBlockedCount: 1,
        hostedMailboxConversationImportedSeq: "1",
        hostedMailboxFetchedCount: 2,
        hostedMailboxImportedCount: 1,
        hostedMailboxNextRetryAtPresent: true,
        hostedMailboxRetryableBlockedCount: 1,
        hostedMailboxSystemImportedSeq: "0",
      });
      assert.deepEqual(result, {
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
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("checkpoints mailbox retry wake for a pure retryable sidecar block", async () => {
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
          events.push(`snapshot:${snapshotInput.state.watermarks.conversation}`);
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
        "snapshot:0",
        "workspace.checkpoint",
      ]);
      assert.equal(checkpointRequests.length, 1);
      const mailboxRetryWakeAt = checkpointRequests[0]?.nextWakeAt;
      assert.match(mailboxRetryWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "mailbox");
      assert.deepEqual(checkpointRequests[0]?.redactedStatus, {
        hostedMailboxBlockedCount: 1,
        hostedMailboxConversationImportedSeq: "0",
        hostedMailboxFetchedCount: 1,
        hostedMailboxImportedCount: 0,
        hostedMailboxNextRetryAtPresent: true,
        hostedMailboxRetryableBlockedCount: 1,
        hostedMailboxSystemImportedSeq: "0",
      });
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
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("returns next wake from the checkpointed workspace after import commits", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const staleWakeAt = "2026-04-27T00:05:00.000Z";
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
              nextWakeAt: staleWakeAt,
              nextWakeReason: "alarm",
              version: "0",
            }),
          }),
        }),
        vaultRoot,
      });

      assert.equal(result.nextWakeAt, null);
      assert.equal(result.status, "idle");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("returns scheduled when no mailbox import runs and the workspace has a future wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const nextWakeAt = "2026-04-27T00:05:00.000Z";

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

      assert.deepEqual(events, ["workspace.read", "mailbox.fetch"]);
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
      await rm(vaultRoot, { force: true, recursive: true });
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
          events.push(`snapshot:${snapshotInput.reason}:${snapshotInput.state.watermarks.conversation}`);
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
        "snapshot:maintenance:0",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), ["maintenance"]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.deepEqual(result, {
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
      await rm(vaultRoot, { force: true, recursive: true });
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
  const bytes = writeHostedBundleTextFile({
    bytes: null,
    kind: "vault",
    path: HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
    root: "vault",
    text: JSON.stringify({
      schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
      schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
      value: input,
    }),
  });

  return {
    bytes,
    hash: sha256HostedBundleHex(bytes),
  };
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
