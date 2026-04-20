import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_WAKE_FETCH_PROOF_STALE_ERROR_CODE,
  type HostedWakeCommitRequest,
  type HostedWakeCommitResponse,
  type HostedWakeFetchRequest,
  type HostedWakeFetchResponse,
  type HostedWakeFinalizeRequest,
  type HostedWakeFinalizeResponse,
  type HostedRunAcquireRequest,
  type HostedRunAcquireResponse,
  type HostedRunCommitRequest,
  type HostedRunCommitResponse,
  type HostedRunFinalizeRequest,
  type HostedRunFinalizeResponse,
  type HostedRunLogRequest,
  type HostedRunLogResponse,
  type HostedRunStatusRequest,
  type HostedRunStatusResponse,
  type HostedWakeMaterializeResponse,
  type HostedWakeTerminalRequest,
  type HostedWakeTerminalResponse,
  type HostedWakeQuarantineRequest,
  type HostedWakeQuarantineResponse,
  type HostedWakeStatusRequest,
  type HostedWakeStatusResponse,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedWakeCommitResponse,
  parseHostedWakeFetchResponse,
  parseHostedWakeFinalizeResponse,
  parseHostedWakeMaterializeResponse,
  parseHostedWakeTerminalResponse,
  parseHostedWakeQuarantineResponse,
  parseHostedWakeStatusResponse,
  parseHostedRunAcquireResponse,
  parseHostedRunCommitResponse,
  parseHostedRunFinalizeResponse,
  parseHostedRunLogResponse,
  parseHostedRunStatusResponse,
} from "@murphai/hosted-execution/parsers";
import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";

import {
  createHostedWebCallbackSignatureHeaders,
  type HostedWebCallbackSigningEnvironment,
} from "./web-callback-auth.ts";

interface JsonErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export class HostedWakeTerminalStaleFetchProofError extends Error {
  constructor(message = "Hosted wake terminal receipt lost the current fetch fence.") {
    super(message);
    this.name = "HostedWakeTerminalStaleFetchProofError";
  }
}

export function normalizeHostedWebControlBaseUrl(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHostedExecutionBaseUrl(value, {
    allowHttpLocalhost: true,
  });

  return normalized ? new URL(normalized).origin : null;
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

const HOSTED_WEB_HOSTED_WAKE_COMMIT_PATH = "/api/internal/hosted-wake/commit";
const HOSTED_WEB_HOSTED_WAKE_FINALIZE_PATH = "/api/internal/hosted-wake/finalize";
const HOSTED_WEB_HOSTED_WAKE_MATERIALIZE_PATH = "/api/internal/hosted-wake/materialize";
const HOSTED_WEB_HOSTED_WAKE_TERMINAL_PATH = "/api/internal/hosted-wake/terminal";
const HOSTED_WEB_HOSTED_WAKE_QUARANTINE_PATH = "/api/internal/hosted-wake/quarantine";
const HOSTED_WEB_HOSTED_WAKE_STATUS_PATH = "/api/internal/hosted-wake/status";
const HOSTED_WEB_HOSTED_WAKE_UNSEEN_PATH = "/api/internal/hosted-wake/unseen";
const HOSTED_WEB_HOSTED_RUN_ACQUIRE_PATH = "/api/internal/hosted-run/acquire";
const HOSTED_WEB_HOSTED_RUN_COMMIT_PATH = "/api/internal/hosted-run/commit";
const HOSTED_WEB_HOSTED_RUN_FINALIZE_PATH = "/api/internal/hosted-run/finalize";
const HOSTED_WEB_HOSTED_RUN_LOG_PATH = "/api/internal/hosted-run/log";
const HOSTED_WEB_HOSTED_RUN_STATUS_PATH = "/api/internal/hosted-run/status";

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
    body: JSON.stringify(input.body),
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

export async function fetchHostedWakeBatchFromWeb(input: {
  baseUrl: string;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  limit?: number | null;
  timeoutMs: number | null;
}): Promise<HostedWakeFetchResponse> {
  const body = JSON.stringify({
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  } satisfies HostedWakeFetchRequest);
  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.baseUrl,
      body,
      boundUserId: input.boundUserId,
      callbackSigning: input.callbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_HOSTED_WAKE_UNSEEN_PATH,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    emitHostedWebControlPlaneRequestFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake batch fetch",
      error,
      path: HOSTED_WEB_HOSTED_WAKE_UNSEEN_PATH,
    });
    throw error;
  }

  if (!response.ok) {
    const responseDetail = (await response.text()).trim();
    throw emitHostedWebControlPlaneResponseFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake batch fetch",
      path: HOSTED_WEB_HOSTED_WAKE_UNSEEN_PATH,
      responseDetail: responseDetail.length > 0 ? responseDetail : null,
      response,
    });
  }

  return parseHostedWakeFetchResponse(await response.json());
}

