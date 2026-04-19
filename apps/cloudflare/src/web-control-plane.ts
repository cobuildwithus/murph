import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_WAKE_FETCH_PROOF_STALE_ERROR_CODE,
  type HostedWakeCommitRequest,
  type HostedWakeCommitResponse,
  type HostedWakeFetchRequest,
  type HostedWakeFetchResponse,
  type HostedWakeFinalizeRequest,
  type HostedWakeFinalizeResponse,
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
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    body,
    boundUserId: input.boundUserId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_WEB_HOSTED_WAKE_UNSEEN_PATH,
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Hosted wake batch fetch failed with HTTP ${response.status}.`);
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
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    body: JSON.stringify(input.body),
    boundUserId: input.boundUserId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_WEB_HOSTED_WAKE_COMMIT_PATH,
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Hosted wake cursor commit failed with HTTP ${response.status}.`);
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
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    body: JSON.stringify(input.body),
    boundUserId: input.boundUserId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_WEB_HOSTED_WAKE_FINALIZE_PATH,
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Hosted wake cursor finalize failed with HTTP ${response.status}.`);
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
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    body: JSON.stringify(input.body),
    boundUserId: input.boundUserId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_WEB_HOSTED_WAKE_TERMINAL_PATH,
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    const errorBody = await readJsonErrorBody(response);

    if (
      response.status === 409
      && errorBody?.error?.code === HOSTED_WAKE_FETCH_PROOF_STALE_ERROR_CODE
    ) {
      throw new HostedWakeTerminalStaleFetchProofError(
        typeof errorBody.error.message === "string" && errorBody.error.message.length > 0
          ? errorBody.error.message
          : undefined,
      );
    }

    throw new Error(`Hosted wake terminal record failed with HTTP ${response.status}.`);
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
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    boundUserId: input.boundUserId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_WEB_HOSTED_WAKE_MATERIALIZE_PATH,
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Hosted wake materialize failed with HTTP ${response.status}.`);
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
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    body,
    boundUserId: input.boundUserId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_WEB_HOSTED_WAKE_QUARANTINE_PATH,
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Hosted wake quarantine failed with HTTP ${response.status}.`);
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
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    body: JSON.stringify(input.body ?? {}),
    boundUserId: input.boundUserId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_WEB_HOSTED_WAKE_STATUS_PATH,
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Hosted wake status read failed with HTTP ${response.status}.`);
  }

  return parseHostedWakeStatusResponse(await response.json());
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
