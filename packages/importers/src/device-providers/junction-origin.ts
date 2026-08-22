import { createHash } from "node:crypto";

import { stripUndefined } from "../shared.ts";
import {
  asPlainObject,
  finiteNumber,
  slugify,
  stringId,
} from "./shared-normalization.ts";

import type { DeviceDataOrigin } from "../core-port.ts";
import type { PlainObject } from "./shared-normalization.ts";

type TimestampSemantics = NonNullable<DeviceDataOrigin["timestampSemantics"]>;
type OriginConfidence = NonNullable<DeviceDataOrigin["originConfidence"]>;

export interface JunctionOriginFallback extends PlainObject {
  groupedSourceSlug?: unknown;
  normalizerVersion?: unknown;
  sourceInstanceId?: unknown;
  sourceProviderSlug?: unknown;
}

const SOURCE_PROVIDER_SLUG_PATHS = Object.freeze([
  "sourceProviderSlug",
  "source_provider_slug",
  "sourceProvider",
  "source_provider",
  "source.provider",
  "source.providerSlug",
  "source.provider_slug",
  "source.slug",
  "providerSlug",
  "provider.slug",
  "provider.provider",
  "provider.providerSlug",
  "provider.provider_slug",
  "provider_slug",
  "provider",
] as const);

const PROVIDER_NAME_SOURCE_PROVIDER_SLUG_PATHS = Object.freeze([
  "provider.name",
] as const);

const KNOWN_JUNCTION_PROVIDER_NAME_SLUGS = new Set([
  "abbott-libreview",
  "accuchek-ble",
  "apple-health-kit",
  "beurer-api",
  "contour-ble",
  "cronometer",
  "dexcom",
  "dexcom-v3",
  "eight-sleep",
  "fitbit",
  "freestyle-libre",
  "freestyle-libre-ble",
  "garmin",
  "google-fit",
  "google-health",
  "hammerhead",
  "health-connect",
  "ihealth",
  "kardia",
  "map-my-fitness",
  "omron",
  "onetouch-ble",
  "oura",
  "peloton",
  "polar",
  "renpho",
  "runkeeper",
  "samsung-health",
  "strava",
  "tandem-source",
  "ultrahuman",
  "wahoo",
  "whoop",
  "withings",
  "zwift",
]);

const SOURCE_TYPE_PATHS = Object.freeze([
  "sourceType",
  "source_type",
  "source.type",
] as const);

const SOURCE_DEVICE_ID_PATHS = Object.freeze([
  "sourceDeviceId",
  "source_device_id",
  "source.device_id",
  "deviceId",
  "device_id",
  "source.deviceId",
] as const);

const SOURCE_APP_ID_PATHS = Object.freeze([
  "sourceAppId",
  "source_app_id",
  "source.app_id",
  "appId",
  "app_id",
  "source.appId",
] as const);

const SOURCE_INSTANCE_IDENTITY_PATHS = Object.freeze([
  "sourceInstanceId",
  "source_instance_id",
  "sourceId",
  "source_id",
  "connectionId",
  "connection_id",
] as const);

const OPAQUE_SOURCE_INSTANCE_ID_PATTERN = /^source-[a-f0-9]{24}$/u;

const TIME_ZONE_OFFSET_PATHS = Object.freeze([
  "timeZoneOffsetMinutes",
  "time_zone_offset_minutes",
  "utcOffsetMinutes",
  "utc_offset_minutes",
] as const);

export function resolveJunctionOrigin(
  record: PlainObject | undefined,
  fallback: JunctionOriginFallback = {},
): DeviceDataOrigin {
  const fallbackRecord = asPlainObject(fallback);
  const sourceProviderSlug = resolveSourceProviderSlug(record, fallbackRecord);
  const existingOpaqueSourceInstanceId =
    firstOpaqueSourceInstanceId(record)
    ?? firstOpaqueSourceInstanceId(fallbackRecord);
  const sourceInstanceValues = resolveSourceInstanceValues(record, fallbackRecord);
  const sourceInstanceId = existingOpaqueSourceInstanceId ?? (sourceProviderSlug
    ? buildJunctionSourceInstanceId(sourceProviderSlug, sourceInstanceValues)
    : firstStringFromPaths(fallbackRecord, ["sourceInstanceId", "source_instance_id"]));

  return stripUndefined({
    version: 1 as const,
    aggregatorProvider: "junction",
    sourceProviderSlug,
    sourceType: firstStringFromPaths(record, SOURCE_TYPE_PATHS)
      ?? firstStringFromPaths(fallbackRecord, SOURCE_TYPE_PATHS),
    sourceInstanceId,
    observedAtRaw: firstStringFromPaths(record, ["observedAtRaw", "observed_at_raw"])
      ?? firstStringFromPaths(fallbackRecord, ["observedAtRaw", "observed_at_raw"]),
    timeZoneOffsetMinutes: firstDefined(
      firstNullableNumberFromPaths(record, TIME_ZONE_OFFSET_PATHS),
      firstNullableNumberFromPaths(fallbackRecord, TIME_ZONE_OFFSET_PATHS),
    ),
    timestampSemantics: firstTimestampSemantics(record)
      ?? firstTimestampSemantics(fallbackRecord),
    originConfidence: firstOriginConfidence(record)
      ?? firstOriginConfidence(fallbackRecord),
    normalizerVersion: firstStringFromPaths(fallbackRecord, ["normalizerVersion", "normalizer_version"])
      ?? "junction-normalizer.v1",
  });
}

