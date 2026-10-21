import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ensure: vi.fn(), client: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: mocks.client }));

import { startHostedDirectRuntimeWakeBestEffort } from "@/src/lib/hosted-execution/direct-runtime-wake";

const input = { source: "linq" as const, userId: "member-test" };
const accepted = { kind: "runtime_processing_accepted", action: "woken", runtimeAttemptId: "runtime-attempt-test" };

describe("Web direct runtime wake", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.client.mockReturnValue({ ensureRuntimeProcessing: mocks.ensure });
    mocks.ensure.mockResolvedValue(accepted);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.useRealTimers());

  it.each(["linq", "telegram", "assistant-ask-request", "assistant-ask-completion"] as const)(
    "dispatches %s without reserving ownership before the Worker receives it", async source => {
      await startHostedDirectRuntimeWakeBestEffort({ ...input, source });
      expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({
        commandTimeoutMs: 25_000,
        onTiming: expect.any(Function),
        orchestrationAttemptId: expect.stringMatching(/^web-ingress-/u),
        signal: expect.any(AbortSignal),
        userId: input.userId,
      });
    },
  );

  it("settles failed dispatch without retrying an uncertain request", async () => {
    mocks.ensure.mockRejectedValue(new TypeError("fetch failed"));
    await expect(startHostedDirectRuntimeWakeBestEffort(input)).resolves.toBeUndefined();
    expect(mocks.ensure).toHaveBeenCalledOnce();
  });

  it("does nothing when no direct client is configured", async () => {
    mocks.client.mockReturnValue(null);
    await startHostedDirectRuntimeWakeBestEffort(input);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("lets the Worker read current admission on each explicit retry", async () => {
    vi.useFakeTimers();
    mocks.ensure.mockResolvedValueOnce({ kind: "retry_later", retryAt: new Date(Date.now() + 3_000).toISOString() });
    const wake = startHostedDirectRuntimeWakeBestEffort(input);
    await vi.advanceTimersByTimeAsync(3_000);
    await wake;
    expect(mocks.ensure).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.ensure.mock.calls) expect(request).not.toHaveProperty("admission");
  });

  it("subtracts retry time from the dispatch budget", async () => {
    vi.useFakeTimers();
    mocks.ensure.mockResolvedValueOnce({ kind: "retry_later", retryAt: new Date(Date.now() + 10_000).toISOString() });
    const wake = startHostedDirectRuntimeWakeBestEffort(input);
    await vi.advanceTimersByTimeAsync(10_000);
    await wake;
    expect(mocks.ensure).toHaveBeenCalledTimes(2);
    expect(mocks.ensure.mock.calls[1]?.[0].commandTimeoutMs).toBeLessThan(19_000);
  });
});
