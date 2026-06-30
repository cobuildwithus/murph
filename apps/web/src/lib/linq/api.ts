export class LinqApiTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinqApiTimeoutError";
  }
}

const DEFAULT_LINQ_API_TIMEOUT_MS = 10_000;

export async function fetchLinqApi(input: {
  apiBaseUrl: string;
  apiToken: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
  method?: string;
  path: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Response> {
  const headers = new Headers(input.headers);
  headers.set("authorization", `Bearer ${input.apiToken}`);
  if (input.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const { didTimeout, signal, clearTimeout } = createTimedAbortSignal({
    signal: input.signal,
    timeoutMs: input.timeoutMs ?? DEFAULT_LINQ_API_TIMEOUT_MS,
  });

  try {
    return await fetch(new URL(input.path, `${input.apiBaseUrl}/`), {
      method: input.method ?? "GET",
      headers,
      body: input.body ?? undefined,
      signal,
    });
  } catch (error) {
    if (didTimeout() && !input.signal?.aborted) {
      throw new LinqApiTimeoutError("Linq API request timed out.");
    }

    throw error;
  } finally {
    clearTimeout();
  }
}

function createTimedAbortSignal(input: {
  signal?: AbortSignal;
  timeoutMs: number;
}): {
  clearTimeout: () => void;
  didTimeout: () => boolean;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => {
    controller.abort(input.signal?.reason);
  };

  if (input.signal) {
    if (input.signal.aborted) {
      controller.abort(input.signal.reason);
    } else {
      input.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new LinqApiTimeoutError("Linq API request timed out."));
  }, input.timeoutMs);

  return {
    clearTimeout: () => {
      clearTimeout(timeoutId);
      input.signal?.removeEventListener("abort", onAbort);
    },
    didTimeout: () => timedOut,
    signal: controller.signal,
  };
}
