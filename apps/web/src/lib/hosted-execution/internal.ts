import { timingSafeEqual } from "node:crypto";

import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  normalizeHostedExecutionString,
  readBearerAuthorizationToken,
  readHostedExecutionSignatureHeaders,
  verifyHostedExecutionSignature,
} from "@murphai/hosted-execution";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import {
  PrismaHostedWebInternalRequestNonceStore,
  type HostedWebInternalRequestNonceStore,
} from "./internal-request-nonces";

type HostedExecutionAcceptedRouteToken = "scheduler" | "share";
const HOSTED_WEB_INTERNAL_REQUEST_MAX_TIMESTAMP_SKEW_MS = 60_000;
const HOSTED_WEB_INTERNAL_REQUEST_NONCE_MIN_LENGTH = 16;

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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

export async function requireHostedWebInternalSignedRequest(
  request: Request,
  options: {
    maxTimestampSkewMs?: number;
    nonceStore?: HostedWebInternalRequestNonceStore;
    nowMs?: number;
  } = {},
): Promise<string> {
  const signingSecret = normalizeHostedExecutionString(process.env.HOSTED_WEB_INTERNAL_SIGNING_SECRET);

  if (!signingSecret) {
    throw hostedOnboardingError({
      code: "HOSTED_WEB_INTERNAL_SIGNING_SECRET_REQUIRED",
      message:
        "HOSTED_WEB_INTERNAL_SIGNING_SECRET must be configured for Cloudflare-owned hosted web routes.",
      httpStatus: 500,
    });
  }

  const userId = requireHostedExecutionUserId(request);
  const payload = await request.clone().text();
  const { nonce, signature, timestamp } = readHostedExecutionSignatureHeaders(request.headers);
  const normalizedNonce = normalizeOptionalString(nonce);
  const maxTimestampSkewMs =
    options.maxTimestampSkewMs ?? HOSTED_WEB_INTERNAL_REQUEST_MAX_TIMESTAMP_SKEW_MS;
  const verified = await verifyHostedExecutionSignature({
    method: request.method,
    path: new URL(request.url).pathname,
    payload,
    search: new URL(request.url).search,
    secret: signingSecret,
    signature,
    timestamp,
    nonce: normalizedNonce,
    userId,
    maxTimestampSkewMs,
    nowMs: options.nowMs,
  });

  if (!verified) {
    throw hostedOnboardingError({
      code: "HOSTED_WEB_INTERNAL_UNAUTHORIZED",
      message: "Unauthorized hosted web internal request.",
      httpStatus: 401,
    });
  }

  if (!normalizedNonce || normalizedNonce.length < HOSTED_WEB_INTERNAL_REQUEST_NONCE_MIN_LENGTH) {
    throw hostedOnboardingError({
      code: "HOSTED_WEB_INTERNAL_UNAUTHORIZED",
      message: "Unauthorized hosted web internal request.",
      httpStatus: 401,
    });
  }

  const timestampMs = parseCanonicalTimestampMs(timestamp);
  if (timestampMs === null) {
    throw hostedOnboardingError({
      code: "HOSTED_WEB_INTERNAL_UNAUTHORIZED",
      message: "Unauthorized hosted web internal request.",
      httpStatus: 401,
    });
  }

  const nowMs = options.nowMs ?? Date.now();
  const consumed = await (options.nonceStore
    ?? new PrismaHostedWebInternalRequestNonceStore(getPrisma())
  ).consumeHostedWebInternalRequestNonce({
    expiresAt: new Date(timestampMs + maxTimestampSkewMs).toISOString(),
    method: request.method.toUpperCase(),
    nonceHash: await sha256Hex(normalizedNonce),
    now: new Date(nowMs).toISOString(),
    path: new URL(request.url).pathname,
    search: new URL(request.url).search,
    userId,
  });

  if (!consumed) {
    throw hostedOnboardingError({
      code: "HOSTED_WEB_INTERNAL_REPLAYED",
      message: "Hosted web internal request was already used and cannot be replayed.",
      httpStatus: 401,
    });
  }

  return userId;
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
    const schedulerTokens = readTokenListFromEnv("HOSTED_EXECUTION_SCHEDULER_TOKENS");

    return {
      requiredCode: "HOSTED_EXECUTION_SCHEDULER_TOKEN_REQUIRED",
      requiredMessage:
        "HOSTED_EXECUTION_SCHEDULER_TOKENS or CRON_SECRET must be configured for scheduled hosted execution drains.",
      tokens: schedulerTokens.length > 0 ? schedulerTokens : readSingleTokenListFromEnv("CRON_SECRET"),
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

function readSingleTokenListFromEnv(key: string): string[] {
  const explicit = normalizeOptionalString(process.env[key]);
  return explicit ? [explicit] : [];
}

function parseCanonicalTimestampMs(value: string | null): number | null {
  if (typeof value !== "string" || value.trim() !== value) {
    return null;
  }

  const parsedMs = Date.parse(value);

  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString() === value ? parsedMs : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
