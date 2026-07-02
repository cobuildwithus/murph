import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  recordHostedIngressAcceptedFromMailboxItem: vi.fn(async () => undefined),
  recordHostedIngressTemporalSignalAccepted: vi.fn(async () => undefined),
  signalHostedMailboxAppendRuntime: vi.fn(),
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

describe("maybeHandoffHostedExecutionWebhookWake planner checkpoint threading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
  });

  it("threads planner lane facts into the Temporal signal as a known checkpoint", async () => {
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
    })).resolves.toEqual({
      reason: "temporal-signaled",
      signalAccepted: true,
      started: true,
      workflowId: "hosted-user-runtime:member_123",
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
  });

  it("keeps the legacy signal path when the planner checkpoint is absent", async () => {
    await maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_123",
      mailboxItemId: "mailbox_123",
      response,
      source: "linq",
      userId: "member_123",
    });

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

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_123",
    });
  });
});
