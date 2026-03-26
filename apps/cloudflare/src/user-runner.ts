import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  type HostedExecutionBundleKind,
  type HostedExecutionBundleRef,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunnerRequest,
  type HostedExecutionRunnerResult,
  type HostedExecutionUserStatus,
} from "@healthybob/runtime-state";

import { createHostedBundleStore, type R2BucketLike } from "./bundle-store.js";
import type { HostedExecutionEnvironment } from "./env.js";

export interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
}

export interface DurableObjectStateLike {
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
  bundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
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
const MAX_PENDING_EVENTS = 64;
const MAX_POISONED_EVENT_IDS = 16;
const MAX_RECENT_EVENT_IDS = 64;
const RETRY_MAX_DELAY_MS = 5 * 60_000;

export class HostedUserRunner {
  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: HostedExecutionEnvironment,
    private readonly bucket: R2BucketLike,
  ) {}

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    let record = await this.readState(input.event.userId);

    if (hasSeenEvent(record, input.eventId)) {
      return toUserStatus(record);
    }

    record = enqueuePendingDispatch(record, input);
    await this.writeState(await this.scheduleNextWake(record));

    return this.runQueuedEvents(record.userId);
  }

  async run(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    let record = await this.readState(input.event.userId);

    if (!hasSeenEvent(record, input.eventId)) {
      record = enqueuePendingDispatch(record, input);
      await this.writeState(record);
    }

    return this.runQueuedEvents(record.userId);
  }

  async alarm(): Promise<void> {
    let record = await this.readState(null);

    if (!record.activated && record.pendingEvents.length === 0) {
      return;
    }

    if (record.activated && !hasDuePendingDispatch(record, Date.now())) {
      record = enqueuePendingDispatch(record, {
        event: {
          kind: "assistant.cron.tick",
          reason: "alarm",
          userId: record.userId,
        },
        eventId: `alarm:${Date.now()}`,
        occurredAt: new Date().toISOString(),
      });
      await this.writeState(record);
    }

    await this.runQueuedEvents(record.userId);
  }

  async status(userId: string): Promise<HostedExecutionUserStatus> {
    return toUserStatus(await this.readState(userId));
  }

  private async runQueuedEvents(userId: string): Promise<HostedExecutionUserStatus> {
    let record = await this.readState(userId);

    if (record.inFlight) {
      return toUserStatus(record);
    }

    while (true) {
      const nextPending = findNextDuePendingDispatch(record, Date.now());

      if (!nextPending) {
        record = await this.scheduleNextWake({
          ...record,
          retryingEventId: findRetryingEventId(record),
        });
        await this.writeState(record);
        return toUserStatus(record);
      }

      record = {
        ...record,
        inFlight: true,
        lastError: null,
        retryingEventId: nextPending.attempts > 0 ? nextPending.dispatch.eventId : null,
      };
      await this.writeState(record);

      try {
        const result = await this.invokeRunner(record, nextPending.dispatch);
        record = await this.scheduleNextWake({
          ...removePendingDispatch(record, nextPending.dispatch.eventId),
          bundleRefs: {
            agentState: result.bundles.agentState
              ? await this.writeBundle(record.userId, "agent-state", result.bundles.agentState)
              : record.bundleRefs.agentState,
            vault: result.bundles.vault
              ? await this.writeBundle(record.userId, "vault", result.bundles.vault)
              : record.bundleRefs.vault,
          },
          inFlight: false,
          lastError: null,
          lastEventId: nextPending.dispatch.eventId,
          lastRunAt: new Date().toISOString(),
          recentEventIds: [...record.recentEventIds, nextPending.dispatch.eventId].slice(-MAX_RECENT_EVENT_IDS),
          retryingEventId: null,
        });
        await this.writeState(record);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const nextAttempts = nextPending.attempts + 1;

        record = nextAttempts >= this.env.maxEventAttempts
          ? markPendingDispatchPoisoned(record, nextPending.dispatch.eventId, errorMessage)
          : reschedulePendingDispatch(record, nextPending.dispatch.eventId, {
              attempts: nextAttempts,
              availableAt: new Date(Date.now() + computeRetryDelayMs(this.env.retryDelayMs, nextAttempts)).toISOString(),
              lastError: errorMessage,
            });

        record = await this.scheduleNextWake({
          ...record,
          inFlight: false,
          lastError: errorMessage,
          lastEventId: nextPending.dispatch.eventId,
          retryingEventId: nextAttempts >= this.env.maxEventAttempts
            ? findRetryingEventId(record)
            : nextPending.dispatch.eventId,
        });
        await this.writeState(record);
        return toUserStatus(record);
      }
    }
  }

  private async invokeRunner(
    record: UserRunnerRecord,
    dispatch: HostedExecutionDispatchRequest,
  ): Promise<HostedExecutionRunnerResult> {
    if (!this.env.runnerBaseUrl) {
      throw new Error("HOSTED_EXECUTION_RUNNER_BASE_URL is not configured.");
    }

    const store = createHostedBundleStore({
      bucket: this.bucket,
      key: this.env.bundleEncryptionKey,
      keyId: this.env.bundleEncryptionKeyId,
    });
    const requestBody: HostedExecutionRunnerRequest = {
      bundles: {
        agentState: encodeHostedBundleBase64(await store.readBundle(record.userId, "agent-state")),
        vault: encodeHostedBundleBase64(await store.readBundle(record.userId, "vault")),
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
    });

    if (!response.ok) {
      throw new Error(`Hosted runner returned HTTP ${response.status}.`);
    }

    return (await response.json()) as HostedExecutionRunnerResult;
  }

  private async writeBundle(
    userId: string,
    kind: HostedExecutionBundleKind,
    value: string,
  ): Promise<HostedExecutionBundleRef> {
    const store = createHostedBundleStore({
      bucket: this.bucket,
      key: this.env.bundleEncryptionKey,
      keyId: this.env.bundleEncryptionKeyId,
    });
    const plaintext = decodeHostedBundleBase64(value) ?? new Uint8Array();
    const ref = await store.writeBundle(userId, kind, plaintext);

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
    }

    return {
      ...record,
      nextWakeAt,
    };
  }

  private async readState(userId: string | null): Promise<UserRunnerRecord> {
    const existing = await this.state.storage.get<UserRunnerRecord>(STORAGE_KEY);

    if (existing) {
      return existing;
    }

    return {
      activated: false,
      bundleRefs: {
        agentState: null,
        vault: null,
      },
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
    await this.state.storage.put(STORAGE_KEY, record);
  }
}

