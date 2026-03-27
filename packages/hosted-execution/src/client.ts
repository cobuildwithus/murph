import { createHostedExecutionSignatureHeaders } from "./auth.js";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionUserEnvStatus,
  HostedExecutionUserEnvUpdate,
  HostedExecutionUserStatus,
} from "./contracts.js";
import { normalizeHostedExecutionBaseUrl } from "./env.js";
import {
  buildHostedExecutionUserEnvPath,
  buildHostedExecutionUserRunPath,
  buildHostedExecutionUserStatusPath,
  HOSTED_EXECUTION_DISPATCH_PATH,
} from "./routes.js";

export interface HostedExecutionDispatchClient {
  dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus>;
}

export interface HostedExecutionDispatchClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
  signingSecret: string;
  timeoutMs?: number;
}

export interface HostedExecutionControlClient {
  clearUserEnv(userId: string): Promise<HostedExecutionUserEnvStatus>;
  getStatus(userId: string): Promise<HostedExecutionUserStatus>;
  getUserEnvStatus(userId: string): Promise<HostedExecutionUserEnvStatus>;
  run(userId: string): Promise<HostedExecutionUserStatus>;
  updateUserEnv(
    userId: string,
    update: HostedExecutionUserEnvUpdate,
  ): Promise<HostedExecutionUserEnvStatus>;
}

export interface HostedExecutionControlClientOptions {
  baseUrl: string;
  controlToken?: string | null;
  fetchImpl?: typeof fetch;
}

export function createHostedExecutionDispatchClient(
  options: HostedExecutionDispatchClientOptions,
): HostedExecutionDispatchClient {
  const baseUrl = requireHostedExecutionBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async dispatch(input) {
      const payload = JSON.stringify(input);
      const timestamp = options.now?.() ?? new Date().toISOString();
      const signatureHeaders = await createHostedExecutionSignatureHeaders({
        payload,
        secret: options.signingSecret,
        timestamp,
      });

      return requestHostedExecutionJson<HostedExecutionUserStatus>({
        baseUrl,
        fetchImpl,
        label: "dispatch",
        path: HOSTED_EXECUTION_DISPATCH_PATH,
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
  const authHeaders = withHostedExecutionControlToken(undefined, options.controlToken ?? null);

  return {
    clearUserEnv(userId) {
      return requestHostedExecutionJson<HostedExecutionUserEnvStatus>({
        baseUrl,
        fetchImpl,
        label: "user env clear",
        path: buildHostedExecutionUserEnvPath(userId),
        request: {
          headers: authHeaders,
          method: "DELETE",
        },
      });
    },
    getStatus(userId) {
      return requestHostedExecutionJson<HostedExecutionUserStatus>({
        baseUrl,
        fetchImpl,
        label: "status",
        path: buildHostedExecutionUserStatusPath(userId),
        request: {
          headers: authHeaders,
          method: "GET",
        },
      });
    },
    getUserEnvStatus(userId) {
      return requestHostedExecutionJson<HostedExecutionUserEnvStatus>({
        baseUrl,
        fetchImpl,
        label: "user env status",
        path: buildHostedExecutionUserEnvPath(userId),
        request: {
          headers: authHeaders,
          method: "GET",
        },
      });
    },
    run(userId) {
      return requestHostedExecutionJson<HostedExecutionUserStatus>({
        baseUrl,
        fetchImpl,
        label: "manual run",
        path: buildHostedExecutionUserRunPath(userId),
        request: {
          body: JSON.stringify({}),
          headers: withHostedExecutionControlToken(
            {
              "content-type": "application/json; charset=utf-8",
            },
            options.controlToken ?? null,
          ),
          method: "POST",
        },
      });
    },
    updateUserEnv(userId, update) {
      return requestHostedExecutionJson<HostedExecutionUserEnvStatus>({
        baseUrl,
        fetchImpl,
        label: "user env update",
        path: buildHostedExecutionUserEnvPath(userId),
        request: {
          body: JSON.stringify(update),
          headers: withHostedExecutionControlToken(
            {
              "content-type": "application/json; charset=utf-8",
            },
            options.controlToken ?? null,
          ),
          method: "PUT",
        },
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

function resolveHostedExecutionTimeoutSignal(timeoutMs?: number): AbortSignal | undefined {
  return typeof timeoutMs === "number" ? AbortSignal.timeout(timeoutMs) : undefined;
}

async function requestHostedExecutionJson<TResponse>(input: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  label: string;
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

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Hosted execution ${input.label} returned a non-object JSON payload.`);
  }

  return payload as TResponse;
}

function withHostedExecutionControlToken(
  headers: HeadersInit | undefined,
  controlToken: string | null,
): HeadersInit | undefined {
  if (!controlToken) {
    return headers;
  }

  const nextHeaders = new Headers(headers);
  nextHeaders.set("authorization", `Bearer ${controlToken}`);
  return nextHeaders;
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
