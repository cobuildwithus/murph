import { access, stat } from "node:fs/promises";
import path from "node:path";

import { normalizeIanaTimeZone } from "@murph/contracts";
import {
  buildOverviewMetrics,
  buildOverviewWeeklyStats,
  buildTimeline,
  readVaultTolerant,
  searchVaultSafe,
  summarizeCurrentOverviewProfile,
  summarizeDailySamples,
  summarizeOverviewExperiments,
  summarizeRecentOverviewJournals,
  type OverviewExperiment as QueryOverviewExperiment,
  type OverviewGoal as QueryOverviewGoal,
  type OverviewJournalEntry as QueryOverviewJournalEntry,
  type OverviewMetric as QueryOverviewMetric,
  type OverviewProfile as QueryOverviewProfile,
  type OverviewWeeklyStat as QueryOverviewWeeklyStat,
  type SafeSearchHit,
  type SafeSearchResult,
} from "@murph/query";

import {
  VAULT_ENV,
} from "./vault";

type TimelineItem = ReturnType<typeof buildTimeline>[number];

export const DEFAULT_SAMPLE_LIMIT = 6;
export const DEFAULT_TIMELINE_LIMIT = 8;
const DEFAULT_SEARCH_LIMIT = 6;

export type OverviewMetric = QueryOverviewMetric;
export type OverviewProfile = QueryOverviewProfile;
export type OverviewGoal = QueryOverviewGoal;
export type OverviewJournalEntry = QueryOverviewJournalEntry;
export type OverviewExperiment = QueryOverviewExperiment;
export type OverviewWeeklyStat = QueryOverviewWeeklyStat;

export interface OverviewSampleSummary {
  averageValue: number | null;
  date: string;
  sampleCount: number;
  stream: string;
  unit: string | null;
}

export interface OverviewTimelineEntry {
  entryType: TimelineItem["entryType"];
  id: string;
  kind: string | null;
  occurredAt: string;
  stream: string | null;
  timeZone: string | null;
  title: string;
}

export interface OverviewSearchResult {
  hits: OverviewSearchHit[];
  query: string;
  total: number;
}

export type OverviewSearchHit = Pick<
  SafeSearchHit,
  "date" | "kind" | "recordId" | "recordType" | "snippet" | "title"
>;

export interface ReadyOverview {
  currentProfile: OverviewProfile | null;
  experiments: OverviewExperiment[];
  generatedAt: string;
  metrics: OverviewMetric[];
  recentJournals: OverviewJournalEntry[];
  sampleSummaries: OverviewSampleSummary[];
  search: OverviewSearchResult | null;
  status: "ready";
  timeZone: string;
  timeline: OverviewTimelineEntry[];
  weeklyStats: OverviewWeeklyStat[];
}

export interface MissingConfigOverview {
  envVar: typeof VAULT_ENV;
  exampleVaultPath: string;
  status: "missing-config";
  suggestedCommand: string;
}

export interface ErrorOverview {
  envVar: typeof VAULT_ENV;
  hint: string;
  message: string;
  recoveryCommand: string;
  status: "error";
}

export type OverviewResult = ReadyOverview | MissingConfigOverview | ErrorOverview;

export interface LoadVaultOverviewOptions {
  query?: string;
  sampleLimit?: number;
  timelineLimit?: number;
  vaultRoot?: string | null;
}

export function normalizeOverviewQuery(
  value: string | string[] | null | undefined,
): string {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0].trim() : "";
  }

  return typeof value === "string" ? value.trim() : "";
}

export function overviewResultToHttpStatus(result: OverviewResult): number {
  if (result.status === "ready") {
    return 200;
  }

  return result.status === "missing-config" ? 503 : 500;
}

export async function loadVaultOverviewFromEnv(
  options: Omit<LoadVaultOverviewOptions, "vaultRoot"> = {},
): Promise<OverviewResult> {
  const { resolveConfiguredVaultRoot } = await import("./vault-config");

  return loadVaultOverview({
    ...options,
    vaultRoot: await resolveConfiguredVaultRoot(),
  });
}

