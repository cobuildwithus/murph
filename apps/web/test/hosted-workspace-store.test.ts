import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  checkpointHostedWorkspaceTx,
  ensureHostedWorkspace,
  recordHostedRuntimeLogTx,
  type HostedRuntimeLogRow,
  type HostedWorkspaceRow,
} from "@/src/lib/hosted-workspace/store";

const FIXED_NOW = new Date("2026-04-26T00:00:00.000Z");

describe("hosted workspace store", () => {
  it("creates the version-zero workspace row when missing", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate();
    const prisma = createHostedWorkspaceClient({
      hostedWorkspace,
    });

    const workspace = await ensureHostedWorkspace({
      prisma,
      userId: "member_workspace_1",
    });

    expect(hostedWorkspace.upsert).toHaveBeenCalledWith({
      create: {
        userId: "member_workspace_1",
      },
      update: {},
      where: {
        userId: "member_workspace_1",
      },
    });
    expect(workspace).toMatchObject({
      snapshotRef: null,
      userId: "member_workspace_1",
      version: "4",
    });
  });

  it("updates checkpoints with an expected-version CAS fence", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef: createBrowserVaultReplicaRef(),
        checkpointedAt: new Date("2026-04-26T00:01:00.000Z"),
        nextWakeAt: new Date("2026-04-26T00:05:00.000Z"),
        nextWakeReason: "mailbox",
        redactedStatusJson: {
          state: "idle",
        },
        snapshotRef: createBundleRef("snapshot_2"),
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      browserVaultReplicaRef: createBrowserVaultReplicaRef(),
      checkpointedAt: "2026-04-26T00:01:00.000Z",
      expectedVersion: "4",
      nextWakeAt: "2026-04-26T00:05:00.000Z",
      nextWakeReason: "mailbox",
      reason: "import",
      redactedStatusJson: {
        importedConversationSeq: "12",
        state: "idle",
      },
      snapshotRef: createBundleRef("snapshot_2"),
      tx,
      userId: "member_workspace_1",
    });

    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        browserVaultReplicaRef: createBrowserVaultReplicaRef(),
        checkpointedAt: new Date("2026-04-26T00:01:00.000Z"),
        nextWakeAt: new Date("2026-04-26T00:05:00.000Z"),
        nextWakeReason: "mailbox",
        redactedStatusJson: {
          importedConversationSeq: "12",
          state: "idle",
        },
        snapshotRef: createBundleRef("snapshot_2"),
        version: {
          increment: 1,
        },
      }),
      where: {
        userId: "member_workspace_1",
        version: 4n,
      },
    });
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        snapshotRef: createBundleRef("snapshot_2"),
        userId: "member_workspace_1",
        version: "5",
      },
    });
  });

  it("reports CAS conflicts without merging checkpoint refs", async () => {
    const current = buildHostedWorkspaceRow({
      snapshotRef: createBundleRef("snapshot_current"),
      version: 6n,
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => current),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 0 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: 4n,
      reason: "idle",
      snapshotRef: createBundleRef("snapshot_stale"),
      tx,
      userId: "member_workspace_1",
    });

    expect(result).toMatchObject({
      status: "conflict",
      workspace: {
        snapshotRef: createBundleRef("snapshot_current"),
        version: "6",
      },
    });
  });

  it("preserves optional wake and redacted status fields when a checkpoint omits them", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        nextWakeAt: new Date("2026-04-26T00:05:00.000Z"),
        nextWakeReason: "assistant",
        redactedStatusJson: {
          hostedAssistantProgressed: true,
        },
        snapshotRef: createBundleRef("snapshot_2"),
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "maintenance",
      snapshotRef: createBundleRef("snapshot_2"),
      tx,
      userId: "member_workspace_1",
    });

    const updateData = hostedWorkspace.updateMany.mock.calls[0]?.[0].data;
    expect(updateData).not.toHaveProperty("nextWakeAt");
    expect(updateData).not.toHaveProperty("nextWakeReason");
    expect(updateData).not.toHaveProperty("redactedStatusJson");
  });
});

describe("hosted runtime log store", () => {
  it("inserts parser-accepted structured log fields", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    const result = await recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "mailbox",
      eventCode: "mailbox.imported",
      level: "warn",
      mailboxLane: "conversation",
      mailboxSeqStart: "12",
      phase: "import",
      redacted: {
        dedupeConflict: true,
        incomingKind: "conversation.message",
        unallowlistedDetail: "DROP_THIS",
      },
      tx,
      userId: "member_workspace_1",
      workspaceVersion: 5n,
    });

    expect(hostedRuntimeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        at: new Date("2026-04-26T00:02:00.000Z"),
        component: "mailbox",
        eventCode: "mailbox.imported",
        level: "warn",
        mailboxLane: "conversation",
        mailboxSeqStart: 12n,
        phase: "import",
        redactedJson: {
          dedupeConflict: true,
          incomingKind: "conversation.message",
          unallowlistedDetail: "DROP_THIS",
        },
        userId: "member_workspace_1",
        workspaceVersion: 5n,
      }),
    });
    expect(result.redactedJson).toEqual({
      dedupeConflict: true,
      incomingKind: "conversation.message",
      unallowlistedDetail: "DROP_THIS",
    });
  });

  it("rejects unsafe or oversized redacted log metadata before persistence", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });

    await expect(recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "mailbox",
      eventCode: "mailbox.imported",
      level: "warn",
      phase: "import",
      redacted: {
        reason: `sent to ${["person", "example.test"].join("@")}`,
      },
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/email address/u);

    await expect(recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "mailbox",
      eventCode: "mailbox.imported",
      level: "warn",
      phase: "import",
      redacted: Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => [`count${index}`, index]),
      ),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/at most 24 fields/u);

    expect(hostedRuntimeLog.create).not.toHaveBeenCalled();
  });
});

