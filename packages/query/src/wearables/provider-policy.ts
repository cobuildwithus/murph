import {
  defaultWearableProviderDescriptors,
  resolveWearableMetricTolerance,
  resolveWearableProviderDescriptor,
  resolveWearableProviderSourcePriority,
  type WearableProviderMetricFamily,
} from "@murphai/health-metrics";

import {
  ACTIVITY_METRIC_KEYS,
  BODY_METRIC_KEYS,
  RECOVERY_METRIC_KEYS,
  SLEEP_METRIC_KEYS,
  type WearableCandidateSourceFamily,
  type WearableMetricKey,
  type WearableMetricPolicyFamily,
} from "./types.ts";
import { normalizeLowercaseString } from "./shared.ts";

const DEFAULT_PROVIDER_PRIORITY_ORDER: readonly string[] = defaultWearableProviderDescriptors.map(
  (descriptor) => descriptor.provider,
);

export function resolveWearableProviderPriority(
  metric: WearableMetricKey,
  provider: string,
  options: {
    metricFamily?: WearableMetricPolicyFamily;
  } = {},
): number {
  const descriptor = resolveWearableProviderDescriptor(provider);

  if (!descriptor) {
    return 0;
  }

  return resolveWearableProviderSourcePriority(descriptor, {
    metric,
    metricFamily: options.metricFamily ?? inferDefaultMetricFamily(metric),
  });
}

export function isPreferredWearableProvider(
  metric: WearableMetricKey,
  provider: string,
  providers: readonly string[],
  options: {
    metricFamily?: WearableMetricPolicyFamily;
  } = {},
): boolean {
  const normalizedProvider = normalizeLowercaseString(provider);

  if (!normalizedProvider) {
    return false;
  }

  const bestProvider = [...providers]
    .map((value) => normalizeLowercaseString(value))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => compareWearableProviders(metric, left, right, options))[0];

  return bestProvider === normalizedProvider;
}

export function compareWearableProviders(
  metric: WearableMetricKey,
  left: string,
  right: string,
  options: {
    metricFamily?: WearableMetricPolicyFamily;
  } = {},
): number {
  const priorityDifference =
    resolveWearableProviderPriority(metric, right, options) - resolveWearableProviderPriority(metric, left, options);

  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const leftDefaultIndex = resolveDefaultProviderPriorityIndex(left);
  const rightDefaultIndex = resolveDefaultProviderPriorityIndex(right);

  if (leftDefaultIndex !== rightDefaultIndex) {
    return leftDefaultIndex - rightDefaultIndex;
  }

  return left.localeCompare(right);
}

export function hasDirectWearableProviderForSource(sourceProviderSlug: string | null | undefined): boolean {
  const normalized = normalizeLowercaseString(sourceProviderSlug)?.replace(/_/gu, "-");
  if (!normalized || normalized === "junction") {
    return false;
  }

  return Boolean(resolveWearableProviderDescriptor(normalized));
}

export function inferDefaultMetricFamily(metric: WearableMetricKey): WearableProviderMetricFamily | null {
  if (SLEEP_METRIC_KEYS.has(metric)) {
    return "sleep";
  }

  if (RECOVERY_METRIC_KEYS.has(metric)) {
    return "recovery";
  }

  if (BODY_METRIC_KEYS.has(metric)) {
    return "body";
  }

  if (ACTIVITY_METRIC_KEYS.has(metric)) {
    return "activity";
  }

  return null;
}

export function formatProviderName(provider: string): string {
  const descriptor = resolveWearableProviderDescriptor(provider);

  if (descriptor?.displayName) {
    return descriptor.displayName;
  }

  return normalizeLowercaseString(provider) === "unknown" ? "Unknown provider" : provider;
}

export function formatMetricLabel(metric: string): string {
  return metric
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (value) => value.toUpperCase());
}

export function formatMetricValue(value: number, unit: string): string {
  if (unit === "minutes") {
    return `${Math.round(value)} min`;
  }

  if (unit === "kg") {
    return `${value.toFixed(1)} kg`;
  }

  if (unit === "%") {
    return `${Math.round(value)}%`;
  }

  if (unit === "count") {
    return `${Math.round(value)}`;
  }

  if (unit === "km") {
    return `${value.toFixed(2)} km`;
  }

  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))} ${unit}`;
}

export function resolveMetricTolerance(metric: WearableMetricKey): number {
  return resolveWearableMetricTolerance(metric);
}

export function sourceFamilyScore(family: WearableCandidateSourceFamily): number {
  switch (family) {
    case "canonical":
      return 4;
    case "event":
      return 3;
    case "sample":
      return 2;
    case "derived":
      return 1;
  }
}

export function resourceTypeScore(
  metric: WearableMetricKey,
  resourceType: string | null | undefined,
): number {
  const normalized = normalizeLowercaseString(resourceType);
  if (!normalized) {
    return 0;
  }

  if (SLEEP_METRIC_KEYS.has(metric) && normalized.includes("sleep")) {
    return 4;
  }

  if (RECOVERY_METRIC_KEYS.has(metric) && (normalized.includes("recovery") || normalized.includes("readiness"))) {
    return 4;
  }

  if (
    ACTIVITY_METRIC_KEYS.has(metric)
    && (normalized.includes("activity") || normalized.includes("cycle") || normalized.includes("summary"))
  ) {
    return 4;
  }

  if (BODY_METRIC_KEYS.has(metric) && (normalized.includes("body") || normalized.includes("summary"))) {
    return 4;
  }

  return normalized.includes("summary") ? 2 : 1;
}

function resolveDefaultProviderPriorityIndex(provider: string): number {
  const normalized = normalizeLowercaseString(provider);

  if (!normalized) {
    return DEFAULT_PROVIDER_PRIORITY_ORDER.length + 1;
  }

  const index = DEFAULT_PROVIDER_PRIORITY_ORDER.indexOf(normalized);
  return index === -1 ? DEFAULT_PROVIDER_PRIORITY_ORDER.length + 1 : index;
}
