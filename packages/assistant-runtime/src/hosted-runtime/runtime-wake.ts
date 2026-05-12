export interface RuntimeWakeSignal {
  notify(): void;
  wait(signal?: AbortSignal | null): Promise<void>;
}

export function createCoalescingRuntimeWakeSignal(): RuntimeWakeSignal {
  let pending = false;
  let flushScheduled = false;
  const waiters = new Set<() => void>();
  const flushWaiters = () => {
    flushScheduled = false;
    if (!pending) {
      return;
    }

    pending = false;
    const ready = [...waiters];
    waiters.clear();
    for (const wake of ready) {
      wake();
    }
  };

  return {
    notify() {
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
