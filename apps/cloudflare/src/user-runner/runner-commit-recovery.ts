import type { HostedExecutionCommittedResult } from "../execution-journal.js";
import { createHostedExecutionJournalStore, type HostedExecutionJournalStore } from "../execution-journal.js";
import { HostedBundleGarbageCollector } from "../bundle-gc.js";
import { RunnerQueueStore } from "./runner-queue-store.js";
import { RunnerScheduler } from "./runner-scheduler.js";
import type { RunnerStateRecord } from "./types.js";

export interface RecoveredCommittedPendingDispatch {
  committed: HostedExecutionCommittedResult;
  committedEventId: string | null;
  record: RunnerStateRecord;
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

  async recoverCommittedPendingDispatch(
    record: RunnerStateRecord,
  ): Promise<RecoveredCommittedPendingDispatch | null> {
    const pendingDispatches = await this.queueStore.listPendingDispatches();

    for (const pending of pendingDispatches) {
      const committed = await this.readCommittedDispatch(record.userId, pending.eventId);
      if (!committed) {
        continue;
      }

      if (isCommittedResultFinalized(committed)) {
        return {
          committed,
          committedEventId: pending.eventId,
          record: await this.applyCommittedDispatch(record.userId, committed),
        };
      }

      await this.syncCommittedBundlesWithoutConsuming(record.userId, committed);
    }

    return null;
  }

  async requireCommittedDispatch(
    userId: string,
    eventId: string,
  ): Promise<RunnerStateRecord> {
    const committed = await this.readCommittedDispatch(userId, eventId);
    if (!committed) {
      throw new Error("Hosted runner returned before recording a durable commit.");
    }

    return this.applyCommittedDispatch(userId, committed);
  }

  async applyCommittedDispatch(
    userId: string,
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    return this.applyCommittedQueueTransition(
      userId,
      committed,
      () => this.queueStore.applyCommittedDispatch(committed),
    );
  }

  async syncCommittedBundlesWithoutConsuming(
    userId: string,
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    return this.applyCommittedQueueTransition(
      userId,
      committed,
      () => this.queueStore.syncCommittedBundles(committed),
    );
  }

  private async applyCommittedQueueTransition(
    userId: string,
    committed: HostedExecutionCommittedResult,
    apply: () => Promise<RunnerStateRecord>,
  ): Promise<RunnerStateRecord> {
    const previousBundleRefs = (await this.queueStore.readBundleMetaState()).bundleRefs;
    await apply();
    await this.cleanupBundleTransitionBestEffort({
      nextBundleRefs: committed.bundleRefs,
      previousBundleRefs,
      userId,
    });
    return this.scheduler.syncNextWake(committed.result.nextWakeAt ?? null);
  }

  async rescheduleCommittedFinalizeRetry(input: {
    attempts: number;
    committed: HostedExecutionCommittedResult;
    error: unknown;
    retryDelayMs: number;
  }): Promise<RunnerStateRecord> {
    await this.queueStore.rescheduleCommittedFinalizeRetry({
      attempts: input.attempts,
      committed: input.committed,
      error: input.error,
      retryDelayMs: input.retryDelayMs,
    });
    return this.scheduler.syncNextWake(
      input.committed.result.nextWakeAt ?? null,
    );
  }

  private async cleanupBundleTransitionBestEffort(input: {
    nextBundleRefs: HostedExecutionCommittedResult["bundleRefs"];
    previousBundleRefs: HostedExecutionCommittedResult["bundleRefs"];
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
  bucket: import("../bundle-store.js").R2BucketLike;
  bundleEncryptionKey: Uint8Array;
  bundleEncryptionKeyId: string;
  bundleEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
  queueStore: RunnerQueueStore;
  scheduler: RunnerScheduler;
}): RunnerCommitRecovery {
  return new RunnerCommitRecovery(
    input.queueStore,
    input.scheduler,
    createHostedExecutionJournalStore({
      bucket: input.bucket,
      key: input.bundleEncryptionKey,
      keyId: input.bundleEncryptionKeyId,
      keysById: input.bundleEncryptionKeysById,
    }),
    new HostedBundleGarbageCollector(
      input.bucket,
      input.bundleEncryptionKey,
      input.bundleEncryptionKeyId,
      input.bundleEncryptionKeysById,
    ),
  );
}

export function isCommittedResultFinalized(committed: HostedExecutionCommittedResult): boolean {
  return committed.finalizedAt !== null;
}

export function isCommittedResultFresh(
  committed: HostedExecutionCommittedResult,
  ttlMs: number,
): boolean {
  const committedMs = Date.parse(committed.committedAt);
  return Number.isFinite(committedMs) && (Date.now() - committedMs) < ttlMs;
}
