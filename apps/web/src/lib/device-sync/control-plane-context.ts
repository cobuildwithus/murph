import type { DeviceSyncRegistry } from "@murphai/device-syncd/public-ingress";

import { getPrisma } from "../prisma";
import { readHostedDeviceSyncEnvironment, type HostedDeviceSyncEnvironment } from "./env";
import { createHostedDeviceSyncRegistry } from "./providers";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import {
  resolveHostedDeviceSyncAllowedReturnOrigins,
  resolveHostedDeviceSyncPublicBaseUrl,
  type HostedDeviceSyncPublicBaseUrlSource,
} from "./public-base-url";

export interface HostedDeviceSyncControlPlaneContext {
  readonly request: Request;
  readonly env: HostedDeviceSyncEnvironment;
  readonly registry: DeviceSyncRegistry;
  readonly store: PrismaDeviceSyncControlPlaneStore;
  readonly publicIngressBaseUrl: string;
  readonly publicIngressBaseUrlSource: HostedDeviceSyncPublicBaseUrlSource;
  readonly allowedReturnOrigins: string[];
}

export function createHostedDeviceSyncControlPlaneContext(
  request: Request,
): HostedDeviceSyncControlPlaneContext {
  const envSource = process.env;
  const env = readHostedDeviceSyncEnvironment(envSource);
  const publicBaseUrl = resolveHostedDeviceSyncPublicBaseUrl(request, env);

  return {
    request,
    env,
    registry: createHostedDeviceSyncRegistry(envSource),
    store: new PrismaDeviceSyncControlPlaneStore({
      providerAccountBlindIndexKey: env.routingIndexKey,
      prisma: getPrisma(),
    }),
    publicIngressBaseUrl: publicBaseUrl.baseUrl,
    publicIngressBaseUrlSource: publicBaseUrl.source,
    allowedReturnOrigins: resolveHostedDeviceSyncAllowedReturnOrigins({
      configuredOrigins: env.allowedReturnOrigins,
      publicBaseUrl: publicBaseUrl.baseUrl,
      publicBaseUrlSource: publicBaseUrl.source,
      request,
    }),
  };
}
