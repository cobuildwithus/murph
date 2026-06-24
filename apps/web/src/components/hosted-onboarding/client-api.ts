import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import type {
  HostedBillingPlanCode,
  HostedPublicBillingCheckoutOffer,
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

export interface HostedAutoPulseTrialEnrollmentResponse {
  redirectPath: string;
  status: "already_active" | "already_enrolled" | "enrolled";
}

export interface HostedPulseTrialStartPaidResponse {
  billingPlanCode: "launch_monthly";
  paymentUrl?: string;
  status: "billing_pending" | "payment_required" | "started";
}

export type HostedPulseTrialStartPaidClientResult =
  | {
    status: "billing_pending";
  }
  | {
    status: "redirecting";
  }
  | {
    status: "started";
  };

export async function requestHostedOnboardingJson<T>(input: {
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  keepalive?: boolean;
  method?: "DELETE" | "GET" | "POST";
  payload?: Record<string, unknown>;
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

export async function requestHostedBillingCheckout(input: {
  billingPlanCode?: HostedBillingPlanCode | null;
  checkoutOffer?: HostedPublicBillingCheckoutOffer | null;
  inviteCode: string;
}): Promise<HostedBillingCheckoutResponse> {
  return requestHostedOnboardingJson<HostedBillingCheckoutResponse>({
    payload: {
      ...(input.billingPlanCode ? { billingPlanCode: input.billingPlanCode } : {}),
      ...(input.checkoutOffer ? { checkoutOffer: input.checkoutOffer } : {}),
      inviteCode: input.inviteCode,
    },
    url: "/api/hosted-onboarding/billing/checkout",
  });
}

export async function requestHostedAutoPulseTrialEnrollment(input: {
  inviteCode: string;
}): Promise<HostedAutoPulseTrialEnrollmentResponse> {
  return requestHostedOnboardingJson<HostedAutoPulseTrialEnrollmentResponse>({
    payload: {
      inviteCode: input.inviteCode,
    },
    url: "/api/hosted-onboarding/trial/enroll",
  });
}

export async function requestHostedPulseTrialStartPaid(): Promise<HostedPulseTrialStartPaidClientResult> {
  const response = await requestHostedOnboardingJson<HostedPulseTrialStartPaidResponse>({
    method: "POST",
    url: "/api/settings/billing/start-paid-pulse",
  });

  if (response.status === "payment_required") {
    if (typeof response.paymentUrl !== "string" || response.paymentUrl.length === 0) {
      throw new HostedOnboardingApiError({
        code: null,
        message: "Payment link missing.",
      });
    }

    window.location.assign(response.paymentUrl);
    return {
      status: "redirecting",
    };
  }

  if (response.status === "billing_pending" || response.status === "started") {
    return {
      status: response.status,
    };
  }

  throw new HostedOnboardingApiError({
    code: null,
    message: "Request returned an unexpected response.",
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
