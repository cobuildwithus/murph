import {
  parseHostedUserRecipientPublicKeyJwk,
  parseHostedUserRootKeyEnvelope,
  type HostedUserManagedRootKeyRecipientKind,
  type HostedUserRecipientPublicKeyJwk,
  type HostedUserRootKeyEnvelope,
} from "@murphai/runtime-state";

import { createHostedExecutionSignatureHeaders } from "./auth.ts";
import type {
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchResult,
  HostedExecutionUserEnvStatus,
  HostedExecutionUserEnvUpdate,
  HostedExecutionUserStatus,
} from "./contracts.ts";
import { normalizeHostedExecutionBaseUrl } from "./env.ts";
import {
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
  parseHostedExecutionDispatchRequest,
  parseHostedExecutionDispatchResult,
  parseHostedExecutionUserEnvStatus,
  parseHostedExecutionUserEnvUpdate,
  parseHostedExecutionUserStatus,
} from "./parsers.ts";
import {
  buildHostedExecutionUserDeviceSyncRuntimeSnapshotPath,
  buildHostedExecutionUserEnvPath,
  buildHostedExecutionUserKeyEnvelopePath,
  buildHostedExecutionUserKeyRecipientPath,
  buildHostedExecutionUserPendingUsagePath,
  buildHostedExecutionUserRunPath,
  buildHostedExecutionUserStatusPath,
  HOSTED_EXECUTION_DISPATCH_PATH,
} from "./routes.ts";

export interface HostedExecutionDispatchClient {
  dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult>;
}

export interface HostedExecutionDispatchClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
  signingSecret: string;
  timeoutMs?: number;
}

export interface HostedExecutionUserRootKeyRecipientUpsert {
  metadata?: Record<string, string | number | boolean | null>;
  recipientKeyId: string;
  recipientPublicKeyJwk: HostedUserRecipientPublicKeyJwk;
}

export interface HostedExecutionControlClient {
  clearUserEnv(userId: string): Promise<HostedExecutionUserEnvStatus>;
  deletePendingUsage(userId: string, usageIds: readonly string[]): Promise<void>;
  getPendingUsage(userId: string, limit?: number): Promise<Record<string, unknown>[]>;
  putDeviceSyncRuntimeSnapshot(
    userId: string,
    snapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  ): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
  getStatus(userId: string): Promise<HostedExecutionUserStatus>;
  getUserEnvStatus(userId: string): Promise<HostedExecutionUserEnvStatus>;
  getUserKeyEnvelope(userId: string): Promise<HostedUserRootKeyEnvelope>;
  putUserKeyEnvelope(userId: string, envelope: HostedUserRootKeyEnvelope): Promise<HostedUserRootKeyEnvelope>;
  run(userId: string): Promise<HostedExecutionUserStatus>;
  updateUserEnv(userId: string, update: HostedExecutionUserEnvUpdate): Promise<HostedExecutionUserEnvStatus>;
  upsertUserKeyRecipient(
    userId: string,
    kind: HostedUserManagedRootKeyRecipientKind,
    input: HostedExecutionUserRootKeyRecipientUpsert,
  ): Promise<HostedUserRootKeyEnvelope>;
}

export interface HostedExecutionControlClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
  signingSecret: string;
  timeoutMs?: number;
}

export function createHostedExecutionDispatchClient(
  options: HostedExecutionDispatchClientOptions,
): HostedExecutionDispatchClient {
  const baseUrl = requireHostedExecutionBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async dispatch(input) {
      const requestPayload = parseHostedExecutionDispatchRequest(input);
      const payload = JSON.stringify(requestPayload);
      const path = HOSTED_EXECUTION_DISPATCH_PATH;
      const timestamp = options.now?.() ?? new Date().toISOString();
      const signatureHeaders = await createHostedExecutionSignatureHeaders({
        method: "POST",
        path,
        payload,
        secret: options.signingSecret,
        timestamp,
      });

      return requestHostedExecutionJson({
        baseUrl,
        fetchImpl,
        label: "dispatch",
        parse: parseHostedExecutionDispatchResult,
        path,
        request: {
          body: payload,
          headers: {
            "content-type": "application/json; charset=utf-8",
            ...signatureHeaders,
          },
          method: "POST",
          signal: resolveHostedExecutionTimeoutSignal(options.timeoutMs),
        },
      });
    },
  };
}

