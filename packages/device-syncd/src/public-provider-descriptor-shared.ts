import type {
  DeviceProviderConnectionDescriptor,
  DeviceProviderDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

export function resolvePublicProviderDefaultScopes(
  descriptor: DeviceProviderDescriptor,
  connection: DeviceProviderConnectionDescriptor,
): string[] {
  return [...(descriptor.oauth?.defaultScopes ?? connection.defaultScopes ?? [])];
}
