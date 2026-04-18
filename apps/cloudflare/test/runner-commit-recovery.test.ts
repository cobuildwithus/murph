import type { HostedExecutionRunContext } from "@murphai/hosted-execution";
import { describe, expect, it, vi } from "vitest";

import { HostedBundleGarbageCollector } from "../src/bundle-gc.js";
import type {
  HostedExecutionCommittedResult,
  HostedExecutionJournalStore,
} from "../src/execution-journal.js";
import { RunnerCommitRecovery } from "../src/user-runner/runner-commit-recovery.js";
import { RunnerQueueStore } from "../src/user-runner/runner-queue-store.js";
import { RunnerScheduler } from "../src/user-runner/runner-scheduler.js";
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
    backpressuredEventIds: [],
    bundleRef: null,
    bundleVersion: 1,
    inFlight: false,
    lastError: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastEventId: null,
    lastRunAt: null,
    nextPendingAvailableAt: null,
    nextWakeAt: null,
    pendingEventCount: 0,
    poisonedEventIds: [],
    retryingEventId: null,
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

  const queueStore: RunnerQueueStore = Object.create(RunnerQueueStore.prototype);
  queueStore.readBundleMetaState = readBundleMetaState;
  queueStore.syncCommittedBundles = syncCommittedBundles;

  const scheduler: RunnerScheduler = Object.create(RunnerScheduler.prototype);
  scheduler.syncNextWake = syncNextWake;

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
    queueStore,
    readBundleMetaState,
    recovery: new RunnerCommitRecovery(
      queueStore,
      scheduler,
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

    const result = await harness.recovery.syncCommittedBundlesWithoutConsuming(
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

    await harness.recovery.syncCommittedBundlesWithoutConsuming(
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

    await harness.recovery.syncCommittedBundlesWithoutConsuming(
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
