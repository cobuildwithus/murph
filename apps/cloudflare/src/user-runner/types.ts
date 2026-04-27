import type { HostedExecutionBundleRef } from "@murphai/hosted-execution/contracts";
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
  delete(key: string): Promise<boolean>;
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

export interface RunnerStateRecord {
  bundleRef: HostedExecutionBundleRef | null;
  inFlight: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastInvocationAt: string | null;
  leaseGeneration: number;
  nextWakeAt: string | null;
  pendingNudge: boolean;
  userId: string;
  workspaceInvocation: {
    attemptId: string;
    reason: string | null;
    startedAt: string;
    workspaceVersion: string | null;
  } | null;
}

export const COMMITTED_RESULT_FRESH_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const RETRY_MAX_DELAY_MS = 5 * 60_000;

export function computeRetryDelayMs(baseDelayMs: number, attempts: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, baseDelayMs * (2 ** Math.max(0, attempts - 1)));
}
