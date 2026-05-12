import {
  experimentFrontmatterSchema,
  safeParseContract,
  type ExperimentFrontmatter,
} from "@murphai/contracts";

import type { VaultReadModel } from "./read-model.ts";
import { summarizeDailySamples, type DailySampleSummary } from "./summaries.ts";
import { isActiveOverviewExperimentStatus } from "./overview-status.ts";
import {
  buildOverviewWeeklyStatsFromDailySampleSummaries,
  type OverviewWeeklySampleSummary,
  type OverviewWeeklyStat,
} from "./overview-weekly-stats.ts";

export { isActiveOverviewExperimentStatus } from "./overview-status.ts";
export { buildOverviewWeeklyStatsFromDailySampleSummaries } from "./overview-weekly-stats.ts";
export type { OverviewWeeklySampleSummary, OverviewWeeklyStat } from "./overview-weekly-stats.ts";

export interface OverviewMetric {
  label: string;
  note: string;
  value: number;
}

export interface OverviewJournalEntry {
  date: string;
  id: string;
  summary: string | null;
  tags: string[];
  title: string;
}

export interface OverviewExperiment {
  analysisPlan: ExperimentFrontmatter["analysisPlan"] | null;
  assistantSupport: ExperimentFrontmatter["assistantSupport"] | null;
  commonsProtocolRef: ExperimentFrontmatter["commonsProtocolRef"] | null;
  effectiveProtocolSnapshot: ExperimentFrontmatter["effectiveProtocolSnapshot"] | null;
  id: string;
  onboarding: ExperimentFrontmatter["onboarding"] | null;
  outcome: ExperimentFrontmatter["outcome"] | null;
  outcomeRef: ExperimentFrontmatter["outcomeRef"] | null;
  protocolRef: ExperimentFrontmatter["protocolRef"] | null;
  runPlan: ExperimentFrontmatter["runPlan"] | null;
  slug: string | null;
  startedOn: string | null;
  status: string | null;
  summary: string | null;
  tags: string[];
  title: string;
}

export function buildOverviewMetrics(vault: VaultReadModel): OverviewMetric[] {
  const registryCount =
    vault.goals.length +
    vault.conditions.length +
    vault.allergies.length +
    vault.regimens.length +
    vault.familyMembers.length +
    vault.geneticVariants.length;

  return [
    {
      label: "entities",
      note: "Canonical read model rows",
      value: vault.entities.length,
    },
    {
      label: "events",
      note: "Ledger event entries",
      value: vault.events.length,
    },
    {
      label: "samples",
      note: "Recorded measurements",
      value: vault.samples.length,
    },
    {
      label: "journal days",
      note: "Human review pages",
      value: vault.journalEntries.length,
    },
    {
      label: "experiments",
      note: "Tracked investigations",
      value: vault.experiments.length,
    },
    {
      label: "registries",
      note: "Goals, conditions, family, genetics",
      value: registryCount,
    },
  ];
}

export function summarizeRecentOverviewJournals(
  vault: VaultReadModel,
  limit = 3,
): OverviewJournalEntry[] {
  return [...vault.journalEntries]
    .sort((left, right) =>
      compareLatestStrings(right.date ?? right.occurredAt, left.date ?? left.occurredAt),
    )
    .slice(0, normalizeLimit(limit, 3))
    .map((entry) => ({
      date: entry.date ?? extractDate(entry.occurredAt),
      id: entry.entityId,
      summary: summarizeText(entry.body),
      tags: compactStrings(entry.tags),
      title: entry.title ?? entry.entityId,
    }));
}

export function buildOverviewWeeklyStats(
  vault: VaultReadModel,
  timeZone: string,
  referenceDate: Date | string = new Date(),
): OverviewWeeklyStat[] {
  return buildOverviewWeeklyStatsFromDailySampleSummaries(
    summarizeDailySamples(vault),
    timeZone,
    referenceDate,
  );
}

export function summarizeOverviewExperiments(
  vault: VaultReadModel,
  limit = 6,
): OverviewExperiment[] {
  const sortedExperiments = [...vault.experiments].sort((left, right) =>
    compareLatestStrings(right.occurredAt ?? right.date, left.occurredAt ?? left.date),
  );
  const prioritizedExperiments = [
    ...sortedExperiments.filter((entry) => isActiveOverviewExperimentStatus(entry.status)),
    ...sortedExperiments.filter((entry) => !isActiveOverviewExperimentStatus(entry.status)),
  ];

  return prioritizedExperiments.slice(0, normalizeLimit(limit, 6)).map((entry) => {
    const frontmatter = readExperimentFrontmatter(entry);

    return {
      analysisPlan: frontmatter?.analysisPlan ?? null,
      assistantSupport: frontmatter?.assistantSupport ?? null,
      commonsProtocolRef: frontmatter?.commonsProtocolRef ?? null,
      effectiveProtocolSnapshot: frontmatter?.effectiveProtocolSnapshot ?? null,
      id: entry.entityId,
      onboarding: frontmatter?.onboarding ?? null,
      outcome: frontmatter?.outcome ?? null,
      outcomeRef: frontmatter?.outcomeRef ?? null,
      protocolRef: frontmatter?.protocolRef ?? null,
      runPlan: frontmatter?.runPlan ?? null,
      slug: entry.experimentSlug,
      startedOn: entry.date ?? extractDate(entry.occurredAt),
      status: entry.status ?? null,
      summary: summarizeText(entry.body),
      tags: compactStrings(entry.tags),
      title: entry.title ?? entry.entityId,
    };
  });
}

type QueryOverviewExperimentFrontmatter = ExperimentFrontmatter;

function readExperimentFrontmatter(
  entry: VaultReadModel["experiments"][number],
): QueryOverviewExperimentFrontmatter | null {
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
  return extractOverviewDatePrefix(value) ?? "Undated";
}

function normalizeLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.trunc(value));
}

function extractOverviewDatePrefix(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})/u);
  return match?.[1] ?? null;
}
