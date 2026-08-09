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

const mocks = vi.hoisted(() => {
  const hostedMemberFindUnique = vi.fn();
  const hostedThreadContainerParticipantFindFirst = vi.fn();

  return {
    appendHostedMailboxEnvelopeTx: vi.fn(),
    ensureHostedWorkspace: vi.fn(),
    getPrisma: vi.fn(),
    hostedMemberFindUnique,
    hostedThreadContainerParticipantFindFirst,
    prisma: {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        await callback({ kind: "tx" })
      ),
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
      hostedThreadContainerParticipant: {
        findFirst: hostedThreadContainerParticipantFindFirst,
      },
      hostedAccountGroupMembership: {
        count: vi.fn(async () => 0),
        findFirst: vi.fn(async () => null),
      },
      kind: "prisma",
    },
    readHostedMailboxItemCheckpointById: vi.fn(),
    resolveHostedRuntimeAiUsageGate: vi.fn(),
    signalWithStart: vi.fn(),
    withAbortSignal: vi.fn(),
  };
});

const defaultWorkflowOptions = {
  ensureRuntimeProcessingStartToCloseTimeoutMs: 15_000,
};

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemCheckpointById:
    mocks.readHostedMailboxItemCheckpointById,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  ensureHostedWorkspace: mocks.ensureHostedWorkspace,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-orchestration/runtime-usage-decision", () => ({
  resolveHostedRuntimeAiUsageGate: mocks.resolveHostedRuntimeAiUsageGate,
}));

