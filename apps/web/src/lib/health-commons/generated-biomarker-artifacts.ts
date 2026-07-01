import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  HealthCommonsWebBiomarkerOverview,
  HealthCommonsWebBiomarkerResearch,
  HealthCommonsWebBiomarkerShell,
  HealthCommonsWebProjectionKey,
} from "@murphai/health-commons/runtime";

const ROUTE_INDEX_SCHEMA_VERSION = "murph.commons.web.route-index.v1";
const BIOMARKER_INDEX_SCHEMA_VERSION = "murph.commons.web.biomarker-index.v1";
const BIOMARKER_SHELL_SCHEMA_VERSION = "murph.commons.web.biomarker-shell.v1";
const BIOMARKER_OVERVIEW_SCHEMA_VERSION = "murph.commons.web.biomarker-overview.v1";
const BIOMARKER_RESEARCH_SCHEMA_VERSION = "murph.commons.web.biomarker-research.v1";

interface GeneratedRouteIndex {
  catalogHash: string;
  routes: GeneratedRouteIndexEntry[];
  schemaVersion: typeof ROUTE_INDEX_SCHEMA_VERSION;
}

interface GeneratedRouteIndexEntry {
  aliases: string[];
  bundlePath: string;
  entityType: string;
  key: string;
  projections?: Partial<Record<GeneratedBiomarkerProjectionKey, string>>;
  routeId: string;
  slug: string;
}

export interface GeneratedBiomarkerIndex {
  biomarkers: GeneratedBiomarkerIndexEntry[];
  catalogHash: string;
  schemaVersion: typeof BIOMARKER_INDEX_SCHEMA_VERSION;
}

export interface GeneratedBiomarkerIndexEntry {
  aliases: string[];
  categories: string[];
  hidden: boolean;
  key: string;
  published: boolean;
  routeId: string;
  shortName: string;
  summary: string | null;
  title: string;
  unit: string | null;
}

export type GeneratedBiomarkerProjectionKey = Extract<
  HealthCommonsWebProjectionKey,
  "biomarker.shell" | "biomarker.overview" | "biomarker.research"
>;

export interface GeneratedBiomarkerProjectionMap {
  "biomarker.shell": HealthCommonsWebBiomarkerShell;
  "biomarker.overview": HealthCommonsWebBiomarkerOverview;
  "biomarker.research": HealthCommonsWebBiomarkerResearch;
}

type GeneratedBiomarkerProjection =
  GeneratedBiomarkerProjectionMap[GeneratedBiomarkerProjectionKey];

let cachedRouteIndex: GeneratedRouteIndex | null = null;
let cachedBiomarkerIndex: GeneratedBiomarkerIndex | null = null;
const cachedBiomarkerProjections = new Map<string, GeneratedBiomarkerProjection | null>();

const GENERATED_BIOMARKER_ROUTE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "deep-sleep": "deep-sleep-minutes",
  hrv: "hrv-rmssd",
  rem: "rem-sleep-minutes",
  rhr: "resting-heart-rate",
});

export function loadGeneratedBiomarkerShell(
  biomarkerId: string,
): HealthCommonsWebBiomarkerShell | null {
  return loadGeneratedBiomarkerProjection(biomarkerId, "biomarker.shell");
}

export function loadGeneratedBiomarkerOverview(
  biomarkerId: string,
): HealthCommonsWebBiomarkerOverview | null {
  return loadGeneratedBiomarkerProjection(biomarkerId, "biomarker.overview");
}

export function loadGeneratedBiomarkerResearch(
  biomarkerId: string,
): HealthCommonsWebBiomarkerResearch | null {
  return loadGeneratedBiomarkerProjection(biomarkerId, "biomarker.research");
}

export function getGeneratedBiomarkerIndex(): GeneratedBiomarkerIndex {
  if (!shouldUseGeneratedArtifactMemoryCache()) {
    return readGeneratedBiomarkerIndex();
  }

  cachedBiomarkerIndex ??= readGeneratedBiomarkerIndex();
  return cachedBiomarkerIndex;
}

export function loadGeneratedBiomarkerProjection(
  biomarkerId: string,
  projectionKey: "biomarker.shell",
): HealthCommonsWebBiomarkerShell | null;
export function loadGeneratedBiomarkerProjection(
  biomarkerId: string,
  projectionKey: "biomarker.overview",
): HealthCommonsWebBiomarkerOverview | null;
export function loadGeneratedBiomarkerProjection(
  biomarkerId: string,
  projectionKey: "biomarker.research",
): HealthCommonsWebBiomarkerResearch | null;
export function loadGeneratedBiomarkerProjection(
  biomarkerId: string,
  projectionKey: GeneratedBiomarkerProjectionKey,
): GeneratedBiomarkerProjection | null {
  const route = resolveGeneratedBiomarkerRoute(biomarkerId);
  if (!route) {
    return null;
  }
  const routeId = routeIdFromBundlePath(route.bundlePath);
  const artifactPath = route.projections?.[projectionKey];
  if (!artifactPath) {
    return null;
  }
  assertProjectionPathMatchesRoute(projectionKey, artifactPath, routeId);

  return readCachedBiomarkerProjection(
    projectionCacheKey(projectionKey, artifactPath),
    () => readGeneratedBiomarkerProjection({
      artifactPath,
      projectionKey,
      route,
      routeId,
    }),
  );
}

