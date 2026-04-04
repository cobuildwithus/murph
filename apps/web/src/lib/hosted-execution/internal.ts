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
  request: Request;
}): void {
  const { requiredCode, requiredMessage, tokens, unauthorizedCode, unauthorizedMessage } =
    readHostedExecutionAcceptedRouteTokens(input.acceptedToken);

  if (tokens.length === 0) {
    throw hostedOnboardingError({
      code: requiredCode,
      message: requiredMessage,
      httpStatus: 500,
    });
  }

  const authorization = input.request.headers.get("authorization");
  if (!authorization || !tokens.some((token) => authorization === `Bearer ${token}`)) {
    throw hostedOnboardingError({
      code: unauthorizedCode,
      message: unauthorizedMessage,
      httpStatus: 401,
    });
  }
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
      code: "HOSTED_EXECUTION_USER_ID_REQUIRED",
      message: `${HOSTED_EXECUTION_USER_ID_HEADER} header is required for hosted execution user-bound routes.`,
      httpStatus: 400,
    });
  }

  return userId;
}

function readHostedExecutionAcceptedRouteTokens(kind: HostedExecutionAcceptedRouteToken): {
  requiredCode: string;
  requiredMessage: string;
  tokens: string[];
  unauthorizedCode: string;
  unauthorizedMessage: string;
} {
  if (kind === "scheduler") {
    return {
      requiredCode: "HOSTED_EXECUTION_SCHEDULER_TOKEN_REQUIRED",
      requiredMessage: "HOSTED_EXECUTION_SCHEDULER_TOKENS or CRON_SECRET must be configured for scheduled hosted execution drains.",
      tokens: readTokenListFromEnv("HOSTED_EXECUTION_SCHEDULER_TOKENS", "CRON_SECRET"),
      unauthorizedCode: "HOSTED_EXECUTION_UNAUTHORIZED",
      unauthorizedMessage: "Unauthorized hosted execution request.",
    };
  }

  if (kind === "share") {
    return {
      requiredCode: "HOSTED_SHARE_INTERNAL_TOKEN_REQUIRED",
      requiredMessage: "HOSTED_SHARE_INTERNAL_TOKENS must be configured for internal hosted share routes.",
      tokens: readTokenListFromEnv("HOSTED_SHARE_INTERNAL_TOKENS"),
      unauthorizedCode: "HOSTED_SHARE_UNAUTHORIZED",
      unauthorizedMessage: "Unauthorized hosted share request.",
    };
  }

  return {
    requiredCode: "HOSTED_EXECUTION_INTERNAL_TOKEN_REQUIRED",
    requiredMessage: "HOSTED_EXECUTION_INTERNAL_TOKENS must be configured for internal hosted execution control routes.",
    tokens: readTokenListFromEnv("HOSTED_EXECUTION_INTERNAL_TOKENS"),
    unauthorizedCode: "HOSTED_EXECUTION_UNAUTHORIZED",
    unauthorizedMessage: "Unauthorized hosted execution request.",
  };
}

function readTokenListFromEnv(...keys: string[]): string[] {
  return Array.from(new Set(keys.flatMap((key) => {
    const explicit = normalizeOptionalString(process.env[key]);
    if (!explicit) {
      return [];
    }

    return explicit
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  })));
}
