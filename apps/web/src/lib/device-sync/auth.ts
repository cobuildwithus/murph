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
  const trustedUserId = request.headers.get(env.trustedUserIdHeader);

  if (trustedUserId && trustedUserId.trim()) {
    return {
      id: trustedUserId.trim(),
      email: env.trustedUserEmailHeader ? normalizeHeaderValue(request.headers.get(env.trustedUserEmailHeader)) : null,
      name: env.trustedUserNameHeader ? normalizeHeaderValue(request.headers.get(env.trustedUserNameHeader)) : null,
      source: "trusted-header",
    };
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
      "Hosted device-sync browser routes require an authenticated user injected by the hosting layer or DEVICE_SYNC_DEV_USER_ID in development.",
    retryable: false,
    httpStatus: 401,
  });
}

export function assertBrowserMutationOrigin(request: Request, env: HostedDeviceSyncEnvironment): void {
  const origin = normalizeHeaderValue(request.headers.get("origin"));

  if (!origin) {
    return;
  }

  const requestOrigin = new URL(request.url).origin;

  if (origin === requestOrigin || env.allowedReturnOrigins.includes(origin)) {
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

function normalizeHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
