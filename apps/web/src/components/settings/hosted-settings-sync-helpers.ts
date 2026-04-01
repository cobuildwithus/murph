export interface JsonErrorDetails {
  code: string | null;
  message: string | null;
}

export async function readOptionalJsonObject(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    const payload = JSON.parse(text) as unknown;
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readJsonErrorDetails(payload: Record<string, unknown> | null): JsonErrorDetails {
  const errorPayload = isRecord(payload?.error) ? payload.error : null;

  return {
    code: typeof errorPayload?.code === "string" ? errorPayload.code : null,
    message: typeof errorPayload?.message === "string" ? errorPayload.message : null,
  };
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
