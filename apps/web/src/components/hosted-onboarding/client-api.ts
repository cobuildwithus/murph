import { getAccessToken, getIdentityToken } from "@privy-io/react-auth";

interface ApiErrorPayload {
  error: {
    code?: string;
    message: string;
    retryable?: boolean;
  };
}

const HOSTED_PRIVY_IDENTITY_TOKEN_HEADER_NAME = "x-privy-identity-token";

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
  const authHeaders = await buildHostedOnboardingAuthHeaders();
  const response = await fetch(input.url, {
    method: input.method ?? (input.payload ? "POST" : "GET"),
    headers: {
      ...(input.payload
        ? {
            "content-type": "application/json",
          }
        : {}),
      ...authHeaders,
    },
    credentials: "same-origin",
    cache: "no-store",
    body: input.payload ? JSON.stringify(input.payload) : undefined,
  });
  const data = await readOptionalJsonValue(response);
  const errorPayload = readApiErrorPayload(data);

  if (!response.ok || errorPayload) {
    throw new HostedOnboardingApiError({
      code: errorPayload?.code ?? null,
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

async function buildHostedOnboardingAuthHeaders(): Promise<Record<string, string>> {
  try {
    const accessToken = await getAccessToken();
    const identityToken = await getIdentityToken();

    return {
      ...(accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : {}),
      ...(identityToken
        ? {
            [HOSTED_PRIVY_IDENTITY_TOKEN_HEADER_NAME]: identityToken,
          }
        : {}),
    };
  } catch {
    return {};
  }
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
