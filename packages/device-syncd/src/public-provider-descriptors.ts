import { resolveDeviceProviderConnectionDescriptor } from "@murphai/importers/device-providers/provider-descriptors";

import {
  buildJunctionDeviceSyncRuntimeDescriptor,
  requireConfiguredDeviceSyncProviderManifest,
  resolveConfiguredDeviceSyncProviderDescriptor,
} from "./config/provider-manifests.ts";

import type {
  JunctionDeviceSyncProviderConfig,
  ConfiguredDeviceSyncProviderConfigs,
} from "./config/provider-types.ts";
import type { PublicProviderDescriptor } from "./types.ts";

export interface DeviceSyncPublicProviderDescriptorOptions {
  publicBaseUrl?: string | null;
}

export function listConfiguredDeviceSyncPublicProviderDescriptors(
  configs: ConfiguredDeviceSyncProviderConfigs,
  options: DeviceSyncPublicProviderDescriptorOptions = {},
): PublicProviderDescriptor[] {
  return configs.junction
    ? [describeJunctionPublicProvider(configs.junction, options)]
    : [];
}

function describeJunctionPublicProvider(
  config: JunctionDeviceSyncProviderConfig,
  options: DeviceSyncPublicProviderDescriptorOptions = {},
): PublicProviderDescriptor {
  const descriptor = buildJunctionDeviceSyncRuntimeDescriptor(config);
  const connection = resolveDeviceProviderConnectionDescriptor(descriptor);
  const callbackPath = connection.callbackPath ?? null;
  const webhookPath = descriptor.webhook?.path ?? null;

  return {
    provider: descriptor.provider,
    callbackPath,
    callbackUrl: joinPublicUrl(options.publicBaseUrl, callbackPath),
    connectionKind: connection.kind,
    credentialPolicy: requireConfiguredDeviceSyncProviderManifest("junction").credentialPolicy.kind,
    defaultScopes: [...(connection.defaultScopes ?? [])],
    supportsWebhooks: Boolean(webhookPath),
    webhookPath,
    webhookUrl: joinPublicUrl(options.publicBaseUrl, webhookPath),
  };
}
export { resolveConfiguredDeviceSyncProviderDescriptor };

function joinPublicUrl(
  publicBaseUrl: string | null | undefined,
  path: string | null,
): string | null {
  if (!publicBaseUrl || !path) {
    return null;
  }

  return `${publicBaseUrl.replace(/\/+$/u, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
