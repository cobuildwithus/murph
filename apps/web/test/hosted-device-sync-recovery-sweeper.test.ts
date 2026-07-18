import { describe, expect, it, vi } from "vitest";

import {
  runHostedDeviceSyncRecoverySweep,
} from "@/src/lib/device-sync/recovery-sweeper";

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
      runDueReconcileSweeper: dueReconcileSweeper,
      runPreferenceHandoffSweeper: preferenceHandoffSweeper,
    })).resolves.toEqual({
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

  it("fails the command when due-reconcile wake handoff is not accepted", async () => {
    const logger = {
      warn: vi.fn(),
    };
    const preferenceHandoffSweeper = vi.fn(async () =>
      buildPreferenceHandoffSweepResult()
    );

    await expect(runHostedDeviceSyncRecoverySweep({
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
