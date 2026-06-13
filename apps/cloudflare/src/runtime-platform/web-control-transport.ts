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
  HostedRuntimeControlPlaneFetchError,
  HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS,
  combineAbortSignalsWithCleanup,
  isRetryableHostedWebControlReadError,
  shouldPreserveHostedRuntimeFetchError,
  sleepHostedReplaySafeReadRetryDelay,
} from "./control-plane-fetch.ts";
import { buildHostedRuntimeSafeErrorMetadata } from "./diagnostics.ts";
import { fetchHostedResponse } from "./hosted-http.ts";
import {
  isHostedRuntimeInternalAuthorityRejectedError,
  requireHostedRuntimeWriteFenceHeaders,
  type HostedWorkspaceCheckpointBridgeAuthority,
} from "./authority-headers.ts";

export type HostedWebControlTransport =
  | {
    allowHttpHosts?: readonly string[];
    callbackSigning: HostedWebCallbackSigningEnvironment;
    mode: "direct";
    webControlBaseUrl: string;
    workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
  }
  | {
    mode: "proxy";
  };
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
        attempt >= HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS
        || !isRetryableHostedWebControlReadError(error)
      ) {
        throw error;
      }

      await sleepHostedReplaySafeReadRetryDelay();
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

export async function fetchHostedWebControlPlaneJson(input: {
  acceptedStatuses?: readonly number[];
  body?: unknown;
  boundUserId: string;
  description: string;
  fetchImpl: typeof fetch;
  headers?: Headers;
  method?: "GET" | "POST";
  path: string;
  signal?: AbortSignal | null;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): Promise<unknown> {
  const method = input.method ?? (input.body === undefined ? "GET" : "POST");
  const route = readHostedRunnerWebControlRoute(input.path);
  assertAllowedHostedRunnerWebControlRequest({
    method,
    path: route.pathname,
  });
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const requestStartedAt = Date.now();
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
        ...(input.transport.allowHttpHosts
          ? { allowHttpHosts: input.transport.allowHttpHosts }
          : {}),
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

  const acceptedStatus = input.acceptedStatuses?.includes(response.status) ?? false;
  if (!response.ok && !acceptedStatus) {
    const detail = (await response.text()).trim();
    const error = new Error(
      detail.length > 0
        ? `${input.description} failed with HTTP ${response.status}. ${detail}`
        : `${input.description} failed with HTTP ${response.status}.`,
    ) as Error & {
      status: number;
      statusCode: number;
    };
    error.status = response.status;
    error.statusCode = response.status;
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

  const text = await response.text();
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
    throw new Error(`${input.description} returned invalid JSON.`, { cause: error });
  }
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
