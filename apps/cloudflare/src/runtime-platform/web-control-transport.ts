import { emitHostedExecutionStructuredLog, type HostedExecutionStructuredLogDetails } from "@murphai/hosted-execution";

import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../internal-hosts.ts";
import {
  assertAllowedHostedRunnerWebControlRequest,
  readHostedRunnerWebControlRoute,
} from "../runner-outbound/shared-web-control-policy.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../runner-outbound/headers.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";
import type { HostedWebCallbackSigningEnvironment } from "../web-callback-auth.ts";
import {
  HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
} from "@murphai/hosted-execution/routes";
import {
  HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER,
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER,
  isHostedRuntimeAssistantAskDiagnosticCode,
  isHostedRuntimeAssistantAskRequestId,
} from "@murphai/hosted-execution/runtime-control";
import {
  HostedRuntimeControlPlaneFetchError,
  HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS,
  combineAbortSignalsWithCleanup,
  isRetryableHostedRuntimeReplaySafeReadTransportError,
  isRetryableHostedWebControlReadError,
  shouldPreserveHostedRuntimeFetchError,
  sleepHostedReplaySafeReadRetryDelay,
} from "./control-plane-fetch.ts";
import { buildHostedRuntimeSafeErrorMetadata } from "./diagnostics.ts";
import { fetchHostedResponse } from "./hosted-http.ts";
import { readHostedRuntimeResponseBodyChunks } from "./hosted-response-body.ts";
import {
  isHostedRuntimeInternalAuthorityRejectedError,
  requireHostedRuntimeWriteFenceHeaders,
  type HostedWorkspaceCheckpointBridgeAuthority,
} from "./authority-headers.ts";

export type HostedWebControlTransport =
  | {
    callbackSigning: HostedWebCallbackSigningEnvironment;
    mode: "direct";
    webControlBaseUrl: string;
    workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
  }
  | {
    mode: "proxy";
  };

interface HostedWebControlPlaneJsonRequest {
  acceptedStatuses?: readonly number[];
  body?: unknown;
  boundUserId: string;
  description: string;
  fetchImpl: typeof fetch;
  headers?: Headers;
  method?: "GET" | "POST";
  path: string;
  replayOnceOnRetryableFailure?: boolean;
  sensitiveResponseBody?: {
    maxBytes: number;
  };
  signal?: AbortSignal | null;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}

export class HostedWebControlPlaneResponseError extends Error {
  readonly code: string | undefined;
  readonly context: {
    requestId?: string;
    retryable?: boolean;
    status: number;
    statusCode: number;
  };
  // The control plane's own message, kept apart from the formatted `message` so
  // a caller can quote it without the transport's description and status prefix.
  readonly detail: string | undefined;
  readonly requestId: string | undefined;
  readonly retryable: boolean | undefined;
  readonly status: number;
  readonly statusCode: number;

  constructor(input: {
    code?: string | undefined;
    description: string;
    message?: string | undefined;
    requestId?: string | undefined;
    retryable?: boolean | undefined;
    status: number;
  }) {
    super(formatHostedWebControlPlaneResponseErrorMessage(input));
    this.name = "HostedWebControlPlaneResponseError";
    this.code = input.code;
    this.detail = input.message?.trim() || undefined;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
    this.status = input.status;
    this.statusCode = input.status;
    this.context = {
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(typeof input.retryable === "boolean" ? { retryable: input.retryable } : {}),
      status: input.status,
      statusCode: input.status,
    };
  }
}

class HostedWebControlPlaneSensitiveResponseInvalidJsonError extends Error {
  readonly code = "HOSTED_WEB_CONTROL_SENSITIVE_RESPONSE_INVALID_JSON" as const;

  constructor(description: string) {
    super(`${description} returned invalid JSON.`);
    this.name = "HostedWebControlPlaneSensitiveResponseInvalidJsonError";
  }
}

