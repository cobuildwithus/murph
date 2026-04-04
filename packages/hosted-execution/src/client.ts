import {
  parseHostedUserRootKeyEnvelope,
  type HostedUserRootKeyEnvelope,
  type HostedUserManagedRootKeyRecipientKind,
} from "@murphai/runtime-state";

import { createHostedExecutionSignatureHeaders } from "./auth.ts";
import type {
  HostedExecutionDispatchResult,
  HostedExecutionDispatchRequest,
  HostedExecutionUserEnvStatus,
  HostedExecutionUserEnvUpdate,
  HostedExecutionUserStatus,
} from "./contracts.ts";
import { normalizeHostedExecutionBaseUrl } from "./env.ts";
import {
  parseHostedExecutionDispatchResult,
  parseHostedExecutionDispatchRequest,
  parseHostedExecutionUserEnvStatus,
  parseHostedExecutionUserEnvUpdate,
  parseHostedExecutionUserStatus,
} from "./parsers.ts";
import {
  buildHostedExecutionUserEnvPath,
  buildHostedExecutionUserKeyEnvelopePath,
  buildHostedExecutionUserKeyRecipientPath,
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
  recipientKeyBase64: string;
  recipientKeyId: string;
}

export interface HostedExecutionControlClient {
  clearUserEnv(userId: string): Promise<HostedExecutionUserEnvStatus>;
  getStatus(userId: string): Promise<HostedExecutionUserStatus>;
  getUserEnvStatus(userId: string): Promise<HostedExecutionUserEnvStatus>;
  getUserKeyEnvelope(userId: string): Promise<HostedUserRootKeyEnvelope>;
  run(userId: string): Promise<HostedExecutionUserStatus>;
  updateUserEnv(
    userId: string,
    update: HostedExecutionUserEnvUpdate,
  ): Promise<HostedExecutionUserEnvStatus>;
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
        payload,
        path,
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
        request: {
          method: "DELETE",
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
        request: {
          method: "GET",
        },
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
        request: {
          method: "GET",
        },
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
        parse: (value) => parseHostedUserRootKeyEnvelope(value),
        path: buildHostedExecutionUserKeyEnvelopePath(userId),
        request: {
          method: "GET",
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
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
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
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          method: "PUT",
        },
        signingSecret,
        timeoutMs: options.timeoutMs,
      });
    },
    upsertUserKeyRecipient(userId, kind, input) {
      return requestHostedExecutionSignedJson({
        baseUrl,
        fetchImpl,
        label: `user key recipient ${kind}`,
        now: options.now,
        parse: (value) => parseHostedUserRootKeyEnvelope(value),
        path: buildHostedExecutionUserKeyRecipientPath(userId, kind),
        request: {
          body: JSON.stringify(input),
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
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
  const normalized = normalizeHostedExecutionControlToken(value);

  if (!normalized) {
    throw new TypeError("Hosted execution signingSecret must be configured.");
  }

  return normalized;
}

function normalizeHostedExecutionControlToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveHostedExecutionTimeoutSignal(timeoutMs?: number): AbortSignal | undefined {
  return typeof timeoutMs === "number" ? AbortSignal.timeout(timeoutMs) : undefined;
}

async function requestHostedExecutionJson<TResponse>(input: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  label: string;
  parse: (value: unknown) => TResponse;
  path: string;
  request: RequestInit;
}): Promise<TResponse> {
  const response = await input.fetchImpl(
    new URL(input.path.replace(/^\/+/u, ""), `${input.baseUrl}/`).toString(),
    input.request,
  );
  const text = await response.text();
  const payload = parseHostedExecutionJsonPayload(text);

  if (!response.ok) {
    throw new Error(
      `Hosted execution ${input.label} failed with HTTP ${response.status}${
        text ? `: ${text.slice(0, 500)}` : ""
      }.`,
    );
  }

  return input.parse(payload);
}

async function requestHostedExecutionSignedJson<TResponse>(input: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  label: string;
  now?: () => string;
  parse: (value: unknown) => TResponse;
  path: string;
  request: RequestInit;
  signingSecret: string;
  timeoutMs?: number;
}): Promise<TResponse> {
  const payload = readHostedExecutionRequestBody(input.request.body);
  const timestamp = input.now?.() ?? new Date().toISOString();
  const signatureHeaders = await createHostedExecutionSignatureHeaders({
    method: input.request.method,
    path: input.path,
    payload,
    secret: input.signingSecret,
    timestamp,
  });

  const headers = normalizeHostedExecutionRequestHeaders(input.request.headers);

  for (const [key, value] of Object.entries(signatureHeaders)) {
    headers.set(key, value);
  }

  return requestHostedExecutionJson({
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    label: input.label,
    parse: input.parse,
    path: input.path,
    request: {
      ...input.request,
      headers,
      signal: resolveHostedExecutionTimeoutSignal(input.timeoutMs),
    },
  });
}

function normalizeHostedExecutionRequestHeaders(headers: HeadersInit | undefined): Headers {
  return new Headers(headers);
}

function readHostedExecutionRequestBody(body: BodyInit | null | undefined): string {
  if (typeof body === "string") {
    return body;
  }

  if (body === undefined || body === null) {
    return "";
  }

  throw new TypeError("Hosted execution signed requests require string request bodies.");
}

function parseHostedExecutionJsonPayload(text: string): unknown {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
