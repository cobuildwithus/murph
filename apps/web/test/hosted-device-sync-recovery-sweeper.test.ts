import { describe, expect, it, vi } from "vitest";

import {
  runHostedDeviceSyncRecoverySweep,
} from "@/src/lib/device-sync/recovery-sweeper";

describe("hosted device-sync recovery sweeper", () => {
  it("runs dirty and due-reconcile recovery sweeps as one retryable command", async () => {
    const dirtySweeper = vi.fn(async () => buildDirtySweepResult());
    const dueReconcileSweeper = vi.fn(async () => buildDueReconcileSweepResult());

    await expect(runHostedDeviceSyncRecoverySweep({
      runDirtySweeper: dirtySweeper,
      runDueReconcileSweeper: dueReconcileSweeper,
    })).resolves.toEqual({
      dueReconcileSweeper: buildDueReconcileSweepResult(),
      sweeper: buildDirtySweepResult(),
    });

    expect(dirtySweeper).toHaveBeenCalledTimes(1);
    expect(dueReconcileSweeper).toHaveBeenCalledTimes(1);
  });

  it("fails the command when dirty recovery cannot request effective work", async () => {
    const logger = {
      warn: vi.fn(),
    };

    await expect(runHostedDeviceSyncRecoverySweep({
      logger,
      runDirtySweeper: vi.fn(async () => buildDirtySweepResult({
        recoveryFailed: 1,
        recoveryNotRequested: 1,
      })),
      runDueReconcileSweeper: vi.fn(async () => buildDueReconcileSweepResult()),
    })).rejects.toThrow("Hosted device-sync dirty sweeper failed to request one or more recoveries.");

    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync recovery sweep failed.",
      expect.objectContaining({
        dirtyRecoveryRequestFailed: true,
        dueReconcileRecoveryRequestFailed: false,
      }),
    );
  });

  it("fails the command when due-reconcile recovery cannot signal accepted recovery", async () => {
    const logger = {
      warn: vi.fn(),
    };

    await expect(runHostedDeviceSyncRecoverySweep({
      logger,
      runDirtySweeper: vi.fn(async () => buildDirtySweepResult()),
      runDueReconcileSweeper: vi.fn(async () => buildDueReconcileSweepResult({
        recoveryFailed: 1,
      })),
    })).rejects.toThrow("Hosted device-sync due reconcile sweeper failed to request one or more recoveries.");

    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync recovery sweep failed.",
      expect.objectContaining({
        dirtyRecoveryRequestFailed: false,
        dueReconcileRecoveryRequestFailed: true,
      }),
    );
  });
});

function buildDirtySweepResult(overrides: Partial<{
  dirtyConnections: number;
  dirtyUsers: number;
  recoveryAttempted: number;
  recoveryFailed: number;
  recoveryLimit: number;
  recoveryNotRequested: number;
  recoveryRequested: number;
  skippedDirtyUsers: number;
  staleAfterMs: number;
}> = {}) {
  return {
    dirtyConnections: 1,
    dirtyUsers: 1,
    recoveryAttempted: 1,
    recoveryFailed: 0,
    recoveryLimit: 25,
    recoveryNotRequested: 0,
    recoveryRequested: 1,
    skippedDirtyUsers: 0,
    staleAfterMs: 30_000,
    ...overrides,
  };
}

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
