export interface HostedExecutionWebJsonRequest<TResponse> {
  allowNotFound?: boolean;
  body?: string;
  label: string;
  method: "DELETE" | "GET" | "POST" | "PUT";
  parse: (value: unknown) => TResponse;
  path: string;
  search?: string | null;
}

export interface HostedExecutionWebJsonRequester {
  requestJson<TResponse>(input: HostedExecutionWebJsonRequest<TResponse>): Promise<TResponse | null>;
}

export function createHostedExecutionWebJsonRequester(input: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getBearerToken: () => Promise<string>;
  timeoutMs?: number;
}): HostedExecutionWebJsonRequester {
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    async requestJson<TResponse>(request: HostedExecutionWebJsonRequest<TResponse>) {
      const url = new URL(request.path.replace(/^\/+/u, ""), `${input.baseUrl}/`);

      if (request.search) {
        url.search = request.search;
      }

      const headers = new Headers();
      headers.set("authorization", await readHostedExecutionBearerAuthorization(input.getBearerToken));

      if (request.body !== undefined) {
        headers.set("content-type", "application/json; charset=utf-8");
      }

      const response = await fetchImpl(url.toString(), {
        ...(request.body === undefined ? {} : { body: request.body }),
        headers,
        method: request.method,
        redirect: "error",
        signal: typeof input.timeoutMs === "number" ? AbortSignal.timeout(input.timeoutMs) : undefined,
      });

      if (request.allowNotFound && response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`Hosted execution ${request.label} failed with HTTP ${response.status}.`);
      }

      if (response.status === 204) {
        return request.parse(undefined);
      }

      return request.parse(await response.json());
    },
  };
}

async function readHostedExecutionBearerAuthorization(
  getBearerToken: () => Promise<string>,
): Promise<string> {
  const rawToken = (await getBearerToken()).trim();
  const token = rawToken.startsWith("Bearer ")
    ? rawToken.slice("Bearer ".length).trim()
    : rawToken;

  if (!token) {
    throw new TypeError("Hosted execution bearer token must be configured.");
  }

  return `Bearer ${token}`;
}
