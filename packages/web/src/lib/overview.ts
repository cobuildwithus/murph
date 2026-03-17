import { access, stat } from "node:fs/promises";
import path from "node:path";

import { buildTimeline, readVaultTolerant, summarizeDailySamples } from "@healthybob/query";

import {
  buildExampleVaultPath,
  buildSuggestedCommand,
  getConfiguredVaultRoot,
  HEALTHYBOB_VAULT_ENV,
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
  timeline: OverviewTimelineEntry[];
  weeklyStats: OverviewWeeklyStat[];
}

export interface MissingConfigOverview {
  envVar: typeof HEALTHYBOB_VAULT_ENV;
  exampleVaultPath: string;
  status: "missing-config";
  suggestedCommand: string;
}

export interface ErrorOverview {
  envVar: typeof HEALTHYBOB_VAULT_ENV;
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

interface SafeSearchFields {
  bodyText: string;
  structuredText: string;
  tagsText: string;
  titleText: string;
}

interface ScoredOverviewSearchHit extends OverviewSearchHit {
  occurredAt: string | null;
  score: number;
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
    vaultRoot: getConfiguredVaultRoot(),
  });
}

export async function loadVaultOverview(
  options: LoadVaultOverviewOptions = {},
): Promise<OverviewResult> {
  const vaultRoot = options.vaultRoot ?? null;

  if (!vaultRoot) {
    return {
      envVar: HEALTHYBOB_VAULT_ENV,
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
      weeklyStats: buildWeeklyStats(vault),
      timeline: buildTimeline(vault, {
        includeDailySampleSummaries: true,
        includeProfileSnapshots: true,
        limit: timelineLimit,
      }).map((entry) => toOverviewTimelineEntry(entry)),
    };
  } catch {
    return {
      envVar: HEALTHYBOB_VAULT_ENV,
      hint: "Confirm the configured vault path points at a Healthy Bob vault root, then restart the local app.",
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
    vault.regimens.length +
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

function buildWeeklyStats(vault: VaultReadModel): OverviewWeeklyStat[] {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const dayOfWeek = now.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisMonday = new Date(now);
  thisMonday.setUTCDate(now.getUTCDate() - mondayOffset);
  const thisWeekStart = thisMonday.toISOString().slice(0, 10);

  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  const lastWeekStart = lastMonday.toISOString().slice(0, 10);

  const thisWeekSamples = new Map<string, { values: number[]; unit: string | null }>();
  const lastWeekSamples = new Map<string, { values: number[]; unit: string | null }>();

  for (const sample of vault.samples) {
    const sampleDate = sample.date ?? extractDate(sample.occurredAt);
    const stream = sample.stream;
    const rawValue = sample.data?.value;
    const numericValue = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
    if (!stream || numericValue === null) continue;

    const rawUnit = sample.data?.unit;
    const unit = typeof rawUnit === "string" && rawUnit.trim() ? rawUnit.trim() : null;

    let bucket: Map<string, { values: number[]; unit: string | null }> | null = null;
    if (sampleDate >= thisWeekStart && sampleDate <= todayStr) {
      bucket = thisWeekSamples;
    } else if (sampleDate >= lastWeekStart && sampleDate < thisWeekStart) {
      bucket = lastWeekSamples;
    }

    if (!bucket) continue;

    const existing = bucket.get(stream);
    if (existing) {
      existing.values.push(numericValue);
    } else {
      bucket.set(stream, { values: [numericValue], unit });
    }
  }

  const allStreams = new Set([...thisWeekSamples.keys(), ...lastWeekSamples.keys()]);
  const stats: OverviewWeeklyStat[] = [];

  for (const stream of allStreams) {
    const thisWeek = thisWeekSamples.get(stream);
    const lastWeek = lastWeekSamples.get(stream);

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

  return stats.sort((a, b) => a.stream.localeCompare(b.stream));
}

function summarizeExperiments(vault: VaultReadModel): OverviewExperiment[] {
  return [...vault.experiments]
    .sort((left, right) => compareLatestStrings(right.occurredAt ?? right.date, left.occurredAt ?? left.date))
    .slice(0, 6)
    .map((entry) => ({
      id: entry.displayId,
      slug: entry.experimentSlug,
      startedOn: entry.date ?? extractDate(entry.occurredAt),
      status: entry.status ?? null,
      summary: summarizeText(entry.body),
      tags: compactStrings(entry.tags),
      title: entry.title ?? entry.displayId,
    }));
}

function searchVaultSafely(
  vault: VaultReadModel,
  query: string,
): OverviewSearchResult {
  const normalizedQuery = query.trim();
  const terms = tokenize(normalizedQuery);

  if (terms.length === 0) {
    return {
      hits: [],
      query: normalizedQuery,
      total: 0,
    };
  }

  const hits = vault.records
    .map((record) => scoreOverviewSearchRecord(record, normalizedQuery, terms))
    .filter((entry): entry is ScoredOverviewSearchHit => entry !== null)
    .sort(compareOverviewSearchHits);

  return {
    hits: hits.slice(0, DEFAULT_SEARCH_LIMIT).map((hit) => ({
      date: hit.date,
      kind: hit.kind,
      recordId: hit.recordId,
      recordType: hit.recordType,
      snippet: hit.snippet,
      title: hit.title,
    })),
    query: normalizedQuery,
    total: hits.length,
  };
}

function scoreOverviewSearchRecord(
  record: VaultRecordModel,
  normalizedQuery: string,
  terms: readonly string[],
): ScoredOverviewSearchHit | null {
  const fields = buildSafeSearchFields(record);
  const normalizedPhrase = normalizedQuery.toLowerCase();
  const matchedTerms = new Set<string>();

  const titleLower = fields.titleText.toLowerCase();
  const bodyLower = fields.bodyText.toLowerCase();
  const tagsLower = fields.tagsText.toLowerCase();
  const structuredLower = fields.structuredText.toLowerCase();

  const titleMetrics = scoreText(titleLower, terms);
  const bodyMetrics = scoreText(bodyLower, terms);
  const tagMetrics = scoreText(tagsLower, terms);
  const structuredMetrics = scoreText(structuredLower, terms);

  accumulateMatchedTerms(matchedTerms, titleMetrics.matchedTerms);
  accumulateMatchedTerms(matchedTerms, bodyMetrics.matchedTerms);
  accumulateMatchedTerms(matchedTerms, tagMetrics.matchedTerms);
  accumulateMatchedTerms(matchedTerms, structuredMetrics.matchedTerms);

  if (matchedTerms.size === 0) {
    return null;
  }

  let score = 0;

  if (titleLower.includes(normalizedPhrase)) {
    score += 12;
  }

  if (bodyLower.includes(normalizedPhrase)) {
    score += 6;
  }

  if (tagsLower.includes(normalizedPhrase) || structuredLower.includes(normalizedPhrase)) {
    score += 4;
  }

  score += titleMetrics.count * 4.5;
  score += bodyMetrics.count * 1.75;
  score += tagMetrics.count * 3.5;
  score += structuredMetrics.count * 0.9;
  score += (matchedTerms.size / terms.length) * 6;

  if (matchedTerms.size === terms.length && terms.length > 1) {
    score += 3;
  }

  return {
    date: record.date,
    kind: record.kind,
    occurredAt: record.occurredAt,
    recordId: record.displayId,
    recordType: record.recordType,
    score,
    snippet: buildSafeSnippet(fields, terms),
    title: record.title ?? record.displayId,
  };
}

function buildSafeSearchFields(record: VaultRecordModel): SafeSearchFields {
  return {
    bodyText: compactStrings([record.body]).join("\n").trim(),
    structuredText: compactStrings([
      record.displayId,
      record.primaryLookupId,
      ...record.lookupIds,
      ...(record.relatedIds ?? []),
    ]).join("\n"),
    tagsText: compactStrings(record.tags).join(" "),
    titleText: compactStrings([
      record.title,
      record.kind,
      record.status ?? null,
      record.stream,
      record.experimentSlug,
    ]).join(" · "),
  };
}

function compareOverviewSearchHits(
  left: ScoredOverviewSearchHit,
  right: ScoredOverviewSearchHit,
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  const leftDate = left.occurredAt ?? left.date ?? "";
  const rightDate = right.occurredAt ?? right.date ?? "";

  if (rightDate !== leftDate) {
    return rightDate.localeCompare(leftDate);
  }

  return left.recordId.localeCompare(right.recordId);
}

function buildSafeSnippet(fields: SafeSearchFields, terms: readonly string[]): string {
  const sourceText =
    fields.bodyText || fields.titleText || fields.structuredText || fields.tagsText || "";

  if (!sourceText) {
    return "No matching text preview available.";
  }

  const lowerSource = sourceText.toLowerCase();
  let matchIndex = -1;

  for (const term of terms) {
    const candidateIndex = lowerSource.indexOf(term);
    if (candidateIndex >= 0 && (matchIndex < 0 || candidateIndex < matchIndex)) {
      matchIndex = candidateIndex;
    }
  }

  if (matchIndex < 0) {
    return truncateSnippet(sourceText);
  }

  const start = Math.max(0, matchIndex - 56);
  const end = Math.min(sourceText.length, matchIndex + 104);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < sourceText.length ? "..." : "";

  return `${prefix}${sourceText.slice(start, end).trim()}${suffix}`;
}

function scoreText(
  text: string,
  terms: readonly string[],
): { count: number; matchedTerms: string[] } {
  let count = 0;
  const matchedTerms: string[] = [];

  for (const term of terms) {
    const occurrences = countOccurrences(text, term);
    if (occurrences > 0) {
      count += occurrences;
      matchedTerms.push(term);
    }
  }

  return {
    count,
    matchedTerms,
  };
}

function countOccurrences(text: string, term: string): number {
  if (!term) {
    return 0;
  }

  let count = 0;
  let startIndex = 0;

  while (startIndex < text.length) {
    const matchIndex = text.indexOf(term, startIndex);
    if (matchIndex < 0) {
      return count;
    }

    count += 1;
    startIndex = matchIndex + term.length;
  }

  return count;
}

function accumulateMatchedTerms(target: Set<string>, matchedTerms: readonly string[]): void {
  for (const term of matchedTerms) {
    target.add(term);
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

function truncateSnippet(value: string): string {
  return value.length <= 160 ? value : `${value.slice(0, 157)}...`;
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

function toOverviewTimelineEntry(entry: TimelineItem): OverviewTimelineEntry {
  return {
    entryType: entry.entryType,
    id: entry.id,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    stream: entry.stream,
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
  if (typeof value === "string" && value.length >= 10) {
    return value.slice(0, 10);
  }

  return "Undated";
}
