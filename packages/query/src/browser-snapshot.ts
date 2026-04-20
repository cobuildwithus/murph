import {
  buildOverviewMetrics,
  summarizeOverviewExperiments,
  summarizeRecentOverviewJournals,
  type OverviewExperiment,
  type OverviewJournalEntry,
  type OverviewMetric,
} from "./overview.ts";
import type { VaultReadModel } from "./read-model.ts";
import { summarizeDailySamples, type DailySampleSummary } from "./summaries.ts";
import { buildTimeline, type TimelineEntry } from "./timeline.ts";
import {
  buildWearableAssistantSummary,
  summarizeWearableActivity,
  summarizeWearableBodyState,
  summarizeWearableRecovery,
  summarizeWearableSleep,
  summarizeWearableSourceHealth,
  type WearableActivitySummary,
  type WearableAssistantSummary,
  type WearableBodyStateSummary,
  type WearableRecoverySummary,
  type WearableSleepSummary,
  type WearableSourceHealthSummary,
} from "./wearables.ts";

export const BROWSER_VAULT_SNAPSHOT_SCHEMA = "murph.browser-vault-dashboard-snapshot.v1";
const BROWSER_VAULT_TRACKED_EXPERIMENT_LIMIT = 12;
const BROWSER_VAULT_RECENT_JOURNAL_LIMIT = 4;
const BROWSER_VAULT_TIMELINE_LIMIT = 120;
const BROWSER_VAULT_SIGNAL_LIMIT = 5;
const BROWSER_VAULT_SOURCE_HEALTH_LIMIT = 10;
const BROWSER_VAULT_WEEKLY_SAMPLE_LOOKBACK_DAYS = 56;

export interface BrowserVaultHistoryEntry {
  date: string;
  entryType: TimelineEntry["entryType"];
  id: string;
  kind: string;
  occurredAt: string;
  path: string | null;
  stream: string | null;
  tags: string[];
  title: string;
}

export interface BrowserVaultOverviewProjection {
  metrics: OverviewMetric[];
  recentJournals: OverviewJournalEntry[];
  trackedExperiments: OverviewExperiment[];
  weeklySampleSummaries: DailySampleSummary[];
}

export interface BrowserVaultSignalsProjection {
  activity: WearableActivitySummary[];
  assistantSummary: WearableAssistantSummary;
  bodyState: WearableBodyStateSummary[];
  recovery: WearableRecoverySummary[];
  sleep: WearableSleepSummary[];
  sourceHealth: WearableSourceHealthSummary[];
}

export interface BrowserVaultSnapshot {
  generatedAt: string;
  history: {
    timeline: BrowserVaultHistoryEntry[];
  };
  overview: BrowserVaultOverviewProjection;
  schema: typeof BROWSER_VAULT_SNAPSHOT_SCHEMA;
  signals: BrowserVaultSignalsProjection;
  sourceVersion: string;
}

export function createBrowserVaultSnapshot(input: {
  generatedAt?: string;
  sourceVersion: string;
  vault: VaultReadModel;
}): BrowserVaultSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  return {
    generatedAt,
    history: {
      timeline: buildTimeline(input.vault, { limit: BROWSER_VAULT_TIMELINE_LIMIT }).map(projectTimelineEntry),
    },
    overview: {
      metrics: buildOverviewMetrics(input.vault),
      recentJournals: summarizeRecentOverviewJournals(input.vault, BROWSER_VAULT_RECENT_JOURNAL_LIMIT),
      trackedExperiments: summarizeOverviewExperiments(
        input.vault,
        BROWSER_VAULT_TRACKED_EXPERIMENT_LIMIT,
      ),
      weeklySampleSummaries: projectWeeklySampleSummaries(input.vault, generatedAt),
    },
    schema: BROWSER_VAULT_SNAPSHOT_SCHEMA,
    signals: {
      activity: summarizeWearableActivity(input.vault, { limit: BROWSER_VAULT_SIGNAL_LIMIT }),
      assistantSummary: buildWearableAssistantSummary(input.vault),
      bodyState: summarizeWearableBodyState(input.vault, { limit: BROWSER_VAULT_SIGNAL_LIMIT }),
      recovery: summarizeWearableRecovery(input.vault, { limit: BROWSER_VAULT_SIGNAL_LIMIT }),
      sleep: summarizeWearableSleep(input.vault, { limit: BROWSER_VAULT_SIGNAL_LIMIT }),
      sourceHealth: summarizeWearableSourceHealth(input.vault, {
        limit: BROWSER_VAULT_SOURCE_HEALTH_LIMIT,
      }),
    },
    sourceVersion: requireString(input.sourceVersion, "Browser vault snapshot sourceVersion"),
  };
}

