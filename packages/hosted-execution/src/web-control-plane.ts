import type {
  HostedExecutionDeviceSyncConnectLinkResponse,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "./contracts.ts";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "./contracts.ts";
import { HOSTED_EXECUTION_PROXY_HOSTS } from "./callback-hosts.ts";
import { createHostedExecutionSignatureHeaders } from "./auth.ts";
import { normalizeHostedExecutionBaseUrl } from "./env.ts";
import {
  parseHostedExecutionDeviceSyncConnectLinkResponse,
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "./parsers.ts";
import {
  HOSTED_EXECUTION_AI_USAGE_RECORD_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  buildHostedExecutionDeviceSyncConnectLinkPath,
} from "./routes.ts";

export interface HostedExecutionAiUsageRecordRequest {
  usage: readonly object[];
}

export interface HostedExecutionAiUsageRecordResponse {
  recorded: number;
  usageIds: string[];
}

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

export interface HostedExecutionProxyDeviceSyncRuntimeClient {
  applyUpdates(input: {
    occurredAt?: string | null;
    updates: HostedExecutionDeviceSyncRuntimeApplyRequest["updates"];
  }): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  fetchSnapshot(input?: {
    connectionId?: string | null;
    provider?: string | null;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
}

export interface HostedExecutionProxyDeviceSyncConnectLinkClient {
  createConnectLink(input: {
    provider: string;
  }): Promise<HostedExecutionDeviceSyncConnectLinkResponse>;
}

export interface HostedExecutionServerDeviceSyncConnectLinkClient
  extends HostedExecutionProxyDeviceSyncConnectLinkClient {}

export interface HostedExecutionProxyAiUsageClient {
  recordUsage(
    usage: HostedExecutionAiUsageRecordRequest["usage"],
  ): Promise<HostedExecutionAiUsageRecordResponse>;
}

interface HostedExecutionUserBoundRequesterResolutionInput {
  baseUrl: string | null | undefined;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  isProxyBaseUrl: (baseUrl: string) => boolean;
  proxyHost: string;
  signingSecret?: string | null;
  timeoutMs?: number | null;
}

export function createHostedExecutionProxyDeviceSyncRuntimeClient(input: {
  baseUrl: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number | null;
}): HostedExecutionProxyDeviceSyncRuntimeClient {
  return buildHostedExecutionDeviceSyncRuntimeClient(
    createHostedExecutionProxyRequester({
      baseUrl: input.baseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      proxyHost: HOSTED_EXECUTION_PROXY_HOSTS.deviceSync,
      timeoutMs: input.timeoutMs ?? null,
    }),
    input.boundUserId,
  );
}

export function createHostedExecutionProxyDeviceSyncConnectLinkClient(input: {
  baseUrl: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number | null;
}): HostedExecutionProxyDeviceSyncConnectLinkClient {
  return buildHostedExecutionDeviceSyncConnectLinkClient(
    createHostedExecutionProxyRequester({
      baseUrl: input.baseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      proxyHost: HOSTED_EXECUTION_PROXY_HOSTS.deviceSync,
      timeoutMs: input.timeoutMs ?? null,
    }),
  );
}

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

export function resolveHostedExecutionDeviceSyncRuntimeClient(input: {
  baseUrl: string | null | undefined;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  signingSecret?: string | null;
  timeoutMs?: number | null;
}): HostedExecutionProxyDeviceSyncRuntimeClient | null {
  const normalizedBaseUrl = input.baseUrl ? requireHostedExecutionWebControlBaseUrl(input.baseUrl) : null;

  if (!normalizedBaseUrl || !isHostedExecutionDeviceSyncProxyBaseUrl(normalizedBaseUrl)) {
    return null;
  }

  return buildHostedExecutionDeviceSyncRuntimeClient(
    createHostedExecutionProxyRequester({
      baseUrl: normalizedBaseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      proxyHost: HOSTED_EXECUTION_PROXY_HOSTS.deviceSync,
      timeoutMs: input.timeoutMs ?? null,
    }),
    input.boundUserId,
  );
}

export function resolveHostedExecutionDeviceSyncConnectLinkClient(input: {
  baseUrl: string | null | undefined;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  signingSecret?: string | null;
  timeoutMs?: number | null;
}):
  | HostedExecutionProxyDeviceSyncConnectLinkClient
  | HostedExecutionServerDeviceSyncConnectLinkClient
  | null {
  const normalizedBaseUrl = input.baseUrl ? requireHostedExecutionWebControlBaseUrl(input.baseUrl) : null;

  if (!normalizedBaseUrl) {
    return null;
  }

  if (isHostedExecutionDeviceSyncProxyBaseUrl(normalizedBaseUrl)) {
    return buildHostedExecutionDeviceSyncConnectLinkClient(
      createHostedExecutionProxyRequester({
        baseUrl: normalizedBaseUrl,
        boundUserId: input.boundUserId,
        fetchImpl: input.fetchImpl,
        proxyHost: HOSTED_EXECUTION_PROXY_HOSTS.deviceSync,
        timeoutMs: input.timeoutMs ?? null,
      }),
    );
  }

  const signingSecret = normalizeHostedExecutionSigningSecret(input.signingSecret);

  if (!signingSecret) {
    return null;
  }

  return createHostedExecutionServerDeviceSyncConnectLinkClient({
    baseUrl: normalizedBaseUrl,
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    signingSecret,
    timeoutMs: input.timeoutMs ?? null,
  });
}

export function createHostedExecutionProxyAiUsageClient(input: {
  baseUrl: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number | null;
}): HostedExecutionProxyAiUsageClient {
  return buildHostedExecutionAiUsageClient(
    createHostedExecutionProxyRequester({
      baseUrl: input.baseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      proxyHost: HOSTED_EXECUTION_PROXY_HOSTS.usage,
      timeoutMs: input.timeoutMs ?? null,
    }),
  );
}

export function resolveHostedExecutionAiUsageClient(input: {
  baseUrl: string | null | undefined;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  signingSecret?: string | null;
  timeoutMs?: number | null;
}): HostedExecutionProxyAiUsageClient | null {
  const normalizedBaseUrl = input.baseUrl ? requireHostedExecutionWebControlBaseUrl(input.baseUrl) : null;

  if (!normalizedBaseUrl || !isHostedExecutionAiUsageProxyBaseUrl(normalizedBaseUrl)) {
    return null;
  }

  return buildHostedExecutionAiUsageClient(
    createHostedExecutionProxyRequester({
      baseUrl: normalizedBaseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      proxyHost: HOSTED_EXECUTION_PROXY_HOSTS.usage,
      timeoutMs: input.timeoutMs ?? null,
    }),
  );
}

export function isHostedExecutionDeviceSyncProxyBaseUrl(baseUrl: string): boolean {
  return isHostedWorkerProxyBaseUrl(baseUrl, HOSTED_EXECUTION_PROXY_HOSTS.deviceSync);
}

export function isHostedExecutionAiUsageProxyBaseUrl(baseUrl: string): boolean {
  return isHostedWorkerProxyBaseUrl(baseUrl, HOSTED_EXECUTION_PROXY_HOSTS.usage);
}

function buildHostedExecutionDeviceSyncRuntimeClient(
  requester: HostedExecutionUserBoundWebControlPlaneRequester,
  boundUserId: string,
): HostedExecutionProxyDeviceSyncRuntimeClient {
  return {
    applyUpdates(input) {
      return requester.requestJson({
        body: {
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
          updates: input.updates,
          userId: boundUserId,
        } satisfies HostedExecutionDeviceSyncRuntimeApplyRequest,
        label: "Hosted device-sync runtime apply",
        method: "POST",
        parse: parseHostedExecutionDeviceSyncRuntimeApplyResponse,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
      });
    },
    fetchSnapshot(input = {}) {
      return requester.requestJson({
        body: {
          ...(input.connectionId ? { connectionId: input.connectionId } : {}),
          ...(input.provider ? { provider: input.provider } : {}),
          userId: boundUserId,
        } satisfies HostedExecutionDeviceSyncRuntimeSnapshotRequest,
        label: "Hosted device-sync runtime snapshot",
        method: "POST",
        parse: parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
        path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
      });
    },
  };
}

function buildHostedExecutionDeviceSyncConnectLinkClient(
  requester: HostedExecutionUserBoundWebControlPlaneRequester,
): HostedExecutionProxyDeviceSyncConnectLinkClient {
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

function buildHostedExecutionAiUsageClient(
  requester: HostedExecutionUserBoundWebControlPlaneRequester,
): HostedExecutionProxyAiUsageClient {
  return {
    recordUsage(usage) {
      return requester.requestJson({
        body: {
          usage: [...usage],
        } satisfies HostedExecutionAiUsageRecordRequest,
        label: "Hosted AI usage record",
        method: "POST",
        parse: parseHostedExecutionAiUsageRecordResponse,
        path: HOSTED_EXECUTION_AI_USAGE_RECORD_PATH,
      });
    },
  };
}

function createHostedExecutionProxyRequester(
  input: HostedExecutionUserBoundWebControlPlaneRequesterOptions & { proxyHost: string },
): HostedExecutionUserBoundWebControlPlaneRequester {
  return createHostedExecutionUserBoundRequester({
    baseUrl: requireHostedExecutionWorkerProxyBaseUrl(input.baseUrl, input.proxyHost),
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs ?? null,
  });
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

function resolveHostedExecutionUserBoundRequester(
  input: HostedExecutionUserBoundRequesterResolutionInput,
): HostedExecutionUserBoundWebControlPlaneRequester | null {
  const normalizedBaseUrl = input.baseUrl ? requireHostedExecutionWebControlBaseUrl(input.baseUrl) : null;

  if (!normalizedBaseUrl) {
    return null;
  }

  if (input.isProxyBaseUrl(normalizedBaseUrl)) {
    return createHostedExecutionProxyRequester({
      baseUrl: normalizedBaseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      proxyHost: input.proxyHost,
      timeoutMs: input.timeoutMs ?? null,
    });
  }

  if (!input.signingSecret) {
    return null;
  }

  return createHostedExecutionServerRequester({
    baseUrl: normalizedBaseUrl,
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    signingSecret: input.signingSecret,
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

function parseHostedExecutionAiUsageRecordResponse(
  value: unknown,
): HostedExecutionAiUsageRecordResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted AI usage record response must be a JSON object.");
  }

  const recorded = (value as { recorded?: unknown }).recorded;
  const usageIds = (value as { usageIds?: unknown }).usageIds;

  if (typeof recorded !== "number" || !Number.isInteger(recorded) || recorded < 0) {
    throw new TypeError("Hosted AI usage record response recorded count must be a non-negative integer.");
  }

  if (!Array.isArray(usageIds) || usageIds.some((entry) => typeof entry !== "string")) {
    throw new TypeError("Hosted AI usage record response usageIds must be a string array.");
  }

  return {
    recorded,
    usageIds: usageIds.slice() as string[],
  };
}

function requireHostedExecutionWebControlBaseUrl(value: string): string {
  const normalized = normalizeHostedExecutionBaseUrl(value, {
    allowHttpHosts: Object.values(HOSTED_EXECUTION_PROXY_HOSTS),
    allowHttpLocalhost: true,
  });

  if (!normalized) {
    throw new TypeError("Hosted web control-plane baseUrl must be configured.");
  }

  return normalized;
}

function requireHostedExecutionWorkerProxyBaseUrl(value: string, proxyHost: string): string {
  const normalized = requireHostedExecutionWebControlBaseUrl(value);

  if (!isHostedWorkerProxyBaseUrl(normalized, proxyHost)) {
    throw new TypeError(`Hosted web control-plane baseUrl must target ${proxyHost}.`);
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
    input.path.replace(/^\/+/, ""),
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
      path: targetUrl.pathname,
      payload: input.body ?? "",
      secret: signingSecret,
      timestamp: new Date().toISOString(),
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
  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return `: ${message.trim()}`;
    }
  }

  const trimmed = text.trim();
  return trimmed.length > 0 ? `: ${trimmed.slice(0, 500)}` : "";
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

function isHostedWorkerProxyBaseUrl(baseUrl: string, hostname: string): boolean {
  try {
    return new URL(baseUrl).hostname === hostname;
  } catch {
    return false;
  }
}
