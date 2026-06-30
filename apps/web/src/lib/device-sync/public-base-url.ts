import { deviceSyncError } from "@murphai/device-syncd/errors";

import type { HostedDeviceSyncEnvironment } from "./env";

export type HostedDeviceSyncPublicBaseUrlSource = "configured" | "request";

export interface ResolvedHostedDeviceSyncPublicBaseUrl {
  baseUrl: string;
  source: HostedDeviceSyncPublicBaseUrlSource;
}

export function resolveHostedDeviceSyncPublicBaseUrl(
  request: Request,
  env: Pick<HostedDeviceSyncEnvironment, "isProduction" | "publicBaseUrl">,
): ResolvedHostedDeviceSyncPublicBaseUrl {
  const configuredBaseUrl = resolveConfiguredHostedDeviceSyncPublicBaseUrl(env);

  if (configuredBaseUrl) {
    return {
      baseUrl: configuredBaseUrl,
      source: "configured",
    };
  }

  return {
    baseUrl: `${new URL(request.url).origin}/api/device-sync`,
    source: "request",
  };
}

export function resolveConfiguredHostedDeviceSyncPublicBaseUrl(
  env: Pick<HostedDeviceSyncEnvironment, "isProduction" | "publicBaseUrl">,
): string | null {
  if (env.publicBaseUrl) {
    return env.publicBaseUrl.replace(/\/+$/u, "");
  }

  if (env.isProduction) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_PUBLIC_BASE_URL_REQUIRED",
      message:
        "Hosted device-sync public callback and webhook routes require DEVICE_SYNC_PUBLIC_BASE_URL or a canonical hosted public URL in production.",
      retryable: false,
      httpStatus: 500,
    });
  }

  return null;
}

export function resolveHostedDeviceSyncAllowedReturnOrigins(
  input: {
    configuredOrigins: readonly string[];
    publicBaseUrl: string;
    publicBaseUrlSource: HostedDeviceSyncPublicBaseUrlSource;
    request: Request;
  },
): string[] {
  const publicOrigin = new URL(input.publicBaseUrl).origin;
  const requestOrigin = new URL(input.request.url).origin;

  return [
    ...new Set([
      ...(input.publicBaseUrlSource === "request" ? [requestOrigin] : []),
      publicOrigin,
      ...input.configuredOrigins,
    ]),
  ];
}
