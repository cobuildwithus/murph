import { stripEmptyObject, stripUndefined } from "../shared.js";
import {
  asArray,
  asPlainObject,
  createRawArtifact,
  finiteNumber,
  pushRawArtifact,
  slugify,
  stringId,
  toIso,
} from "./shared-normalization.js";

import type {
  DeviceExternalRefPayload,
  DeviceRawArtifactPayload,
} from "../core-port.js";
import type { PlainObject } from "./shared-normalization.js";

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
      return "deep";
    case "rapid-eye-movement":
      return "rem";
    case "wake":
      return "awake";
    default:
      return normalized;
  }
}

export function makeGarminExternalRef(
  resourceType: string,
  resourceId: string,
  version?: string,
  facet?: string,
): DeviceExternalRefPayload {
  return stripUndefined({
    system: "garmin",
    resourceType,
    resourceId,
    version,
    facet,
  });
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
): void {
  const artifact = createRawArtifact(role, fileName, content);

  if (!artifact) {
    return;
  }

  pushRawArtifact(
    rawArtifacts,
    stripUndefined({
      ...artifact,
      mediaType: options.mediaType ?? artifact.mediaType,
      metadata: options.metadata ? stripEmptyObject(options.metadata) : undefined,
    }),
  );
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
