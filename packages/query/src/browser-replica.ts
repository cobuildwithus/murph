import {
  buildOverviewMetrics,
  buildOverviewWeeklyStatsFromDailySampleSummaries,
  isActiveOverviewExperimentStatus,
  summarizeOverviewExperiments,
  summarizeRecentOverviewJournals,
  type OverviewExperiment,
  type OverviewJournalEntry,
  type OverviewMetric,
  type OverviewWeeklySampleSummary,
} from "./overview.ts";
import type { CanonicalEntity, CanonicalEntityFamily, CanonicalRecordClass } from "./canonical-entities.ts";
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

export const BROWSER_VAULT_REPLICA_SCHEMA = "murph.browser-vault-replica.v1";
export const BROWSER_VAULT_REPLICA_POLICY_ID = "health-vault-browser-v1";

const BODY_PREVIEW_CHARS = 280;
const METRIC_LOOKBACK_DAYS = 365;
const RECENT_JOURNAL_LIMIT = 4;
const TRACKED_EXPERIMENT_LIMIT = 24;
const TIMELINE_LIMIT = 240;
const SIGNAL_LIMIT = 30;
const SOURCE_HEALTH_LIMIT = 24;
const WEEKLY_SAMPLE_LOOKBACK_DAYS = 365;

const INCLUDED_FAMILIES = [
  "allergy",
  "assessment",
  "condition",
  "event",
  "experiment",
  "family",
  "genetics",
  "goal",
  "journal",
  "protocol",
  "provider",
  "sample",
  "workout_format",
] as const;

const EXCLUDED_FAMILIES = [
  "audit",
  "core",
  "food",
  "recipe",
] as const;

export type BrowserVaultEntityFamily = (typeof INCLUDED_FAMILIES)[number];
export type BrowserVaultMetricDomain = "activity" | "body_state" | "recovery" | "sleep";

export interface BrowserVaultReplicaPolicy {
  bodyPreviewChars: number;
  excludedFamilies: string[];
  id: typeof BROWSER_VAULT_REPLICA_POLICY_ID;
  includedFamilies: string[];
  metricLookbackDays: number;
}

export interface BrowserVaultReplicaSource {
  dataVersion: string;
  sourceBundleHash: string;
}

export interface BrowserVaultEntityLink {
  targetId: string;
  type: string;
}

