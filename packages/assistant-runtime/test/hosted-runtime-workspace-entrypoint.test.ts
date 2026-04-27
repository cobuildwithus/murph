import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxPayloadFetchRequest,
  type HostedMailboxPayloadFetchResponse,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceRunRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution";
import { describe, expect, test } from "vitest";

import {
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  runHostedWorkspaceRuntimeJobInProcess,
} from "../src/hosted-runtime.ts";
import {
  readHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import type {
  HostedRuntimeMailboxPort,
  HostedRuntimePlatform,
  HostedRuntimeWorkspacePort,
} from "../src/hosted-runtime-contracts.ts";

const TEST_NOW = "2026-04-27T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_workspace_entrypoint";

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
      const result = await runHostedWorkspaceRuntimeJobInProcess({
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
      }, {
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

  test("fails closed when required workspace-run ports are absent", async () => {
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

    await expect(
      runHostedWorkspaceRuntimeJobInProcess(input, {
        createCheckpointSnapshot,
        importItem,
        platform: createPlatform({
          mailboxPort: null,
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
          workspacePort: {
            async checkpoint(): Promise<HostedWorkspaceCheckpointResponse> {
              throw new Error("Checkpoint should not run without workspace read.");
            },
          },
        }),
        vaultRoot,
      }),
    ).rejects.toThrow(/workspace port must support read/u);
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
      const result = await runHostedWorkspaceRuntimeJobInProcess({
        request: createWorkspaceRunRequest({
          budget: {
            maxMailboxItems: 1,
          },
        }),
      }, {
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
      const result = await runHostedWorkspaceRuntimeJobInProcess({
        request: createWorkspaceRunRequest(),
      }, {
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
      const result = await runHostedWorkspaceRuntimeJobInProcess({
        request: createWorkspaceRunRequest(),
      }, {
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

  test("parses additive workspace-run inputs and rejects legacy run-drain fields", () => {
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
  mailboxPort: HostedRuntimeMailboxPort | null;
  workspacePort: HostedRuntimeWorkspacePort | null;
}): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get() {
        return null;
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
    ...(input.workspacePort ? { workspacePort: input.workspacePort } : {}),
  };
}

function createMailboxPort(input: {
  events: string[];
  items: HostedMailboxItem[];
}): HostedRuntimeMailboxPort {
  return {
    async fetch(request: HostedMailboxFetchRequest): Promise<HostedMailboxFetchResponse> {
      input.events.push("mailbox.fetch");
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
          payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
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
  overrides: Partial<HostedWorkspaceRunRequest> = {},
): HostedWorkspaceRunRequest {
  return {
    attemptId: "attempt_synthetic_workspace_run",
    leaseGeneration: "1",
    reason: "nudge" as const,
    userId: TEST_USER_ID,
    workspaceVersion: "0",
    ...overrides,
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
