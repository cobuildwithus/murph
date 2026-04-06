import {
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  HOSTED_EXECUTION_PROXY_HOSTS,
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution";

import { readHostedRunnerCommitTimeoutMs } from "./timeouts.ts";

const HOSTED_INTERNAL_WORKER_HOSTNAMES = new Set<string>([
  HOSTED_EXECUTION_CALLBACK_HOSTS.artifacts,
  HOSTED_EXECUTION_CALLBACK_HOSTS.results,
  HOSTED_EXECUTION_PROXY_HOSTS.deviceSync,
  HOSTED_EXECUTION_PROXY_HOSTS.usage,
]);

export interface HostedJsonHttpResponse {
  payload: unknown;
  response: Response;
  text: string;
}

export interface HostedBytesHttpResponse {
  bytes: Uint8Array;
  response: Response;
}

export function createHostedInternalWorkerFetch(
  runnerProxyToken: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const normalizedToken = normalizeHostedRunnerProxyToken(runnerProxyToken);
  if (!normalizedToken) {
    return fetchImpl;
  }

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const [nextInput, nextInit] = attachHostedRunnerProxyToken(input, init, normalizedToken);
    return fetchImpl(nextInput, nextInit);
  }) as typeof fetch;
}

export async function fetchHostedJsonResponse(input: {
  description: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
  init?: RequestInit;
  url: string | URL;
}): Promise<HostedJsonHttpResponse> {
  const response = await fetchHostedResponse(input);
  const text = await readHostedResponseText(response, input.description);
  const parsed = parseHostedJsonBody(text);

  if (response.ok && parsed.error) {
    throw createHostedInternalHttpError(
      `${input.description} returned an invalid JSON response body.`,
      parsed.error,
    );
  }

  return {
    payload: parsed.error ? null : parsed.value,
    response,
    text,
  };
}

export async function fetchHostedBytesResponse(input: {
  description: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
  init?: RequestInit;
  url: string | URL;
}): Promise<HostedBytesHttpResponse> {
  const response = await fetchHostedResponse(input);

  try {
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      response,
    };
  } catch (error) {
    throw createHostedInternalHttpError(
      `${input.description} response body could not be read.`,
      error,
    );
  }
}

export function summarizeHostedJsonErrorBody(payload: unknown, text: string): string | null {
  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }

  const trimmed = text.trim();
  if (trimmed.length > 0) {
    return trimmed.slice(0, 500);
  }

  if (payload === null || payload === undefined) {
    return null;
  }

  try {
    return JSON.stringify(payload).slice(0, 500);
  } catch {
    return String(payload).slice(0, 500);
  }
}

async function fetchHostedResponse(input: {
  description: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
  init?: RequestInit;
  url: string | URL;
}): Promise<Response> {
  try {
    return await (input.fetchImpl ?? fetch)(input.url, {
      ...input.init,
      signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs(input.timeoutMs)),
    });
  } catch (error) {
    throw createHostedInternalHttpError(`${input.description} request failed.`, error);
  }
}

async function readHostedResponseText(response: Response, description: string): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw createHostedInternalHttpError(`${description} response body could not be read.`, error);
  }
}

function parseHostedJsonBody(text: string): {
  error: Error | null;
  value: unknown;
} {
  if (!text.trim()) {
    return {
      error: null,
      value: null,
    };
  }

  try {
    return {
      error: null,
      value: JSON.parse(text) as unknown,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      value: null,
    };
  }
}

function attachHostedRunnerProxyToken(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  runnerProxyToken: string,
): [RequestInfo | URL, RequestInit | undefined] {
  const requestUrl = readHostedRequestUrl(input);
  if (!requestUrl || !isHostedInternalWorkerUrl(requestUrl)) {
    return [input, init];
  }

  if (input instanceof Request) {
    const headers = new Headers(input.headers);
    applyHostedRequestInitHeaders(headers, init?.headers);
    headers.set(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER, runnerProxyToken);
    const { headers: _ignored, ...restInit } = init ?? {};
    return [new Request(input, { ...restInit, headers }), undefined];
  }

  const headers = new Headers(init?.headers ?? undefined);
  headers.set(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER, runnerProxyToken);
  return [input, { ...init, headers }];
}

function applyHostedRequestInitHeaders(headers: Headers, initHeaders: HeadersInit | undefined): void {
  if (!initHeaders) {
    return;
  }

  new Headers(initHeaders).forEach((value, key) => {
    headers.set(key, value);
  });
}

function readHostedRequestUrl(input: RequestInfo | URL): string | null {
  if (input instanceof Request) {
    return input.url;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (typeof input === "string") {
    return input;
  }

  return null;
}

function isHostedInternalWorkerUrl(value: string): boolean {
  try {
    return HOSTED_INTERNAL_WORKER_HOSTNAMES.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

function normalizeHostedRunnerProxyToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function createHostedInternalHttpError(message: string, cause?: unknown): Error {
  const detail = summarizeHostedInternalHttpCause(cause);
  return new Error(detail ? `${message} ${detail}` : message, cause ? { cause } : undefined);
}

function summarizeHostedInternalHttpCause(cause: unknown): string {
  if (
    cause
    && typeof cause === "object"
    && "name" in cause
    && (cause.name === "AbortError" || cause.name === "TimeoutError")
  ) {
    return "The request timed out.";
  }

  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message.trim();
  }

  if (typeof cause === "string" && cause.trim().length > 0) {
    return cause.trim();
  }

  return "";
}
