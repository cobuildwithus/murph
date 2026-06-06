import { describe, expect, it, vi } from "vitest";

import {
  runHostedDeviceSyncRecoverySweep,
} from "@/src/lib/device-sync/recovery-sweeper";

describe("hosted device-sync scheduled wake sweeper", () => {
  it("runs due-reconcile wake handoff as one retryable command", async () => {
    const dueReconcileSweeper = vi.fn(async () => buildDueReconcileSweepResult());

    await expect(runHostedDeviceSyncRecoverySweep({
      runDueReconcileSweeper: dueReconcileSweeper,
    })).resolves.toEqual({
      dueReconcileSweeper: buildDueReconcileSweepResult(),
    });

    expect(dueReconcileSweeper).toHaveBeenCalledTimes(1);
  });

  it("fails the command when due-reconcile wake handoff is not accepted", async () => {
    const logger = {
      warn: vi.fn(),
    };

    await expect(runHostedDeviceSyncRecoverySweep({
      logger,
      runDueReconcileSweeper: vi.fn(async () => buildDueReconcileSweepResult({
        wakeFailed: 1,
      })),
    })).rejects.toThrow("Hosted device-sync due reconcile sweeper failed to request one or more wakes.");

    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync scheduled wake sweep failed.",
      expect.objectContaining({
        dueReconcileWakeRequestFailed: true,
      }),
    );
  });
});

function buildDueReconcileSweepResult(overrides: Partial<{
  dueConnections: number;
  skippedDueConnections: number;
  wakeAccepted: number;
  wakeAttempted: number;
  wakeFailed: number;
  wakeLimit: number;
  wakeNotAccepted: number;
}> = {}) {
  return {
    dueConnections: 1,
    skippedDueConnections: 0,
    wakeAccepted: 1,
    wakeAttempted: 1,
    wakeFailed: 0,
    wakeLimit: 25,
    wakeNotAccepted: 0,
    ...overrides,
  };
}
