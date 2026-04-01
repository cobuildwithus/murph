import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

type HostedExecutionAcceptedRouteToken = "internal" | "scheduler" | "share";

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function authorizeHostedExecutionInternalRequest(input: {
  acceptedToken: HostedExecutionAcceptedRouteToken;
  bodyUserIds?: readonly (string | null | undefined)[];
  bodyUserIdLabel?: string;
  request: Request;
  requireBoundUserId?: boolean;
}): { trustedUserId: string | null } {
  const { requiredCode, requiredMessage, unauthorizedCode, unauthorizedMessage, token } =
    readHostedExecutionAcceptedRouteToken(input.acceptedToken);

  if (!token) {
    throw hostedOnboardingError({
      code: requiredCode,
      message: requiredMessage,
      httpStatus: 500,
    });
  }

  if (input.request.headers.get("authorization") !== `Bearer ${token}`) {
    throw hostedOnboardingError({
      code: unauthorizedCode,
      message: unauthorizedMessage,
      httpStatus: 401,
    });
  }

  const trustedUserId = input.requireBoundUserId ? requireHostedExecutionUserId(input.request) : null;
  const expectedUserId = trustedUserId ?? null;

  if (expectedUserId && input.bodyUserIds) {
    const mismatchedUserId = input.bodyUserIds
      .map((value) => normalizeOptionalString(value))
      .find((value) => value !== null && value !== expectedUserId);

    if (mismatchedUserId) {
      throw hostedOnboardingError({
        code: "INVALID_REQUEST",
        message: `${input.bodyUserIdLabel ?? "userId"} must match the authenticated hosted execution user.`,
        httpStatus: 400,
      });
    }
  }

  return {
    trustedUserId,
  };
}

export function requireHostedExecutionInternalToken(request: Request): void {
  authorizeHostedExecutionInternalRequest({
    acceptedToken: "internal",
    request,
  });
}

export function requireHostedExecutionSchedulerToken(request: Request): void {
  authorizeHostedExecutionInternalRequest({
    acceptedToken: "scheduler",
    request,
  });
}

export function requireHostedShareInternalToken(request: Request): void {
  authorizeHostedExecutionInternalRequest({
    acceptedToken: "share",
    request,
  });
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

function readHostedExecutionAcceptedRouteToken(kind: HostedExecutionAcceptedRouteToken): {
  requiredCode: string;
  requiredMessage: string;
  token: string | null;
  unauthorizedCode: string;
  unauthorizedMessage: string;
} {
  if (kind === "scheduler") {
    return {
      requiredCode: "HOSTED_EXECUTION_SCHEDULER_TOKEN_REQUIRED",
      requiredMessage: "CRON_SECRET must be configured for scheduled hosted execution drains.",
      token: normalizeOptionalString(process.env.CRON_SECRET),
      unauthorizedCode: "HOSTED_EXECUTION_UNAUTHORIZED",
      unauthorizedMessage: "Unauthorized hosted execution request.",
    };
  }

  if (kind === "share") {
    return {
      requiredCode: "HOSTED_SHARE_INTERNAL_TOKEN_REQUIRED",
      requiredMessage: "HOSTED_SHARE_INTERNAL_TOKEN must be configured for internal hosted share routes.",
      token: normalizeOptionalString(process.env.HOSTED_SHARE_INTERNAL_TOKEN),
      unauthorizedCode: "HOSTED_SHARE_UNAUTHORIZED",
      unauthorizedMessage: "Unauthorized hosted share request.",
    };
  }

  return {
    requiredCode: "HOSTED_EXECUTION_INTERNAL_TOKEN_REQUIRED",
    requiredMessage: "HOSTED_EXECUTION_INTERNAL_TOKEN must be configured for internal hosted execution control routes.",
    token: normalizeOptionalString(process.env.HOSTED_EXECUTION_INTERNAL_TOKEN),
    unauthorizedCode: "HOSTED_EXECUTION_UNAUTHORIZED",
    unauthorizedMessage: "Unauthorized hosted execution request.",
  };
}
