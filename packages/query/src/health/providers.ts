import {
  createRegistryQueries,
  providerRegistryDefinition,
  type ProviderQueryEntity,
  type ProviderQueryRecord,
  type RegistryListOptions,
} from "./registries.ts";

const providerQueries = createRegistryQueries<ProviderQueryEntity>(providerRegistryDefinition);

export async function listProviders(
  vaultRoot: string,
  options: RegistryListOptions = {},
): Promise<ProviderQueryRecord[]> {
  return providerQueries.list(vaultRoot, options);
}

export async function readProvider(
  vaultRoot: string,
  providerId: string,
): Promise<ProviderQueryRecord | null> {
  return providerQueries.read(vaultRoot, providerId);
}

export async function showProvider(
  vaultRoot: string,
  lookup: string,
): Promise<ProviderQueryRecord | null> {
  return providerQueries.show(vaultRoot, lookup);
}

export type {
  ProviderQueryEntity,
  ProviderQueryRecord,
};
