export class LinqApiTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinqApiTimeoutError";
  }
}

export const LINQ_API_DEFAULT_TIMEOUT_MS = 10_000;

type LinqApiRequestInput = {
  apiBaseUrl: string;
  apiToken: string;
  body?: BodyInit | null;
  method?: string;
  path: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export async function fetchLinqApi(input: LinqApiRequestInput): Promise<Response> {
  return runLinqApiRequest(input, (response) => response);
}

export async function fetchLinqApiJson(input: LinqApiRequestInput): Promise<{
  ok: boolean;
  payload: unknown | null;
  status: number;
}> {
  return runLinqApiRequest(input, async (response) => {
    const text = input.maxResponseBytes === undefined
      ? await response.text()
      : await readBoundedLinqApiResponseText(response, input.maxResponseBytes);
    let payload: unknown | null = null;
    if (text?.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    return {
      ok: response.ok,
      payload,
      status: response.status,
    };
  });
}

async function readBoundedLinqApiResponseText(
  response: Response,
  maxResponseBytes: number,
): Promise<string | null> {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new TypeError("Linq API response byte limit must be a positive integer.");
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength
    && /^[0-9]+$/u.test(declaredLength)
    && Number(declaredLength) > maxResponseBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const next = await reader.read();
    if (next.done) {
      text += decoder.decode();
      return text;
    }
    byteLength += next.value.byteLength;
    if (byteLength > maxResponseBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    text += decoder.decode(next.value, { stream: true });
  }
}

async function runLinqApiRequest<T>(
  input: LinqApiRequestInput,
  consumeResponse: (response: Response) => Promise<T> | T,
): Promise<T> {
  const { didTimeout, signal, clearTimeout } = createTimedAbortSignal({
    signal: input.signal,
    timeoutMs: input.timeoutMs ?? LINQ_API_DEFAULT_TIMEOUT_MS,
  });

  try {
    const response = await fetch(new URL(input.path, `${input.apiBaseUrl}/`), {
      method: input.method ?? "GET",
      headers: {
        authorization: `Bearer ${input.apiToken}`,
        ...(input.body
          ? {
              "content-type": "application/json",
            }
          : {}),
      },
      body: input.body ?? undefined,
      signal,
    });
    return await consumeResponse(response);
  } catch (error) {
    if (input.signal?.aborted) {
      throw input.signal.reason ?? error;
    }

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
