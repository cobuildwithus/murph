import type { HostedExecutionCommittedResult } from "../execution-journal.js";
import { createHostedExecutionJournalStore, type HostedExecutionJournalStore } from "../execution-journal.js";
import { RunnerQueueStore } from "./runner-queue-store.js";
import { RunnerScheduler } from "./runner-scheduler.js";
import type { RunnerStateRecord } from "./types.js";

export class RunnerCommitRecovery {
  constructor(
    private readonly queueStore: RunnerQueueStore,
    private readonly scheduler: RunnerScheduler,
    private readonly journalStore: HostedExecutionJournalStore,
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

  async recoverCommittedPendingDispatch(record: RunnerStateRecord): Promise<RunnerStateRecord | null> {
    const pendingDispatches = await this.queueStore.listPendingDispatches(record.userId);

    for (const pending of pendingDispatches) {
      const committed = await this.readCommittedDispatch(record.userId, pending.eventId);
      if (!committed) {
        continue;
      }

      if (isCommittedResultFinalized(committed)) {
        return this.applyCommittedDispatch(record.userId, committed);
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
      throw new Error(`Hosted runner returned before recording a durable commit for ${eventId}.`);
    }

    return this.applyCommittedDispatch(userId, committed);
  }

  async applyCommittedDispatch(
    userId: string,
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    await this.queueStore.applyCommittedDispatch(userId, committed);
    return this.scheduler.syncNextWake(userId, committed.result.nextWakeAt ?? null);
  }

  async syncCommittedBundlesWithoutConsuming(
    userId: string,
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    await this.queueStore.syncCommittedBundles(userId, committed);
    return this.scheduler.syncNextWake(userId, committed.result.nextWakeAt ?? null);
  }

  async rescheduleCommittedFinalizeRetry(input: {
    attempts: number;
    committed: HostedExecutionCommittedResult;
    errorMessage: string;
    retryDelayMs: number;
    userId: string;
  }): Promise<RunnerStateRecord> {
    await this.queueStore.rescheduleCommittedFinalizeRetry({
      attempts: input.attempts,
      committed: input.committed,
      errorMessage: input.errorMessage,
      retryDelayMs: input.retryDelayMs,
      userIdHint: input.userId,
    });
    return this.scheduler.syncNextWake(
      input.userId,
      input.committed.result.nextWakeAt ?? null,
    );
  }
}

export function createRunnerCommitRecovery(input: {
  bucket: import("../bundle-store.js").R2BucketLike;
  bundleEncryptionKey: Uint8Array;
  bundleEncryptionKeyId: string;
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
    }),
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
