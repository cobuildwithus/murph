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
  readHostedAiUsageGate: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
  resolveHostedRuntimeAiUsageDemandGate: vi.fn(),
  signalWithStart: vi.fn(),
}));

const defaultWorkflowOptions = {
  ensureRuntimeProcessingStartToCloseTimeoutMs: 15_000,
  prewarmTaskQueue: "murph-hosted-runtime-prewarm",
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

vi.mock("@/src/lib/hosted-orchestration/runtime-usage-decision", () => ({
  resolveHostedRuntimeAiUsageDemandGate: mocks.resolveHostedRuntimeAiUsageDemandGate,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

import {
  sanitizeHostedRuntimeSignalSource,
  signalHostedBrowserVaultRefreshRuntime,
  signalHostedDeviceSyncMailboxRuntime,
  signalHostedMailboxAppendRuntime,
  signalHostedManualRunRuntime,
  signalHostedRuntimePrewarm,
} from "@/src/lib/hosted-orchestration/signal-runtime";

describe("hosted runtime Temporal signaling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.ensureHostedWorkspace.mockResolvedValue(buildHostedWorkspaceRecord());
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveMemberRecord());
    mocks.resolveHostedRuntimeAiUsageDemandGate.mockResolvedValue({
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

  it("signals device-sync mailbox wakes as normal mailbox demand", async () => {
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

  it("signals typing prewarm without workspace or mailbox demand", async () => {
    await signalHostedRuntimePrewarm({
      client: buildClient(),
      eventId: "linq_event_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      userId: "member_123",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      expect.objectContaining({
        signalArgs: [{
          eventId: expect.stringMatching(/^runtime-prewarm:[0-9a-f]{32}$/u),
          kind: "runtime_prewarm_requested",
          occurredAt: "2026-03-26T12:00:00.000Z",
          source: "linq.imessage.typing",
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
          source: "browser-vault-refresh",
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
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
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
          source: "browser-vault-refresh",
        }],
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signalWithStart.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("dedupes browser-vault control demands for the same workspace version within a short window", async () => {
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
          source: "browser-vault-refresh",
        },
        {
          kind: "mailbox_appended",
          lane: "system",
          laneSeq: "77",
          mailboxItemId: "mailbox_runtime.browser-vault-refresh-requested",
          source: "browser-vault-refresh",
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a new browser-vault control demand after the workspace version advances", async () => {
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

  it("persists manual runs as durable control demand before signaling", async () => {
    await signalHostedManualRunRuntime({
      client: buildClient(),
      userId: "member_123",
    });

    expect(mocks.resolveHostedRuntimeAiUsageDemandGate).toHaveBeenCalledWith({
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
          source: "manual-ai-gated",
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

  it("does not append or signal manual runs when AI usage is denied", async () => {
    mocks.resolveHostedRuntimeAiUsageDemandGate.mockResolvedValueOnce({
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
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("does not append or signal manual runs when the AI usage gate is unavailable", async () => {
    mocks.resolveHostedRuntimeAiUsageDemandGate.mockResolvedValueOnce({
      retryAt: "2026-05-20T12:00:30.000Z",
      status: "unavailable",
    });

    await expect(signalHostedManualRunRuntime({
      client: buildClient(),
      userId: "member_123",
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_MANUAL_WAKE_AI_USAGE_GATE_UNAVAILABLE",
      details: {
        retryAt: "2026-05-20T12:00:30.000Z",
      },
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.ensureHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
    expect(mocks.signalWithStart).not.toHaveBeenCalled();
  });

  it("uses explicit Prisma and Temporal dependencies for manual runtime signals", async () => {
    const explicitPrisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        await callback({ kind: "explicit-tx" })
      ),
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

    expect(mocks.resolveHostedRuntimeAiUsageDemandGate).toHaveBeenCalledWith({
      prisma: explicitPrisma,
      userId: "member_123",
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: explicitPrisma,
    });
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
            prewarmTaskQueue: "explicit-testkit-task-queue-prewarm",
            readRuntimeDemandStartToCloseTimeoutMs: 10_000,
          },
          userId: "member_123",
        }],
        taskQueue: "explicit-testkit-task-queue",
        workflowId: "hosted-user-runtime:member_123",
      }),
    );
  });

  it("forwards explicit Prisma through the runtime usage gate resolver", async () => {
    const {
      resolveHostedRuntimeAiUsageDemandGate,
    } = await vi.importActual<{
      resolveHostedRuntimeAiUsageDemandGate: (input: {
        now: string;
        prisma: typeof mocks.prisma;
        userId: string;
      }) => Promise<{ status: "allowed" } | { status: "denied" } | {
        retryAt: string;
        status: "unavailable";
      }>;
    }>("@/src/lib/hosted-orchestration/runtime-usage-decision");
    const explicitPrisma = mocks.prisma;
    mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({ allowed: true });

    await expect(resolveHostedRuntimeAiUsageDemandGate({
      now: "2026-05-20T12:00:00.000Z",
      prisma: explicitPrisma,
      userId: "member_123",
    })).resolves.toEqual({
      status: "allowed",
    });

    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: "member_123",
      now: new Date("2026-05-20T12:00:00.000Z"),
      prisma: explicitPrisma,
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
