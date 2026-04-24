import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUN_STALE_RUNNER_USER_ERROR_CODE,
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedRunAcquireRequest,
  type HostedRunAcquireResponse,
  type HostedRunCommitRequest,
  type HostedRunCommitResponse,
  type HostedRunFinalizeRequest,
  type HostedRunFinalizeResponse,
  type HostedRunLogRequest,
  type HostedRunLogResponse,
  type HostedRunReleaseFinalizeRequest,
  type HostedRunReleaseFinalizeResponse,
  type HostedRunStatusRequest,
  type HostedRunStatusResponse,
  type HostedRunTurnInputAdoptRequest,
  type HostedRunTurnInputAdoptResponse,
  type HostedRunTurnInputPeekRequest,
  type HostedRunTurnInputPeekResponse,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedRunAcquireResponse,
  parseHostedRunCommitResponse,
  parseHostedRunFinalizeResponse,
  parseHostedRunLogResponse,
  parseHostedRunReleaseFinalizeResponse,
  parseHostedRunStatusResponse,
  parseHostedRunTurnInputAdoptResponse,
  parseHostedRunTurnInputPeekResponse,
} from "@murphai/hosted-execution/parsers";
import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";

import {
  createHostedWebCallbackSignatureHeaders,
  type HostedWebCallbackSigningEnvironment,
} from "./web-callback-auth.ts";

export function normalizeHostedWebControlBaseUrl(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHostedExecutionBaseUrl(value, {
    allowHttpLocalhost: true,
    requireOriginOnly: true,
  });

  return normalized ?? null;
}

export async function fetchHostedExecutionWebControlPlaneResponse(input: {
  baseUrl: string;
  body?: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  method: "GET" | "POST";
  path: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  search?: string | null;
  timeoutMs: number | null;
}): Promise<Response> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const targetUrl = new URL(
    input.path.replace(/^\/+/u, ""),
    `${requireHostedWebControlBaseUrl(input.baseUrl)}/`,
  );

  if (input.search) {
    targetUrl.search = input.search;
  }

  const headers = new Headers();
  headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.boundUserId);

  if (input.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (input.callbackSigning) {
    const signatureHeaders = await createHostedWebCallbackSignatureHeaders({
      environment: input.callbackSigning,
      method: input.method,
      nonce: null,
      path: targetUrl.pathname,
      payload: input.body ?? "",
      search: targetUrl.search,
      userId: input.boundUserId,
    });

    for (const key of Object.keys(signatureHeaders)) {
      const value = signatureHeaders[key];

      if (typeof value === "string") {
        headers.set(key, value);
      }
    }
  }

  return fetchImpl(targetUrl.toString(), {
    ...(input.body === undefined ? {} : { body: input.body }),
    headers,
    method: input.method,
    redirect: "manual",
    signal: typeof input.timeoutMs === "number" ? AbortSignal.timeout(input.timeoutMs) : undefined,
  });
}

const HOSTED_WEB_HOSTED_RUN_ACQUIRE_PATH = "/api/internal/hosted-run/acquire";
const HOSTED_WEB_HOSTED_RUN_COMMIT_PATH = "/api/internal/hosted-run/commit";
const HOSTED_WEB_HOSTED_RUN_FINALIZE_PATH = "/api/internal/hosted-run/finalize";
const HOSTED_WEB_HOSTED_RUN_LOG_PATH = "/api/internal/hosted-run/log";
const HOSTED_WEB_HOSTED_RUN_RELEASE_FINALIZE_PATH = "/api/internal/hosted-run/release-finalize";
const HOSTED_WEB_HOSTED_RUN_STATUS_PATH = "/api/internal/hosted-run/status";
const HOSTED_WEB_HOSTED_RUN_TURN_INPUT_ADOPT_PATH =
  "/api/internal/hosted-run/turn-input/adopt";
const HOSTED_WEB_HOSTED_RUN_TURN_INPUT_PEEK_PATH =
  "/api/internal/hosted-run/turn-input/peek";

interface HostedWebControlPlaneJsonError {
  code: string | null;
  details: unknown;
  message: string | null;
  retryable: boolean | null;
}

export class HostedWebControlPlaneResponseError extends Error {
  readonly description: string;
  readonly errorCode: string | null;
  readonly errorDetails: unknown;
  readonly path: string;
  readonly responseDetail: string | null;
  readonly retryable: boolean | null;
  readonly status: number;

