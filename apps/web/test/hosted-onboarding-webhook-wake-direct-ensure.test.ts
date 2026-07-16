import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  ensureRuntimeProcessing: vi.fn(),
  prepareHostedMailboxAppendRuntimeSignal: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  recordHostedIngressAcceptedFromMailboxItem: vi.fn(async () => undefined),
  recordHostedIngressDirectEnsureTiming: vi.fn(async () => undefined),
  recordHostedIngressTemporalSignalAccepted: vi.fn(async () => undefined),
  signalHostedMailboxAppendRuntime: vi.fn(),
  signalHostedUserRuntimeWorkflow: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  prepareHostedMailboxAppendRuntimeSignal:
    mocks.prepareHostedMailboxAppendRuntimeSignal,
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
  signalHostedUserRuntimeWorkflow: mocks.signalHostedUserRuntimeWorkflow,
}));

vi.mock("@/src/lib/hosted-runtime-latency/store", () => ({
  recordHostedIngressAcceptedFromMailboxItem:
    mocks.recordHostedIngressAcceptedFromMailboxItem,
  recordHostedIngressDirectEnsureTiming:
    mocks.recordHostedIngressDirectEnsureTiming,
  recordHostedIngressTemporalSignalAccepted:
    mocks.recordHostedIngressTemporalSignalAccepted,
}));

import {
  maybeHandoffHostedExecutionWebhookWake,
} from "@/src/lib/hosted-onboarding/webhook-service-wake";

const response = {
  ignored: false,
  ok: true,
  reason: "wake-appended-active-member",
} as never;

const preparedMailboxSignal = {
  signal: {
    kind: "mailbox_appended",
    lane: "conversation",
    laneSeq: "42",
    mailboxItemId: "mailbox_123",
  },
  userId: "member_123",
};

type DirectEnsureInput = {
  onTiming: (timing: {
    directEnsureRequestStartedAtEpochMs: number;
    directEnsureResponseReceivedAtEpochMs: number;
    tokenAcquiredAtEpochMs: number;
    tokenAcquireStartedAtEpochMs: number;
  }) => void;
};

function buildWakeHandoff(
  overrides: Partial<NonNullable<Parameters<typeof maybeHandoffHostedExecutionWebhookWake>[0]["wakeHandoff"]>> = {},
) {
  return {
    eventId: "evt_123",
    mailboxItemId: "mailbox_123",
    source: "linq" as const,
    userId: "member_123",
    wakeMailboxCheckpoint: {
      lane: "conversation" as const,
      laneSeq: "42",
    },
    ...overrides,
  };
}

