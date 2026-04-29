import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  HealthCommonsWebExperimentProtocolTab,
  HealthCommonsWebExperimentResultsPublic,
  HealthCommonsWebExperimentShell,
} from "@murphai/health-commons/runtime";

import type { ResearchTabExperiment } from "@/src/components/experiments/experiment-detail/research-tab";
import type { ExperimentResearchStat } from "@/src/types/experiments";

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
  status: HealthCommonsExperimentRouteStatus;
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
  routeId: string;
  slug: string;
}

export interface GeneratedExperimentResearchTab extends ResearchTabExperiment {
  description: string;
  route: {
    routeId: string;
  };
  schemaVersion: typeof EXPERIMENT_RESEARCH_TAB_SCHEMA_VERSION;
  title: string;
  researchStats: ExperimentResearchStat[];
}

let cachedExperimentIndex: GeneratedExperimentIndex | null = null;
let cachedRouteIndex: GeneratedRouteIndex | null = null;
const cachedExperimentShells = new Map<string, HealthCommonsWebExperimentShell | null>();
const cachedExperimentProtocolTabs = new Map<string, HealthCommonsWebExperimentProtocolTab | null>();
const cachedExperimentResearchTabs = new Map<string, GeneratedExperimentResearchTab | null>();
const cachedExperimentResultsPublic = new Map<string, HealthCommonsWebExperimentResultsPublic | null>();

export function getGeneratedExperimentIndex(): GeneratedExperimentIndex {
  cachedExperimentIndex ??= readGeneratedExperimentIndex();
  return cachedExperimentIndex;
}

export function loadGeneratedExperimentShell(
  experimentId: string,
): HealthCommonsWebExperimentShell | null {
  const route = resolveGeneratedExperimentRoute(experimentId);
  if (!route) {
    return null;
  }
  const artifactRouteId = experimentArtifactRouteId(route);

  return readCachedExperimentArtifact(
    cachedExperimentShells,
    artifactRouteId,
    () => readGeneratedExperimentShell(artifactRouteId),
  );
}

export function loadGeneratedExperimentProtocolTab(
  experimentId: string,
): HealthCommonsWebExperimentProtocolTab | null {
  const route = resolveGeneratedExperimentRoute(experimentId);
  if (!route) {
    return null;
  }
  const artifactRouteId = experimentArtifactRouteId(route);

  return readCachedExperimentArtifact(
    cachedExperimentProtocolTabs,
    artifactRouteId,
    () => readGeneratedExperimentProtocolTab(artifactRouteId),
  );
}

export function loadGeneratedExperimentResearchTab(
  experimentId: string,
): GeneratedExperimentResearchTab | null {
  const route = resolveGeneratedExperimentRoute(experimentId);
  if (!route) {
    return null;
  }
  const artifactRouteId = experimentArtifactRouteId(route);

  return readCachedExperimentArtifact(
    cachedExperimentResearchTabs,
    artifactRouteId,
    () => readGeneratedExperimentResearchTab(artifactRouteId),
  );
}

export function loadGeneratedExperimentResultsPublic(
  experimentId: string,
): HealthCommonsWebExperimentResultsPublic | null {
  const route = resolveGeneratedExperimentRoute(experimentId);
  if (!route) {
    return null;
  }
  const artifactRouteId = experimentArtifactRouteId(route);

  return readCachedExperimentArtifact(
    cachedExperimentResultsPublic,
    artifactRouteId,
    () => readGeneratedExperimentResultsPublic(artifactRouteId),
  );
}

function readCachedExperimentArtifact<T>(
  cache: Map<string, T | null>,
  routeId: string,
  readArtifact: () => T | null,
): T | null {
  if (cache.has(routeId)) {
    return cache.get(routeId) ?? null;
  }

  const artifact = readArtifact();
  cache.set(routeId, artifact);
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
  cachedRouteIndex ??= readGeneratedRouteIndex();
  return cachedRouteIndex;
}

function experimentArtifactRouteId(route: GeneratedRouteIndexEntry): string {
  return path.basename(route.bundlePath, ".json");
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

function readGeneratedExperimentShell(
  routeId: string,
): HealthCommonsWebExperimentShell | null {
  const parsed = readOptionalJsonObjectFromCandidates([
    path.join(process.cwd(), "packages/health-commons/generated/web/shell/experiments", `${routeId}.json`),
    path.join(process.cwd(), "../packages/health-commons/generated/web/shell/experiments", `${routeId}.json`),
    path.join(process.cwd(), "../../packages/health-commons/generated/web/shell/experiments", `${routeId}.json`),
  ]);
  if (!parsed) {
    return null;
  }

  assertGeneratedExperimentShell(parsed);
  return parsed;
}

function readGeneratedExperimentProtocolTab(
  routeId: string,
): HealthCommonsWebExperimentProtocolTab | null {
  const parsed = readOptionalJsonObjectFromCandidates([
    path.join(process.cwd(), "packages/health-commons/generated/web/tabs/experiments", routeId, "protocol.json"),
    path.join(process.cwd(), "../packages/health-commons/generated/web/tabs/experiments", routeId, "protocol.json"),
    path.join(process.cwd(), "../../packages/health-commons/generated/web/tabs/experiments", routeId, "protocol.json"),
  ]);
  if (!parsed) {
    return null;
  }

  assertGeneratedExperimentProtocolTab(parsed);
  return parsed;
}

function readGeneratedExperimentResearchTab(
  routeId: string,
): GeneratedExperimentResearchTab | null {
  const parsed = readOptionalJsonObjectFromCandidates([
    path.join(process.cwd(), "packages/health-commons/generated/web/tabs/experiments", routeId, "research.json"),
    path.join(process.cwd(), "../packages/health-commons/generated/web/tabs/experiments", routeId, "research.json"),
    path.join(process.cwd(), "../../packages/health-commons/generated/web/tabs/experiments", routeId, "research.json"),
  ]);
  if (!parsed) {
    return null;
  }

  assertGeneratedExperimentResearchTab(parsed);
  return parsed;
}

function readGeneratedExperimentResultsPublic(
  routeId: string,
): HealthCommonsWebExperimentResultsPublic | null {
  const parsed = readOptionalJsonObjectFromCandidates([
    path.join(process.cwd(), "packages/health-commons/generated/web/tabs/experiments", routeId, "results-public.json"),
    path.join(process.cwd(), "../packages/health-commons/generated/web/tabs/experiments", routeId, "results-public.json"),
    path.join(process.cwd(), "../../packages/health-commons/generated/web/tabs/experiments", routeId, "results-public.json"),
  ]);
  if (!parsed) {
    return null;
  }

  assertGeneratedExperimentResultsPublic(parsed);
  return parsed;
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
