import {
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_PROVIDER_EGRESS_TOKEN_HEADER,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../runner-outbound/headers.ts";
import { normalizeCloudflareWorkerFetch } from "../worker-fetch.ts";

export function createCloudflareHostedPublicInternetFetch(fetchImpl: typeof fetch): typeof fetch {
  const normalizedFetchImpl = normalizeCloudflareWorkerFetch(fetchImpl);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers = stripCloudflareHostedRuntimeAuthorityHeaders(request.headers);
    return await normalizedFetchImpl(new Request(request, { headers }));
  }) as typeof fetch;
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
