import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  ensureHostedWorkspace: vi.fn(),
  getPrisma: vi.fn(),
  prisma: {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      await callback({ kind: "tx" })
    ),
    kind: "prisma",
  },
  readHostedMailboxItemCheckpointById: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  signalWithStart: vi.fn(),
}));

const defaultWorkflowOptions = {
  ensureRuntimeProcessingStartToCloseTimeoutMs: 15_000,
  readRuntimeDemandStartToCloseTimeoutMs: 10_000,
};

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemCheckpointById:
    mocks.readHostedMailboxItemCheckpointById,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  ensureHostedWorkspace: mocks.ensureHostedWorkspace,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import {
  sanitizeHostedRuntimeSignalSource,
  signalHostedBrowserVaultRefreshRuntime,
  signalHostedDeviceSyncBackgroundMaintenanceRuntime,
  signalHostedDeviceSyncMailboxRuntime,
  signalHostedMailboxAppendRuntime,
  signalHostedManualRunRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";

describe("hosted runtime Temporal signaling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.ensureHostedWorkspace.mockResolvedValue(buildHostedWorkspaceRecord());
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveMemberRecord());
    mocks.signalWithStart.mockResolvedValue(undefined);
    mocks.appendHostedMailboxEnvelopeTx.mockImplementation(async (input) => ({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: {
        id: `mailbox_${input.envelope.kind}`,
        kind: input.envelope.kind,
        lane: "system",
        laneSeq: "77",
        userId: input.envelope.userId,
      },
    }));
    mocks.readHostedMailboxItemCheckpointById.mockResolvedValue({
      id: "mailbox_123",
      lane: "conversation",
      laneSeq: "42",
      occurredAt: "2026-03-26T12:00:00.000Z",
      userId: "member_123",
    });
  });

  it("signals the per-user workflow with only a mailbox pointer", async () => {
    await expect(signalHostedMailboxAppendRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
      source: "email:agentmail",
    })).resolves.toEqual({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      {
        args: [{
          options: defaultWorkflowOptions,
          userId: "member_123",
        }],
        signal: HOSTED_USER_RUNTIME_SIGNAL_NAME,
        signalArgs: [{
          kind: "mailbox_appended",
          lane: "conversation",
          laneSeq: "42",
          mailboxItemId: "mailbox_123",
          source: "email:agentmail",
        }],
        taskQueue: HOSTED_USER_RUNTIME_TASK_QUEUE,
        workflowId: "hosted-user-runtime:member_123",
      },
    );
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "member_123",
    });
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    const signal = mocks.signalWithStart.mock.calls[0]?.[1]?.signalArgs[0];
    expect(Object.keys(signal as Record<string, unknown>).sort()).toEqual([
      "kind",
      "lane",
      "laneSeq",
      "mailboxItemId",
      "source",
    ]);
    expect(JSON.stringify(signal)).not.toMatch(/Please look|providerHeaders|messageText/u);
  });

  it("bounds and sanitizes mailbox source strings before signaling", async () => {
    const source = sanitizeHostedRuntimeSignalSource(
      " Agent Mail / Provider Hook <> With Spaces And A Very Very Long Tail ",
    );

    expect(source).toMatch(/^[a-z0-9._:-]+$/u);
    expect(source.length).toBeLessThanOrEqual(64);

    await signalHostedMailboxAppendRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
      source,
    });

    expect(mocks.signalWithStart.mock.calls[0]?.[1]?.signalArgs[0]).toMatchObject({
      source,
    });
  });

  it("signals duplicate mailbox append attempts safely", async () => {
    const client = buildClient();

    await signalHostedMailboxAppendRuntime({
      client,
      mailboxItemId: "mailbox_123",
      source: "telegram",
    });
    await signalHostedMailboxAppendRuntime({
      client,
      mailboxItemId: "mailbox_123",
      source: "telegram",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledTimes(2);
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledTimes(2);
    expect(mocks.signalWithStart.mock.calls[1]?.[1]?.signalArgs[0]).toEqual(
      mocks.signalWithStart.mock.calls[0]?.[1]?.signalArgs[0],
    );
  });

  it("persists device-sync recovery as durable control demand before signaling", async () => {
    await signalHostedDeviceSyncMailboxRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
      recoveryIntent: "device-sync-dirty-recovery",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: expect.stringMatching(/^runtime-control:device-sync-recovery:[0-9a-f]{32}$/u),
        kind: "runtime.device-sync-recovery-requested",
        occurredAt: "2026-03-26T12:00:00.000Z",
        userId: "member_123",
      }),
      tx: { kind: "tx" },
    });
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "device_sync_recovery_requested",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "member_123",
    });
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
  });

  it("signals device-sync background maintenance without appending mailbox work", async () => {
    await signalHostedDeviceSyncBackgroundMaintenanceRuntime({
      client: buildClient(),
      userId: "member_123",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "device_sync_recovery_requested",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "member_123",
    });
  });

  it("dedupes durable device-sync recovery demands by source mailbox item and intent", async () => {
    const client = buildClient();

    await signalHostedDeviceSyncMailboxRuntime({
      client,
      mailboxItemId: "mailbox_123",
      recoveryIntent: "device-sync-dirty-recovery",
    });
    await signalHostedDeviceSyncMailboxRuntime({
      client,
      mailboxItemId: "mailbox_123",
      recoveryIntent: "device-sync-dirty-recovery",
    });
    await signalHostedDeviceSyncMailboxRuntime({
      client,
      mailboxItemId: "mailbox_123",
      recoveryIntent: "device-sync-reconcile-recovery",
    });

    const eventIds = mocks.appendHostedMailboxEnvelopeTx.mock.calls.map(
      ([input]) => input.envelope.eventId,
    );
    const occurredAts = mocks.appendHostedMailboxEnvelopeTx.mock.calls.map(
      ([input]) => input.envelope.occurredAt,
    );
    expect(eventIds[0]).toBe(eventIds[1]);
    expect(eventIds[0]).toMatch(/^runtime-control:device-sync-recovery:[0-9a-f]{32}$/u);
    expect(eventIds[2]).toMatch(/^runtime-control:device-sync-recovery:[0-9a-f]{32}$/u);
    expect(eventIds[2]).not.toBe(eventIds[0]);
    expect(occurredAts).toEqual([
      "2026-03-26T12:00:00.000Z",
      "2026-03-26T12:00:00.000Z",
      "2026-03-26T12:00:00.000Z",
    ]);
    expect(mocks.signalWithStart.mock.calls.map(
      ([, options]) => options.signalArgs[0],
    )).toEqual([
      { kind: "device_sync_recovery_requested" },
      { kind: "device_sync_recovery_requested" },
      { kind: "device_sync_recovery_requested" },
    ]);
  });

  it("re-signals device-sync recovery when the durable control item already exists", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: true,
      inserted: false,
      item: {
        id: "mailbox_existing_recovery_control",
        kind: "runtime.device-sync-recovery-requested",
        lane: "system",
        laneSeq: "77",
        userId: "member_123",
      },
    });

    await signalHostedDeviceSyncMailboxRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
      recoveryIntent: "device-sync-dirty-recovery",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: expect.stringMatching(/^runtime-control:device-sync-recovery:[0-9a-f]{32}$/u),
        kind: "runtime.device-sync-recovery-requested",
        occurredAt: "2026-03-26T12:00:00.000Z",
      }),
      tx: { kind: "tx" },
    });
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "device_sync_recovery_requested",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
  });

  it("persists browser-vault refresh as durable control demand before signaling", async () => {
    await signalHostedBrowserVaultRefreshRuntime({
      client: buildClient(),
      userId: "member_123",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "runtime.browser-vault-refresh-requested",
        userId: "member_123",
      }),
      tx: { kind: "tx" },
    });
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "mailbox_appended",
          lane: "system",
          laneSeq: "77",
          mailboxItemId: "mailbox_runtime.browser-vault-refresh-requested",
          source: "browser-vault-refresh",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "member_123",
    });
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(JSON.stringify(mocks.signalWithStart.mock.calls[0]?.[1]?.signalArgs[0])).not.toMatch(
      /prompt|headers|payload|message/u,
    );
  });

  it("persists manual runs as durable control demand before signaling", async () => {
    await signalHostedManualRunRuntime({
      client: buildClient(),
      userId: "member_123",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "runtime.manual-requested",
        userId: "member_123",
      }),
      tx: { kind: "tx" },
    });
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "mailbox_appended",
          lane: "system",
          laneSeq: "77",
          mailboxItemId: "mailbox_runtime.manual-requested",
          source: "manual",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "member_123",
    });
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
  });

  it("ensures workspace before device-sync mailbox pointer signals", async () => {
    await signalHostedDeviceSyncMailboxRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "mailbox_appended",
          lane: "conversation",
          laneSeq: "42",
          mailboxItemId: "mailbox_123",
          source: "device-sync",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "member_123",
    });
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
  });

  it("does not upsert workspace or start workflow for missing users on explicit signals", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue(null);

    await expect(signalHostedManualRunRuntime({
      client: buildClient(),
      userId: "member_deleted",
    })).rejects.toThrow("Hosted runtime user is not active.");

    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_deleted",
      prisma: mocks.prisma,
    });
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("does not upsert workspace or start workflow for inactive users on explicit signals", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveMemberRecord({
      billingStatus: "canceled",
    }));

    await expect(signalHostedBrowserVaultRefreshRuntime({
      client: buildClient(),
      userId: "member_inactive",
    })).rejects.toThrow("Hosted runtime user is not active.");

    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_inactive",
      prisma: mocks.prisma,
    });
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("does not upsert workspace or start workflow for suspended users on explicit signals", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveMemberRecord({
      suspendedAt: new Date("2026-05-21T00:00:00.000Z"),
    }));

    await expect(signalHostedManualRunRuntime({
      client: buildClient(),
      userId: "member_suspended",
    })).rejects.toThrow("Hosted runtime user is not active.");

    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_suspended",
      prisma: mocks.prisma,
    });
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("does not upsert workspace or start workflow for missing users on mailbox signals", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue(null);

    await expect(signalHostedMailboxAppendRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
      source: "email:agentmail",
    })).rejects.toThrow("Hosted runtime user is not active.");

    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });
});

function buildClient() {
  return {
    workflow: {
      signalWithStart: mocks.signalWithStart,
    },
  };
}

function buildActiveMemberRecord(overrides: Partial<{
  billingStatus: string;
  suspendedAt: Date | null;
}> = {}) {
  return {
    billingStatus: "active",
    createdAt: new Date("2026-05-21T00:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-05-21T00:00:00.000Z"),
    ...overrides,
  };
}

function buildHostedWorkspaceRecord(overrides: Partial<{
  redactedStatusJson: unknown;
}> = {}) {
  return {
    browserVaultReplicaRef: null,
    checkpointedAt: null,
    createdAt: "2026-05-21T00:00:00.000Z",
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: null,
    snapshotRef: null,
    updatedAt: "2026-05-21T00:00:00.000Z",
    userId: "member_123",
    version: "0",
    ...overrides,
  };
}
