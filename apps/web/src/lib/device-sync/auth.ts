import { createHmac, timingSafeEqual } from "node:crypto";

import { deviceSyncError } from "@healthybob/device-syncd";

import type { HostedDeviceSyncEnvironment } from "./env";

export interface AuthenticatedHostedUser {
  id: string;
  email: string | null;
  name: string | null;
  source: "trusted-header" | "development-fallback";
}

export function requireAuthenticatedHostedUser(
  request: Request,
  env: HostedDeviceSyncEnvironment,
): AuthenticatedHostedUser {
  const signedHostedUser = readSignedHostedUser(request, env);

  if (signedHostedUser) {
    return signedHostedUser;
  }

  if (!env.isProduction && env.devUserId) {
    return {
      id: env.devUserId,
      email: env.devUserEmail,
      name: env.devUserName,
      source: "development-fallback",
    };
  }

  throw deviceSyncError({
    code: "AUTH_REQUIRED",
    message:
      "Hosted device-sync browser routes require cryptographically verified hosted user headers or DEVICE_SYNC_DEV_USER_ID in development.",
    retryable: false,
    httpStatus: 401,
  });
}

export function assertBrowserMutationOrigin(request: Request, env: HostedDeviceSyncEnvironment): void {
  const origin = normalizeHeaderValue(request.headers.get("origin"));

  if (!origin) {
    throw deviceSyncError({
      code: "CSRF_ORIGIN_REQUIRED",
      message: "Hosted device-sync browser mutation routes require an Origin header.",
      retryable: false,
      httpStatus: 403,
    });
  }

  const requestOrigin = new URL(request.url).origin;

  if (origin === requestOrigin || env.allowedMutationOrigins.includes(origin)) {
    return;
  }

  throw deviceSyncError({
    code: "CSRF_ORIGIN_INVALID",
    message: `Mutation origin ${origin} is not allowed for hosted device-sync routes.`,
    retryable: false,
    httpStatus: 403,
    details: {
      origin,
    },
  });
}

function readSignedHostedUser(
  request: Request,
  env: HostedDeviceSyncEnvironment,
): AuthenticatedHostedUser | null {
  const id = normalizeHeaderValue(request.headers.get(env.trustedUserIdHeader));
  const email = env.trustedUserEmailHeader ? normalizeHeaderValue(request.headers.get(env.trustedUserEmailHeader)) : null;
  const name = env.trustedUserNameHeader ? normalizeHeaderValue(request.headers.get(env.trustedUserNameHeader)) : null;
  const signature = normalizeHeaderValue(request.headers.get(env.trustedUserSignatureHeader));
  const hasAnyTrustedHeader = Boolean(id || email || name || signature);

  if (!hasAnyTrustedHeader) {
    return null;
  }

  if (!id) {
    throw invalidHostedUserHeaders(
      `Hosted device-sync user headers must include the configured ${env.trustedUserIdHeader} header.`,
    );
  }

  if (!env.trustedUserSigningSecret) {
    throw invalidHostedUserHeaders(
      "Hosted device-sync user headers require DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET verification.",
    );
  }

  if (!signature) {
    throw invalidHostedUserHeaders(
      `Hosted device-sync user headers must include the configured ${env.trustedUserSignatureHeader} signature header.`,
    );
  }

  const claims = { id, email, name };
  const expectedSignature = createHostedUserHeaderSignature(claims, env.trustedUserSigningSecret);

  if (!secureEqual(expectedSignature, signature)) {
    throw invalidHostedUserHeaders("Hosted device-sync user header signature is invalid.");
  }

  return {
    ...claims,
    source: "trusted-header",
  };
}

function createHostedUserHeaderSignature(
  claims: Pick<AuthenticatedHostedUser, "id" | "email" | "name">,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(serializeHostedUserClaims(claims))
    .digest("hex");
}

function serializeHostedUserClaims(
  claims: Pick<AuthenticatedHostedUser, "id" | "email" | "name">,
): string {
  return JSON.stringify([
    claims.id,
    claims.email ?? null,
    claims.name ?? null,
  ]);
}

function secureEqual(expectedValue: string, providedValue: string): boolean {
  const expected = Buffer.from(expectedValue, "utf8");
  const provided = Buffer.from(providedValue, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function invalidHostedUserHeaders(message: string) {
  return deviceSyncError({
    code: "AUTH_HEADER_INVALID",
    message,
    retryable: false,
    httpStatus: 401,
  });
}

function normalizeHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
