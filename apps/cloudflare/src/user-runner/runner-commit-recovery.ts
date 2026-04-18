import type { HostedExecutionRunContext } from "@murphai/hosted-execution";

import type { R2BucketLike } from "../bundle-store.js";
import type { HostedExecutionCommittedResult } from "../execution-journal.js";
import { createHostedExecutionJournalStore, type HostedExecutionJournalStore } from "../execution-journal.js";
import { HostedBundleGarbageCollector } from "../bundle-gc.js";
import { RunnerQueueStore } from "./runner-queue-store.js";
import { RunnerScheduler } from "./runner-scheduler.js";
import type { RunnerStateRecord } from "./types.js";

interface CommitLeaseOwner {
  policy?: "matching-run" | "same-event";
  run: HostedExecutionRunContext | null;
}

// Recovered durable commits may outlive the original run context, but they
// still own the event-specific lease that must be cleared before the queue can
// resume work.
function resolveCommitLeaseOwner(
  eventId: string,
  leaseOwner: CommitLeaseOwner | null,
): {
  eventId: string;
  policy?: "matching-run" | "same-event";
  run: HostedExecutionRunContext | null;
} {
  if (!leaseOwner || (leaseOwner.run === null && leaseOwner.policy === undefined)) {
    return {
      eventId,
      policy: "same-event",
      run: null,
    };
  }

  return {
    eventId,
    policy: leaseOwner.policy,
    run: leaseOwner.run,
  };
}

export class RunnerCommitRecovery {
  constructor(
    private readonly queueStore: RunnerQueueStore,
    private readonly scheduler: RunnerScheduler,
    private readonly journalStore: HostedExecutionJournalStore,
    private readonly garbageCollector: HostedBundleGarbageCollector,
  ) {}

  async readCommittedDispatch(
    userId: string,
    eventId: string,
  ): Promise<HostedExecutionCommittedResult | null> {
    return this.journalStore.readCommittedResult(userId, eventId);
  }

  async deleteCommittedDispatch(userId: string, eventId: string): Promise<void> {
    await this.journalStore.deleteCommittedResult(userId, eventId);
  }

  async syncCommittedBundlesWithoutConsuming(
    userId: string,
    committed: HostedExecutionCommittedResult,
    leaseOwner: CommitLeaseOwner | null = null,
  ): Promise<RunnerStateRecord> {
    return this.applyCommittedQueueTransition(
      userId,
      committed,
      () => this.queueStore.syncCommittedBundles(
        committed,
        resolveCommitLeaseOwner(committed.eventId, leaseOwner),
      ),
    );
  }

  private async applyCommittedQueueTransition(
    userId: string,
    committed: HostedExecutionCommittedResult,
    apply: () => Promise<RunnerStateRecord>,
  ): Promise<RunnerStateRecord> {
    const previousBundleRef = (await this.queueStore.readBundleMetaState()).bundleRef;
    await apply();
    await this.cleanupBundleTransitionBestEffort({
      nextBundleRef: committed.bundleRef,
      previousBundleRef,
      userId,
    });
    return this.scheduler.syncNextWake(committed.result.nextWakeAt ?? null);
  }

  private async cleanupBundleTransitionBestEffort(input: {
    nextBundleRef: HostedExecutionCommittedResult["bundleRef"];
    previousBundleRef: HostedExecutionCommittedResult["bundleRef"];
    userId: string;
  }): Promise<void> {
    try {
      await this.garbageCollector.cleanupBundleTransition(input);
    } catch {
      // Best-effort cleanup only; do not fail committed-result recovery.
    }
  }
}

export function createRunnerCommitRecovery(input: {
  bucket: R2BucketLike;
  platformEnvelopeKey: Uint8Array;
  platformEnvelopeKeyId: string;
  platformEnvelopeKeysById: Readonly<Record<string, Uint8Array>>;
  queueStore: RunnerQueueStore;
  scheduler: RunnerScheduler;
}): RunnerCommitRecovery {
  return new RunnerCommitRecovery(
    input.queueStore,
    input.scheduler,
    createHostedExecutionJournalStore({
      bucket: input.bucket,
      key: input.platformEnvelopeKey,
      keyId: input.platformEnvelopeKeyId,
      keysById: input.platformEnvelopeKeysById,
    }),
    new HostedBundleGarbageCollector(
      input.bucket,
      input.platformEnvelopeKey,
      input.platformEnvelopeKeyId,
      input.platformEnvelopeKeysById,
    ),
  );
}

export function isCommittedResultFinalized(committed: HostedExecutionCommittedResult): boolean {
  return committed.finalizedAt !== null;
}
