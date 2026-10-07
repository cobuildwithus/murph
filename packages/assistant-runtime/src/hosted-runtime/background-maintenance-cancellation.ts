const HOSTED_BACKGROUND_MAINTENANCE_PREEMPTION_POLL_MS = 25;

export type HostedBackgroundMaintenanceYieldReason = "foreground" | "canonical_receipt_capacity";

export type HostedBackgroundMaintenanceCancellationReason =
  | "container_destroyed"
  | HostedBackgroundMaintenanceYieldReason
  | "invocation_preempted"
  | "outer_signal"
  | "timeout";

export function createHostedBackgroundMaintenanceCancellation(input: {
  signal: AbortSignal | null;
  shouldYield: (() => boolean) | null;
  cooperativeYieldReason?: HostedBackgroundMaintenanceYieldReason;
  timeoutMs: number | null;
}): {
  dispose(): void;
  readReason(): HostedBackgroundMaintenanceCancellationReason | null;
  signal: AbortSignal | null;
} {
  if (!input.signal && !input.shouldYield && !input.timeoutMs) {
    return {
      dispose: () => undefined,
      readReason: () => null,
      signal: null,
    };
  }

  const controller = new AbortController();
  let cancellationReason: HostedBackgroundMaintenanceCancellationReason | null = null;
  const abort = (
    reasonCode: HostedBackgroundMaintenanceCancellationReason,
    reason: unknown,
  ) => {
    if (!controller.signal.aborted) {
      cancellationReason = reasonCode;
      controller.abort(reason);
    }
  };
  const abortForOuterSignal = () => {
    abort(
      classifyHostedBackgroundMaintenanceOuterCancellation(input.signal),
      readHostedBackgroundMaintenanceAbortReason(input.signal),
    );
  };
  const abortForCooperativeYield = () => {
    abort(
      input.cooperativeYieldReason ?? "foreground",
      new DOMException("Background maintenance yielded to its owning runtime.", "AbortError"),
    );
  };
  const abortForTimeout = () => {
    abort(
      "timeout",
      new DOMException("Background maintenance exceeded its time budget.", "AbortError"),
    );
  };

  input.signal?.addEventListener("abort", abortForOuterSignal, { once: true });
  if (input.signal?.aborted) {
    abortForOuterSignal();
  }

  const pollTimer = input.shouldYield
    ? setInterval(() => {
        if (input.shouldYield?.() === true) {
          abortForCooperativeYield();
        }
      }, HOSTED_BACKGROUND_MAINTENANCE_PREEMPTION_POLL_MS)
    : null;
  pollTimer?.unref?.();

  const timeoutTimer = input.timeoutMs && input.timeoutMs > 0
    ? setTimeout(abortForTimeout, input.timeoutMs)
    : null;
  timeoutTimer?.unref?.();

  return {
    dispose() {
      input.signal?.removeEventListener("abort", abortForOuterSignal);
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
    },
    readReason: () => cancellationReason,
    signal: controller.signal,
  };
}

function readHostedBackgroundMaintenanceAbortReason(signal: AbortSignal | null): unknown {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Background maintenance was aborted.", "AbortError");
}

function classifyHostedBackgroundMaintenanceOuterCancellation(
  signal: AbortSignal | null,
): HostedBackgroundMaintenanceCancellationReason {
  const message = signal?.reason instanceof Error
    ? signal.reason.message
    : null;
  if (message === "workspace invocation preempted") {
    return "invocation_preempted";
  }
  if (message === "workspace invocation container destroyed") {
    return "container_destroyed";
  }
  return "outer_signal";
}
