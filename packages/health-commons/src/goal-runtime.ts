import {
  commonsGoalRefSchema,
  healthCommonsGoalTemplateSchema,
  healthCommonsSafetySchema,
} from "@murphai/contracts";

import { isPublicHealthCommonsGoalSourceUrl } from "./goal-sources.ts";
import { readGeneratedWebArtifact } from "./runtime-paths.ts";
import {
  getGeneratedHealthCommonsWebRouteIndex,
  normalizeHealthCommonsWebRouteId,
} from "./web-route-runtime.ts";
import {
  HEALTH_COMMONS_WEB_GOAL_PAGE_SCHEMA_VERSION,
  type HealthCommonsWebGoalPage,
  type HealthCommonsWebRouteIndexEntry,
} from "./web-artifacts.ts";

export type { HealthCommonsGoalSource } from "./goal-sources.ts";
export {
  getGeneratedHealthCommonsWebGoalIndex,
  loadGeneratedHealthCommonsWebGoalIndex,
} from "./goal-index-runtime.ts";
export type {
  HealthCommonsWebGoalIndex,
  HealthCommonsWebGoalIndexEntry,
  HealthCommonsWebGoalRevisionRef,
  LoadGeneratedHealthCommonsWebArtifactOptions,
} from "./goal-index-runtime.ts";
export type {
  HealthCommonsWebGoalPage,
} from "./web-artifacts.ts";

const cachedGeneratedWebGoalPages = new Map<string, HealthCommonsWebGoalPage>();

export function loadGeneratedHealthCommonsWebGoalPage(input: {
  generatedWebRoot?: string | URL;
  routeId: string;
}): HealthCommonsWebGoalPage | null {
  const routeIndex = getGeneratedHealthCommonsWebRouteIndex({
    generatedWebRoot: input.generatedWebRoot,
  });
  const normalizedRouteId = normalizeHealthCommonsWebRouteId(input.routeId);
  const route = routeIndex.routes.find((entry) =>
    entry.entityType === "goal_template" && entry.routeId === normalizedRouteId
  );

  if (!route) {
    return null;
  }

  const canonicalRouteId = canonicalGoalRouteId(route);
  if (!canonicalRouteId) {
    return null;
  }

  const artifactPath = `pages/goals/${canonicalRouteId}.json`;
  const cacheKey = `${routeIndex.catalogHash}:${artifactPath}`;
  if (!input.generatedWebRoot) {
    const cachedPage = cachedGeneratedWebGoalPages.get(cacheKey);
    if (cachedPage) {
      return cachedPage;
    }
  }

  const raw = readGeneratedWebArtifact(artifactPath, input.generatedWebRoot);
  const page = parseJsonObject(raw);
  assertGeneratedWebGoalPage(page, artifactPath);

  if (
    page.catalogHash !== routeIndex.catalogHash
    || page.key !== route.key
    || page.route.entityType !== "goal_template"
    || page.route.routeId !== canonicalRouteId
  ) {
    throw new Error(`Health Commons generated goal page does not match its route: ${artifactPath}.`);
  }

  if (!input.generatedWebRoot) {
    cachedGeneratedWebGoalPages.set(cacheKey, page);
  }

  return page;
}

function canonicalGoalRouteId(route: HealthCommonsWebRouteIndexEntry): string | null {
  const artifactPath = route.projections?.["goal.page"];
  if (!artifactPath) {
    return null;
  }

  const match = /^pages\/goals\/([^/]+)\.json$/u.exec(artifactPath);
  if (!match?.[1]) {
    throw new Error(`Unexpected Health Commons generated goal page path: ${artifactPath}.`);
  }

  const canonicalRouteId = match[1];
  const expectedBundlePath = `bundles/goal_template/${canonicalRouteId}.json`;
  if (route.bundlePath !== expectedBundlePath) {
    throw new Error(
      `Health Commons generated goal page path does not match route bundle id: ${artifactPath}.`,
    );
  }

  return canonicalRouteId;
}

function assertGeneratedWebGoalPage(
  value: unknown,
  artifactPath: string,
): asserts value is HealthCommonsWebGoalPage {
  if (
    !isRecord(value)
    || value["schemaVersion"] !== HEALTH_COMMONS_WEB_GOAL_PAGE_SCHEMA_VERSION
    || !Array.isArray(value["aliases"])
    || !value["aliases"].every(isString)
    || typeof value["body"] !== "string"
    || typeof value["catalogHash"] !== "string"
    || !isGeneratedWebGoalTemplate(value["goal"])
    || typeof value["key"] !== "string"
    || !isGeneratedWebGoalRevision(value["key"], value["revision"])
    || !isGeneratedWebGoalRoute(value["route"])
    || !healthCommonsSafetySchema.safeParse(value["safety"]).success
    || !isGeneratedWebGoalSources(value["sources"])
    || typeof value["summary"] !== "string"
    || typeof value["title"] !== "string"
  ) {
    throw new Error(`Health Commons generated web goal page is invalid: ${artifactPath}.`);
  }
}

function isGeneratedWebGoalTemplate(value: unknown): boolean {
  if (!isRecord(value) || Object.hasOwn(value, "evidenceSourceKeys")) {
    return false;
  }

  return healthCommonsGoalTemplateSchema.safeParse({
    ...value,
    evidenceSourceKeys: ["source_artifact:runtime-validation-only"],
  }).success;
}

function isGeneratedWebGoalRevision(key: string, value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return commonsGoalRefSchema.safeParse({
    key,
    pageRevisionId: value["pageRevisionId"],
    workflowSpecRevisionId: value["workflowSpecRevisionId"],
  }).success;
}

function isGeneratedWebGoalRoute(value: unknown): value is HealthCommonsWebGoalPage["route"] {
  return isRecord(value)
    && Array.isArray(value["aliases"])
    && value["aliases"].every(isString)
    && value["entityType"] === "goal_template"
    && typeof value["routeId"] === "string"
    && typeof value["slug"] === "string";
}

function isGeneratedWebGoalSources(value: unknown): boolean {
  return Array.isArray(value)
    && value.length >= 2
    && value.every((source) =>
      isRecord(source)
      && typeof source["label"] === "string"
      && source["label"].trim().length > 0
      && typeof source["url"] === "string"
      && isPublicHealthCommonsGoalSourceUrl(source["url"])
    );
}

function parseJsonObject(raw: string): unknown {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Health Commons generated artifact must be a JSON object.");
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
