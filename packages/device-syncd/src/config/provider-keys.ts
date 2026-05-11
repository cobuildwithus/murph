import type {
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
} from "./provider-types.ts";

export const configuredDeviceSyncProviderKeys = Object.freeze([
  "junction",
  "oura",
  "whoop",
  "strava",
] as const satisfies readonly ConfiguredDeviceSyncProviderKey[]);

export function listConfiguredDeviceSyncProviderNames(
  configs: ConfiguredDeviceSyncProviderPresence,
): ConfiguredDeviceSyncProviderKey[] {
  return configuredDeviceSyncProviderKeys.filter((provider) => configs[provider] !== undefined);
}