function computeRetryDelayMs(baseDelayMs: number, attempts: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, baseDelayMs * (2 ** Math.max(0, attempts - 1)));
}

function enqueuePendingDispatch(
  record: UserRunnerRecord,
  dispatch: HostedExecutionDispatchRequest,
): UserRunnerRecord {
  const existingPending = record.pendingEvents.some((entry) => entry.dispatch.eventId === dispatch.eventId);

  if (existingPending) {
    return record;
  }

  const pendingEvents = [
    ...record.pendingEvents,
    {
      attempts: 0,
      availableAt: new Date().toISOString(),
      dispatch,
      enqueuedAt: new Date().toISOString(),
      lastError: null,
    },
  ];
  const overflowEventId = pendingEvents.length > MAX_PENDING_EVENTS
    ? pendingEvents[0]?.dispatch.eventId ?? null
    : null;

  return {
    ...record,
    activated: record.activated || dispatch.event.kind === "member.activated",
    lastEventId: dispatch.eventId,
    pendingEvents: pendingEvents.slice(-MAX_PENDING_EVENTS),
    poisonedEventIds: overflowEventId
      ? [...record.poisonedEventIds, overflowEventId].slice(-MAX_POISONED_EVENT_IDS)
      : record.poisonedEventIds,
    userId: dispatch.event.userId,
  };
}

function hasSeenEvent(record: UserRunnerRecord, eventId: string): boolean {
  return (
    record.recentEventIds.includes(eventId)
    || record.poisonedEventIds.includes(eventId)
    || record.pendingEvents.some((entry) => entry.dispatch.eventId === eventId)
  );
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
  return {
    ...removePendingDispatch(record, eventId),
    poisonedEventIds: [...record.poisonedEventIds, eventId].slice(-MAX_POISONED_EVENT_IDS),
    lastError: errorMessage,
  };
}

function toUserStatus(record: UserRunnerRecord): HostedExecutionUserStatus {
  return {
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
