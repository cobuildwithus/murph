import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionDispatchRequest,
  type HostedWakeAppendRequest,
  type HostedWakeAppendResponse,
  type HostedWakeCommitRequest,
  type HostedWakeCommitResponse,
  type HostedWakeFetchRequest,
  type HostedWakeFetchResponse,
  type HostedWakeQuarantineRequest,
  type HostedWakeQuarantineResponse,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedWakeAppendResponse,
  parseHostedWakeCommitResponse,
  parseHostedWakeFetchResponse,
  parseHostedWakeQuarantineResponse,
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
    redirect: "error",
    signal: typeof input.timeoutMs === "number" ? AbortSignal.timeout(input.timeoutMs) : undefined,
  });
}

const HOSTED_WEB_HOSTED_WAKE_APPEND_PATH = "/api/internal/hosted-wake/append";
const HOSTED_WEB_HOSTED_WAKE_COMMIT_PATH = "/api/internal/hosted-wake/commit";
const HOSTED_WEB_HOSTED_WAKE_QUARANTINE_PATH = "/api/internal/hosted-wake/quarantine";
const HOSTED_WEB_HOSTED_WAKE_UNSEEN_PATH = "/api/internal/hosted-wake/unseen";

export async function appendHostedWakeDispatchInWeb(input: {
  baseUrl: string;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  dispatch: HostedExecutionDispatchRequest;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedWakeAppendResponse> {
  const body = JSON.stringify({
    dispatch: input.dispatch,
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

export async function quarantineHostedWakeInWeb(input: {
  baseUrl: string;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  quarantineCode: string;
  timeoutMs: number | null;
  wakeId: string;
}): Promise<HostedWakeQuarantineResponse> {
  const body = JSON.stringify({
    quarantineCode: input.quarantineCode,
    wakeId: input.wakeId,
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

function requireHostedWebControlBaseUrl(value: string): string {
  const normalized = normalizeHostedWebControlBaseUrl(value);

  if (!normalized) {
    throw new TypeError("Hosted web control-plane baseUrl must be configured.");
  }

  return normalized;
}
