import type { SharePack } from "@murphai/contracts";
import type {
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchResult,
  HostedExecutionUserEnvStatus,
  HostedExecutionUserEnvUpdate,
  HostedExecutionUserStatus,
} from "./contracts.ts";
import { normalizeHostedExecutionBaseUrl } from "./env.ts";
import type { HostedExecutionOutboxPayload } from "./outbox-payload.ts";
import {
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
  parseHostedExecutionDispatchRequest,
  parseHostedExecutionDispatchResult,
  parseHostedExecutionOutboxPayload,
  parseHostedExecutionSharePack,
  parseHostedExecutionUserEnvStatus,
  parseHostedExecutionUserEnvUpdate,
  parseHostedExecutionUserStatus,
} from "./parsers.ts";
import {
  buildHostedExecutionSharePackPath,
  buildHostedExecutionUserCryptoContextPath,
  buildHostedExecutionUserDeviceSyncRuntimePath,
  buildHostedExecutionUserDeviceSyncRuntimeSnapshotPath,
  buildHostedExecutionUserDispatchPayloadPath,
  buildHostedExecutionUserEnvPath,
  buildHostedExecutionUserPendingUsagePath,
  buildHostedExecutionUserRunPath,
  buildHostedExecutionUserStatusPath,
  buildHostedExecutionUserStoredDispatchPath,
  HOSTED_EXECUTION_DISPATCH_PATH,
} from "./routes.ts";

export interface HostedExecutionDispatchClient {
  dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult>;
}

export interface HostedExecutionDispatchClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getBearerToken: () => Promise<string>;
  timeoutMs?: number;
}

export interface HostedExecutionManagedUserCryptoStatus {
  recipientKinds: string[];
  rootKeyId: string;
  userId: string;
}

export interface HostedExecutionControlClient {
  applyDeviceSyncRuntimeUpdates(
    userId: string,
    input: Omit<HostedExecutionDeviceSyncRuntimeApplyRequest, "userId">,
  ): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  clearUserEnv(userId: string): Promise<HostedExecutionUserEnvStatus>;
  deletePendingUsage(userId: string, usageIds: readonly string[]): Promise<void>;
  deleteSharePack(userId: string, shareId: string): Promise<void>;
  deleteStoredDispatchPayload(payload: HostedExecutionOutboxPayload): Promise<void>;
  dispatchStoredPayload(payload: HostedExecutionOutboxPayload): Promise<HostedExecutionDispatchResult>;
  getDeviceSyncRuntimeSnapshot(
    userId: string,
    input?: Omit<HostedExecutionDeviceSyncRuntimeSnapshotRequest, "userId">,
  ): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
  getPendingUsage(userId: string, limit?: number): Promise<Record<string, unknown>[]>;
  getSharePack(userId: string, shareId: string): Promise<SharePack | null>;
  getStatus(userId: string): Promise<HostedExecutionUserStatus>;
  getUserEnvStatus(userId: string): Promise<HostedExecutionUserEnvStatus>;
  putDeviceSyncRuntimeSnapshot(
    userId: string,
    snapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  ): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
  putSharePack(userId: string, shareId: string, pack: SharePack): Promise<SharePack>;
  provisionManagedUserCrypto(userId: string): Promise<HostedExecutionManagedUserCryptoStatus>;
  run(userId: string): Promise<HostedExecutionUserStatus>;
  storeDispatchPayload(dispatch: HostedExecutionDispatchRequest): Promise<HostedExecutionOutboxPayload>;
  updateUserEnv(userId: string, update: HostedExecutionUserEnvUpdate): Promise<HostedExecutionUserEnvStatus>;
}

export interface HostedExecutionControlClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getBearerToken: () => Promise<string>;
  timeoutMs?: number;
}

