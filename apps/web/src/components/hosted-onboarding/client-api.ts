interface ApiErrorPayload {
  error: {
    code?: string;
    message: string;
    retryable?: boolean;
  };
}

export class HostedOnboardingApiError extends Error {
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(input: { code: string | null; message: string; retryable?: boolean }) {
    super(input.message);
    this.name = "HostedOnboardingApiError";
    this.code = input.code;
    this.retryable = input.retryable ?? false;
  }
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
    throw new HostedOnboardingApiError({
      code: isApiErrorPayload(data) && typeof data.error.code === "string" ? data.error.code : null,
      message: isApiErrorPayload(data) ? data.error.message : "Request failed.",
      retryable: isApiErrorPayload(data) ? data.error.retryable === true : false,
    });
  }

  return data as T;
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return Boolean(value) && typeof value === "object" && "error" in (value as Record<string, unknown>);
}
