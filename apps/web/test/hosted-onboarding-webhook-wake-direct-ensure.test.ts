import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureRuntimeProcessing: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  recordHostedIngressAcceptedFromMailboxItem: vi.fn(async () => undefined),
  recordHostedIngressTemporalSignalAccepted: vi.fn(async () => undefined),
  signalHostedMailboxAppendRuntime: vi.fn(async () => ({
    signalAccepted: true,
    workflowId: "hosted-user-runtime:member_123",
  })),
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

describe("maybeHandoffHostedExecutionWebhookWake runtime ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
  });

  it("uses only the durable Temporal wake even when Linq supplies checkpoint facts", async () => {
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      ensureRuntimeProcessing: mocks.ensureRuntimeProcessing,
    });

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response: {
        ignored: false,
        ok: true,
        reason: "wake-appended-active-member",
      } as never,
      wakeHandoff: {
        eventId: "evt_123",
        mailboxItemId: "mailbox_123",
        source: "linq",
        userId: "member_123",
        wakeMailboxCheckpoint: {
          lane: "conversation",
          laneSeq: "42",
        },
      },
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
      started: true,
    });

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledOnce();
    expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
  });

  it("omits checkpoint authority when Linq has no valid lane checkpoint", async () => {
    await maybeHandoffHostedExecutionWebhookWake({
      response: { ignored: false, ok: true, reason: "wake-appended-active-member" } as never,
      wakeHandoff: {
        eventId: "evt_123",
        mailboxItemId: "mailbox_123",
        source: "linq",
        userId: "member_123",
        wakeMailboxCheckpoint: {
          lane: "conversation",
          laneSeq: "",
        },
      },
    });

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_123",
    });
  });

  it("bounds an omitted-timeout Temporal handoff", async () => {
    vi.useFakeTimers();
    mocks.signalHostedMailboxAppendRuntime.mockReturnValueOnce(new Promise(() => undefined));
    try {
      const handoff = maybeHandoffHostedExecutionWebhookWake({
        response: { ignored: false, ok: true, reason: "wake-appended-active-member" } as never,
        wakeHandoff: {
          eventId: "evt_123",
          mailboxItemId: "mailbox_123",
          source: "linq",
          userId: "member_123",
        },
      });
      const rejected = expect(handoff).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
