import type {
  HostedMailboxLaneHighWater,
  HostedRuntimeOrchestrationLatencyDiagnostics,
  HostedRuntimeUsageAttribution,
} from "@murphai/hosted-execution/runtime-control";

export interface RuntimeWakeNotifyInput {
  notifiedAtEpochMs?: number | null;
  orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
  usageAttribution?: HostedRuntimeUsageAttribution | null;
  usageAttributionMaxSeqByLane?: HostedMailboxLaneHighWater[] | null;
}

export interface RuntimeWakeNotification {
  latestNotifiedAtEpochMs?: number;
  notifiedAtEpochMs: number;
  orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
  usageAttribution?: HostedRuntimeUsageAttribution | null;
  usageAttributionMaxSeqByLane?: HostedMailboxLaneHighWater[] | null;
}

export interface RuntimeWakeSignal {
  consumePending(): RuntimeWakeNotification | null;
  notify(input?: number | RuntimeWakeNotifyInput): void;
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
  let pendingUsageAttribution: HostedRuntimeUsageAttribution | null = null;
  let pendingUsageAttributionMaxSeqByLane: HostedMailboxLaneHighWater[] | null = null;
  let pending = false;
  let flushScheduled = false;
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
      ...(pendingUsageAttribution
        ? { usageAttribution: pendingUsageAttribution }
        : {}),
      ...(pendingUsageAttributionMaxSeqByLane
        ? { usageAttributionMaxSeqByLane: pendingUsageAttributionMaxSeqByLane }
        : {}),
    };
    latestPendingNotifyAtEpochMs = null;
    pendingNotifyAtEpochMs = null;
    pendingOrchestration = null;
    pendingUsageAttribution = null;
    pendingUsageAttributionMaxSeqByLane = null;
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
    notify(input?: number | RuntimeWakeNotifyInput) {
      const notification = normalizeRuntimeWakeNotifyInput(input);
      if (!pending) {
        latestPendingNotifyAtEpochMs = notification.notifiedAtEpochMs;
        pendingNotifyAtEpochMs = notification.notifiedAtEpochMs;
        pendingOrchestration = notification.orchestration ?? null;
        pendingUsageAttribution = notification.usageAttribution ?? null;
        pendingUsageAttributionMaxSeqByLane =
          notification.usageAttributionMaxSeqByLane ?? null;
      } else {
        latestPendingNotifyAtEpochMs = Math.max(
          latestPendingNotifyAtEpochMs
            ?? pendingNotifyAtEpochMs
            ?? notification.notifiedAtEpochMs,
          notification.notifiedAtEpochMs,
        );
        if (!pendingOrchestration && notification.orchestration) {
          pendingOrchestration = notification.orchestration;
        }
        // Keep the first admission and its mailbox high-water together. The
        // bound fetch cannot import later rows, so a later wake remains durable
        // lag and receives its own admission after owner reconciliation.
        if (!pendingUsageAttribution && notification.usageAttribution) {
          pendingUsageAttribution = notification.usageAttribution;
          pendingUsageAttributionMaxSeqByLane =
            notification.usageAttributionMaxSeqByLane ?? null;
        }
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

function normalizeRuntimeWakeNotifyInput(
  input: number | RuntimeWakeNotifyInput | undefined,
): RuntimeWakeNotification {
  if (typeof input === "number") {
    return { notifiedAtEpochMs: input };
  }

  return {
    ...(input?.orchestration ? { orchestration: input.orchestration } : {}),
    notifiedAtEpochMs: input?.notifiedAtEpochMs ?? Date.now(),
    ...(input?.usageAttribution
      ? { usageAttribution: input.usageAttribution }
      : {}),
    ...(input?.usageAttributionMaxSeqByLane
      ? { usageAttributionMaxSeqByLane: input.usageAttributionMaxSeqByLane }
      : {}),
  };
}

function readRuntimeWakeAbortReason(signal: AbortSignal | null | undefined): unknown {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Runtime wake wait was aborted.", "AbortError");
}
