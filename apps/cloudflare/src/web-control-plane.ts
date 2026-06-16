import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";

import {
  createHostedWebCallbackSignatureHeaders,
  type HostedWebCallbackSigningEnvironment,
} from "./web-callback-auth.ts";
import { normalizeCloudflareWorkerFetch } from "./worker-fetch.ts";

export const LOCAL_CONTAINER_HTTP_WEB_CONTROL_HOSTS = [
  "host.docker.internal",
] as const;
const HOSTED_WEB_CONTROL_STRIPPED_HEADER_NAMES = [
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-hosted-runner-bound-user-id",
] as const;

export interface HostedWebControlBaseUrlOptions {
  allowHttpHosts?: readonly string[];
}

export function normalizeHostedWebControlBaseUrl(
  value: string | null | undefined,
  options: HostedWebControlBaseUrlOptions = {},
): string | null {
  const normalized = normalizeHostedExecutionBaseUrl(value, {
    allowHttpHosts: options.allowHttpHosts,
    allowHttpLocalhost: true,
    requireOriginOnly: true,
  });

  return normalized ?? null;
}

export async function fetchHostedExecutionWebControlPlaneResponse(input: {
  baseUrl: string;
  body?: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  headers?: Headers;
  method: "GET" | "POST";
  path: string;
  allowHttpHosts?: readonly string[];
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  search?: string | null;
  signal?: AbortSignal | null;
  timeoutMs: number | null;
}): Promise<Response> {
  const fetchImpl = normalizeCloudflareWorkerFetch(input.fetchImpl);
  const targetUrl = new URL(
    input.path.replace(/^\/+/u, ""),
    `${requireHostedWebControlBaseUrl(input.baseUrl, {
      allowHttpHosts: input.allowHttpHosts,
    })}/`,
  );

  if (input.search) {
    targetUrl.search = input.search;
  }

  const headers = createHostedWebControlForwardHeaders(input.headers);
  headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.boundUserId);

  if (input.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (input.callbackSigning) {
    const signatureHeaders = await createHostedWebCallbackSignatureHeaders({
      environment: input.callbackSigning,
      method: input.method,
      nonce: null,
      path: targetUrl.pathname,
      payload: input.body ?? "",
      search: targetUrl.search,
      userId: input.boundUserId,
    });

    for (const key of Object.keys(signatureHeaders)) {
      const value = signatureHeaders[key];

      if (typeof value === "string") {
        headers.set(key, value);
      }
    }
  }

  return fetchImpl(targetUrl.toString(), {
    ...(input.body === undefined ? {} : { body: input.body }),
    headers,
    method: input.method,
    redirect: "manual",
    signal: input.signal ?? (
      typeof input.timeoutMs === "number"
        ? AbortSignal.timeout(input.timeoutMs)
        : undefined
    ),
  });
}

function createHostedWebControlForwardHeaders(
  inputHeaders: Headers | undefined,
): Headers {
  const headers = new Headers(inputHeaders);

  for (const name of HOSTED_WEB_CONTROL_STRIPPED_HEADER_NAMES) {
    headers.delete(name);
  }

  return headers;
}

function requireHostedWebControlBaseUrl(
  value: string,
  options: HostedWebControlBaseUrlOptions = {},
): string {
  const normalized = normalizeHostedWebControlBaseUrl(value, options);

  if (!normalized) {
    throw new TypeError("Hosted web control-plane baseUrl must be configured.");
  }

  return normalized;
}
