import type {
  HostedExecutionRunnerResult,
  HostedExecutionWakeKind,
  HostedExecutionBundleRef,
  HostedExecutionRunStatus,
  HostedExecutionTimelineEntry,
  HostedExecutionUserStatus,
  HostedWakePayloadSchema,
} from "@murphai/hosted-execution";
import type { HostedAssistantDeliveryEffect } from "@murphai/hosted-execution/side-effects";

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

export type RunnerBundleVersion = number;

export interface RunnerStateRecord {
  runtimeBootstrapped: boolean;
  bundleRef: HostedExecutionBundleRef | null;
  bundleVersion: RunnerBundleVersion;
  inFlight: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastEventId: string | null;
  lastRunAt: string | null;
  nextWakeAt: string | null;
  pendingWakeCount: number;
  run: HostedExecutionRunStatus | null;
  timeline: HostedExecutionTimelineEntry[];
  userId: string;
}

export interface RunnerPendingCommitRecord {
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  bundleRef: HostedExecutionBundleRef | null;
  committedAt: string;
  eventId: string;
  finalizeToken: string | null;
  finalizedAt: string | null;
  result: HostedExecutionRunnerResult["result"];
  schemaVersion: 1;
  userId: string;
  // Crash-recovery seam for one exact fetched wake and cursor fence. If that wake can no longer
  // record terminal or participate in cursor CAS, the pending commit must be discarded and rebuilt
  // from the canonical web cursor snapshot before the replacement wake runs.
  wake: {
    eventId: string;
    fetchProof: string | null;
    kind: HostedExecutionWakeKind;
    occurredAt: string;
    payloadCiphertext: string;
    payloadSchema: HostedWakePayloadSchema;
    seq: string;
    userId: string;
    wakeId: string | null;
  };
}

export const COMMITTED_RESULT_FRESH_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const MAX_RUN_TIMELINE_ENTRIES = 24;
export const RETRY_MAX_DELAY_MS = 5 * 60_000;

export function computeRetryDelayMs(baseDelayMs: number, attempts: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, baseDelayMs * (2 ** Math.max(0, attempts - 1)));
}

export function toUserStatus(record: RunnerStateRecord): HostedExecutionUserStatus {
  return {
    bundleRef: record.bundleRef,
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
    pendingWakeCount: record.pendingWakeCount,
    ...(record.run ? {
      run: record.run,
    } : {}),
    ...(record.timeline.length > 0 ? {
      timeline: record.timeline,
    } : {}),
    userId: record.userId,
  };
}
