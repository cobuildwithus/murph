import { describe, expect, it, vi } from "vitest";

import {
  runHostedDeviceSyncRecoverySweep,
} from "@/src/lib/device-sync/recovery-sweeper";

describe("hosted device-sync recovery sweeper", () => {
  it("runs due-reconcile recovery as one retryable command", async () => {
    const dueReconcileSweeper = vi.fn(async () => buildDueReconcileSweepResult());

    await expect(runHostedDeviceSyncRecoverySweep({
      runDueReconcileSweeper: dueReconcileSweeper,
    })).resolves.toEqual({
      dueReconcileSweeper: buildDueReconcileSweepResult(),
    });

    expect(dueReconcileSweeper).toHaveBeenCalledTimes(1);
  });

  it("fails the command when due-reconcile recovery cannot signal accepted recovery", async () => {
    const logger = {
      warn: vi.fn(),
    };

    await expect(runHostedDeviceSyncRecoverySweep({
      logger,
      runDueReconcileSweeper: vi.fn(async () => buildDueReconcileSweepResult({
        recoveryFailed: 1,
      })),
    })).rejects.toThrow("Hosted device-sync due reconcile sweeper failed to request one or more recoveries.");

    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync recovery sweep failed.",
      expect.objectContaining({
        dueReconcileRecoveryRequestFailed: true,
      }),
    );
  });
});

function buildDueReconcileSweepResult(overrides: Partial<{
  dueConnections: number;
  recoveryAttempted: number;
  recoveryFailed: number;
  recoveryLimit: number;
  recoveryNotRequested: number;
  recoveryRequested: number;
  skippedDueConnections: number;
}> = {}) {
  return {
    dueConnections: 1,
    recoveryAttempted: 1,
    recoveryFailed: 0,
    recoveryLimit: 25,
    recoveryNotRequested: 0,
    recoveryRequested: 1,
    skippedDueConnections: 0,
    ...overrides,
  };
}