interface HostedWorkspaceUpdateManyArgs {
  data: Prisma.HostedWorkspaceUpdateManyMutationInput;
  where: {
    userId: string;
    version: bigint;
  };
}

interface HostedWorkspaceFindUniqueArgs {
  where: {
    userId: string;
  };
}

interface HostedWorkspaceUpsertArgs {
  create: {
    userId: string;
  };
  update: Record<string, never>;
  where: {
    userId: string;
  };
}

interface HostedRuntimeLogCreateArgs {
  data: {
    at: Date;
    attemptId: string | null;
    checkpointVersion: bigint | null;
    component: string;
    errorCode: string | null;
    eventCode: string;
    id: string;
    leaseGeneration: bigint | null;
    level: string;
    mailboxLane: string | null;
    mailboxSeqEnd: bigint | null;
    mailboxSeqStart: bigint | null;
    outboxIntentRef: string | null;
    phase: string;
    redactedJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
    userId: string;
    workspaceVersion: bigint | null;
  };
}

type HostedWorkspaceUpdateMany = (args: HostedWorkspaceUpdateManyArgs) => Promise<{ count: number }>;
type HostedWorkspaceFindUnique = (args: HostedWorkspaceFindUniqueArgs) => Promise<HostedWorkspaceRow | null>;
type HostedWorkspaceUpsert = (args: HostedWorkspaceUpsertArgs) => Promise<HostedWorkspaceRow>;
type HostedRuntimeLogCreate = (args: HostedRuntimeLogCreateArgs) => Promise<HostedRuntimeLogRow>;

function buildHostedWorkspaceRow(
  overrides: Partial<HostedWorkspaceRow> = {},
): HostedWorkspaceRow {
  return {
    browserVaultReplicaRef: null,
    checkpointedAt: null,
    createdAt: FIXED_NOW,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: null,
    snapshotRef: null,
    updatedAt: FIXED_NOW,
    userId: "member_workspace_1",
    version: 4n,
    ...overrides,
  };
}

function buildHostedRuntimeLogRow(
  overrides: Partial<HostedRuntimeLogRow> = {},
): HostedRuntimeLogRow {
  return {
    at: FIXED_NOW,
    attemptId: null,
    checkpointVersion: null,
    component: "mailbox",
    createdAt: FIXED_NOW,
    errorCode: null,
    eventCode: "mailbox.imported",
    id: "runtime_log_1",
    leaseGeneration: null,
    level: "warn",
    mailboxLane: "conversation",
    mailboxSeqEnd: null,
    mailboxSeqStart: 12n,
    outboxIntentRef: null,
    phase: "import",
    redactedJson: {
      dedupeConflict: true,
      incomingKind: "conversation.message",
    },
    userId: "member_workspace_1",
    workspaceVersion: 5n,
    ...overrides,
  };
}

function createBundleRef(id: string) {
  return {
    hash: `${id}_hash`,
    key: `bundles/vault/${id}.bundle.json`,
    size: 128,
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
}

function createBrowserVaultReplicaRef() {
  return {
    byteLength: 256,
    dataVersion: "workspace-test-data-version",
    generatedAt: "2026-04-26T00:00:00.000Z",
    keyId: "browser-key-1",
    objectKey: "browser_projection_1",
    replicaSchema: "murph.browser-vault-replica.v1",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash: "snapshot_2_hash",
  };
}

function createHostedWorkspaceDelegate(overrides: Partial<{
  findUnique: ReturnType<typeof vi.fn<HostedWorkspaceFindUnique>>;
  updateMany: ReturnType<typeof vi.fn<HostedWorkspaceUpdateMany>>;
  upsert: ReturnType<typeof vi.fn<HostedWorkspaceUpsert>>;
}> = {}) {
  return {
    findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow()),
    updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    upsert: vi.fn<HostedWorkspaceUpsert>(async (args) => buildHostedWorkspaceRow({
      userId: args.create.userId,
    })),
    ...overrides,
  };
}

function createHostedRuntimeLogDelegate(overrides: Partial<{
  create: ReturnType<typeof vi.fn<HostedRuntimeLogCreate>>;
}> = {}) {
  return {
    create: vi.fn<HostedRuntimeLogCreate>(async (args) => {
      const { redactedJson, ...data } = args.data;

      return buildHostedRuntimeLogRow({
        ...data,
        redactedJson: redactedJson === Prisma.DbNull
          ? null
          : JSON.parse(JSON.stringify(redactedJson)) as Prisma.JsonValue,
      });
    }),
    ...overrides,
  };
}

function createHostedWorkspaceTx(input: {
  hostedRuntimeLog?: ReturnType<typeof createHostedRuntimeLogDelegate>;
  hostedWorkspace: ReturnType<typeof createHostedWorkspaceDelegate>;
}) {
  return Object.assign(Object.create(null), {
    hostedRuntimeLog: input.hostedRuntimeLog ?? createHostedRuntimeLogDelegate(),
    hostedWorkspace: input.hostedWorkspace,
  }) as Parameters<typeof checkpointHostedWorkspaceTx>[0]["tx"];
}

function createHostedWorkspaceClient(input: {
  hostedWorkspace: ReturnType<typeof createHostedWorkspaceDelegate>;
}) {
  return Object.assign(Object.create(null), {
    hostedWorkspace: input.hostedWorkspace,
  }) as Parameters<typeof ensureHostedWorkspace>[0]["prisma"];
}
