export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function retrySyncOperation<T>(input: {
  errorFactory: (message: string) => Error;
  operation: () => Promise<T>;
  retryDelaysMs?: readonly number[];
  retryable: (error: unknown) => boolean;
  sleepImpl?: (delayMs: number) => Promise<void>;
  timeoutMessage: string;
}): Promise<T> {
  const retryDelaysMs = input.retryDelaysMs ?? [0, 250, 500, 1_000];
  const sleepImpl = input.sleepImpl ?? sleep;
  let lastError: unknown = null;

  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) {
      await sleepImpl(delayMs);
    }

    try {
      return await input.operation();
    } catch (error) {
      lastError = error;

      if (!input.retryable(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : input.errorFactory(input.timeoutMessage);
}

export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}
