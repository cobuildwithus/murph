const HOSTED_BACKGROUND_MAINTENANCE_PREEMPTION_POLL_MS = 25;

export function createHostedBackgroundMaintenanceCancellation(input: {
  signal: AbortSignal | null;
  shouldYield: (() => boolean) | null;
  timeoutMs: number | null;
}): {
  dispose(): void;
  signal: AbortSignal | null;
} {
  if (!input.signal && !input.shouldYield && !input.timeoutMs) {
    return {
      dispose: () => undefined,
      signal: null,
    };
  }

  const controller = new AbortController();
  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };
  const abortForOuterSignal = () => {
    abort(readHostedBackgroundMaintenanceAbortReason(input.signal));
  };
  const abortForForeground = () => {
    abort(new DOMException("Background maintenance yielded to foreground input.", "AbortError"));
  };
  const abortForTimeout = () => {
    abort(new DOMException("Background maintenance exceeded its time budget.", "AbortError"));
  };

  input.signal?.addEventListener("abort", abortForOuterSignal, { once: true });
  if (input.signal?.aborted) {
    abortForOuterSignal();
  }

  const pollTimer = input.shouldYield
    ? setInterval(() => {
        if (input.shouldYield?.() === true) {
          abortForForeground();
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
    signal: controller.signal,
  };
}

function readHostedBackgroundMaintenanceAbortReason(signal: AbortSignal | null): unknown {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Background maintenance was aborted.", "AbortError");
}
