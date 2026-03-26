import {
  encodeHostedBundleBase64,
  sha256HostedBundleHex,
  type HostedExecutionBundleKind,
  type HostedExecutionBundleRef,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunnerRequest,
  type HostedExecutionUserStatus,
} from "@healthybob/runtime-state";

import { createHostedBundleStore, type R2BucketLike } from "./bundle-store.js";
import type { HostedExecutionEnvironment } from "./env.js";
import {
  createHostedExecutionJournalStore,
  persistHostedExecutionCommit,
  type HostedExecutionCommittedResult,
  type HostedExecutionCommitPayload,
} from "./execution-journal.js";
import {
  applyHostedUserEnvUpdate,
  listHostedUserEnvKeys,
  readHostedUserEnvFromAgentStateBundle,
  type HostedUserEnvUpdate,
  writeHostedUserEnvToAgentStateBundle,
} from "./user-env.js";

export interface DurableObjectStorageLike {
  deleteAlarm?(): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  getAlarm(): Promise<number | null>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
}

export interface DurableObjectStateLike {
  blockConcurrencyWhile?<T>(callback: () => Promise<T>): Promise<T>;
  storage: DurableObjectStorageLike;
}

interface PendingDispatchRecord {
  attempts: number;
  availableAt: string;
  dispatch: HostedExecutionDispatchRequest;
  enqueuedAt: string;
  lastError: string | null;
}

interface UserRunnerRecord {
  activated: boolean;
  backpressuredEventIds: string[];
  bundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
  consumedEventExpirations: Record<string, string>;
  inFlight: boolean;
  lastError: string | null;
  lastEventId: string | null;
  lastRunAt: string | null;
  nextWakeAt: string | null;
  pendingEvents: PendingDispatchRecord[];
  poisonedEventIds: string[];
  recentEventIds: string[];
  retryingEventId: string | null;
  userId: string;
}

const STORAGE_KEY = "state";
const CONSUMED_EVENT_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_BACKPRESSURED_EVENT_IDS = 16;
const MAX_PENDING_EVENTS = 64;
const MAX_POISONED_EVENT_IDS = 16;
const MAX_RECENT_EVENT_IDS = 64;
const RETRY_MAX_DELAY_MS = 5 * 60_000;

