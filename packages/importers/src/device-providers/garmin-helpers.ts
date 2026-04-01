import {
  SLEEP_STAGES,
  formatTimeZoneDateTimeParts,
  extractIsoDatePrefix,
  normalizeIanaTimeZone,
} from "@murphai/contracts";

import { stripEmptyObject, stripUndefined } from "../shared.ts";
import {
  asArray,
  asPlainObject,
  createRawArtifact,
  finiteNumber,
  makeProviderExternalRef,
  pushRawArtifact,
  slugify,
  stringId,
  toIso,
} from "./shared-normalization.ts";

import type {
  DeviceExternalRefPayload,
  DeviceRawArtifactPayload,
} from "../core-port.ts";
import type { PlainObject } from "./shared-normalization.ts";

export function asObjectArray(value: unknown): PlainObject[] {
  return asArray(value)
    .map((entry) => asPlainObject(entry))
    .filter(Boolean) as PlainObject[];
}

function readPath(record: PlainObject | undefined, path: string): unknown {
  if (!record) {
    return undefined;
  }

  let current: unknown = record;

  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as PlainObject)[segment];
  }

  return current;
}

export function firstDefined(...candidates: unknown[]): unknown | undefined {
  return candidates.find((candidate) => candidate !== undefined && candidate !== null);
}

export function firstValueFromPaths(record: PlainObject | undefined, paths: readonly string[]): unknown {
  return firstDefined(...paths.map((path) => readPath(record, path)));
}

