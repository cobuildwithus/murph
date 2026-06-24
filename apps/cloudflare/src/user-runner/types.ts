import type { HostedExecutionBundleRef } from "@murphai/hosted-execution/contracts";

export type RunnerRuntimeProcessingMode = "default" | "inbox_media_retention";

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
  list?<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  sql?: DurableObjectSqlStorageLike;
}

export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
  waitUntil(promise: Promise<unknown>): void;
}

export type RunnerWriteFenceKind = "runtime";

export interface RunnerWriteFenceRecord {
  attemptId: string;
  expiresAt: string | null;
  generation: number;
  kind: RunnerWriteFenceKind;
  processingMode: RunnerRuntimeProcessingMode;
  runnerContainerName: string | null;
  startedAt: string;
  workspaceVersion: string | null;
}

export interface RunnerRetryRecord {
  at: string | null;
  count: number;
  lastErrorCode: string | null;
}

export interface RunnerStateRecord {
  backoffUntil: string | null;
  writeFence: RunnerWriteFenceRecord | null;
  activeRun: RunnerWriteFenceRecord | null;
  /**
   * Legacy projection for deployed/test callers that still ask whether any
   * write-fenced invocation exists. Delete after 2026-05-25. New scheduling
   * code uses `writeFence`.
   */
  active: {
    attemptId: string;
    expiresAt: string | null;
    leaseGeneration: string;
    reason: string | null;
    startedAt: string;
    workspaceVersion: string | null;
  } | null;
  bundleRef: HostedExecutionBundleRef | null;
  /** Legacy write-fence projection. Delete after 2026-05-25; live code uses `writeFence`. */
  inFlight: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastInvocationAt: string | null;
  leaseGeneration: number;
  failureCount: number;
  nextWakeAt: string | null;
  /** Legacy inert wake projection retained for response compatibility. */
  pendingNudge: boolean;
  /** Legacy inert wake projection retained for response compatibility. */
  pendingNudgeGeneration: number;
  /** Legacy inert wake projection retained for response compatibility. */
  pendingWork: boolean;
  retry: RunnerRetryRecord;
  retryFailureCount: number;
  schema: "murph.hosted-runner.v3";
  userId: string;
  wakeAt: string | null;
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
