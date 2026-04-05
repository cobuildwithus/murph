import {
  HOSTED_EXECUTION_USER_ID_HEADER,
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

export async function requireHostedExecutionSignedRequest(input: {
  payload?: string;
  request: Request;
}): Promise<void> {
  const signingSecret = normalizeOptionalString(process.env.HOSTED_EXECUTION_SIGNING_SECRET);

  if (!signingSecret) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_SIGNING_SECRET_REQUIRED",
      message: "HOSTED_EXECUTION_SIGNING_SECRET must be configured for signed hosted execution requests.",
      httpStatus: 500,
    });
  }

  const payload = input.payload ?? await input.request.clone().text();
  const { signature, timestamp } = readHostedExecutionSignatureHeaders(input.request.headers);
  const verified = await verifyHostedExecutionSignature({
    method: input.request.method,
    path: new URL(input.request.url).pathname,
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
