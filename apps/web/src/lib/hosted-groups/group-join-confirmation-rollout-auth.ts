import "server-only";

import { timingSafeEqual } from "node:crypto";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

export const HOSTED_GROUP_JOIN_CONFIRMATION_ROLLOUT_TOKEN_ENV =
  "HOSTED_GROUP_JOIN_CONFIRMATION_ROLLOUT_TOKEN";

export function requireHostedGroupJoinConfirmationRolloutRequest(
  request: Request,
  source: NodeJS.ProcessEnv = process.env,
): void {
  const configuredToken = readConfiguredToken(source);
  if (!configuredToken) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_CONFIRMATION_ROLLOUT_TOKEN_REQUIRED",
      httpStatus: 500,
      message: "Group join confirmation rollout token is not configured.",
    });
  }

  if (!isHostedGroupJoinConfirmationRolloutRequestAuthorized(request, source)) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_CONFIRMATION_ROLLOUT_UNAUTHORIZED",
      httpStatus: 401,
      message: "Unauthorized group join confirmation rollout request.",
    });
  }
}

export function isHostedGroupJoinConfirmationRolloutRequestAuthorized(
  request: Request,
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  const configuredToken = readConfiguredToken(source);
  const authorization = request.headers.get("authorization")?.trim();
  const providedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  return Boolean(
    configuredToken
    && providedToken
    && safeEqualText(configuredToken, providedToken),
  );
}

function readConfiguredToken(source: NodeJS.ProcessEnv): string | null {
  return source[HOSTED_GROUP_JOIN_CONFIRMATION_ROLLOUT_TOKEN_ENV]?.trim() || null;
}

function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}
