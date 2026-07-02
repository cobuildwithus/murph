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

  it("fires the direct Cloudflare ensure alongside the unconditional Temporal signal", async () => {
    const afterResponseTasks: Array<() => Promise<void>> = [];

    await expect(maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_123",
      mailboxItemId: "mailbox_123",
      response,
      scheduleAfterResponse: (task) => {
        afterResponseTasks.push(task);
      },
      source: "linq",
      userId: "member_123",
      wakeMailboxCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
      },
    })).resolves.toEqual({
      reason: "temporal-signaled",
      signalAccepted: true,
      started: true,
      workflowId: "hosted-user-runtime:member_123",
    });

    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledWith({
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
    await Promise.all(afterResponseTasks.map((task) => task()));
  });

  it("keeps the Temporal signal and handoff result intact when the direct ensure fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.ensureRuntimeProcessing.mockRejectedValue(new Error("cloudflare unreachable"));

    await expect(maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_123",
      mailboxItemId: "mailbox_123",
      response,
      source: "linq",
      userId: "member_123",
      wakeMailboxCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
      },
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
    });

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted direct ensure wake failed.",
      expect.objectContaining({ source: "linq" }),
    );
    consoleWarn.mockRestore();
  });

  it("skips the direct ensure and lane facts when the planner checkpoint is absent", async () => {
    await maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_123",
      mailboxItemId: "mailbox_123",
      response,
      source: "linq",
      userId: "member_123",
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
      eventId: "evt_123",
      mailboxItemId: "mailbox_123",
      response,
      source: "linq",
      userId: "member_123",
      wakeMailboxCheckpoint: {
        lane: undefined,
        laneSeq: undefined,
      } as never,
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
      eventId: "evt_123",
      mailboxItemId: "mailbox_123",
      response,
      source: "linq",
      userId: "member_123",
      wakeMailboxCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
      },
    })).resolves.toMatchObject({ signalAccepted: true });

    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
  });

  it("still resolves the direct ensure when the Temporal signal fails", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValue(new Error("temporal down"));

    await expect(maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_123",
      mailboxItemId: "mailbox_123",
      response,
      source: "linq",
      userId: "member_123",
      wakeMailboxCheckpoint: {
        lane: "conversation",
        laneSeq: "42",
      },
    })).rejects.toThrow("temporal down");

    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
    expect(consoleInfo).toHaveBeenCalledWith(
      "Hosted direct ensure wake completed.",
      expect.objectContaining({ action: "woken", source: "linq" }),
    );
    consoleInfo.mockRestore();
  });
});
