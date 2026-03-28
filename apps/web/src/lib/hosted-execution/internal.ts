import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murph/hosted-execution";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function requireHostedExecutionInternalToken(request: Request): void {
  const token = normalizeOptionalString(process.env.HOSTED_EXECUTION_INTERNAL_TOKEN);

  if (!token) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_INTERNAL_TOKEN_REQUIRED",
      message: "HOSTED_EXECUTION_INTERNAL_TOKEN must be configured for internal hosted execution control routes.",
      httpStatus: 500,
    });
  }

  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_UNAUTHORIZED",
      message: "Unauthorized hosted execution request.",
      httpStatus: 401,
    });
  }
}

export function requireHostedExecutionSchedulerToken(request: Request): void {
  const token = normalizeOptionalString(process.env.CRON_SECRET);

  if (!token) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_SCHEDULER_TOKEN_REQUIRED",
      message: "CRON_SECRET must be configured for scheduled hosted execution drains.",
      httpStatus: 500,
    });
  }

  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_UNAUTHORIZED",
      message: "Unauthorized hosted execution request.",
      httpStatus: 401,
    });
  }
}

export function requireHostedExecutionUserId(request: Request): string {
  const userId = normalizeOptionalString(request.headers.get(HOSTED_EXECUTION_USER_ID_HEADER));

  if (!userId) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_USER_REQUIRED",
      message: "Hosted execution user binding is required.",
      httpStatus: 400,
    });
  }

  return userId;
}
