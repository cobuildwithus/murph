import {
  buildOverviewMetrics,
  summarizeOverviewExperiments,
  summarizeRecentOverviewJournals,
  type OverviewExperiment,
  type OverviewJournalEntry,
  type OverviewMetric,
  type OverviewWeeklySampleSummary,
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
  type WearableConfidenceLevel,
  type WearableRecoverySummary,
  type WearableResolvedMetric,
  type WearableSleepSummary,
  type WearableSourceHealthSummary,
  type WearableSummaryConfidence,
} from "./wearables.ts";

export const BROWSER_VAULT_SNAPSHOT_SCHEMA = "murph.browser-vault-dashboard-snapshot.v2";
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
  stream: string | null;
  tags: string[];
  title: string;
}

export interface BrowserVaultOverviewProjection {
  metrics: OverviewMetric[];
  recentJournals: OverviewJournalEntry[];
  trackedExperiments: OverviewExperiment[];
  weeklySampleSummaries: OverviewWeeklySampleSummary[];
}

export interface BrowserVaultMetricSelection {
  unit: string | null;
  value: number | null;
}

export interface BrowserVaultResolvedMetric {
  selection: BrowserVaultMetricSelection;
}

export interface BrowserVaultSummaryConfidence {
  level: WearableConfidenceLevel;
}

export interface BrowserVaultActivitySummary {
  activityScore: BrowserVaultResolvedMetric;
  activeCalories: BrowserVaultResolvedMetric;
  activityTypes: string[];
  date: string;
  dayStrain: BrowserVaultResolvedMetric;
  distanceKm: BrowserVaultResolvedMetric;
  notes: string[];
  sessionCount: BrowserVaultResolvedMetric;
  sessionMinutes: BrowserVaultResolvedMetric;
  steps: BrowserVaultResolvedMetric;
  summaryConfidence: BrowserVaultSummaryConfidence;
}

export interface BrowserVaultSleepSummary {
  averageHeartRate: BrowserVaultResolvedMetric;
  awakeMinutes: BrowserVaultResolvedMetric;
  date: string;
  deepMinutes: BrowserVaultResolvedMetric;
  hrv: BrowserVaultResolvedMetric;
  lightMinutes: BrowserVaultResolvedMetric;
  lowestHeartRate: BrowserVaultResolvedMetric;
  notes: string[];
  remMinutes: BrowserVaultResolvedMetric;
  respiratoryRate: BrowserVaultResolvedMetric;
  sessionMinutes: BrowserVaultResolvedMetric;
  sleepConsistency: BrowserVaultResolvedMetric;
  sleepEfficiency: BrowserVaultResolvedMetric;
  sleepEndAt: string | null;
  sleepPerformance: BrowserVaultResolvedMetric;
  sleepScore: BrowserVaultResolvedMetric;
  sleepStartAt: string | null;
  sleepWindowProvider: string | null;
  spo2: BrowserVaultResolvedMetric;
  summaryConfidence: BrowserVaultSummaryConfidence;
  timeInBedMinutes: BrowserVaultResolvedMetric;
  totalSleepMinutes: BrowserVaultResolvedMetric;
}

export interface BrowserVaultRecoverySummary {
  bodyBattery: BrowserVaultResolvedMetric;
  date: string;
  hrv: BrowserVaultResolvedMetric;
  notes: string[];
  readinessScore: BrowserVaultResolvedMetric;
  recoveryScore: BrowserVaultResolvedMetric;
  respiratoryRate: BrowserVaultResolvedMetric;
  restingHeartRate: BrowserVaultResolvedMetric;
  spo2: BrowserVaultResolvedMetric;
  stressLevel: BrowserVaultResolvedMetric;
  summaryConfidence: BrowserVaultSummaryConfidence;
  temperature: BrowserVaultResolvedMetric;
  temperatureDeviation: BrowserVaultResolvedMetric;
}

export interface BrowserVaultBodyStateSummary {
  bmi: BrowserVaultResolvedMetric;
  bodyFatPercentage: BrowserVaultResolvedMetric;
  date: string;
  notes: string[];
  summaryConfidence: BrowserVaultSummaryConfidence;
  temperature: BrowserVaultResolvedMetric;
  weightKg: BrowserVaultResolvedMetric;
}

export interface BrowserVaultAssistantSummary {
  highlights: string[];
  latestDate: string | null;
}

