import { timingSafeEqual } from "node:crypto";

import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  normalizeHostedExecutionString,
  readHostedExecutionControlSigningSecret,
  readHostedExecutionSignatureHeaders,
  verifyHostedExecutionSignature,
} from "@murphai/hosted-execution";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

type HostedExecutionAcceptedRouteToken = "scheduler" | "share";

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readBearerAuthorizationToken(value: string | null): string | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized || !normalized.startsWith("Bearer ")) {
    return null;
  }

  const token = normalized.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
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

  const bearerToken = readBearerAuthorizationToken(input.request.headers.get("authorization"));
  if (!bearerToken || !tokens.some((token) => timingSafeEquals(bearerToken, token))) {
    throw hostedOnboardingError({
      code: unauthorizedCode,
      message: unauthorizedMessage,
      httpStatus: 401,
    });
  }
}

export async function requireHostedExecutionSignedControlRequest(request: Request): Promise<void> {
  const signingSecret = readHostedExecutionControlSigningSecret();

  if (!signingSecret) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_CONTROL_SIGNING_SECRET_REQUIRED",
      message:
        "HOSTED_EXECUTION_CONTROL_SIGNING_SECRET or HOSTED_EXECUTION_SIGNING_SECRET must be configured for signed hosted control routes.",
      httpStatus: 500,
    });
  }

  const payload = await request.clone().text();
  const { signature, timestamp } = readHostedExecutionSignatureHeaders(request.headers);
  const verified = await verifyHostedExecutionSignature({
    method: request.method,
    path: new URL(request.url).pathname,
    payload,
    secret: signingSecret,
    signature,
    timestamp,
  });

  if (!verified) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_UNAUTHORIZED",
      message: "Unauthorized hosted execution request.",
      httpStatus: 401,
    });
  }
}

export async function requireHostedExecutionSignedRequest(request: Request): Promise<void> {
  const signingSecret = normalizeHostedExecutionString(process.env.HOSTED_EXECUTION_SIGNING_SECRET);

  if (!signingSecret) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_SIGNING_SECRET_REQUIRED",
      message: "HOSTED_EXECUTION_SIGNING_SECRET must be configured for signed hosted execution requests.",
      httpStatus: 500,
    });
  }

  const payload = await request.clone().text();
  const { signature, timestamp } = readHostedExecutionSignatureHeaders(request.headers);
  const verified = await verifyHostedExecutionSignature({
    method: request.method,
    path: new URL(request.url).pathname,
    payload,
    secret: signingSecret,
    signature,
    timestamp,
  });

  if (!verified) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_UNAUTHORIZED",
      message: "Unauthorized hosted execution request.",
      httpStatus: 401,
    });
  }
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
      requiredMessage: "HOSTED_EXECUTION_SCHEDULER_TOKENS must be configured for scheduled hosted execution drains.",
      tokens: readTokenListFromEnv("HOSTED_EXECUTION_SCHEDULER_TOKENS"),
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

  throw hostedOnboardingError({
    code: "HOSTED_EXECUTION_INTERNAL_TOKEN_KIND_UNSUPPORTED",
    message: "Unsupported hosted execution token kind.",
    httpStatus: 500,
  });
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
