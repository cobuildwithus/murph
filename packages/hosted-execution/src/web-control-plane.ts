import { HOSTED_EXECUTION_USER_ID_HEADER } from "./contracts.ts";
import { normalizeHostedExecutionBaseUrl } from "./env.ts";

function requireHostedExecutionWebControlBaseUrl(value: string): string {
  const normalized = normalizeHostedExecutionBaseUrl(value, {
    allowHttpLocalhost: true,
  });

  if (!normalized) {
    throw new TypeError("Hosted web control-plane baseUrl must be configured.");
  }

  return normalized;
}
export async function fetchHostedExecutionWebControlPlaneResponse(input: {
  baseUrl: string;
  body?: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  method: "GET" | "POST";
  path: string;
  search?: string | null;
  timeoutMs: number | null;
}): Promise<Response> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const targetUrl = new URL(
    input.path.replace(/^\/+/u, ""),
    `${requireHostedExecutionWebControlBaseUrl(input.baseUrl)}/`,
  );

  if (input.search) {
    targetUrl.search = input.search;
  }

  const headers = buildHostedExecutionRequestHeaders({
    boundUserId: input.boundUserId,
    withJsonContentType: input.body !== undefined,
  });

  return fetchImpl(targetUrl.toString(), {
    ...(input.body === undefined ? {} : { body: input.body }),
    headers,
    method: input.method,
    redirect: "error",
    signal: typeof input.timeoutMs === "number" ? AbortSignal.timeout(input.timeoutMs) : undefined,
  });
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
