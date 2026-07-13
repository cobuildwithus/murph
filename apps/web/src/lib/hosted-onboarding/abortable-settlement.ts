export async function waitForAbortableSettlement<T>(
  pending: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const removeAbortListener = () => {
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      removeAbortListener();
      reject(
        signal.reason
        ?? new DOMException("The operation was aborted.", "AbortError"),
      );
    };

    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        removeAbortListener();
        resolve(value);
      },
      (error: unknown) => {
        removeAbortListener();
        reject(error);
      },
    );
    if (signal.aborted) {
      onAbort();
    }
  });
}

export function waitForAbortableOperation<T>(
  signal: AbortSignal,
  operation: () => PromiseLike<T>,
): Promise<T> {
  signal.throwIfAborted();
  return waitForAbortableSettlement(operation(), signal);
}
