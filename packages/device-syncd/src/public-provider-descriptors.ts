import { resolveDeviceProviderConnectionDescriptor } from "@murphai/importers/device-providers/provider-descriptors";

import {
  resolveConfiguredDeviceSyncProviderDescriptor,
} from "./configured-provider-descriptors.ts";
import { buildConfiguredDeviceSyncProviderRuntimeDescriptor } from "./configured-provider-runtime-descriptors.ts";
import { resolveConfiguredDeviceSyncProviderCredentialPolicy } from "./provider-credential-policy.ts";
import { resolvePublicProviderDefaultScopes } from "./public-provider-descriptor-shared.ts";
import { listConfiguredDeviceSyncProviderNames } from "./config/provider-keys.ts";

import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
} from "./config/provider-types.ts";
import type { PublicProviderDescriptor } from "./types.ts";

export interface DeviceSyncPublicProviderDescriptorOptions {
  publicBaseUrl?: string | null;
}

export function listConfiguredDeviceSyncPublicProviderDescriptors(
  configs: ConfiguredDeviceSyncProviderConfigs,
  options: DeviceSyncPublicProviderDescriptorOptions = {},
): PublicProviderDescriptor[] {
  return listConfiguredDeviceSyncProviderNames(configs).map((provider) => {
    const config = configs[provider];

    if (config === undefined) {
      throw new TypeError(`Configured device-sync provider ${provider} is missing runtime config.`);
    }

    return describeConfiguredDeviceSyncPublicProvider(
      provider,
      config as never,
      options,
    );
  });
}

export function describeConfiguredDeviceSyncPublicProvider<
  TProvider extends ConfiguredDeviceSyncProviderKey,
>(
  provider: TProvider,
  config: ConfiguredDeviceSyncProviderConfigByKey[TProvider],
  options: DeviceSyncPublicProviderDescriptorOptions = {},
): PublicProviderDescriptor {
  const descriptor = buildConfiguredDeviceSyncProviderRuntimeDescriptor(provider, config);
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
    defaultScopes: resolvePublicProviderDefaultScopes(descriptor, connection),
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
