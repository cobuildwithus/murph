import {
  HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION,
  type HealthCommonsWebProjectionKey,
  type HealthCommonsWebRouteIndex,
} from "./web-artifacts.ts";
import {
  isSafeGeneratedWebArtifactPath,
  readGeneratedWebArtifact,
  type LoadGeneratedHealthCommonsWebArtifactOptions,
} from "./runtime-paths.ts";

export type {
  LoadGeneratedHealthCommonsWebArtifactOptions,
} from "./runtime-paths.ts";
export type {
  HealthCommonsWebRouteIndex,
  HealthCommonsWebRouteIndexEntry,
} from "./web-artifacts.ts";

const HEALTH_COMMONS_WEB_PROJECTION_KEYS: readonly HealthCommonsWebProjectionKey[] = [
  "biomarker.overview",
  "biomarker.research",
  "biomarker.shell",
  "goal.page",
  "experiment.protocol",
  "experiment.research",
  "experiment.results-public",
  "experiment.shell",
];

let cachedGeneratedWebRouteIndex: HealthCommonsWebRouteIndex | null = null;

export function loadGeneratedHealthCommonsWebRouteIndex(
  options: LoadGeneratedHealthCommonsWebArtifactOptions = {},
): HealthCommonsWebRouteIndex {
  const raw = readGeneratedWebArtifact("routes/index.json", options.generatedWebRoot);
  const parsed = parseJsonObject(raw);
  assertGeneratedWebRouteIndex(parsed);
  return parsed;
}

export function getGeneratedHealthCommonsWebRouteIndex(
  options: LoadGeneratedHealthCommonsWebArtifactOptions = {},
): HealthCommonsWebRouteIndex {
  if (options.generatedWebRoot) {
    return loadGeneratedHealthCommonsWebRouteIndex(options);
  }

  cachedGeneratedWebRouteIndex ??= loadGeneratedHealthCommonsWebRouteIndex();
  return cachedGeneratedWebRouteIndex;
}

export function normalizeHealthCommonsWebRouteId(value: string): string {
  return safeDecodeURIComponent(value).trim().replace(/^\/+|\/+$/gu, "").toLowerCase();
}

function assertGeneratedWebRouteIndex(
  value: unknown,
): asserts value is HealthCommonsWebRouteIndex {
  if (
    !isRecord(value)
    || value["schemaVersion"] !== HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION
    || typeof value["catalogHash"] !== "string"
    || !Array.isArray(value["routes"])
    || !value["routes"].every(isGeneratedWebRouteIndexEntry)
  ) {
    throw new Error("Health Commons generated web route index is invalid.");
  }
}

function isGeneratedWebRouteIndexEntry(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const projections = value["projections"];
  return Array.isArray(value["aliases"])
    && value["aliases"].every(isString)
    && typeof value["bundlePath"] === "string"
    && isSafeGeneratedWebArtifactPath(value["bundlePath"])
    && typeof value["entityType"] === "string"
    && typeof value["key"] === "string"
    && typeof value["routeId"] === "string"
    && typeof value["slug"] === "string"
    && (
      projections === undefined
      || (
        isRecord(projections)
        && Object.entries(projections).every(([projectionKey, artifactPath]) =>
          isGeneratedWebProjectionKey(projectionKey)
          && typeof artifactPath === "string"
          && isSafeGeneratedWebArtifactPath(artifactPath)
        )
      )
    );
}

function isGeneratedWebProjectionKey(
  value: string,
): value is HealthCommonsWebProjectionKey {
  return HEALTH_COMMONS_WEB_PROJECTION_KEYS.some((projectionKey) => projectionKey === value);
}

function parseJsonObject(raw: string): unknown {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Health Commons generated artifact must be a JSON object.");
  }
  return parsed;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
