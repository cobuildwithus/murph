import { access, stat } from "node:fs/promises";
import path from "node:path";

import {
  addDaysToIsoDate,
  extractIsoDatePrefix,
  formatTimeZoneDateTimeParts,
  normalizeIanaTimeZone,
} from "@murph/contracts";
import {
  scoreSearchDocuments,
  type SearchableDocument,
} from "@murph/query/search";
import {
  buildTimeline,
  readVaultTolerant,
  summarizeDailySamples,
} from "@murph/query";

import {
  buildExampleVaultPath,
  buildSuggestedCommand,
  VAULT_ENV,
  resolveConfiguredVaultRoot,
} from "./vault";

type VaultReadModel = Awaited<ReturnType<typeof readVaultTolerant>>;
type VaultRecordModel = VaultReadModel["records"][number];
type TimelineItem = ReturnType<typeof buildTimeline>[number];

export const DEFAULT_SAMPLE_LIMIT = 6;
export const DEFAULT_TIMELINE_LIMIT = 8;
const DEFAULT_SEARCH_LIMIT = 6;

export interface OverviewMetric {
  label: string;
  note: string;
  value: number;
}

export interface OverviewProfile {
  id: string;
  recordedAt: string | null;
  summary: string | null;
  title: string;
  topGoals: OverviewGoal[];
}

export interface OverviewGoal {
  id: string;
  title: string;
}

export interface OverviewJournalEntry {
  date: string;
  id: string;
  summary: string | null;
  tags: string[];
  title: string;
}

export interface OverviewExperiment {
  id: string;
  slug: string | null;
  startedOn: string | null;
  status: string | null;
  summary: string | null;
  tags: string[];
  title: string;
}

export interface OverviewWeeklyStat {
  currentWeekAvg: number | null;
  deltaPercent: number | null;
  previousWeekAvg: number | null;
  stream: string;
  unit: string | null;
}

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

export interface OverviewSearchHit {
  date: string | null;
  kind: string | null;
  recordId: string;
  recordType: VaultRecordModel["recordType"];
  snippet: string;
  title: string | null;
}

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
    return {
      envVar: VAULT_ENV,
      exampleVaultPath: buildExampleVaultPath(),
      status: "missing-config",
      suggestedCommand: buildSuggestedCommand(),
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
      currentProfile: summarizeCurrentProfile(vault),
      experiments: summarizeExperiments(vault),
      generatedAt: new Date().toISOString(),
      metrics: buildMetrics(vault),
      recentJournals: summarizeRecentJournals(vault),
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
      search: query.length > 0 ? searchVaultSafely(vault, query) : null,
      status: "ready",
      timeZone,
      weeklyStats: buildWeeklyStats(vault, timeZone),
      timeline: buildTimeline(vault, {
        includeDailySampleSummaries: true,
        includeProfileSnapshots: true,
        limit: timelineLimit,
      }).map((entry) => toOverviewTimelineEntry(entry, timeZone)),
    };
  } catch {
    return {
      envVar: VAULT_ENV,
      hint: "Confirm the configured vault path points at a Murph vault root, then restart the local app.",
      message: "The configured vault could not be read.",
      recoveryCommand: buildSuggestedCommand(),
      status: "error",
    };
  }
}

