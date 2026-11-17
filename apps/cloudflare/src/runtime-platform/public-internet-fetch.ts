import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_PROVIDER_EGRESS_TOKEN_HEADER,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../runner-outbound/headers.ts";
import { normalizeCloudflareWorkerFetch } from "../worker-fetch.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES } from "../internal-hosts.ts";

export function createCloudflareHostedPublicInternetFetch(fetchImpl: typeof fetch): typeof fetch {
  const normalizedFetchImpl = normalizeCloudflareWorkerFetch(fetchImpl);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let request = new Request(input, init);
    const redirectMode = request.redirect;
    for (let hop = 0; ; hop += 1) {
      assertPublicDestination(new URL(request.url));
      const headers = stripCloudflareHostedRuntimeAuthorityHeaders(request.headers);
      const response = await normalizedFetchImpl(new Request(request.clone() as Request, { headers, redirect: "manual" }));
      const location = response.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(response.status) || location === null) return response;
      try {
        const target = new URL(location, request.url);
        assertPublicDestination(target);
        if (redirectMode === "manual") return response;
        if (redirectMode === "error" || hop >= 20) throw new Error("Public fetch redirect rejected.");
        request = buildRedirectRequest(request, target, response.status, headers);
      } catch (error) {
        await response.body?.cancel();
        throw error;
      }
      await response.body?.cancel();
    }
  }) as typeof fetch;
}

function buildRedirectRequest(request: Request, target: URL, status: number, headers: Headers): Request {
  if (target.origin !== new URL(request.url).origin) {
    for (const header of ["authorization", "proxy-authorization", "cookie", "cookie2"]) headers.delete(header);
  }
  const becomesGet = ((status === 301 || status === 302) && request.method === "POST")
    || (status === 303 && request.method !== "GET" && request.method !== "HEAD");
  if (becomesGet) {
    for (const header of ["content-type", "content-length", "content-encoding", "content-language", "content-location"]) headers.delete(header);
  }
  return new Request(target, {
    method: becomesGet ? "GET" : request.method,
    headers,
    ...(!becomesGet && request.body ? { body: request.body, duplex: "half" } : {}),
    signal: request.signal,
    redirect: "manual",
  });
}

function assertPublicDestination(url: URL): void {
  if (!["http:", "https:"].includes(url.protocol)
    || url.username || url.password
    || CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname.toLowerCase().replace(/\.+$/u, ""))) {
    throw new Error("Public fetch destination is not allowed.");
  }
}

function stripCloudflareHostedRuntimeAuthorityHeaders(headers: Headers): Headers {
  const stripped = new Headers(headers);
  stripped.delete(HOSTED_RUNTIME_ATTEMPT_ID_HEADER);
  stripped.delete(HOSTED_RUNTIME_LEASE_GENERATION_HEADER);
  stripped.delete(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER);
  stripped.delete(HOSTED_RUNNER_BOUND_USER_ID_HEADER);
  stripped.delete(HOSTED_PROVIDER_EGRESS_TOKEN_HEADER);
  stripped.delete(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER);
  return stripped;
}
