import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionWake,
  type HostedWakeAppendRequest,
  type HostedWakeAppendResponse,
  type HostedWakeCommitRequest,
  type HostedWakeCommitResponse,
  type HostedWakeFetchRequest,
  type HostedWakeFetchResponse,
  type HostedWakeMaterializeRequest,
  type HostedWakeMaterializeResponse,
  type HostedWakeTerminalRequest,
  type HostedWakeTerminalResponse,
  type HostedWakeQuarantineRequest,
  type HostedWakeQuarantineResponse,
  type HostedWakeStatusRequest,
  type HostedWakeStatusResponse,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedWakeAppendResponse,
  parseHostedWakeCommitResponse,
  parseHostedWakeFetchResponse,
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

const HOSTED_WEB_HOSTED_WAKE_APPEND_PATH = "/api/internal/hosted-wake/append";
const HOSTED_WEB_HOSTED_WAKE_COMMIT_PATH = "/api/internal/hosted-wake/commit";
const HOSTED_WEB_HOSTED_WAKE_MATERIALIZE_PATH = "/api/internal/hosted-wake/materialize";
const HOSTED_WEB_HOSTED_WAKE_TERMINAL_PATH = "/api/internal/hosted-wake/terminal";
const HOSTED_WEB_HOSTED_WAKE_QUARANTINE_PATH = "/api/internal/hosted-wake/quarantine";
const HOSTED_WEB_HOSTED_WAKE_STATUS_PATH = "/api/internal/hosted-wake/status";
const HOSTED_WEB_HOSTED_WAKE_UNSEEN_PATH = "/api/internal/hosted-wake/unseen";

export async function appendHostedWakeInWeb(input: {
  baseUrl: string;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
  wake: HostedExecutionWake;
}): Promise<HostedWakeAppendResponse> {
  const body = JSON.stringify({
    wake: input.wake,
  } satisfies HostedWakeAppendRequest);
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    body,
    boundUserId: input.boundUserId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_WEB_HOSTED_WAKE_APPEND_PATH,
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Hosted wake append failed with HTTP ${response.status}.`);
  }

  return parseHostedWakeAppendResponse(await response.json());
}

export async function fetchHostedWakeBatchFromWeb(input: {
  afterSeq?: string | null;
  baseUrl: string;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  limit?: number | null;
  timeoutMs: number | null;
}): Promise<HostedWakeFetchResponse> {
  const body = JSON.stringify({
    ...(input.afterSeq === undefined ? {} : { afterSeq: input.afterSeq }),
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
    throw new Error(`Hosted wake terminal record failed with HTTP ${response.status}.`);
  }

  return parseHostedWakeTerminalResponse(await response.json());
}

export async function materializeHostedDueWakesInWeb(input: {
  baseUrl: string;
  body: HostedWakeMaterializeRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedWakeMaterializeResponse> {
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    body: JSON.stringify(input.body),
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