describe("maybeHandoffHostedExecutionWebhookWake direct ensure fast path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareHostedMailboxAppendRuntimeSignal.mockResolvedValue(
      preparedMailboxSignal,
    );
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    mocks.signalHostedUserRuntimeWorkflow.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    mocks.ensureRuntimeProcessing.mockResolvedValue({
      action: "woken",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-07-02T00:03:00.000Z",
      runtimeAttemptId: "runtime-attempt-test",
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      ensureRuntimeProcessing: mocks.ensureRuntimeProcessing,
    });
  });

  it("starts neither wake while preparation is pending, then overlaps direct and Temporal wakes", async () => {
    const afterResponseTasks: Array<() => Promise<void>> = [];
    const wakeOrder: string[] = [];
    let resolvePreparation!: (value: typeof preparedMailboxSignal) => void;
    let resolveTemporalSignal!: (value: {
      signalAccepted: true;
      workflowId: string;
    }) => void;
    mocks.prepareHostedMailboxAppendRuntimeSignal.mockImplementationOnce(() =>
      new Promise((resolve) => {
        resolvePreparation = resolve;
      })
    );
    mocks.signalHostedUserRuntimeWorkflow.mockImplementationOnce(() => {
      wakeOrder.push("temporal");
      return new Promise((resolve) => {
        resolveTemporalSignal = resolve;
      });
    });
    mocks.ensureRuntimeProcessing.mockImplementationOnce(async (input: DirectEnsureInput) => {
      wakeOrder.push("direct");
      input.onTiming({
        tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
        tokenAcquiredAtEpochMs: 1_777_000_000_010,
        directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
        directEnsureResponseReceivedAtEpochMs: 1_777_000_000_120,
      });
      return {
        action: "woken",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-07-02T00:03:00.000Z",
        runtimeAttemptId: "runtime-attempt-test",
      };
    });

    let handoffSettled = false;
    const handoff = maybeHandoffHostedExecutionWebhookWake({
      response,
      scheduleAfterResponse: (task) => {
        afterResponseTasks.push(task);
      },
      wakeHandoff: buildWakeHandoff(),
    });
    void handoff.then(
      () => {
        handoffSettled = true;
      },
      () => {
        handoffSettled = true;
      },
    );

    await vi.waitFor(() => {
      expect(mocks.prepareHostedMailboxAppendRuntimeSignal).toHaveBeenCalledTimes(1);
    });
    expect(mocks.signalHostedUserRuntimeWorkflow).not.toHaveBeenCalled();
    expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
    expect(afterResponseTasks).toHaveLength(0);
    expect(handoffSettled).toBe(false);

    resolvePreparation(preparedMailboxSignal);
    await vi.waitFor(() => {
      expect(mocks.signalHostedUserRuntimeWorkflow).toHaveBeenCalledTimes(1);
      expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
      expect(afterResponseTasks).toHaveLength(1);
    });
    expect(handoffSettled).toBe(false);
    expect(wakeOrder).toEqual(["temporal", "direct"]);

    resolveTemporalSignal({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    await expect(handoff).resolves.toEqual({
      reason: "temporal-signaled",
      signalAccepted: true,
      started: true,
      workflowId: "hosted-user-runtime:member_123",
    });

    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledWith({
      onTiming: expect.any(Function),
      orchestrationAttemptId: expect.stringMatching(/^web-ingress-[0-9a-f-]{36}$/u),
      userId: "member_123",
    });
    expect(mocks.prepareHostedMailboxAppendRuntimeSignal).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      knownCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
        userId: "member_123",
      },
      mailboxItemId: "mailbox_123",
    });
    expect(mocks.signalHostedUserRuntimeWorkflow).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      ensureWorkspace: false,
      signal: preparedMailboxSignal.signal,
      userId: "member_123",
    });
    await Promise.all(afterResponseTasks.map((task) => task()));
    expect(mocks.recordHostedIngressDirectEnsureTiming).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_123",
      phaseBreakdown: {
        schemaVersion: 1,
        orchestration: {
          tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
          tokenAcquiredAtEpochMs: 1_777_000_000_010,
          directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
          directEnsureResponseReceivedAtEpochMs: 1_777_000_000_120,
        },
      },
      source: "linq",
    });
  });

  it("accepts an early direct ensure ack and still records timing", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const afterResponseTasks: Array<() => Promise<void>> = [];
    mocks.ensureRuntimeProcessing.mockImplementationOnce(async (input: DirectEnsureInput) => {
      input.onTiming({
        tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
        tokenAcquiredAtEpochMs: 1_777_000_000_010,
        directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
        directEnsureResponseReceivedAtEpochMs: 1_777_000_000_025,
      });
      return {
        accepted: true,
      };
    });

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      scheduleAfterResponse: (task) => {
        afterResponseTasks.push(task);
      },
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
    });

    await Promise.all(afterResponseTasks.map((task) => task()));
    expect(consoleInfo).toHaveBeenCalledWith(
      "Hosted direct ensure wake accepted.",
      {
        accepted: true,
        source: "linq",
      },
    );
    expect(mocks.recordHostedIngressDirectEnsureTiming).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_123",
      phaseBreakdown: {
        schemaVersion: 1,
        orchestration: {
          tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
          tokenAcquiredAtEpochMs: 1_777_000_000_010,
          directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
          directEnsureResponseReceivedAtEpochMs: 1_777_000_000_025,
        },
      },
      source: "linq",
    });
    consoleInfo.mockRestore();
  });

  it("keeps the Temporal signal and handoff result intact when the direct ensure fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.ensureRuntimeProcessing.mockRejectedValue(new Error("cloudflare unreachable"));

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
    });

    expect(mocks.prepareHostedMailboxAppendRuntimeSignal).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedUserRuntimeWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith(
        "Hosted direct ensure wake failed.",
        expect.objectContaining({ source: "linq" }),
      );
    });
    consoleWarn.mockRestore();
  });

  it("keeps the Temporal signal authoritative when the direct ensure throws synchronously", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.ensureRuntimeProcessing.mockImplementationOnce(() => {
      throw new Error("control client failed before returning a promise");
    });

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
    });

    expect(mocks.prepareHostedMailboxAppendRuntimeSignal).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedUserRuntimeWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted direct ensure wake failed.",
      expect.objectContaining({ source: "linq" }),
    );
    consoleWarn.mockRestore();
  });

  it("never puts the direct ensure on the webhook response path, even with no scheduler", async () => {
    // A control endpoint that never responds must not delay the handoff.
    mocks.ensureRuntimeProcessing.mockReturnValue(new Promise(() => undefined));

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
    });

    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedUserRuntimeWorkflow).toHaveBeenCalledTimes(1);
  });

  it("skips the direct ensure for non-Linq sources even with checkpoint facts", async () => {
    mocks.ensureRuntimeProcessing.mockReturnValue(new Promise(() => undefined));

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff({ source: "telegram" }),
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
    });

    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("starts the direct ensure but still rejects when the Temporal signal throws", async () => {
    mocks.ensureRuntimeProcessing.mockReturnValue(new Promise(() => undefined));
    mocks.signalHostedUserRuntimeWorkflow.mockRejectedValue(new Error("temporal down"));

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff(),
    })).rejects.toThrow("temporal down");

    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
    expect(mocks.prepareHostedMailboxAppendRuntimeSignal).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedUserRuntimeWorkflow).toHaveBeenCalledTimes(1);
  });

  it("starts neither wake when participant-aware preparation denies access", async () => {
    mocks.prepareHostedMailboxAppendRuntimeSignal.mockRejectedValue(
      new Error("Hosted runtime user is not active."),
    );

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff(),
    })).rejects.toThrow("Hosted runtime user is not active.");

    expect(mocks.prepareHostedMailboxAppendRuntimeSignal).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedUserRuntimeWorkflow).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
  });

  it("proceeds to the Temporal signal when the control client setup throws synchronously", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.readHostedExecutionControlClientIfConfigured.mockImplementation(() => {
      throw new TypeError("Hosted execution baseUrl must be configured.");
    });

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toMatchObject({ signalAccepted: true });

    expect(mocks.signalHostedUserRuntimeWorkflow).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted direct ensure wake client is misconfigured.",
      expect.objectContaining({ source: "linq" }),
    );
    consoleWarn.mockRestore();
  });

  it("skips the direct ensure and lane facts when the planner checkpoint is absent", async () => {
    await maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: {
        eventId: "evt_123",
        mailboxItemId: "mailbox_123",
        source: "linq",
        userId: "member_123",
      },
    });

    expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_123",
    });
  });

  it("falls back to the legacy signal path when checkpoint lane facts are malformed", async () => {
    await maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff({
        wakeMailboxCheckpoint: {
          lane: "conversation",
          laneSeq: "",
        },
      }),
    });

    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_123",
    });
  });

  it("stays a no-op when the Cloudflare control client is not configured", async () => {
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toMatchObject({ signalAccepted: true });

    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
  });

  it("bounds an omitted-timeout Temporal handoff that never settles", async () => {
    vi.useFakeTimers();
    try {
      mocks.signalHostedUserRuntimeWorkflow.mockReturnValueOnce(new Promise(() => {}));

      const handoff = maybeHandoffHostedExecutionWebhookWake({
        response,
        wakeHandoff: buildWakeHandoff(),
      });
      const rejected = expect(handoff).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(5_000);

      await rejected;
      expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts neither wake when preparation resolves after the shared timeout", async () => {
    vi.useFakeTimers();
    try {
      let resolvePreparation!: (value: typeof preparedMailboxSignal) => void;
      mocks.prepareHostedMailboxAppendRuntimeSignal.mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePreparation = resolve;
        }),
      );

      const handoff = maybeHandoffHostedExecutionWebhookWake({
        response,
        wakeHandoff: buildWakeHandoff(),
      });
      const rejected = expect(handoff).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(5_000);

      await rejected;
      expect(mocks.prepareHostedMailboxAppendRuntimeSignal).toHaveBeenCalledTimes(1);
      expect(mocks.signalHostedUserRuntimeWorkflow).not.toHaveBeenCalled();
      expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
      expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();

      resolvePreparation(preparedMailboxSignal);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.signalHostedUserRuntimeWorkflow).not.toHaveBeenCalled();
      expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
      expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

});