function readCachedBiomarkerProjection(
  cacheKey: string,
  readArtifact: () => GeneratedBiomarkerProjection | null,
): GeneratedBiomarkerProjection | null {
  if (!shouldUseGeneratedArtifactMemoryCache()) {
    return readArtifact();
  }

  if (cachedBiomarkerProjections.has(cacheKey)) {
    return cachedBiomarkerProjections.get(cacheKey) ?? null;
  }

  const artifact = readArtifact();
  cachedBiomarkerProjections.set(cacheKey, artifact);
  return artifact;
}

function resolveGeneratedBiomarkerRoute(
  biomarkerId: string,
): GeneratedRouteIndexEntry | null {
  const normalized = normalizeRouteId(biomarkerId);
  const aliased = GENERATED_BIOMARKER_ROUTE_ALIASES[normalized] ?? normalized;
  return getGeneratedRouteIndex().routes.find((route) =>
    route.entityType === "biomarker"
      && (
        route.routeId === aliased
        || route.slug === aliased
        || route.slug.split("/").at(-1) === aliased
        || route.aliases.includes(aliased)
      )
  ) ?? null;
}

function getGeneratedRouteIndex(): GeneratedRouteIndex {
  if (!shouldUseGeneratedArtifactMemoryCache()) {
    return readGeneratedRouteIndex();
  }

  cachedRouteIndex ??= readGeneratedRouteIndex();
  return cachedRouteIndex;
}

function shouldUseGeneratedArtifactMemoryCache(): boolean {
  return process.env.NODE_ENV === "production";
}

function readGeneratedRouteIndex(): GeneratedRouteIndex {
  const parsed = readJsonObjectFromCandidates(generatedWebCandidatePaths(
    "routes",
    "index.json",
  ));
  assertGeneratedRouteIndex(parsed);
  return parsed;
}

function readGeneratedBiomarkerIndex(): GeneratedBiomarkerIndex {
  const parsed = readJsonObjectFromCandidates(generatedWebCandidatePaths(
    "browse",
    "biomarkers.json",
  ));
  assertGeneratedBiomarkerIndex(parsed);
  return parsed;
}

function readGeneratedBiomarkerProjection(input: {
  artifactPath: string;
  projectionKey: GeneratedBiomarkerProjectionKey;
  route: GeneratedRouteIndexEntry;
  routeId: string;
}): GeneratedBiomarkerProjection | null {
  const parsed = readOptionalJsonObjectFromCandidates(
    biomarkerProjectionCandidatePaths(input.projectionKey, input.artifactPath, input.routeId),
  );
  if (!parsed) {
    return null;
  }

  switch (input.projectionKey) {
    case "biomarker.shell":
      assertGeneratedBiomarkerShell(parsed);
      assertBiomarkerProjectionMatchesRoute(parsed, input);
      return parsed;
    case "biomarker.overview":
      assertGeneratedBiomarkerOverview(parsed);
      assertBiomarkerProjectionMatchesRoute(parsed, input);
      return parsed;
    case "biomarker.research":
      assertGeneratedBiomarkerResearch(parsed);
      assertBiomarkerProjectionMatchesRoute(parsed, input);
      return parsed;
  }
}

function biomarkerProjectionCandidatePaths(
  projectionKey: GeneratedBiomarkerProjectionKey,
  artifactPath: string,
  routeId: string,
): string[] {
  switch (projectionKey) {
    case "biomarker.shell": {
      const fileName = parseBiomarkerShellProjectionPath(artifactPath, routeId);
      return biomarkerShellCandidatePaths(fileName);
    }
    case "biomarker.overview":
      return biomarkerPageCandidatePaths(
        parseBiomarkerPageProjectionPath(artifactPath, "overview.json", routeId),
      );
    case "biomarker.research":
      return biomarkerPageCandidatePaths(
        parseBiomarkerPageProjectionPath(artifactPath, "research.json", routeId),
      );
  }
}

function biomarkerShellCandidatePaths(fileName: string): string[] {
  return generatedWebCandidatePaths("shell", "biomarkers", fileName);
}

function biomarkerPageCandidatePaths(input: {
  fileName: string;
  routeId: string;
}): string[] {
  return generatedWebCandidatePaths(
    "pages",
    "biomarkers",
    input.routeId,
    input.fileName,
  );
}

function generatedWebCandidatePaths(...segments: string[]): string[] {
  return [
    path.join(
      /* turbopackIgnore: true */ process.cwd(),
      "packages/health-commons/generated/web",
      ...segments,
    ),
    path.join(
      /* turbopackIgnore: true */ process.cwd(),
      "../packages/health-commons/generated/web",
      ...segments,
    ),
    path.join(
      /* turbopackIgnore: true */ process.cwd(),
      "../../packages/health-commons/generated/web",
      ...segments,
    ),
  ];
}

