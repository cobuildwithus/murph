import type { DeviceDataOrigin } from "@murphai/contracts";

import { normalizeLowercaseString } from "./shared.ts";

export function normalizeWearableOriginSourceSlug(value: string | null | undefined): string | null {
  return normalizeLowercaseString(value)?.replace(/_/gu, "-") ?? null;
}

export function wearableDataOriginKey(origin: DeviceDataOrigin | null | undefined): string {
  if (!origin) {
    return "";
  }

  return [
    normalizeLowercaseString(origin.aggregatorProvider) ?? "",
    normalizeWearableOriginSourceSlug(origin.sourceProviderSlug) ?? "",
    normalizeLowercaseString(origin.sourceType) ?? "",
    normalizeLowercaseString(origin.sourceInstanceId ?? undefined) ?? "",
  ].join("|");
}
