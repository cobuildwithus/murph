import LinqAPIV3, {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "@linqapp/sdk";

export class LinqApiTimeoutError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LinqApiTimeoutError";
  }
}

export class LinqApiResponseUnreadableError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LinqApiResponseUnreadableError";
    this.status = status;
  }
}

export class LinqApiResponseTooLargeError extends LinqApiResponseUnreadableError {
  constructor(status: number) {
    super(status, "Linq API response exceeded the configured byte limit.");
    this.name = "LinqApiResponseTooLargeError";
  }
}

const linqApiProviderErrorPayloads = new WeakMap<
  LinqApiProviderResponseError,
  unknown
>();

class LinqApiProviderResponseError extends Error {
  readonly status: number;

  constructor(status: number, payload: unknown) {
    super("Linq API request failed.");
    this.name = "LinqApiProviderResponseError";
    this.status = status;
    linqApiProviderErrorPayloads.set(this, payload);
  }
}

export const LINQ_API_DEFAULT_TIMEOUT_MS = 10_000;
const LINQ_API_SDK_BASE_URL = "https://linq-sdk.invalid";
export const LINQ_API_DEFAULT_RESPONSE_MAX_BYTES = 256 * 1024;

export type LinqApiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type LinqApiClientState = {
  errorPayload: unknown;
  responseReadAborted: boolean;
  unreadableResponseStatus: number | null;
};

export function createLinqApiClient(input: {
  apiBaseUrl: string;
  apiToken: string;
  fetchImplementation?: LinqApiFetch;
  maxResponseBytes?: number;
  timeoutMs?: number;
}): LinqAPIV3 {
  return createLinqApiClientWithState(input, {
    errorPayload: null,
    responseReadAborted: false,
    unreadableResponseStatus: null,
  });
}

function createLinqApiClientWithState(input: {
  apiBaseUrl: string;
  apiToken: string;
  fetchImplementation?: LinqApiFetch;
  maxResponseBytes?: number;
  timeoutMs?: number;
}, state: LinqApiClientState): LinqAPIV3 {
  const maxResponseBytes = normalizeResponseByteLimit(
    input.maxResponseBytes ?? LINQ_API_DEFAULT_RESPONSE_MAX_BYTES,
  );
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("A fetch implementation is required for the Linq API client.");
  }

  return new LinqAPIV3({
    apiKey: input.apiToken,
    baseURL: LINQ_API_SDK_BASE_URL,
    fetch: createBoundedLinqApiFetch(
      fetchImplementation,
      normalizeLinqApiRoot(input.apiBaseUrl),
      maxResponseBytes,
      state,
    ),
    logLevel: "off",
    maxRetries: 0,
    timeout: input.timeoutMs ?? LINQ_API_DEFAULT_TIMEOUT_MS,
  });
}

export async function runLinqApiRequest<T>(input: {
  apiBaseUrl: string;
  apiToken: string;
  fetchImplementation?: LinqApiFetch;
  maxResponseBytes?: number;
  request: (client: LinqAPIV3) => Promise<T>;
  preserveResponseStatusOnReadAbort?: boolean;
  signal?: AbortSignal;
  timeoutMessage: string;
  timeoutMs?: number;
}): Promise<T> {
  const state: LinqApiClientState = {
    errorPayload: null,
    responseReadAborted: false,
    unreadableResponseStatus: null,
  };
  const client = createLinqApiClientWithState(input, state);
  try {
    return await input.request(client);
  } catch (error) {
    if (input.signal?.aborted) {
      throw input.signal.reason ?? error;
    }
    if (state.responseReadAborted && !input.preserveResponseStatusOnReadAbort) {
      throw new LinqApiTimeoutError(input.timeoutMessage, { cause: error });
    }
    if (state.unreadableResponseStatus !== null) {
      throw new LinqApiResponseUnreadableError(
        state.unreadableResponseStatus,
        "Linq API response could not be read completely.",
        { cause: error },
      );
    }
    if (error instanceof APIError && typeof error.status === "number") {
      throw new LinqApiProviderResponseError(
        error.status,
        state.errorPayload,
      );
    }
    if (
      error instanceof APIConnectionTimeoutError
      || error instanceof APIUserAbortError
    ) {
      throw new LinqApiTimeoutError(input.timeoutMessage, { cause: error });
    }
    throw error;
  }
}