export function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function firstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const normalized = trimmedString(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export function firstIdentifier(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const normalized = stringId(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export function firstStringFromPaths(record: PlainObject | undefined, paths: readonly string[]): string | undefined {
  return firstString(...paths.map((path) => readPath(record, path)));
}

export function firstIdentifierFromPaths(
  record: PlainObject | undefined,
  paths: readonly string[],
): string | undefined {
  return firstIdentifier(...paths.map((path) => readPath(record, path)));
}

export function firstIso(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const normalized = toIso(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export function firstIsoFromPaths(record: PlainObject | undefined, paths: readonly string[]): string | undefined {
  return firstIso(...paths.map((path) => readPath(record, path)));
}

export function firstInstant(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();

      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        continue;
      }
    }

    const normalized = toIso(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export function firstInstantFromPaths(record: PlainObject | undefined, paths: readonly string[]): string | undefined {
  return firstInstant(...paths.map((path) => readPath(record, path)));
}

export function firstDayKey(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const dayKey = extractIsoDatePrefix(candidate.trim());

    if (dayKey) {
      return dayKey;
    }
  }

  return undefined;
}

export function firstDayKeyFromPaths(record: PlainObject | undefined, paths: readonly string[]): string | undefined {
  return firstDayKey(...paths.map((path) => readPath(record, path)));
}

export function firstTimeZone(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const normalized = normalizeIanaTimeZone(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export function firstTimeZoneFromPaths(record: PlainObject | undefined, paths: readonly string[]): string | undefined {
  return firstTimeZone(...paths.map((path) => readPath(record, path)));
}

export function synthesizeUtcStartOfDay(dayKey: string, timeZone: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  const normalizedTimeZone = normalizeIanaTimeZone(timeZone);

  if (!match || !normalizedTimeZone) {
    return undefined;
  }

  const desiredUtcMs = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    0,
    0,
    0,
  );
  let guessMs = desiredUtcMs;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatTimeZoneDateTimeParts(guessMs, normalizedTimeZone);
    const actualUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const deltaMs = actualUtcMs - desiredUtcMs;

    if (deltaMs === 0) {
      return new Date(guessMs).toISOString();
    }

    guessMs -= deltaMs;
  }

  const parts = formatTimeZoneDateTimeParts(guessMs, normalizedTimeZone);
  if (
    parts.dayKey === dayKey &&
    parts.hour === 0 &&
    parts.minute === 0 &&
    parts.second === 0
  ) {
    return new Date(guessMs).toISOString();
  }

  return undefined;
}

export function firstNumber(...candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    const numeric = finiteNumber(candidate);

    if (numeric !== undefined) {
      return numeric;
    }
  }

  return undefined;
}

export function firstNumberFromPaths(record: PlainObject | undefined, paths: readonly string[]): number | undefined {
  return firstNumber(...paths.map((path) => readPath(record, path)));
}

export function secondsToMinutes(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return Math.max(0, numeric / 60);
}

export function millisecondsToMinutes(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return Math.max(0, numeric / 60_000);
}

export function metersToKilometers(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return Math.max(0, numeric / 1000);
}

export function metersPerSecondToKilometersPerHour(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return Math.max(0, numeric * 3.6);
}

export function gramsToKilograms(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return Math.max(0, numeric / 1000);
}

export function normalizePositiveIntegerMinutes(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric <= 0) {
    return undefined;
  }

  return Math.max(1, Math.round(numeric));
}

export function normalizeActivityType(value: unknown): string {
  return slugify(value, "activity");
}

export function formatActivityLabel(value: unknown): string {
  const candidate = firstString(value);

  if (!candidate) {
    return "activity";
  }

  return candidate.trim();
}

export function normalizeSleepStage(value: unknown): string | undefined {
  const normalized = slugify(value, "");

  if (!normalized) {
    return undefined;
  }

  switch (normalized) {
    case "slow-wave":
    case "slow-wave-sleep":
    case "deep-sleep":
      return "deep";
    case "rapid-eye-movement":
    case "rem-sleep":
      return "rem";
    case "wake":
    case "awake-time":
      return "awake";
    case "light-sleep":
      return "light";
    default:
      return SLEEP_STAGES.includes(normalized as (typeof SLEEP_STAGES)[number])
        ? normalized
        : undefined;
  }
}

export function makeGarminExternalRef(
  resourceType: string,
  resourceId: string,
  version?: string,
  facet?: string,
): DeviceExternalRefPayload {
  return makeProviderExternalRef("garmin", resourceType, resourceId, version, facet);
}

export interface GarminArtifactOptions {
  mediaType?: string;
  metadata?: Record<string, unknown>;
}

export function pushGarminArtifact(
  rawArtifacts: DeviceRawArtifactPayload[],
  role: string,
  fileName: string,
  content: unknown,
  options: GarminArtifactOptions = {},
): boolean {
  const artifact = createRawArtifact(role, fileName, content);

  if (!artifact) {
    return false;
  }

  pushRawArtifact(
    rawArtifacts,
    stripUndefined({
      ...artifact,
      mediaType: options.mediaType ?? artifact.mediaType,
      metadata: options.metadata ? stripEmptyObject(options.metadata) : undefined,
    }),
  );

  return true;
}

export function inferGarminFileFormat(record: PlainObject): string {
  const explicit = firstStringFromPaths(record, [
    "fileType",
    "file_type",
    "format",
    "extension",
    "fileExtension",
    "metadata.fileType",
  ]);

  if (explicit) {
    return slugify(explicit, "file");
  }

  const fileName = firstStringFromPaths(record, ["fileName", "filename", "name"]);

  if (!fileName) {
    return "file";
  }

  const extension = fileName.split(".").pop();
  return extension ? slugify(extension, "file") : "file";
}

export function inferGarminFileMediaType(format: string, fileName?: string): string | undefined {
  const normalized = slugify(format, "file");

  switch (normalized) {
    case "fit":
      return "application/octet-stream";
    case "gpx":
      return "application/gpx+xml";
    case "tcx":
      return "application/xml";
    case "json":
      return "application/json";
    default:
      return fileName && fileName.endsWith(".json") ? "application/json" : undefined;
  }
}

export function isStructuredGarminPayload(value: unknown): boolean {
  if (Array.isArray(value)) {
    return true;
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  if (value instanceof Date || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
