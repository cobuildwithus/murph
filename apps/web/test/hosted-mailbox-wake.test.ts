import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  handoffHostedMailboxWake,
} from "@/src/lib/hosted-orchestration/mailbox-wake";

describe("hosted mailbox wake handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startHostedDirectRuntimeWakeBestEffort.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
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

    const handoff = handoffHostedMailboxWake({
      directWakeSource: "assistant-ask-completion",
      expectedUserId: "member-private",
      mailboxItemId: "aask_done_one",
    });

    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.startHostedDirectRuntimeWakeBestEffort).not.toHaveBeenCalled();
    acceptTemporal();
    await handoff;
    expect(mocks.startHostedDirectRuntimeWakeBestEffort).toHaveBeenCalledWith({
      source: "assistant-ask-completion",
      userId: "member-private",
    });
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    expect(order).toEqual(["temporal", "direct"]);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member-private",
      mailboxItemId: "aask_done_one",
    });
  });

  it("rejects the handoff and never schedules a direct wake when Temporal rejects", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );

    await expect(handoffHostedMailboxWake({
      directWakeSource: "assistant-ask-request",
      expectedUserId: "member-group-runtime",
      mailboxItemId: "aask_req_one",
    })).rejects.toThrow("Temporal unavailable");

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.startHostedDirectRuntimeWakeBestEffort).not.toHaveBeenCalled();
  });

  it("aborts an unsettled Temporal handoff before the caller budget expires", async () => {
    vi.useFakeTimers();
    let temporalSignal: AbortSignal | undefined;
    let resolveTemporal!: () => void;
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(
      (input: { abortSignal?: AbortSignal }) => {
        temporalSignal = input.abortSignal;
        return new Promise<void>((resolve) => {
          resolveTemporal = resolve;
        });
      },
    );

    const handoff = handoffHostedMailboxWake({
      directWakeSource: "assistant-ask-request",
      expectedUserId: "member-group-runtime",
      mailboxItemId: "aask_req_timeout",
      timeoutMs: 25,
    });
    const rejection = expect(handoff).rejects.toThrow(
      "Hosted post-commit handoff timed out",
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(temporalSignal?.aborted).toBe(true);
    resolveTemporal();
    await Promise.resolve();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.startHostedDirectRuntimeWakeBestEffort).not.toHaveBeenCalled();
  });

  it("does not wait for the best-effort direct wake before completing handoff", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValueOnce({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member-private",
    });
    mocks.startHostedDirectRuntimeWakeBestEffort.mockReturnValueOnce(
      new Promise<void>(() => {}),
    );

    await expect(handoffHostedMailboxWake({
      directWakeSource: "assistant-ask-completion",
      expectedUserId: "member-private",
      mailboxItemId: "aask_done_one",
    })).resolves.toBeUndefined();

    expect(mocks.startHostedDirectRuntimeWakeBestEffort).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
  });
});
