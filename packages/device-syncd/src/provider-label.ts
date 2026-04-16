import { resolveDeviceProviderDescriptor } from "@murphai/importers/device-providers/provider-descriptors";

export function formatDeviceSyncProviderLabel(provider: string): string {
  const descriptor = resolveDeviceProviderDescriptor(provider);

  if (descriptor?.displayName) {
    return descriptor.displayName;
  }

  const normalized = provider.trim().toLowerCase();

  return normalized
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
