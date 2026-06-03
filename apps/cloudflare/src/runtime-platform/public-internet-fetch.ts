import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../runner-outbound/headers.ts";

export function createCloudflareHostedPublicInternetFetch(fetchImpl: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers = stripCloudflareHostedRuntimeAuthorityHeaders(request.headers);
    return await fetchImpl(new Request(request, { headers }));
  }) as typeof fetch;
}

function stripCloudflareHostedRuntimeAuthorityHeaders(headers: Headers): Headers {
  const stripped = new Headers(headers);
  stripped.delete(HOSTED_RUNTIME_ATTEMPT_ID_HEADER);
  stripped.delete(HOSTED_RUNTIME_LEASE_GENERATION_HEADER);
  stripped.delete(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER);
  stripped.delete(HOSTED_RUNNER_BOUND_USER_ID_HEADER);
  stripped.delete("x-hosted-execution-runner-proxy-token");
  return stripped;
}
