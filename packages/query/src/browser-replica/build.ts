import type { CanonicalEntity } from "../canonical-entities.ts";
import type { OverviewWeeklySampleSummary } from "../overview.ts";
import { summarizeDailySamples, type DailySampleSummary } from "../summaries.ts";
import { buildTimeline, type TimelineEntry } from "../timeline.ts";
import type { VaultReadModel } from "../read-model.ts";
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
} from "../wearables.ts";
import {
  BODY_PREVIEW_CHARS,
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  EXCLUDED_FAMILIES,
  GLUCOSE_SAMPLE_STREAM,
  GLUCOSE_SAMPLE_UNIT,
  INCLUDED_FAMILIES,
  METRIC_LOOKBACK_DAYS,
  SIGNAL_LIMIT,
  SOURCE_HEALTH_LIMIT,
  TIMELINE_LIMIT,
  WEEKLY_SAMPLE_LOOKBACK_DAYS,
  type BrowserVaultAssistantSummary,
  type BrowserVaultEntity,
  type BrowserVaultMetricDayRow,
  type BrowserVaultMetricDomain,
  type BrowserVaultMetricRow,
  type BrowserVaultReplica,
  type BrowserVaultReplicaPolicy,
  type BrowserVaultResolvedMetric,
  type BrowserVaultSearchRow,
  type BrowserVaultSourceHealthRow,
  type BrowserVaultTimelineRow,
  type CreateBrowserVaultReplicaInput,
} from "./shared.ts";

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
  const glucoseSampleMetricDayRows = projectGlucoseSampleMetricDayRows(input.vault, generatedAt);
  const metricDayRows = mergeMetricDayRows([
    ...activity.map(projectActivityMetricDayRow),
    ...sleep.map(projectSleepMetricDayRow),
    ...recovery.map(projectRecoveryMetricDayRow),
    ...bodyState.map(projectBodyStateMetricDayRow),
    ...glucoseSampleMetricDayRows,
  ]);
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
    attributes: projectEntityAttributes(entity),
    bodyPreview: projectEntityBodyPreview(entity),
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

function projectEntityBodyPreview(entity: CanonicalEntity): string | null {
  if (entity.family === "event") {
    return null;
  }

  return previewText(entity.body, BODY_PREVIEW_CHARS);
}