import {
  signalHostedBrowserVaultRefreshRuntime,
  signalHostedDeviceSyncMailboxRuntime,
  signalHostedMailboxAppendRuntime,
  signalHostedManualRunRuntime,
  signalHostedRetentionRuntimeRecheck,
  signalHostedRuntimeRecheckRuntime,
  signalHostedRuntimeMaintenanceRuntime,
  signalHostedRuntimeWakeRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";

describe("hosted runtime Temporal signaling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.ensureHostedWorkspace.mockResolvedValue(buildHostedWorkspaceRecord());
    mocks.hostedMemberFindUnique.mockResolvedValue(buildActiveMemberRecord());
    mocks.hostedThreadContainerParticipantFindFirst.mockResolvedValue(null);
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValue({
      status: "allowed",
    });
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
        }],
        taskQueue: HOSTED_USER_RUNTIME_TASK_QUEUE,
        workflowId: "hosted-user-runtime:member_123",
      },
    );
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "member_123",
    });
    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
    const signal = mocks.signalWithStart.mock.calls[0]?.[1]?.signalArgs[0];
    expect(Object.keys(signal as Record<string, unknown>).sort()).toEqual([
      "kind",
      "lane",
      "laneSeq",
      "mailboxItemId",
    ]);
    expect(JSON.stringify(signal)).not.toMatch(/Please look|providerHeaders|messageText/u);
  });

  it("runs a bounded workflow signal inside the Temporal abort boundary", async () => {
    const abortSignal = new AbortController().signal;

    await signalHostedMailboxAppendRuntime({
      abortSignal,
      client: buildClient(),
      mailboxItemId: "mailbox_123",
    });

    expect(mocks.withAbortSignal).toHaveBeenCalledWith(
      abortSignal,
      expect.any(Function),
    );
    expect(mocks.signalWithStart).toHaveBeenCalledTimes(1);
  });

  it("skips the checkpoint re-read and workspace ensure but still requires active access when the caller supplies planner lane facts", async () => {
    await expect(signalHostedMailboxAppendRuntime({
      client: buildClient(),
      expectedUserId: "member_123",
      knownCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
        userId: "member_123",
      },
      mailboxItemId: "mailbox_123",
    })).resolves.toEqual({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });

    expect(mocks.readHostedMailboxItemCheckpointById).not.toHaveBeenCalled();
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "mailbox_appended",
          lane: "conversation",
          laneSeq: "42",
          mailboxItemId: "mailbox_123",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
  });

  it("signals planner lane facts for participant-authorized thread containers", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue(buildActiveMemberRecord({
      billingStatus: "canceled",
      threadContainer: {
        owner: {
          accountGroupMemberships: [],
          billingStatus: "paused",
          suspendedAt: null,
        },
      },
    }));
    mocks.hostedThreadContainerParticipantFindFirst.mockResolvedValue({
      participantMemberId: "member_active_participant",
    });

    await expect(signalHostedMailboxAppendRuntime({
      client: buildClient(),
      expectedUserId: "member_123",
      knownCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
        userId: "member_123",
      },
      mailboxItemId: "mailbox_123",
    })).resolves.toEqual({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });

    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
    expect(mocks.hostedThreadContainerParticipantFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "mailbox_appended",
          lane: "conversation",
          laneSeq: "42",
          mailboxItemId: "mailbox_123",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
  });

  it("does not signal planner lane facts without active owner or participant access", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue(buildActiveMemberRecord({
      billingStatus: "canceled",
      threadContainer: {
        owner: {
          accountGroupMemberships: [],
          billingStatus: "paused",
          suspendedAt: null,
        },
      },
    }));

    await expect(signalHostedMailboxAppendRuntime({
      client: buildClient(),
      expectedUserId: "member_123",
      knownCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
        userId: "member_123",
      },
      mailboxItemId: "mailbox_123",
    })).rejects.toThrow("Hosted runtime user is not active.");

    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
    expect(mocks.hostedThreadContainerParticipantFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("does not signal planner-checkpoint pointers for inactive members", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue(null);

    await expect(signalHostedMailboxAppendRuntime({
      client: buildClient(),
      expectedUserId: "member_123",
      knownCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
        userId: "member_123",
      },
      mailboxItemId: "mailbox_123",
    })).rejects.toThrow("Hosted runtime user is not active.");
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("rejects planner lane facts whose owner does not match the expected user", async () => {
    await expect(signalHostedMailboxAppendRuntime({
      client: buildClient(),
      expectedUserId: "member_123",
      knownCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
        userId: "member_other",
      },
      mailboxItemId: "mailbox_123",
    })).rejects.toThrow("Hosted mailbox item owner does not match runtime signal user.");
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("signals duplicate mailbox append attempts safely", async () => {
    const client = buildClient();

    await signalHostedMailboxAppendRuntime({
      client,
      mailboxItemId: "mailbox_123",
    });
    await signalHostedMailboxAppendRuntime({
      client,
      mailboxItemId: "mailbox_123",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledTimes(2);
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.hostedMemberFindUnique).toHaveBeenCalledTimes(2);
    expect(mocks.signalWithStart.mock.calls[1]?.[1]?.signalArgs[0]).toEqual(
      mocks.signalWithStart.mock.calls[0]?.[1]?.signalArgs[0],
    );
  });

  it("signals runtime rechecks only after active access without upserting workspace", async () => {
    const abortSignal = new AbortController().signal;
    await signalHostedRuntimeRecheckRuntime({
      abortSignal,
      client: buildClient(),
      userId: "member_123",
    });

    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "runtime_recheck_requested",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.withAbortSignal).toHaveBeenCalledWith(
      abortSignal,
      expect.any(Function),
    );
  });

  it("signals runtime wakes only after active access without upserting workspace", async () => {
    const abortSignal = new AbortController().signal;
    await signalHostedRuntimeWakeRuntime({
      abortSignal,
      client: buildClient(),
      userId: "member_123",
    });

    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "runtime_wake_requested",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.withAbortSignal).toHaveBeenCalledWith(
      abortSignal,
      expect.any(Function),
    );
  });

  it("does not signal runtime rechecks when a thread-container owner is inactive", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue(buildActiveMemberRecord({
      threadContainer: {
        owner: {
          accountGroupMemberships: [],
          billingStatus: "paused",
          suspendedAt: null,
        },
      },
    }));

    await expect(signalHostedRuntimeRecheckRuntime({
      client: buildClient(),
      userId: "member_123",
    })).rejects.toThrow("Hosted runtime user is not active.");

    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("signals retention rechecks for inactive workspaces without granting active runtime access", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue(null);

    await signalHostedRetentionRuntimeRecheck({
      client: buildClient(),
      userId: "member_inactive",
    });

    expect(mocks.hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "runtime_recheck_requested",
        }],
        workflowId: "hosted-user-runtime:member_inactive",
      }),
    );
  });

  it("signals device-sync mailbox wakes as normal mailbox work", async () => {
    mocks.readHostedMailboxItemCheckpointById.mockResolvedValueOnce({
      id: "mailbox_123",
      lane: "system",
      laneSeq: "42",
      occurredAt: "2026-03-26T12:00:00.000Z",
      userId: "member_123",
    });

    await signalHostedDeviceSyncMailboxRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "mailbox_appended",
          lane: "system",
          laneSeq: "42",
          mailboxItemId: "mailbox_123",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "member_123",
    });
    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
  });

  it("persists browser-vault refresh as durable control mailbox work before signaling", async () => {
    await signalHostedBrowserVaultRefreshRuntime({
      client: buildClient(),
      userId: "member_123",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: expect.stringMatching(/^runtime-control:browser-vault-refresh:[0-9a-f]{32}$/u),
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
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signalWithStart.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "member_123",
    });
    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
    expect(JSON.stringify(mocks.signalWithStart.mock.calls[0]?.[1]?.signalArgs[0])).not.toMatch(
      /prompt|headers|payload|message/u,
    );
  });

  it("keeps browser-vault refresh durable when Temporal signaling fails", async () => {
    mocks.signalWithStart.mockRejectedValueOnce(new Error("temporal unavailable"));

    await expect(signalHostedBrowserVaultRefreshRuntime({
      client: buildClient(),
      userId: "member_123",
    })).rejects.toThrow("temporal unavailable");

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: expect.stringMatching(/^runtime-control:browser-vault-refresh:[0-9a-f]{32}$/u),
        kind: "runtime.browser-vault-refresh-requested",
        userId: "member_123",
      }),
      tx: { kind: "tx" },
    });
    expect(mocks.signalWithStart).toHaveBeenCalledTimes(1);
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "mailbox_appended",
          lane: "system",
          laneSeq: "77",
          mailboxItemId: "mailbox_runtime.browser-vault-refresh-requested",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signalWithStart.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("persists runtime maintenance as durable control mailbox work before signaling", async () => {
    await signalHostedRuntimeMaintenanceRuntime({
      client: buildClient(),
      userId: "member_123",
    });

    expect(mocks.resolveHostedRuntimeAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: expect.stringMatching(/^runtime-control:maintenance:[0-9a-f]{32}$/u),
        kind: "runtime.maintenance-requested",
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
          mailboxItemId: "mailbox_runtime.maintenance-requested",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signalWithStart.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("dedupes runtime maintenance mailbox work for the same workspace version within a short window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T08:15:31.000Z"));
    try {
      await signalHostedRuntimeMaintenanceRuntime({
        client: buildClient(),
        userId: "member_123",
      });
      await signalHostedRuntimeMaintenanceRuntime({
        client: buildClient(),
        userId: "member_123",
      });

      const envelopes = mocks.appendHostedMailboxEnvelopeTx.mock.calls.map(
        ([input]) => input.envelope,
      );
      expect(envelopes).toHaveLength(2);
      expect(envelopes[0]?.eventId).toMatch(
        /^runtime-control:maintenance:[0-9a-f]{32}$/u,
      );
      expect(envelopes[1]?.eventId).toBe(envelopes[0]?.eventId);
      expect(envelopes.map((envelope) => envelope.occurredAt)).toEqual([
        "2026-05-28T08:15:00.000Z",
        "2026-05-28T08:15:00.000Z",
      ]);
      expect(mocks.signalWithStart.mock.calls.map((call) => call[1].signalArgs[0])).toEqual([
        {
          kind: "mailbox_appended",
          lane: "system",
          laneSeq: "77",
          mailboxItemId: "mailbox_runtime.maintenance-requested",
        },
        {
          kind: "mailbox_appended",
          lane: "system",
          laneSeq: "77",
          mailboxItemId: "mailbox_runtime.maintenance-requested",
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dedupes browser-vault control mailbox work for the same workspace version within a short window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T08:15:31.000Z"));
    try {
      await signalHostedBrowserVaultRefreshRuntime({
        client: buildClient(),
        userId: "member_123",
      });
      await signalHostedBrowserVaultRefreshRuntime({
        client: buildClient(),
        userId: "member_123",
      });

      const envelopes = mocks.appendHostedMailboxEnvelopeTx.mock.calls.map(
        ([input]) => input.envelope,
      );
      expect(envelopes).toHaveLength(2);
      expect(envelopes[0]?.eventId).toMatch(
        /^runtime-control:browser-vault-refresh:[0-9a-f]{32}$/u,
      );
      expect(envelopes[1]?.eventId).toBe(envelopes[0]?.eventId);
      expect(envelopes.map((envelope) => envelope.occurredAt)).toEqual([
        "2026-05-28T08:15:00.000Z",
        "2026-05-28T08:15:00.000Z",
      ]);
      expect(mocks.signalWithStart).toHaveBeenCalledTimes(2);
      expect(mocks.signalWithStart.mock.calls.map((call) => call[1].signalArgs[0])).toEqual([
        {
          kind: "mailbox_appended",
          lane: "system",
          laneSeq: "77",
          mailboxItemId: "mailbox_runtime.browser-vault-refresh-requested",
        },
        {
          kind: "mailbox_appended",
          lane: "system",
          laneSeq: "77",
          mailboxItemId: "mailbox_runtime.browser-vault-refresh-requested",
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates new browser-vault control mailbox work after the workspace version advances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T08:15:31.000Z"));
    mocks.ensureHostedWorkspace
      .mockResolvedValueOnce(buildHostedWorkspaceRecord({ version: "10" }))
      .mockResolvedValueOnce(buildHostedWorkspaceRecord({ version: "10" }))
      .mockResolvedValueOnce(buildHostedWorkspaceRecord({ version: "11" }))
      .mockResolvedValueOnce(buildHostedWorkspaceRecord({ version: "11" }));
    try {
      await signalHostedBrowserVaultRefreshRuntime({
        client: buildClient(),
        userId: "member_123",
      });
      await signalHostedBrowserVaultRefreshRuntime({
        client: buildClient(),
        userId: "member_123",
      });

      const envelopes = mocks.appendHostedMailboxEnvelopeTx.mock.calls.map(
        ([input]) => input.envelope,
      );
      expect(envelopes).toHaveLength(2);
      expect(envelopes[0]?.eventId).toMatch(
        /^runtime-control:browser-vault-refresh:[0-9a-f]{32}$/u,
      );
      expect(envelopes[1]?.eventId).toMatch(
        /^runtime-control:browser-vault-refresh:[0-9a-f]{32}$/u,
      );
      expect(envelopes[1]?.eventId).not.toBe(envelopes[0]?.eventId);
      expect(envelopes.map((envelope) => envelope.occurredAt)).toEqual([
        "2026-05-28T08:15:00.000Z",
        "2026-05-28T08:15:00.000Z",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists manual runs as durable control mailbox work before signaling", async () => {
    await signalHostedManualRunRuntime({
      client: buildClient(),
      userId: "member_123",
    });

    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "read_first",
      prisma: mocks.prisma,
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
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "member_123",
    });
    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
  });

  it("does not append or signal manual runs when monthly AI usage is exhausted", async () => {
    mocks.resolveHostedRuntimeAiUsageGate.mockResolvedValueOnce({
      status: "denied",
    });

    await expect(signalHostedManualRunRuntime({
      client: buildClient(),
      userId: "member_123",
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_MANUAL_WAKE_AI_USAGE_DENIED",
      httpStatus: 403,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("does not append or signal manual runs when access authority cannot be read", async () => {
    mocks.resolveHostedRuntimeAiUsageGate.mockRejectedValueOnce(
      new Error("hosted access read failed"),
    );

    await expect(signalHostedManualRunRuntime({
      client: buildClient(),
      userId: "member_123",
    })).rejects.toThrow("hosted access read failed");

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("uses explicit Prisma and Temporal dependencies for manual runtime signals", async () => {
    const explicitHostedMemberFindUnique = vi.fn().mockResolvedValue(buildActiveMemberRecord());
    const explicitPrisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        await callback({ kind: "explicit-tx" })
      ),
      hostedAccountGroupMembership: {
        count: vi.fn(async () => 0),
        findFirst: vi.fn(async () => null),
      },
      hostedMember: {
        findUnique: explicitHostedMemberFindUnique,
      },
      kind: "explicit-prisma",
    };
    mocks.getPrisma.mockReturnValue(explicitPrisma);
    const explicitPrismaInput = mocks.getPrisma();
    mocks.getPrisma.mockClear();

    await signalHostedManualRunRuntime({
      client: buildClient(),
      environment: {
        NODE_ENV: "test",
        HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS: "12000",
        HOSTED_TEMPORAL_TASK_QUEUE: "explicit-testkit-task-queue",
      },
      prisma: explicitPrismaInput,
      userId: "member_123",
    });

    expect(mocks.resolveHostedRuntimeAiUsageGate).toHaveBeenCalledWith({
      mode: "read_first",
      prisma: explicitPrisma,
      userId: "member_123",
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expectHostedRuntimeActiveAccessRead(explicitHostedMemberFindUnique, "member_123");
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: explicitPrisma,
      userId: "member_123",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "runtime.manual-requested",
        userId: "member_123",
      }),
      tx: { kind: "explicit-tx" },
    });
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        args: [{
          options: {
            ensureRuntimeProcessingStartToCloseTimeoutMs: 17_000,
          },
          userId: "member_123",
        }],
        taskQueue: "explicit-testkit-task-queue",
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
  });

  it("forwards explicit Prisma through the runtime access resolver", async () => {
    const {
      resolveHostedRuntimeAiUsageGate,
    } = await vi.importActual<{
      resolveHostedRuntimeAiUsageGate: (input: {
        mode: "mutating" | "read_first" | "read_only";
        now: string;
        prisma: typeof mocks.prisma;
        userId: string;
      }) => Promise<{ status: "allowed" } | { status: "denied" }>;
    }>("@/src/lib/hosted-orchestration/runtime-usage-decision");
    const explicitPrisma = mocks.prisma;
    const runUsageTransaction = async (callback: (tx: unknown) => unknown) =>
      await callback({
        ...explicitPrisma,
        $queryRaw: vi.fn(async () => []),
        hostedAiUsagePeriod: {
          findUnique: vi.fn(async () => null),
        },
      });
    mocks.prisma.$transaction.mockImplementationOnce(runUsageTransaction);

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "read_only",
      now: "2026-05-20T12:00:00.000Z",
      prisma: explicitPrisma,
      userId: "member_123",
    })).resolves.toMatchObject({ status: "denied" });

    expect(mocks.hostedMemberFindUnique).toHaveBeenCalledWith({
      select: expect.any(Object),
      where: { id: "member_123" },
    });
  });

  it("ensures workspace before device-sync mailbox pointer signals", async () => {
    mocks.readHostedMailboxItemCheckpointById.mockResolvedValueOnce({
      id: "mailbox_123",
      lane: "system",
      laneSeq: "42",
      occurredAt: "2026-03-26T12:00:00.000Z",
      userId: "member_123",
    });

    await signalHostedDeviceSyncMailboxRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
    });

    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          kind: "mailbox_appended",
          lane: "system",
          laneSeq: "42",
          mailboxItemId: "mailbox_123",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.ensureHostedWorkspace).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "member_123",
    });
    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
  });

  it("does not upsert workspace or start workflow for missing users on explicit signals", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue(null);

    await expect(signalHostedManualRunRuntime({
      client: buildClient(),
      userId: "member_deleted",
    })).rejects.toThrow("Hosted runtime user is not active.");

    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_deleted");
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("does not upsert workspace or start workflow for inactive users on explicit signals", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue(buildActiveMemberRecord({
      billingStatus: "canceled",
    }));

    await expect(signalHostedBrowserVaultRefreshRuntime({
      client: buildClient(),
      userId: "member_inactive",
    })).rejects.toThrow("Hosted runtime user is not active.");

    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_inactive");
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("does not upsert workspace or start workflow for suspended users on explicit signals", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue(buildActiveMemberRecord({
      suspendedAt: new Date("2026-05-21T00:00:00.000Z"),
    }));

    await expect(signalHostedManualRunRuntime({
      client: buildClient(),
      userId: "member_suspended",
    })).rejects.toThrow("Hosted runtime user is not active.");

    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_suspended");
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("does not upsert workspace or start workflow for missing users on mailbox signals", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue(null);

    await expect(signalHostedMailboxAppendRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
    })).rejects.toThrow("Hosted runtime user is not active.");

    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("does not upsert workspace or start workflow for mailbox signals when a thread-container owner is inactive", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue(buildActiveMemberRecord({
      threadContainer: {
        owner: {
          accountGroupMemberships: [],
          billingStatus: "paused",
          suspendedAt: null,
        },
      },
    }));

    await expect(signalHostedMailboxAppendRuntime({
      client: buildClient(),
      mailboxItemId: "mailbox_123",
    })).rejects.toThrow("Hosted runtime user is not active.");

    expectHostedRuntimeActiveAccessRead(mocks.hostedMemberFindUnique, "member_123");
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });
});

function buildClient() {
  return {
    async withAbortSignal<R>(
      signal: AbortSignal,
      operation: () => Promise<R>,
    ): Promise<R> {
      mocks.withAbortSignal(signal, operation);
      return await operation();
    },
    workflow: {
      signalWithStart: mocks.signalWithStart,
    },
  };
}

const hostedSponsorAccessMembershipSelect = {
  select: {
    group: {
      select: {
        billingStatus: true,
        suspendedAt: true,
      },
    },
    status: true,
  },
  where: {
    status: "active",
  },
};

function expectHostedRuntimeActiveAccessRead(
  findUnique: typeof mocks.hostedMemberFindUnique,
  userId: string,
) {
  expect(findUnique).toHaveBeenCalledWith({
    select: {
      accountGroupMemberships: hostedSponsorAccessMembershipSelect,
      billingStatus: true,
      suspendedAt: true,
      threadContainer: {
        select: {
          owner: {
            select: {
              accountGroupMemberships: hostedSponsorAccessMembershipSelect,
              billingStatus: true,
              suspendedAt: true,
            },
          },
        },
      },
    },
    where: {
      id: userId,
    },
  });
}

type HostedAccessSponsorMembership = {
  status: string;
  group: {
    billingStatus: string;
    suspendedAt: Date | null;
  };
};

function buildActiveMemberRecord(overrides: Partial<{
  accountGroupMemberships: HostedAccessSponsorMembership[];
  billingStatus: string;
  suspendedAt: Date | null;
  threadContainer: {
    owner: {
      accountGroupMemberships: HostedAccessSponsorMembership[];
      billingStatus: string;
      suspendedAt: Date | null;
    };
  } | null;
}> = {}) {
  return {
    accountGroupMemberships: [],
    billingStatus: "active",
    suspendedAt: null,
    threadContainer: null,
    ...overrides,
  };
}

function buildHostedWorkspaceRecord(overrides: Partial<{
  redactedStatusJson: unknown;
  version: string;
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