export async function loadVaultOverview(
  options: LoadVaultOverviewOptions = {},
): Promise<OverviewResult> {
  const vaultRoot = options.vaultRoot ?? null;

  if (!vaultRoot) {
    const guidance = await loadOverviewGuidance();
    return {
      envVar: VAULT_ENV,
      exampleVaultPath: guidance.exampleVaultPath,
      status: "missing-config",
      suggestedCommand: guidance.suggestedCommand,
    };
  }

  try {
    await assertVaultRootReadable(vaultRoot);
    const vault = await readVaultTolerant(vaultRoot);
    const timelineLimit = clampLimit(options.timelineLimit, DEFAULT_TIMELINE_LIMIT, 16);
    const sampleLimit = clampLimit(options.sampleLimit, DEFAULT_SAMPLE_LIMIT, 12);
    const query = normalizeOverviewQuery(options.query);
    const rawTimeZone =
      vault.metadata && typeof vault.metadata === "object" && "timezone" in vault.metadata
        ? (vault.metadata as { timezone?: unknown }).timezone
        : undefined;
    const timeZone = normalizeIanaTimeZone(
      typeof rawTimeZone === "string" ? rawTimeZone : undefined,
    ) ?? "UTC";

    return {
      currentProfile: summarizeCurrentOverviewProfile(vault),
      experiments: summarizeOverviewExperiments(vault),
      generatedAt: new Date().toISOString(),
      metrics: buildOverviewMetrics(vault),
      recentJournals: summarizeRecentOverviewJournals(vault),
      sampleSummaries: summarizeDailySamples(vault)
        .slice(-sampleLimit)
        .reverse()
        .map((summary) => ({
          averageValue: summary.averageValue,
          date: summary.date,
          sampleCount: summary.sampleCount,
          stream: summary.stream,
          unit: summary.unit,
        })),
      search:
        query.length > 0
          ? mapSafeSearchResult(
              searchVaultSafe(vault, query, {
                includeSamples: true,
                limit: DEFAULT_SEARCH_LIMIT,
              }),
            )
          : null,
      status: "ready",
      timeZone,
      weeklyStats: buildOverviewWeeklyStats(vault, timeZone),
      timeline: buildTimeline(vault, {
        includeDailySampleSummaries: true,
        includeProfileSnapshots: true,
        limit: timelineLimit,
      }).map((entry) => toOverviewTimelineEntry(entry, timeZone)),
    };
  } catch {
    const guidance = await loadOverviewGuidance();
    return {
      envVar: VAULT_ENV,
      hint: "Confirm the configured vault path points at a Murph vault root, then restart the local app.",
      message: "The configured vault could not be read.",
      recoveryCommand: guidance.suggestedCommand,
      status: "error",
    };
  }
}

async function loadOverviewGuidance(): Promise<{
  exampleVaultPath: string;
  suggestedCommand: string;
}> {
  const { buildExampleVaultPath, buildSuggestedCommand } = await import("./vault-launch");

  return {
    exampleVaultPath: buildExampleVaultPath(),
    suggestedCommand: buildSuggestedCommand(),
  };
}

function mapSafeSearchResult(result: SafeSearchResult): OverviewSearchResult {
  return {
    hits: result.hits.map((hit) => ({
      date: hit.date,
      kind: hit.kind,
      recordId: hit.recordId,
      recordType: hit.recordType,
      snippet: hit.snippet,
      title: hit.title,
    })),
    query: result.query,
    total: result.total,
  };
}

function toOverviewTimelineEntry(
  entry: TimelineItem,
  defaultTimeZone: string,
): OverviewTimelineEntry {
  const rawTimeZone = isRecord(entry.data) ? getRecordField(entry.data, "timeZone") : undefined;

  return {
    entryType: entry.entryType,
    id: entry.id,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    stream: entry.stream,
    timeZone:
      typeof rawTimeZone === "string" && rawTimeZone.trim().length > 0
        ? rawTimeZone
        : defaultTimeZone,
    title: entry.title,
  };
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.trunc(value), max));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getRecordField(record: unknown, key: string): unknown {
  if (!isRecord(record)) {
    return undefined;
  }

  return record[key];
}

async function assertVaultRootReadable(vaultRoot: string): Promise<void> {
  const rootStats = await stat(vaultRoot);
  if (!rootStats.isDirectory()) {
    throw new Error("Vault root is not a directory.");
  }

  const hasVaultJson = await pathExists(path.join(vaultRoot, "vault.json"));
  const hasCoreDocument = await pathExists(path.join(vaultRoot, "CORE.md"));
  if (!hasVaultJson && !hasCoreDocument) {
    throw new Error("Vault root markers are missing.");
  }
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}
