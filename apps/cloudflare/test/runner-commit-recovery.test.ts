import type { HostedExecutionRunContext } from "@murphai/hosted-execution";
import { describe, expect, it, vi } from "vitest";

import { HostedBundleGarbageCollector } from "../src/bundle-gc.js";
import type {
  HostedExecutionCommittedResult,
  HostedExecutionJournalStore,
} from "../src/execution-journal.js";
import { RunnerCommitRecovery } from "../src/user-runner/runner-commit-recovery.js";
import { RunnerStateStore } from "../src/user-runner/runner-state-store.js";
import { RunnerWakeScheduler } from "../src/user-runner/runner-wake-scheduler.js";
import type { RunnerStateRecord } from "../src/user-runner/types.js";

function createCommittedResult(): HostedExecutionCommittedResult {
  return {
    assistantDeliveryEffects: [],
    bundleRef: null,
    committedAt: "2026-04-14T12:00:00.000Z",
    eventId: "evt_commit_recovery",
    finalizedAt: null,
    gatewayProjectionSnapshot: null,
    result: {
      eventsHandled: 1,
      nextWakeAt: null,
      summary: "ok",
    },
    userId: "user_commit_recovery",
  };
}

function createRunnerStateRecord(): RunnerStateRecord {
  return {
    runtimeBootstrapped: true,
    bundleRef: null,
    bundleVersion: 1,
    inFlight: false,
    lastError: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastEventId: null,
    lastRunAt: null,
    nextWakeAt: null,
    pendingWakeCount: 0,
    run: null,
    timeline: [],
    userId: "user_commit_recovery",
  };
}

function createCommitRecoveryHarness() {
  const queueRecord = createRunnerStateRecord();
  const syncedRecord = createRunnerStateRecord();
  const readBundleMetaState = vi.fn().mockResolvedValue({
    bundleRef: null,
    bundleVersion: 1,
    inFlight: true,
    userId: queueRecord.userId,
  });
  const syncCommittedBundles = vi.fn().mockResolvedValue(queueRecord);
  const syncNextWake = vi.fn().mockResolvedValue(syncedRecord);
  const cleanupBundleTransition = vi.fn().mockResolvedValue(undefined);

  const stateStore: RunnerStateStore = Object.create(RunnerStateStore.prototype);
  stateStore.readBundleMetaState = readBundleMetaState;
  stateStore.syncCommittedBundles = syncCommittedBundles;

  const wakeScheduler: RunnerWakeScheduler = Object.create(RunnerWakeScheduler.prototype);
  wakeScheduler.syncNextWake = syncNextWake;

  const journalStore: HostedExecutionJournalStore = {
    deleteCommittedResult: vi.fn().mockResolvedValue(undefined),
    readCommittedResult: vi.fn().mockResolvedValue(null),
    writeCommittedResult: vi.fn().mockResolvedValue(undefined),
  };

  const garbageCollector: HostedBundleGarbageCollector = Object.create(
    HostedBundleGarbageCollector.prototype,
  );
  garbageCollector.cleanupBundleTransition = cleanupBundleTransition;

  return {
    cleanupBundleTransition,
    journalStore,
    stateStore,
    readBundleMetaState,
    recovery: new RunnerCommitRecovery(
      stateStore,
      wakeScheduler,
      journalStore,
      garbageCollector,
    ),
    syncCommittedBundles,
    syncNextWake,
    syncedRecord,
  };
}

describe("RunnerCommitRecovery", () => {
  it("defaults committed bundle sync recovery to a same-event lease when no run is available", async () => {
    const committed = createCommittedResult();
    const harness = createCommitRecoveryHarness();

    const result = await harness.recovery.syncCommittedWakeBundlesWithoutConsuming(
      committed.userId,
      committed,
    );

    expect(harness.syncCommittedBundles).toHaveBeenCalledTimes(1);
    expect(harness.syncCommittedBundles).toHaveBeenCalledWith(
      committed,
      {
        eventId: committed.eventId,
        policy: "same-event",
        run: null,
      },
    );
    expect(result).toBe(harness.syncedRecord);
  });

  it("treats an explicit null run lease the same as missing lease metadata", async () => {
    const committed = createCommittedResult();
    const harness = createCommitRecoveryHarness();

    await harness.recovery.syncCommittedWakeBundlesWithoutConsuming(
      committed.userId,
      committed,
      { run: null },
    );

    expect(harness.syncCommittedBundles).toHaveBeenCalledWith(
      committed,
      {
        eventId: committed.eventId,
        policy: "same-event",
        run: null,
      },
    );
  });

  it("preserves matching-run recovery when a live run context is still available", async () => {
    const committed = createCommittedResult();
    const harness = createCommitRecoveryHarness();
    const run: HostedExecutionRunContext = {
      attempt: 2,
      runId: "run_commit_recovery",
      startedAt: "2026-04-14T12:00:01.000Z",
    };

    await harness.recovery.syncCommittedWakeBundlesWithoutConsuming(
      committed.userId,
      committed,
      { run },
    );

    expect(harness.syncCommittedBundles).toHaveBeenCalledWith(
      committed,
      {
        eventId: committed.eventId,
        run,
      },
    );
  });
});
