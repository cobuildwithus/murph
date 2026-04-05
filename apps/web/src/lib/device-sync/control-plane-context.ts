import { deviceSyncError, type DeviceSyncRegistry } from "@murphai/device-syncd/public-ingress";

import { getPrisma } from "../prisma";
import { readHostedDeviceSyncEnvironment, type HostedDeviceSyncEnvironment } from "./env";
import { createHostedDeviceSyncRegistry } from "./providers";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";

export type HostedDeviceSyncPublicBaseUrlSource = "configured" | "request";

export interface HostedDeviceSyncControlPlaneContext {
  readonly request: Request;
  readonly env: HostedDeviceSyncEnvironment;
  readonly registry: DeviceSyncRegistry;
  readonly store: PrismaDeviceSyncControlPlaneStore;
  readonly publicIngressBaseUrl: string;
  readonly webhookAdminCallbackBaseUrl: string;
  readonly webhookAdminCallbackBaseUrlSource: HostedDeviceSyncPublicBaseUrlSource;
  readonly allowedReturnOrigins: string[];
}

export function createHostedDeviceSyncControlPlaneContext(
  request: Request,
): HostedDeviceSyncControlPlaneContext {
  const env = readHostedDeviceSyncEnvironment();
  const publicBaseUrl = resolveHostedPublicBaseUrl(request, env.publicBaseUrl, env.isProduction);

  return {
    request,
    env,
    registry: createHostedDeviceSyncRegistry(env),
    store: new PrismaDeviceSyncControlPlaneStore({
      prisma: getPrisma(),
    }),
    publicIngressBaseUrl: publicBaseUrl.baseUrl,
    webhookAdminCallbackBaseUrl: publicBaseUrl.baseUrl,
    webhookAdminCallbackBaseUrlSource: publicBaseUrl.source,
    allowedReturnOrigins: resolveAllowedReturnOrigins(
      request,
      publicBaseUrl.baseUrl,
      publicBaseUrl.source,
      env.allowedReturnOrigins,
    ),
  };
}

function resolveHostedPublicBaseUrl(
  request: Request,
  configuredBaseUrl: string | null,
  isProduction: boolean,
): { baseUrl: string; source: HostedDeviceSyncPublicBaseUrlSource } {
  if (configuredBaseUrl) {
    return {
      baseUrl: configuredBaseUrl.replace(/\/+$/u, ""),
      source: "configured",
    };
  }

  if (isProduction) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_PUBLIC_BASE_URL_REQUIRED",
      message:
        "Hosted device-sync public callback and webhook routes require DEVICE_SYNC_PUBLIC_BASE_URL or a canonical hosted public URL in production.",
      retryable: false,
      httpStatus: 500,
    });
  }

  return {
    baseUrl: `${new URL(request.url).origin}/api/device-sync`,
    source: "request",
  };
}

function resolveAllowedReturnOrigins(
  request: Request,
  publicBaseUrl: string,
  publicBaseUrlSource: HostedDeviceSyncPublicBaseUrlSource,
  configuredOrigins: readonly string[],
): string[] {
  const publicOrigin = new URL(publicBaseUrl).origin;
  const requestOrigin = new URL(request.url).origin;

  return [...new Set([
    ...(publicBaseUrlSource === "request" ? [requestOrigin] : []),
    publicOrigin,
    ...configuredOrigins,
  ])];
}
