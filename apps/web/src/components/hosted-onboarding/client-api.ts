interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
  };
}

export async function requestHostedOnboardingJson<T>(input: {
  method?: "GET" | "POST";
  payload?: Record<string, unknown>;
  url: string;
}): Promise<T> {
  const response = await fetch(input.url, {
    method: input.method ?? (input.payload ? "POST" : "GET"),
    headers: input.payload
      ? {
          "content-type": "application/json",
        }
      : undefined,
    credentials: "same-origin",
    cache: "no-store",
    body: input.payload ? JSON.stringify(input.payload) : undefined,
  });
  const data = (await response.json()) as T | ApiErrorPayload;

  if (!response.ok || isApiErrorPayload(data)) {
    throw new Error(isApiErrorPayload(data) ? data.error.message : "Request failed.");
  }

  return data as T;
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return Boolean(value) && typeof value === "object" && "error" in (value as Record<string, unknown>);
}