  constructor(input: {
    description: string;
    error: HostedWebControlPlaneJsonError | null;
    path: string;
    responseDetail: string | null;
    status: number;
  }) {
    const baseMessage = `${input.description} failed with HTTP ${input.status}.`;
    super(input.responseDetail ? `${baseMessage} ${input.responseDetail}` : baseMessage);
    this.name = "HostedWebControlPlaneResponseError";
    this.description = input.description;
    this.errorCode = input.error?.code ?? null;
    this.errorDetails = input.error?.details ?? null;
    this.path = input.path;
    this.responseDetail = input.responseDetail;
    this.retryable = input.error?.retryable ?? null;
    this.status = input.status;
  }
}

export function isHostedRunStaleRunnerAcquireError(
  error: unknown,
): error is HostedWebControlPlaneResponseError {
  return error instanceof HostedWebControlPlaneResponseError
    && error.path === HOSTED_WEB_HOSTED_RUN_ACQUIRE_PATH
    && error.errorCode === HOSTED_RUN_STALE_RUNNER_USER_ERROR_CODE
    && error.retryable === false
    && (error.status === 404 || error.status === 410);
}

export async function acquireHostedRunFromWeb(input: {
  baseUrl: string;
  body?: HostedRunAcquireRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedRunAcquireResponse> {
  return requestHostedWebControlPlaneJson({
    body: JSON.stringify(input.body ?? {}),
    description: "Hosted run acquire",
    input,
    parse: parseHostedRunAcquireResponse,
    path: HOSTED_WEB_HOSTED_RUN_ACQUIRE_PATH,
  });
}

export async function commitHostedRunToWeb(input: {
  baseUrl: string;
  body: HostedRunCommitRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedRunCommitResponse> {
  return requestHostedWebControlPlaneJson({
    body: JSON.stringify(requireExplicitHostedRunCommitFinalizeRequired(input.body)),
    description: "Hosted run commit",
    input,
    parse: parseHostedRunCommitResponse,
    path: HOSTED_WEB_HOSTED_RUN_COMMIT_PATH,
  });
}

export async function finalizeHostedRunInWeb(input: {
  baseUrl: string;
  body: HostedRunFinalizeRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedRunFinalizeResponse> {
  return requestHostedWebControlPlaneJson({
    body: JSON.stringify(input.body),
    description: "Hosted run finalize",
    input,
    parse: parseHostedRunFinalizeResponse,
    path: HOSTED_WEB_HOSTED_RUN_FINALIZE_PATH,
  });
}

export async function recordHostedRunLogInWeb(input: {
  baseUrl: string;
  body: HostedRunLogRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedRunLogResponse> {
  return requestHostedWebControlPlaneJson({
    body: JSON.stringify(input.body),
    description: "Hosted run log",
    input,
    parse: parseHostedRunLogResponse,
    path: HOSTED_WEB_HOSTED_RUN_LOG_PATH,
  });
}

export async function releaseHostedRunFinalizeInWeb(input: {
  baseUrl: string;
  body: HostedRunReleaseFinalizeRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedRunReleaseFinalizeResponse> {
  return requestHostedWebControlPlaneJson({
    body: JSON.stringify(input.body),
    description: "Hosted run release-finalize",
    input,
    parse: parseHostedRunReleaseFinalizeResponse,
    path: HOSTED_WEB_HOSTED_RUN_RELEASE_FINALIZE_PATH,
  });
}

export async function readHostedRunStatusFromWeb(input: {
  baseUrl: string;
  body?: HostedRunStatusRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedRunStatusResponse> {
  return requestHostedWebControlPlaneJson({
    body: JSON.stringify(input.body ?? {}),
    description: "Hosted run status read",
    input,
    parse: parseHostedRunStatusResponse,
    path: HOSTED_WEB_HOSTED_RUN_STATUS_PATH,
  });
}

export async function peekHostedRunTurnInputFromWeb(input: {
  baseUrl: string;
  body: HostedRunTurnInputPeekRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedRunTurnInputPeekResponse> {
  return requestHostedWebControlPlaneJson({
    body: JSON.stringify(input.body),
    description: "Hosted run turn-input peek",
    input,
    parse: parseHostedRunTurnInputPeekResponse,
    path: HOSTED_WEB_HOSTED_RUN_TURN_INPUT_PEEK_PATH,
  });
}

export async function adoptHostedRunTurnInputInWeb(input: {
  baseUrl: string;
  body: HostedRunTurnInputAdoptRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedRunTurnInputAdoptResponse> {
  return requestHostedWebControlPlaneJson({
    body: JSON.stringify(input.body),
    description: "Hosted run turn-input adopt",
    input,
    parse: parseHostedRunTurnInputAdoptResponse,
    path: HOSTED_WEB_HOSTED_RUN_TURN_INPUT_ADOPT_PATH,
  });
}

async function requestHostedWebControlPlaneJson<TResponse>(input: {
  body: string;
  description: string;
  input: {
    baseUrl: string;
    boundUserId: string;
    callbackSigning?: HostedWebCallbackSigningEnvironment | null;
    fetchImpl?: typeof fetch;
    timeoutMs: number | null;
  };
  parse: (value: unknown) => TResponse;
  path: string;
}): Promise<TResponse> {
  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.input.baseUrl,
      body: input.body,
      boundUserId: input.input.boundUserId,
      callbackSigning: input.input.callbackSigning,
      fetchImpl: input.input.fetchImpl,
      method: "POST",
      path: input.path,
      timeoutMs: input.input.timeoutMs,
    });
  } catch (error) {
    emitHostedWebControlPlaneRequestFailure({
      boundUserId: input.input.boundUserId,
      description: input.description,
      error,
      path: input.path,
    });
    throw error;
  }

  if (!response.ok) {
    const failure = await readHostedWebControlPlaneFailure(response);
    throw emitHostedWebControlPlaneResponseFailure({
      boundUserId: input.input.boundUserId,
      description: input.description,
      path: input.path,
      responseDetail: failure.responseDetail,
      response,
      webError: failure.error,
    });
  }

  return input.parse(await response.json());
}

function emitHostedWebControlPlaneRequestFailure(input: {
  boundUserId: string;
  description: string;
  error: unknown;
  path: string;
}): void {
  emitHostedExecutionStructuredLog({
    component: "cloudflare.web-control-plane",
    details: {
      description: input.description,
      path: input.path,
    },
    error: input.error,
    level: "warn",
    message: `${input.description} request failed before a response was received.`,
    phase: "wake.running",
    userId: input.boundUserId,
  });
}

function emitHostedWebControlPlaneResponseFailure(input: {
  boundUserId: string;
  description: string;
  path: string;
  response: Response;
  responseDetail: string | null;
  webError: HostedWebControlPlaneJsonError | null;
}): Error {
  const message = `${input.description} failed with HTTP ${input.response.status}.`;
  const error = new HostedWebControlPlaneResponseError({
    description: input.description,
    error: input.webError,
    path: input.path,
    responseDetail: input.responseDetail,
    status: input.response.status,
  });

  emitHostedExecutionStructuredLog({
    component: "cloudflare.web-control-plane",
    details: {
      description: input.description,
      errorCode: input.webError?.code ?? "",
      path: input.path,
      responseDetail: input.responseDetail ?? "",
      retryable: input.webError?.retryable ?? "",
      status: String(input.response.status),
    },
    level: "warn",
    message,
    phase: "wake.running",
    userId: input.boundUserId,
  });

  return error;
}

async function readHostedWebControlPlaneFailure(response: Response): Promise<{
  error: HostedWebControlPlaneJsonError | null;
  responseDetail: string | null;
}> {
  const responseDetail = (await response.text()).trim();
  const parsed = responseDetail.length > 0
    ? parseHostedWebControlPlaneJsonErrorResponse(responseDetail)
    : null;

  return {
    error: parsed,
    responseDetail: responseDetail.length > 0 ? responseDetail : null,
  };
}

function parseHostedWebControlPlaneJsonErrorResponse(
  responseDetail: string,
): HostedWebControlPlaneJsonError | null {
  try {
    return readHostedWebControlPlaneJsonError(JSON.parse(responseDetail));
  } catch {
    return null;
  }
}

function readHostedWebControlPlaneJsonError(
  value: unknown,
): HostedWebControlPlaneJsonError | null {
  if (!isRecord(value) || !isRecord(value.error)) {
    return null;
  }

  return {
    code: typeof value.error.code === "string" ? value.error.code : null,
    details: "details" in value.error ? value.error.details : null,
    message: typeof value.error.message === "string" ? value.error.message : null,
    retryable: typeof value.error.retryable === "boolean" ? value.error.retryable : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireHostedWebControlBaseUrl(value: string): string {
  const normalized = normalizeHostedWebControlBaseUrl(value);

  if (!normalized) {
    throw new TypeError("Hosted web control-plane baseUrl must be configured.");
  }

  return normalized;
}

function requireExplicitHostedRunCommitFinalizeRequired(
  body: HostedRunCommitRequest,
): HostedRunCommitRequest {
  if (typeof body.finalizeRequired !== "boolean") {
    throw new TypeError("Hosted run commit finalizeRequired must be provided explicitly.");
  }

  return body;
}
