import type {
  HostedRuntimeOrchestrationLatencyDiagnostics,
} from "@murphai/hosted-execution/runtime-control";

export interface RuntimeWakeNotifyInput {
  notifiedAtEpochMs?: number | null;
  orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
}

export interface RuntimeWakeNotification {
  latestNotifiedAtEpochMs?: number;
  notifiedAtEpochMs: number;
  orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
  revision: number;
}

export interface RuntimeWakeSignal {
  consumePending(): RuntimeWakeNotification | null;
  currentRevision(): number;
  notify(input?: number | RuntimeWakeNotifyInput): void;
  /** Re-enqueue an existing wake without advancing its notification revision. */
  requeue(notification: RuntimeWakeNotification): void;
  wait(signal?: AbortSignal | null): Promise<RuntimeWakeNotification>;
}

export function consumePendingRuntimeWakeUnlessShuttingDown(input: {
  runtimeWakeSignal: RuntimeWakeSignal | null | undefined;
  shutdownSignal?: AbortSignal | null;
}): RuntimeWakeNotification | null {
  if (input.shutdownSignal?.aborted === true) {
    return null;
  }

  return input.runtimeWakeSignal?.consumePending() ?? null;
}

export function createCoalescingRuntimeWakeSignal(): RuntimeWakeSignal {
  let latestPendingNotifyAtEpochMs: number | null = null;
  let pendingNotifyAtEpochMs: number | null = null;
  let pendingOrchestration: HostedRuntimeOrchestrationLatencyDiagnostics | null = null;
  let pendingRevision: number | null = null;
  let pending = false;
  let flushScheduled = false;
  let revision = 0;
  const waiters = new Set<(notification: RuntimeWakeNotification) => void>();
  const consumePendingNotification = (): RuntimeWakeNotification => {
    const notifiedAtEpochMs = pendingNotifyAtEpochMs ?? Date.now();
    const latestNotifiedAtEpochMs =
      latestPendingNotifyAtEpochMs ?? notifiedAtEpochMs;
    const notification = {
      ...(latestNotifiedAtEpochMs !== notifiedAtEpochMs
        ? { latestNotifiedAtEpochMs }
        : {}),
      notifiedAtEpochMs,
      ...(pendingOrchestration ? { orchestration: pendingOrchestration } : {}),
      revision: pendingRevision ?? revision,
    };
    latestPendingNotifyAtEpochMs = null;
    pendingNotifyAtEpochMs = null;
    pendingOrchestration = null;
    pendingRevision = null;
    return notification;
  };
  const flushWaiters = () => {
    flushScheduled = false;
    if (!pending || waiters.size === 0) {
      return;
    }

    pending = false;
    const notification = consumePendingNotification();
    const ready = [...waiters];
    waiters.clear();
    for (const wake of ready) {
      wake(notification);
    }
  };
  const enqueueNotification = (
    notification: RuntimeWakeNotification,
  ): void => {
    if (!pending) {
      latestPendingNotifyAtEpochMs =
        notification.latestNotifiedAtEpochMs ?? notification.notifiedAtEpochMs;
      pendingNotifyAtEpochMs = notification.notifiedAtEpochMs;
      pendingOrchestration = notification.orchestration ?? null;
      pendingRevision = notification.revision;
    } else {
      latestPendingNotifyAtEpochMs = Math.max(
        latestPendingNotifyAtEpochMs
          ?? pendingNotifyAtEpochMs
          ?? notification.notifiedAtEpochMs,
        notification.latestNotifiedAtEpochMs ?? notification.notifiedAtEpochMs,
      );
      if (!pendingOrchestration && notification.orchestration) {
        pendingOrchestration = notification.orchestration;
      }
      pendingRevision = Math.max(
        pendingRevision ?? notification.revision,
        notification.revision,
      );
    }
    pending = true;
    if (waiters.size > 0 && !flushScheduled) {
      flushScheduled = true;
      // Collapse same-tick wake bursts into one foreground mailbox import.
      queueMicrotask(flushWaiters);
    }
  };

  return {
    consumePending() {
      if (!pending || waiters.size > 0) {
        return null;
      }
      pending = false;
      return consumePendingNotification();
    },
    currentRevision() {
      return revision;
    },
    notify(input?: number | RuntimeWakeNotifyInput) {
      revision += 1;
      enqueueNotification({
        ...normalizeRuntimeWakeNotifyInput(input),
        revision,
      });
    },
    requeue(notification: RuntimeWakeNotification) {
      enqueueNotification(notification);
    },
    wait(signal?: AbortSignal | null) {
      if (signal?.aborted) {
        return Promise.reject(readRuntimeWakeAbortReason(signal));
      }
      if (pending && waiters.size === 0) {
        pending = false;
        return Promise.resolve(consumePendingNotification());
      }

      return new Promise<RuntimeWakeNotification>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          waiters.delete(resolveWake);
          signal?.removeEventListener("abort", abort);
        };
        const settle = (finish: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          finish();
        };
        const resolveWake = (notification: RuntimeWakeNotification) => {
          settle(() => resolve(notification));
        };
        const abort = () => {
          settle(() => reject(readRuntimeWakeAbortReason(signal)));
        };

        waiters.add(resolveWake);
        signal?.addEventListener("abort", abort, { once: true });
      });
    },
  };
}

function normalizeRuntimeWakeNotifyInput(
  input: number | RuntimeWakeNotifyInput | undefined,
): Omit<RuntimeWakeNotification, "revision"> {
  if (typeof input === "number") {
    return { notifiedAtEpochMs: input };
  }

  return {
    ...(input?.orchestration ? { orchestration: input.orchestration } : {}),
    notifiedAtEpochMs: input?.notifiedAtEpochMs ?? Date.now(),
  };
}

function readRuntimeWakeAbortReason(signal: AbortSignal | null | undefined): unknown {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Runtime wake wait was aborted.", "AbortError");
}
