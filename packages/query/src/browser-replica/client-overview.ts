import type { OverviewJournalEntry, OverviewMetric } from "../overview.ts";
import {
  RECENT_JOURNAL_LIMIT,
  TIMELINE_LIMIT,
  type BrowserVaultEntity,
  type BrowserVaultOverviewView,
  type BrowserVaultQueryClient,
  type BrowserVaultTimelineRow,
} from "./shared.ts";
import {
  selectBrowserVaultExperimentSummary,
  selectBrowserVaultTrackedExperiments,
} from "./tracked-experiments.ts";
import { emptyPersonalPatternReport } from "../personal-patterns.ts";

export function selectBrowserVaultOverview(client: BrowserVaultQueryClient): BrowserVaultOverviewView {
  return {
    experimentSummary: selectBrowserVaultExperimentSummary(client),
    metrics: buildBrowserOverviewMetrics(client),
    personalPatterns: client.replica.personalPatterns
      ?? emptyPersonalPatternReport(client.replica.generatedAt.slice(0, 10)),
    recentJournals: summarizeRecentBrowserOverviewJournals(client, RECENT_JOURNAL_LIMIT),
    trackedExperiments: selectBrowserVaultTrackedExperiments(client),
    weeklySampleSummaries: client.replica.weeklySampleSummaries.slice(),
  };
}

export function selectBrowserVaultHistory(client: BrowserVaultQueryClient): { timeline: BrowserVaultTimelineRow[] } {
  return { timeline: client.timeline.list().slice(0, TIMELINE_LIMIT) };
}

function buildBrowserOverviewMetrics(client: BrowserVaultQueryClient): OverviewMetric[] {
  const familyCounts = countEntityFamilies(client.replica.entities);
  const registryCount =
    readFamilyCount(familyCounts, "goal") +
    readFamilyCount(familyCounts, "condition") +
    readFamilyCount(familyCounts, "allergy") +
    readFamilyCount(familyCounts, "regimen") +
    readFamilyCount(familyCounts, "family") +
    readFamilyCount(familyCounts, "genetics");

  return [
    {
      label: "entities",
      note: "Canonical read model rows",
      value: client.replica.entities.length,
    },
    {
      label: "events",
      note: "Ledger event entries",
      value: readFamilyCount(familyCounts, "event"),
    },
    {
      label: "samples",
      note: "Recorded measurements",
      value: readFamilyCount(familyCounts, "sample"),
    },
    {
      label: "journal days",
      note: "Human review pages",
      value: readFamilyCount(familyCounts, "journal"),
    },
    {
      label: "experiments",
      note: "Tracked investigations",
      value: readFamilyCount(familyCounts, "experiment"),
    },
    {
      label: "registries",
      note: "Goals, conditions, family, genetics",
      value: registryCount,
    },
  ];
}

function summarizeRecentBrowserOverviewJournals(
  client: BrowserVaultQueryClient,
  limit: number,
): OverviewJournalEntry[] {
  return client.replica.entities
    .filter((entry) => entry.family === "journal")
    .sort((left, right) => compareLatestStrings(right.date ?? right.occurredAt, left.date ?? left.occurredAt))
    .slice(0, normalizeLimit(limit, RECENT_JOURNAL_LIMIT))
    .map((entry) => ({
      date: entry.date ?? extractDate(entry.occurredAt),
      id: entry.id,
      summary: summarizeText(entry.bodyPreview),
      tags: compactStrings(entry.tags),
      title: entry.title ?? entry.id,
    }));
}

function countEntityFamilies(entities: readonly BrowserVaultEntity[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    counts.set(entity.family, (counts.get(entity.family) ?? 0) + 1);
  }
  return counts;
}

function readFamilyCount(counts: ReadonlyMap<string, number>, family: string): number {
  return counts.get(family) ?? 0;
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

function normalizeLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.trunc(value));
}
