import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { createHealthCommonsRouteBundleReader } from "@murphai/health-commons/runtime";

const ROUTE_INDEX_SCHEMA_VERSION = "murph.commons.web.route-index.v1";
const ROUTE_BUNDLE_SCHEMA_VERSION = "murph.commons.web.route-bundle.v1";

type HealthCommonsWebRouteBundle = Parameters<typeof createHealthCommonsRouteBundleReader>[0];
export type GeneratedMeasurementMethodRouteBundle = HealthCommonsWebRouteBundle;

interface GeneratedRouteIndex {
  catalogHash: string;
  routes: GeneratedMeasurementMethodRoute[];
  schemaVersion: typeof ROUTE_INDEX_SCHEMA_VERSION;
}

export interface GeneratedMeasurementMethodRoute {
  aliases: string[];
  bundlePath: string;
  entityType: string;
  key: string;
  routeId: string;
  slug: string;
}

let cachedRouteIndex: GeneratedRouteIndex | null = null;
const cachedRouteBundles = new Map<string, HealthCommonsWebRouteBundle | null>();

export function listGeneratedMeasurementMethodRouteEntries(): GeneratedMeasurementMethodRoute[] {
  return getGeneratedRouteIndex().routes.filter((route) =>
    route.entityType === "measurement_method"
  );
}

export function resolveGeneratedMeasurementMethodRoute(
  measurementMethodId: string,
): GeneratedMeasurementMethodRoute | null {
  const normalized = normalizeRouteId(measurementMethodId);
  return listGeneratedMeasurementMethodRouteEntries().find((route) =>
    route.routeId === normalized
      || route.slug === normalized
      || route.slug.split("/").at(-1) === normalized
      || route.aliases.includes(normalized)
  ) ?? null;
}

export function loadGeneratedMeasurementMethodRouteBundle(
  routeId: string,
): HealthCommonsWebRouteBundle | null {
  const route = resolveGeneratedMeasurementMethodRoute(routeId);
  if (!route) {
    return null;
  }

  const bundleRouteId = routeIdFromMeasurementMethodBundlePath(route.bundlePath);
  if (bundleRouteId !== route.routeId) {
    throw new Error(`Health Commons measurement-method bundle path does not match route id: ${route.bundlePath}`);
  }

  return readCachedRouteBundle(route.bundlePath, () => {
    const parsed = readOptionalJsonObjectFromCandidates(
      measurementMethodBundleCandidatePaths(`${bundleRouteId}.json`),
    );
    if (!parsed) {
      return null;
    }
    assertGeneratedRouteBundle(parsed);
    assertRouteBundleMatchesRoute(parsed, route);
    return parsed;
  });
}

function getGeneratedRouteIndex(): GeneratedRouteIndex {
  if (!shouldUseGeneratedArtifactMemoryCache()) {
    return readGeneratedRouteIndex();
  }

  cachedRouteIndex ??= readGeneratedRouteIndex();
  return cachedRouteIndex;
}

function readCachedRouteBundle(
  cacheKey: string,
  readArtifact: () => HealthCommonsWebRouteBundle | null,
): HealthCommonsWebRouteBundle | null {
  if (!shouldUseGeneratedArtifactMemoryCache()) {
    return readArtifact();
  }

  if (cachedRouteBundles.has(cacheKey)) {
    return cachedRouteBundles.get(cacheKey) ?? null;
  }

  const artifact = readArtifact();
  cachedRouteBundles.set(cacheKey, artifact);
  return artifact;
}

function shouldUseGeneratedArtifactMemoryCache(): boolean {
  return process.env.NODE_ENV === "production";
}

function readGeneratedRouteIndex(): GeneratedRouteIndex {
  const parsed = readJsonObjectFromCandidates([
    path.join(process.cwd(), "packages/health-commons/generated/web/routes/index.json"),
    path.join(process.cwd(), "../packages/health-commons/generated/web/routes/index.json"),
    path.join(process.cwd(), "../../packages/health-commons/generated/web/routes/index.json"),
  ]);
  assertGeneratedRouteIndex(parsed);
  return parsed;
}

function measurementMethodBundleCandidatePaths(fileName: string): string[] {
  return [
    path.join(process.cwd(), "packages/health-commons/generated/web/bundles/measurement_method", fileName),
    path.join(process.cwd(), "../packages/health-commons/generated/web/bundles/measurement_method", fileName),
    path.join(process.cwd(), "../../packages/health-commons/generated/web/bundles/measurement_method", fileName),
  ];
}

function routeIdFromMeasurementMethodBundlePath(bundlePath: string): string {
  const parts = parseGeneratedArtifactPath(bundlePath);
  if (
    parts.length !== 3
    || parts[0] !== "bundles"
    || parts[1] !== "measurement_method"
    || !parts[2]?.endsWith(".json")
  ) {
    throw new Error(`Unexpected Health Commons measurement-method bundle path: ${bundlePath}`);
  }
  return parts[2].slice(0, -".json".length);
}

function parseGeneratedArtifactPath(artifactPath: string): string[] {
  const parts = artifactPath.split("/");
  if (
    path.isAbsolute(artifactPath)
    || parts.length === 0
    || parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))
  ) {
    throw new Error(`Unsafe Health Commons generated artifact path: ${artifactPath}`);
  }
  return parts;
}

function readJsonObjectFromCandidates(candidates: string[]): unknown {
  const parsed = readOptionalJsonObjectFromCandidates(candidates);
  if (!parsed) {
    throw new Error(`Missing Health Commons generated artifact: ${candidates[0]}`);
  }
  return parsed;
}

function readOptionalJsonObjectFromCandidates(candidates: string[]): unknown | null {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    const parsed: unknown = JSON.parse(readFileSync(candidate, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Health Commons generated artifact must be a JSON object: ${candidate}`);
    }
    return parsed;
  }

  return null;
}

function assertGeneratedRouteIndex(value: unknown): asserts value is GeneratedRouteIndex {
  assertSchemaVersion(value, ROUTE_INDEX_SCHEMA_VERSION, "route index");
  const routes = "routes" in value ? value.routes : null;
  if (!Array.isArray(routes)) {
    throw new Error("Health Commons route index must include a routes array.");
  }
}

function assertGeneratedRouteBundle(value: unknown): asserts value is HealthCommonsWebRouteBundle {
  assertSchemaVersion(value, ROUTE_BUNDLE_SCHEMA_VERSION, "route bundle");
  const route = "route" in value ? value.route : null;
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    throw new Error("Health Commons route bundle must include a route object.");
  }
}

function assertRouteBundleMatchesRoute(
  bundle: HealthCommonsWebRouteBundle,
  route: GeneratedMeasurementMethodRoute,
): void {
  if (
    bundle.primaryKey !== route.key
    || bundle.route.entityType !== route.entityType
    || bundle.route.routeId !== route.routeId
    || bundle.route.slug !== route.slug
  ) {
    throw new Error(`Health Commons measurement-method bundle does not match route index: ${route.bundlePath}`);
  }
}

function assertSchemaVersion<T extends string>(
  value: unknown,
  schemaVersion: T,
  label: string,
): asserts value is { schemaVersion: T } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Health Commons ${label} artifact must be a JSON object.`);
  }

  if (!("schemaVersion" in value) || value.schemaVersion !== schemaVersion) {
    throw new Error(`Unexpected Health Commons ${label} schema version.`);
  }
}

function normalizeRouteId(value: string): string {
  return safeDecodeURIComponent(value).trim().replace(/^\/+|\/+$/gu, "");
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
