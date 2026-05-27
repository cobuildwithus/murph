export function createProviderRequestAbortSignal(input: {
  signal?: AbortSignal | null;
  timeoutMs: number;
}): {
  cleanup(): void;
  signal: AbortSignal;
} {
  const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
  const parentSignal = input.signal ?? null;

  if (!parentSignal) {
    return {
      cleanup() {
        return undefined;
      },
      signal: timeoutSignal,
    };
  }

  if (parentSignal.aborted) {
    return {
      cleanup() {
        return undefined;
      },
      signal: parentSignal,
    };
  }

  if (timeoutSignal.aborted) {
    return {
      cleanup() {
        return undefined;
      },
      signal: timeoutSignal,
    };
  }

  const controller = new AbortController();
  const abortFromParent = () => abortControllerFromSignal(controller, parentSignal);
  const abortFromTimeout = () => abortControllerFromSignal(controller, timeoutSignal);
  parentSignal.addEventListener("abort", abortFromParent, { once: true });
  timeoutSignal.addEventListener("abort", abortFromTimeout, { once: true });

  return {
    cleanup() {
      parentSignal.removeEventListener("abort", abortFromParent);
      timeoutSignal.removeEventListener("abort", abortFromTimeout);
    },
    signal: controller.signal,
  };
}

export function throwIfProviderRequestAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) {
    return;
  }

  throw readAbortReason(signal);
}

export function isProviderAbortError(error: unknown, signal?: AbortSignal | null): boolean {
  if (signal) {
    if (!signal.aborted || isProviderTimeoutReason(signal.reason)) {
      return false;
    }

    const reason = signal.reason;

    if (error === reason) {
      return true;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }
  }

  return error instanceof DOMException && error.name === "AbortError";
}

export function isProviderTimeoutError(error: unknown, signal?: AbortSignal | null): boolean {
  return isProviderTimeoutReason(error)
    || (
      signal?.aborted === true
      && isProviderTimeoutReason(signal.reason)
      && error instanceof DOMException
      && error.name === "AbortError"
    );
}

export async function waitForProviderRetryDelay(
  delayMs: number,
  signal?: AbortSignal | null,
): Promise<void> {
  throwIfProviderRequestAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(readAbortReason(signal));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);

    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });
}

function abortControllerFromSignal(controller: AbortController, signal: AbortSignal): void {
  if (!controller.signal.aborted) {
    controller.abort(signal.reason);
  }
}

function readAbortReason(signal?: AbortSignal | null): Error {
  const reason = signal?.reason;
  return reason instanceof Error
    ? reason
    : new DOMException("The operation was aborted.", "AbortError");
}

function isProviderTimeoutReason(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}
