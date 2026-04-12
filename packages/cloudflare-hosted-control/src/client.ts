import type {
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchResult,
  HostedExecutionEventDispatchStatus,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedExecutionOutboxPayload,
} from "@murphai/hosted-execution";
import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";
import {
  parseHostedExecutionDispatchRequest,
  parseHostedExecutionDispatchResult,
  parseHostedExecutionEventDispatchStatus,
  parseHostedExecutionOutboxPayload,
  parseHostedExecutionUserStatus,
} from "@murphai/hosted-execution/parsers";

import type {
  CloudflareHostedManagedUserCryptoStatus,
  CloudflareHostedUserEnvStatus,
  CloudflareHostedUserEnvUpdate,
} from "./contracts.ts";
import {
  parseCloudflareHostedManagedUserCryptoStatus,
  parseCloudflareHostedUserEnvStatus,
  parseCloudflareHostedUserEnvUpdate,
} from "./parsers.ts";
import {
  buildCloudflareHostedControlUserCryptoContextPath,
  buildCloudflareHostedControlUserDispatchPayloadPath,
  buildCloudflareHostedControlUserEventStatusPath,
  buildCloudflareHostedControlUserEnvPath,
  buildCloudflareHostedControlUserRunPath,
  buildCloudflareHostedControlUserStatusPath,
  buildCloudflareHostedControlUserStoredDispatchPath,
} from "./routes.ts";

export interface CloudflareHostedControlClient {
  clearUserEnv(userId: string): Promise<CloudflareHostedUserEnvStatus>;
  deleteStoredDispatchPayload(payload: HostedExecutionOutboxPayload): Promise<void>;
  dispatchStoredPayload(payload: HostedExecutionOutboxPayload): Promise<HostedExecutionDispatchResult>;
  getEventStatus(userId: string, eventId: string): Promise<HostedExecutionEventDispatchStatus | null>;
  getStatus(userId: string): Promise<HostedExecutionUserStatus>;
  getUserEnvStatus(userId: string): Promise<CloudflareHostedUserEnvStatus>;
  provisionManagedUserCrypto(userId: string): Promise<CloudflareHostedManagedUserCryptoStatus>;
  run(userId: string): Promise<HostedExecutionUserStatus>;
  storeDispatchPayload(dispatch: HostedExecutionDispatchRequest): Promise<HostedExecutionOutboxPayload>;
  updateUserEnv(
    userId: string,
    update: CloudflareHostedUserEnvUpdate,
  ): Promise<CloudflareHostedUserEnvStatus>;
}

export interface CloudflareHostedControlClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getBearerToken: () => Promise<string>;
  timeoutMs?: number;
}

export function createCloudflareHostedControlClient(
  options: CloudflareHostedControlClientOptions,
): CloudflareHostedControlClient {
  const baseUrl = requireHostedExecutionBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const getAuthorizationHeader = createHostedExecutionBearerAuthorizationHeaderProvider(
    options.getBearerToken,
  );

  return {
    clearUserEnv(userId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "user env clear",
        parse: parseCloudflareHostedUserEnvStatus,
        path: buildCloudflareHostedControlUserEnvPath(userId),
        request: { method: "DELETE" },
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
        path: buildCloudflareHostedControlUserDispatchPayloadPath(
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
        path: buildCloudflareHostedControlUserStoredDispatchPath(
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
    getEventStatus(userId, eventId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "event status",
        parse: parseHostedExecutionEventDispatchStatusOrNull,
        path: buildCloudflareHostedControlUserEventStatusPath(userId, eventId),
        request: { method: "GET" },
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
        path: buildCloudflareHostedControlUserStatusPath(userId),
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
        parse: parseCloudflareHostedUserEnvStatus,
        path: buildCloudflareHostedControlUserEnvPath(userId),
        request: { method: "GET" },
        timeoutMs: options.timeoutMs,
      });
    },
    provisionManagedUserCrypto(userId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "managed user crypto provision",
        parse: parseCloudflareHostedManagedUserCryptoStatus,
        path: buildCloudflareHostedControlUserCryptoContextPath(userId),
        request: {
          method: "PUT",
        },
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
        path: buildCloudflareHostedControlUserRunPath(userId),
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
        path: buildCloudflareHostedControlUserDispatchPayloadPath(dispatch.event.userId),
        request: {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "PUT",
        },
        timeoutMs: options.timeoutMs,
      });
    },
    updateUserEnv(userId, update) {
      const requestPayload = parseCloudflareHostedUserEnvUpdate(update);

      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        fetchImpl,
        getAuthorizationHeader,
        label: "user env update",
        parse: parseCloudflareHostedUserEnvStatus,
        path: buildCloudflareHostedControlUserEnvPath(userId),
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

function parseHostedExecutionEventDispatchStatusOrNull(
  value: unknown,
): HostedExecutionEventDispatchStatus | null {
  return value === null ? null : parseHostedExecutionEventDispatchStatus(value);
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
    headers?: HeadersInit;
    method: "DELETE" | "GET" | "POST" | "PUT";
    search?: string | null;
  };
  timeoutMs: number | undefined;
}): Promise<TResponse> {
  const url = new URL(input.path.replace(/^\/+/u, ""), `${input.baseUrl}/`);

  if (input.request.search) {
    url.search = input.request.search;
  }

  const headers = new Headers(input.request.headers);
  headers.set("authorization", await input.getAuthorizationHeader());

  const response = await input.fetchImpl(url.toString(), {
    ...(input.request.body === undefined ? {} : { body: input.request.body }),
    headers,
    method: input.request.method,
    redirect: "error",
    signal: typeof input.timeoutMs === "number" ? AbortSignal.timeout(input.timeoutMs) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Hosted execution ${input.label} failed with HTTP ${response.status}.`);
  }

  if (response.status === 204) {
    return input.parse(undefined);
  }

  return input.parse(await response.json());
}
