import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";

import { parseHostedRunnerProviderEffectErrorResponse } from "../runner-effects-contract.ts";
import {
  HostedRuntimeControlPlaneFetchError,
  combineAbortSignalsWithCleanup,
  shouldPreserveHostedRuntimeFetchError,
} from "./control-plane-fetch.ts";
import { buildHostedRuntimeSafeErrorMetadata } from "./diagnostics.ts";
import { readHostedRuntimeResponseBodyChunks } from "./hosted-response-body.ts";
import { normalizeCloudflareWorkerFetch } from "../worker-fetch.ts";

export async function fetchHostedResponse(input: {
  description: string;
  fetchImpl: typeof fetch;
  init?: RequestInit;
  redactedLogPath?: string;
  redactedResponseOrigin?: string;
  signal?: AbortSignal | null;
  timeoutMs: number;
  url: URL;
}): Promise<Response> {
  const callerSignal = input.signal ?? input.init?.signal ?? null;
  const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
  const requestSignal = combineAbortSignalsWithCleanup(callerSignal, timeoutSignal);
  const fetchImpl = normalizeCloudflareWorkerFetch(input.fetchImpl);
  try {
    return await fetchImpl(input.url, {
      ...input.init,
      signal: requestSignal.signal,
    });
  } catch (error) {
    if (shouldPreserveHostedRuntimeFetchError(error)) {
      throw error;
    }

    const wrappedError = new HostedRuntimeControlPlaneFetchError({
      cause: error,
      description: input.description,
      signalState: {
        callerSignalAborted: callerSignal?.aborted ?? false,
        requestSignalAborted: requestSignal.signal.aborted,
        timeoutMs: input.timeoutMs,
        timeoutSignalAborted: timeoutSignal.aborted,
      },
    });

    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: input.description,
        method: input.init?.method ?? "GET",
        path: input.redactedLogPath ?? input.url.pathname,
        responseOrigin: input.redactedResponseOrigin ?? input.url.origin,
        ...buildHostedRuntimeSafeErrorMetadata(wrappedError),
      },
      level: "warn",
      message: "Hosted runtime upstream request failed.",
      phase: "outbox",
      userId: null,
    });
    throw wrappedError;
  } finally {
    requestSignal.dispose();
  }
}

export async function fetchHostedJson(input: {
  allowNotFound?: boolean;
  body?: unknown;
  description: string;
  exposeResponseBodyInError?: boolean;
  fetchImpl: typeof fetch;
  headers?: Headers;
  redactedLogPath?: string;
  method: "DELETE" | "GET" | "POST" | "PUT";
  signal?: AbortSignal | null;
  timeoutMs: number;
  url: URL;
}): Promise<unknown> {
  const response = await fetchHostedResponse({
    description: input.description,
    fetchImpl: input.fetchImpl,
    init: {
      ...(input.body === undefined
        ? {}
        : {
            body: JSON.stringify(input.body),
            headers: mergeHostedRuntimeJsonHeaders(input.headers),
          }),
      ...(input.body === undefined && input.headers
        ? { headers: input.headers }
        : {}),
      method: input.method,
    },
    signal: input.signal ?? null,
    timeoutMs: input.timeoutMs,
    url: input.url,
    ...(input.redactedLogPath ? { redactedLogPath: input.redactedLogPath } : {}),
  });

  if (input.allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    let detail = "";
    let responseBodyReadError: unknown;
    try {
      detail = (await readHostedResponseText({
        description: input.description,
        response,
        signal: input.signal ?? null,
        timeoutMs: input.timeoutMs,
      })).trim();
    } catch (error) {
      // Response headers already established an application failure. Preserve
      // that status as the classification boundary even if its optional
      // diagnostic body is lost at transport.
      responseBodyReadError = error;
    }
    const exposeResponseBodyInError = input.exposeResponseBodyInError !== false;
    const error = new Error(
      exposeResponseBodyInError && detail.length > 0
        ? `${input.description} failed with HTTP ${response.status}. ${detail}`
        : `${input.description} failed with HTTP ${response.status}.`,
      { cause: responseBodyReadError },
    ) as Error & {
      status: number;
      statusCode: number;
    };
    error.status = response.status;
    error.statusCode = response.status;
    const logError = new Error(
      `${input.description} failed with HTTP ${response.status}.`,
    ) as Error & {
      status: number;
      statusCode: number;
    };
    logError.status = response.status;
    logError.statusCode = response.status;
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: input.description,
        method: input.method,
        path: input.redactedLogPath ?? input.url.pathname,
        responseBodyBytes: new TextEncoder().encode(detail).byteLength,
        responseBodyReadFailed: responseBodyReadError !== undefined,
        responseBodyPresent: detail.length > 0,
        responseOrigin: input.url.origin,
        responseStatus: response.status,
      },
      error: logError,
      level: "warn",
      message: "Hosted runtime upstream response returned non-OK.",
      phase: "outbox",
      userId: null,
    });
    throw error;
  }

  const text = await readHostedResponseText({
    description: input.description,
    response,
    signal: input.signal ?? null,
    timeoutMs: input.timeoutMs,
  });
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${input.description} returned invalid JSON.`, { cause: error });
  }
}

async function readHostedResponseText(input: {
  description: string;
  response: Response;
  signal?: AbortSignal | null;
  timeoutMs: number;
}): Promise<string> {
  if (!input.response.body) {
    return "";
  }

  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of readHostedRuntimeResponseBodyChunks({
    body: input.response.body,
    description: input.description,
    signal: input.signal ?? null,
    timeoutMs: input.timeoutMs,
  })) {
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}

export async function fetchHostedProviderEffectJson(input: {
  body: unknown;
  boundedResponseBody?: boolean;
  description: string;
  fetchImpl: typeof fetch;
  headers: Headers;
  signal?: AbortSignal | null;
  timeoutMs: number;
  url: URL;
}): Promise<unknown> {
  const response = await fetchHostedResponse({
    description: input.description,
    fetchImpl: input.fetchImpl,
    init: {
      body: JSON.stringify(input.body),
      headers: mergeHostedRuntimeJsonHeaders(input.headers),
      method: "POST",
    },
    signal: input.signal ?? null,
    timeoutMs: input.timeoutMs,
    url: input.url,
  });

  const text = input.boundedResponseBody === true
    ? await readHostedResponseText({
        description: input.description,
        response,
        signal: input.signal ?? null,
        timeoutMs: input.timeoutMs,
      })
    : await response.text();
  if (!response.ok) {
    throw createHostedProviderEffectError({
      description: input.description,
      payload: parseJsonObjectOrNull(text),
      status: response.status,
    });
  }

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${input.description} returned invalid JSON.`, { cause: error });
  }
}