export interface BrowserVaultSourceHealthSummary {
  activityDays: number;
  bodyStateDays: number;
  conflictCount: number;
  lastDate: string | null;
  provider: string;
  providerDisplayName: string;
  recoveryDays: number;
  selectedMetrics: number;
  sleepNights: number;
  stalenessVsNewestDays: number | null;
}

export interface BrowserVaultSignalsProjection {
  activity: BrowserVaultActivitySummary[];
  assistantSummary: BrowserVaultAssistantSummary;
  bodyState: BrowserVaultBodyStateSummary[];
  recovery: BrowserVaultRecoverySummary[];
  sleep: BrowserVaultSleepSummary[];
  sourceHealth: BrowserVaultSourceHealthSummary[];
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
  const generatedAt = input.generatedAt
    ? requireCanonicalUtcIsoDateTime(
      input.generatedAt,
      "Browser vault snapshot generatedAt",
    )
    : new Date().toISOString();

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
      activity: summarizeWearableActivity(input.vault, { limit: BROWSER_VAULT_SIGNAL_LIMIT }).map(projectWearableActivitySummary),
      assistantSummary: projectWearableAssistantSummary(buildWearableAssistantSummary(input.vault)),
      bodyState: summarizeWearableBodyState(input.vault, { limit: BROWSER_VAULT_SIGNAL_LIMIT }).map(projectWearableBodyStateSummary),
      recovery: summarizeWearableRecovery(input.vault, { limit: BROWSER_VAULT_SIGNAL_LIMIT }).map(projectWearableRecoverySummary),
      sleep: summarizeWearableSleep(input.vault, { limit: BROWSER_VAULT_SIGNAL_LIMIT }).map(projectWearableSleepSummary),
      sourceHealth: summarizeWearableSourceHealth(input.vault, {
        limit: BROWSER_VAULT_SOURCE_HEALTH_LIMIT,
      }).map(projectWearableSourceHealthSummary),
    },
    sourceVersion: requireString(input.sourceVersion, "Browser vault snapshot sourceVersion"),
  };
}

