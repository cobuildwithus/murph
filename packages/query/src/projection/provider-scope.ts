import { normalizeWearableQueryProviderSlug } from "@murphai/health-metrics";

export function normalizeWearableProviders(providers: readonly string[] | undefined): string[] {
  return [...new Set(
    (providers ?? [])
      .map((provider) => normalizeWearableQueryProviderSlug(provider))
      .filter((provider): provider is string => provider !== null),
  )].sort();
}

export function wearableProviderRowKey(provider: string): string {
  const normalized = normalizeWearableProviders([provider])[0];
  if (!normalized) {
    throw new Error("Wearable provider summary rows require a provider.");
  }

  return `providers:${normalized}`;
}

export function wearableProviderRowKeys(providers: readonly string[]): string[] {
  return normalizeWearableProviders(providers).map(wearableProviderRowKey);
}
