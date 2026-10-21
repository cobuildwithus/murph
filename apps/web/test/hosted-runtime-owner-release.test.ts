import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const edges = vi.hoisted(() => ({ actionable: vi.fn(), released: vi.fn(), recheck: vi.fn() }));
vi.mock("@/src/lib/hosted-orchestration/runtime-reconciliation-facts", () => ({ readHostedRuntimeOwnerReleaseActionable: edges.actionable }));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeOwnerReleasedRuntime: edges.released,
  signalHostedRuntimeRecheckRuntime: edges.recheck,
}));
import { notifyHostedRuntimeOwnerCompletion, signalHostedRuntimeOwnerRelease } from "@/src/lib/hosted-orchestration/runtime-owner-release";

const input = { userId: "synthetic-member", runtimeAttemptId: "attempt-a", immediateRecheckRequested: false };
beforeEach(() => { vi.clearAllMocks(); edges.actionable.mockResolvedValue(true); edges.released.mockResolvedValue({ signalAccepted: true }); });
afterEach(() => { vi.useRealTimers(); });

describe("completion scheduling hint", () => {
  it("keeps the exact attempt and skips known future mailbox continuation", async () => {
    await notifyHostedRuntimeOwnerCompletion(input);
    expect(edges.released).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      userId: input.userId, runtimeAttemptId: input.runtimeAttemptId,
    }));
    edges.released.mockClear();
    edges.actionable.mockResolvedValue(false);
    await notifyHostedRuntimeOwnerCompletion(input);
    expect(edges.released).not.toHaveBeenCalled();
  });

  it("preserves the positive immediate edge without a facts read", async () => {
    await notifyHostedRuntimeOwnerCompletion({ ...input, immediateRecheckRequested: true });
    expect(edges.actionable).not.toHaveBeenCalled();
    expect(edges.released).toHaveBeenCalledOnce();
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

  it("does not start a delayed signal after the hint budget expires during the facts read", async () => {
    vi.useFakeTimers();
    let resolveFacts: ((value: boolean) => void) | undefined;
    edges.actionable.mockImplementationOnce(() => new Promise<boolean>(resolve => { resolveFacts = resolve; }));
    const completed = notifyHostedRuntimeOwnerCompletion(input);
    await vi.advanceTimersByTimeAsync(2_000);
    await completed;
    resolveFacts!(true);
    await Promise.resolve();
    expect(edges.released).not.toHaveBeenCalled();
  });
});