export function normalizeJunctionSourceProviderSlug(value: unknown): string | undefined {
  const id = stringId(value);
  if (!id) {
    return undefined;
  }

  const slug = slugify(id, "");
  return slug && slug !== "junction" ? slug : undefined;
}

export function normalizeKnownJunctionSourceProviderSlug(
  value: unknown,
): string | undefined {
  const slug = normalizeJunctionSourceProviderSlug(value);
  return slug && KNOWN_JUNCTION_PROVIDER_NAME_SLUGS.has(slug) ? slug : undefined;
}

export function readJunctionSourceProviderSlug(
  entry: PlainObject | undefined,
  connection: PlainObject | undefined,
): string | undefined {
  return firstSourceProviderSlugFromPaths(entry, SOURCE_PROVIDER_SLUG_PATHS)
    ?? firstKnownProviderNameSlugFromPaths(entry, PROVIDER_NAME_SOURCE_PROVIDER_SLUG_PATHS)
    ?? firstSourceProviderSlugFromPaths(connection, SOURCE_PROVIDER_SLUG_PATHS)
    ?? firstKnownProviderNameSlugFromPaths(connection, PROVIDER_NAME_SOURCE_PROVIDER_SLUG_PATHS);
}

function resolveSourceProviderSlug(
  record: PlainObject | undefined,
  fallback: PlainObject | undefined,
): string | undefined {
  return readJunctionSourceProviderSlug(record, fallback)
    ?? normalizeJunctionSourceProviderSlug(readPath(fallback, "groupedSourceSlug"));
}

function firstSourceProviderSlugFromPaths(source: PlainObject | undefined, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const slug = normalizeJunctionSourceProviderSlug(readPath(source, path));
    if (slug) {
      return slug;
    }
  }

  return undefined;
}

function firstKnownProviderNameSlugFromPaths(source: PlainObject | undefined, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const slug = normalizeKnownJunctionSourceProviderSlug(readPath(source, path));
    if (slug) {
      return slug;
    }
  }

  return undefined;
}

function resolveSourceInstanceValues(
  record: PlainObject | undefined,
  fallback: PlainObject | undefined,
): string[] {
  return [
    firstStringFromPaths(record, SOURCE_INSTANCE_IDENTITY_PATHS),
    firstStringFromPaths(fallback, SOURCE_INSTANCE_IDENTITY_PATHS),
    firstStringFromPaths(record, SOURCE_DEVICE_ID_PATHS),
    firstStringFromPaths(fallback, SOURCE_DEVICE_ID_PATHS),
    firstStringFromPaths(record, SOURCE_APP_ID_PATHS),
    firstStringFromPaths(fallback, SOURCE_APP_ID_PATHS),
  ].filter((value): value is string => Boolean(value));
}

function buildJunctionSourceInstanceId(
  sourceProviderSlug: string,
  values: readonly string[],
): string | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const digest = createHash("sha256")
    .update(JSON.stringify({
      sourceProviderSlug,
      values,
    }))
    .digest("hex")
    .slice(0, 24);

  return `source-${digest}`;
}

function firstOpaqueSourceInstanceId(source: PlainObject | undefined): string | undefined {
  const value = firstStringFromPaths(source, ["sourceInstanceId", "source_instance_id"]);
  return value && OPAQUE_SOURCE_INSTANCE_ID_PATTERN.test(value) ? value : undefined;
}

function firstTimestampSemantics(source: PlainObject | undefined): TimestampSemantics | undefined {
  const value = firstStringFromPaths(source, ["timestampSemantics", "timestamp_semantics"]);
  return value === "utc" || value === "offset" || value === "floating" || value === "unknown"
    ? value
    : undefined;
}

function firstOriginConfidence(source: PlainObject | undefined): OriginConfidence | undefined {
  const value = firstStringFromPaths(source, ["originConfidence", "origin_confidence"]);
  return value === "high" || value === "medium" || value === "low" || value === "unknown"
    ? value
    : undefined;
}

function firstNullableNumberFromPaths(source: PlainObject | undefined, paths: readonly string[]): number | null | undefined {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value === null) {
      return null;
    }

    const numeric = finiteNumber(value);
    if (numeric !== undefined) {
      return numeric;
    }
  }

  return undefined;
}

function firstStringFromPaths(source: PlainObject | undefined, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const value = readPath(source, path);
    const id = stringId(value);
    if (id) {
      return id;
    }
  }

  return undefined;
}

function readPath(source: PlainObject | undefined, path: string): unknown {
  if (!source) {
    return undefined;
  }

  return path.split(".").reduce<unknown>((current, key) => {
    const record = asPlainObject(current);
    return record ? record[key] : undefined;
  }, source);
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}
