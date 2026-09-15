import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  ensureRuntimeProcessing: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: mocks.after };
});
vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import { handoffHostedMailboxWake } from "@/src/lib/hosted-orchestration/mailbox-wake";

const signalResult = {
  signalAccepted: true as const,
  workflowId: "hosted-user-runtime:member-private",
};
const request = {
  directWakeSource: "assistant-ask-completion" as const,
  expectedUserId: "member-private",
  mailboxItemId: "aask_done_one",
};
const directResult = {
  action: "woken",
  kind: "runtime_processing_accepted",
  recommendedRecheckAt: "2026-08-25T00:00:00.000Z",
  runtimeAttemptId: "runtime-attempt-test",
};

describe("hosted mailbox wake handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.after.mockReset();
    mocks.ensureRuntimeProcessing.mockReset().mockResolvedValue(directResult);
    mocks.signalHostedMailboxAppendRuntime.mockReset().mockImplementation(
      async (input: { onSignalStarted?: () => void }) => {
        input.onSignalStarted?.();
        return signalResult;
      },
    );
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      ensureRuntimeProcessing: mocks.ensureRuntimeProcessing,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    "assistant-ask-request", "assistant-ask-completion", "linq", "telegram",
  ] as const)("overlaps the admitted %s hint with Temporal acknowledgement", async (directWakeSource) => {
    let acceptTemporal!: (value: typeof signalResult) => void;
    const order: string[] = [];
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(
      (input: { onSignalStarted?: () => void }) => {
        order.push("temporal");
        input.onSignalStarted?.();
        return new Promise<typeof signalResult>((resolve) => { acceptTemporal = resolve; });
      },
    );
    mocks.ensureRuntimeProcessing.mockImplementationOnce(async () => {
      order.push("direct");
      return directResult;
    });

    const handoff = handoffHostedMailboxWake({ ...request, directWakeSource });
    expect(order).toEqual(["temporal", "direct"]);
    expect(mocks.after).not.toHaveBeenCalled();
    acceptTemporal(signalResult);
    await expect(handoff).resolves.toEqual(signalResult);
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledExactlyOnceWith({
      commandTimeoutMs: expect.any(Number),
      onTiming: expect.any(Function),
      orchestrationAttemptId: expect.stringMatching(/^web-ingress-[0-9a-f-]{36}$/u),
      signal: expect.any(AbortSignal),
      userId: request.expectedUserId,
    });
    expect(mocks.after).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledExactlyOnceWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: request.expectedUserId,
      mailboxItemId: request.mailboxItemId,
      onSignalStarted: expect.any(Function),
    });
  });

  it("never hints when admission fails before signal dispatch", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(new Error("access denied"));
    await expect(handoffHostedMailboxWake(request)).rejects.toThrow("access denied");
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
  });

  it("preserves an admitted hint but propagates Temporal acknowledgement failure", async () => {
    const tasks: Array<() => Promise<void>> = [];
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(
      async (input: { onSignalStarted?: () => void }) => {
        input.onSignalStarted?.();
        throw new Error("Temporal unavailable");
      },
    );
    await expect(handoffHostedMailboxWake({
      ...request,
      scheduleAfterResponse: (task) => { tasks.push(task); },
    })).rejects.toThrow("Temporal unavailable");
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledOnce();
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("passes committed checkpoint facts to the existing signal authority", async () => {
    const knownCheckpoint = { lane: "conversation" as const, laneSeq: "42", userId: request.expectedUserId };
    await expect(handoffHostedMailboxWake({ ...request, knownCheckpoint })).resolves.toEqual(signalResult);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith(expect.objectContaining({ knownCheckpoint }));
  });

  it("aborts an unsettled handoff without a hint before admission", async () => {
    vi.useFakeTimers();
    let temporalSignal: AbortSignal | undefined;
    let resolveTemporal!: (value: typeof signalResult) => void;
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(
      (input: { abortSignal?: AbortSignal }) => {
        temporalSignal = input.abortSignal;
        return new Promise<typeof signalResult>((resolve) => { resolveTemporal = resolve; });
      },
    );
    const handoff = handoffHostedMailboxWake({ ...request, timeoutMs: 25 });
    const rejection = expect(handoff).rejects.toThrow("Hosted post-commit handoff timed out");
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(temporalSignal?.aborted).toBe(true);
    resolveTemporal(signalResult);
    await Promise.resolve();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
  });

  it("does not dispatch either wake for an already-aborted caller", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller stopped"));
    await expect(handoffHostedMailboxWake({ ...request, signal: controller.signal })).rejects.toThrow("caller stopped");
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.ensureRuntimeProcessing).not.toHaveBeenCalled();
  });

  it("does not wait for the direct request before completing handoff", async () => {
    let finishDirect!: (value: typeof directResult) => void;
    mocks.ensureRuntimeProcessing.mockReturnValueOnce(
      new Promise<typeof directResult>((resolve) => { finishDirect = resolve; }),
    );
    await expect(handoffHostedMailboxWake(request)).resolves.toEqual(signalResult);
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledOnce();
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    finishDirect(directResult);
    await mocks.after.mock.calls[0]![0]();
  });

  it("does not turn post-response registration failure into durable signal failure", async () => {
    const scheduleAfterResponse = vi.fn(() => { throw new Error("response context closed"); });
    await expect(handoffHostedMailboxWake({ ...request, scheduleAfterResponse })).resolves.toEqual(signalResult);
    expect(scheduleAfterResponse).toHaveBeenCalledOnce();
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledOnce();
  });
});