export function createHostedExecutionControlClient(
  options: HostedExecutionControlClientOptions,
): HostedExecutionControlClient {
  const baseUrl = requireHostedExecutionBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const signingSecret = requireHostedExecutionSigningSecret(options.signingSecret);

  return {
    clearUserEnv(userId) {
      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: "user env clear",
        now: options.now,
        parse: parseHostedExecutionUserEnvStatus,
        path: buildHostedExecutionUserEnvPath(userId),
        request: { method: "DELETE" },
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
    deletePendingUsage(userId, usageIds) {
      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: "delete pending usage",
        now: options.now,
        parse: () => undefined,
        path: buildHostedExecutionUserPendingUsagePath(userId),
        request: {
          body: JSON.stringify({ usageIds: [...usageIds] }),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "DELETE",
        },
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
    getPendingUsage(userId, limit) {
      const search = typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? new URLSearchParams({ limit: String(Math.floor(limit)) }).toString()
        : null;

      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: "pending usage",
        now: options.now,
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
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
    putDeviceSyncRuntimeSnapshot(userId, snapshot) {
      const requestPayload = parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(snapshot);

      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: "device-sync runtime snapshot mirror",
        now: options.now,
        parse: parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
        path: buildHostedExecutionUserDeviceSyncRuntimeSnapshotPath(userId),
        request: {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "PUT",
        },
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
    getStatus(userId) {
      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: "status",
        now: options.now,
        parse: parseHostedExecutionUserStatus,
        path: buildHostedExecutionUserStatusPath(userId),
        request: { method: "GET" },
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
    getUserEnvStatus(userId) {
      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: "user env status",
        now: options.now,
        parse: parseHostedExecutionUserEnvStatus,
        path: buildHostedExecutionUserEnvPath(userId),
        request: { method: "GET" },
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
    getUserKeyEnvelope(userId) {
      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: "user key envelope",
        now: options.now,
        parse: parseHostedUserRootKeyEnvelope,
        path: buildHostedExecutionUserKeyEnvelopePath(userId),
        request: { method: "GET" },
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
    putUserKeyEnvelope(userId, envelope) {
      const requestPayload = parseHostedUserRootKeyEnvelope(envelope);

      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: "user key envelope write",
        now: options.now,
        parse: parseHostedUserRootKeyEnvelope,
        path: buildHostedExecutionUserKeyEnvelopePath(userId),
        request: {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "PUT",
        },
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
    run(userId) {
      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: "manual run",
        now: options.now,
        parse: parseHostedExecutionUserStatus,
        path: buildHostedExecutionUserRunPath(userId),
        request: {
          body: JSON.stringify({}),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "POST",
        },
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
    updateUserEnv(userId, update) {
      const requestPayload = parseHostedExecutionUserEnvUpdate(update);

      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: "user env update",
        now: options.now,
        parse: parseHostedExecutionUserEnvStatus,
        path: buildHostedExecutionUserEnvPath(userId),
        request: {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "PUT",
        },
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
    upsertUserKeyRecipient(userId, kind, input) {
      const requestPayload = {
        ...(input.metadata ? { metadata: input.metadata } : {}),
        recipientKeyId: input.recipientKeyId,
        recipientPublicKeyJwk: parseHostedUserRecipientPublicKeyJwk(input.recipientPublicKeyJwk),
      } satisfies HostedExecutionUserRootKeyRecipientUpsert;

      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: `user key recipient ${kind}`,
        now: options.now,
        parse: parseHostedUserRootKeyEnvelope,
        path: buildHostedExecutionUserKeyRecipientPath(userId, kind),
        request: {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "PUT",
        },
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
  };
}

function requireHostedExecutionBaseUrl(value: string): string {
  const normalized = normalizeHostedExecutionBaseUrl(value);

  if (!normalized) {
    throw new TypeError("Hosted execution baseUrl must be configured.");
  }

  return normalized;
}

function requireHostedExecutionSigningSecret(value: string): string {
  const normalized = normalizeHostedExecutionSigningSecret(value);

  if (!normalized) {
    throw new TypeError("Hosted execution signingSecret must be configured.");
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

async function requestHostedExecutionSignedJson<TResponse>(input: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  label: string;
  now?: () => string;
  parse: (value: unknown) => TResponse;
  path: string;
  request: {
    body?: string;
    headers?: Record<string, string>;
    method: "GET" | "POST" | "PUT" | "DELETE";
    search?: string | null;
  };
  signingSecret: string;
  timeoutMs?: number;
}): Promise<TResponse> {
  const payload = input.request.body ?? "";
  const timestamp = input.now?.() ?? new Date().toISOString();
  const signatureHeaders = await createHostedExecutionSignatureHeaders({
    method: input.request.method,
    path: input.path,
    payload,
    secret: input.signingSecret,
    timestamp,
  });

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
        ...signatureHeaders,
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
  const targetUrl = new URL(input.path.replace(/^\/+/u, ""), `${input.baseUrl}/`);

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