export function resolveHostedWebControlTransport(input: {
  webCallbackSigning: HostedWebCallbackSigningEnvironment | null;
  webControlBaseUrl: string | null;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}): HostedWebControlTransport | null {
  if (input.webControlBaseUrl && input.webCallbackSigning) {
    return {
      callbackSigning: input.webCallbackSigning,
      mode: "direct",
      webControlBaseUrl: input.webControlBaseUrl,
      workspaceCheckpointBridge: input.workspaceCheckpointBridge,
    };
  }

  if (input.workspaceCheckpointBridge) {
    return {
      mode: "proxy",
    };
  }

  return null;
}
export async function fetchReplaySafeHostedWebControlPlaneJson(input: {
  body?: unknown;
  boundUserId: string;
  description: string;
  fetchImpl: typeof fetch;
  method?: "GET" | "POST";
  path: string;
  signal?: AbortSignal | null;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): Promise<unknown> {
  assertReplaySafeHostedWebControlRetryPath(input.path);

  let attempt = 0;
  let lastError: unknown;

  while (attempt < HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS) {
    try {
      return await fetchHostedWebControlPlaneJson(input);
    } catch (error) {
      attempt += 1;
      lastError = error;
      if (
        input.signal?.aborted
        || attempt >= HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS
        || !isRetryableHostedWebControlReadError(error)
      ) {
        throw error;
      }

      await sleepHostedReplaySafeReadRetryDelay();
      if (input.signal?.aborted) {
        throw input.signal.reason;
      }
    }
  }

  throw lastError;
}

function assertReplaySafeHostedWebControlRetryPath(path: string): void {
  const { pathname } = readHostedRunnerWebControlRoute(path);
  if (
    pathname !== HOSTED_RUNTIME_MAILBOX_FETCH_PATH
    && pathname !== HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH
  ) {
    throw new TypeError("Hosted web-control retry is only allowed for hosted mailbox reads.");
  }
}

export async function fetchHostedWebControlPlaneJson(
  input: HostedWebControlPlaneJsonRequest,
): Promise<unknown> {
  if (input.replayOnceOnRetryableFailure !== true) {
    return await fetchHostedWebControlPlaneJsonAttempt(input);
  }

  const deadlineMs = Date.now() + input.timeoutMs;
  try {
    return await fetchHostedWebControlPlaneJsonAttempt({
      ...input,
      timeoutMs: Math.max(0, deadlineMs - Date.now()),
    });
  } catch (error) {
    if (
      input.signal?.aborted
      || !isRetryableHostedWebControlExactReplayError(error)
      || Date.now() >= deadlineMs
    ) {
      throw error;
    }
  }

  return await fetchHostedWebControlPlaneJsonAttempt({
    ...input,
    timeoutMs: Math.max(0, deadlineMs - Date.now()),
  });
}

async function fetchHostedWebControlPlaneJsonAttempt(
  input: HostedWebControlPlaneJsonRequest,
): Promise<unknown> {
  if (
    input.sensitiveResponseBody
    && (
      !Number.isSafeInteger(input.sensitiveResponseBody.maxBytes)
      || input.sensitiveResponseBody.maxBytes < 0
    )
  ) {
    throw new TypeError("Sensitive web-control response maxBytes must be a non-negative integer.");
  }

  const method = input.method ?? (input.body === undefined ? "GET" : "POST");
  const route = readHostedRunnerWebControlRoute(input.path);
  assertAllowedHostedRunnerWebControlRequest({
    method,
    path: route.pathname,
  });
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const requestStartedAt = Date.now();
  const requestDeadlineMs = requestStartedAt + input.timeoutMs;
  const requestLogDetails = buildHostedWebControlRequestLogDetails({
    body,
    description: input.description,
    method,
    path: route.pathname,
    timeoutMs: input.timeoutMs,
    transport: input.transport,
  });

  emitHostedExecutionStructuredLog({
    component: "hosted.runtime.control-plane",
    details: requestLogDetails,
    message: "Hosted runtime control-plane request started.",
    phase: "runtime.starting",
    userId: input.boundUserId,
  });

  let response: Response;
  const directTimeoutSignal = input.transport.mode === "direct"
    ? AbortSignal.timeout(input.timeoutMs)
    : null;
  const directRequestSignal = directTimeoutSignal
    ? combineAbortSignalsWithCleanup(input.signal ?? null, directTimeoutSignal)
    : null;
  try {
    const directHeaders = input.transport.mode === "direct"
      ? await createHostedWebControlDirectHeaders({
        description: input.description,
        headers: input.headers,
        transport: input.transport,
      })
      : undefined;
    response = input.transport.mode === "direct"
      ? await fetchHostedExecutionWebControlPlaneResponse({
        baseUrl: input.transport.webControlBaseUrl,
        body,
        boundUserId: input.boundUserId,
        callbackSigning: input.transport.callbackSigning,
        fetchImpl: input.fetchImpl,
        headers: directHeaders,
        method,
        path: route.pathAndSearch,
        signal: directRequestSignal?.signal ?? null,
        timeoutMs: input.timeoutMs,
      })
      : await fetchHostedResponse({
        description: input.description,
        fetchImpl: input.fetchImpl,
        init: {
          ...(body === undefined ? {} : { body }),
          headers: createHostedWebControlProxyHeaders({
            headers: input.headers,
            hasJsonBody: body !== undefined,
          }),
          method,
        },
        redactedLogPath: createHostedWebControlLogPath(route.pathname),
        signal: input.signal ?? null,
        timeoutMs: input.timeoutMs,
        url: createHostedWebControlProxyUrl(route.pathAndSearch),
      });
  } catch (error) {
    const shouldPreserveError =
      shouldPreserveHostedRuntimeFetchError(error)
      || (
        error instanceof Error
        && error.message.startsWith(`${input.description} request failed`)
      );
    const loggedError = shouldPreserveError
      ? error
      : new HostedRuntimeControlPlaneFetchError({
        cause: error,
        description: input.description,
        signalState: {
          callerSignalAborted: input.signal?.aborted ?? false,
          requestSignalAborted: directRequestSignal?.signal.aborted ?? false,
          timeoutMs: input.timeoutMs,
          timeoutSignalAborted: directTimeoutSignal?.aborted ?? false,
        },
      });
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.control-plane",
      details: {
        ...requestLogDetails,
        durationMs: Date.now() - requestStartedAt,
        ...buildHostedRuntimeSafeErrorMetadata(loggedError),
      },
      level: "warn",
      message: "Hosted runtime control-plane request failed before response.",
      phase: "runtime.starting",
      userId: input.boundUserId,
    });

    if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
      throw error;
    }

    if (shouldPreserveError) {
      throw error;
    }

    throw loggedError;
  } finally {
    directRequestSignal?.dispose();
  }

  emitHostedExecutionStructuredLog({
    component: "hosted.runtime.control-plane",
    details: {
      ...requestLogDetails,
      acceptedStatus: input.acceptedStatuses?.includes(response.status) ?? false,
      contentLengthPresent: response.headers.has("content-length"),
      contentTypePresent: response.headers.has("content-type"),
      durationMs: Date.now() - requestStartedAt,
      responseOk: response.ok,
      responseStatus: response.status,
    },
    message: "Hosted runtime control-plane response received.",
    phase: "runtime.starting",
    userId: input.boundUserId,
  });

  const text = await readHostedWebControlPlaneResponseText({
    description: input.description,
    maxBytes: input.sensitiveResponseBody?.maxBytes,
    response,
    signal: input.signal ?? null,
    timeoutMs: Math.max(0, requestDeadlineMs - Date.now()),
  });
  const acceptedStatus = input.acceptedStatuses?.includes(response.status) ?? false;
  if (!response.ok && !acceptedStatus) {
    const error = createHostedWebControlPlaneResponseError({
      description: input.description,
      detail: input.sensitiveResponseBody ? "" : text.trim(),
      diagnosticCode: readHostedAssistantAskDiagnosticCode(response.headers),
      requestId: readHostedAssistantAskRequestId(response.headers),
      status: response.status,
    });
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: input.description,
        method,
        path: createHostedWebControlLogPath(route.pathname),
        responseOrigin: input.transport.mode === "direct"
          ? new URL(input.transport.webControlBaseUrl).origin
          : CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane,
        responseStatus: response.status,
        transport: input.transport.mode,
        userId: input.boundUserId,
      },
      error,
      level: "warn",
      message: "Hosted runtime control-plane response returned non-OK.",
      phase: "outbox",
      userId: input.boundUserId,
    });
    throw error;
  }

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.control-plane",
      details: {
        ...requestLogDetails,
        durationMs: Date.now() - requestStartedAt,
        ...buildHostedRuntimeSafeErrorMetadata(error, {
          includeSafeErrorText: false,
        }),
        responseBodyBytes: new TextEncoder().encode(text).byteLength,
        responseStatus: response.status,
      },
      level: "warn",
      message: "Hosted runtime control-plane response returned invalid JSON.",
      phase: "runtime.starting",
      userId: input.boundUserId,
    });
    if (input.sensitiveResponseBody) {
      throw new HostedWebControlPlaneSensitiveResponseInvalidJsonError(
        input.description,
      );
    }
    throw new Error(`${input.description} returned invalid JSON.`, { cause: error });
  }
}

