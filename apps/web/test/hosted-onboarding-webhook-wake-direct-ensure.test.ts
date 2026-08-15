import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  ensureRuntimeProcessing: vi.fn(),
  prewarmRuntimeShell: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  recordHostedIngressAcceptedFromMailboxItem: vi.fn(async () => undefined),
  recordHostedIngressDirectEnsureTiming: vi.fn(async () => undefined),
  recordHostedIngressTemporalSignalAccepted: vi.fn(async () => undefined),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
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
import {
  startHostedRuntimeShellPrewarmBestEffort,
} from "@/src/lib/hosted-execution/direct-runtime-wake";

const response = {
  ignored: false,
  ok: true,
  reason: "wake-appended-active-member",
} as never;

type DirectEnsureInput = {
  commandTimeoutMs: number;
  onTiming: (timing:
    & {
      directEnsureRequestStartedAtEpochMs: number;
      directEnsureResponseReceivedAtEpochMs: number;
      orchestrationAttemptId: string;
      tokenAcquiredAtEpochMs: number;
      tokenAcquireStartedAtEpochMs: number;
    }
    & (
      | { directEnsureResultKind: "legacy_accepted" | "retry_later" }
      | {
          directEnsureAction: "woken";
          directEnsureResultKind: "runtime_processing_accepted";
          directEnsureRuntimeAttemptId: string;
        }
    )) => void;
  orchestrationAttemptId: string;
  signal: AbortSignal;
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
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
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
      prewarmRuntimeShell: mocks.prewarmRuntimeShell,
    });
  });

  it("starts the direct ensure only after Temporal accepts the durable signal", async () => {
    const afterResponseTasks: Array<() => Promise<void>> = [];
    const wakeOrder: string[] = [];
    let resolveTemporalSignal!: (value: {
      signalAccepted: true;
      workflowId: string;
    }) => void;
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(() => {
      wakeOrder.push("temporal");
      return new Promise((resolve) => {
        resolveTemporalSignal = resolve;
      });
    });
    mocks.ensureRuntimeProcessing.mockImplementationOnce(async (input: DirectEnsureInput) => {
      wakeOrder.push("direct");
      input.onTiming({
        directEnsureAction: "woken",
        tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
        tokenAcquiredAtEpochMs: 1_777_000_000_010,
        directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
        directEnsureResponseReceivedAtEpochMs: 1_777_000_000_120,
        directEnsureResultKind: "runtime_processing_accepted",
        directEnsureRuntimeAttemptId: "runtime-attempt-test",
        orchestrationAttemptId: input.orchestrationAttemptId,
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
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    });
    expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
    expect(afterResponseTasks).toHaveLength(0);
    expect(handoffSettled).toBe(false);

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

    expect(handoffSettled).toBe(true);
    expect(wakeOrder).toEqual(["temporal", "direct"]);
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledWith({
      commandTimeoutMs: 25_000,
      onTiming: expect.any(Function),
      orchestrationAttemptId: expect.stringMatching(/^web-ingress-[0-9a-f-]{36}$/u),
      signal: expect.any(AbortSignal),
      userId: "member_123",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      knownCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
        userId: "member_123",
      },
      mailboxItemId: "mailbox_123",
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
          directEnsureOrchestrationAttemptId: expect.stringMatching(
            /^web-ingress-[0-9a-f-]{36}$/u,
          ),
          directEnsureResultKind: "runtime_processing_accepted",
          directEnsureAction: "woken",
          directEnsureRuntimeAttemptId: "runtime-attempt-test",
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
        directEnsureResultKind: "legacy_accepted",
        orchestrationAttemptId: input.orchestrationAttemptId,
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
        attemptNumber: 1,
        orchestrationAttemptId: expect.stringMatching(
          /^web-ingress-[0-9a-f-]{36}$/u,
        ),
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
          directEnsureOrchestrationAttemptId: expect.stringMatching(
            /^web-ingress-[0-9a-f-]{36}$/u,
          ),
          directEnsureResultKind: "legacy_accepted",
        },
      },
      source: "linq",
    });
    consoleInfo.mockRestore();
  });

  it("uses one bounded retry after retry_later without another Temporal signal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T00:00:00.000Z"));
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const afterResponseTasks: Array<() => Promise<void>> = [];
    mocks.ensureRuntimeProcessing
      .mockImplementationOnce(async (input: DirectEnsureInput) => {
        input.onTiming({
          directEnsureRequestStartedAtEpochMs: 1_777_000_000_012,
          directEnsureResponseReceivedAtEpochMs: 1_777_000_000_020,
          directEnsureResultKind: "retry_later",
          orchestrationAttemptId: input.orchestrationAttemptId,
          tokenAcquiredAtEpochMs: 1_777_000_000_010,
          tokenAcquireStartedAtEpochMs: 1_777_000_000_000,
        });
        return {
        kind: "retry_later",
        retryAt: "2026-07-02T00:00:03.000Z",
        };
      })
      .mockImplementationOnce(async (input: DirectEnsureInput) => {
        input.onTiming({
          directEnsureAction: "woken",
          directEnsureRequestStartedAtEpochMs: 1_777_000_003_012,
          directEnsureResponseReceivedAtEpochMs: 1_777_000_003_120,
          directEnsureResultKind: "runtime_processing_accepted",
          directEnsureRuntimeAttemptId: "runtime-attempt-final",
          orchestrationAttemptId: input.orchestrationAttemptId,
          tokenAcquiredAtEpochMs: 1_777_000_003_010,
          tokenAcquireStartedAtEpochMs: 1_777_000_003_000,
        });
        return {
          action: "woken",
          kind: "runtime_processing_accepted",
          recommendedRecheckAt: "2026-07-02T00:03:00.000Z",
          runtimeAttemptId: "runtime-attempt-final",
        };
      });

    try {
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
      await vi.waitFor(() => {
        expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
      });
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.waitFor(() => {
        expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(2);
      });
      await Promise.all(afterResponseTasks.map((task) => task()));

      const firstInput = mocks.ensureRuntimeProcessing.mock.calls[0]?.[0] as
        DirectEnsureInput;
      const secondInput = mocks.ensureRuntimeProcessing.mock.calls[1]?.[0] as
        DirectEnsureInput;
      expect(firstInput).toMatchObject({ commandTimeoutMs: 25_000 });
      expect(secondInput).toMatchObject({ commandTimeoutMs: 25_000 });
      expect(secondInput.orchestrationAttemptId).toBe(
        firstInput.orchestrationAttemptId,
      );
      expect(secondInput.signal).toBe(firstInput.signal);
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
      expect(mocks.recordHostedIngressDirectEnsureTiming).toHaveBeenCalledWith({
        expectedUserId: "member_123",
        mailboxItemId: "mailbox_123",
        phaseBreakdown: {
          schemaVersion: 1,
          orchestration: expect.objectContaining({
            directEnsureAction: "woken",
            directEnsureRequestStartedAtEpochMs: 1_777_000_003_012,
            directEnsureResponseReceivedAtEpochMs: 1_777_000_003_120,
            directEnsureResultKind: "runtime_processing_accepted",
            directEnsureRuntimeAttemptId: "runtime-attempt-final",
          }),
        },
        source: "linq",
      });
    } finally {
      consoleInfo.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not retry when retry_later falls outside the direct wake deadline", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.ensureRuntimeProcessing.mockResolvedValueOnce({
      kind: "retry_later",
      retryAt: new Date(Date.now() + 30_000).toISOString(),
    });

    try {
      await expect(maybeHandoffHostedExecutionWebhookWake({
        response,
        wakeHandoff: buildWakeHandoff(),
      })).resolves.toMatchObject({ signalAccepted: true });
      await vi.waitFor(() => {
        expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
        expect(consoleInfo).toHaveBeenCalledWith(
          "Hosted direct ensure wake retry skipped.",
          expect.objectContaining({ reason: "retry_outside_deadline" }),
        );
      });
    } finally {
      consoleInfo.mockRestore();
    }
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

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
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

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
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
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("bounds an unresolved direct ensure with the shared sub-thirty-second deadline", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      deadline.signal,
    );
    const afterResponseTasks: Array<() => Promise<void>> = [];
    mocks.ensureRuntimeProcessing.mockImplementationOnce(
      (input: DirectEnsureInput) => new Promise((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(input.signal.reason), {
          once: true,
        });
      }),
    );

    try {
      await expect(maybeHandoffHostedExecutionWebhookWake({
        response,
        scheduleAfterResponse: (task) => {
          afterResponseTasks.push(task);
        },
        wakeHandoff: buildWakeHandoff(),
      })).resolves.toMatchObject({ signalAccepted: true });
      expect(timeout).toHaveBeenCalledWith(29_000);
      expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);

      deadline.abort(new DOMException("Timed out", "TimeoutError"));
      await Promise.all(afterResponseTasks.map((task) => task()));
      expect(consoleWarn).toHaveBeenCalledWith(
        "Hosted direct ensure wake failed.",
        expect.objectContaining({ source: "linq" }),
      );
    } finally {
      timeout.mockRestore();
      consoleWarn.mockRestore();
    }
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

  it("does not start the direct ensure when the Temporal signal fails", async () => {
    mocks.ensureRuntimeProcessing.mockReturnValue(new Promise(() => undefined));
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValue(new Error("temporal down"));

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff(),
    })).rejects.toThrow("temporal down");

    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("starts no direct wake when participant-aware signaling denies access", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValue(
      new Error("Hosted runtime user is not active."),
    );

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff(),
    })).rejects.toThrow("Hosted runtime user is not active.");

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
  });

  it("keeps the accepted Temporal handoff when control client setup throws synchronously", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.readHostedExecutionControlClientIfConfigured.mockImplementation(() => {
      throw new TypeError("Hosted execution baseUrl must be configured.");
    });

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toMatchObject({ signalAccepted: true });

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
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
      mocks.signalHostedMailboxAppendRuntime.mockReturnValueOnce(new Promise(() => {}));

      const handoff = maybeHandoffHostedExecutionWebhookWake({
        response,
        wakeHandoff: buildWakeHandoff(),
      });
      const rejected = expect(handoff).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(5_000);

      await rejected;
      expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start a direct wake when Temporal resolves after the shared timeout", async () => {
    vi.useFakeTimers();
    try {
      let resolveTemporalSignal!: (value: {
        signalAccepted: true;
        workflowId: string;
      }) => void;
      mocks.signalHostedMailboxAppendRuntime.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveTemporalSignal = resolve;
        }),
      );

      const handoff = maybeHandoffHostedExecutionWebhookWake({
        response,
        wakeHandoff: buildWakeHandoff(),
      });
      const rejected = expect(handoff).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(5_000);

      await rejected;
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
      expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
      expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();

      resolveTemporalSignal({
        signalAccepted: true,
        workflowId: "hosted-user-runtime:member_123",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
      expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

});