function projectEntityAttributes(entity: CanonicalEntity): Record<string, unknown> {
  if (entity.family === "event") {
    return projectSafeEventAttributes(entity);
  }

  return projectSafeAttributes(entity);
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
    "expectedEffects",
    "expectedSignalDescriptions",
    "commonsProtocolRef",
    "effectiveProtocolSnapshot",
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

function projectSafeEventAttributes(entity: CanonicalEntity): Record<string, unknown> {
  if (entity.family !== "event") {
    return {};
  }

  switch (entity.kind) {
    case "intervention_session":
      return projectSafeAttributeKeys(entity, [
        "experimentId",
        "experimentSlug",
        "interventionType",
        "protocolId",
        "regimenId",
        "sessionStatus",
        "durationMinutes",
        "timing",
        "temperatureC",
        "afterExercise",
        "symptoms",
        "confounders",
      ]);
    case "experiment_context":
      return projectSafeAttributeKeys(entity, [
        "experimentId",
        "experimentSlug",
        "contextType",
        "severity",
      ]);
    default:
      return {};
  }
}

function projectSafeAttributeKeys(
  entity: CanonicalEntity,
  keys: readonly string[],
): Record<string, unknown> {
  const source = entity.frontmatter ?? entity.attributes;
  const allowed: Record<string, unknown> = {};

  for (const key of keys) {
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

function projectGlucoseSampleMetricDayRows(
  vault: VaultReadModel,
  generatedAt: string,
): BrowserVaultMetricDayRow[] {
  const cutoffDate = subtractDaysFromIsoDate(generatedAt.slice(0, 10), METRIC_LOOKBACK_DAYS);

  return summarizeDailySamples(vault, {
    from: cutoffDate,
    streams: [GLUCOSE_SAMPLE_STREAM],
  })
    .filter((entry) => entry.unit === GLUCOSE_SAMPLE_UNIT && entry.averageValue !== null)
    .map(projectGlucoseSampleMetricDayRow)
    .sort(compareMetricDayRows);
}

function projectGlucoseSampleMetricDayRow(summary: DailySampleSummary): BrowserVaultMetricDayRow {
  const confidence = inferSampleSummaryConfidence(summary);

  return buildMetricDayRow({
    attributes: {
      firstSampleAt: summary.firstSampleAt,
      glucoseConfidence: confidence,
      lastSampleAt: summary.lastSampleAt,
      sampleCount: summary.sampleCount,
      sourceStream: summary.stream,
    },
    confidence,
    date: summary.date,
    domain: "body_state",
    metrics: {
      glucose: {
        selection: {
          unit: GLUCOSE_SAMPLE_UNIT,
          value: summary.averageValue,
        },
      },
    },
    notes: buildGlucoseSampleNotes(summary),
  });
}

function inferSampleSummaryConfidence(summary: DailySampleSummary): WearableConfidenceLevel {
  if (summary.numericSampleCount >= 3) {
    return "medium";
  }

  return "low";
}

function buildGlucoseSampleNotes(summary: DailySampleSummary): string[] {
  const sampleLabel = summary.sampleCount === 1 ? "sample" : "samples";

  return [
    `Daily glucose summary from ${summary.sampleCount} imported ${sampleLabel}.`,
    "Glucose context is not inferred; compare same-device and same-timing readings when possible.",
  ];
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
      altitudeChangeMeters: projectWearableResolvedMetric(summary.altitudeChangeMeters),
      dayStrain: projectWearableResolvedMetric(summary.dayStrain),
      distanceKm: projectWearableResolvedMetric(summary.distanceKm),
      estimatedVo2Max: projectWearableResolvedMetric(summary.estimatedVo2Max),
      maxHeartRate: projectWearableResolvedMetric(summary.maxHeartRate),
      percentRecorded: projectWearableResolvedMetric(summary.percentRecorded),
      sessionCount: projectWearableResolvedMetric(summary.sessionCount),
      sessionMinutes: projectWearableResolvedMetric(summary.sessionMinutes),
      steps: projectWearableResolvedMetric(summary.steps),
      totalElevationGainMeters: projectWearableResolvedMetric(summary.totalElevationGainMeters),
      workoutStrain: projectWearableResolvedMetric(summary.workoutStrain),
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

function mergeMetricDayRows(rows: readonly BrowserVaultMetricDayRow[]): BrowserVaultMetricDayRow[] {
  const byId = new Map<string, BrowserVaultMetricDayRow>();

  for (const row of rows) {
    const existing = byId.get(row.id);
    byId.set(row.id, existing ? mergeMetricDayRow(existing, row) : row);
  }

  return [...byId.values()].sort(compareMetricDayRows);
}

function mergeMetricDayRow(
  left: BrowserVaultMetricDayRow,
  right: BrowserVaultMetricDayRow,
): BrowserVaultMetricDayRow {
  return buildMetricDayRow({
    attributes: {
      ...left.attributes,
      ...right.attributes,
    },
    confidence: mergedMetricDayConfidence(left, right),
    date: left.date,
    domain: left.domain,
    metrics: {
      ...left.metrics,
      ...right.metrics,
    },
    notes: uniqueStrings([...left.notes, ...right.notes]),
  });
}

function compareMetricDayRows(left: BrowserVaultMetricDayRow, right: BrowserVaultMetricDayRow): number {
  const domainDelta = metricDomainSortIndex(left.domain) - metricDomainSortIndex(right.domain);

  if (domainDelta !== 0) {
    return domainDelta;
  }

  return right.date.localeCompare(left.date);
}

function metricDomainSortIndex(domain: BrowserVaultMetricDomain): number {
  if (domain === "activity") {
    return 0;
  }
  if (domain === "sleep") {
    return 1;
  }
  if (domain === "recovery") {
    return 2;
  }

  return 3;
}

function mergedMetricDayConfidence(
  left: BrowserVaultMetricDayRow,
  right: BrowserVaultMetricDayRow,
): WearableConfidenceLevel {
  if (hasOnlyGlucoseMetric(left) && !hasOnlyGlucoseMetric(right)) {
    return right.confidence;
  }
  if (!hasOnlyGlucoseMetric(left) && hasOnlyGlucoseMetric(right)) {
    return left.confidence;
  }

  return left.confidence;
}

function hasOnlyGlucoseMetric(row: BrowserVaultMetricDayRow): boolean {
  return Object.keys(row.metrics).every((metricKey) => metricKey === "glucose");
}

function dayToMetricRows(day: BrowserVaultMetricDayRow): BrowserVaultMetricRow[] {
  return Object.entries(day.metrics).map(([metric, resolved]) => ({
    confidence: metricConfidence(day, metric),
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

function metricConfidence(day: BrowserVaultMetricDayRow, key: string): WearableConfidenceLevel {
  if (key === "glucose") {
    const glucoseConfidence = readNullableString(day.attributes.glucoseConfidence);

    if (glucoseConfidence === "low" || glucoseConfidence === "medium" || glucoseConfidence === "high") {
      return glucoseConfidence;
    }
  }

  return day.confidence;
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

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
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

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError("Expected nullable string.");
  }

  return value;
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
