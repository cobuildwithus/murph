import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  normalizeHostedExecutionString,
  readHostedExecutionSignatureHeaders,
  verifyHostedExecutionSignature,
} from "@murphai/hosted-execution";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import {
  PrismaHostedWebInternalRequestNonceStore,
  type HostedWebInternalRequestNonceStore,
} from "./internal-request-nonces";

export const HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID = "system:hosted-execution-scheduler";

const HOSTED_WEB_INTERNAL_REQUEST_MAX_TIMESTAMP_SKEW_MS = 60_000;
const HOSTED_WEB_INTERNAL_REQUEST_NONCE_MIN_LENGTH = 16;

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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
  const url = new URL(request.url);
  const { nonce, signature, timestamp } = readHostedExecutionSignatureHeaders(request.headers);
  const normalizedNonce = normalizeOptionalString(nonce);
  const maxTimestampSkewMs =
    options.maxTimestampSkewMs ?? HOSTED_WEB_INTERNAL_REQUEST_MAX_TIMESTAMP_SKEW_MS;
  const verified = await verifyHostedExecutionSignature({
    method: request.method,
    path: url.pathname,
    payload,
    search: url.search,
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
    path: url.pathname,
    search: url.search,
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

export async function requireHostedWebInternalServiceRequest(
  request: Request,
  expectedUserId: string,
  options: {
    maxTimestampSkewMs?: number;
    nonceStore?: HostedWebInternalRequestNonceStore;
    nowMs?: number;
  } = {},
): Promise<void> {
  const userId = await requireHostedWebInternalSignedRequest(request, options);

  if (userId !== expectedUserId) {
    throw hostedOnboardingError({
      code: "HOSTED_WEB_INTERNAL_UNAUTHORIZED",
      message: "Unauthorized hosted web internal request.",
      httpStatus: 401,
    });
  }
}

function requireHostedExecutionUserId(request: Request): string {
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