function createHostedProviderEffectError(input: {
  description: string;
  payload: unknown;
  status: number;
}): Error {
  const providerError = parseHostedRunnerProviderEffectErrorResponse(input.payload);
  const error = new Error(
    providerError?.error
      ? `${input.description} failed with HTTP ${input.status}. ${providerError.error}`
      : `${input.description} failed with HTTP ${input.status}.`,
  ) as Error & {
    cleanupMessages?: unknown;
    cleanupTargetAliases?: unknown;
    code?: string;
    context?: unknown;
    deliveryMayHaveSucceeded?: boolean;
    providerMessageId?: string | null;
    providerMessageIds?: unknown;
    retryable?: boolean;
    status: number;
    statusCode: number;
    target?: string;
  };
  error.status = input.status;
  error.statusCode = input.status;
  if (providerError?.code) {
    error.code = providerError.code;
  }
  if (providerError?.context) {
    error.context = providerError.context;
  }
  if (providerError?.deliveryMayHaveSucceeded !== undefined) {
    error.deliveryMayHaveSucceeded = providerError.deliveryMayHaveSucceeded;
  }
  if (providerError?.providerMessageIds) {
    error.providerMessageIds = providerError.providerMessageIds;
  }
  if (providerError?.providerMessageId !== undefined) {
    error.providerMessageId = providerError.providerMessageId;
  } else if (providerError?.providerMessageIds) {
    error.providerMessageId = providerError.providerMessageIds.at(-1) ?? null;
  }
  if (providerError?.cleanupMessages) {
    error.cleanupMessages = providerError.cleanupMessages;
  }
  if (providerError?.cleanupTargetAliases) {
    error.cleanupTargetAliases = providerError.cleanupTargetAliases;
  }
  if (providerError?.retryable !== undefined) {
    error.retryable = providerError.retryable;
  }
  if (providerError?.target) {
    error.target = providerError.target;
  }
  return error;
}

function parseJsonObjectOrNull(text: string): unknown {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mergeHostedRuntimeJsonHeaders(headers: Headers | undefined): Headers {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json; charset=utf-8");
  return merged;
}
export function assertHostedOk(response: Response, description: string): void {
  if (response.ok) {
    return;
  }

  const error = new Error(`${description} failed with HTTP ${response.status}.`) as Error & {
    status: number;
    statusCode: number;
  };
  error.status = response.status;
  error.statusCode = response.status;
  emitHostedExecutionStructuredLog({
    component: "assistant-delivery",
    details: {
      description,
      responseStatus: response.status,
      ...buildHostedRuntimeSafeErrorMetadata(error),
    },
    error,
    level: "warn",
    message: "Hosted runtime upstream response returned non-OK.",
    phase: "outbox",
    userId: null,
  });
  throw error;
}

export function readOptionalStringField(value: unknown, field: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime response must be an object.");
  }

  const entry = (value as Record<string, unknown>)[field];
  if (entry === undefined || entry === null) {
    return null;
  }

  if (typeof entry !== "string") {
    throw new TypeError(`Hosted runtime response.${field} must be a string.`);
  }

  return entry;
}

export function readRequiredHostedRuntimeString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

export function readRequiredHostedRuntimeObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function readRequiredHostedRuntimePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

export function readRequiredField(value: unknown, field: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime response must be an object.");
  }

  const entry = (value as Record<string, unknown>)[field];
  if (entry === undefined) {
    throw new TypeError(`Hosted runtime response.${field} is required.`);
  }

  return entry;
}

export function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
