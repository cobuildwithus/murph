import type {
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionSharePackResponse,
  HostedExecutionShareReference,
} from "./contracts.ts";
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
  usage: readonly Record<string, unknown>[];
}

export interface HostedExecutionAiUsageRecordResponse {
  recorded: number;
  usageIds: string[];
}

export async function fetchHostedExecutionDeviceSyncRuntimeSnapshot(input: {
  baseUrl: string;
  connectionId?: string | null;
  fetchImpl?: typeof fetch;
  internalToken?: string | null;
  provider?: string | null;
  timeoutMs?: number | null;
  userId: string;
}): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse> {
  return requestHostedExecutionWebControlPlaneJson({
    body: {
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      userId: input.userId,
    } satisfies HostedExecutionDeviceSyncRuntimeSnapshotRequest,
    fetchImpl: input.fetchImpl,
    label: "Hosted device-sync runtime snapshot",
    method: "POST",
    parse: parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
    path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
    timeoutMs: input.timeoutMs ?? null,
    token: input.internalToken,
    url: input.baseUrl,
  });
}

export async function applyHostedExecutionDeviceSyncRuntimeUpdates(input: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  internalToken?: string | null;
  occurredAt?: string | null;
  timeoutMs?: number | null;
  updates: HostedExecutionDeviceSyncRuntimeApplyRequest["updates"];
  userId: string;
}): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
  return requestHostedExecutionWebControlPlaneJson({
    body: {
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      updates: input.updates,
      userId: input.userId,
    } satisfies HostedExecutionDeviceSyncRuntimeApplyRequest,
    fetchImpl: input.fetchImpl,
    label: "Hosted device-sync runtime apply",
    method: "POST",
    parse: parseHostedExecutionDeviceSyncRuntimeApplyResponse,
    path: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
    timeoutMs: input.timeoutMs ?? null,
    token: input.internalToken,
    url: input.baseUrl,
  });
}

export async function recordHostedExecutionAiUsage(input: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  internalToken?: string | null;
  timeoutMs?: number | null;
  usage: HostedExecutionAiUsageRecordRequest["usage"];
}): Promise<HostedExecutionAiUsageRecordResponse> {
  return requestHostedExecutionWebControlPlaneJson({
    body: {
      usage: [...input.usage],
    } satisfies HostedExecutionAiUsageRecordRequest,
    fetchImpl: input.fetchImpl,
    label: "Hosted AI usage record",
    method: "POST",
    parse: parseHostedExecutionAiUsageRecordResponse,
    path: HOSTED_EXECUTION_AI_USAGE_RECORD_PATH,
    timeoutMs: input.timeoutMs ?? null,
    token: input.internalToken,
    url: input.baseUrl,
  });
}

export async function fetchHostedExecutionSharePack(input: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  share: HostedExecutionShareReference;
  shareToken?: string | null;
  timeoutMs?: number | null;
}): Promise<HostedExecutionSharePackResponse> {
  return requestHostedExecutionWebControlPlaneJson({
    fetchImpl: input.fetchImpl,
    label: "Hosted share payload fetch",
    method: "GET",
    parse: parseHostedExecutionSharePackResponse,
    path: buildHostedExecutionSharePayloadPath(input.share.shareId, input.share.shareCode),
    timeoutMs: input.timeoutMs ?? null,
    token: input.shareToken,
    url: input.baseUrl,
  });
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

async function requestHostedExecutionWebControlPlaneJson<TResponse>(input: {
  body?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  label: string;
  method: "GET" | "POST";
  parse: (value: unknown) => TResponse;
  path: string;
  timeoutMs: number | null;
  token?: string | null;
  url: string;
}): Promise<TResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const normalizedToken = typeof input.token === "string" && input.token.trim().length > 0
    ? input.token.trim()
    : null;
  const response = await fetchImpl(
    new URL(input.path.replace(/^\/+/u, ""), `${requireHostedExecutionWebControlBaseUrl(input.url)}/`).toString(),
    {
      ...(input.body
        ? {
            body: JSON.stringify(input.body),
            headers: {
              ...(normalizedToken ? { authorization: `Bearer ${normalizedToken}` } : {}),
              "content-type": "application/json",
            },
          }
        : {
            headers: {
              ...(normalizedToken ? { authorization: `Bearer ${normalizedToken}` } : {}),
            },
          }),
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
