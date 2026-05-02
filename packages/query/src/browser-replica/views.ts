import type { CanonicalEntity, CanonicalEntityFamily } from "../canonical-entities.ts";
import {
  buildOverviewMetrics,
  type OverviewExperiment,
  summarizeRecentOverviewJournals,
  summarizeOverviewExperiments,
} from "../overview.ts";
import type { VaultReadModel } from "../read-model.ts";
import {
  RECENT_JOURNAL_LIMIT,
  TIMELINE_LIMIT,
  TRACKED_EXPERIMENT_LIMIT,
  type BrowserVaultActivitySummary,
  type BrowserVaultBodyStateSummary,
  type BrowserVaultEntity,
  type BrowserVaultMetricRow,
  type BrowserVaultOverviewView,
  type BrowserVaultQueryClient,
  type BrowserVaultRecoverySummary,
  type BrowserVaultReplica,
  type BrowserVaultResolvedMetric,
  type BrowserVaultSignalsView,
  type BrowserVaultSleepSummary,
  type BrowserVaultTimelineRow,
} from "./shared.ts";

export function selectBrowserVaultOverview(client: BrowserVaultQueryClient): BrowserVaultOverviewView {
  const vault = vaultViewFromReplica(client.replica);
  return {
    metrics: buildOverviewMetrics(vault),
    recentJournals: summarizeRecentOverviewJournals(vault, RECENT_JOURNAL_LIMIT),
    trackedExperiments: summarizeOverviewExperiments(vault, TRACKED_EXPERIMENT_LIMIT),
    weeklySampleSummaries: client.replica.weeklySampleSummaries.slice(),
  };
}

export function selectBrowserVaultHistory(client: BrowserVaultQueryClient): { timeline: BrowserVaultTimelineRow[] } {
  return { timeline: client.timeline.list().slice(0, TIMELINE_LIMIT) };
}

export function selectBrowserVaultTrackedExperiments(client: BrowserVaultQueryClient): OverviewExperiment[] {
  return selectBrowserVaultOverview(client).trackedExperiments;
}

export function selectBrowserVaultSignals(client: BrowserVaultQueryClient): BrowserVaultSignalsView {
  const rowsByDate = groupMetricRowsByDate(client.replica.metricRows);
  const dates = [...rowsByDate.keys()].sort((left, right) => right.localeCompare(left));
  return {
    activity: dates.map((date) => dateToActivitySummary(date, rowsByDate.get(date) ?? [])).filter(hasActivityData),
    assistantSummary: {
      highlights: client.replica.assistantSummary.highlights.slice(),
      latestDate: client.replica.assistantSummary.latestDate,
    },
    bodyState: dates.map((date) => dateToBodyStateSummary(date, rowsByDate.get(date) ?? [])).filter(hasBodyData),
    recovery: dates.map((date) => dateToRecoverySummary(date, rowsByDate.get(date) ?? [])).filter(hasRecoveryData),
    sleep: dates.map((date) => dateToSleepSummary(date, rowsByDate.get(date) ?? [])).filter(hasSleepData),
    sourceHealth: client.replica.sourceHealthRows.slice(),
  };
}

function groupMetricRowsByDate(rows: readonly BrowserVaultMetricRow[]): Map<string, BrowserVaultMetricRow[]> {
  const output = new Map<string, BrowserVaultMetricRow[]>();
  for (const row of rows) {
    const bucket = output.get(row.date) ?? [];
    bucket.push(row);
    output.set(row.date, bucket);
  }
  return output;
}

function dateToActivitySummary(date: string, rows: readonly BrowserVaultMetricRow[]): BrowserVaultActivitySummary {
  return {
    activeCalories: emptyMetric(),
    activityScore: emptyMetric(),
    activityTypes: [],
    altitudeChangeMeters: emptyMetric(),
    date,
    dayStrain: emptyMetric(),
    distanceKm: emptyMetric(),
    estimatedVo2Max: metric(rows, "estimated-vo2-max"),
    maxHeartRate: emptyMetric(),
    notes: [],
    percentRecorded: emptyMetric(),
    sessionCount: emptyMetric(),
    sessionMinutes: metric(rows, "activity-minutes"),
    steps: metric(rows, "steps"),
    summaryConfidence: { level: confidenceForRows(rows, ["steps", "activity-minutes", "estimated-vo2-max"]) },
    totalElevationGainMeters: emptyMetric(),
    workoutStrain: emptyMetric(),
  };
}

function dateToSleepSummary(date: string, rows: readonly BrowserVaultMetricRow[]): BrowserVaultSleepSummary {
  return {
    averageHeartRate: emptyMetric(),
    awakeMinutes: emptyMetric(),
    date,
    deepMinutes: metric(rows, "deep-sleep-minutes"),
    hrv: metric(rows, "hrv-rmssd"),
    lightMinutes: emptyMetric(),
    lowestHeartRate: emptyMetric(),
    notes: [],
    remMinutes: metric(rows, "rem-sleep-minutes"),
    respiratoryRate: emptyMetric(),
    sessionMinutes: metric(rows, "total-sleep-minutes"),
    sleepConsistency: emptyMetric(),
    sleepEfficiency: emptyMetric(),
    sleepEndAt: null,
    sleepPerformance: emptyMetric(),
    sleepScore: metric(rows, "sleep-score"),
    sleepStartAt: null,
    sleepWindowProvider: null,
    spo2: emptyMetric(),
    summaryConfidence: { level: confidenceForRows(rows, ["total-sleep-minutes", "sleep-score", "deep-sleep-minutes", "rem-sleep-minutes"]) },
    timeInBedMinutes: emptyMetric(),
    totalSleepMinutes: metric(rows, "total-sleep-minutes"),
  };
}

