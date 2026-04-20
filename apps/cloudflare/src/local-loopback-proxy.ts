import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";
import type { HostedExecutionRunPhase } from "@murphai/hosted-execution";
import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";

import { HOSTED_EXECUTION_INTERNAL_PROXY_HOST_HEADER } from "./internal-hosts.ts";

interface LocalLoopbackProxyRequestInit extends RequestInit {
  duplex?: "half";
}

export function isLocalLoopbackProxyProtocol(value: string): boolean {
  return value === "http:" || value === "https:";
}

export async function proxyLocalLoopbackRequest(input: {
  component: string;
  completedMessage: string;
  failedMessage: string;
  phase: HostedExecutionRunPhase;
  request: Request;
  startMessage: string;
  upstreamUrl: URL;
}): Promise<Response> {
  const details = {
    hasBody: input.request.body ? "true" : "false",
    hasQuery: input.upstreamUrl.search.length > 0 ? "true" : "false",
    method: input.request.method,
    upstreamOrigin: input.upstreamUrl.origin,
    upstreamPathname: redactTokenizedLocalProxyPathname(input.upstreamUrl.pathname),
  };

  emitHostedExecutionStructuredLog({
    component: input.component,
    details,
    message: input.startMessage,
    phase: input.phase,
  });

  let response: Response;
  try {
    response = await fetch(createLocalLoopbackProxyRequest(input.upstreamUrl, input.request));
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: input.component,
      details,
      error,
      level: "warn",
      message: input.failedMessage,
      phase: input.phase,
    });
    throw error;
  }

  emitHostedExecutionStructuredLog({
    component: input.component,
    details: {
      ...details,
      status: String(response.status),
    },
    message: input.completedMessage,
    phase: input.phase,
  });

  return new Response(response.body, {
    headers: copyLocalLoopbackProxyHeaders(response.headers),
    status: response.status,
  });
}

function createLocalLoopbackProxyRequest(upstreamUrl: URL, request: Request): Request {
  const init: LocalLoopbackProxyRequestInit = {
    headers: copyLocalLoopbackProxyHeaders(request.headers),
    method: request.method,
    signal: request.signal,
  };

  if (request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  return new Request(upstreamUrl, init);
}

function copyLocalLoopbackProxyHeaders(headers: Headers): Headers {
  const nextHeaders = new Headers();

  headers.forEach((value, key) => {
    if (shouldStripLocalLoopbackProxyHeader(key)) {
      return;
    }
    nextHeaders.set(key, value);
  });

  return nextHeaders;
}

function shouldStripLocalLoopbackProxyHeader(name: string): boolean {
  switch (name.toLowerCase()) {
    case "connection":
    case "content-length":
    case HOSTED_EXECUTION_INTERNAL_PROXY_HOST_HEADER:
    case HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER:
    case "host":
    case "keep-alive":
    case "proxy-authenticate":
    case "proxy-authorization":
    case "te":
    case "trailer":
    case "transfer-encoding":
    case "upgrade":
      return true;
    default:
      return false;
  }
}

function redactTokenizedLocalProxyPathname(pathname: string): string {
  return redactLocalInternalProxyPathname(pathname) ?? pathname;
}

function redactLocalInternalProxyPathname(pathname: string): string | null {
  const match = /^\/__murph\/local-internal-proxy\/users\/[^/]+(?<suffix>\/.*)?$/u.exec(pathname);
  if (!match?.groups) {
    return null;
  }

  return `/__murph/local-internal-proxy/users/<redacted>${match.groups.suffix ?? ""}`;
}