async function readHostedWebControlPlaneResponseText(input: {
  description: string;
  maxBytes: number | undefined;
  response: Response;
  signal: AbortSignal | null;
  timeoutMs: number;
}): Promise<string> {
  const maxBytes = input.maxBytes;
  if (maxBytes !== undefined) {
    const contentLengthText =
      input.response.headers.get("content-length")?.trim() ?? "";
    const contentLength = /^\d+$/u.test(contentLengthText)
      ? Number(contentLengthText)
      : null;
    if (
      contentLength !== null
      && Number.isSafeInteger(contentLength)
      && contentLength > maxBytes
    ) {
      try {
        await input.response.body?.cancel();
      } catch {
        // The fixed-size rejection below is the authoritative failure.
      }
      throw createHostedWebControlPlaneResponseTooLargeError({
        description: input.description,
        maxBytes,
      });
    }
  }

  if (!input.response.body) {
    return "";
  }

  const decoder = new TextDecoder();
  let text = "";
  let totalBytes = 0;
  for await (const chunk of readHostedRuntimeResponseBodyChunks({
    body: input.response.body,
    description: input.description,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  })) {
    totalBytes += chunk.byteLength;
    if (maxBytes !== undefined && totalBytes > maxBytes) {
      throw createHostedWebControlPlaneResponseTooLargeError({
        description: input.description,
        maxBytes,
      });
    }
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function isRetryableHostedWebControlExactReplayError(error: unknown): boolean {
  if (error instanceof HostedWebControlPlaneResponseError) {
    return error.status >= 500 && error.status <= 599;
  }
  return isRetryableHostedRuntimeReplaySafeReadTransportError(error);
}

function createHostedWebControlPlaneResponseTooLargeError(input: {
  description: string;
  maxBytes: number;
}): Error {
  return new Error(
    `${input.description} response exceeded the ${input.maxBytes} byte safety limit.`,
  );
}

function createHostedWebControlPlaneResponseError(input: {
  description: string;
  detail: string;
  diagnosticCode?: string | undefined;
  requestId?: string | undefined;
  status: number;
}): HostedWebControlPlaneResponseError {
  const structured = parseHostedWebControlPlaneJsonError(input.detail);
  if (structured) {
    return new HostedWebControlPlaneResponseError({
      code: input.diagnosticCode ?? structured.code,
      description: input.description,
      message: structured.message,
      requestId: input.requestId,
      retryable: structured.retryable,
      status: input.status,
    });
  }

  return new HostedWebControlPlaneResponseError({
    code: input.diagnosticCode,
    description: input.description,
    message: input.detail,
    requestId: input.requestId,
    status: input.status,
  });
}

function readHostedAssistantAskDiagnosticCode(headers: Headers): string | undefined {
  const code = headers.get(HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER);
  return isHostedRuntimeAssistantAskDiagnosticCode(code) ? code : undefined;
}

function readHostedAssistantAskRequestId(headers: Headers): string | undefined {
  const requestId = headers.get(HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER);
  return isHostedRuntimeAssistantAskRequestId(requestId) ? requestId : undefined;
}

function formatHostedWebControlPlaneResponseErrorMessage(input: {
  description: string;
  message?: string | undefined;
  status: number;
}): string {
  const detail = input.message?.trim() ?? "";
  return detail.length > 0
    ? `${input.description} failed with HTTP ${input.status}. ${detail}`
    : `${input.description} failed with HTTP ${input.status}.`;
}

function parseHostedWebControlPlaneJsonError(detail: string): {
  code?: string | undefined;
  message?: string | undefined;
  retryable?: boolean | undefined;
} | null {
  if (!detail.startsWith("{")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return null;
  }

  const record = readHostedWebControlPlaneRecord(parsed);
  const error = readHostedWebControlPlaneRecord(record?.error);
  if (!error) {
    return null;
  }

  const code = readHostedWebControlPlaneString(error.code);
  const message = readHostedWebControlPlaneString(error.message);
  const retryable = typeof error.retryable === "boolean" ? error.retryable : undefined;
  if (!code && !message && retryable === undefined) {
    return null;
  }

  return {
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(retryable === undefined ? {} : { retryable }),
  };
}

function readHostedWebControlPlaneRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readHostedWebControlPlaneString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function createHostedWebControlDirectHeaders(input: {
  description: string;
  headers?: Headers;
  transport: Extract<HostedWebControlTransport, { mode: "direct" }>;
}): Promise<Headers | undefined> {
  if (!input.transport.workspaceCheckpointBridge) {
    return input.headers;
  }

  const headers = new Headers(input.headers);
  const hasCompleteWriteFence = hasCompleteHostedRuntimeWriteFenceHeaders(headers);
  if (hasAnyHostedRuntimeWriteFenceHeader(headers)) {
    if (!hasCompleteWriteFence) {
      throw new Error(`${input.description} has incomplete hosted runtime write-fence headers.`);
    }
  }

  const writeFenceHeaders = await requireHostedRuntimeWriteFenceHeaders(
    input.transport.workspaceCheckpointBridge,
    input.description,
  );
  if (
    hasCompleteWriteFence
    && !hasMatchingHostedRuntimeWriteFenceHeaders(headers, writeFenceHeaders)
  ) {
    throw new Error(`${input.description} has stale hosted runtime write-fence headers.`);
  }
  writeFenceHeaders.forEach((value, name) => {
    headers.set(name, value);
  });
  return headers;
}

function hasCompleteHostedRuntimeWriteFenceHeaders(headers: Headers): boolean {
  return headers.has(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)
    && headers.has(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)
    && headers.has(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER);
}

function hasAnyHostedRuntimeWriteFenceHeader(headers: Headers): boolean {
  return headers.has(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)
    || headers.has(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)
    || headers.has(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER);
}

function hasMatchingHostedRuntimeWriteFenceHeaders(
  actual: Headers,
  expected: Headers,
): boolean {
  return actual.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)
    === expected.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)
    && actual.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)
      === expected.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)
    && actual.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER)
      === expected.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER);
}

