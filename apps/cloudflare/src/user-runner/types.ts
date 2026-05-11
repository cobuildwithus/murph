import type { HostedExecutionBundleRef } from "@murphai/hosted-execution/contracts";
import type { HostedRuntimeRedactedJson } from "@murphai/hosted-execution/runtime-control";

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
  waitUntil?(promise: Promise<unknown>): void;
}

export type RunnerWriteFenceKind = "runtime" | "idle_checkpoint";

export interface RunnerWriteFenceRecord {
  attemptId: string;
  expiresAt: string;
  generation: number;
  kind: RunnerWriteFenceKind;
  startedAt: string;
  workspaceVersion: string | null;
}

export interface RunnerIdleCheckpointRecord {
  checkpointNextWakeAt: string | null;
  dueAt: string;
  workspaceVersion: string;
}

export interface RunnerRetryRecord {
  at: string | null;
  count: number;
  lastErrorCode: string | null;
}

export interface RunnerStateRecord {
  writeFence: RunnerWriteFenceRecord | null;
  activeRun: RunnerWriteFenceRecord | null;
  /**
   * Legacy projection for deployed/test callers that still ask whether any
   * write-fenced invocation exists. Delete after 2026-05-25. New scheduling
   * code uses `writeFence`.
   */
  active: {
    attemptId: string;
    expiresAt: string;
    leaseGeneration: string;
    reason: string | null;
    startedAt: string;
    workspaceVersion: string | null;
  } | null;
  bundleRef: HostedExecutionBundleRef | null;
  deferredCheckpointRequired: boolean;
  deferredCheckpointMailboxStatus: HostedRuntimeRedactedJson | null;
  idleCheckpoint: RunnerIdleCheckpointRecord | null;
  /** Legacy write-fence projection. Delete after 2026-05-25; live code uses `writeFence`. */
  inFlight: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastInvocationAt: string | null;
  leaseGeneration: number;
  nextWakeAt: string | null;
  /** Legacy wake-pending projection. Delete after 2026-05-25; live code uses `wakePending`. */
  pendingNudge: boolean;
  /** Legacy wake-pending generation projection. Delete after 2026-05-25; live code uses `wakePending`. */
  pendingNudgeGeneration: number;
  /** Legacy wake-pending projection. Delete after 2026-05-25; live code uses `wakePending`. */
  pendingWork: boolean;
  retry: RunnerRetryRecord;
  retryFailureCount: number;
  schema: "murph.hosted-runner.v3";
  userId: string;
  wakePending: boolean;
  workspaceInvocation: {
    attemptId: string;
    lastHeartbeatAt: null;
    orphanObservedAt: null;
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
