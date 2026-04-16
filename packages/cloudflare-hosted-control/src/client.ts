import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionDispatchStatus,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution/contracts";
import { normalizeHostedExecutionBaseUrl } from "@murphai/hosted-execution/env";
import {
  parseHostedExecutionDispatchStatus,
  parseHostedExecutionUserStatus,
} from "@murphai/hosted-execution/parsers";

import {
  buildCloudflareHostedControlUserEventStatusPath,
  buildCloudflareHostedControlUserRunPath,
  buildCloudflareHostedControlUserStatusPath,
} from "./routes.ts";

export interface CloudflareHostedControlClient {
  getEventStatus(userId: string, eventId: string): Promise<HostedExecutionDispatchStatus | null>;
  getStatus(userId: string): Promise<HostedExecutionUserStatus>;
  run(userId: string): Promise<HostedExecutionUserStatus>;
}

export interface CloudflareHostedControlClientOptions {
  allowHttpHosts?: readonly string[];
  allowHttpLocalhost?: boolean;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getBearerToken: () => Promise<string>;
  timeoutMs?: number;
}

export function createCloudflareHostedControlClient(
  options: CloudflareHostedControlClientOptions,
): CloudflareHostedControlClient {
  const baseUrl = requireHostedExecutionBaseUrl(options.baseUrl, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const getAuthorizationHeader = createHostedExecutionBearerAuthorizationHeaderProvider(
    options.getBearerToken,
  );

  return {
    getEventStatus(userId, eventId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "event status",
        parse: parseHostedExecutionDispatchStatusOrNull,
        path: buildCloudflareHostedControlUserEventStatusPath(userId, eventId),
        request: { method: "GET" },
        timeoutMs: options.timeoutMs,
      });
    },
    getStatus(userId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
        fetchImpl,
        getAuthorizationHeader,
        label: "status",
        parse: parseHostedExecutionUserStatus,
        path: buildCloudflareHostedControlUserStatusPath(userId),
        request: { method: "GET" },
        timeoutMs: options.timeoutMs,
      });
    },
    run(userId) {
      return requestHostedExecutionAuthorizedJson({
        baseUrl,
        boundUserId: userId,
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
  };
}

function parseHostedExecutionDispatchStatusOrNull(
  value: unknown,
): HostedExecutionDispatchStatus | null {
  return value === null ? null : parseHostedExecutionDispatchStatus(value);
}

function requireHostedExecutionBaseUrl(
  value: string,
  options: Pick<CloudflareHostedControlClientOptions, "allowHttpHosts" | "allowHttpLocalhost">,
): string {
  const normalized = normalizeHostedExecutionBaseUrl(value, options);

  if (!normalized) {
    throw new TypeError("Hosted execution baseUrl must be configured.");
  }

  return normalized;
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
  boundUserId?: string;
  fetchImpl: typeof fetch;
  getAuthorizationHeader: () => Promise<string>;
  label: string;
  parse: (value: unknown) => TResponse;
  path: string;
  request: {
    body?: string;
    headers?: HeadersInit;
    method: "GET" | "POST";
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

  if (input.boundUserId) {
    headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.boundUserId);
  }

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

  return input.parse(await response.json());
}
