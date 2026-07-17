import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  HealthCommonsWebExperimentProtocolTab,
  HealthCommonsWebExperimentResearchTab,
  HealthCommonsWebExperimentResultsPublic,
  HealthCommonsWebExperimentShell,
  HealthCommonsWebProjectionKey,
} from "@murphai/health-commons/runtime";

const EXPERIMENT_INDEX_SCHEMA_VERSION = "murph.commons.web.experiment-index.v1";
const ROUTE_INDEX_SCHEMA_VERSION = "murph.commons.web.route-index.v1";
const EXPERIMENT_SHELL_SCHEMA_VERSION = "murph.commons.web.experiment-shell.v1";
const EXPERIMENT_PROTOCOL_TAB_SCHEMA_VERSION =
  "murph.commons.web.experiment-protocol-tab.v1";
const EXPERIMENT_RESEARCH_TAB_SCHEMA_VERSION =
  "murph.commons.web.experiment-research-tab.v1";
const EXPERIMENT_RESULTS_PUBLIC_SCHEMA_VERSION =
  "murph.commons.web.experiment-results-public.v1";

type HealthCommonsExperimentRouteStatus =
  | "community"
  | "deprecated"
  | "draft"
  | "field-testing"
  | "reviewed";

export interface GeneratedExperimentIndexEntry {
  aliases: string[];
  baselineDays: number;
  category: string;
  description: string;
  durationDays: number;
  evidenceLabel: string;
  evidenceLevel: number;
  hidden?: boolean;
  image: string | null;
  key: string;
  revision: {
    pageRevisionId: string;
    recipeHash: string | null;
    runSpecRevisionId: string | null;
  };
  routeId: string;
  slug: string;
  sortRank?: number | null;
  status: HealthCommonsExperimentRouteStatus | null;
  studyCount: number;
  title: string;
}

export interface GeneratedExperimentIndex {
  catalogHash: string;
  experiments: GeneratedExperimentIndexEntry[];
  schemaVersion: typeof EXPERIMENT_INDEX_SCHEMA_VERSION;
}

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
  projections?: Partial<Record<GeneratedExperimentProjectionKey, string>>;
  routeId: string;
  slug: string;
}

export type GeneratedExperimentProjectionKey = Extract<
  HealthCommonsWebProjectionKey,
  | "experiment.protocol"
  | "experiment.research"
  | "experiment.results-public"
  | "experiment.shell"
>;

export interface GeneratedExperimentProjectionMap {
  "experiment.protocol": HealthCommonsWebExperimentProtocolTab;
  "experiment.research": HealthCommonsWebExperimentResearchTab;
  "experiment.results-public": HealthCommonsWebExperimentResultsPublic;
  "experiment.shell": HealthCommonsWebExperimentShell;
}

export type GeneratedExperimentResearchTab = HealthCommonsWebExperimentResearchTab;

type GeneratedExperimentProjection =
  GeneratedExperimentProjectionMap[GeneratedExperimentProjectionKey];

let cachedExperimentIndex: GeneratedExperimentIndex | null = null;
let cachedRouteIndex: GeneratedRouteIndex | null = null;
const cachedExperimentProjections = new Map<string, GeneratedExperimentProjection | null>();

export function getGeneratedExperimentIndex(): GeneratedExperimentIndex {
  if (!shouldUseGeneratedArtifactMemoryCache()) {
    return readGeneratedExperimentIndex();
  }

  cachedExperimentIndex ??= readGeneratedExperimentIndex();
  return cachedExperimentIndex;
}

export function loadGeneratedExperimentShell(
  experimentId: string,
): HealthCommonsWebExperimentShell | null {
  return loadGeneratedExperimentProjection(experimentId, "experiment.shell");
}

export function loadGeneratedExperimentProtocolTab(
  experimentId: string,
): HealthCommonsWebExperimentProtocolTab | null {
  return loadGeneratedExperimentProjection(experimentId, "experiment.protocol");
}

export function loadGeneratedExperimentResearchTab(
  experimentId: string,
): GeneratedExperimentResearchTab | null {
  return loadGeneratedExperimentProjection(experimentId, "experiment.research");
}

export function loadGeneratedExperimentResultsPublic(
  experimentId: string,
): HealthCommonsWebExperimentResultsPublic | null {
  return loadGeneratedExperimentProjection(experimentId, "experiment.results-public");
}

