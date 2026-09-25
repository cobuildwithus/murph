import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeOwnerResponse } from "@murphai/hosted-execution/runtime-owner";
import { runtimeAdmission } from "./support/hosted-runtime-admission-fixture";

const mocks = vi.hoisted(() => ({
  admit: vi.fn(), ensure: vi.fn(), client: vi.fn(), prisma: {},
}));
vi.mock("@/src/lib/hosted-execution/runtime-owner-control", () => ({ executeHostedRuntimeOwnerCommand: mocks.admit }));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: mocks.client }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));

import { startHostedDirectRuntimeWakeBestEffort } from "@/src/lib/hosted-execution/direct-runtime-wake";

const input = { source: "linq" as const, userId: "member-test" };
const accepted = { kind: "runtime_processing_accepted", action: "woken", runtimeAttemptId: "runtime-attempt-test" };

describe("Web runtime admission before dispatch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.admit.mockResolvedValue(runtimeAdmission(input.userId));
    mocks.client.mockReturnValue({ ensureRuntimeProcessing: mocks.ensure });
    mocks.ensure.mockResolvedValue(accepted);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.useRealTimers());

  it.each(["linq", "telegram", "assistant-ask-request", "assistant-ask-completion"] as const)(
    "admits %s locally before sending the same result to the Worker", async source => {
      let admit!: (value: HostedRuntimeOwnerResponse) => void;
      mocks.admit.mockReturnValueOnce(new Promise(resolve => { admit = resolve; }));
      const wake = startHostedDirectRuntimeWakeBestEffort({ ...input, source });
      expect(mocks.admit).toHaveBeenCalledExactlyOnceWith({
        prisma: mocks.prisma, userId: input.userId, command: { operation: "claim", processingMode: "default" },
      });
      expect(mocks.ensure).not.toHaveBeenCalled();
      const admission = runtimeAdmission(input.userId);
      admit(admission);
      await wake;
      expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ admission, userId: input.userId }));
    },
  );

  it.each([
    { cutover: "postgres", status: "blocked", owner: null },
    { cutover: "draining", status: "blocked", owner: null },
  ])("does not dispatch rejected admission (%s)", async admission => {
    mocks.admit.mockResolvedValue(admission);
    await startHostedDirectRuntimeWakeBestEffort(input);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("settles failed admission without dispatch or an alternate authority", async () => {
    mocks.admit.mockRejectedValue(new Error("synthetic admission unavailable"));
    await expect(startHostedDirectRuntimeWakeBestEffort(input)).resolves.toBeUndefined();
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.admit).toHaveBeenCalledOnce();
  });

  it("does not claim an owner when no direct client is configured", async () => {
    mocks.client.mockReturnValue(null);
    await startHostedDirectRuntimeWakeBestEffort(input);
    expect(mocks.admit).not.toHaveBeenCalled();
  });

  it("reads fresh admission on retry instead of reusing a stale snapshot", async () => {
    vi.useFakeTimers();
    const first = runtimeAdmission(input.userId, "attempt-first");
    const second = runtimeAdmission(input.userId, "attempt-second");
    mocks.admit.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    mocks.ensure.mockResolvedValueOnce({ kind: "retry_later", retryAt: new Date(Date.now() + 3_000).toISOString() });
    const wake = startHostedDirectRuntimeWakeBestEffort(input);
    await vi.advanceTimersByTimeAsync(3_000);
    await wake;
    expect(mocks.ensure.mock.calls.map(([request]) => request.admission)).toEqual([first, second]);
    expect(mocks.admit).toHaveBeenCalledTimes(2);
  });

  it("subtracts local admission time from the dispatch budget", async () => {
    vi.useFakeTimers();
    mocks.admit.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 10_000);
      return runtimeAdmission(input.userId);
    });
    await startHostedDirectRuntimeWakeBestEffort(input);
    expect(mocks.ensure.mock.calls[0]?.[0].commandTimeoutMs).toBeLessThan(19_000);
  });
});
