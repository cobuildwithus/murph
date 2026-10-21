import { describe, expect, it, vi } from "vitest";

import {
  runHostedDeviceSyncRecoverySweep,
} from "@/src/lib/device-sync/recovery-sweeper";

const deferredWakeSweeper = async () => buildDeferredWakeSweepResult();

describe("hosted device-sync scheduled wake sweeper", () => {
  it("runs due-reconcile wake handoff as one retryable command", async () => {
    const dueReconcileSweeper = vi.fn(async () => buildDueReconcileSweepResult());
    const preferenceHandoffSweeper = vi.fn(async () => ({
      candidateUsers: 1,
      handoffAccepted: 1,
      handoffAttempted: 1,
      handoffFailed: 0,
      handoffLimit: 25,
      handoffSkippedInactive: 0,
      skippedCandidateUsers: 0,
    }));

    await expect(runHostedDeviceSyncRecoverySweep({
      runDeferredWakeSweeper: deferredWakeSweeper,
      runDueReconcileSweeper: dueReconcileSweeper,
      runPreferenceHandoffSweeper: preferenceHandoffSweeper,
    })).resolves.toEqual({
      deferredWakeSweeper: buildDeferredWakeSweepResult(),
      dueReconcileSweeper: buildDueReconcileSweepResult(),
      preferenceHandoffSweeper: {
        candidateUsers: 1,
        handoffAccepted: 1,
        handoffAttempted: 1,
        handoffFailed: 0,
        handoffLimit: 25,
        handoffSkippedInactive: 0,
        skippedCandidateUsers: 0,
      },
    });

    expect(dueReconcileSweeper).toHaveBeenCalledTimes(1);
    expect(preferenceHandoffSweeper).toHaveBeenCalledTimes(1);
  });

  it("releases deferred routine wakes before the scheduled sweep", async () => {
    const order: string[] = [];
    await runHostedDeviceSyncRecoverySweep({
      runDeferredWakeSweeper: async () => {
        order.push("deferred");
        return buildDeferredWakeSweepResult();
      },
      runDueReconcileSweeper: async () => {
        order.push("due");
        return buildDueReconcileSweepResult();
      },
      runPreferenceHandoffSweeper: async () => buildPreferenceHandoffSweepResult(),
    });
    expect(order).toEqual(["deferred", "due"]);
  });

  it("fails the retryable command after the other sweeps when a deferred release fails", async () => {
    const logger = { warn: vi.fn() };
    const dueReconcileSweeper = vi.fn(async () => buildDueReconcileSweepResult());
    const preferenceHandoffSweeper = vi.fn(async () => buildPreferenceHandoffSweepResult());

    await expect(runHostedDeviceSyncRecoverySweep({
      logger,
      runDeferredWakeSweeper: async () => buildDeferredWakeSweepResult({ releaseFailed: 1 }),
      runDueReconcileSweeper: dueReconcileSweeper,
      runPreferenceHandoffSweeper: preferenceHandoffSweeper,
    })).rejects.toThrow("Hosted device-sync deferred wake sweep failed to release one or more wakes.");

    expect(dueReconcileSweeper).toHaveBeenCalledOnce();
    expect(preferenceHandoffSweeper).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      "Hosted device-sync deferred wake sweep failed.",
      expect.objectContaining({ errorCode: "HOSTED_DEVICE_SYNC_DEFERRED_WAKE_SWEEP_FAILED" }),
    );
  });

  it("does not retry benign skipped wakes when the due sweep reports no failures", async () => {
    const logger = { warn: vi.fn() };
    await expect(runHostedDeviceSyncRecoverySweep({
      runDeferredWakeSweeper: deferredWakeSweeper,
      logger,
      runDueReconcileSweeper: async () => buildDueReconcileSweepResult({
        wakeAccepted: 0, wakeNotAccepted: 1, wakeFailed: 0,
      }),
      runPreferenceHandoffSweeper: async () => buildPreferenceHandoffSweepResult(),
    })).resolves.toMatchObject({ dueReconcileSweeper: { wakeNotAccepted: 1, wakeFailed: 0 } });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("fails the command when due-reconcile wake handoff is not accepted", async () => {
    const logger = {
      warn: vi.fn(),
    };
    const preferenceHandoffSweeper = vi.fn(async () =>
      buildPreferenceHandoffSweepResult()
    );

    await expect(runHostedDeviceSyncRecoverySweep({
      runDeferredWakeSweeper: deferredWakeSweeper,
      logger,
      runPreferenceHandoffSweeper: preferenceHandoffSweeper,
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
    expect(preferenceHandoffSweeper).toHaveBeenCalledTimes(1);
  });

  it("still runs preference handoff recovery when the device-sync sweep throws", async () => {
    const preferenceHandoffSweeper = vi.fn(async () =>
      buildPreferenceHandoffSweepResult()
    );

    await expect(runHostedDeviceSyncRecoverySweep({
      runDeferredWakeSweeper: deferredWakeSweeper,
      logger: { warn: vi.fn() },
      runDueReconcileSweeper: vi.fn(async () => {
        throw new Error("device-sync unavailable");
      }),
      runPreferenceHandoffSweeper: preferenceHandoffSweeper,
    })).rejects.toThrow("device-sync unavailable");

    expect(preferenceHandoffSweeper).toHaveBeenCalledTimes(1);
  });

  it("fails the retryable command when a preference handoff is missed", async () => {
    await expect(runHostedDeviceSyncRecoverySweep({
      runDeferredWakeSweeper: deferredWakeSweeper,
      logger: { warn: vi.fn() },
      runDueReconcileSweeper: vi.fn(async () => buildDueReconcileSweepResult()),
      runPreferenceHandoffSweeper: vi.fn(async () =>
        buildPreferenceHandoffSweepResult({ handoffFailed: 1 })
      ),
    })).rejects.toThrow("Hosted preference mailbox handoff recovery failed.");
  });
});

function buildDueReconcileSweepResult(overrides: Partial<{
  dueConnections: number;
  hasMoreDueConnections: boolean;
  wakeAccepted: number;
  wakeAttempted: number;
  wakeFailed: number;
  wakeLimit: number;
  wakeNotAccepted: number;
}> = {}) {
  return {
    dueConnections: 1,
    hasMoreDueConnections: false,
    wakeAccepted: 1,
    wakeAttempted: 1,
    wakeFailed: 0,
    wakeLimit: 100,
    wakeNotAccepted: 0,
    ...overrides,
  };
}

function buildPreferenceHandoffSweepResult(overrides: Partial<{
  candidateUsers: number;
  handoffAccepted: number;
  handoffAttempted: number;
  handoffFailed: number;
  handoffLimit: number;
  handoffSkippedInactive: number;
  skippedCandidateUsers: number;
}> = {}) {
  return {
    candidateUsers: 1,
    handoffAccepted: 1,
    handoffAttempted: 1,
    handoffFailed: 0,
    handoffLimit: 25,
    handoffSkippedInactive: 0,
    skippedCandidateUsers: 0,
    ...overrides,
  };
}

function buildDeferredWakeSweepResult(
  overrides: Partial<{
    dueConnections: number;
    hasMoreDueConnections: boolean;
    releaseCleared: number;
    releaseFailed: number;
    releaseLimit: number;
    released: number;
  }> = {},
) {
  return {
    dueConnections: 0,
    hasMoreDueConnections: false,
    releaseCleared: 0,
    releaseFailed: 0,
    releaseLimit: 100,
    released: 0,
    ...overrides,
  };
}
