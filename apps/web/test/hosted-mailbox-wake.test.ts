import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  ensureRuntimeProcessing: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: mocks.after,
  };
});
vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
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
    mocks.ensureRuntimeProcessing.mockImplementation(async (input: {
      onRequestDispatched?: () => void;
    }) => {
      input.onRequestDispatched?.();
      return {
        action: "woken",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt: "2026-08-25T00:00:00.000Z",
        runtimeAttemptId: "runtime-attempt-test",
      };
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      ensureRuntimeProcessing: mocks.ensureRuntimeProcessing,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    {
      directWakeSource: "assistant-ask-request" as const,
      expectedUserId: "member-group-runtime",
      mailboxItemId: "aask_req_one",
    },
    {
      directWakeSource: "assistant-ask-completion" as const,
      expectedUserId: "member-private",
      mailboxItemId: "aask_done_one",
    },
  ])(
    "starts the $directWakeSource Web-direct hint before Temporal accepts durable signaling",
    async ({ directWakeSource, expectedUserId, mailboxItemId }) => {
      let acceptTemporal!: () => void;
      const order: string[] = [];
      mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(async (input: {
        onReadyToSignal?: () => Promise<void> | void;
      }) => {
        await input.onReadyToSignal?.();
        return await new Promise<void>((resolve) => {
          order.push("temporal");
          acceptTemporal = resolve;
        });
      });
      mocks.ensureRuntimeProcessing.mockImplementationOnce(async (input: {
        onRequestDispatched?: () => void;
      }) => {
        input.onRequestDispatched?.();
        order.push("direct-dispatched");
        return {
          action: "woken",
          kind: "runtime_processing_accepted",
          recommendedRecheckAt: "2026-08-25T00:00:00.000Z",
          runtimeAttemptId: "runtime-attempt-test",
        };
      });

      const handoff = handoffHostedMailboxWake({
        directWakeSource,
        expectedUserId,
        mailboxItemId,
      });

      expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledWith({
        commandTimeoutMs: expect.any(Number),
        onRequestDispatched: expect.any(Function),
        onTiming: expect.any(Function),
        orchestrationAttemptId: expect.stringMatching(
          /^web-ingress-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        signal: expect.any(AbortSignal),
        userId: expectedUserId,
      });
      expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
      await vi.waitFor(() => {
        expect(order).toEqual(["direct-dispatched", "temporal"]);
      });
      acceptTemporal();
      await handoff;
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
        abortSignal: expect.any(AbortSignal),
        expectedUserId,
        mailboxItemId,
        onReadyToSignal: expect.any(Function),
      });
    },
  );

  it("rejects the handoff after starting the best-effort direct wake when Temporal rejects", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(async (input: {
      onReadyToSignal?: () => Promise<void> | void;
    }) => {
      await input.onReadyToSignal?.();
      throw new Error("Temporal unavailable");
    });

    await expect(handoffHostedMailboxWake({
      directWakeSource: "assistant-ask-request",
      expectedUserId: "member-group-runtime",
      mailboxItemId: "aask_req_one",
    })).rejects.toThrow("Temporal unavailable");

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
  });

  it("aborts an unsettled Temporal handoff before the caller budget expires", async () => {
    vi.useFakeTimers();
    let temporalSignal: AbortSignal | undefined;
    let resolveTemporal!: () => void;
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(
      async (input: {
        abortSignal?: AbortSignal;
        onReadyToSignal?: () => Promise<void> | void;
      }) => {
        temporalSignal = input.abortSignal;
        await input.onReadyToSignal?.();
        return await new Promise<void>((resolve) => {
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
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
  });

  it("waits for dispatch but not the direct response before signaling Temporal", async () => {
    let directCompleted = false;
    let resolveDirectResponse!: (value: { accepted: true }) => void;
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(async (input: {
      onReadyToSignal?: () => Promise<void> | void;
    }) => {
      await input.onReadyToSignal?.();
      return {
        signalAccepted: true,
        workflowId: "hosted-user-runtime:member-private",
      };
    });
    mocks.ensureRuntimeProcessing.mockImplementationOnce((input: {
      onRequestDispatched?: () => void;
    }) => {
      input.onRequestDispatched?.();
      return new Promise<{ accepted: true }>((resolve) => {
        resolveDirectResponse = resolve;
      }).then((result) => {
        directCompleted = true;
        return result;
      });
    });

    await expect(handoffHostedMailboxWake({
      directWakeSource: "assistant-ask-completion",
      expectedUserId: "member-private",
      mailboxItemId: "aask_done_one",
    })).resolves.toBeUndefined();

    expect(mocks.ensureRuntimeProcessing).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    expect(directCompleted).toBe(false);
    resolveDirectResponse({ accepted: true });
    const afterTask = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
    await afterTask();
    expect(directCompleted).toBe(true);
  });

  it("signals Temporal after the dispatch-only wait expires", async () => {
    vi.useFakeTimers();
    let temporalStarted = false;
    mocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(async (input: {
      onReadyToSignal?: () => Promise<void> | void;
    }) => {
      await input.onReadyToSignal?.();
      temporalStarted = true;
      return { signalAccepted: true };
    });
    mocks.ensureRuntimeProcessing.mockReturnValueOnce(new Promise(() => {}));

    const handoff = handoffHostedMailboxWake({
      directWakeSource: "assistant-ask-request",
      expectedUserId: "member-group-runtime",
      mailboxItemId: "aask_req_dispatch_timeout",
      timeoutMs: 2_000,
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(temporalStarted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(handoff).resolves.toBeUndefined();
    expect(temporalStarted).toBe(true);
  });
});
