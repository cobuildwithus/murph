import { resolveDeviceProviderConnectionDescriptor } from "@murphai/importers/device-providers/provider-descriptors";

import {
  getConfiguredDeviceSyncProviderDescriptor,
  resolveConfiguredDeviceSyncProviderDescriptor,
} from "./configured-provider-descriptors.ts";
import { resolveConfiguredDeviceSyncProviderCredentialPolicy } from "./provider-credential-policy.ts";
import { listConfiguredDeviceSyncProviderNames } from "./config/provider-keys.ts";

import type {
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
} from "./config/provider-types.ts";
import type { PublicProviderDescriptor } from "./types.ts";

export interface DeviceSyncPublicProviderDescriptorOptions {
  publicBaseUrl?: string | null;
}

export function listConfiguredDeviceSyncPublicProviderDescriptors(
  configs: ConfiguredDeviceSyncProviderPresence,
  options: DeviceSyncPublicProviderDescriptorOptions = {},
): PublicProviderDescriptor[] {
  return listConfiguredDeviceSyncProviderNames(configs).map((provider) =>
    describeConfiguredDeviceSyncPublicProvider(provider, options)
  );
}

export function describeConfiguredDeviceSyncPublicProvider(
  provider: ConfiguredDeviceSyncProviderKey,
  options: DeviceSyncPublicProviderDescriptorOptions = {},
): PublicProviderDescriptor {
  const descriptor = getConfiguredDeviceSyncProviderDescriptor(provider);
  const connection = resolveDeviceProviderConnectionDescriptor(descriptor);
  const callbackPath = connection.callbackPath ?? null;
  const webhookPath = descriptor.webhook?.path ?? null;

  return {
    provider,
    callbackPath,
    callbackUrl: joinPublicUrl(options.publicBaseUrl, callbackPath),
    connectionKind: connection.kind,
    credentialPolicy:
      resolveConfiguredDeviceSyncProviderCredentialPolicy(provider)?.kind ?? "none",
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