export async function commitHostedWakeCursorToWeb(input: {
  baseUrl: string;
  body: HostedWakeCommitRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedWakeCommitResponse> {
  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.baseUrl,
      body: JSON.stringify(input.body),
      boundUserId: input.boundUserId,
      callbackSigning: input.callbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_HOSTED_WAKE_COMMIT_PATH,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    emitHostedWebControlPlaneRequestFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake cursor commit",
      error,
      path: HOSTED_WEB_HOSTED_WAKE_COMMIT_PATH,
    });
    throw error;
  }

  if (!response.ok) {
    const responseDetail = (await response.text()).trim();
    throw emitHostedWebControlPlaneResponseFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake cursor commit",
      path: HOSTED_WEB_HOSTED_WAKE_COMMIT_PATH,
      responseDetail: responseDetail.length > 0 ? responseDetail : null,
      response,
    });
  }

  return parseHostedWakeCommitResponse(await response.json());
}

export async function finalizeHostedWakeCursorInWeb(input: {
  baseUrl: string;
  body: HostedWakeFinalizeRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedWakeFinalizeResponse> {
  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.baseUrl,
      body: JSON.stringify(input.body),
      boundUserId: input.boundUserId,
      callbackSigning: input.callbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_HOSTED_WAKE_FINALIZE_PATH,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    emitHostedWebControlPlaneRequestFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake cursor finalize",
      error,
      path: HOSTED_WEB_HOSTED_WAKE_FINALIZE_PATH,
    });
    throw error;
  }

  if (!response.ok) {
    const responseDetail = (await response.text()).trim();
    throw emitHostedWebControlPlaneResponseFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake cursor finalize",
      path: HOSTED_WEB_HOSTED_WAKE_FINALIZE_PATH,
      responseDetail: responseDetail.length > 0 ? responseDetail : null,
      response,
    });
  }

  return parseHostedWakeFinalizeResponse(await response.json());
}

export async function recordHostedWakeTerminalInWeb(input: {
  baseUrl: string;
  body: HostedWakeTerminalRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedWakeTerminalResponse> {
  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.baseUrl,
      body: JSON.stringify(input.body),
      boundUserId: input.boundUserId,
      callbackSigning: input.callbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_HOSTED_WAKE_TERMINAL_PATH,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    emitHostedWebControlPlaneRequestFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake terminal record",
      error,
      path: HOSTED_WEB_HOSTED_WAKE_TERMINAL_PATH,
    });
    throw error;
  }

  if (!response.ok) {
    const errorBody = await readJsonErrorBody(response);

    if (
      response.status === 409
      && errorBody?.error?.code === HOSTED_WAKE_FETCH_PROOF_STALE_ERROR_CODE
    ) {
      const error = new HostedWakeTerminalStaleFetchProofError(
        typeof errorBody.error.message === "string" && errorBody.error.message.length > 0
          ? errorBody.error.message
          : undefined,
      );
      emitHostedWebControlPlaneResponseFailure({
        boundUserId: input.boundUserId,
        description: "Hosted wake terminal record",
        error,
        path: HOSTED_WEB_HOSTED_WAKE_TERMINAL_PATH,
        response,
        responseDetail: typeof errorBody.error.message === "string"
          ? errorBody.error.message
          : null,
      });
      throw error;
    }

    const responseDetail = (await response.text()).trim();
    throw emitHostedWebControlPlaneResponseFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake terminal record",
      path: HOSTED_WEB_HOSTED_WAKE_TERMINAL_PATH,
      responseDetail: responseDetail.length > 0 ? responseDetail : null,
      response,
    });
  }

  return parseHostedWakeTerminalResponse(await response.json());
}

export async function materializeHostedDueWakesInWeb(input: {
  baseUrl: string;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedWakeMaterializeResponse> {
  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.baseUrl,
      boundUserId: input.boundUserId,
      callbackSigning: input.callbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_HOSTED_WAKE_MATERIALIZE_PATH,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    emitHostedWebControlPlaneRequestFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake materialize",
      error,
      path: HOSTED_WEB_HOSTED_WAKE_MATERIALIZE_PATH,
    });
    throw error;
  }

  if (!response.ok) {
    const responseDetail = (await response.text()).trim();
    throw emitHostedWebControlPlaneResponseFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake materialize",
      path: HOSTED_WEB_HOSTED_WAKE_MATERIALIZE_PATH,
      responseDetail: responseDetail.length > 0 ? responseDetail : null,
      response,
    });
  }

  return parseHostedWakeMaterializeResponse(await response.json());
}