export interface BrowserVaultEntity {
  attributes: Record<string, unknown>;
  bodyPreview: string | null;
  date: string | null;
  experimentSlug: string | null;
  family: string;
  id: string;
  kind: string;
  links: BrowserVaultEntityLink[];
  lookupIds: string[];
  occurredAt: string | null;
  recordClass: CanonicalRecordClass;
  status: string | null;
  stream: string | null;
  tags: string[];
  title: string | null;
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

export interface BrowserVaultMetricRow {
  confidence: WearableConfidenceLevel;
  date: string;
  domain: BrowserVaultMetricDomain;
  id: string;
  metric: string;
  recordIds: string[];
  sourceFamily: string | null;
  sourceKind: string | null;
  unit: string | null;
  value: number | null;
}

export interface BrowserVaultMetricDayRow {
  attributes: Record<string, unknown>;
  confidence: WearableConfidenceLevel;
  date: string;
  domain: BrowserVaultMetricDomain;
  id: string;
  metricIds: string[];
  metrics: Record<string, BrowserVaultResolvedMetric>;
  notes: string[];
}

export interface BrowserVaultTimelineRow {
  date: string;
  entityId: string;
  entryType: TimelineEntry["entryType"];
  family: string;
  id: string;
  kind: string;
  occurredAt: string;
  stream: string | null;
  tags: string[];
  title: string;
}

export interface BrowserVaultSearchRow {
  date: string | null;
  entityId: string;
  family: string;
  id: string;
  kind: string;
  occurredAt: string | null;
  tags: string[];
  text: string;
  title: string | null;
}

export interface BrowserVaultSourceHealthRow {
  activityDays: number;
  bodyStateDays: number;
  conflictCount: number;
  firstDate: string | null;
  lastDate: string | null;
  latestRecordedAt: string | null;
  provider: string;
  providerDisplayName: string;
  recoveryDays: number;
  selectedMetrics: number;
  sleepNights: number;
  stalenessVsNewestDays: number | null;
}

export interface BrowserVaultAssistantSummary {
  highlights: string[];
  latestDate: string | null;
}

export interface BrowserVaultReplica {
  assistantSummary: BrowserVaultAssistantSummary;
  entities: BrowserVaultEntity[];
  generatedAt: string;
  metricDayRows: BrowserVaultMetricDayRow[];
  metricRows: BrowserVaultMetricRow[];
  policy: BrowserVaultReplicaPolicy;
  schema: typeof BROWSER_VAULT_REPLICA_SCHEMA;
  searchRows: BrowserVaultSearchRow[];
  source: BrowserVaultReplicaSource;
  sourceHealthRows: BrowserVaultSourceHealthRow[];
  timelineRows: BrowserVaultTimelineRow[];
  weeklySampleSummaries: OverviewWeeklySampleSummary[];
}

export interface CreateBrowserVaultReplicaInput {
  generatedAt?: string;
  sourceBundleHash: string;
  vault: VaultReadModel;
}

export async function createBrowserVaultReplica(
  input: CreateBrowserVaultReplicaInput,
): Promise<BrowserVaultReplica> {
  const generatedAt = input.generatedAt
    ? requireIsoDateTime(input.generatedAt, "Browser vault replica generatedAt")
    : new Date().toISOString();
  const policy = createBrowserVaultReplicaPolicy();
  const entities = input.vault.entities
    .filter((entity) => isBrowserVaultIncludedFamily(entity.family))
    .map(projectEntity);
  const timelineRows = buildTimeline(input.vault, { limit: TIMELINE_LIMIT })
    .map(projectTimelineRow);
  const weeklySampleSummaries = projectWeeklySampleSummaries(input.vault, generatedAt);
  const activity = summarizeWearableActivity(input.vault, { limit: SIGNAL_LIMIT });
  const sleep = summarizeWearableSleep(input.vault, { limit: SIGNAL_LIMIT });
  const recovery = summarizeWearableRecovery(input.vault, { limit: SIGNAL_LIMIT });
  const bodyState = summarizeWearableBodyState(input.vault, { limit: SIGNAL_LIMIT });
  const metricDayRows = [
    ...activity.map(projectActivityMetricDayRow),
    ...sleep.map(projectSleepMetricDayRow),
    ...recovery.map(projectRecoveryMetricDayRow),
    ...bodyState.map(projectBodyStateMetricDayRow),
  ];
  const metricRows = metricDayRows.flatMap((day) => dayToMetricRows(day));
  const sourceHealthRows = summarizeWearableSourceHealth(input.vault, { limit: SOURCE_HEALTH_LIMIT })
    .map(projectSourceHealthRow);
  const replicaWithoutVersion: BrowserVaultReplica = {
    assistantSummary: projectWearableAssistantSummary(buildWearableAssistantSummary(input.vault)),
    entities,
    generatedAt,
    metricDayRows,
    metricRows,
    policy,
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: entities.map(projectSearchRow),
    source: {
      dataVersion: "pending",
      sourceBundleHash: requireString(input.sourceBundleHash, "Browser vault replica sourceBundleHash"),
    },
    sourceHealthRows,
    timelineRows,
    weeklySampleSummaries,
  };
  const dataVersion = await hashBrowserVaultReplicaData(replicaWithoutVersion);

  return {
    ...replicaWithoutVersion,
    source: {
      ...replicaWithoutVersion.source,
      dataVersion,
    },
  };
}

export async function hashBrowserVaultReplicaData(replica: BrowserVaultReplica): Promise<string> {
  const stableReplica = {
    ...replica,
    generatedAt: "",
    source: {
      ...replica.source,
      dataVersion: "pending",
    },
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableStringify(stableReplica)),
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function parseBrowserVaultReplica(
  value: unknown,
  label = "Browser vault replica",
): BrowserVaultReplica {
  const record = requireRecord(value, label);
  const schema = requireString(record.schema, `${label}.schema`);

  if (schema !== BROWSER_VAULT_REPLICA_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${BROWSER_VAULT_REPLICA_SCHEMA}.`);
  }

  return {
    assistantSummary: parseAssistantSummary(record.assistantSummary, `${label}.assistantSummary`),
    entities: requireArray(record.entities, `${label}.entities`).map((entry, index) =>
      parseEntity(entry, `${label}.entities[${index}]`)
    ),
    generatedAt: requireIsoDateTime(record.generatedAt, `${label}.generatedAt`),
    metricDayRows: requireArray(record.metricDayRows, `${label}.metricDayRows`).map((entry, index) =>
      parseMetricDayRow(entry, `${label}.metricDayRows[${index}]`)
    ),
    metricRows: requireArray(record.metricRows, `${label}.metricRows`).map((entry, index) =>
      parseMetricRow(entry, `${label}.metricRows[${index}]`)
    ),
    policy: parsePolicy(record.policy, `${label}.policy`),
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: requireArray(record.searchRows, `${label}.searchRows`).map((entry, index) =>
      parseSearchRow(entry, `${label}.searchRows[${index}]`)
    ),
    source: parseSource(record.source, `${label}.source`),
    sourceHealthRows: requireArray(record.sourceHealthRows, `${label}.sourceHealthRows`).map((entry, index) =>
      parseSourceHealthRow(entry, `${label}.sourceHealthRows[${index}]`)
    ),
    timelineRows: requireArray(record.timelineRows, `${label}.timelineRows`).map((entry, index) =>
      parseTimelineRow(entry, `${label}.timelineRows[${index}]`)
    ),
    weeklySampleSummaries: requireArray(record.weeklySampleSummaries, `${label}.weeklySampleSummaries`).map((entry, index) =>
      parseWeeklySampleSummary(entry, `${label}.weeklySampleSummaries[${index}]`)
    ),
  };
}

export interface BrowserVaultEntityFilters {
  families?: readonly string[];
  from?: string;
  ids?: readonly string[];
  kinds?: readonly string[];
  statuses?: readonly string[];
  tags?: readonly string[];
  text?: string;
  to?: string;
}

export interface BrowserVaultMetricFilters {
  domain?: BrowserVaultMetricDomain;
  from?: string;
  metric?: string;
  to?: string;
}

export interface BrowserVaultTimelineFilters {
  families?: readonly string[];
  from?: string;
  kinds?: readonly string[];
  tags?: readonly string[];
  to?: string;
}

export interface BrowserVaultSearchFilters {
  families?: readonly string[];
}

export interface BrowserVaultQueryClient {
  entities: {
    get(idOrLookupId: string): BrowserVaultEntity | null;
    list(filters?: BrowserVaultEntityFilters): BrowserVaultEntity[];
  };
  metricDays: {
    list(filters?: BrowserVaultMetricFilters): BrowserVaultMetricDayRow[];
  };
  metrics: {
    latest(filters?: BrowserVaultMetricFilters): BrowserVaultMetricRow | null;
    list(filters?: BrowserVaultMetricFilters): BrowserVaultMetricRow[];
    series(filters?: BrowserVaultMetricFilters): BrowserVaultMetricRow[];
  };
  replica: BrowserVaultReplica;
  search(query: string, filters?: BrowserVaultSearchFilters): BrowserVaultSearchRow[];
  timeline: {
    list(filters?: BrowserVaultTimelineFilters): BrowserVaultTimelineRow[];
  };
}

export function createBrowserVaultQueryClient(replica: BrowserVaultReplica): BrowserVaultQueryClient {
  const byLookupId = new Map<string, BrowserVaultEntity>();

  for (const entity of replica.entities) {
    byLookupId.set(entity.id, entity);
    for (const lookupId of entity.lookupIds) {
      byLookupId.set(lookupId, entity);
    }
  }

  return {
    entities: {
      get(idOrLookupId) {
        return byLookupId.get(idOrLookupId) ?? null;
      },
      list(filters = {}) {
        return replica.entities.filter((entity) => matchesEntityFilters(entity, filters));
      },
    },
    metricDays: {
      list(filters = {}) {
        return replica.metricDayRows.filter((row) => matchesMetricDayFilters(row, filters));
      },
    },
    metrics: {
      latest(filters = {}) {
        return replica.metricRows.find((row) => matchesMetricFilters(row, filters)) ?? null;
      },
      list(filters = {}) {
        return replica.metricRows.filter((row) => matchesMetricFilters(row, filters));
      },
      series(filters = {}) {
        return replica.metricRows.filter((row) => matchesMetricFilters(row, filters)).slice().reverse();
      },
    },
    replica,
    search(query, filters = {}) {
      const normalizedQuery = normalizeSearch(query);
      const familySet = filters.families ? new Set(filters.families) : null;

      if (normalizedQuery.length === 0) {
        return [];
      }

      return replica.searchRows.filter((row) => {
        if (familySet && !familySet.has(row.family)) {
          return false;
        }

        return normalizeSearch(row.text).includes(normalizedQuery);
      });
    },
    timeline: {
      list(filters = {}) {
        return replica.timelineRows.filter((row) => matchesTimelineFilters(row, filters));
      },
    },
  };
}

export interface BrowserVaultOverviewView {
  metrics: OverviewMetric[];
  recentJournals: OverviewJournalEntry[];
  trackedExperiments: OverviewExperiment[];
  weeklySampleSummaries: OverviewWeeklySampleSummary[];
}

export interface BrowserVaultSignalsView {
  activity: BrowserVaultActivitySummary[];
  assistantSummary: BrowserVaultAssistantSummary;
  bodyState: BrowserVaultBodyStateSummary[];
  recovery: BrowserVaultRecoverySummary[];
  sleep: BrowserVaultSleepSummary[];
  sourceHealth: BrowserVaultSourceHealthRow[];
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

function createBrowserVaultReplicaPolicy(): BrowserVaultReplicaPolicy {
  return {
    bodyPreviewChars: BODY_PREVIEW_CHARS,
    excludedFamilies: EXCLUDED_FAMILIES.slice(),
    id: BROWSER_VAULT_REPLICA_POLICY_ID,
    includedFamilies: INCLUDED_FAMILIES.slice(),
    metricLookbackDays: METRIC_LOOKBACK_DAYS,
  };
}

function isBrowserVaultIncludedFamily(family: string): boolean {
  return (INCLUDED_FAMILIES as readonly string[]).includes(family);
}

function projectEntity(entity: CanonicalEntity): BrowserVaultEntity {
  return {
    attributes: projectSafeAttributes(entity),
    bodyPreview: previewText(entity.body, BODY_PREVIEW_CHARS),
    date: entity.date,
    experimentSlug: entity.experimentSlug,
    family: entity.family,
    id: entity.entityId,
    kind: entity.kind,
    links: entity.links.map((link) => ({ targetId: link.targetId, type: link.type })),
    lookupIds: uniqueStrings([entity.primaryLookupId, ...entity.lookupIds, entity.entityId]),
    occurredAt: entity.occurredAt,
    recordClass: entity.recordClass,
    status: entity.status,
    stream: entity.stream,
    tags: entity.tags.slice(),
    title: entity.title,
  };
}

function projectSafeAttributes(entity: CanonicalEntity): Record<string, unknown> {
  const source = entity.frontmatter ?? entity.attributes;
  const allowed: Record<string, unknown> = {};

  for (const key of [
    "analysisPlan",
    "assistantSupport",
    "baselineEnd",
    "baselineStart",
    "category",
    "completedAt",
    "endedOn",
    "group",
    "metric",
    "onboarding",
    "outcome",
    "outcomeRef",
    "protocolRef",
    "runPlan",
    "startedOn",
    "status",
    "summary",
    "unit",
    "value",
  ]) {
    if (source[key] !== undefined && isBrowserSafeJson(source[key])) {
      allowed[key] = cloneJson(source[key]);
    }
  }

  return allowed;
}

function projectTimelineRow(entry: TimelineEntry): BrowserVaultTimelineRow {
  return {
    date: entry.date,
    entityId: entry.id,
    entryType: entry.entryType,
    family: entry.entryType === "sample_summary" ? "sample" : entry.entryType,
    id: entry.id,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    stream: entry.stream,
    tags: entry.tags.slice(),
    title: entry.title,
  };
}

function projectSearchRow(entity: BrowserVaultEntity): BrowserVaultSearchRow {
  return {
    date: entity.date,
    entityId: entity.id,
    family: entity.family,
    id: entity.id,
    kind: entity.kind,
    occurredAt: entity.occurredAt,
    tags: entity.tags.slice(),
    text: [entity.title, entity.bodyPreview, entity.kind, entity.status, entity.stream, entity.tags.join(" ")]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join("\n"),
    title: entity.title,
  };
}

function projectWeeklySampleSummaries(vault: VaultReadModel, generatedAt: string): OverviewWeeklySampleSummary[] {
  const cutoffDate = subtractDaysFromIsoDate(generatedAt.slice(0, 10), WEEKLY_SAMPLE_LOOKBACK_DAYS);

  return summarizeDailySamples(vault)
    .filter((entry) => entry.date >= cutoffDate)
    .map(projectWeeklySampleSummary);
}

function projectWeeklySampleSummary(entry: DailySampleSummary): OverviewWeeklySampleSummary {
  return {
    date: entry.date,
    numericSampleCount: entry.numericSampleCount,
    sampleCount: entry.sampleCount,
    stream: entry.stream,
    sumValue: entry.sumValue,
    unit: entry.unit,
  };
}

function projectWearableAssistantSummary(summary: WearableAssistantSummary): BrowserVaultAssistantSummary {
  return {
    highlights: summary.highlights.slice(),
    latestDate: summary.latestDate,
  };
}

function projectActivityMetricDayRow(summary: WearableActivitySummary): BrowserVaultMetricDayRow {
  return buildMetricDayRow({
    attributes: { activityTypes: summary.activityTypes.slice() },
    confidence: summary.summaryConfidence.level,
    date: summary.date,
    domain: "activity",
    metrics: {
      activityScore: projectWearableResolvedMetric(summary.activityScore),
      activeCalories: projectWearableResolvedMetric(summary.activeCalories),
      dayStrain: projectWearableResolvedMetric(summary.dayStrain),
      distanceKm: projectWearableResolvedMetric(summary.distanceKm),
      sessionCount: projectWearableResolvedMetric(summary.sessionCount),
      sessionMinutes: projectWearableResolvedMetric(summary.sessionMinutes),
      steps: projectWearableResolvedMetric(summary.steps),
    },
    notes: summary.notes,
  });
}

function projectSleepMetricDayRow(summary: WearableSleepSummary): BrowserVaultMetricDayRow {
  return buildMetricDayRow({
    attributes: {
      sleepEndAt: summary.sleepEndAt,
      sleepStartAt: summary.sleepStartAt,
      sleepWindowProvider: summary.sleepWindowProvider,
    },
    confidence: summary.summaryConfidence.level,
    date: summary.date,
    domain: "sleep",
    metrics: {
      averageHeartRate: projectWearableResolvedMetric(summary.averageHeartRate),
      awakeMinutes: projectWearableResolvedMetric(summary.awakeMinutes),
      deepMinutes: projectWearableResolvedMetric(summary.deepMinutes),
      hrv: projectWearableResolvedMetric(summary.hrv),
      lightMinutes: projectWearableResolvedMetric(summary.lightMinutes),
      lowestHeartRate: projectWearableResolvedMetric(summary.lowestHeartRate),
      remMinutes: projectWearableResolvedMetric(summary.remMinutes),
      respiratoryRate: projectWearableResolvedMetric(summary.respiratoryRate),
      sessionMinutes: projectWearableResolvedMetric(summary.sessionMinutes),
      sleepConsistency: projectWearableResolvedMetric(summary.sleepConsistency),
      sleepEfficiency: projectWearableResolvedMetric(summary.sleepEfficiency),
      sleepPerformance: projectWearableResolvedMetric(summary.sleepPerformance),
      sleepScore: projectWearableResolvedMetric(summary.sleepScore),
      spo2: projectWearableResolvedMetric(summary.spo2),
      timeInBedMinutes: projectWearableResolvedMetric(summary.timeInBedMinutes),
      totalSleepMinutes: projectWearableResolvedMetric(summary.totalSleepMinutes),
    },
    notes: summary.notes,
  });
}

function projectRecoveryMetricDayRow(summary: WearableRecoverySummary): BrowserVaultMetricDayRow {
  return buildMetricDayRow({
    attributes: {},
    confidence: summary.summaryConfidence.level,
    date: summary.date,
    domain: "recovery",
    metrics: {
      bodyBattery: projectWearableResolvedMetric(summary.bodyBattery),
      hrv: projectWearableResolvedMetric(summary.hrv),
      readinessScore: projectWearableResolvedMetric(summary.readinessScore),
      recoveryScore: projectWearableResolvedMetric(summary.recoveryScore),
      respiratoryRate: projectWearableResolvedMetric(summary.respiratoryRate),
      restingHeartRate: projectWearableResolvedMetric(summary.restingHeartRate),
      spo2: projectWearableResolvedMetric(summary.spo2),
      stressLevel: projectWearableResolvedMetric(summary.stressLevel),
      temperature: projectWearableResolvedMetric(summary.temperature),
      temperatureDeviation: projectWearableResolvedMetric(summary.temperatureDeviation),
    },
    notes: summary.notes,
  });
}

function projectBodyStateMetricDayRow(summary: WearableBodyStateSummary): BrowserVaultMetricDayRow {
  return buildMetricDayRow({
    attributes: {},
    confidence: summary.summaryConfidence.level,
    date: summary.date,
    domain: "body_state",
    metrics: {
      bmi: projectWearableResolvedMetric(summary.bmi),
      bodyFatPercentage: projectWearableResolvedMetric(summary.bodyFatPercentage),
      temperature: projectWearableResolvedMetric(summary.temperature),
      weightKg: projectWearableResolvedMetric(summary.weightKg),
    },
    notes: summary.notes,
  });
}

function buildMetricDayRow(input: {
  attributes: Record<string, unknown>;
  confidence: WearableConfidenceLevel;
  date: string;
  domain: BrowserVaultMetricDomain;
  metrics: Record<string, BrowserVaultResolvedMetric>;
  notes: readonly string[];
}): BrowserVaultMetricDayRow {
  const metricIds = Object.keys(input.metrics).map((metric) => `${input.domain}:${input.date}:${metric}`);

  return {
    attributes: cloneRecord(input.attributes),
    confidence: input.confidence,
    date: input.date,
    domain: input.domain,
    id: `${input.domain}:${input.date}`,
    metricIds,
    metrics: cloneMetricMap(input.metrics),
    notes: input.notes.slice(),
  };
}

function dayToMetricRows(day: BrowserVaultMetricDayRow): BrowserVaultMetricRow[] {
  return Object.entries(day.metrics).map(([metric, resolved]) => ({
    confidence: day.confidence,
    date: day.date,
    domain: day.domain,
    id: `${day.id}:${metric}`,
    metric,
    recordIds: [],
    sourceFamily: "derived",
    sourceKind: "summary",
    unit: resolved.selection.unit,
    value: resolved.selection.value,
  }));
}

function projectWearableResolvedMetric(metric: WearableResolvedMetric): BrowserVaultResolvedMetric {
  return {
    selection: {
      unit: metric.selection.unit,
      value: metric.selection.value,
    },
  };
}

function projectSourceHealthRow(summary: WearableSourceHealthSummary): BrowserVaultSourceHealthRow {
  return {
    activityDays: summary.activityDays,
    bodyStateDays: summary.bodyStateDays,
    conflictCount: summary.conflictCount,
    firstDate: null,
    lastDate: summary.lastDate,
    latestRecordedAt: summary.lastDate,
    provider: summary.provider,
    providerDisplayName: summary.providerDisplayName,
    recoveryDays: summary.recoveryDays,
    selectedMetrics: summary.selectedMetrics,
    sleepNights: summary.sleepNights,
    stalenessVsNewestDays: summary.stalenessVsNewestDays,
  };
}

function dayToActivitySummary(day: BrowserVaultMetricDayRow): BrowserVaultActivitySummary {
  return {
    activityScore: metric(day, "activityScore"),
    activeCalories: metric(day, "activeCalories"),
    activityTypes: readStringArray(day.attributes.activityTypes),
    date: day.date,
    dayStrain: metric(day, "dayStrain"),
    distanceKm: metric(day, "distanceKm"),
    notes: day.notes.slice(),
    sessionCount: metric(day, "sessionCount"),
    sessionMinutes: metric(day, "sessionMinutes"),
    steps: metric(day, "steps"),
    summaryConfidence: { level: day.confidence },
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

function matchesEntityFilters(entity: BrowserVaultEntity, filters: BrowserVaultEntityFilters): boolean {
  if (filters.ids && !filters.ids.some((id) => entity.lookupIds.includes(id) || entity.id === id)) {
    return false;
  }
  if (filters.families && !filters.families.includes(entity.family)) {
    return false;
  }
  if (filters.kinds && !filters.kinds.includes(entity.kind)) {
    return false;
  }
  if (filters.statuses && (!entity.status || !filters.statuses.includes(entity.status))) {
    return false;
  }
  if (filters.tags && !filters.tags.every((tag) => entity.tags.includes(tag))) {
    return false;
  }
  if (filters.from && (entity.date ?? "") < filters.from) {
    return false;
  }
  if (filters.to && (entity.date ?? "9999-12-31") > filters.to) {
    return false;
  }
  if (filters.text) {
    return normalizeSearch([entity.title, entity.bodyPreview, entity.tags.join(" ")].join(" "))
      .includes(normalizeSearch(filters.text));
  }

  return true;
}

function matchesMetricFilters(row: BrowserVaultMetricRow, filters: BrowserVaultMetricFilters): boolean {
  if (filters.domain && row.domain !== filters.domain) {
    return false;
  }
  if (filters.metric && row.metric !== filters.metric) {
    return false;
  }
  if (filters.from && row.date < filters.from) {
    return false;
  }
  if (filters.to && row.date > filters.to) {
    return false;
  }

  return true;
}

function matchesMetricDayFilters(row: BrowserVaultMetricDayRow, filters: BrowserVaultMetricFilters): boolean {
  if (filters.domain && row.domain !== filters.domain) {
    return false;
  }
  if (filters.metric && !Object.hasOwn(row.metrics, filters.metric)) {
    return false;
  }
  if (filters.from && row.date < filters.from) {
    return false;
  }
  if (filters.to && row.date > filters.to) {
    return false;
  }

  return true;
}

function matchesTimelineFilters(row: BrowserVaultTimelineRow, filters: BrowserVaultTimelineFilters): boolean {
  if (filters.families && !filters.families.includes(row.family)) {
    return false;
  }
  if (filters.kinds && !filters.kinds.includes(row.kind)) {
    return false;
  }
  if (filters.tags && !filters.tags.every((tag) => row.tags.includes(tag))) {
    return false;
  }
  if (filters.from && row.date < filters.from) {
    return false;
  }
  if (filters.to && row.date > filters.to) {
    return false;
  }

  return true;
}

function parsePolicy(value: unknown, label: string): BrowserVaultReplicaPolicy {
  const record = requireRecord(value, label);
  const id = requireString(record.id, `${label}.id`);

  if (id !== BROWSER_VAULT_REPLICA_POLICY_ID) {
    throw new TypeError(`${label}.id must be ${BROWSER_VAULT_REPLICA_POLICY_ID}.`);
  }

  return {
    bodyPreviewChars: requireNonNegativeInteger(record.bodyPreviewChars, `${label}.bodyPreviewChars`),
    excludedFamilies: requireStringArray(record.excludedFamilies, `${label}.excludedFamilies`),
    id,
    includedFamilies: requireStringArray(record.includedFamilies, `${label}.includedFamilies`),
    metricLookbackDays: requireNonNegativeInteger(record.metricLookbackDays, `${label}.metricLookbackDays`),
  };
}

function parseSource(value: unknown, label: string): BrowserVaultReplicaSource {
  const record = requireRecord(value, label);

  return {
    dataVersion: requireString(record.dataVersion, `${label}.dataVersion`),
    sourceBundleHash: requireString(record.sourceBundleHash, `${label}.sourceBundleHash`),
  };
}

function parseEntity(value: unknown, label: string): BrowserVaultEntity {
  const record = requireRecord(value, label);

  return {
    attributes: requireRecord(record.attributes, `${label}.attributes`),
    bodyPreview: readNullableString(record.bodyPreview),
    date: readNullableString(record.date),
    experimentSlug: readNullableString(record.experimentSlug),
    family: requireString(record.family, `${label}.family`),
    id: requireString(record.id, `${label}.id`),
    kind: requireString(record.kind, `${label}.kind`),
    links: requireArray(record.links, `${label}.links`).map((entry, index) => parseEntityLink(entry, `${label}.links[${index}]`)),
    lookupIds: requireStringArray(record.lookupIds, `${label}.lookupIds`),
    occurredAt: readNullableString(record.occurredAt),
    recordClass: requireRecordClass(record.recordClass, `${label}.recordClass`),
    status: readNullableString(record.status),
    stream: readNullableString(record.stream),
    tags: requireStringArray(record.tags, `${label}.tags`),
    title: readNullableString(record.title),
  };
}

function parseEntityLink(value: unknown, label: string): BrowserVaultEntityLink {
  const record = requireRecord(value, label);

  return {
    targetId: requireString(record.targetId, `${label}.targetId`),
    type: requireString(record.type, `${label}.type`),
  };
}

function parseMetricRow(value: unknown, label: string): BrowserVaultMetricRow {
  const record = requireRecord(value, label);

  return {
    confidence: requireConfidenceLevel(record.confidence, `${label}.confidence`),
    date: requireString(record.date, `${label}.date`),
    domain: requireMetricDomain(record.domain, `${label}.domain`),
    id: requireString(record.id, `${label}.id`),
    metric: requireString(record.metric, `${label}.metric`),
    recordIds: requireStringArray(record.recordIds, `${label}.recordIds`),
    sourceFamily: readNullableString(record.sourceFamily),
    sourceKind: readNullableString(record.sourceKind),
    unit: readNullableString(record.unit),
    value: readNullableFiniteNumber(record.value),
  };
}

function parseMetricDayRow(value: unknown, label: string): BrowserVaultMetricDayRow {
  const record = requireRecord(value, label);

  return {
    attributes: requireRecord(record.attributes, `${label}.attributes`),
    confidence: requireConfidenceLevel(record.confidence, `${label}.confidence`),
    date: requireString(record.date, `${label}.date`),
    domain: requireMetricDomain(record.domain, `${label}.domain`),
    id: requireString(record.id, `${label}.id`),
    metricIds: requireStringArray(record.metricIds, `${label}.metricIds`),
    metrics: parseMetricMap(record.metrics, `${label}.metrics`),
    notes: requireStringArray(record.notes, `${label}.notes`),
  };
}

function parseTimelineRow(value: unknown, label: string): BrowserVaultTimelineRow {
  const record = requireRecord(value, label);

  return {
    date: requireString(record.date, `${label}.date`),
    entityId: requireString(record.entityId, `${label}.entityId`),
    entryType: requireTimelineEntryType(record.entryType, `${label}.entryType`),
    family: requireString(record.family, `${label}.family`),
    id: requireString(record.id, `${label}.id`),
    kind: requireString(record.kind, `${label}.kind`),
    occurredAt: requireString(record.occurredAt, `${label}.occurredAt`),
    stream: readNullableString(record.stream),
    tags: requireStringArray(record.tags, `${label}.tags`),
    title: requireString(record.title, `${label}.title`),
  };
}

function parseSearchRow(value: unknown, label: string): BrowserVaultSearchRow {
  const record = requireRecord(value, label);

  return {
    date: readNullableString(record.date),
    entityId: requireString(record.entityId, `${label}.entityId`),
    family: requireString(record.family, `${label}.family`),
    id: requireString(record.id, `${label}.id`),
    kind: requireString(record.kind, `${label}.kind`),
    occurredAt: readNullableString(record.occurredAt),
    tags: requireStringArray(record.tags, `${label}.tags`),
    text: requireString(record.text, `${label}.text`),
    title: readNullableString(record.title),
  };
}

function parseSourceHealthRow(value: unknown, label: string): BrowserVaultSourceHealthRow {
  const record = requireRecord(value, label);

  return {
    activityDays: requireNonNegativeInteger(record.activityDays, `${label}.activityDays`),
    bodyStateDays: requireNonNegativeInteger(record.bodyStateDays, `${label}.bodyStateDays`),
    conflictCount: requireNonNegativeInteger(record.conflictCount, `${label}.conflictCount`),
    firstDate: readNullableString(record.firstDate),
    lastDate: readNullableString(record.lastDate),
    latestRecordedAt: readNullableString(record.latestRecordedAt),
    provider: requireString(record.provider, `${label}.provider`),
    providerDisplayName: requireString(record.providerDisplayName, `${label}.providerDisplayName`),
    recoveryDays: requireNonNegativeInteger(record.recoveryDays, `${label}.recoveryDays`),
    selectedMetrics: requireNonNegativeInteger(record.selectedMetrics, `${label}.selectedMetrics`),
    sleepNights: requireNonNegativeInteger(record.sleepNights, `${label}.sleepNights`),
    stalenessVsNewestDays: readNullableNonNegativeInteger(record.stalenessVsNewestDays, `${label}.stalenessVsNewestDays`),
  };
}

function parseWeeklySampleSummary(value: unknown, label: string): OverviewWeeklySampleSummary {
  const record = requireRecord(value, label);

  return {
    date: requireString(record.date, `${label}.date`),
    numericSampleCount: requireNonNegativeInteger(record.numericSampleCount, `${label}.numericSampleCount`),
    sampleCount: requireNonNegativeInteger(record.sampleCount, `${label}.sampleCount`),
    stream: requireString(record.stream, `${label}.stream`),
    sumValue: readNullableFiniteNumber(record.sumValue),
    unit: readNullableString(record.unit),
  };
}

function parseAssistantSummary(value: unknown, label: string): BrowserVaultAssistantSummary {
  const record = requireRecord(value, label);

  return {
    highlights: requireStringArray(record.highlights, `${label}.highlights`),
    latestDate: readNullableString(record.latestDate),
  };
}

function parseMetricMap(value: unknown, label: string): Record<string, BrowserVaultResolvedMetric> {
  const record = requireRecord(value, label);
  const output: Record<string, BrowserVaultResolvedMetric> = {};

  for (const [key, metricValue] of Object.entries(record)) {
    output[key] = parseResolvedMetric(metricValue, `${label}.${key}`);
  }

  return output;
}

function parseResolvedMetric(value: unknown, label: string): BrowserVaultResolvedMetric {
  const record = requireRecord(value, label);
  const selection = requireRecord(record.selection, `${label}.selection`);

  return {
    selection: {
      unit: readNullableString(selection.unit),
      value: readNullableFiniteNumber(selection.value),
    },
  };
}

function cloneMetricMap(metrics: Record<string, BrowserVaultResolvedMetric>): Record<string, BrowserVaultResolvedMetric> {
  const output: Record<string, BrowserVaultResolvedMetric> = {};

  for (const [key, value] of Object.entries(metrics)) {
    output[key] = {
      selection: {
        unit: value.selection.unit,
        value: value.selection.value,
      },
    };
  }

  return output;
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

  return value.slice();
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function readNullableFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireFiniteNumber(value, "nullable number");
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = requireFiniteNumber(value, label);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return parsed;
}

function readNullableNonNegativeInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireNonNegativeInteger(value, label);
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

function requireIsoDateTime(value: unknown, label: string): string {
  const text = requireString(value, label);
  const parsed = Date.parse(text);

  if (Number.isNaN(parsed)) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  return text;
}

function requireRecordClass(value: unknown, label: string): CanonicalRecordClass {
  const text = requireString(value, label);

  if (text === "bank" || text === "ledger" || text === "sample" || text === "snapshot") {
    return text;
  }

  throw new TypeError(`${label} must be a canonical record class.`);
}

function requireMetricDomain(value: unknown, label: string): BrowserVaultMetricDomain {
  const text = requireString(value, label);

  if (text === "activity" || text === "body_state" || text === "recovery" || text === "sleep") {
    return text;
  }

  throw new TypeError(`${label} must be a browser vault metric domain.`);
}

function requireConfidenceLevel(value: unknown, label: string): WearableConfidenceLevel {
  const text = requireString(value, label);

  if (text === "none" || text === "low" || text === "medium" || text === "high") {
    return text;
  }

  throw new TypeError(`${label} must be a wearable confidence level.`);
}

function requireTimelineEntryType(value: unknown, label: string): TimelineEntry["entryType"] {
  const text = requireString(value, label);

  if (text === "assessment" || text === "event" || text === "journal" || text === "sample_summary") {
    return text;
  }

  throw new TypeError(`${label} must be a timeline entry type.`);
}

function previewText(value: string | null, limit: number): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
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

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function subtractDaysFromIsoDate(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.valueOf())) {
    throw new TypeError("Browser vault replica generatedAt date must be a valid ISO date.");
  }

  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

export {
  buildOverviewWeeklyStatsFromDailySampleSummaries,
  isActiveOverviewExperimentStatus,
};
