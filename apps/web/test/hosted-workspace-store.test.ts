import { Prisma } from "@prisma/client";
import {
  HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
} from "@murphai/hosted-execution/bundles";
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
      browserVaultReplicaRef: createBrowserVaultReplicaRef("snapshot_stale_hash"),
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
      browserVaultReplicaRef: createBrowserVaultReplicaRef(),
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

  it("clears browser-vault replica refs when non-empty snapshot checkpoints omit continuity", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef: null,
        snapshotRef: createBundleRef("snapshot_2"),
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "maintenance",
      snapshotRef: createBundleRef("snapshot_2"),
      tx,
      userId: "member_workspace_1",
    });

    const updateData = hostedWorkspace.updateMany.mock.calls[0]?.[0].data;
    expect(updateData).toEqual(expect.objectContaining({
      browserVaultReplicaRef: Prisma.DbNull,
      snapshotRef: createBundleRef("snapshot_2"),
    }));
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        browserVaultReplicaRef: null,
        snapshotRef: createBundleRef("snapshot_2"),
        version: "5",
      },
    });
  });

  it("does not preserve a stale browser-vault replica ref when old runner payloads omit continuity", async () => {
    const staleBrowserVaultReplicaRef = createBrowserVaultReplicaRef("snapshot_1_hash");
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef: null,
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

    expect(staleBrowserVaultReplicaRef.sourceBundleHash).toBe("snapshot_1_hash");
    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        browserVaultReplicaRef: Prisma.DbNull,
        snapshotRef: createBundleRef("snapshot_2"),
      }),
      where: {
        userId: "member_workspace_1",
        version: 4n,
      },
    });
  });

  it("allows non-empty snapshot checkpoints with an explicit null browser-vault replica ref", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef: null,
        snapshotRef: createBundleRef("snapshot_2"),
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      browserVaultReplicaRef: null,
      expectedVersion: "4",
      reason: "maintenance",
      snapshotRef: createBundleRef("snapshot_2"),
      tx,
      userId: "member_workspace_1",
    });

    expect(hostedWorkspace.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        browserVaultReplicaRef: Prisma.DbNull,
        snapshotRef: createBundleRef("snapshot_2"),
      }),
      where: {
        userId: "member_workspace_1",
        version: 4n,
      },
    });
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        browserVaultReplicaRef: null,
        snapshotRef: createBundleRef("snapshot_2"),
        version: "5",
      },
    });
  });

  it("rejects browser-vault replica refs that do not match the snapshot hash", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate();
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    await expect(checkpointHostedWorkspaceTx({
      browserVaultReplicaRef: createBrowserVaultReplicaRef("different_snapshot_hash"),
      expectedVersion: "4",
      reason: "maintenance",
      snapshotRef: createBundleRef("snapshot_2"),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(
      "Hosted workspace checkpoint browser-vault replica sourceBundleHash must match snapshot base hash.",
    );
    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
  });

  it("allows latest-hot checkpoint refs to carry forward the existing browser-vault replica explicitly", async () => {
    const browserVaultReplicaRef = createBrowserVaultReplicaRef("snapshot_2_hash");
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        browserVaultReplicaRef,
        snapshotRef: createLayeredSnapshotRef({
          base: createBundleRef("snapshot_2"),
          hot: createBundleRef("hot_1"),
        }),
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });
    const nextSnapshotRef = createLayeredSnapshotRef({
      base: createBundleRef("snapshot_2"),
      hot: createBundleRef("hot_2"),
    });

    const result = await checkpointHostedWorkspaceTx({
      browserVaultReplicaRef,
      expectedVersion: "4",
      reason: "import",
      snapshotRef: nextSnapshotRef,
      tx,
      userId: "member_workspace_1",
    });

    const updateData = hostedWorkspace.updateMany.mock.calls[0]?.[0].data;
    expect(updateData).toEqual(expect.objectContaining({
      browserVaultReplicaRef,
      snapshotRef: nextSnapshotRef,
    }));
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        snapshotRef: createLayeredSnapshotRef({
          base: createBundleRef("snapshot_2"),
          hot: createBundleRef("hot_1"),
        }),
      },
    });
  });

  it("clears browser-vault replica refs when latest-hot checkpoint refs omit continuity", async () => {
    const nextSnapshotRef = createLayeredSnapshotRef({
      base: createBundleRef("snapshot_2"),
      hot: createBundleRef("hot_2"),
    });
    const hostedWorkspace = createHostedWorkspaceDelegate({
      findUnique: vi.fn<HostedWorkspaceFindUnique>(async () => buildHostedWorkspaceRow({
        snapshotRef: nextSnapshotRef,
        version: 5n,
      })),
      updateMany: vi.fn<HostedWorkspaceUpdateMany>(async () => ({ count: 1 })),
    });
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    const result = await checkpointHostedWorkspaceTx({
      expectedVersion: "4",
      reason: "import",
      snapshotRef: nextSnapshotRef,
      tx,
      userId: "member_workspace_1",
    });

    const updateData = hostedWorkspace.updateMany.mock.calls[0]?.[0].data;
    expect(updateData).toEqual(expect.objectContaining({
      browserVaultReplicaRef: Prisma.DbNull,
      snapshotRef: nextSnapshotRef,
    }));
    expect(result).toMatchObject({
      status: "updated",
      workspace: {
        browserVaultReplicaRef: null,
        snapshotRef: nextSnapshotRef,
        version: "5",
      },
    });
  });

  it("rejects latest-hot checkpoint refs when browser-vault continuity points at a different base", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate();
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    await expect(checkpointHostedWorkspaceTx({
      browserVaultReplicaRef: createBrowserVaultReplicaRef("snapshot_1_hash"),
      expectedVersion: "4",
      reason: "import",
      snapshotRef: createLayeredSnapshotRef({
        base: createBundleRef("snapshot_2"),
        hot: createBundleRef("hot_2"),
      }),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(
      "Hosted workspace checkpoint browser-vault replica sourceBundleHash must match snapshot base hash.",
    );
    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
  });

  it("rejects latest-hot checkpoint refs without a base when browser-vault continuity is present", async () => {
    const hostedWorkspace = createHostedWorkspaceDelegate();
    const tx = createHostedWorkspaceTx({
      hostedWorkspace,
    });

    await expect(checkpointHostedWorkspaceTx({
      browserVaultReplicaRef: createBrowserVaultReplicaRef("snapshot_2_hash"),
      expectedVersion: "4",
      reason: "import",
      snapshotRef: createLayeredSnapshotRef({
        base: null,
        hot: createBundleRef("hot_2"),
      }),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(
      "Hosted workspace checkpoint cannot persist a browser-vault replica without a base snapshot.",
    );
    expect(hostedWorkspace.updateMany).not.toHaveBeenCalled();
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

  it("allows bounded sanitized device-sync failure summaries", async () => {
    const hostedRuntimeLog = createHostedRuntimeLogDelegate();
    const tx = createHostedWorkspaceTx({
      hostedRuntimeLog,
      hostedWorkspace: createHostedWorkspaceDelegate(),
    });
    const failureSummary = [
      "Device provider snapshot import input is invalid.",
      `validationIssues=${"collectionTypeMismatch ".repeat(40).trim()}`,
    ].join(" | ");

    const result = await recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "device-sync",
      errorCode: "SYNC_JOB_FAILED",
      eventCode: "device-sync.job_failed",
      level: "warn",
      phase: "invoke",
      redacted: {
        failureCode: "SYNC_JOB_FAILED",
        failureSummary,
        provider: "whoop",
      },
      tx,
      userId: "member_workspace_1",
    });

    expect(failureSummary.length).toBeGreaterThan(128);
    expect(hostedRuntimeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        component: "device-sync",
        errorCode: "SYNC_JOB_FAILED",
        eventCode: "device-sync.job_failed",
        level: "warn",
        phase: "invoke",
        redactedJson: {
          failureCode: "SYNC_JOB_FAILED",
          failureSummary,
          provider: "whoop",
        },
      }),
    });
    expect(result.redactedJson).toEqual({
      failureCode: "SYNC_JOB_FAILED",
      failureSummary,
      provider: "whoop",
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
        Array.from({ length: 49 }, (_, index) => [`count${index}`, index]),
      ),
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/at most 48 fields/u);

    await expect(recordHostedRuntimeLogTx({
      at: "2026-04-26T00:02:00.000Z",
      component: "device-sync",
      eventCode: "device-sync.job_failed",
      level: "warn",
      phase: "invoke",
      redacted: {
        failureSummary: "x".repeat(2049),
      },
      tx,
      userId: "member_workspace_1",
    })).rejects.toThrow(/at most 2048 characters/u);

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

function createLayeredSnapshotRef(input: {
  base: ReturnType<typeof createBundleRef> | null;
  hot: ReturnType<typeof createBundleRef> | null;
}) {
  return {
    base: input.base,
    hot: input.hot,
    schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  };
}

function createBrowserVaultReplicaRef(sourceBundleHash = "snapshot_2_hash") {
  return {
    byteLength: 256,
    dataVersion: "workspace-test-data-version",
    generatedAt: "2026-04-26T00:00:00.000Z",
    keyId: "browser-key-1",
    objectKey: "browser_projection_1",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:workspace-test",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
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