function buildMetrics(vault: VaultReadModel): OverviewMetric[] {
  const registryCount =
    vault.goals.length +
    vault.conditions.length +
    vault.allergies.length +
    vault.protocols.length +
    vault.familyMembers.length +
    vault.geneticVariants.length;

  return [
    {
      label: "records",
      note: "Canonical read model rows",
      value: vault.records.length,
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

function summarizeCurrentProfile(vault: VaultReadModel): OverviewProfile | null {
  const current = vault.currentProfile;
  if (!current) {
    return null;
  }

  const currentData = isRecord(current.data) ? current.data : null;
  const currentProfileData = isRecord(getRecordField(currentData, "profile"))
    ? getRecordField(currentData, "profile")
    : null;
  const latestSnapshotProfile = isRecord(getRecordField(getLatestProfileSnapshot(vault)?.data, "profile"))
    ? getRecordField(getLatestProfileSnapshot(vault)?.data, "profile")
    : null;
  const topGoalIds = extractStringArray(
    getRecordField(currentData, "topGoalIds"),
    getRecordField(currentProfileData, "topGoalIds"),
    getRecordField(latestSnapshotProfile, "topGoalIds"),
  );

  return {
    id: current.displayId,
    recordedAt: current.occurredAt,
    summary: summarizeText(current.body),
    title: current.title ?? current.displayId,
    topGoals: resolveGoals(vault, topGoalIds),
  };
}

function summarizeRecentJournals(vault: VaultReadModel): OverviewJournalEntry[] {
  return [...vault.journalEntries]
    .sort((left, right) => compareLatestStrings(right.date ?? right.occurredAt, left.date ?? left.occurredAt))
    .slice(0, 3)
    .map((entry) => ({
      date: entry.date ?? extractDate(entry.occurredAt),
      id: entry.displayId,
      summary: summarizeText(entry.body),
      tags: compactStrings(entry.tags),
      title: entry.title ?? entry.displayId,
    }));
}

function buildWeeklyStats(vault: VaultReadModel, timeZone: string): OverviewWeeklyStat[] {
  const now = new Date();
  const todayStr = formatTimeZoneDateTimeParts(now, timeZone).dayKey;
  const dayOfWeek = formatTimeZoneDateTimeParts(now, timeZone).dayOfWeek;
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisWeekStart = addDaysToIsoDate(todayStr, -mondayOffset);
  const lastWeekStart = addDaysToIsoDate(thisWeekStart, -7);

  const thisWeekSamples = new Map<string, { stream: string; unit: string | null; values: number[] }>();
  const lastWeekSamples = new Map<string, { stream: string; unit: string | null; values: number[] }>();

  for (const sample of vault.samples) {
    const sampleDate = sample.date ?? extractDate(sample.occurredAt);
    const stream = sample.stream;
    const rawValue = sample.data?.value;
    const numericValue = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
    if (!stream || numericValue === null) continue;

    const rawUnit = sample.data?.unit;
    const unit = typeof rawUnit === "string" && rawUnit.trim() ? rawUnit.trim() : null;

    let bucket: Map<string, { stream: string; unit: string | null; values: number[] }> | null = null;
    if (sampleDate >= thisWeekStart && sampleDate <= todayStr) {
      bucket = thisWeekSamples;
    } else if (sampleDate >= lastWeekStart && sampleDate < thisWeekStart) {
      bucket = lastWeekSamples;
    }

    if (!bucket) continue;

    const key = buildWeeklyStatKey(stream, unit);
    const existing = bucket.get(key);
    if (existing) {
      existing.values.push(numericValue);
    } else {
      bucket.set(key, { stream, unit, values: [numericValue] });
    }
  }

  const allStreams = new Set([...thisWeekSamples.keys(), ...lastWeekSamples.keys()]);
  const stats: OverviewWeeklyStat[] = [];

  for (const key of allStreams) {
    const thisWeek = thisWeekSamples.get(key);
    const lastWeek = lastWeekSamples.get(key);
    const stream = thisWeek?.stream ?? lastWeek?.stream;

    if (!stream) {
      continue;
    }

    const currentAvg = thisWeek ? thisWeek.values.reduce((a, b) => a + b, 0) / thisWeek.values.length : null;
    const previousAvg = lastWeek ? lastWeek.values.reduce((a, b) => a + b, 0) / lastWeek.values.length : null;

    let deltaPercent: number | null = null;
    if (currentAvg !== null && previousAvg !== null && previousAvg !== 0) {
      deltaPercent = ((currentAvg - previousAvg) / Math.abs(previousAvg)) * 100;
    }

    stats.push({
      currentWeekAvg: currentAvg,
      deltaPercent,
      previousWeekAvg: previousAvg,
      stream,
      unit: thisWeek?.unit ?? lastWeek?.unit ?? null,
    });
  }

  return stats.sort((a, b) =>
    a.stream === b.stream
      ? (a.unit ?? "").localeCompare(b.unit ?? "")
      : a.stream.localeCompare(b.stream),
  );
}

function buildWeeklyStatKey(stream: string, unit: string | null): string {
  return `${stream}:${unit ?? ""}`;
}

function summarizeExperiments(vault: VaultReadModel): OverviewExperiment[] {
  const sortedExperiments = [...vault.experiments].sort((left, right) =>
    compareLatestStrings(right.occurredAt ?? right.date, left.occurredAt ?? left.date),
  );
  const prioritizedExperiments = [
    ...sortedExperiments.filter((entry) => isActiveExperimentStatus(entry.status)),
    ...sortedExperiments.filter((entry) => !isActiveExperimentStatus(entry.status)),
  ];

  return prioritizedExperiments.slice(0, 6).map((entry) => ({
      id: entry.displayId,
      slug: entry.experimentSlug,
      startedOn: entry.date ?? extractDate(entry.occurredAt),
      status: entry.status ?? null,
      summary: summarizeText(entry.body),
      tags: compactStrings(entry.tags),
      title: entry.title ?? entry.displayId,
    }));
}

function isActiveExperimentStatus(status: string | null | undefined): boolean {
  return status?.trim().toLowerCase() === "active";
}

function searchVaultSafely(
  vault: VaultReadModel,
  query: string,
): OverviewSearchResult {
  const result = scoreSearchDocuments(
    vault.records.map(buildSafeSearchDocument),
    query,
    {
      includeSamples: true,
      limit: DEFAULT_SEARCH_LIMIT,
    },
  );

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

function buildSafeSearchDocument(record: VaultRecordModel): SearchableDocument {
  return {
    aliasIds: record.lookupIds,
    bodyText: compactStrings([record.body]).join("\n").trim(),
    date: record.date,
    experimentSlug: record.experimentSlug,
    kind: record.kind,
    occurredAt: record.occurredAt,
    path: null,
    recordId: record.displayId,
    recordType: record.recordType,
    stream: record.stream,
    structuredText: compactStrings([
      record.displayId,
      record.primaryLookupId,
      ...record.lookupIds,
      ...(record.relatedIds ?? []),
    ]).join("\n"),
    tags: record.tags,
    tagsText: compactStrings(record.tags).join(" "),
    title: record.title,
    titleText: compactStrings([
      record.title,
      record.kind,
      record.status ?? null,
      record.stream,
      record.experimentSlug,
    ]).join(" · "),
  };
}

function compactStrings(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function resolveGoals(vault: VaultReadModel, goalIds: readonly string[]): OverviewGoal[] {
  const goalLookup = new Map<string, VaultReadModel["goals"][number]>();

  for (const goal of vault.goals) {
    const lookupIds = [goal.displayId, goal.primaryLookupId, ...goal.lookupIds];
    for (const lookupId of lookupIds) {
      if (lookupId) {
        goalLookup.set(lookupId, goal);
      }
    }
  }

  return goalIds.map((goalId) => {
    const goal = goalLookup.get(goalId);

    return {
      id: goalId,
      title: goal?.title ?? goalId,
    };
  });
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

function extractStringArray(...values: unknown[]): string[] {
  let fallback: string[] | null = null;

  for (const value of values) {
    if (Array.isArray(value)) {
      const strings = value.filter((entry): entry is string => typeof entry === "string");
      if (fallback === null) {
        fallback = strings;
      }

      if (strings.length > 0) {
        return strings;
      }
    }
  }

  return fallback ?? [];
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

function getLatestProfileSnapshot(vault: VaultReadModel): VaultReadModel["profileSnapshots"][number] | null {
  let latest: VaultReadModel["profileSnapshots"][number] | null = null;

  for (const snapshot of vault.profileSnapshots) {
    if (
      latest === null ||
      compareLatestStrings(snapshot.occurredAt, latest.occurredAt) > 0
    ) {
      latest = snapshot;
    }
  }

  return latest;
}

function compareLatestStrings(left: string | null | undefined, right: string | null | undefined): number {
  return (left ?? "").localeCompare(right ?? "");
}

function extractDate(value: string | null | undefined): string {
  return extractIsoDatePrefix(value) ?? "Undated";
}
