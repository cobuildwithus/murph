import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRunnerStatusResponse } from "@murphai/hosted-execution/runtime-control";

import { waitForHostedJunctionReplayCompletion } from "./hosted-local-junction-replay-completion.js";

const nowMs = Date.parse("2026-09-01T12:00:00.000Z");
type WaitInput = Parameters<typeof waitForHostedJunctionReplayCompletion>[0];
type DrainStatus = Awaited<ReturnType<WaitInput["scenario"]["readJunctionDeviceSyncReplayDrainStatus"]>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(nowMs);
});
afterEach(() => vi.useRealTimers());

describe("hosted Junction replay completion", () => {
  it("waits for a retained future retry and returns the status after its dirty acknowledgment", async () => {
    const earlier = completedStatus("1");
    const latest = completedStatus("2");
    const settled = vi.fn();
    const input = waitInput();
    input.scenario.waitForHostedCompletion = vi.fn(async () =>
      Date.now() < nowMs + 30_000 ? earlier : latest
    );
    input.scenario.readJunctionDeviceSyncReplayDrainStatus = vi.fn(async () =>
      drainStatus(Date.now() < nowMs + 30_000 ? {
        hasPendingDirtyConnection: true,
        hasPendingDirtyConnectionForUser: true,
        pendingDirtyResourceCount: 48,
      } : {})
    );
    const result = waitForHostedJunctionReplayCompletion(input).then((status) => {
      settled();
      return status;
    });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(latest);
    expect(input.scenario.readJunctionDeviceSyncReplayDrainStatus).toHaveBeenCalledWith({
      connectionId: input.connectionId,
      memberId: input.memberId,
    });
    // A sequence-only owner can belong to other future work and is not a drain gate.
    expect(latest.workspace?.redactedStatus?.hostedMailboxSystemDeviceSyncContinuationSeqs).toEqual(["9"]);
  });

  it("rechecks quiescence when a continuation starts between status and dirty observations", async () => {
    const earlier = completedStatus("1");
    const latest = completedStatus("2");
    const input = waitInput();
    const settled = vi.fn();
    input.scenario.waitForHostedCompletion = vi.fn()
      .mockResolvedValueOnce(earlier)
      .mockImplementationOnce(async () => {
        await delay(1_000);
        return latest;
      });
    const result = waitForHostedJunctionReplayCompletion(input).then((status) => {
      settled();
      return status;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(latest);
    expect(input.assertNoJobFailures).toHaveBeenNthCalledWith(1, earlier);
    expect(input.assertNoJobFailures).toHaveBeenNthCalledWith(2, latest);
  });

  it.each([
    { hasPendingDirtyConnection: true },
    { hasPendingDirtyConnectionForUser: true },
    { pendingDirtyResourceCount: 1 },
  ])("does not complete while one dirty fact remains: %j", async (pending) => {
    const input = waitInput();
    input.deadlineAtMs = nowMs + 500;
    input.scenario.readJunctionDeviceSyncReplayDrainStatus = vi.fn(async () => drainStatus(pending));
    const rejection = expect(waitForHostedJunctionReplayCompletion(input)).rejects.toThrow(
      "Timed out waiting for the complete hosted Junction replay to drain.",
    );
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
    expect(input.scenario.buildFailureMessage).toHaveBeenCalledWith(input.memberId, [
      expect.any(String),
      expect.stringContaining('"pendingDirtyResourceCount"'),
    ]);
  });

  it.each([
    { dirtyFirst: false, expectedTimeouts: [1_000, 300] },
    { dirtyFirst: true, expectedTimeouts: [1_000, 50] },
  ])("shares one budget across quiescence, polling and recheck: %j", async ({ dirtyFirst, expectedTimeouts }) => {
    const input = waitInput();
    input.deadlineAtMs = nowMs + 1_000;
    const timeouts: number[] = [];
    input.scenario.waitForHostedCompletion = vi.fn(async (_member, options) => {
      timeouts.push(options!.timeoutMs!);
      await delay(timeouts.length === 1 ? 700 : options!.timeoutMs!);
      return completedStatus("1");
    });
    input.scenario.readJunctionDeviceSyncReplayDrainStatus = vi.fn(async () =>
      drainStatus(dirtyFirst && timeouts.length === 1 ? { pendingDirtyResourceCount: 1 } : {})
    );
    const rejection = expect(waitForHostedJunctionReplayCompletion(input)).rejects.toThrow(
      "Timed out waiting for the complete hosted Junction replay to drain.",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(timeouts).toEqual(expectedTimeouts);
  });

  it("propagates a final status read failure instead of returning the earlier workspace", async () => {
    const input = waitInput();
    input.scenario.waitForHostedCompletion = vi.fn()
      .mockResolvedValueOnce(completedStatus("1"))
      .mockRejectedValueOnce(new Error("status unavailable"));
    await expect(waitForHostedJunctionReplayCompletion(input)).rejects.toThrow("status unavailable");
  });

  it("preserves a failed-job observation before the next retry can replace the status tail", async () => {
    const input = waitInput();
    input.assertNoJobFailures = vi.fn(async () => { throw new Error("device job failed"); });
    await expect(waitForHostedJunctionReplayCompletion(input)).rejects.toThrow("device job failed");
    expect(input.scenario.readJunctionDeviceSyncReplayDrainStatus).not.toHaveBeenCalled();
  });
});

function waitInput(): WaitInput {
  return {
    assertNoJobFailures: vi.fn(async () => {}),
    connectionId: "junction_replay_fixture",
    deadlineAtMs: nowMs + 60_000,
    memberId: "member_fixture",
    scenario: {
      buildFailureMessage: vi.fn(async (_member, lines) => lines.join("\n")),
      readJunctionDeviceSyncReplayDrainStatus: vi.fn(async () => drainStatus()),
      waitForHostedCompletion: vi.fn(async () => completedStatus("1")),
    },
  };
}

function drainStatus(overrides: Partial<DrainStatus> = {}): DrainStatus {
  return {
    hasPendingDirtyConnection: false,
    hasPendingDirtyConnectionForUser: false,
    historicalBackfillEmptyAttempts: null,
    historicalBackfillEvidence: null,
    historicalBackfillLastEmptyAt: null,
    historicalBackfillStatus: null,
    pendingDirtyResourceCount: 0,
    ...overrides,
  };
}

function completedStatus(version: string): HostedRunnerStatusResponse {
  return {
    inFlight: false,
    lastErrorCode: null,
    mailboxLag: [{ importedSeq: "1", lag: "0", lane: "system", maxSeq: "1" }],
    userId: "member_fixture",
    workspace: {
      createdAt: new Date(nowMs).toISOString(),
      nextWakeAt: new Date(nowMs + 120_000).toISOString(),
      nextWakeReason: "device-sync.reconcile",
      redactedStatus: { hostedMailboxSystemDeviceSyncContinuationSeqs: ["9"] },
      snapshotRef: null,
      updatedAt: new Date(nowMs + Number(version)).toISOString(),
      userId: "member_fixture",
      version,
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