describe("startHostedRuntimeShellPrewarmBestEffort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prewarmRuntimeShell.mockResolvedValue({ accepted: true });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      ensureRuntimeProcessing: mocks.ensureRuntimeProcessing,
      prewarmRuntimeShell: mocks.prewarmRuntimeShell,
    });
  });

  it("issues only the shell-prewarm command for the instant-start member", async () => {
    await expect(startHostedRuntimeShellPrewarmBestEffort({
      source: "linq-instant-start",
      userId: "member_123",
    })).resolves.toBeUndefined();

    expect(mocks.prewarmRuntimeShell).toHaveBeenCalledOnce();
    expect(mocks.prewarmRuntimeShell).toHaveBeenCalledWith({
      source: "linq-instant-start",
      userId: "member_123",
    });
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
  });

  it("issues only the shell-prewarm command for a typing-start hint", async () => {
    await expect(startHostedRuntimeShellPrewarmBestEffort({
      source: "linq-typing-started",
      userId: "member_123",
    })).resolves.toBeUndefined();

    expect(mocks.prewarmRuntimeShell).toHaveBeenCalledOnce();
    expect(mocks.prewarmRuntimeShell).toHaveBeenCalledWith({
      source: "linq-typing-started",
      userId: "member_123",
    });
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
  });

  it("settles when client setup or the best-effort request fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.readHostedExecutionControlClientIfConfigured.mockImplementationOnce(() => {
      throw new TypeError("Hosted execution baseUrl must be configured.");
    });

    await expect(startHostedRuntimeShellPrewarmBestEffort({
      source: "linq-instant-start",
      userId: "member_123",
    })).resolves.toBeUndefined();

    mocks.prewarmRuntimeShell.mockRejectedValueOnce(
      new Error("cloudflare unavailable"),
    );
    await expect(startHostedRuntimeShellPrewarmBestEffort({
      source: "linq-instant-start",
      userId: "member_123",
    })).resolves.toBeUndefined();

    expect(consoleWarn).toHaveBeenCalledTimes(2);
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});
