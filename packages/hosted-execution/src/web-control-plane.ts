import type {
  HostedExecutionDeviceSyncConnectLinkResponse,
} from "./contracts.ts";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "./contracts.ts";
import { createHostedExecutionSignatureHeaders } from "./auth.ts";
import { normalizeHostedExecutionBaseUrl } from "./env.ts";
import {
  parseHostedExecutionDeviceSyncConnectLinkResponse,
} from "./parsers.ts";
import {
  buildHostedExecutionDeviceSyncConnectLinkPath,
} from "./routes.ts";

interface HostedExecutionUserBoundWebControlPlaneRequester {
  requestJson<TResponse>(input: {
    body?: Record<string, unknown>;
    label: string;
    method: "GET" | "POST";
    parse: (value: unknown) => TResponse;
    path: string;
  }): Promise<TResponse>;
}

interface HostedExecutionUserBoundWebControlPlaneRequesterOptions {
  baseUrl: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  signingSecret?: string | null;
  timeoutMs?: number | null;
}

export interface HostedExecutionDeviceSyncConnectLinkClient {
  createConnectLink(input: {
    provider: string;
  }): Promise<HostedExecutionDeviceSyncConnectLinkResponse>;
}

export interface HostedExecutionServerDeviceSyncConnectLinkClient
  extends HostedExecutionDeviceSyncConnectLinkClient {}

export function createHostedExecutionServerDeviceSyncConnectLinkClient(input: {
  baseUrl: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  signingSecret: string;
  timeoutMs?: number | null;
}): HostedExecutionServerDeviceSyncConnectLinkClient {
  return buildHostedExecutionDeviceSyncConnectLinkClient(
    createHostedExecutionServerRequester({
      baseUrl: input.baseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      signingSecret: input.signingSecret,
      timeoutMs: input.timeoutMs ?? null,
    }),
  );
}

function buildHostedExecutionDeviceSyncConnectLinkClient(
  requester: HostedExecutionUserBoundWebControlPlaneRequester,
): HostedExecutionDeviceSyncConnectLinkClient {
  return {
    createConnectLink(input) {
      return requester.requestJson({
        label: "Hosted device-sync connect link",
        method: "POST",
        parse: parseHostedExecutionDeviceSyncConnectLinkResponse,
        path: buildHostedExecutionDeviceSyncConnectLinkPath(input.provider),
      });
    },
  };
}

function createHostedExecutionServerRequester(
  input: HostedExecutionUserBoundWebControlPlaneRequesterOptions,
): HostedExecutionUserBoundWebControlPlaneRequester {
  return createHostedExecutionUserBoundRequester({
    baseUrl: requireHostedExecutionWebControlBaseUrl(input.baseUrl),
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    signingSecret: requireHostedExecutionSigningSecret(input.signingSecret),
    timeoutMs: input.timeoutMs ?? null,
  });
}

function createHostedExecutionUserBoundRequester(
  input: HostedExecutionUserBoundWebControlPlaneRequesterOptions,
): HostedExecutionUserBoundWebControlPlaneRequester {
  return {
    requestJson<TResponse>(request: {
      body?: Record<string, unknown>;
      label: string;
      method: "GET" | "POST";
      parse: (value: unknown) => TResponse;
      path: string;
    }) {
      return requestHostedExecutionWebControlPlaneJson({
        body: request.body,
        boundUserId: input.boundUserId,
        fetchImpl: input.fetchImpl,
        label: request.label,
        method: request.method,
        parse: request.parse,
        path: request.path,
        signingSecret: input.signingSecret ?? null,
        timeoutMs: input.timeoutMs ?? null,
        url: input.baseUrl,
      });
    },
  };
}

function requireHostedExecutionWebControlBaseUrl(value: string): string {
  const normalized = normalizeHostedExecutionBaseUrl(value, {
    allowHttpLocalhost: true,
  });

  if (!normalized) {
    throw new TypeError("Hosted web control-plane baseUrl must be configured.");
  }

  return normalized;
}

function requireHostedExecutionSigningSecret(value: string | null | undefined): string {
  const normalized = normalizeHostedExecutionSigningSecret(value);

  if (!normalized) {
    throw new TypeError("Hosted web control-plane signingSecret must be configured.");
  }

  return normalized;
}

function normalizeHostedExecutionSigningSecret(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function fetchHostedExecutionWebControlPlaneResponse(input: {
  baseUrl: string;
  body?: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  method: "GET" | "POST";
  path: string;
  search?: string | null;
  signingSecret?: string | null;
  timeoutMs: number | null;
}): Promise<Response> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const targetUrl = new URL(
    input.path.replace(/^\/+/u, ""),
    `${requireHostedExecutionWebControlBaseUrl(input.baseUrl)}/`,
  );

  if (input.search) {
    targetUrl.search = input.search;
  }

  const headers = buildHostedExecutionRequestHeaders({
    boundUserId: input.boundUserId,
    withJsonContentType: input.body !== undefined,
  });
  const signingSecret = normalizeHostedExecutionSigningSecret(input.signingSecret);

  if (signingSecret) {
    const signatureHeaders = await createHostedExecutionSignatureHeaders({
      method: input.method,
      nonce: null,
      path: targetUrl.pathname,
      payload: input.body ?? "",
      search: targetUrl.search,
      secret: signingSecret,
      timestamp: new Date().toISOString(),
      userId: input.boundUserId,
    });

    for (const [key, value] of Object.entries(signatureHeaders)) {
      headers.set(key, value);
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

async function requestHostedExecutionWebControlPlaneJson<TResponse>(input: {
  body?: Record<string, unknown>;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  label: string;
  method: "GET" | "POST";
  parse: (value: unknown) => TResponse;
  path: string;
  signingSecret?: string | null;
  timeoutMs: number | null;
  url: string;
}): Promise<TResponse> {
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.url,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    method: input.method,
    path: input.path,
    signingSecret: input.signingSecret ?? null,
    timeoutMs: input.timeoutMs,
  });
  const text = await response.text();
  const payload = parseJsonBody(text);

  if (!response.ok) {
    throw new Error(
      `${input.label} failed with HTTP ${response.status}${formatHostedExecutionErrorSuffix(payload, text)}.`,
    );
  }

  return input.parse(payload);
}

function parseJsonBody(text: string): unknown {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function formatHostedExecutionErrorSuffix(payload: unknown, text: string): string {
  const message = readHostedExecutionErrorMessage(payload);

  if (message) {
    return `: ${message}`;
  }

  const trimmed = text.trim();
  return trimmed.length > 0 ? `: ${trimmed.slice(0, 500)}` : "";
}

function readHostedExecutionErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const topLevelMessage = (payload as { message?: unknown }).message;

  if (typeof topLevelMessage === "string" && topLevelMessage.trim().length > 0) {
    return topLevelMessage.trim();
  }

  const nestedError = (payload as { error?: unknown }).error;

  if (!nestedError || typeof nestedError !== "object" || Array.isArray(nestedError)) {
    return null;
  }

  const nestedMessage = (nestedError as { message?: unknown }).message;
  return typeof nestedMessage === "string" && nestedMessage.trim().length > 0
    ? nestedMessage.trim()
    : null;
}

function buildHostedExecutionRequestHeaders(input: {
  boundUserId: string;
  withJsonContentType: boolean;
}): Headers {
  const headers = new Headers();

  headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.boundUserId);

  if (input.withJsonContentType) {
    headers.set("content-type", "application/json");
  }

  return headers;
}
