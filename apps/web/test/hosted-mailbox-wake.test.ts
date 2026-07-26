import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  startHostedDirectRuntimeWakeBestEffort: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: mocks.after,
  };
});
vi.mock("@/src/lib/hosted-execution/direct-runtime-wake", () => ({
  startHostedDirectRuntimeWakeBestEffort:
    mocks.startHostedDirectRuntimeWakeBestEffort,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import {
  scheduleHostedMailboxWakeAfterResponse,
} from "@/src/lib/hosted-orchestration/mailbox-wake";

describe("hosted mailbox direct wake scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.after.mockImplementation((task: () => Promise<void>) => {
      void task();
    });
    mocks.startHostedDirectRuntimeWakeBestEffort.mockResolvedValue(undefined);
  });

  it("starts the direct latency hint only after Temporal accepts durable signaling", async () => {
    let acceptTemporal!: () => void;
    const order: string[] = [];
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(() =>
      new Promise<void>((resolve) => {
        order.push("temporal");
        acceptTemporal = resolve;
      })
    );
    mocks.startHostedDirectRuntimeWakeBestEffort.mockImplementationOnce(
      async () => {
        order.push("direct");
      },
    );

    scheduleHostedMailboxWakeAfterResponse({
      directWakeSource: "assistant-ask-completion",
      expectedUserId: "member-private",
      mailboxItemId: "aask_done_one",
    });

    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.startHostedDirectRuntimeWakeBestEffort).not.toHaveBeenCalled();
    acceptTemporal();
    await vi.waitFor(() => {
      expect(mocks.startHostedDirectRuntimeWakeBestEffort).toHaveBeenCalledWith({
        source: "assistant-ask-completion",
        userId: "member-private",
      });
    });
    expect(order).toEqual(["temporal", "direct"]);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member-private",
      mailboxItemId: "aask_done_one",
    });
  });

  it("never bypasses a rejected Temporal signal", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );

    scheduleHostedMailboxWakeAfterResponse({
      directWakeSource: "assistant-ask-request",
      expectedUserId: "member-group-runtime",
      mailboxItemId: "aask_req_one",
    });

    await vi.waitFor(() => {
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    });
    expect(mocks.startHostedDirectRuntimeWakeBestEffort).not.toHaveBeenCalled();
  });
});
