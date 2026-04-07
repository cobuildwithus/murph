import {
  createHostedExecutionSignatureHeaders,
} from "@murphai/hosted-execution/auth";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";

export function normalizeHostedWebControlBaseUrl(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHostedExecutionBaseUrl(value, {
    allowHttpLocalhost: true,
  });

  return normalized ? new URL(normalized).origin : null;
}

export async function fetchHostedExecutionWebControlPlaneResponse(input: {
  baseUrl: string;
  body?: string;
  boundUserId: string;
  fetchImpl?: typeof fetch;
  method: "GET" | "POST";
  path: string;
  search?: string | null;
  signingSecret?: string | null;
  timeoutMs: number | null;
}): Promise<Response> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const targetUrl = new URL(
    input.path.replace(/^\/+/u, ""),
    `${requireHostedWebControlBaseUrl(input.baseUrl)}/`,
  );

  if (input.search) {
    targetUrl.search = input.search;
  }

  const headers = new Headers();
  headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.boundUserId);

  if (input.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const signingSecret = normalizeHostedWebControlSigningSecret(input.signingSecret);

  if (signingSecret) {
    const signatureHeaders = await createHostedExecutionSignatureHeaders({
      method: input.method,
      nonce: null,
      path: targetUrl.pathname,
      payload: input.body ?? "",
      search: targetUrl.search,
      secret: signingSecret,
      timestamp: new Date().toISOString(),
      userId: input.boundUserId,
    });

    for (const [key, value] of Object.entries(signatureHeaders)) {
      headers.set(key, value);
    }
  }

  return fetchImpl(targetUrl.toString(), {
    ...(input.body === undefined ? {} : { body: input.body }),
    headers,
    method: input.method,
    redirect: "error",
    signal: typeof input.timeoutMs === "number" ? AbortSignal.timeout(input.timeoutMs) : undefined,
  });
}

function requireHostedWebControlBaseUrl(value: string): string {
  const normalized = normalizeHostedWebControlBaseUrl(value);

  if (!normalized) {
    throw new TypeError("Hosted web control-plane baseUrl must be configured.");
  }

  return normalized;
}

function normalizeHostedWebControlSigningSecret(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
