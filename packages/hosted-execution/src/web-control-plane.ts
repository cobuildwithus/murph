import type {
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionSharePackResponse,
  HostedExecutionShareReference,
} from "./contracts.ts";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "./contracts.ts";
import { HOSTED_EXECUTION_PROXY_HOSTS } from "./callback-hosts.ts";
import { normalizeHostedExecutionBaseUrl } from "./env.ts";
import {
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
  parseHostedExecutionSharePackResponse,
} from "./parsers.ts";
import {
  buildHostedExecutionSharePayloadPath,
  HOSTED_EXECUTION_AI_USAGE_RECORD_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
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

export interface HostedExecutionServerDeviceSyncRuntimeClient
  extends HostedExecutionProxyDeviceSyncRuntimeClient {}

export interface HostedExecutionProxySharePackClient {
  fetchSharePack(share: HostedExecutionShareReference): Promise<HostedExecutionSharePackResponse>;
}

export interface HostedExecutionServerSharePackClient
  extends HostedExecutionProxySharePackClient {}

export interface HostedExecutionProxyAiUsageClient {
  recordUsage(
    usage: HostedExecutionAiUsageRecordRequest["usage"],
  ): Promise<HostedExecutionAiUsageRecordResponse>;
}

export interface HostedExecutionServerAiUsageClient
  extends HostedExecutionProxyAiUsageClient {}

interface HostedExecutionUserBoundRequesterResolutionInput {
  authorizationToken?: string | null;
  baseUrl: string | null | undefined;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  isProxyBaseUrl: (baseUrl: string) => boolean;
  proxyHost: string;
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

export function createHostedExecutionServerDeviceSyncRuntimeClient(input: {
  baseUrl: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  internalToken: string;
  timeoutMs?: number | null;
}): HostedExecutionServerDeviceSyncRuntimeClient {
  return buildHostedExecutionDeviceSyncRuntimeClient(
    createHostedExecutionServerRequester({
      authorizationToken: input.internalToken,
      baseUrl: input.baseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs ?? null,
    }),
    input.boundUserId,
  );
}

export function resolveHostedExecutionDeviceSyncRuntimeClient(input: {
  baseUrl: string | null | undefined;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  internalToken?: string | null;
  timeoutMs?: number | null;
}): HostedExecutionProxyDeviceSyncRuntimeClient | HostedExecutionServerDeviceSyncRuntimeClient | null {
  const requester = resolveHostedExecutionUserBoundRequester({
    authorizationToken: input.internalToken,
    baseUrl: input.baseUrl,
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    isProxyBaseUrl: isHostedExecutionDeviceSyncProxyBaseUrl,
    proxyHost: HOSTED_EXECUTION_PROXY_HOSTS.deviceSync,
    timeoutMs: input.timeoutMs,
  });

  if (!requester) {
    return null;
  }

  return buildHostedExecutionDeviceSyncRuntimeClient(requester, input.boundUserId);
}

export function createHostedExecutionProxySharePackClient(input: {
  baseUrl: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number | null;
}): HostedExecutionProxySharePackClient {
  return buildHostedExecutionSharePackClient(
    createHostedExecutionProxyRequester({
      baseUrl: input.baseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      proxyHost: HOSTED_EXECUTION_PROXY_HOSTS.sharePack,
      timeoutMs: input.timeoutMs ?? null,
    }),
  );
}

export function createHostedExecutionServerSharePackClient(input: {
  baseUrl: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  shareToken: string;
  timeoutMs?: number | null;
}): HostedExecutionServerSharePackClient {
  return buildHostedExecutionSharePackClient(
    createHostedExecutionServerRequester({
      authorizationToken: input.shareToken,
      baseUrl: input.baseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs ?? null,
    }),
  );
}

export function resolveHostedExecutionSharePackClient(input: {
  baseUrl: string | null | undefined;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  shareToken?: string | null;
  timeoutMs?: number | null;
}): HostedExecutionProxySharePackClient | HostedExecutionServerSharePackClient | null {
  const requester = resolveHostedExecutionUserBoundRequester({
    authorizationToken: input.shareToken,
    baseUrl: input.baseUrl,
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    isProxyBaseUrl: isHostedExecutionSharePackProxyBaseUrl,
    proxyHost: HOSTED_EXECUTION_PROXY_HOSTS.sharePack,
    timeoutMs: input.timeoutMs,
  });

  if (!requester) {
    return null;
  }

  return buildHostedExecutionSharePackClient(requester);
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

export function createHostedExecutionServerAiUsageClient(input: {
  baseUrl: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  internalToken: string;
  timeoutMs?: number | null;
}): HostedExecutionServerAiUsageClient {
  return buildHostedExecutionAiUsageClient(
    createHostedExecutionServerRequester({
      authorizationToken: input.internalToken,
      baseUrl: input.baseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs ?? null,
    }),
  );
}

export function resolveHostedExecutionAiUsageClient(input: {
  baseUrl: string | null | undefined;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  internalToken?: string | null;
  timeoutMs?: number | null;
}): HostedExecutionProxyAiUsageClient | HostedExecutionServerAiUsageClient | null {
  const requester = resolveHostedExecutionUserBoundRequester({
    authorizationToken: input.internalToken,
    baseUrl: input.baseUrl,
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    isProxyBaseUrl: isHostedExecutionAiUsageProxyBaseUrl,
    proxyHost: HOSTED_EXECUTION_PROXY_HOSTS.usage,
    timeoutMs: input.timeoutMs,
  });

  if (!requester) {
    return null;
  }

  return buildHostedExecutionAiUsageClient(requester);
}

export function isHostedExecutionDeviceSyncProxyBaseUrl(baseUrl: string): boolean {
  return isHostedWorkerProxyBaseUrl(baseUrl, HOSTED_EXECUTION_PROXY_HOSTS.deviceSync);
}

export function isHostedExecutionSharePackProxyBaseUrl(baseUrl: string): boolean {
  return isHostedWorkerProxyBaseUrl(baseUrl, HOSTED_EXECUTION_PROXY_HOSTS.sharePack);
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

function buildHostedExecutionSharePackClient(
  requester: HostedExecutionUserBoundWebControlPlaneRequester,
): HostedExecutionProxySharePackClient {
  return {
    fetchSharePack(share) {
      return requester.requestJson({
        body: {
          shareCode: share.shareCode,
        },
        label: "Hosted share payload fetch",
        method: "POST",
        parse: parseHostedExecutionSharePackResponse,
        path: buildHostedExecutionSharePayloadPath(share.shareId),
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
  input: HostedExecutionUserBoundWebControlPlaneRequesterOptions & {
    proxyHost: string;
  },
): HostedExecutionUserBoundWebControlPlaneRequester {
  return createHostedExecutionUserBoundRequester({
    baseUrl: requireHostedExecutionWorkerProxyBaseUrl(input.baseUrl, input.proxyHost),
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs ?? null,
  });
}

function createHostedExecutionServerRequester(
  input: HostedExecutionUserBoundWebControlPlaneRequesterOptions & {
    authorizationToken: string;
  },
): HostedExecutionUserBoundWebControlPlaneRequester {
  return createHostedExecutionUserBoundRequester({
    authorizationToken: requireHostedExecutionAuthorizationToken(input.authorizationToken),
    baseUrl: requireHostedExecutionWebControlBaseUrl(input.baseUrl),
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs ?? null,
  });
}

function resolveHostedExecutionUserBoundRequester(
  input: HostedExecutionUserBoundRequesterResolutionInput,
): HostedExecutionUserBoundWebControlPlaneRequester | null {
  const { baseUrl } = input;

  if (!baseUrl) {
    return null;
  }

  if (input.isProxyBaseUrl(baseUrl)) {
    return createHostedExecutionProxyRequester({
      baseUrl,
      boundUserId: input.boundUserId,
      fetchImpl: input.fetchImpl,
      proxyHost: input.proxyHost,
      timeoutMs: input.timeoutMs ?? null,
    });
  }

  if (!input.authorizationToken) {
    return null;
  }

  return createHostedExecutionServerRequester({
    authorizationToken: input.authorizationToken,
    baseUrl,
    boundUserId: input.boundUserId,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs ?? null,
  });
}

function createHostedExecutionUserBoundRequester(input: {
  authorizationToken?: string | null;
  baseUrl: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): HostedExecutionUserBoundWebControlPlaneRequester {
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
        timeoutMs: input.timeoutMs,
        authorizationToken: input.authorizationToken ?? null,
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

function requireHostedExecutionAuthorizationToken(value: string): string {
  const normalized = normalizeHostedExecutionAuthorizationToken(value);

  if (!normalized) {
    throw new TypeError("Hosted web control-plane authorization token must be configured.");
  }

  return normalized;
}

function normalizeHostedExecutionAuthorizationToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function requestHostedExecutionWebControlPlaneJson<TResponse>(input: {
  body?: Record<string, unknown>;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  label: string;
  method: "GET" | "POST";
  parse: (value: unknown) => TResponse;
  path: string;
  timeoutMs: number | null;
  authorizationToken?: string | null;
  url: string;
}): Promise<TResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const headers = buildHostedExecutionRequestHeaders({
    authorizationToken: normalizeHostedExecutionAuthorizationToken(input.authorizationToken),
    boundUserId: input.boundUserId,
    withJsonContentType: body !== undefined,
  });
  const response = await fetchImpl(
    new URL(input.path.replace(/^\/+/u, ""), `${requireHostedExecutionWebControlBaseUrl(input.url)}/`).toString(),
    {
      ...(body === undefined ? {} : { body }),
      headers,
      method: input.method,
      signal: typeof input.timeoutMs === "number" ? AbortSignal.timeout(input.timeoutMs) : undefined,
    },
  );
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
  authorizationToken: string | null;
  boundUserId: string;
  withJsonContentType: boolean;
}): Headers {
  const headers = new Headers();

  headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.boundUserId);

  if (input.authorizationToken) {
    headers.set("authorization", `Bearer ${input.authorizationToken}`);
  }

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
