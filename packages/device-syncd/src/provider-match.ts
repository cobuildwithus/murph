import {
  normalizeDeviceProviderKey,
  resolveDeviceProviderDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

export function resolveDeviceProviderMatchKeys(provider: string | null | undefined): string[] {
  if (typeof provider !== "string") {
    return [];
  }

  const requested = normalizeDeviceProviderKey(provider);
  if (!requested) {
    return [];
  }

  const descriptor = resolveDeviceProviderDescriptor(requested);
  const keys = new Set<string>([requested]);

  if (descriptor) {
    for (const value of [descriptor.provider, ...(descriptor.aliases ?? [])]) {
      const key = normalizeDeviceProviderKey(value);
      if (key) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}
