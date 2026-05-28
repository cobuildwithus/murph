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
        wakeFailed: 1,
        wakeNotAppended: 1,
      })),
      runDueReconcileSweeper: vi.fn(async () => buildDueReconcileSweepResult()),
    })).rejects.toThrow("Hosted device-sync dirty sweeper failed to request one or more recoveries.");

    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync recovery sweep failed.",
      expect.objectContaining({
        dirtyWakeAppendFailed: true,
        dueReconcileWakeAppendFailed: false,
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
        wakeFailed: 1,
      })),
    })).rejects.toThrow("Hosted device-sync due reconcile sweeper failed to request one or more recoveries.");

    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync recovery sweep failed.",
      expect.objectContaining({
        dirtyWakeAppendFailed: false,
        dueReconcileWakeAppendFailed: true,
      }),
    );
  });
});

function buildDirtySweepResult(overrides: Partial<{
  dirtyConnections: number;
  skippedDirtyConnections: number;
  staleAfterMs: number;
  wakeAppended: number;
  wakeAttempted: number;
  wakeDuplicate: number;
  wakeFailed: number;
  wakeLimit: number;
  wakeNotAppended: number;
}> = {}) {
  return {
    dirtyConnections: 1,
    skippedDirtyConnections: 0,
    staleAfterMs: 30_000,
    wakeAppended: 1,
    wakeAttempted: 1,
    wakeDuplicate: 0,
    wakeFailed: 0,
    wakeLimit: 25,
    wakeNotAppended: 0,
    ...overrides,
  };
}

function buildDueReconcileSweepResult(overrides: Partial<{
  dueConnections: number;
  skippedDueConnections: number;
  wakeAppended: number;
  wakeAttempted: number;
  wakeDuplicate: number;
  wakeFailed: number;
  wakeLimit: number;
  wakeNotAppended: number;
}> = {}) {
  return {
    dueConnections: 1,
    skippedDueConnections: 0,
    wakeAppended: 1,
    wakeAttempted: 1,
    wakeDuplicate: 0,
    wakeFailed: 0,
    wakeLimit: 25,
    wakeNotAppended: 0,
    ...overrides,
  };
}
