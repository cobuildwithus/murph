import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const edges = vi.hoisted(() => ({ released: vi.fn(), recheck: vi.fn() }));
vi.mock("@/src/lib/hosted-orchestration/runtime-reconciliation-facts", () => {
  throw new Error("Attempt-ended hints must not load or preread reconciliation facts.");
});
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeOwnerReleasedRuntime: edges.released,
  signalHostedRuntimeRecheckRuntime: edges.recheck,
}));
import { notifyHostedRuntimeOwnerCompletion, signalHostedRuntimeOwnerRelease } from "@/src/lib/hosted-orchestration/runtime-owner-release";

const input = { userId: "synthetic-member", runtimeAttemptId: "attempt-a" };
beforeEach(() => { vi.clearAllMocks(); edges.released.mockResolvedValue({ signalAccepted: true }); });
afterEach(() => { vi.useRealTimers(); });

describe("completion scheduling hint", () => {
  it("always sends the exact attempt without a facts pre-read", async () => {
    await notifyHostedRuntimeOwnerCompletion(input);
    expect(edges.released).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      userId: input.userId, runtimeAttemptId: input.runtimeAttemptId,
    }));
    expect(edges.recheck).not.toHaveBeenCalled();
  });

  it("keeps legacy pointerless callbacks on the facts-only signal", async () => {
    expect(await signalHostedRuntimeOwnerRelease({ ...input, runtimeAttemptId: null })).toBe(true);
    expect(edges.recheck).toHaveBeenCalledOnce();
    expect(edges.released).not.toHaveBeenCalled();
  });

  it("keeps completion successful when Temporal rejects the advisory hint", async () => {
    edges.released.mockRejectedValueOnce(new Error("synthetic signal failure"));
    await expect(notifyHostedRuntimeOwnerCompletion(input)).resolves.toBeUndefined();
  });

  it("bounds non-settling Temporal hints to two seconds and aborts the transport", async () => {
    vi.useFakeTimers();
    edges.released.mockImplementationOnce(() => new Promise(() => {}));
    const completed = notifyHostedRuntimeOwnerCompletion(input);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(completed).resolves.toBeUndefined();
    expect(edges.released.mock.calls[0]![0].abortSignal.aborted).toBe(true);
  });

  it("does not signal with an already aborted transport", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(signalHostedRuntimeOwnerRelease({ ...input, abortSignal: controller.signal })).rejects.toThrow();
    expect(edges.released).not.toHaveBeenCalled();
  });
});