function dateToRecoverySummary(date: string, rows: readonly BrowserVaultMetricRow[]): BrowserVaultRecoverySummary {
  const recoveryRows = rows.filter((row) => row.sourceKind === "wearable-summary" || row.metricKey === "readiness-score" || row.metricKey === "resting-heart-rate");
  return {
    bodyBattery: emptyMetric(),
    date,
    hrv: metric(recoveryRows, "hrv-rmssd"),
    notes: [],
    readinessScore: metric(recoveryRows, "readiness-score"),
    recoveryScore: metric(recoveryRows, "readiness-score"),
    respiratoryRate: emptyMetric(),
    restingHeartRate: metric(recoveryRows, "resting-heart-rate"),
    spo2: emptyMetric(),
    stressLevel: emptyMetric(),
    summaryConfidence: { level: confidenceForRows(recoveryRows, ["readiness-score", "resting-heart-rate", "hrv-rmssd"]) },
    temperature: emptyMetric(),
    temperatureDeviation: emptyMetric(),
  };
}

function dateToBodyStateSummary(date: string, rows: readonly BrowserVaultMetricRow[]): BrowserVaultBodyStateSummary {
  return {
    bmi: emptyMetric(),
    bodyFatPercentage: metric(rows, "body-fat-percentage"),
    date,
    notes: [],
    summaryConfidence: { level: confidenceForRows(rows, ["body-weight", "body-fat-percentage"]) },
    temperature: emptyMetric(),
    weightKg: metric(rows, "body-weight"),
  };
}

function hasActivityData(entry: BrowserVaultActivitySummary): boolean {
  return entry.steps.selection.value !== null || entry.sessionMinutes.selection.value !== null;
}
function hasSleepData(entry: BrowserVaultSleepSummary): boolean {
  return entry.totalSleepMinutes.selection.value !== null || entry.sleepScore.selection.value !== null;
}
function hasRecoveryData(entry: BrowserVaultRecoverySummary): boolean {
  return entry.readinessScore.selection.value !== null || entry.restingHeartRate.selection.value !== null || entry.hrv.selection.value !== null;
}
function hasBodyData(entry: BrowserVaultBodyStateSummary): boolean {
  return entry.weightKg.selection.value !== null || entry.bodyFatPercentage.selection.value !== null;
}

function metric(rows: readonly BrowserVaultMetricRow[], metricKey: string): BrowserVaultResolvedMetric {
  const row = rows.find((candidate) => candidate.metricKey === metricKey && candidate.value !== null);
  return { selection: { unit: row?.unit ?? null, value: row?.value ?? null } };
}

function emptyMetric(): BrowserVaultResolvedMetric {
  return { selection: { unit: null, value: null } };
}

function confidenceForRows(rows: readonly BrowserVaultMetricRow[], metricKeys: readonly string[]) {
  const row = rows.find((candidate) => metricKeys.includes(candidate.metricKey) && candidate.value !== null);
  return row?.confidence ?? "none";
}

function vaultViewFromReplica(replica: BrowserVaultReplica): VaultReadModel {
  const byFamily: Partial<Record<CanonicalEntityFamily, CanonicalEntity[]>> = {};
  const entities = replica.entities.map(entityFromBrowserEntity);
  for (const entity of entities) {
    byFamily[entity.family] = byFamily[entity.family] ?? [];
    byFamily[entity.family]?.push(entity);
  }
  return {
    allergies: byFamily.allergy ?? [],
    assessments: byFamily.assessment ?? [],
    audits: [],
    byFamily,
    conditions: byFamily.condition ?? [],
    coreDocument: null,
    entities,
    events: byFamily.event ?? [],
    experiments: byFamily.experiment ?? [],
    familyMembers: byFamily.family ?? [],
    foods: [],
    format: "murph.query.v1",
    geneticVariants: byFamily.genetics ?? [],
    goals: byFamily.goal ?? [],
    journalEntries: byFamily.journal ?? [],
    metadata: null,
    protocols: byFamily.protocol ?? [],
    providers: byFamily.provider ?? [],
    regimens: byFamily.regimen ?? [],
    recipes: [],
    samples: byFamily.sample ?? [],
    vaultRoot: "browser-vault-replica",
    workoutFormats: byFamily.workout_format ?? [],
  };
}

function entityFromBrowserEntity(entity: BrowserVaultEntity): CanonicalEntity {
  return {
    attributes: cloneRecord(entity.attributes),
    body: entity.bodyPreview,
    date: entity.date,
    entityId: entity.id,
    experimentSlug: entity.experimentSlug,
    family: entity.family as CanonicalEntityFamily,
    frontmatter: cloneRecord(entity.attributes),
    kind: entity.kind,
    links: entity.links.map((link) => ({ targetId: link.targetId, type: link.type as CanonicalEntity["links"][number]["type"] })),
    lookupIds: entity.lookupIds.slice(),
    occurredAt: entity.occurredAt,
    path: `browser://${entity.id}`,
    primaryLookupId: entity.lookupIds[0] ?? entity.id,
    recordClass: entity.recordClass,
    relatedIds: entity.links.map((link) => link.targetId),
    status: entity.status,
    stream: entity.stream,
    tags: entity.tags.slice(),
    title: entity.title,
  };
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isBrowserSafeJson(entry)) output[key] = JSON.parse(JSON.stringify(entry));
  }
  return output;
}

function isBrowserSafeJson(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isBrowserSafeJson);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every(isBrowserSafeJson);
  return false;
}