function buildHostedWebControlRequestLogDetails(input: {
  body: string | undefined;
  description: string;
  method: "GET" | "POST";
  path: string;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): HostedExecutionStructuredLogDetails {
  return {
    bodyBytes: input.body === undefined ? 0 : new TextEncoder().encode(input.body).byteLength,
    bodyPresent: input.body !== undefined,
    description: input.description,
    method: input.method,
    path: createHostedWebControlLogPath(input.path),
    responseOrigin: readHostedWebControlResponseOrigin(input.transport),
    timeoutMs: input.timeoutMs,
    transport: input.transport.mode,
  };
}

function readHostedWebControlResponseOrigin(transport: HostedWebControlTransport): string {
  return transport.mode === "direct"
    ? new URL(transport.webControlBaseUrl).origin
    : CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane;
}

function createHostedWebControlProxyUrl(path: string): URL {
  return new URL(
    path.replace(/^\/+/u, ""),
    `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}/`,
  );
}

function createHostedWebControlLogPath(path: string): string {
  const url = new URL(path.replace(/^\/+/u, ""), "https://hosted-runtime.invalid/");
  return url.pathname;
}

function createHostedWebControlProxyHeaders(input: {
  headers?: Headers;
  hasJsonBody: boolean;
}): Headers | undefined {
  const headers = new Headers(input.headers);
  let hasHeaders = false;

  if (input.hasJsonBody) {
    headers.set("content-type", "application/json");
    hasHeaders = true;
  }

  headers.forEach(() => {
    hasHeaders = true;
  });

  return hasHeaders ? headers : undefined;
}
