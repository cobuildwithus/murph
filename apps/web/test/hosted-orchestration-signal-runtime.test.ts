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
  ensureHostedWorkspace: vi.fn(),
  getPrisma: vi.fn(),
  prisma: { kind: "prisma" },
  readHostedMailboxItemCheckpointById: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  signalWithStart: vi.fn(),
}));

const defaultWorkflowOptions = {
  ensureCloudflareExecutionStartToCloseTimeoutMs: 660_000,
  readRuntimeDemandStartToCloseTimeoutMs: 10_000,
  runtimeCompletedFailureRecheckDelayMs: 30_000,
};

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
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
  signalHostedDeviceSyncMailboxRuntime,
  signalHostedMailboxAppendRuntime,
  signalHostedManualRunRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";

describe("hosted runtime Temporal signaling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveMemberRecord());
    mocks.signalWithStart.mockResolvedValue(undefined);
    mocks.readHostedMailboxItemCheckpointById.mockResolvedValue({
      id: "mailbox_123",
      lane: "conversation",
      laneSeq: "42",
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

  it("uses device-sync recovery signals for recovery handoff semantics", async () => {
    await signalHostedDeviceSyncMailboxRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
      recoveryIntent: "device-sync-dirty-recovery",
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

  it("signals browser-vault refresh as a pointer-only wake hint", async () => {
    await signalHostedBrowserVaultRefreshRuntime({
      client: buildClient(),
      userId: "member_123",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "browser_vault_refresh_requested",
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

  it("signals manual runs as pointer-only wake hints", async () => {
    await signalHostedManualRunRuntime({
      client: buildClient(),
      userId: "member_123",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "manual_run_requested",
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
