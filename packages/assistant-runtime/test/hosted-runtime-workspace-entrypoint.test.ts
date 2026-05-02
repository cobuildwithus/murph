import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
  writeHostedBundleTextFile,
  resolveAssistantStatePaths,
} from "@murphai/runtime-state/node";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxPayloadFetchRequest,
  type HostedMailboxPayloadFetchResponse,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, test } from "vitest";

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
  HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
  VERCEL_AI_API_KEY: "test-vercel-key",
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
      assert.equal(
        checkpointRequests[0]?.snapshotRef?.key,
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
            checkpointReason: "outbox_intent",
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
        "snapshot:outbox_intent:1",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "import",
        "outbox_intent",
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
      assert.equal(
        fetchRequests[0]?.lanes.find((lane) => lane.lane === "conversation")?.importedSeq,
        "3",
      );
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
      assert.deepEqual(checkpointRequests[0]?.redactedStatus, {
        hostedMailboxBlockedCount: 1,
        hostedMailboxConversationImportedSeq: "1",
        hostedMailboxFetchedCount: 2,
        hostedMailboxImportedCount: 1,
        hostedMailboxRetryableBlockedCount: 1,
        hostedMailboxSystemImportedSeq: "0",
      });
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxFetchedCount: 2,
          hostedMailboxImportedCount: 1,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "budget_exhausted",
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
  mailboxPort: HostedRuntimeMailboxPort | null;
  runtimeLivenessIntervalMs?: number | null;
  runtimeLivenessPort?: RuntimeLivenessPort | null;
  workspacePort: HostedRuntimeWorkspacePort | null;
}): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get(sha256) {
        input.artifactGetCalls?.push(sha256);
        return input.artifactBytesByHash?.get(sha256) ?? null;
      },
      async put() {
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
    ...(input.mailboxPort ? { mailboxPort: input.mailboxPort } : {}),
    ...(input.runtimeLivenessIntervalMs
      ? { runtimeLivenessIntervalMs: input.runtimeLivenessIntervalMs }
      : {}),
    ...(input.runtimeLivenessPort ? { runtimeLivenessPort: input.runtimeLivenessPort } : {}),
    ...(input.workspacePort ? { workspacePort: input.workspacePort } : {}),
  };
}

function createMailboxPort(input: {
  events: string[];
  fetchRequests?: HostedMailboxFetchRequest[];
  items: HostedMailboxItem[];
}): HostedRuntimeMailboxPort {
  return {
    async fetch(request: HostedMailboxFetchRequest): Promise<HostedMailboxFetchResponse> {
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
}

function createWorkspacePort(input: {
  checkpointRequests: HostedWorkspaceCheckpointRequest[];
  checkpointWorkspace?: (request: HostedWorkspaceCheckpointRequest) => HostedWorkspaceState;
  events: string[];
  workspace: HostedWorkspaceState | null;
}): HostedRuntimeWorkspacePort {
  return {
    async read(): Promise<HostedWorkspaceReadResponse> {
      input.events.push("workspace.read");
      return {
        fetchedAt: TEST_NOW,
        workspace: input.workspace,
      };
    },
    async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
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
}): NonNullable<HostedWorkspaceState["snapshotRef"]> {
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
