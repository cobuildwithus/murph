import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ensure: vi.fn(), client: vi.fn(), snapshot: vi.fn(), member: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  $queryRaw: mocks.snapshot, hostedMember: { findUnique: mocks.member },
}) }));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: mocks.client }));

import { startHostedDirectRuntimeWakeBestEffort } from "@/src/lib/hosted-execution/direct-runtime-wake";

const input = { source: "linq" as const, userId: "member-test" };
const liveOwner = {
  userId: input.userId, migrationPhase: "postgres", generation: 7n,
  attemptId: "runtime-attempt-test", phase: "active", processingMode: "default",
  allocationId: "standby-claim-test", runnerContainerName: "synthetic-runner",
  workspaceVersion: 0n, platformAiUsageAllowed: true,
  startedAt: new Date("2026-01-01T00:00:00Z"), acceptedAt: null, completedAt: null,
  failureCount: 0, lastErrorCode: null,
};
const snapshot = (patch = {}) => ({ cutoverPhase: "postgres", memberExists: true, ...liveOwner, ...patch });
const accepted = { kind: "runtime_processing_accepted", action: "woken", runtimeAttemptId: "runtime-attempt-test" };

describe("Web direct runtime wake", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.client.mockReturnValue({ ensureRuntimeProcessing: mocks.ensure });
    mocks.ensure.mockResolvedValue(accepted);
    mocks.snapshot.mockResolvedValue([snapshot({ phase: "idle" })]);
    mocks.member.mockResolvedValue({ id: input.userId });
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

  it.each(["active", "starting"])("supplies the existing %s owner using the canonical wire shape", async phase => {
    mocks.snapshot.mockResolvedValue([snapshot({ phase })]);
    await startHostedDirectRuntimeWakeBestEffort(input);
    expect(mocks.ensure.mock.calls[0]?.[0].admission).toEqual({
      cutover: "postgres", status: "existing", owner: {
        userId: input.userId, generation: "7", attemptId: liveOwner.attemptId, phase,
        processingMode: "default", allocationId: liveOwner.allocationId,
        runnerContainerName: liveOwner.runnerContainerName, workspaceVersion: "0",
        platformAiUsageAllowed: true, startedAt: liveOwner.startedAt.toISOString(),
        acceptedAt: null, completedAt: null, failureCount: 0, lastErrorCode: null,
      },
    });
    expect(mocks.member).toHaveBeenCalledOnce();
  });

  it.each([
    ["idle", { phase: "idle" }], ["retiring", { phase: "retiring" }],
    ["untargeted", { runnerContainerName: null }], ["unprepared", { workspaceVersion: null }],
    ["legacy", { cutoverPhase: "legacy" }], ["draining", { cutoverPhase: "draining" }],
    ["rolling legacy", { cutoverPhase: "rolling", migrationPhase: "legacy" }],
    ["deleted", { memberExists: false }], ["absent", { userId: null }],
    ["retention", { processingMode: "inbox_media_retention" }],
  ])("omits admission for %s ownership", async (_name, patch) => {
    mocks.snapshot.mockResolvedValue([snapshot(patch)]);
    await startHostedDirectRuntimeWakeBestEffort(input);
    expect(mocks.ensure).toHaveBeenCalledOnce();
    expect(mocks.ensure.mock.calls[0]?.[0]).not.toHaveProperty("admission");
    expect(mocks.member).not.toHaveBeenCalled();
  });

  it("omits a live snapshot when the shared member admission predicate rejects it", async () => {
    mocks.snapshot.mockResolvedValue([snapshot()]);
    mocks.member.mockResolvedValue(null);
    await startHostedDirectRuntimeWakeBestEffort(input);
    expect(mocks.ensure.mock.calls[0]?.[0]).not.toHaveProperty("admission");
    expect(mocks.member).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: input.userId, suspendedAt: null, AND: expect.any(Array) }),
    }));
  });

  it("refreshes the snapshot after an explicit retry", async () => {
    vi.useFakeTimers();
    mocks.snapshot.mockResolvedValueOnce([snapshot()]).mockResolvedValueOnce([snapshot({ generation: 8n, attemptId: "successor" })]);
    mocks.ensure.mockResolvedValueOnce({ kind: "retry_later", retryAt: new Date(Date.now() + 3_000).toISOString() });
    const wake = startHostedDirectRuntimeWakeBestEffort(input);
    await vi.advanceTimersByTimeAsync(3_000);
    await wake;
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(mocks.ensure.mock.calls.map(([value]) => value.admission.owner.generation)).toEqual(["7", "8"]);
  });

  it("dispatches without admission after the optional read cap when the read never resolves", async () => {
    vi.useFakeTimers();
    mocks.snapshot.mockImplementation(() => new Promise(() => {}));
    const wake = startHostedDirectRuntimeWakeBestEffort(input);
    await vi.advanceTimersByTimeAsync(249);
    expect(mocks.ensure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await wake;
    expect(mocks.ensure).toHaveBeenCalledOnce();
    expect(mocks.ensure.mock.calls[0]?.[0]).not.toHaveProperty("admission");
  });

  it("leaves admission to the Worker when the optional read fails", async () => {
    mocks.snapshot.mockRejectedValue(new Error("synthetic database unavailable"));
    await startHostedDirectRuntimeWakeBestEffort(input);
    expect(mocks.ensure).toHaveBeenCalledOnce();
    expect(mocks.ensure.mock.calls[0]?.[0]).not.toHaveProperty("admission");
  });

  it("settles failed dispatch without retrying an uncertain request", async () => {
    mocks.ensure.mockRejectedValue(new TypeError("fetch failed"));
    await expect(startHostedDirectRuntimeWakeBestEffort(input)).resolves.toBeUndefined();
    expect(mocks.ensure).toHaveBeenCalledOnce();
  });

  it("does nothing when no direct client is configured", async () => {
    mocks.client.mockReturnValue(null);
    await startHostedDirectRuntimeWakeBestEffort(input);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
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