export async function quarantineHostedWakeInWeb(input: {
  baseUrl: string;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  fetchProof: string;
  quarantineCode: string;
  timeoutMs: number | null;
  wakeId: string;
  wakeSeq: string;
}): Promise<HostedWakeQuarantineResponse> {
  const body = JSON.stringify({
    fetchProof: input.fetchProof,
    quarantineCode: input.quarantineCode,
    wakeId: input.wakeId,
    wakeSeq: input.wakeSeq,
  } satisfies HostedWakeQuarantineRequest);
  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.baseUrl,
      body,
      boundUserId: input.boundUserId,
      callbackSigning: input.callbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_HOSTED_WAKE_QUARANTINE_PATH,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    emitHostedWebControlPlaneRequestFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake quarantine",
      error,
      path: HOSTED_WEB_HOSTED_WAKE_QUARANTINE_PATH,
    });
    throw error;
  }

  if (!response.ok) {
    const responseDetail = (await response.text()).trim();
    throw emitHostedWebControlPlaneResponseFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake quarantine",
      path: HOSTED_WEB_HOSTED_WAKE_QUARANTINE_PATH,
      responseDetail: responseDetail.length > 0 ? responseDetail : null,
      response,
    });
  }

  return parseHostedWakeQuarantineResponse(await response.json());
}

export async function readHostedWakeStatusFromWeb(input: {
  baseUrl: string;
  body?: HostedWakeStatusRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedWakeStatusResponse> {
  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.baseUrl,
      body: JSON.stringify(input.body ?? {}),
      boundUserId: input.boundUserId,
      callbackSigning: input.callbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_HOSTED_WAKE_STATUS_PATH,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    emitHostedWebControlPlaneRequestFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake status read",
      error,
      path: HOSTED_WEB_HOSTED_WAKE_STATUS_PATH,
    });
    throw error;
  }

  if (!response.ok) {
    const responseDetail = (await response.text()).trim();
    throw emitHostedWebControlPlaneResponseFailure({
      boundUserId: input.boundUserId,
      description: "Hosted wake status read",
      path: HOSTED_WEB_HOSTED_WAKE_STATUS_PATH,
      responseDetail: responseDetail.length > 0 ? responseDetail : null,
      response,
    });
  }

  return parseHostedWakeStatusResponse(await response.json());
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
    const responseDetail = (await response.text()).trim();
    throw emitHostedWebControlPlaneResponseFailure({
      boundUserId: input.input.boundUserId,
      description: input.description,
      path: input.path,
      responseDetail: responseDetail.length > 0 ? responseDetail : null,
      response,
    });
  }

  return input.parse(await response.json());
}

function requireHostedWebControlBaseUrl(value: string): string {
  const normalized = normalizeHostedWebControlBaseUrl(value);

  if (!normalized) {
    throw new TypeError("Hosted web control-plane baseUrl must be configured.");
  }

  return normalized;
}

async function readJsonErrorBody(response: Response): Promise<JsonErrorBody | null> {
  const contentType = response.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("application/json")) {
    return null;
  }

  try {
    const body = await response.json();
    return body && typeof body === "object" ? body as JsonErrorBody : null;
  } catch {
    return null;
  }
}

function emitHostedWebControlPlaneRequestFailure(input: {
  boundUserId: string;
  description: string;
  error: unknown;
  path: string;
}): void {
  emitHostedExecutionStructuredLog({
    component: "assistant-delivery",
    details: {
      description: input.description,
      path: input.path,
      userId: input.boundUserId,
    },
    error: input.error,
    level: "warn",
    message: "Hosted web control-plane request failed.",
    phase: "side-effects.draining",
    userId: input.boundUserId,
  });
}

function emitHostedWebControlPlaneResponseFailure(input: {
  boundUserId: string;
  description: string;
  error?: Error;
  path: string;
  response: Response;
  responseDetail?: string | null;
}): Error {
  const error = input.error ?? createHostedWebControlPlaneResponseError({
    description: input.description,
    response: input.response,
    responseDetail: input.responseDetail ?? null,
  });

  emitHostedExecutionStructuredLog({
    component: "assistant-delivery",
    details: {
      description: input.description,
      path: input.path,
      responseStatus: input.response.status,
      ...(input.responseDetail ? { responseDetail: input.responseDetail } : {}),
      userId: input.boundUserId,
    },
    error,
    level: "warn",
    message: "Hosted web control-plane response returned non-OK.",
    phase: "side-effects.draining",
    userId: input.boundUserId,
  });

  return error;
}

function createHostedWebControlPlaneResponseError(input: {
  description: string;
  response: Response;
  responseDetail?: string | null;
}): Error & {
  status: number;
  statusCode: number;
} {
  const detail = input.responseDetail?.trim() ?? "";
  const error = new Error(
    detail.length > 0
      ? `${input.description} failed with HTTP ${input.response.status}. ${detail}`
      : `${input.description} failed with HTTP ${input.response.status}.`,
  ) as Error & {
    status: number;
    statusCode: number;
  };

  error.status = input.response.status;
  error.statusCode = input.response.status;
  return error;
}
