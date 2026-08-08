import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import type {
  HostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";

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

export interface HostedBillingCheckoutResponse {
  alreadyActive: boolean;
  url: string | null;
}

export interface HostedStarterUsageEnrollmentResponse {
  redirectPath: string;
  status: "already_active" | "already_enrolled" | "enrolled";
}

export async function requestHostedOnboardingJson<T>(input: {
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  keepalive?: boolean;
  method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  onSuccessfulResponseError?: () => void;
  onSuccessfulResponseHeaders?: () => void;
  payload?: Record<string, unknown>;
  signal?: AbortSignal;
  url: string;
}): Promise<T> {
  const method = input.method ?? (input.payload ? "POST" : "GET");
  const body = input.payload ? JSON.stringify(input.payload) : undefined;
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
  };

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
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (response.ok) {
    input.onSuccessfulResponseHeaders?.();
  }

  try {
    const data = await readOptionalJsonValue(response);
    const errorPayload = readApiErrorPayload(data);

    if (!response.ok || errorPayload) {
      throw new HostedOnboardingApiError({
        code: errorPayload?.code ?? null,
        details: errorPayload?.details ?? null,
        message: errorPayload?.message ?? "Something went wrong. Try again.",
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
  } catch (error) {
    if (response.ok) {
      input.onSuccessfulResponseError?.();
    }
    throw error;
  }
}

export async function requestHostedBillingCheckout(input: {
  billingPlanCode?: HostedBillingPlanCode | null;
  inviteCode: string;
}): Promise<HostedBillingCheckoutResponse> {
  return requestHostedOnboardingJson<HostedBillingCheckoutResponse>({
    payload: {
      ...(input.billingPlanCode ? { billingPlanCode: input.billingPlanCode } : {}),
      inviteCode: input.inviteCode,
    },
    url: "/api/hosted-onboarding/billing/checkout",
  });
}

export async function requestHostedStarterUsageEnrollment(input: {
  inviteCode: string;
}): Promise<HostedStarterUsageEnrollmentResponse> {
  return requestHostedOnboardingJson<HostedStarterUsageEnrollmentResponse>({
    payload: {
      inviteCode: input.inviteCode,
    },
    url: "/api/hosted-onboarding/starter/enroll",
  });
}

export async function requestHostedBillingSuccess(input: {
  inviteCode: string;
  sessionId: string;
}): Promise<HostedInviteStatusPayload> {
  return requestHostedOnboardingJson<HostedInviteStatusPayload>({
    payload: {
      inviteCode: input.inviteCode,
      sessionId: input.sessionId,
    },
    url: "/api/hosted-onboarding/billing/success",
  });
}

async function readOptionalJsonValue(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
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
