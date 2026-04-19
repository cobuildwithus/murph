import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
} from "@murphai/hosted-execution/contracts";
import type { HostedExecutionRunPhase } from "@murphai/hosted-execution";
import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";

import { HOSTED_EXECUTION_INTERNAL_PROXY_HOST_HEADER } from "./internal-hosts.ts";

const LOCAL_LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

interface LocalLoopbackProxyRequestInit extends RequestInit {
  duplex?: "half";
}

export function isLocalLoopbackProxyHostname(value: string): boolean {
  return LOCAL_LOOPBACK_HOSTNAMES.has(normalizeLocalLoopbackHostname(value));
}

export function isLocalLoopbackProxyProtocol(value: string): boolean {
  return value === "http:" || value === "https:";
}

export function readLocalLoopbackProxyBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!isLocalLoopbackProxyProtocol(url.protocol) || !isLocalLoopbackProxyHostname(url.hostname)) {
      return null;
    }
    return new URL(`${url.origin}${url.pathname.replace(/\/?$/u, "/")}`);
  } catch {
    return null;
  }
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
    headers: buildLocalLoopbackProxyResponseHeaders(response.headers),
    status: response.status,
  });
}

function createLocalLoopbackProxyRequest(upstreamUrl: URL, request: Request): Request {
  const init: LocalLoopbackProxyRequestInit = {
    headers: buildLocalLoopbackProxyRequestHeaders(request.headers, upstreamUrl),
    method: request.method,
    signal: request.signal,
  };

  if (request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  return new Request(upstreamUrl, init);
}

function buildLocalLoopbackProxyRequestHeaders(headers: Headers, upstreamUrl: URL): Headers {
  const nextHeaders = new Headers();

  headers.forEach((value, key) => {
    if (shouldStripLocalLoopbackProxyHeader(key)) {
      return;
    }
    nextHeaders.set(key, value);
  });

  return nextHeaders;
}

function buildLocalLoopbackProxyResponseHeaders(headers: Headers): Headers {
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
  const redacted =
    redactLocalInternalProxyPathname(pathname)
    ?? redactProxyPathToken(pathname, "/__murph/local-loopback-proxy/");
  return redacted ?? pathname;
}

function redactLocalInternalProxyPathname(pathname: string): string | null {
  const match = /^\/__murph\/local-internal-proxy\/users\/[^/]+(?<suffix>\/.*)?$/u.exec(pathname);
  if (!match?.groups) {
    return null;
  }

  return `/__murph/local-internal-proxy/users/<redacted>${match.groups.suffix ?? ""}`;
}

function redactProxyPathToken(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const suffix = pathname.slice(prefix.length);
  if (suffix.length === 0) {
    return `${prefix}<redacted>`;
  }

  const separatorIndex = suffix.indexOf("/");
  if (separatorIndex < 0) {
    return `${prefix}<redacted>`;
  }

  return `${prefix}<redacted>${suffix.slice(separatorIndex)}`;
}

function normalizeLocalLoopbackHostname(value: string): string {
  return value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
}
