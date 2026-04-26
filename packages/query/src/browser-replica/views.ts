import type { CanonicalEntity, CanonicalEntityFamily } from "../canonical-entities.ts";
import {
  buildOverviewMetrics,
  type OverviewExperiment,
  summarizeRecentOverviewJournals,
  summarizeOverviewExperiments,
} from "../overview.ts";
import type { VaultReadModel } from "../read-model.ts";
import {
  type BrowserVaultMetricDayRow,
  RECENT_JOURNAL_LIMIT,
  TIMELINE_LIMIT,
  TRACKED_EXPERIMENT_LIMIT,
  type BrowserVaultActivitySummary,
  type BrowserVaultBodyStateSummary,
  type BrowserVaultEntity,
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
  return {
    timeline: client.timeline.list().slice(0, TIMELINE_LIMIT),
  };
}

export function selectBrowserVaultTrackedExperiments(client: BrowserVaultQueryClient): OverviewExperiment[] {
  return selectBrowserVaultOverview(client).trackedExperiments;
}

export function selectBrowserVaultSignals(client: BrowserVaultQueryClient): BrowserVaultSignalsView {
  return {
    activity: client.metricDays.list({ domain: "activity" }).map(dayToActivitySummary),
    assistantSummary: {
      highlights: client.replica.assistantSummary.highlights.slice(),
      latestDate: client.replica.assistantSummary.latestDate,
    },
    bodyState: client.metricDays.list({ domain: "body_state" }).map(dayToBodyStateSummary),
    recovery: client.metricDays.list({ domain: "recovery" }).map(dayToRecoverySummary),
    sleep: client.metricDays.list({ domain: "sleep" }).map(dayToSleepSummary),
    sourceHealth: client.replica.sourceHealthRows.slice(),
  };
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
    links: entity.links.map((link) => ({
      targetId: link.targetId,
      type: link.type as CanonicalEntity["links"][number]["type"],
    })),
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

function dayToActivitySummary(day: BrowserVaultMetricDayRow): BrowserVaultActivitySummary {
  return {
    activityScore: metric(day, "activityScore"),
    activeCalories: metric(day, "activeCalories"),
    activityTypes: readStringArray(day.attributes.activityTypes),
    altitudeChangeMeters: metric(day, "altitudeChangeMeters"),
    date: day.date,
    dayStrain: metric(day, "dayStrain"),
    distanceKm: metric(day, "distanceKm"),
    estimatedVo2Max: metric(day, "estimatedVo2Max"),
    maxHeartRate: metric(day, "maxHeartRate"),
    notes: day.notes.slice(),
    percentRecorded: metric(day, "percentRecorded"),
    sessionCount: metric(day, "sessionCount"),
    sessionMinutes: metric(day, "sessionMinutes"),
    steps: metric(day, "steps"),
    summaryConfidence: { level: day.confidence },
    totalElevationGainMeters: metric(day, "totalElevationGainMeters"),
    workoutStrain: metric(day, "workoutStrain"),
  };
}

function dayToSleepSummary(day: BrowserVaultMetricDayRow): BrowserVaultSleepSummary {
  return {
    averageHeartRate: metric(day, "averageHeartRate"),
    awakeMinutes: metric(day, "awakeMinutes"),
    date: day.date,
    deepMinutes: metric(day, "deepMinutes"),
    hrv: metric(day, "hrv"),
    lightMinutes: metric(day, "lightMinutes"),
    lowestHeartRate: metric(day, "lowestHeartRate"),
    notes: day.notes.slice(),
    remMinutes: metric(day, "remMinutes"),
    respiratoryRate: metric(day, "respiratoryRate"),
    sessionMinutes: metric(day, "sessionMinutes"),
    sleepConsistency: metric(day, "sleepConsistency"),
    sleepEfficiency: metric(day, "sleepEfficiency"),
    sleepEndAt: readNullableString(day.attributes.sleepEndAt),
    sleepPerformance: metric(day, "sleepPerformance"),
    sleepScore: metric(day, "sleepScore"),
    sleepStartAt: readNullableString(day.attributes.sleepStartAt),
    sleepWindowProvider: readNullableString(day.attributes.sleepWindowProvider),
    spo2: metric(day, "spo2"),
    summaryConfidence: { level: day.confidence },
    timeInBedMinutes: metric(day, "timeInBedMinutes"),
    totalSleepMinutes: metric(day, "totalSleepMinutes"),
  };
}

function dayToRecoverySummary(day: BrowserVaultMetricDayRow): BrowserVaultRecoverySummary {
  return {
    bodyBattery: metric(day, "bodyBattery"),
    date: day.date,
    hrv: metric(day, "hrv"),
    notes: day.notes.slice(),
    readinessScore: metric(day, "readinessScore"),
    recoveryScore: metric(day, "recoveryScore"),
    respiratoryRate: metric(day, "respiratoryRate"),
    restingHeartRate: metric(day, "restingHeartRate"),
    spo2: metric(day, "spo2"),
    stressLevel: metric(day, "stressLevel"),
    summaryConfidence: { level: day.confidence },
    temperature: metric(day, "temperature"),
    temperatureDeviation: metric(day, "temperatureDeviation"),
  };
}

function dayToBodyStateSummary(day: BrowserVaultMetricDayRow): BrowserVaultBodyStateSummary {
  return {
    bmi: metric(day, "bmi"),
    bodyFatPercentage: metric(day, "bodyFatPercentage"),
    date: day.date,
    notes: day.notes.slice(),
    summaryConfidence: { level: day.confidence },
    temperature: metric(day, "temperature"),
    weightKg: metric(day, "weightKg"),
  };
}

function metric(day: BrowserVaultMetricDayRow, key: string): BrowserVaultResolvedMetric {
  return day.metrics[key] ?? { selection: { unit: null, value: null } };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError("Expected nullable string.");
  }

  return value;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (isBrowserSafeJson(entry)) {
      output[key] = cloneJson(entry);
    }
  }

  return output;
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function isBrowserSafeJson(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isBrowserSafeJson);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isBrowserSafeJson);
  }

  return false;
}