function parseBiomarkerShellProjectionPath(artifactPath: string, routeId: string): string {
  const parts = parseGeneratedArtifactPath(artifactPath);
  if (
    parts.length !== 3
    || parts[0] !== "shell"
    || parts[1] !== "biomarkers"
    || parts[2] !== `${routeId}.json`
  ) {
    throw new Error(`Unexpected Health Commons biomarker shell projection path: ${artifactPath}`);
  }
  return parts[2];
}

function parseBiomarkerPageProjectionPath(
  artifactPath: string,
  expectedFileName: string,
  routeId: string,
): {
  fileName: string;
  routeId: string;
} {
  const parts = parseGeneratedArtifactPath(artifactPath);
  if (
    parts.length !== 4
    || parts[0] !== "pages"
    || parts[1] !== "biomarkers"
    || parts[2] !== routeId
    || parts[3] !== expectedFileName
  ) {
    throw new Error(`Unexpected Health Commons biomarker page projection path: ${artifactPath}`);
  }
  return {
    fileName: parts[3],
    routeId: parts[2],
  };
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

function routeIdFromBundlePath(bundlePath: string): string {
  const parts = parseGeneratedArtifactPath(bundlePath);
  if (
    parts.length !== 3
    || parts[0] !== "bundles"
    || !parts[2]?.endsWith(".json")
  ) {
    throw new Error(`Unexpected Health Commons generated bundle path: ${bundlePath}`);
  }
  return parts[2].slice(0, -".json".length);
}

function assertProjectionPathMatchesRoute(
  projectionKey: GeneratedBiomarkerProjectionKey,
  artifactPath: string,
  routeId: string,
): void {
  const expectedPath = biomarkerProjectionPathForRouteId(projectionKey, routeId);
  if (artifactPath !== expectedPath) {
    throw new Error(`Health Commons biomarker projection path does not match route bundle id: ${artifactPath}`);
  }
}

function biomarkerProjectionPathForRouteId(
  projectionKey: GeneratedBiomarkerProjectionKey,
  routeId: string,
): string {
  switch (projectionKey) {
    case "biomarker.shell":
      return `shell/biomarkers/${routeId}.json`;
    case "biomarker.overview":
      return `pages/biomarkers/${routeId}/overview.json`;
    case "biomarker.research":
      return `pages/biomarkers/${routeId}/research.json`;
  }
}

function assertBiomarkerProjectionMatchesRoute(
  artifact: GeneratedBiomarkerProjection,
  input: {
    artifactPath: string;
    route: GeneratedRouteIndexEntry;
    routeId: string;
  },
): void {
  if (
    artifact.key !== input.route.key
    || artifact.route.routeId !== input.routeId
    || artifact.route.slug !== input.route.slug
  ) {
    throw new Error(`Health Commons biomarker projection does not match route index: ${input.artifactPath}`);
  }
}

function projectionCacheKey(
  projectionKey: GeneratedBiomarkerProjectionKey,
  artifactPath: string,
): string {
  return `${projectionKey}:${artifactPath}`;
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

function assertGeneratedBiomarkerIndex(value: unknown): asserts value is GeneratedBiomarkerIndex {
  assertSchemaVersion(value, BIOMARKER_INDEX_SCHEMA_VERSION, "biomarker index");
  const biomarkers = "biomarkers" in value ? value.biomarkers : null;
  if (!Array.isArray(biomarkers) || !biomarkers.every(isGeneratedBiomarkerIndexEntry)) {
    throw new Error("Health Commons biomarker index must include valid biomarker entries.");
  }
}

function isGeneratedBiomarkerIndexEntry(value: unknown): value is GeneratedBiomarkerIndexEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return Array.isArray(entry["aliases"])
    && entry["aliases"].every((alias) => typeof alias === "string")
    && Array.isArray(entry["categories"])
    && entry["categories"].every((category) => typeof category === "string")
    && typeof entry["hidden"] === "boolean"
    && typeof entry["key"] === "string"
    && typeof entry["published"] === "boolean"
    && typeof entry["routeId"] === "string"
    && typeof entry["shortName"] === "string"
    && (typeof entry["summary"] === "string" || entry["summary"] === null)
    && typeof entry["title"] === "string"
    && (typeof entry["unit"] === "string" || entry["unit"] === null);
}

function assertGeneratedBiomarkerShell(value: unknown): asserts value is HealthCommonsWebBiomarkerShell {
  assertSchemaVersion(value, BIOMARKER_SHELL_SCHEMA_VERSION, "biomarker shell");
}

function assertGeneratedBiomarkerOverview(value: unknown): asserts value is HealthCommonsWebBiomarkerOverview {
  assertSchemaVersion(value, BIOMARKER_OVERVIEW_SCHEMA_VERSION, "biomarker overview");
}

function assertGeneratedBiomarkerResearch(value: unknown): asserts value is HealthCommonsWebBiomarkerResearch {
  assertSchemaVersion(value, BIOMARKER_RESEARCH_SCHEMA_VERSION, "biomarker research");
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