export class HostedUserRunner {
  private readonly commitLocks = new Map<string, Promise<HostedExecutionCommittedResult>>();

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: HostedExecutionEnvironment,
    private readonly bucket: R2BucketLike,
  ) {}

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    const record = await this.readState(input.event.userId);
    const committed = await this.readCommittedDispatch(input.event.userId, input.eventId);

    if (
      committed
      && (
        hasPendingDispatch(record, input.eventId)
        || hasConsumedEvent(record, input.eventId)
        || isCommittedResultFresh(committed)
      )
    ) {
      return toUserStatus(
        hasPendingDispatch(record, input.eventId)
          ? await this.applyCommittedDispatch(record, committed)
          : await this.rememberCommittedEvent(record, input.eventId),
      );
    }

    if (committed) {
      await this.deleteCommittedDispatch(input.event.userId, input.eventId);
    }

    const result = await this.withStateTransition(async () => {
      const record = await this.readState(input.event.userId);

      if (hasSeenEvent(record, input.eventId)) {
        return {
          accepted: false,
          alreadySeen: true,
          record,
        };
      }

      const enqueueResult = enqueuePendingDispatch(record, input);
      const nextRecord = enqueueResult.accepted
        ? await this.scheduleNextWake(enqueueResult.record)
        : enqueueResult.record;
      await this.writeState(nextRecord);

      return {
        accepted: enqueueResult.accepted,
        alreadySeen: false,
        record: nextRecord,
      };
    });

    if (result.alreadySeen || result.record.backpressuredEventIds.includes(input.eventId)) {
      return toUserStatus(result.record);
    }

    return this.runQueuedEvents(result.record.userId);
  }

  async run(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    const record = await this.readState(input.event.userId);
    const committed = await this.readCommittedDispatch(input.event.userId, input.eventId);

    if (
      committed
      && (
        hasPendingDispatch(record, input.eventId)
        || hasConsumedEvent(record, input.eventId)
        || isCommittedResultFresh(committed)
      )
    ) {
      return toUserStatus(
        hasPendingDispatch(record, input.eventId)
          ? await this.applyCommittedDispatch(record, committed)
          : await this.rememberCommittedEvent(record, input.eventId),
      );
    }

    if (committed) {
      await this.deleteCommittedDispatch(input.event.userId, input.eventId);
    }

    const result = await this.withStateTransition(async () => {
      const record = await this.readState(input.event.userId);

      if (hasSeenEvent(record, input.eventId)) {
        return {
          accepted: false,
          alreadySeen: true,
          record,
        };
      }

      const enqueueResult = enqueuePendingDispatch(record, input);
      await this.writeState(enqueueResult.record);

      return {
        accepted: enqueueResult.accepted,
        alreadySeen: false,
        record: enqueueResult.record,
      };
    });

    if (result.alreadySeen || result.record.backpressuredEventIds.includes(input.eventId)) {
      return toUserStatus(result.record);
    }

    return this.runQueuedEvents(result.record.userId);
  }

  async alarm(): Promise<void> {
    const record = await this.withStateTransition(async () => {
      const currentRecord = await this.readState(null);

      if (!currentRecord.activated && currentRecord.pendingEvents.length === 0) {
        return currentRecord;
      }

      if (currentRecord.activated && !hasDuePendingDispatch(currentRecord, Date.now())) {
        const enqueueResult = enqueuePendingDispatch(currentRecord, {
          event: {
            kind: "assistant.cron.tick",
            reason: "alarm",
            userId: currentRecord.userId,
          },
          eventId: `alarm:${Date.now()}`,
          occurredAt: new Date().toISOString(),
        });
        const nextRecord = enqueueResult.accepted
          ? await this.scheduleNextWake(enqueueResult.record)
          : enqueueResult.record;
        await this.writeState(nextRecord);
        return nextRecord;
      }

      return currentRecord;
    });

    if (!record.activated && record.pendingEvents.length === 0) {
      return;
    }

    await this.runQueuedEvents(record.userId);
  }

  async status(userId: string): Promise<HostedExecutionUserStatus> {
    return toUserStatus(await this.readState(userId));
  }

  async getUserEnvStatus(userId: string): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return {
      configuredUserEnvKeys: listHostedUserEnvKeys(await this.readUserEnv(userId)),
      userId,
    };
  }

  async updateUserEnv(
    userId: string,
    update: HostedUserEnvUpdate,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.withStateTransition(async () => {
      let record = await this.readState(userId);
      const store = this.createBundleStore();
      const currentBundle = await store.readBundle(userId, "agent-state");
      const currentUserEnv = readHostedUserEnvFromAgentStateBundle(currentBundle, this.readUserEnvSource());
      const nextUserEnv = applyHostedUserEnvUpdate({
        current: currentUserEnv,
        source: this.readUserEnvSource(),
        update,
      });

      if (currentBundle === null && Object.keys(nextUserEnv).length === 0) {
        return {
          configuredUserEnvKeys: [],
          userId,
        };
      }

      const nextBundle = writeHostedUserEnvToAgentStateBundle({
        agentStateBundle: currentBundle,
        env: nextUserEnv,
      });
      const bundleChanged = currentBundle === null
        || currentBundle.byteLength !== nextBundle.byteLength
        || sha256HostedBundleHex(currentBundle) !== sha256HostedBundleHex(nextBundle);

      if (bundleChanged || record.bundleRefs.agentState === null) {
        const agentStateRef = await this.writeBundleBytes(
          userId,
          "agent-state",
          nextBundle,
          record.bundleRefs.agentState,
        );

        record = {
          ...record,
          bundleRefs: {
            ...record.bundleRefs,
            agentState: agentStateRef,
          },
          userId,
        };
        await this.writeState(record);
      }

      return {
        configuredUserEnvKeys: listHostedUserEnvKeys(nextUserEnv),
        userId,
      };
    });
  }

  async clearUserEnv(userId: string): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.updateUserEnv(userId, {
      env: {},
      mode: "replace",
    });
  }

  async commit(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: {
        agentState: HostedExecutionBundleRef | null;
        vault: HostedExecutionBundleRef | null;
      };
    };
    userId: string;
  }): Promise<HostedExecutionCommittedResult> {
    const existingLock = this.commitLocks.get(input.eventId);

    if (existingLock) {
      return existingLock;
    }

    const commitPromise = this.commitOnce(input).finally(() => {
      this.commitLocks.delete(input.eventId);
    });

    this.commitLocks.set(input.eventId, commitPromise);
    return commitPromise;
  }

  private async runQueuedEvents(userId: string): Promise<HostedExecutionUserStatus> {
    let record = await this.readState(userId);
    const recovered = await this.recoverCommittedPendingDispatch(record);

    if (recovered) {
      record = recovered;
    }

    while (true) {
      const recoveredPending = await this.recoverCommittedPendingDispatch(record);

      if (recoveredPending) {
        record = recoveredPending;
        continue;
      }

      const claim = await this.claimNextDuePendingDispatch(userId);
      const nextPending = claim.pendingDispatch;
      record = claim.record;

      if (!nextPending) {
        return toUserStatus(record);
      }

      try {
        await this.invokeRunner(record, nextPending.dispatch);
        record = await this.requireCommittedDispatch(record.userId, nextPending.dispatch.eventId);
      } catch (error) {
        const committed = await this.readCommittedDispatch(record.userId, nextPending.dispatch.eventId);

        if (committed) {
          record = await this.applyCommittedDispatch(record, committed);
          continue;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        const nextAttempts = nextPending.attempts + 1;

        record = await this.withStateTransition(async () => {
          const latestRecord = await this.readState(record.userId);
          const nextRecordBase = nextAttempts >= this.env.maxEventAttempts
            ? markPendingDispatchPoisoned(latestRecord, nextPending.dispatch.eventId, errorMessage)
            : reschedulePendingDispatch(latestRecord, nextPending.dispatch.eventId, {
                attempts: nextAttempts,
                availableAt: new Date(Date.now() + computeRetryDelayMs(this.env.retryDelayMs, nextAttempts)).toISOString(),
                lastError: errorMessage,
              });

          const nextRecord = await this.scheduleNextWake({
            ...nextRecordBase,
            inFlight: false,
            lastError: errorMessage,
            lastEventId: nextPending.dispatch.eventId,
            retryingEventId: nextAttempts >= this.env.maxEventAttempts
              ? findRetryingEventId(nextRecordBase)
              : nextPending.dispatch.eventId,
          });
          await this.writeState(nextRecord);
          return nextRecord;
        });

        return toUserStatus(record);
      }
    }
  }

  private async claimNextDuePendingDispatch(userId: string): Promise<{
    pendingDispatch: PendingDispatchRecord | null;
    record: UserRunnerRecord;
  }> {
    return this.withStateTransition(async () => {
      let record = await this.readState(userId);

      if (record.inFlight) {
        return {
          pendingDispatch: null,
          record,
        };
      }

      const nextPending = findNextDuePendingDispatch(record, Date.now());

      if (!nextPending) {
        record = await this.scheduleNextWake({
          ...record,
          retryingEventId: findRetryingEventId(record),
        });
        await this.writeState(record);
        return {
          pendingDispatch: null,
          record,
        };
      }

      record = {
        ...record,
        inFlight: true,
        lastError: null,
        retryingEventId: nextPending.attempts > 0 ? nextPending.dispatch.eventId : null,
      };
      await this.writeState(record);
      return {
        pendingDispatch: nextPending,
        record,
      };
    });
  }

  private async invokeRunner(
    record: UserRunnerRecord,
    dispatch: HostedExecutionDispatchRequest,
  ): Promise<void> {
    if (!this.env.cloudflareBaseUrl) {
      throw new Error("HOSTED_EXECUTION_CLOUDFLARE_BASE_URL is not configured.");
    }

    if (!this.env.runnerBaseUrl) {
      throw new Error("HOSTED_EXECUTION_RUNNER_BASE_URL is not configured.");
    }

    const store = this.createBundleStore();
    const requestBody: HostedExecutionRunnerRequest & {
      commit: {
        bundleRefs: UserRunnerRecord["bundleRefs"];
        token: string | null;
        url: string;
      };
    } = {
      bundles: {
        agentState: encodeHostedBundleBase64(await store.readBundle(record.userId, "agent-state")),
        vault: encodeHostedBundleBase64(await store.readBundle(record.userId, "vault")),
      },
      commit: {
        bundleRefs: record.bundleRefs,
        token: this.env.runnerControlToken,
        url: `${this.env.cloudflareBaseUrl}/internal/runner-events/${encodeURIComponent(record.userId)}/${encodeURIComponent(dispatch.eventId)}/commit`,
      },
      dispatch,
    };
    const response = await fetch(`${this.env.runnerBaseUrl}/__internal/run`, {
      body: JSON.stringify(requestBody),
      headers: {
        ...(this.env.runnerControlToken
          ? {
              authorization: `Bearer ${this.env.runnerControlToken}`,
            }
          : {}),
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
      signal: AbortSignal.timeout(this.env.runnerTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Hosted runner returned HTTP ${response.status}.`);
    }
  }

  private async readUserEnv(userId: string): Promise<Record<string, string>> {
    return readHostedUserEnvFromAgentStateBundle(
      await this.createBundleStore().readBundle(userId, "agent-state"),
      this.readUserEnvSource(),
    );
  }

  private async writeBundleBytes(
    userId: string,
    kind: HostedExecutionBundleKind,
    plaintext: Uint8Array,
    currentRef: HostedExecutionBundleRef | null,
  ): Promise<HostedExecutionBundleRef> {
    const hash = sha256HostedBundleHex(plaintext);

    if (currentRef && currentRef.hash === hash && currentRef.size === plaintext.byteLength) {
      return currentRef;
    }

    const ref = await this.createBundleStore().writeBundle(userId, kind, plaintext);

    return {
      ...ref,
      size: ref.size ?? plaintext.byteLength,
    };
  }

  private async scheduleNextWake(record: UserRunnerRecord): Promise<UserRunnerRecord> {
    const nextPending = findNextPendingDispatch(record);
    const nextWakeAt = nextPending
      ? nextPending.availableAt
      : record.activated
        ? new Date(Date.now() + this.env.defaultAlarmDelayMs).toISOString()
        : null;

    if (nextWakeAt) {
      await this.state.storage.setAlarm(new Date(nextWakeAt));
    } else {
      await this.state.storage.deleteAlarm?.();
    }

    return {
      ...record,
      nextWakeAt,
    };
  }

  private async readState(userId: string | null): Promise<UserRunnerRecord> {
    const existing = await this.state.storage.get<UserRunnerRecord>(STORAGE_KEY);

    if (existing) {
      const normalized = normalizeUserRunnerRecord(existing, userId ?? existing.userId ?? "unknown");

      if (normalized.changed) {
        await this.state.storage.put(STORAGE_KEY, normalized.record);
      }

      return normalized.record;
    }

    return {
      activated: false,
      backpressuredEventIds: [],
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      consumedEventExpirations: {},
      inFlight: false,
      lastError: null,
      lastEventId: null,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEvents: [],
      poisonedEventIds: [],
      recentEventIds: [],
      retryingEventId: null,
      userId: userId ?? "unknown",
    };
  }

  private async writeState(record: UserRunnerRecord): Promise<void> {
    await this.state.storage.put(STORAGE_KEY, normalizeUserRunnerRecord(record, record.userId).record);
  }

  private async withStateTransition<T>(callback: () => Promise<T>): Promise<T> {
    if (typeof this.state.blockConcurrencyWhile === "function") {
      return this.state.blockConcurrencyWhile(callback);
    }

    return callback();
  }

  private createBundleStore() {
    return createHostedBundleStore({
      bucket: this.bucket,
      key: this.env.bundleEncryptionKey,
      keyId: this.env.bundleEncryptionKeyId,
    });
  }

  private createJournalStore() {
    return createHostedExecutionJournalStore({
      bucket: this.bucket,
      key: this.env.bundleEncryptionKey,
      keyId: this.env.bundleEncryptionKeyId,
    });
  }

  private async readCommittedDispatch(
    userId: string,
    eventId: string,
  ): Promise<HostedExecutionCommittedResult | null> {
    return this.createJournalStore().readCommittedResult(userId, eventId);
  }

  private async deleteCommittedDispatch(userId: string, eventId: string): Promise<void> {
    await this.createJournalStore().deleteCommittedResult(userId, eventId);
  }

  private async commitOnce(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: {
        agentState: HostedExecutionBundleRef | null;
        vault: HostedExecutionBundleRef | null;
      };
    };
    userId: string;
  }): Promise<HostedExecutionCommittedResult> {
    const existing = await this.readCommittedDispatch(input.userId, input.eventId);

    if (existing) {
      return existing;
    }

    return persistHostedExecutionCommit({
      bucket: this.bucket,
      currentBundleRefs: input.payload.currentBundleRefs,
      eventId: input.eventId,
      key: this.env.bundleEncryptionKey,
      keyId: this.env.bundleEncryptionKeyId,
      payload: input.payload,
      userId: input.userId,
    });
  }

  private async recoverCommittedPendingDispatch(
    record: UserRunnerRecord,
  ): Promise<UserRunnerRecord | null> {
    for (const pending of [...record.pendingEvents].sort(
      (left, right) => Date.parse(left.availableAt) - Date.parse(right.availableAt),
    )) {
      const committed = await this.readCommittedDispatch(record.userId, pending.dispatch.eventId);

      if (committed) {
        return this.applyCommittedDispatch(record, committed);
      }
    }

    return null;
  }

  private async requireCommittedDispatch(
    userId: string,
    eventId: string,
  ): Promise<UserRunnerRecord> {
    const committed = await this.readCommittedDispatch(userId, eventId);

    if (!committed) {
      throw new Error(`Hosted runner returned before recording a durable commit for ${eventId}.`);
    }

    return this.applyCommittedDispatch(await this.readState(userId), committed);
  }

  private async applyCommittedDispatch(
    record: UserRunnerRecord,
    committed: HostedExecutionCommittedResult,
  ): Promise<UserRunnerRecord> {
    return this.withStateTransition(async () => {
      const latestRecord = await this.readState(record.userId);
      const nextRecord = await this.scheduleNextWake({
        ...clearPoisonedEventId(
          markEventConsumed(removePendingDispatch(latestRecord, committed.eventId), committed.eventId),
          committed.eventId,
        ),
        bundleRefs: committed.bundleRefs,
        inFlight: false,
        lastError: null,
        lastEventId: committed.eventId,
        lastRunAt: committed.committedAt,
        recentEventIds: [...latestRecord.recentEventIds, committed.eventId].slice(-MAX_RECENT_EVENT_IDS),
        retryingEventId: null,
      });

      await this.writeState(nextRecord);
      return nextRecord;
    });
  }

  private async rememberCommittedEvent(
    record: UserRunnerRecord,
    eventId: string,
  ): Promise<UserRunnerRecord> {
    return this.withStateTransition(async () => {
      const latestRecord = await this.readState(record.userId);

      if (hasConsumedEvent(latestRecord, eventId)) {
        return latestRecord;
      }

      const nextRecord = {
        ...markEventConsumed(latestRecord, eventId),
        recentEventIds: [...latestRecord.recentEventIds, eventId].slice(-MAX_RECENT_EVENT_IDS),
      };

      await this.writeState(nextRecord);
      return nextRecord;
    });
  }

  private readUserEnvSource(): Readonly<Record<string, string | undefined>> {
    return {
      HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: this.env.allowedUserEnvKeys ?? undefined,
      HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES: this.env.allowedUserEnvPrefixes ?? undefined,
    };
  }
}

function computeRetryDelayMs(baseDelayMs: number, attempts: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, baseDelayMs * (2 ** Math.max(0, attempts - 1)));
}

function normalizeUserRunnerRecord(
  record: Partial<UserRunnerRecord>,
  fallbackUserId: string,
): { changed: boolean; record: UserRunnerRecord } {
  const existingConsumedEventExpirations = record.consumedEventExpirations ?? Object.fromEntries(
    [...(record.recentEventIds ?? []), ...(record.poisonedEventIds ?? [])]
      .map((eventId) => [eventId, new Date(Date.now() + CONSUMED_EVENT_TTL_MS).toISOString()]),
  );
  const consumedEventExpirations = pruneConsumedEventExpirations(existingConsumedEventExpirations);
  const backpressuredEventIds = (record.backpressuredEventIds ?? []).slice(-MAX_BACKPRESSURED_EVENT_IDS);
  const poisonedEventIds = (record.poisonedEventIds ?? [])
    .filter((eventId) => consumedEventExpirations[eventId] !== undefined)
    .slice(-MAX_POISONED_EVENT_IDS);
  const recentEventIds = (record.recentEventIds ?? []).slice(-MAX_RECENT_EVENT_IDS);
  const changed =
    record.backpressuredEventIds === undefined
    || record.consumedEventExpirations === undefined
    || Object.keys(consumedEventExpirations).length !== Object.keys(record.consumedEventExpirations ?? {}).length
    || record.userId === undefined
    || record.poisonedEventIds === undefined
    || record.recentEventIds === undefined
    || backpressuredEventIds.length !== (record.backpressuredEventIds ?? []).length
    || poisonedEventIds.length !== (record.poisonedEventIds ?? []).length
    || recentEventIds.length !== (record.recentEventIds ?? []).length;

  return {
    changed,
    record: {
      activated: record.activated ?? false,
      backpressuredEventIds,
      bundleRefs: record.bundleRefs ?? {
        agentState: null,
        vault: null,
      },
      consumedEventExpirations,
      inFlight: record.inFlight ?? false,
      lastError: record.lastError ?? null,
      lastEventId: record.lastEventId ?? null,
      lastRunAt: record.lastRunAt ?? null,
      nextWakeAt: record.nextWakeAt ?? null,
      pendingEvents: record.pendingEvents ?? [],
      poisonedEventIds,
      recentEventIds,
      retryingEventId: record.retryingEventId ?? null,
      userId: record.userId ?? fallbackUserId,
    },
  };
}

function enqueuePendingDispatch(
  record: UserRunnerRecord,
  dispatch: HostedExecutionDispatchRequest,
): { accepted: boolean; record: UserRunnerRecord } {
  if (hasPendingDispatch(record, dispatch.eventId)) {
    return {
      accepted: true,
      record,
    };
  }

  if (record.pendingEvents.length >= MAX_PENDING_EVENTS) {
    return {
      accepted: false,
      record: {
        ...record,
        backpressuredEventIds: appendBoundedEventId(
          record.backpressuredEventIds,
          dispatch.eventId,
          MAX_BACKPRESSURED_EVENT_IDS,
        ),
      },
    };
  }

  return {
    accepted: true,
    record: {
      ...record,
      activated: record.activated || dispatch.event.kind === "member.activated",
      backpressuredEventIds: record.backpressuredEventIds.filter((eventId) => eventId !== dispatch.eventId),
      lastEventId: dispatch.eventId,
      pendingEvents: [
        ...record.pendingEvents,
        {
          attempts: 0,
          availableAt: new Date().toISOString(),
          dispatch,
          enqueuedAt: new Date().toISOString(),
          lastError: null,
        },
      ],
      userId: dispatch.event.userId,
    },
  };
}

function hasSeenEvent(record: UserRunnerRecord, eventId: string): boolean {
  return hasConsumedEvent(record, eventId) || hasPendingDispatch(record, eventId);
}

function hasPendingDispatch(record: UserRunnerRecord, eventId: string): boolean {
  return record.pendingEvents.some((entry) => entry.dispatch.eventId === eventId);
}

function hasConsumedEvent(record: UserRunnerRecord, eventId: string): boolean {
  return record.consumedEventExpirations[eventId] !== undefined;
}

function markEventConsumed(record: UserRunnerRecord, eventId: string | null): UserRunnerRecord {
  if (!eventId) {
    return record;
  }

  return {
    ...record,
    consumedEventExpirations: {
      ...record.consumedEventExpirations,
      [eventId]: new Date(Date.now() + CONSUMED_EVENT_TTL_MS).toISOString(),
    },
  };
}

function appendPoisonedEventId(record: UserRunnerRecord, eventId: string): UserRunnerRecord {
  return {
    ...record,
    poisonedEventIds: appendBoundedEventId(record.poisonedEventIds, eventId, MAX_POISONED_EVENT_IDS),
  };
}

function clearPoisonedEventId(record: UserRunnerRecord, eventId: string): UserRunnerRecord {
  return {
    ...record,
    poisonedEventIds: record.poisonedEventIds.filter((candidate) => candidate !== eventId),
  };
}

function hasDuePendingDispatch(record: UserRunnerRecord, nowMs: number): boolean {
  return record.pendingEvents.some((entry) => Date.parse(entry.availableAt) <= nowMs);
}

function findNextPendingDispatch(record: UserRunnerRecord): PendingDispatchRecord | null {
  return [...record.pendingEvents]
    .sort((left, right) => Date.parse(left.availableAt) - Date.parse(right.availableAt))[0] ?? null;
}

function findNextDuePendingDispatch(record: UserRunnerRecord, nowMs: number): PendingDispatchRecord | null {
  return [...record.pendingEvents]
    .filter((entry) => Date.parse(entry.availableAt) <= nowMs)
    .sort((left, right) => Date.parse(left.availableAt) - Date.parse(right.availableAt))[0] ?? null;
}

function findRetryingEventId(record: UserRunnerRecord): string | null {
  return record.pendingEvents.find((entry) => entry.attempts > 0)?.dispatch.eventId ?? null;
}

function removePendingDispatch(record: UserRunnerRecord, eventId: string): UserRunnerRecord {
  return {
    ...record,
    backpressuredEventIds: record.backpressuredEventIds.filter((entry) => entry !== eventId),
    pendingEvents: record.pendingEvents.filter((entry) => entry.dispatch.eventId !== eventId),
  };
}

function reschedulePendingDispatch(
  record: UserRunnerRecord,
  eventId: string,
  patch: {
    attempts: number;
    availableAt: string;
    lastError: string;
  },
): UserRunnerRecord {
  return {
    ...record,
    pendingEvents: record.pendingEvents.map((entry) => (
      entry.dispatch.eventId === eventId
        ? {
            ...entry,
            attempts: patch.attempts,
            availableAt: patch.availableAt,
            lastError: patch.lastError,
          }
        : entry
    )),
  };
}

function markPendingDispatchPoisoned(
  record: UserRunnerRecord,
  eventId: string,
  errorMessage: string,
): UserRunnerRecord {
  return markEventConsumed({
    ...appendPoisonedEventId(removePendingDispatch(record, eventId), eventId),
    lastError: errorMessage,
  }, eventId);
}

function appendBoundedEventId(eventIds: readonly string[], eventId: string, limit: number): string[] {
  return [...eventIds.filter((entry) => entry !== eventId), eventId].slice(-limit);
}

function pruneConsumedEventExpirations(
  consumedEventExpirations: Record<string, string>,
): Record<string, string> {
  const nowMs = Date.now();
  const nextEntries = Object.entries(consumedEventExpirations)
    .filter(([, expiresAt]) => {
      const parsedMs = Date.parse(expiresAt);
      return Number.isFinite(parsedMs) && parsedMs > nowMs;
    });

  return Object.fromEntries(nextEntries);
}

function isCommittedResultFresh(committed: HostedExecutionCommittedResult): boolean {
  const committedMs = Date.parse(committed.committedAt);

  return Number.isFinite(committedMs) && (Date.now() - committedMs) < CONSUMED_EVENT_TTL_MS;
}

function toUserStatus(record: UserRunnerRecord): HostedExecutionUserStatus {
  return {
    backpressuredEventIds: record.backpressuredEventIds,
    bundleRefs: record.bundleRefs,
    inFlight: record.inFlight,
    lastError: record.lastError,
    lastEventId: record.lastEventId,
    lastRunAt: record.lastRunAt,
    nextWakeAt: record.nextWakeAt,
    pendingEventCount: record.pendingEvents.length,
    poisonedEventIds: record.poisonedEventIds,
    retryingEventId: record.retryingEventId,
    userId: record.userId,
  };
}
