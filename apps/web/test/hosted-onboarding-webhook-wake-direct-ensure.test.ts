import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  ensureRuntimeProcessing: vi.fn(),
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

const response = {
  ignored: false,
  ok: true,
  reason: "wake-appended-active-member",
} as never;

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
    });
  });

  it("fires the direct Cloudflare ensure after the unconditional Temporal signal", async () => {
    const afterResponseTasks: Array<() => Promise<void>> = [];
    const wakeOrder: string[] = [];
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(async () => {
      wakeOrder.push("temporal");
      return {
        signalAccepted: true,
        workflowId: "hosted-user-runtime:member_123",
      };
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

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      scheduleAfterResponse: (task) => {
        afterResponseTasks.push(task);
      },
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toEqual({
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
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      knownCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
        userId: "member_123",
      },
      mailboxItemId: "mailbox_123",
    });
    expect(wakeOrder).toEqual(["temporal", "direct"]);
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
    await vi.waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith(
        "Hosted direct ensure wake failed.",
        expect.objectContaining({ source: "linq" }),
      );
    });
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

  it("does not start the direct ensure when the Temporal signal throws", async () => {
    mocks.ensureRuntimeProcessing.mockReturnValue(new Promise(() => undefined));
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValue(new Error("temporal down"));

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response,
      wakeHandoff: buildWakeHandoff(),
    })).rejects.toThrow("temporal down");

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

});