export function createHostedExecutionDispatchClient(
  options: HostedExecutionDispatchClientOptions,
): HostedExecutionDispatchClient {
  const baseUrl = requireHostedExecutionBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const getAuthorizationHeader = createHostedExecutionBearerAuthorizationHeaderProvider(
    options.getBearerToken,
  );

  return {
    dispatch(input) {
      const requestPayload = parseHostedExecutionDispatchRequest(input);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "dispatch",
        parse: parseHostedExecutionDispatchResult,
        path: HOSTED_EXECUTION_DISPATCH_PATH,
        request: {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
  };
}

export function createHostedExecutionControlClient(
  options: HostedExecutionControlClientOptions,
): HostedExecutionControlClient {
  const baseUrl = requireHostedExecutionBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const getAuthorizationHeader = createHostedExecutionBearerAuthorizationHeaderProvider(
    options.getBearerToken,
  );

  return {
    applyDeviceSyncRuntimeUpdates(userId, input) {
      const requestPayload = {
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        updates: input.updates,
        userId,
      } satisfies HostedExecutionDeviceSyncRuntimeApplyRequest;

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "device-sync runtime apply",
        parse: parseHostedExecutionDeviceSyncRuntimeApplyResponse,
        path: buildHostedExecutionUserDeviceSyncRuntimePath(userId),
        request: {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    clearUserEnv(userId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "user env clear",
        parse: parseHostedExecutionUserEnvStatus,
        path: buildHostedExecutionUserEnvPath(userId),
        request: { method: "DELETE" },
        timeoutMs: options.timeoutMs,
      });
    },
    deleteSharePack(userId, shareId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "delete share pack",
        parse: () => undefined,
        path: buildHostedExecutionSharePackPath(userId, shareId),
        request: {
          method: "DELETE",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    deleteStoredDispatchPayload(payload) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "delete stored dispatch payload",
        parse: () => undefined,
        path: buildHostedExecutionUserDispatchPayloadPath(
          resolveHostedExecutionOutboxPayloadUserId(payload),
        ),
        request: {
          body: JSON.stringify(payload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "DELETE",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    dispatchStoredPayload(payload) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "stored dispatch",
        parse: parseHostedExecutionDispatchResult,
        path: buildHostedExecutionUserStoredDispatchPath(
          resolveHostedExecutionOutboxPayloadUserId(payload),
        ),
        request: {
          body: JSON.stringify(payload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    getDeviceSyncRuntimeSnapshot(userId, input = {}) {
      const search = new URLSearchParams();
      if (input.connectionId) {
        search.set("connectionId", input.connectionId);
      }
      if (input.provider) {
        search.set("provider", input.provider);
      }

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "device-sync runtime snapshot",
        parse: parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
        path: buildHostedExecutionUserDeviceSyncRuntimePath(userId),
        request: {
          method: "GET",
          search: search.size > 0 ? search.toString() : null,
        },
        timeoutMs: options.timeoutMs,
      });
    },
    deletePendingUsage(userId, usageIds) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "delete pending usage",
        parse: () => undefined,
        path: buildHostedExecutionUserPendingUsagePath(userId),
        request: {
          body: JSON.stringify({ usageIds: [...usageIds] }),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "DELETE",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    getPendingUsage(userId, limit) {
      const search = typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? new URLSearchParams({ limit: String(Math.floor(limit)) }).toString()
        : null;

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "pending usage",
        parse: (value) => {
          if (!Array.isArray(value)) {
            throw new TypeError("Pending usage response must be an array.");
          }

          return value.map((entry, index) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
              throw new TypeError(`Pending usage[${index}] must be an object.`);
            }

            return structuredClone(entry as Record<string, unknown>);
          });
        },
        path: buildHostedExecutionUserPendingUsagePath(userId),
        request: {
          method: "GET",
          search,
        },
        timeoutMs: options.timeoutMs,
      });
    },
    getSharePack(userId, shareId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "share pack",
        parse: parseHostedExecutionSharePack,
        path: buildHostedExecutionSharePackPath(userId, shareId),
        request: {
          method: "GET",
        },
        timeoutMs: options.timeoutMs,
      }).catch((error) => {
        if (
          error instanceof Error
          && error.message.startsWith("Hosted execution share pack failed with HTTP 404")
        ) {
          return null;
        }

        throw error;
      });
    },
    putDeviceSyncRuntimeSnapshot(userId, snapshot) {
      const requestPayload = parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(snapshot);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "device-sync runtime snapshot mirror",
        parse: parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
        path: buildHostedExecutionUserDeviceSyncRuntimeSnapshotPath(userId),
        request: {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "PUT",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    putSharePack(userId, shareId, pack) {
      const requestPayload = parseHostedExecutionSharePack(pack);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "share pack write",
        parse: parseHostedExecutionSharePack,
        path: buildHostedExecutionSharePackPath(userId, shareId),
        request: {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "PUT",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    provisionManagedUserCrypto(userId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "managed user crypto provision",
        parse: parseHostedExecutionManagedUserCryptoStatus,
        path: buildHostedExecutionUserCryptoContextPath(userId),
        request: {
          method: "PUT",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    getStatus(userId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "status",
        parse: parseHostedExecutionUserStatus,
        path: buildHostedExecutionUserStatusPath(userId),
        request: { method: "GET" },
        timeoutMs: options.timeoutMs,
      });
    },
    getUserEnvStatus(userId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "user env status",
        parse: parseHostedExecutionUserEnvStatus,
        path: buildHostedExecutionUserEnvPath(userId),
        request: { method: "GET" },
        timeoutMs: options.timeoutMs,
      });
    },
    run(userId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "manual run",
        parse: parseHostedExecutionUserStatus,
        path: buildHostedExecutionUserRunPath(userId),
        request: {
          body: JSON.stringify({}),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "POST",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    storeDispatchPayload(dispatch) {
      const requestPayload = parseHostedExecutionDispatchRequest(dispatch);
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "store dispatch payload",
        parse: parseHostedExecutionOutboxPayload,
        path: buildHostedExecutionUserDispatchPayloadPath(dispatch.event.userId),
        request: {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "PUT",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    updateUserEnv(userId, update) {
      const requestPayload = parseHostedExecutionUserEnvUpdate(update);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "user env update",
        parse: parseHostedExecutionUserEnvStatus,
        path: buildHostedExecutionUserEnvPath(userId),
        request: {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "PUT",
        },
        timeoutMs: options.timeoutMs,
      });
    },
  };
}

function parseHostedExecutionManagedUserCryptoStatus(value: unknown): HostedExecutionManagedUserCryptoStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Managed user crypto status response must be an object.");
  }

  const record = value as Record<string, unknown>;
  const userId = typeof record.userId === "string" && record.userId.trim().length > 0
    ? record.userId
    : null;
  const rootKeyId = typeof record.rootKeyId === "string" && record.rootKeyId.trim().length > 0
    ? record.rootKeyId
    : null;

  if (!userId || !rootKeyId) {
    throw new TypeError("Managed user crypto status response must include userId and rootKeyId.");
  }

  if (!Array.isArray(record.recipientKinds)) {
    throw new TypeError("Managed user crypto status response must include recipientKinds.");
  }

  const recipientKinds = record.recipientKinds.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new TypeError(`Managed user crypto status recipientKinds[${index}] must be a non-empty string.`);
    }

    return entry;
  });

  return {
    recipientKinds,
    rootKeyId,
    userId,
  };
}

