export function createRouteContext<TParams extends Record<string, string>>(params: TParams) {
  return {
    params: Promise.resolve(params),
  };
}

function mergeHeaders(...headerSets: Array<HeadersInit | undefined>) {
  const headers = new Headers();

  for (const headerSet of headerSets) {
    if (!headerSet) {
      continue;
    }

    const currentHeaders = new Headers(headerSet);
    currentHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

export function createJsonPostRequest(
  url: string,
  body: unknown,
  init: Omit<RequestInit, "body" | "method"> = {},
) {
  return new Request(url, {
    ...init,
    body: JSON.stringify(body),
    headers: mergeHeaders(init.headers, {
      "content-type": "application/json",
    }),
    method: "POST",
  });
}

export function createBearerRequest(
  url: string,
  bearerToken: string,
  init: RequestInit = {},
) {
  return new Request(url, {
    ...init,
    headers: mergeHeaders(init.headers, {
      authorization: `Bearer ${bearerToken}`,
    }),
  });
}
