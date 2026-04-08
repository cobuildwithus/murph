import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";

export function sourceCardKey(source: HostedDeviceSyncSettingsSource): string {
  return source.connectionId ?? `${source.provider}:available`;
}

export function sourceKey(source: HostedDeviceSyncSettingsSource, action: "connect" | "disconnect"): string {
  return `${sourceCardKey(source)}:${action}`;
}

export function badgeClasses(tone: HostedDeviceSyncSettingsSource["tone"]): string {
  switch (tone) {
    case "attention":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "calm":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "muted":
    default:
      return "border-stone-200 bg-stone-50 text-stone-600";
  }
}

export function describeDeviceSyncCallbackError(providerLabel: string, errorCode: string | null): string {
  switch (errorCode) {
    case "OAUTH_CALLBACK_REJECTED":
      return `${providerLabel} was not connected this time. You can try again whenever you're ready.`;
    case "OAUTH_STATE_INVALID":
      return `${providerLabel} gave us an expired or invalid return from the last attempt. Start a fresh connection and try again.`;
    default:
      return `We could not finish connecting ${providerLabel}. Try again when you're ready.`;
  }
}