export function loadGeneratedExperimentProjection(
  experimentId: string,
  projectionKey: "experiment.shell",
): HealthCommonsWebExperimentShell | null;
export function loadGeneratedExperimentProjection(
  experimentId: string,
  projectionKey: "experiment.protocol",
): HealthCommonsWebExperimentProtocolTab | null;
export function loadGeneratedExperimentProjection(
  experimentId: string,
  projectionKey: "experiment.research",
): HealthCommonsWebExperimentResearchTab | null;
export function loadGeneratedExperimentProjection(
  experimentId: string,
  projectionKey: "experiment.results-public",
): HealthCommonsWebExperimentResultsPublic | null;
export function loadGeneratedExperimentProjection(
  experimentId: string,
  projectionKey: GeneratedExperimentProjectionKey,
): GeneratedExperimentProjection | null {
  const route = resolveGeneratedExperimentRoute(experimentId);
  if (!route) {
    return null;
  }
  const artifactPath = route.projections?.[projectionKey];
  if (!artifactPath) {
    return null;
  }
  const artifactRouteId = routeIdFromBundlePath(route.bundlePath);
  assertProjectionPathMatchesRoute(projectionKey, artifactPath, artifactRouteId);

  return readCachedExperimentProjection(
    projectionCacheKey(projectionKey, artifactPath),
    () => readGeneratedExperimentProjection({
      artifactPath,
      projectionKey,
      route,
      routeId: artifactRouteId,
    }),
  );
}

function readCachedExperimentProjection(
  cacheKey: string,
  readArtifact: () => GeneratedExperimentProjection | null,
): GeneratedExperimentProjection | null {
  if (!shouldUseGeneratedArtifactMemoryCache()) {
    return readArtifact();
  }

  if (cachedExperimentProjections.has(cacheKey)) {
    return cachedExperimentProjections.get(cacheKey) ?? null;
  }

  const artifact = readArtifact();
  cachedExperimentProjections.set(cacheKey, artifact);
  return artifact;
}

