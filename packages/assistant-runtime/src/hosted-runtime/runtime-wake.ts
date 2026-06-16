export interface RuntimeWakeNotification {
  notifiedAtEpochMs: number;
}

export interface RuntimeWakeSignal {
  consumePending(): RuntimeWakeNotification | null;
  notify(notifiedAtEpochMs?: number): void;
  wait(signal?: AbortSignal | null): Promise<RuntimeWakeNotification>;
}

export function createCoalescingRuntimeWakeSignal(): RuntimeWakeSignal {
  let pendingNotifyAtEpochMs: number | null = null;
  let pending = false;
  let flushScheduled = false;
  const waiters = new Set<(notification: RuntimeWakeNotification) => void>();
  const consumePendingNotification = (): RuntimeWakeNotification => {
    const notification = {
      notifiedAtEpochMs: pendingNotifyAtEpochMs ?? Date.now(),
    };
    pendingNotifyAtEpochMs = null;
    return notification;
  };
  const flushWaiters = () => {
    flushScheduled = false;
    if (!pending) {
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

  return {
    consumePending() {
      if (!pending || waiters.size > 0) {
        return null;
      }
      pending = false;
      return consumePendingNotification();
    },
    notify(notifiedAtEpochMs?: number) {
      if (!pending) {
        pendingNotifyAtEpochMs = notifiedAtEpochMs ?? Date.now();
      }
      pending = true;
      if (waiters.size > 0 && !flushScheduled) {
        flushScheduled = true;
        // Collapse same-tick wake bursts into one foreground mailbox import.
        queueMicrotask(flushWaiters);
      }
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

function readRuntimeWakeAbortReason(signal: AbortSignal | null | undefined): unknown {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Runtime wake wait was aborted.", "AbortError");
}
