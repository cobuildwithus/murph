import { getPrisma } from "../prisma";
import { readHostedDeviceSyncEnvironment, type HostedDeviceSyncEnvironment } from "./env";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import {
  resolveHostedDeviceSyncAllowedReturnOrigins,
  resolveHostedDeviceSyncPublicBaseUrl,
  type HostedDeviceSyncPublicBaseUrlSource,
} from "./public-base-url";

export interface HostedDeviceSyncControlPlaneContext {
  readonly request: Request;
  readonly env: HostedDeviceSyncEnvironment;
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
