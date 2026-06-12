import type { DeviceDataOrigin } from "@murphai/contracts";
import { canonicalizeDeviceProviderSlug } from "@murphai/importers/device-providers/provider-descriptors";

import { normalizeLowercaseString } from "./shared.ts";
import type { WearableExternalRef } from "./types.ts";

export function normalizeWearableOriginSourceSlug(value: string | null | undefined): string | null {
  return normalizeLowercaseString(value)?.replace(/_/gu, "-") ?? null;
}

export function resolveWearablePublicSourceProvider(input: {
  dataOrigin?: DeviceDataOrigin | null;
  externalRef?: WearableExternalRef | null;
  provider?: string | null;
}, options: {
  useSourceInstanceFallback?: boolean;
  suppressJunctionSourceInstanceFallback?: boolean;
} = {}): string {
  return canonicalizeDeviceProviderSlug(resolveRawWearableSourceProvider(input, options));
}

function resolveRawWearableSourceProvider(input: {
  dataOrigin?: DeviceDataOrigin | null;
  externalRef?: WearableExternalRef | null;
  provider?: string | null;
}, options: {
  useSourceInstanceFallback?: boolean;
  suppressJunctionSourceInstanceFallback?: boolean;
}): string {
  const originSourceProvider = normalizeWearableOriginSourceSlug(input.dataOrigin?.sourceProviderSlug);
  if (originSourceProvider && originSourceProvider !== "junction") {
    return originSourceProvider;
  }

  const inferredSourceProvider = inferJunctionWearableOriginSourceProvider(input.externalRef);
  if (inferredSourceProvider && inferredSourceProvider !== "junction") {
    return inferredSourceProvider;
  }

  const provider = normalizeLowercaseString(input.provider ?? input.externalRef?.system);
  if (provider && provider !== "junction") {
    return provider;
  }

  if (options.useSourceInstanceFallback ?? true) {
    const sourceInstanceId = normalizeWearableOriginSourceSlug(input.dataOrigin?.sourceInstanceId);
    const aggregatorProvider = normalizeWearableOriginSourceSlug(input.dataOrigin?.aggregatorProvider);
    if (
      sourceInstanceId
      && !(options.suppressJunctionSourceInstanceFallback && aggregatorProvider === "junction")
    ) {
      return sourceInstanceId;
    }
  }

  return "unknown";
}

export function inferJunctionWearableDataOriginFromExternalRef(
  externalRef: WearableExternalRef | null,
): DeviceDataOrigin | null {
  const sourceProviderSlug = inferJunctionWearableOriginSourceProvider(externalRef);
  if (!sourceProviderSlug) {
    return null;
  }

  return {
    version: 1,
    aggregatorProvider: "junction",
    sourceProviderSlug,
    originConfidence: "low",
  };
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

function inferJunctionWearableOriginSourceProvider(
  externalRef: WearableExternalRef | null | undefined,
): string | null {
  if (normalizeLowercaseString(externalRef?.system) !== "junction") {
    return null;
  }

  const resourceType = normalizeLowercaseString(externalRef?.resourceType);
  if (!resourceType?.startsWith("junction-")) {
    return null;
  }

  for (const suffix of JUNCTION_RESOURCE_TYPE_SUFFIXES) {
    const token = `-${suffix}`;
    if (!resourceType.endsWith(token)) {
      continue;
    }

    const sourceProviderSlug = resourceType.slice("junction-".length, -token.length);
    if (!sourceProviderSlug) {
      return null;
    }

    return sourceProviderSlug;
  }

  return null;
}

const JUNCTION_RESOURCE_TYPE_SUFFIXES = [
  "respiratory-rate",
  "blood-oxygen",
  "heartrate",
  "workouts",
  "activity",
  "profile",
  "glucose",
  "weight",
  "steps",
  "sleep",
  "body",
  "hrv",
] as const;
