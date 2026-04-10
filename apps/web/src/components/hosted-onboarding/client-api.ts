interface ApiErrorPayload {
  error: {
    code?: string;
    details?: Record<string, unknown>;
    message: string;
    retryable?: boolean;
  };
}

export class HostedOnboardingApiError extends Error {
  readonly code: string | null;
  readonly details: Record<string, unknown> | null;
  readonly retryable: boolean;

  constructor(input: {
    code: string | null;
    details?: Record<string, unknown> | null;
    message: string;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "HostedOnboardingApiError";
    this.code = input.code;
    this.details = input.details ?? null;
    this.retryable = input.retryable ?? false;
  }
}

export async function requestHostedOnboardingJson<T>(input: {
  credentials?: RequestCredentials;
  keepalive?: boolean;
  method?: "GET" | "POST";
  payload?: Record<string, unknown>;
  url: string;
}): Promise<T> {
  const method = input.method ?? (input.payload ? "POST" : "GET");
  const body = input.payload ? JSON.stringify(input.payload) : undefined;
  const headers: Record<string, string> = {};

  if (input.payload) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(input.url, {
    method,
    headers,
    credentials: input.credentials ?? "same-origin",
    cache: "no-store",
    keepalive: input.keepalive ?? false,
    body,
  });

  const data = await readOptionalJsonValue(response);
  const errorPayload = readApiErrorPayload(data);

  if (!response.ok || errorPayload) {
    throw new HostedOnboardingApiError({
      code: errorPayload?.code ?? null,
      details: errorPayload?.details ?? null,
      message: errorPayload?.message ?? "Request failed.",
      retryable: errorPayload?.retryable === true,
    });
  }

  if (data === null || hasApiErrorKey(data)) {
    throw new HostedOnboardingApiError({
      code: null,
      message: "Request returned an unexpected response.",
    });
  }

  return data as T;
}

async function readOptionalJsonValue(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readApiErrorPayload(value: unknown): ApiErrorPayload["error"] | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.message !== "string") {
    return null;
  }

  return {
    code: typeof value.error.code === "string" ? value.error.code : undefined,
    details: isRecord(value.error.details) ? value.error.details : undefined,
    message: value.error.message,
    retryable: value.error.retryable === true ? true : undefined,
  };
}

function hasApiErrorKey(value: unknown): boolean {
  return isRecord(value) && "error" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