export function parseBrowserVaultSnapshot(
  value: unknown,
  label = "Browser vault snapshot",
): BrowserVaultSnapshot {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(
    record,
    ["generatedAt", "history", "overview", "schema", "signals", "sourceVersion"],
    label,
  );
  const schema = requireString(record.schema, `${label}.schema`);

  if (schema !== BROWSER_VAULT_SNAPSHOT_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${BROWSER_VAULT_SNAPSHOT_SCHEMA}.`);
  }

  return {
    generatedAt: requireIsoDateTime(record.generatedAt, `${label}.generatedAt`),
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
    stream: entry.stream,
    tags: entry.tags.slice(),
    title: entry.title,
  };
}

function projectWeeklySampleSummaries(
  vault: VaultReadModel,
  generatedAt: string,
): OverviewWeeklySampleSummary[] {
  const generatedOn = extractIsoDate(generatedAt);
  const cutoffDate = subtractDaysFromIsoDate(generatedOn, BROWSER_VAULT_WEEKLY_SAMPLE_LOOKBACK_DAYS);

  return summarizeDailySamples(vault)
    .filter((entry) => entry.date >= cutoffDate)
    .map(projectOverviewWeeklySampleSummary);
}

function projectOverviewWeeklySampleSummary(
  entry: DailySampleSummary,
): OverviewWeeklySampleSummary {
  return {
    date: entry.date,
    numericSampleCount: entry.numericSampleCount,
    sampleCount: entry.sampleCount,
    stream: entry.stream,
    sumValue: entry.sumValue,
    unit: entry.unit,
  };
}

function projectWearableAssistantSummary(
  summary: WearableAssistantSummary,
): BrowserVaultAssistantSummary {
  return {
    highlights: summary.highlights.slice(),
    latestDate: summary.latestDate,
  };
}

function projectWearableActivitySummary(
  summary: WearableActivitySummary,
): BrowserVaultActivitySummary {
  return {
    activityScore: projectWearableResolvedMetric(summary.activityScore),
    activeCalories: projectWearableResolvedMetric(summary.activeCalories),
    activityTypes: summary.activityTypes.slice(),
    date: summary.date,
    dayStrain: projectWearableResolvedMetric(summary.dayStrain),
    distanceKm: projectWearableResolvedMetric(summary.distanceKm),
    notes: summary.notes.slice(),
    sessionCount: projectWearableResolvedMetric(summary.sessionCount),
    sessionMinutes: projectWearableResolvedMetric(summary.sessionMinutes),
    steps: projectWearableResolvedMetric(summary.steps),
    summaryConfidence: projectWearableSummaryConfidence(summary.summaryConfidence),
  };
}

function projectWearableSleepSummary(
  summary: WearableSleepSummary,
): BrowserVaultSleepSummary {
  return {
    averageHeartRate: projectWearableResolvedMetric(summary.averageHeartRate),
    awakeMinutes: projectWearableResolvedMetric(summary.awakeMinutes),
    date: summary.date,
    deepMinutes: projectWearableResolvedMetric(summary.deepMinutes),
    hrv: projectWearableResolvedMetric(summary.hrv),
    lightMinutes: projectWearableResolvedMetric(summary.lightMinutes),
    lowestHeartRate: projectWearableResolvedMetric(summary.lowestHeartRate),
    notes: summary.notes.slice(),
    remMinutes: projectWearableResolvedMetric(summary.remMinutes),
    respiratoryRate: projectWearableResolvedMetric(summary.respiratoryRate),
    sessionMinutes: projectWearableResolvedMetric(summary.sessionMinutes),
    sleepConsistency: projectWearableResolvedMetric(summary.sleepConsistency),
    sleepEfficiency: projectWearableResolvedMetric(summary.sleepEfficiency),
    sleepEndAt: summary.sleepEndAt,
    sleepPerformance: projectWearableResolvedMetric(summary.sleepPerformance),
    sleepScore: projectWearableResolvedMetric(summary.sleepScore),
    sleepStartAt: summary.sleepStartAt,
    sleepWindowProvider: summary.sleepWindowProvider,
    spo2: projectWearableResolvedMetric(summary.spo2),
    summaryConfidence: projectWearableSummaryConfidence(summary.summaryConfidence),
    timeInBedMinutes: projectWearableResolvedMetric(summary.timeInBedMinutes),
    totalSleepMinutes: projectWearableResolvedMetric(summary.totalSleepMinutes),
  };
}

function projectWearableRecoverySummary(
  summary: WearableRecoverySummary,
): BrowserVaultRecoverySummary {
  return {
    bodyBattery: projectWearableResolvedMetric(summary.bodyBattery),
    date: summary.date,
    hrv: projectWearableResolvedMetric(summary.hrv),
    notes: summary.notes.slice(),
    readinessScore: projectWearableResolvedMetric(summary.readinessScore),
    recoveryScore: projectWearableResolvedMetric(summary.recoveryScore),
    respiratoryRate: projectWearableResolvedMetric(summary.respiratoryRate),
    restingHeartRate: projectWearableResolvedMetric(summary.restingHeartRate),
    spo2: projectWearableResolvedMetric(summary.spo2),
    stressLevel: projectWearableResolvedMetric(summary.stressLevel),
    summaryConfidence: projectWearableSummaryConfidence(summary.summaryConfidence),
    temperature: projectWearableResolvedMetric(summary.temperature),
    temperatureDeviation: projectWearableResolvedMetric(summary.temperatureDeviation),
  };
}

function projectWearableBodyStateSummary(
  summary: WearableBodyStateSummary,
): BrowserVaultBodyStateSummary {
  return {
    bmi: projectWearableResolvedMetric(summary.bmi),
    bodyFatPercentage: projectWearableResolvedMetric(summary.bodyFatPercentage),
    date: summary.date,
    notes: summary.notes.slice(),
    summaryConfidence: projectWearableSummaryConfidence(summary.summaryConfidence),
    temperature: projectWearableResolvedMetric(summary.temperature),
    weightKg: projectWearableResolvedMetric(summary.weightKg),
  };
}

function projectWearableResolvedMetric(
  metric: WearableResolvedMetric,
): BrowserVaultResolvedMetric {
  return {
    selection: {
      unit: metric.selection.unit,
      value: metric.selection.value,
    },
  };
}

function projectWearableSummaryConfidence(
  confidence: WearableSummaryConfidence,
): BrowserVaultSummaryConfidence {
  return {
    level: confidence.level,
  };
}

function projectWearableSourceHealthSummary(
  summary: WearableSourceHealthSummary,
): BrowserVaultSourceHealthSummary {
  return {
    activityDays: summary.activityDays,
    bodyStateDays: summary.bodyStateDays,
    conflictCount: summary.conflictCount,
    lastDate: summary.lastDate,
    provider: summary.provider,
    providerDisplayName: summary.providerDisplayName,
    recoveryDays: summary.recoveryDays,
    selectedMetrics: summary.selectedMetrics,
    sleepNights: summary.sleepNights,
    stalenessVsNewestDays: summary.stalenessVsNewestDays,
  };
}

function parseHistorySection(
  value: unknown,
  label: string,
): BrowserVaultSnapshot["history"] {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(record, ["timeline"], label);

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
  rejectUnexpectedKeys(
    record,
    ["date", "entryType", "id", "kind", "occurredAt", "stream", "tags", "title"],
    label,
  );

  return {
    date: requireString(record.date, `${label}.date`),
    entryType: requireTimelineEntryType(record.entryType, `${label}.entryType`),
    id: requireString(record.id, `${label}.id`),
    kind: requireString(record.kind, `${label}.kind`),
    occurredAt: requireString(record.occurredAt, `${label}.occurredAt`),
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
  rejectUnexpectedKeys(
    record,
    ["metrics", "recentJournals", "trackedExperiments", "weeklySampleSummaries"],
    label,
  );

  return {
    metrics: requireArray(record.metrics, `${label}.metrics`).map((entry, index) =>
      parseOverviewMetric(entry, `${label}.metrics[${index}]`)
    ),
    recentJournals: requireArray(record.recentJournals, `${label}.recentJournals`).map((entry, index) =>
      parseOverviewJournalEntry(entry, `${label}.recentJournals[${index}]`)
    ),
    trackedExperiments: requireArray(record.trackedExperiments, `${label}.trackedExperiments`).map((entry, index) =>
      parseOverviewExperiment(entry, `${label}.trackedExperiments[${index}]`)
    ),
    weeklySampleSummaries: requireArray(record.weeklySampleSummaries, `${label}.weeklySampleSummaries`).map((entry, index) =>
      parseDailySampleSummary(entry, `${label}.weeklySampleSummaries[${index}]`)
    ),
  };
}

function parseSignalsSection(
  value: unknown,
  label: string,
): BrowserVaultSignalsProjection {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(
    record,
    ["activity", "assistantSummary", "bodyState", "recovery", "sleep", "sourceHealth"],
    label,
  );

  return {
    activity: requireArray(record.activity, `${label}.activity`).map((entry, index) =>
      parseWearableActivitySummary(entry, `${label}.activity[${index}]`)
    ),
    assistantSummary: parseWearableAssistantSummary(
      record.assistantSummary,
      `${label}.assistantSummary`,
    ),
    bodyState: requireArray(record.bodyState, `${label}.bodyState`).map((entry, index) =>
      parseWearableBodyStateSummary(entry, `${label}.bodyState[${index}]`)
    ),
    recovery: requireArray(record.recovery, `${label}.recovery`).map((entry, index) =>
      parseWearableRecoverySummary(entry, `${label}.recovery[${index}]`)
    ),
    sleep: requireArray(record.sleep, `${label}.sleep`).map((entry, index) =>
      parseWearableSleepSummary(entry, `${label}.sleep[${index}]`)
    ),
    sourceHealth: requireArray(record.sourceHealth, `${label}.sourceHealth`).map((entry, index) =>
      parseWearableSourceHealthSummary(entry, `${label}.sourceHealth[${index}]`)
    ),
  };
}

function parseOverviewMetric(value: unknown, label: string): OverviewMetric {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(record, ["label", "note", "value"], label);

  return {
    label: requireString(record.label, `${label}.label`),
    note: requireString(record.note, `${label}.note`),
    value: requireFiniteNumber(record.value, `${label}.value`),
  };
}

function parseOverviewJournalEntry(value: unknown, label: string): OverviewJournalEntry {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(record, ["date", "id", "summary", "tags", "title"], label);

  return {
    date: requireString(record.date, `${label}.date`),
    id: requireString(record.id, `${label}.id`),
    summary: readNullableString(record.summary, `${label}.summary`),
    tags: requireStringArray(record.tags, `${label}.tags`),
    title: requireString(record.title, `${label}.title`),
  };
}

function parseOverviewExperiment(value: unknown, label: string): OverviewExperiment {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(
    record,
    ["id", "slug", "startedOn", "status", "summary", "tags", "title"],
    label,
  );

  return {
    id: requireString(record.id, `${label}.id`),
    slug: readNullableString(record.slug, `${label}.slug`),
    startedOn: readNullableString(record.startedOn, `${label}.startedOn`),
    status: readNullableString(record.status, `${label}.status`),
    summary: readNullableString(record.summary, `${label}.summary`),
    tags: requireStringArray(record.tags, `${label}.tags`),
    title: requireString(record.title, `${label}.title`),
  };
}

function parseDailySampleSummary(value: unknown, label: string): OverviewWeeklySampleSummary {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(record, ["date", "numericSampleCount", "sampleCount", "stream", "sumValue", "unit"], label);

  return {
    date: requireString(record.date, `${label}.date`),
    numericSampleCount: requireNonNegativeInteger(record.numericSampleCount, `${label}.numericSampleCount`),
    sampleCount: requireNonNegativeInteger(record.sampleCount, `${label}.sampleCount`),
    stream: requireString(record.stream, `${label}.stream`),
    sumValue: readNullableFiniteNumber(record.sumValue, `${label}.sumValue`),
    unit: readNullableString(record.unit, `${label}.unit`),
  };
}

function parseWearableActivitySummary(value: unknown, label: string): BrowserVaultActivitySummary {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(
    record,
    ["activityScore", "activeCalories", "activityTypes", "date", "dayStrain", "distanceKm", "notes", "sessionCount", "sessionMinutes", "steps", "summaryConfidence"],
    label,
  );

  return {
    activityScore: parseWearableResolvedMetric(record.activityScore, `${label}.activityScore`),
    activeCalories: parseWearableResolvedMetric(record.activeCalories, `${label}.activeCalories`),
    activityTypes: requireStringArray(record.activityTypes, `${label}.activityTypes`),
    date: requireString(record.date, `${label}.date`),
    dayStrain: parseWearableResolvedMetric(record.dayStrain, `${label}.dayStrain`),
    distanceKm: parseWearableResolvedMetric(record.distanceKm, `${label}.distanceKm`),
    notes: requireStringArray(record.notes, `${label}.notes`),
    sessionCount: parseWearableResolvedMetric(record.sessionCount, `${label}.sessionCount`),
    sessionMinutes: parseWearableResolvedMetric(record.sessionMinutes, `${label}.sessionMinutes`),
    steps: parseWearableResolvedMetric(record.steps, `${label}.steps`),
    summaryConfidence: parseWearableSummaryConfidence(record.summaryConfidence, `${label}.summaryConfidence`),
  };
}

function parseWearableSleepSummary(value: unknown, label: string): BrowserVaultSleepSummary {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(
    record,
    ["averageHeartRate", "awakeMinutes", "date", "deepMinutes", "hrv", "lightMinutes", "lowestHeartRate", "notes", "remMinutes", "respiratoryRate", "sessionMinutes", "sleepConsistency", "sleepEfficiency", "sleepEndAt", "sleepPerformance", "sleepScore", "sleepStartAt", "sleepWindowProvider", "spo2", "summaryConfidence", "timeInBedMinutes", "totalSleepMinutes"],
    label,
  );

  return {
    averageHeartRate: parseWearableResolvedMetric(record.averageHeartRate, `${label}.averageHeartRate`),
    awakeMinutes: parseWearableResolvedMetric(record.awakeMinutes, `${label}.awakeMinutes`),
    date: requireString(record.date, `${label}.date`),
    deepMinutes: parseWearableResolvedMetric(record.deepMinutes, `${label}.deepMinutes`),
    hrv: parseWearableResolvedMetric(record.hrv, `${label}.hrv`),
    lightMinutes: parseWearableResolvedMetric(record.lightMinutes, `${label}.lightMinutes`),
    lowestHeartRate: parseWearableResolvedMetric(record.lowestHeartRate, `${label}.lowestHeartRate`),
    notes: requireStringArray(record.notes, `${label}.notes`),
    remMinutes: parseWearableResolvedMetric(record.remMinutes, `${label}.remMinutes`),
    respiratoryRate: parseWearableResolvedMetric(record.respiratoryRate, `${label}.respiratoryRate`),
    sessionMinutes: parseWearableResolvedMetric(record.sessionMinutes, `${label}.sessionMinutes`),
    sleepEfficiency: parseWearableResolvedMetric(record.sleepEfficiency, `${label}.sleepEfficiency`),
    sleepEndAt: readNullableString(record.sleepEndAt, `${label}.sleepEndAt`),
    sleepPerformance: parseWearableResolvedMetric(record.sleepPerformance, `${label}.sleepPerformance`),
    sleepScore: parseWearableResolvedMetric(record.sleepScore, `${label}.sleepScore`),
    sleepStartAt: readNullableString(record.sleepStartAt, `${label}.sleepStartAt`),
    sleepWindowProvider: readNullableString(record.sleepWindowProvider, `${label}.sleepWindowProvider`),
    sleepConsistency: parseWearableResolvedMetric(record.sleepConsistency, `${label}.sleepConsistency`),
    spo2: parseWearableResolvedMetric(record.spo2, `${label}.spo2`),
    summaryConfidence: parseWearableSummaryConfidence(record.summaryConfidence, `${label}.summaryConfidence`),
    timeInBedMinutes: parseWearableResolvedMetric(record.timeInBedMinutes, `${label}.timeInBedMinutes`),
    totalSleepMinutes: parseWearableResolvedMetric(record.totalSleepMinutes, `${label}.totalSleepMinutes`),
  };
}

function parseWearableRecoverySummary(value: unknown, label: string): BrowserVaultRecoverySummary {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(
    record,
    ["bodyBattery", "date", "hrv", "notes", "readinessScore", "recoveryScore", "respiratoryRate", "restingHeartRate", "spo2", "stressLevel", "summaryConfidence", "temperature", "temperatureDeviation"],
    label,
  );

  return {
    bodyBattery: parseWearableResolvedMetric(record.bodyBattery, `${label}.bodyBattery`),
    date: requireString(record.date, `${label}.date`),
    hrv: parseWearableResolvedMetric(record.hrv, `${label}.hrv`),
    notes: requireStringArray(record.notes, `${label}.notes`),
    readinessScore: parseWearableResolvedMetric(record.readinessScore, `${label}.readinessScore`),
    recoveryScore: parseWearableResolvedMetric(record.recoveryScore, `${label}.recoveryScore`),
    respiratoryRate: parseWearableResolvedMetric(record.respiratoryRate, `${label}.respiratoryRate`),
    restingHeartRate: parseWearableResolvedMetric(record.restingHeartRate, `${label}.restingHeartRate`),
    spo2: parseWearableResolvedMetric(record.spo2, `${label}.spo2`),
    stressLevel: parseWearableResolvedMetric(record.stressLevel, `${label}.stressLevel`),
    summaryConfidence: parseWearableSummaryConfidence(record.summaryConfidence, `${label}.summaryConfidence`),
    temperature: parseWearableResolvedMetric(record.temperature, `${label}.temperature`),
    temperatureDeviation: parseWearableResolvedMetric(record.temperatureDeviation, `${label}.temperatureDeviation`),
  };
}

function parseWearableBodyStateSummary(value: unknown, label: string): BrowserVaultBodyStateSummary {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(
    record,
    ["bmi", "bodyFatPercentage", "date", "notes", "summaryConfidence", "temperature", "weightKg"],
    label,
  );

  return {
    bmi: parseWearableResolvedMetric(record.bmi, `${label}.bmi`),
    bodyFatPercentage: parseWearableResolvedMetric(record.bodyFatPercentage, `${label}.bodyFatPercentage`),
    date: requireString(record.date, `${label}.date`),
    notes: requireStringArray(record.notes, `${label}.notes`),
    summaryConfidence: parseWearableSummaryConfidence(record.summaryConfidence, `${label}.summaryConfidence`),
    temperature: parseWearableResolvedMetric(record.temperature, `${label}.temperature`),
    weightKg: parseWearableResolvedMetric(record.weightKg, `${label}.weightKg`),
  };
}

function parseWearableAssistantSummary(value: unknown, label: string): BrowserVaultAssistantSummary {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(record, ["highlights", "latestDate"], label);

  return {
    highlights: requireStringArray(record.highlights, `${label}.highlights`),
    latestDate: readNullableString(record.latestDate, `${label}.latestDate`),
  };
}

function parseWearableSourceHealthSummary(value: unknown, label: string): BrowserVaultSourceHealthSummary {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(
    record,
    ["activityDays", "bodyStateDays", "conflictCount", "lastDate", "provider", "providerDisplayName", "recoveryDays", "selectedMetrics", "sleepNights", "stalenessVsNewestDays"],
    label,
  );

  return {
    activityDays: requireNonNegativeInteger(record.activityDays, `${label}.activityDays`),
    bodyStateDays: requireNonNegativeInteger(record.bodyStateDays, `${label}.bodyStateDays`),
    conflictCount: requireNonNegativeInteger(record.conflictCount, `${label}.conflictCount`),
    lastDate: readNullableString(record.lastDate, `${label}.lastDate`),
    provider: requireString(record.provider, `${label}.provider`),
    providerDisplayName: requireString(record.providerDisplayName, `${label}.providerDisplayName`),
    recoveryDays: requireNonNegativeInteger(record.recoveryDays, `${label}.recoveryDays`),
    selectedMetrics: requireNonNegativeInteger(record.selectedMetrics, `${label}.selectedMetrics`),
    sleepNights: requireNonNegativeInteger(record.sleepNights, `${label}.sleepNights`),
    stalenessVsNewestDays: readNullableNonNegativeInteger(record.stalenessVsNewestDays, `${label}.stalenessVsNewestDays`),
  };
}

function parseWearableResolvedMetric(value: unknown, label: string): BrowserVaultResolvedMetric {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(record, ["selection"], label);

  return {
    selection: parseWearableMetricSelection(record.selection, `${label}.selection`),
  };
}

function parseWearableMetricSelection(value: unknown, label: string): BrowserVaultMetricSelection {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(record, ["unit", "value"], label);

  return {
    unit: readNullableString(record.unit, `${label}.unit`),
    value: readNullableFiniteNumber(record.value, `${label}.value`),
  };
}

function parseWearableSummaryConfidence(value: unknown, label: string): BrowserVaultSummaryConfidence {
  const record = requireRecord(value, label);
  rejectUnexpectedKeys(record, ["level"], label);

  return {
    level: requireWearableConfidenceLevel(record.level, `${label}.level`),
  };
}

function extractIsoDate(value: string): string {
  return requireCanonicalUtcIsoDateTime(
    value,
    "Browser vault snapshot generatedAt",
  ).slice(0, 10);
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

function rejectUnexpectedKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const unexpectedKeys = Object.keys(record).filter((key) => !allowedKeys.includes(key));

  if (unexpectedKeys.length === 0) {
    return;
  }

  throw new TypeError(
    `${label} contains unexpected field(s): ${unexpectedKeys.sort().join(", ")}.`,
  );
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

function requireIsoDateTime(value: unknown, label: string): string {
  const isoDateTime = requireString(value, label);
  return requireCanonicalUtcIsoDateTime(isoDateTime, label);
}

function requireCanonicalUtcIsoDateTime(value: string, label: string): string {
  const parsedMs = Date.parse(value);

  if (!Number.isFinite(parsedMs)) {
    throw new TypeError(`${label} must be a valid ISO datetime.`);
  }

  const canonicalIsoDateTime = new Date(parsedMs).toISOString();

  if (canonicalIsoDateTime !== value) {
    throw new TypeError(`${label} must be a valid ISO datetime.`);
  }

  return canonicalIsoDateTime;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, label);
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function readNullableFiniteNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireFiniteNumber(value, label);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return value;
}

function readNullableNonNegativeInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireNonNegativeInteger(value, label);
}

function requireWearableConfidenceLevel(
  value: unknown,
  label: string,
): WearableSummaryConfidence["level"] {
  const level = requireString(value, label);

  if (level !== "none" && level !== "low" && level !== "medium" && level !== "high") {
    throw new TypeError(`${label} must be none, low, medium, or high.`);
  }

  return level;
}

function requireTimelineEntryType(
  value: unknown,
  label: string,
): BrowserVaultHistoryEntry["entryType"] {
  const entryType = requireString(value, label);

  if (
    entryType !== "assessment" &&
    entryType !== "event" &&
    entryType !== "journal" &&
    entryType !== "sample_summary"
  ) {
    throw new TypeError(`${label} must be assessment, event, journal, or sample_summary.`);
  }

  return entryType;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) =>
    requireString(entry, `${label}[${index}]`)
  );
}
