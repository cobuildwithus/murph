import {
  experimentFrontmatterSchema,
  safeParseContract,
  type ExperimentFrontmatter,
} from "@murphai/contracts";

import {
  isActiveOverviewExperimentStatus,
  isCompletedOverviewExperimentStatus,
} from "../overview-status.ts";
import type {
  OverviewExperiment,
  OverviewExperimentSummary,
} from "../overview.ts";
import {
  TRACKED_EXPERIMENT_LIMIT,
  type BrowserVaultCoreCapableQueryClient,
  type BrowserVaultEntity,
} from "./shared.ts";

export function selectBrowserVaultTrackedExperiments(client: BrowserVaultCoreCapableQueryClient): OverviewExperiment[] {
  return listPrioritizedBrowserVaultExperimentEntities(client)
    .slice(0, TRACKED_EXPERIMENT_LIMIT)
    .map(toOverviewExperiment);
}

export function selectBrowserVaultExperimentSummary(client: BrowserVaultCoreCapableQueryClient): OverviewExperimentSummary {
  const experiments = listPrioritizedBrowserVaultExperimentEntities(client);
  const activeExperiments = experiments
    .filter((entry) => isActiveOverviewExperimentStatus(entry.status))
    .map(toOverviewExperiment);
  const completedExperiments = experiments
    .filter((entry) => isCompletedOverviewExperimentStatus(entry.status))
    .map(toOverviewExperiment);

  return {
    activeCount: activeExperiments.length,
    activePreview: activeExperiments.slice(0, 4),
    completedCount: completedExperiments.length,
    latestCompleted: completedExperiments[0] ?? null,
  };
}

function listPrioritizedBrowserVaultExperimentEntities(client: BrowserVaultCoreCapableQueryClient): BrowserVaultEntity[] {
  const sortedExperiments = client.replica.entities
    .filter((entry) => entry.family === "experiment")
    .sort((left, right) => compareLatestStrings(right.occurredAt ?? right.date, left.occurredAt ?? left.date));

  return [
    ...sortedExperiments.filter((entry) => isActiveOverviewExperimentStatus(entry.status)),
    ...sortedExperiments.filter((entry) => !isActiveOverviewExperimentStatus(entry.status)),
  ];
}

type QueryOverviewExperimentFrontmatter = ExperimentFrontmatter;

function toOverviewExperiment(entry: BrowserVaultEntity): OverviewExperiment {
  const frontmatter = readExperimentFrontmatter(entry);

  return {
    analysisPlan: frontmatter?.analysisPlan ?? null,
    assistantSupport: frontmatter?.assistantSupport ?? null,
    commonsProtocolRef: frontmatter?.commonsProtocolRef ?? null,
    effectiveProtocolSnapshot: frontmatter?.effectiveProtocolSnapshot ?? null,
    id: entry.id,
    onboarding: frontmatter?.onboarding ?? null,
    outcome: frontmatter?.outcome ?? null,
    outcomeRef: frontmatter?.outcomeRef ?? null,
    protocolRef: frontmatter?.protocolRef ?? null,
    runPlan: frontmatter?.runPlan ?? null,
    slug: entry.experimentSlug,
    startedOn: entry.date ?? extractDate(entry.occurredAt),
    status: entry.status ?? null,
    summary: summarizeText(entry.bodyPreview),
    tags: compactStrings(entry.tags),
    title: entry.title ?? entry.id,
  };
}

function readExperimentFrontmatter(entry: BrowserVaultEntity): QueryOverviewExperimentFrontmatter | null {
  const result = safeParseContract(experimentFrontmatterSchema, entry.attributes);
  if (!result.success) {
    return null;
  }

  return result.data;
}

function summarizeText(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !/^#{1,6}\s+/u.test(line))
    .map((line) => line.replace(/^[-*+]\s+/u, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");

  if (!normalized) {
    return null;
  }

  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
}

function compactStrings(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function compareLatestStrings(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return (left ?? "").localeCompare(right ?? "");
}

function extractDate(value: string | null | undefined): string {
  return extractDatePrefix(value) ?? "Undated";
}

function extractDatePrefix(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})/u);
  return match?.[1] ?? null;
}
