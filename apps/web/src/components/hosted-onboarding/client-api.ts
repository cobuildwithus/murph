import { getAccessToken, getIdentityToken } from "@privy-io/react-auth";

interface ApiErrorPayload {
  error: {
    code?: string;
    message: string;
    retryable?: boolean;
  };
}

const HOSTED_PRIVY_IDENTITY_TOKEN_HEADER_NAME = "x-privy-identity-token";
const HOSTED_PRIVY_AUTH_RETRY_DELAYS_MS = [0, 250] as const;
type HostedOnboardingAuthMode = "none" | "optional" | "required";

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
  auth?: HostedOnboardingAuthMode;
  method?: "GET" | "POST";
  payload?: Record<string, unknown>;
  url: string;
}): Promise<T> {
  const authHeaders = await resolveHostedOnboardingAuthHeaders(input.auth ?? "required");
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

async function resolveHostedOnboardingAuthHeaders(
  mode: HostedOnboardingAuthMode,
): Promise<Record<string, string>> {
  if (mode === "none") {
    return {};
  }

  if (mode === "optional") {
    try {
      return await buildHostedOnboardingAuthHeaders();
    } catch {
      return {};
    }
  }

  return buildHostedOnboardingAuthHeaders();
}

async function buildHostedOnboardingAuthHeaders(): Promise<Record<string, string>> {
  let lastError: unknown = null;

  for (const delayMs of HOSTED_PRIVY_AUTH_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      const [accessToken, identityToken] = await Promise.all([getAccessToken(), getIdentityToken()]);

      if (!accessToken || !identityToken) {
        lastError = new HostedOnboardingApiError({
          code: "AUTH_REQUIRED",
          message: "Verify your phone to continue.",
        });
        continue;
      }

      return {
        Authorization: `Bearer ${accessToken}`,
        [HOSTED_PRIVY_IDENTITY_TOKEN_HEADER_NAME]: identityToken,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof HostedOnboardingApiError) {
    throw lastError;
  }

  throw new HostedOnboardingApiError({
    code: "PRIVY_AUTH_UNAVAILABLE",
    message: "We could not refresh your Privy session. Wait a moment and try again.",
    retryable: true,
  });
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
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
