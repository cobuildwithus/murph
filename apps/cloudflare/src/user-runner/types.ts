import type {
  HostedExecutionBundleRefs,
  HostedExecutionBundleSlotMap,
  HostedExecutionDispatchRequest,
  HostedExecutionRunStatus,
  HostedExecutionTimelineEntry,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";

export type DurableObjectSqlValue = ArrayBuffer | string | number | null;

export interface DurableObjectSqlCursorLike<
  T extends Record<string, DurableObjectSqlValue>,
> extends Iterable<T> {
  next(): IteratorResult<T>;
  one(): T;
  raw<U extends DurableObjectSqlValue[]>(): IterableIterator<U>;
  readonly columnNames: string[];
  readonly rowsRead: number;
  readonly rowsWritten: number;
  toArray(): T[];
}

export interface DurableObjectSqlStorageLike {
  exec<T extends Record<string, DurableObjectSqlValue>>(
    query: string,
    ...bindings: unknown[]
  ): DurableObjectSqlCursorLike<T>;
}

export interface DurableObjectStorageLike {
  deleteAlarm?(): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  getAlarm(): Promise<number | null>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  sql?: DurableObjectSqlStorageLike;
}

export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
}

export interface PendingDispatchRecord {
  attempts: number;
  availableAt: string;
  dispatch: HostedExecutionDispatchRequest;
  enqueuedAt: string;
  eventId: string;
  lastError: string | null;
}

export type RunnerBundleVersions = HostedExecutionBundleSlotMap<number>;

export interface RunnerStateRecord {
  activated: boolean;
  backpressuredEventIds: string[];
  bundleRefs: HostedExecutionBundleRefs;
  bundleVersions: RunnerBundleVersions;
  inFlight: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastEventId: string | null;
  lastRunAt: string | null;
  nextPendingAvailableAt: string | null;
  nextWakeAt: string | null;
  pendingEventCount: number;
  poisonedEventIds: string[];
  run: HostedExecutionRunStatus | null;
  retryingEventId: string | null;
  timeline: HostedExecutionTimelineEntry[];
  userId: string;
}

export const COMMITTED_RESULT_FRESH_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const CONSUMED_EVENT_EXACT_TTL_MS = 30 * 24 * 60 * 60_000;
export const MAX_BACKPRESSURED_EVENT_IDS = 16;
export const MAX_PENDING_EVENTS = 64;
export const MAX_POISONED_EVENT_IDS = 16;
export const MAX_RUN_TIMELINE_ENTRIES = 24;
export const RETRY_MAX_DELAY_MS = 5 * 60_000;

export function computeRetryDelayMs(baseDelayMs: number, attempts: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, baseDelayMs * (2 ** Math.max(0, attempts - 1)));
}

export function earliestIsoTimestamp(
  ...values: Array<string | null | undefined>
): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
}

export function toUserStatus(record: RunnerStateRecord): HostedExecutionUserStatus {
  return {
    backpressuredEventIds: record.backpressuredEventIds,
    bundleRefs: record.bundleRefs,
    inFlight: record.inFlight,
    lastError: record.lastError,
    ...(record.lastErrorAt ? {
      lastErrorAt: record.lastErrorAt,
    } : {}),
    ...(record.lastErrorCode ? {
      lastErrorCode: record.lastErrorCode,
    } : {}),
    lastEventId: record.lastEventId,
    lastRunAt: record.lastRunAt,
    nextWakeAt: record.nextWakeAt,
    pendingEventCount: record.pendingEventCount,
    poisonedEventIds: record.poisonedEventIds,
    ...(record.run ? {
      run: record.run,
    } : {}),
    retryingEventId: record.retryingEventId,
    ...(record.timeline.length > 0 ? {
      timeline: record.timeline,
    } : {}),
    userId: record.userId,
  };
}