export function readLinqApiErrorStatus(error: unknown): number | null {
  if (error instanceof LinqApiProviderResponseError) {
    return error.status;
  }
  if (error instanceof APIError && typeof error.status === "number") {
    return error.status;
  }
  const responseUnreadableError = readLinqApiResponseUnreadableError(error);
  if (responseUnreadableError) {
    return responseUnreadableError.status;
  }
  return null;
}

export function readLinqApiErrorPayload(error: unknown): unknown | null {
  if (error instanceof LinqApiProviderResponseError) {
    return linqApiProviderErrorPayloads.get(error) ?? null;
  }
  return error instanceof APIError ? error.error ?? null : null;
}

export function isLinqApiResponseUnreadableError(error: unknown): boolean {
  return readLinqApiResponseUnreadableError(error) !== null;
}

function readLinqApiResponseUnreadableError(
  error: unknown,
): LinqApiResponseUnreadableError | null {
  let current: unknown = error;
  let depth = 0;
  while (current !== null && current !== undefined && depth < 8) {
    if (current instanceof LinqApiResponseUnreadableError) {
      return current;
    }
    current = typeof current === "object"
        && current !== null
        && "cause" in current
      ? current.cause
      : undefined;
    depth += 1;
  }
  return null;
}

function normalizeLinqApiRoot(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, "");
  if (!normalized) {
    throw new TypeError("Linq API base URL is required.");
  }

  const url = new URL(normalized);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function createBoundedLinqApiFetch(
  fetchImplementation: LinqApiFetch,
  apiRoot: string,
  maxResponseBytes: number,
  state: LinqApiClientState,
): LinqApiFetch {
  return async (input, init) => {
    const target = mapLinqSdkRequestUrl(input, apiRoot);
    const response = await fetchImplementation.call(undefined, target, {
      ...init,
      headers: normalizeLinqSdkRequestHeaders(init?.headers),
    });
    try {
      const buffered = await bufferLinqApiResponse(response, maxResponseBytes);
      if (!buffered.ok) {
        state.errorPayload = await readOptionalLinqApiJson(buffered.clone());
      }
      return buffered;
    } catch (error) {
      state.responseReadAborted = init?.signal?.aborted ?? false;
      state.unreadableResponseStatus = response.status;
      throw error;
    }
  };
}

async function readOptionalLinqApiJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapLinqSdkRequestUrl(
  input: string | URL | Request,
  apiRoot: string,
): URL {
  const source = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
  );
  const sdkBase = new URL(LINQ_API_SDK_BASE_URL);
  if (
    source.origin !== sdkBase.origin
    || !/^\/v3(?:\/|$)/u.test(source.pathname)
  ) {
    throw new TypeError("Linq SDK emitted an unexpected request URL.");
  }

  const relativePath = encodeLinqSdkPath(
    source.pathname.replace(/^\/v3\/?/u, ""),
  );
  const target = new URL(relativePath, `${apiRoot}/`);
  target.search = source.search;
  return target;
}

function encodeLinqSdkPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join("/");
}

function normalizeLinqSdkRequestHeaders(
  headers: HeadersInit | undefined,
): Headers {
  const source = new Headers(headers);
  const normalized = new Headers();
  for (const name of ["authorization", "content-type", "idempotency-key"]) {
    const value = source.get(name);
    if (value !== null) {
      normalized.set(name, value);
    }
  }
  return normalized;
}

async function bufferLinqApiResponse(
  response: Response,
  maxResponseBytes: number,
): Promise<Response> {
  const headers = new Headers(response.headers);
  const declaredLength = headers.get("content-length");
  if (
    declaredLength
    && /^[0-9]+$/u.test(declaredLength)
    && Number(declaredLength) > maxResponseBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new LinqApiResponseTooLargeError(response.status);
  }

  const init: ResponseInit = {
    headers,
    status: response.status,
    statusText: response.statusText,
  };
  if (!response.body) {
    return new Response(null, init);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      byteLength += next.value.byteLength;
      if (byteLength > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new LinqApiResponseTooLargeError(response.status);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return new Response(null, init);
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (body.byteLength > 0) {
    headers.set("content-type", "application/json");
  }
  return new Response(body, init);
}

function normalizeResponseByteLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Linq API response byte limit must be a positive integer.");
  }
  return value;
}
