import type {
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchResult,
} from "./contracts.ts";
import { normalizeHostedExecutionBaseUrl } from "./env.ts";
import {
  parseHostedExecutionDispatchRequest,
  parseHostedExecutionDispatchResult,
} from "./parsers.ts";
import {
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

function requireHostedExecutionBaseUrl(value: string): string {
  const normalized = normalizeHostedExecutionBaseUrl(value);

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

  const response = await input.fetchImpl(url.toString(), {
    ...(input.request.body === undefined ? {} : { body: input.request.body }),
    headers,
    method: input.request.method,
    redirect: "error",
    signal: typeof input.timeoutMs === "number" ? AbortSignal.timeout(input.timeoutMs) : undefined,
  });

  if (!response.ok) {
    const body = await response.text();
    const suffix = body.trim().length > 0 ? `: ${body.trim().slice(0, 500)}` : "";
    throw new Error(
      `Hosted execution ${input.label} failed with HTTP ${response.status}${suffix}.`,
    );
  }

  return input.parse(await response.json());
}