export function parseBrowserVaultSnapshot(
  value: unknown,
  label = "Browser vault snapshot",
): BrowserVaultSnapshot {
  const record = requireRecord(value, label);
  const schema = requireString(record.schema, `${label}.schema`);

  if (schema !== BROWSER_VAULT_SNAPSHOT_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${BROWSER_VAULT_SNAPSHOT_SCHEMA}.`);
  }

  return {
    generatedAt: requireString(record.generatedAt, `${label}.generatedAt`),
    history: parseHistorySection(record.history, `${label}.history`),
    overview: parseOverviewSection(record.overview, `${label}.overview`),
    schema: BROWSER_VAULT_SNAPSHOT_SCHEMA,
    signals: parseSignalsSection(record.signals, `${label}.signals`),
    sourceVersion: requireString(record.sourceVersion, `${label}.sourceVersion`),
  };
}

function projectTimelineEntry(entry: TimelineEntry): BrowserVaultHistoryEntry {
  return {
    date: entry.date,
    entryType: entry.entryType,
    id: entry.id,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    path: entry.path,
    stream: entry.stream,
    tags: entry.tags.slice(),
    title: entry.title,
  };
}

function projectWeeklySampleSummaries(
  vault: VaultReadModel,
  generatedAt: string,
): DailySampleSummary[] {
  const generatedOn = extractIsoDate(generatedAt);
  const cutoffDate = subtractDaysFromIsoDate(generatedOn, BROWSER_VAULT_WEEKLY_SAMPLE_LOOKBACK_DAYS);

  return summarizeDailySamples(vault).filter((entry) => entry.date >= cutoffDate);
}

function parseHistorySection(
  value: unknown,
  label: string,
): BrowserVaultSnapshot["history"] {
  const record = requireRecord(value, label);

  return {
    timeline: requireArray(record.timeline, `${label}.timeline`).map((entry, index) =>
      parseHistoryEntry(entry, `${label}.timeline[${index}]`)
    ),
  };
}

function parseHistoryEntry(
  value: unknown,
  label: string,
): BrowserVaultHistoryEntry {
  const record = requireRecord(value, label);

  return {
    date: requireString(record.date, `${label}.date`),
    entryType: requireString(record.entryType, `${label}.entryType`) as BrowserVaultHistoryEntry["entryType"],
    id: requireString(record.id, `${label}.id`),
    kind: requireString(record.kind, `${label}.kind`),
    occurredAt: requireString(record.occurredAt, `${label}.occurredAt`),
    path: readNullableString(record.path, `${label}.path`),
    stream: readNullableString(record.stream, `${label}.stream`),
    tags: requireStringArray(record.tags, `${label}.tags`),
    title: requireString(record.title, `${label}.title`),
  };
}

function parseOverviewSection(
  value: unknown,
  label: string,
): BrowserVaultOverviewProjection {
  const record = requireRecord(value, label);

  return {
    metrics: cloneRecordArray<OverviewMetric>(record.metrics, `${label}.metrics`),
    recentJournals: cloneRecordArray<OverviewJournalEntry>(
      record.recentJournals,
      `${label}.recentJournals`,
    ),
    trackedExperiments: cloneRecordArray<OverviewExperiment>(
      record.trackedExperiments,
      `${label}.trackedExperiments`,
    ),
    weeklySampleSummaries: cloneRecordArray<DailySampleSummary>(
      record.weeklySampleSummaries,
      `${label}.weeklySampleSummaries`,
    ),
  };
}

function parseSignalsSection(
  value: unknown,
  label: string,
): BrowserVaultSignalsProjection {
  const record = requireRecord(value, label);

  return {
    activity: cloneRecordArray<WearableActivitySummary>(record.activity, `${label}.activity`),
    assistantSummary: cloneRecord<WearableAssistantSummary>(
      record.assistantSummary,
      `${label}.assistantSummary`,
    ),
    bodyState: cloneRecordArray<WearableBodyStateSummary>(record.bodyState, `${label}.bodyState`),
    recovery: cloneRecordArray<WearableRecoverySummary>(record.recovery, `${label}.recovery`),
    sleep: cloneRecordArray<WearableSleepSummary>(record.sleep, `${label}.sleep`),
    sourceHealth: cloneRecordArray<WearableSourceHealthSummary>(
      record.sourceHealth,
      `${label}.sourceHealth`,
    ),
  };
}

function cloneRecord<T extends object>(value: unknown, label: string): T {
  return cloneJson(requireRecord(value, label)) as T;
}

function cloneRecordArray<T extends object>(value: unknown, label: string): T[] {
  return requireArray(value, label).map((entry, index) =>
    cloneRecord<T>(entry, `${label}[${index}]`)
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function extractIsoDate(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.valueOf())) {
    throw new TypeError("Browser vault snapshot generatedAt must be a valid ISO datetime.");
  }

  return parsed.toISOString().slice(0, 10);
}

function subtractDaysFromIsoDate(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.valueOf())) {
    throw new TypeError("Browser vault snapshot generatedAt date must be a valid ISO date.");
  }

  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, label);
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) =>
    requireString(entry, `${label}[${index}]`)
  );
}
