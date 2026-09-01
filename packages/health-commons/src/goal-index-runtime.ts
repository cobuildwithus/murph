import {
  commonsGoalRefSchema,
  healthCommonsGoalTemplateSchema,
  healthCommonsSafetySchema,
} from "@murphai/contracts";

import { isPublicHealthCommonsGoalSourceUrl } from "./goal-sources.ts";
import {
  readGeneratedWebArtifact,
  type LoadGeneratedHealthCommonsWebArtifactOptions,
} from "./runtime-paths.ts";
import {
  HEALTH_COMMONS_WEB_GOAL_INDEX_SCHEMA_VERSION,
  type HealthCommonsWebGoalIndex,
} from "./web-artifacts.ts";

export type {
  LoadGeneratedHealthCommonsWebArtifactOptions,
} from "./runtime-paths.ts";
export type {
  HealthCommonsWebGoalIndex,
  HealthCommonsWebGoalIndexEntry,
  HealthCommonsWebGoalRevisionRef,
} from "./web-artifacts.ts";

let cachedGeneratedWebGoalIndex: HealthCommonsWebGoalIndex | null = null;

export function loadGeneratedHealthCommonsWebGoalIndex(
  options: LoadGeneratedHealthCommonsWebArtifactOptions = {},
): HealthCommonsWebGoalIndex {
  const raw = readGeneratedWebArtifact("browse/goals.json", options.generatedWebRoot);
  const parsed = parseJsonObject(raw);
  assertGeneratedWebGoalIndex(parsed);
  return parsed;
}

export function getGeneratedHealthCommonsWebGoalIndex(
  options: LoadGeneratedHealthCommonsWebArtifactOptions = {},
): HealthCommonsWebGoalIndex {
  if (options.generatedWebRoot) {
    return loadGeneratedHealthCommonsWebGoalIndex(options);
  }

  cachedGeneratedWebGoalIndex ??= loadGeneratedHealthCommonsWebGoalIndex();
  return cachedGeneratedWebGoalIndex;
}

function assertGeneratedWebGoalIndex(
  value: unknown,
): asserts value is HealthCommonsWebGoalIndex {
  if (
    !isRecord(value)
    || value["schemaVersion"] !== HEALTH_COMMONS_WEB_GOAL_INDEX_SCHEMA_VERSION
    || typeof value["catalogHash"] !== "string"
    || !Array.isArray(value["goals"])
    || !value["goals"].every(isGeneratedWebGoalIndexEntry)
  ) {
    throw new Error("Health Commons generated goal index is invalid.");
  }
}

function isGeneratedWebGoalIndexEntry(value: unknown): boolean {
  if (!isRecord(value) || typeof value["key"] !== "string") {
    return false;
  }

  const parentGoalKey = value["parentGoalKey"];
  const goal = {
    category: value["category"],
    evidenceSourceKeys: ["source_artifact:runtime-validation-only"],
    goalPhrase: value["goalPhrase"],
    indexable: true,
    outcomeKind: value["outcomeKind"],
    ...(typeof parentGoalKey === "string" ? { parentGoalKey } : {}),
    startPrompt: value["startPrompt"],
    successSignals: value["successSignals"],
    workflow: value["workflow"],
  };

  return Array.isArray(value["aliases"])
    && value["aliases"].every(isString)
    && typeof value["routeId"] === "string"
    && value["bundlePath"] === `bundles/goal_template/${value["routeId"]}.json`
    && value["pagePath"] === `pages/goals/${value["routeId"]}.json`
    && (parentGoalKey === null || typeof parentGoalKey === "string")
    && typeof value["quality"] === "string"
    && isGeneratedWebGoalRevision(value["key"], value["revision"])
    && healthCommonsSafetySchema.safeParse({ cautionLevel: value["safetyTier"] }).success
    && typeof value["slug"] === "string"
    && typeof value["status"] === "string"
    && isGeneratedWebGoalSources(value["sources"])
    && typeof value["summary"] === "string"
    && typeof value["title"] === "string"
    && healthCommonsGoalTemplateSchema.safeParse(goal).success;
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