function requireHostedExecutionBaseUrl(value: string): string {
  const normalized = normalizeHostedExecutionBaseUrl(value);

  if (!normalized) {
    throw new TypeError("Hosted execution baseUrl must be configured.");
  }

  return normalized;
}

function resolveHostedExecutionOutboxPayloadUserId(payload: HostedExecutionOutboxPayload): string {
  return payload.storage === "inline" ? payload.dispatch.event.userId : payload.dispatchRef.userId;
}

function createHostedExecutionBearerAuthorizationHeaderProvider(
  getBearerToken: (() => Promise<string>) | undefined,
): () => Promise<string> {
  if (!getBearerToken) {
    throw new TypeError("Hosted execution getBearerToken must be configured.");
  }

  return async () => {
    const rawToken = (await getBearerToken()).trim();
    const token = rawToken.startsWith("Bearer ")
      ? rawToken.slice("Bearer ".length).trim()
      : rawToken;

    if (!token) {
      throw new TypeError("Hosted execution bearer token must be configured.");
    }

    return `Bearer ${token}`;
  };
}

async function requestHostedExecutionAuthorizedJson<TResponse>(input: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  getAuthorizationHeader: () => Promise<string>;
  label: string;
  parse: (value: unknown) => TResponse;
  path: string;
  request: {
    body?: string;
    headers?: Record<string, string>;
    method: "GET" | "POST" | "PUT" | "DELETE";
    search?: string | null;
  };
  timeoutMs?: number;
}): Promise<TResponse> {
  const authorization = await input.getAuthorizationHeader();

  return requestHostedExecutionJson({
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    label: input.label,
    parse: input.parse,
    path: input.path,
    request: {
      body: input.request.body,
      headers: {
        ...input.request.headers,
        authorization,
      },
      method: input.request.method,
      search: input.request.search,
      signal: resolveHostedExecutionTimeoutSignal(input.timeoutMs),
    },
  });
}

async function requestHostedExecutionJson<TResponse>(input: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  label: string;
  parse: (value: unknown) => TResponse;
  path: string;
  request: {
    body?: string;
    headers?: Record<string, string>;
    method: "GET" | "POST" | "PUT" | "DELETE";
    search?: string | null;
    signal?: AbortSignal;
  };
}): Promise<TResponse> {
  const targetUrl = new URL(input.path.replace(/^\/+/, ""), `${input.baseUrl}/`);

  if (input.request.search) {
    targetUrl.search = input.request.search;
  }

  const response = await input.fetchImpl(targetUrl.toString(), {
    ...(input.request.body === undefined ? {} : { body: input.request.body }),
    headers: input.request.headers,
    method: input.request.method,
    redirect: "error",
    signal: input.request.signal,
  });
  const text = await response.text();
  const payload = parseHostedExecutionJsonBody(text);

  if (!response.ok) {
    throw new Error(
      `Hosted execution ${input.label} failed with HTTP ${response.status}${formatHostedExecutionErrorSuffix(payload, text)}.`,
    );
  }

  return input.parse(payload);
}

function parseHostedExecutionJsonBody(text: string): unknown {
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

function resolveHostedExecutionTimeoutSignal(timeoutMs: number | undefined): AbortSignal | undefined {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
}