function resolveGeneratedExperimentRoute(
  experimentId: string,
): GeneratedRouteIndexEntry | null {
  const normalized = normalizeRouteId(experimentId);
  return getGeneratedRouteIndex().routes.find((route) =>
    route.entityType === "protocol_variant"
      && (
        route.routeId === normalized
        || route.slug === normalized
        || route.slug.split("/").at(-1) === normalized
        || route.aliases.includes(normalized)
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

function readGeneratedExperimentIndex(): GeneratedExperimentIndex {
  const parsed = readJsonObjectFromCandidates([
    path.join(process.cwd(), "packages/health-commons/generated/web/browse/experiments.json"),
    path.join(process.cwd(), "../packages/health-commons/generated/web/browse/experiments.json"),
    path.join(process.cwd(), "../../packages/health-commons/generated/web/browse/experiments.json"),
  ]);
  assertGeneratedExperimentIndex(parsed);
  return parsed;
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

function readGeneratedExperimentProjection(input: {
  artifactPath: string;
  projectionKey: GeneratedExperimentProjectionKey;
  route: GeneratedRouteIndexEntry;
  routeId: string;
}): GeneratedExperimentProjection | null {
  const parsed = readOptionalJsonObjectFromCandidates(
    experimentProjectionCandidatePaths(input.projectionKey, input.artifactPath, input.routeId),
  );
  if (!parsed) {
    return null;
  }

  switch (input.projectionKey) {
    case "experiment.shell":
      assertGeneratedExperimentShell(parsed);
      assertExperimentProjectionMatchesRoute(parsed, input);
      return parsed;
    case "experiment.protocol":
      assertGeneratedExperimentProtocolTab(parsed);
      assertExperimentProjectionMatchesRoute(parsed, input);
      return parsed;
    case "experiment.research":
      assertGeneratedExperimentResearchTab(parsed);
      assertExperimentProjectionMatchesRoute(parsed, input);
      return parsed;
    case "experiment.results-public":
      assertGeneratedExperimentResultsPublic(parsed);
      assertExperimentProjectionMatchesRoute(parsed, input);
      return parsed;
  }
}

function experimentProjectionCandidatePaths(
  projectionKey: GeneratedExperimentProjectionKey,
  artifactPath: string,
  routeId: string,
): string[] {
  switch (projectionKey) {
    case "experiment.shell": {
      const fileName = parseExperimentShellProjectionPath(artifactPath, routeId);
      return experimentShellCandidatePaths(fileName);
    }
    case "experiment.protocol":
      return experimentTabCandidatePaths(
        parseExperimentTabProjectionPath(artifactPath, "protocol.json", routeId),
      );
    case "experiment.research":
      return experimentTabCandidatePaths(
        parseExperimentTabProjectionPath(artifactPath, "research.json", routeId),
      );
    case "experiment.results-public":
      return experimentTabCandidatePaths(
        parseExperimentTabProjectionPath(artifactPath, "results-public.json", routeId),
      );
  }
}

function experimentShellCandidatePaths(fileName: string): string[] {
  return [
    path.join(process.cwd(), "packages/health-commons/generated/web/shell/experiments", fileName),
    path.join(process.cwd(), "../packages/health-commons/generated/web/shell/experiments", fileName),
    path.join(process.cwd(), "../../packages/health-commons/generated/web/shell/experiments", fileName),
  ];
}

function experimentTabCandidatePaths(input: {
  fileName: string;
  routeId: string;
}): string[] {
  return [
    path.join(process.cwd(), "packages/health-commons/generated/web/tabs/experiments", input.routeId, input.fileName),
    path.join(process.cwd(), "../packages/health-commons/generated/web/tabs/experiments", input.routeId, input.fileName),
    path.join(process.cwd(), "../../packages/health-commons/generated/web/tabs/experiments", input.routeId, input.fileName),
  ];
}

function parseExperimentShellProjectionPath(artifactPath: string, routeId: string): string {
  const parts = parseGeneratedArtifactPath(artifactPath);
  if (
    parts.length !== 3
    || parts[0] !== "shell"
    || parts[1] !== "experiments"
    || parts[2] !== `${routeId}.json`
  ) {
    throw new Error(`Unexpected Health Commons experiment shell projection path: ${artifactPath}`);
  }
  return parts[2];
}

function parseExperimentTabProjectionPath(
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
    || parts[0] !== "tabs"
    || parts[1] !== "experiments"
    || parts[2] !== routeId
    || parts[3] !== expectedFileName
  ) {
    throw new Error(`Unexpected Health Commons experiment tab projection path: ${artifactPath}`);
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
  projectionKey: GeneratedExperimentProjectionKey,
  artifactPath: string,
  routeId: string,
): void {
  const expectedPath = experimentProjectionPathForRouteId(projectionKey, routeId);
  if (artifactPath !== expectedPath) {
    throw new Error(`Health Commons experiment projection path does not match route bundle id: ${artifactPath}`);
  }
}

function experimentProjectionPathForRouteId(
  projectionKey: GeneratedExperimentProjectionKey,
  routeId: string,
): string {
  switch (projectionKey) {
    case "experiment.protocol":
      return `tabs/experiments/${routeId}/protocol.json`;
    case "experiment.research":
      return `tabs/experiments/${routeId}/research.json`;
    case "experiment.results-public":
      return `tabs/experiments/${routeId}/results-public.json`;
    case "experiment.shell":
      return `shell/experiments/${routeId}.json`;
  }
}

function assertExperimentProjectionMatchesRoute(
  artifact: GeneratedExperimentProjection,
  input: {
    artifactPath: string;
    route: GeneratedRouteIndexEntry;
    routeId: string;
  },
): void {
  if (
    artifact.key !== input.route.key
    || ("id" in artifact && artifact.id !== input.routeId)
    || artifact.route.routeId !== input.routeId
    || artifact.route.slug !== input.route.slug
  ) {
    throw new Error(`Health Commons experiment projection does not match route index: ${input.artifactPath}`);
  }
}

function projectionCacheKey(
  projectionKey: GeneratedExperimentProjectionKey,
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

function assertGeneratedExperimentIndex(
  value: unknown,
): asserts value is GeneratedExperimentIndex {
  assertSchemaVersion(value, EXPERIMENT_INDEX_SCHEMA_VERSION, "experiment index");
  const experiments = "experiments" in value ? value.experiments : null;
  if (!Array.isArray(experiments)) {
    throw new Error("Health Commons experiment index must include an experiments array.");
  }
}

function assertGeneratedRouteIndex(value: unknown): asserts value is GeneratedRouteIndex {
  assertSchemaVersion(value, ROUTE_INDEX_SCHEMA_VERSION, "route index");
  const routes = "routes" in value ? value.routes : null;
  if (!Array.isArray(routes)) {
    throw new Error("Health Commons route index must include a routes array.");
  }
}

function assertGeneratedExperimentShell(
  value: unknown,
): asserts value is HealthCommonsWebExperimentShell {
  assertSchemaVersion(value, EXPERIMENT_SHELL_SCHEMA_VERSION, "experiment shell");
}

function assertGeneratedExperimentProtocolTab(
  value: unknown,
): asserts value is HealthCommonsWebExperimentProtocolTab {
  assertSchemaVersion(value, EXPERIMENT_PROTOCOL_TAB_SCHEMA_VERSION, "experiment protocol tab");
}

function assertGeneratedExperimentResearchTab(
  value: unknown,
): asserts value is GeneratedExperimentResearchTab {
  assertSchemaVersion(value, EXPERIMENT_RESEARCH_TAB_SCHEMA_VERSION, "experiment research tab");
}

function assertGeneratedExperimentResultsPublic(
  value: unknown,
): asserts value is HealthCommonsWebExperimentResultsPublic {
  assertSchemaVersion(value, EXPERIMENT_RESULTS_PUBLIC_SCHEMA_VERSION, "experiment results-public tab");
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
