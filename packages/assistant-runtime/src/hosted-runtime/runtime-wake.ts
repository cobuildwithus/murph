export interface RuntimeWakeSignal {
  consumePending(): boolean;
  notify(notifiedAtEpochMs?: number): void;
  readLatestConsumedNotifyAtEpochMs?(): number | null;
  wait(signal?: AbortSignal | null): Promise<void>;
}

export function createCoalescingRuntimeWakeSignal(): RuntimeWakeSignal {
  let latestConsumedNotifyAtEpochMs: number | null = null;
  let pendingNotifyAtEpochMs: number | null = null;
  let pending = false;
  let flushScheduled = false;
  const waiters = new Set<() => void>();
  const consumePendingNotifyAt = () => {
    latestConsumedNotifyAtEpochMs = pendingNotifyAtEpochMs;
    pendingNotifyAtEpochMs = null;
  };
  const flushWaiters = () => {
    flushScheduled = false;
    if (!pending) {
      return;
    }

    pending = false;
    consumePendingNotifyAt();
    const ready = [...waiters];
    waiters.clear();
    for (const wake of ready) {
      wake();
    }
  };

  return {
    consumePending() {
      if (!pending || waiters.size > 0) {
        return false;
      }
      pending = false;
      consumePendingNotifyAt();
      return true;
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
    readLatestConsumedNotifyAtEpochMs() {
      return latestConsumedNotifyAtEpochMs;
    },
    wait(signal?: AbortSignal | null) {
      if (signal?.aborted) {
        return Promise.reject(readRuntimeWakeAbortReason(signal));
      }
      if (pending && waiters.size === 0) {
        pending = false;
        consumePendingNotifyAt();
        return Promise.resolve();
      }

      return new Promise<void>((resolve, reject) => {
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
        const resolveWake = () => {
          settle(resolve);
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
