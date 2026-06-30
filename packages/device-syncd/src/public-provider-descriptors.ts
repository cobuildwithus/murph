import { resolveDeviceProviderConnectionDescriptor } from "@murphai/importers/device-providers/provider-descriptors";

import {
  buildConfiguredDeviceSyncProviderRuntimeDescriptor,
  getConfiguredDeviceSyncProviderManifest,
  resolveConfiguredDeviceSyncProviderDescriptor,
} from "./config/provider-manifests.ts";
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
    credentialPolicy: getConfiguredDeviceSyncProviderCredentialPolicyKind(provider),
    defaultScopes: resolvePublicProviderDefaultScopes(descriptor, connection),
    supportsWebhooks: Boolean(webhookPath),
    webhookPath,
    webhookUrl: joinPublicUrl(options.publicBaseUrl, webhookPath),
  };
}
export { resolveConfiguredDeviceSyncProviderDescriptor };

function getConfiguredDeviceSyncProviderCredentialPolicyKind(
  provider: ConfiguredDeviceSyncProviderKey,
): PublicProviderDescriptor["credentialPolicy"] {
  return getConfiguredDeviceSyncProviderManifest(provider).credentialPolicy.kind;
}

function joinPublicUrl(
  publicBaseUrl: string | null | undefined,
  path: string | null,
): string | null {
  if (!publicBaseUrl || !path) {
    return null;
  }

  return `${publicBaseUrl.replace(/\/+$/u, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
