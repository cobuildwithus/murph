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
  type WearableSleepSummary,
  type WearableSourceHealthSummary,
} from "../wearables.ts";
import {
  extractMetricPoints,
  selectMetricGoalProgress,
  type GoalMetricTarget,
  type MetricPoint,
  type MetricRowEvidence,
} from "../metrics/index.ts";
import {
  BODY_PREVIEW_CHARS,
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  EXCLUDED_FAMILIES,
  INCLUDED_FAMILIES,
  METRIC_LOOKBACK_DAYS,
  SIGNAL_LIMIT,
  SOURCE_HEALTH_LIMIT,
  TIMELINE_LIMIT,
  WEEKLY_SAMPLE_LOOKBACK_DAYS,
  type BrowserVaultAssistantSummary,
  type BrowserVaultEntity,
  type BrowserVaultMetricGoalProgressRow,
  type BrowserVaultMetricRow,
  type BrowserVaultReplica,
  type BrowserVaultReplicaPolicy,
  type BrowserVaultSearchRow,
  type BrowserVaultSourceHealthRow,
  type BrowserVaultTimelineRow,
  type CreateBrowserVaultReplicaInput,
} from "./shared.ts";
import {
  createBrowserVaultMetricSelectionRows,
  toBrowserVaultMetricRows,
} from "./metric-points.ts";

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
  const wearableMetricRows = buildWearableMetricEvidence(input.vault);
  const allMetricPoints = extractMetricPoints({
    metricRows: wearableMetricRows,
    sampleSummaries: summarizeDailySamples(input.vault),
    vault: input.vault,
  });
  const cutoff = subtractDaysFromIsoDate(generatedAt.slice(0, 10), METRIC_LOOKBACK_DAYS);
  const metricPoints = allMetricPoints.filter((point) => point.effectiveDate >= cutoff);
  const metricRows = toBrowserVaultMetricRows({ points: metricPoints });
  const metricSelectionRows = createBrowserVaultMetricSelectionRows({ generatedAt, metricPoints });
  const sourceHealthRows = summarizeWearableSourceHealth(input.vault, { limit: SOURCE_HEALTH_LIMIT })
    .map(projectSourceHealthRow);
  const replicaWithoutVersion: BrowserVaultReplica = {
    assistantSummary: projectWearableAssistantSummary(buildWearableAssistantSummary(input.vault)),
    entities,
    generatedAt,
    metricGoalProgressRows: buildMetricGoalProgressRows(input.vault.entities, metricPoints, generatedAt),
    metricRows,
    metricSelectionRows,
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

function buildWearableMetricEvidence(vault: VaultReadModel): MetricRowEvidence[] {
  return [
    ...summarizeWearableSleep(vault, { limit: SIGNAL_LIMIT }).flatMap(sleepMetricEvidence),
    ...summarizeWearableRecovery(vault, { limit: SIGNAL_LIMIT }).flatMap(recoveryMetricEvidence),
    ...summarizeWearableActivity(vault, { limit: SIGNAL_LIMIT }).flatMap(activityMetricEvidence),
    ...summarizeWearableBodyState(vault, { limit: SIGNAL_LIMIT }).flatMap(bodyStateMetricEvidence),
  ];
}

function sleepMetricEvidence(summary: WearableSleepSummary): MetricRowEvidence[] {
  return [
    metricEvidence(summary.date, "total-sleep-minutes", summary.totalSleepMinutes.selection.value, summary.totalSleepMinutes.selection.unit, summary.summaryConfidence.level, "sleep-summary"),
    metricEvidence(summary.date, "sleep-score", summary.sleepScore.selection.value, summary.sleepScore.selection.unit, summary.summaryConfidence.level, "sleep-summary"),
    metricEvidence(summary.date, "deep-sleep-minutes", summary.deepMinutes.selection.value, summary.deepMinutes.selection.unit, summary.summaryConfidence.level, "sleep-summary"),
    metricEvidence(summary.date, "rem-sleep-minutes", summary.remMinutes.selection.value, summary.remMinutes.selection.unit, summary.summaryConfidence.level, "sleep-summary"),
    metricEvidence(summary.date, "hrv-rmssd", summary.hrv.selection.value, summary.hrv.selection.unit, summary.summaryConfidence.level, "sleep-summary"),
  ];
}

function recoveryMetricEvidence(summary: WearableRecoverySummary): MetricRowEvidence[] {
  return [
    metricEvidence(summary.date, "readiness-score", summary.readinessScore.selection.value, summary.readinessScore.selection.unit, summary.summaryConfidence.level, "wearable-summary"),
    metricEvidence(summary.date, "resting-heart-rate", summary.restingHeartRate.selection.value, summary.restingHeartRate.selection.unit, summary.summaryConfidence.level, "wearable-summary"),
    metricEvidence(summary.date, "hrv-rmssd", summary.hrv.selection.value, summary.hrv.selection.unit, summary.summaryConfidence.level, "wearable-summary"),
  ];
}

function activityMetricEvidence(summary: WearableActivitySummary): MetricRowEvidence[] {
  return [
    metricEvidence(summary.date, "steps", summary.steps.selection.value, summary.steps.selection.unit, summary.summaryConfidence.level, "activity-summary"),
    metricEvidence(summary.date, "activity-minutes", summary.sessionMinutes.selection.value, summary.sessionMinutes.selection.unit, summary.summaryConfidence.level, "activity-summary"),
    metricEvidence(summary.date, "estimated-vo2-max", summary.estimatedVo2Max.selection.value, summary.estimatedVo2Max.selection.unit, summary.summaryConfidence.level, "activity-summary"),
  ];
}

function bodyStateMetricEvidence(summary: WearableBodyStateSummary): MetricRowEvidence[] {
  return [
    metricEvidence(summary.date, "body-weight", summary.weightKg.selection.value, summary.weightKg.selection.unit, summary.summaryConfidence.level, "wearable-summary"),
    metricEvidence(summary.date, "body-fat-percentage", summary.bodyFatPercentage.selection.value, summary.bodyFatPercentage.selection.unit, summary.summaryConfidence.level, "wearable-summary"),
  ];
}

function metricEvidence(
  date: string,
  metricKey: string,
  value: number | null,
  unit: string | null,
  confidence: WearableConfidenceLevel,
  sourceKind: MetricRowEvidence["sourceKind"],
): MetricRowEvidence {
  return {
    confidence,
    date,
    metricKey,
    recordIds: [`${sourceKind}:${metricKey}:${date}`],
    sourceKind,
    sourceLabel: "Wearable summary",
    unit,
    value,
  };
}

function buildMetricGoalProgressRows(
  entities: readonly CanonicalEntity[],
  points: readonly MetricPoint[],
  now: string,
): BrowserVaultMetricGoalProgressRow[] {
  return entities
    .filter((entity) => entity.family === "goal")
    .flatMap((entity) => readGoalMetricTargets(entity).map((target) =>
      selectMetricGoalProgress({
        goalId: entity.entityId,
        now,
        points,
        target,
      }) satisfies BrowserVaultMetricGoalProgressRow
    ));
}

function readGoalMetricTargets(entity: CanonicalEntity): GoalMetricTarget[] {
  const source = entity.frontmatter ?? entity.attributes;
  const rawTargets = Array.isArray(source.metricTargets) ? source.metricTargets : [];
  return rawTargets.flatMap((target, index) => {
    if (!target || typeof target !== "object" || Array.isArray(target)) return [];
    const record = target as Record<string, unknown>;
    const metricKey = readString(record.metricKey);
    const comparator = readComparator(record.comparator);
    const value = readNumber(record.value);
    const unit = readString(record.unit);
    if (!metricKey || !comparator || value === null || !unit) return [];
    const targetId = readString(record.targetId) ?? `${entity.entityId}:metric-target:${index + 1}`;
    return [{
      biomarkerKey: readString(record.biomarkerKey) ?? undefined,
      comparator,
      evaluation: readGoalTargetEvaluation(record.evaluation),
      highValue: readNumber(record.highValue) ?? undefined,
      kind: "metric",
      metricKey,
      note: readString(record.note) ?? undefined,
      targetAt: readString(record.targetAt) ?? undefined,
      targetId,
      unit,
      value,
    } satisfies GoalMetricTarget];
  });
}

function readGoalTargetEvaluation(value: unknown): GoalMetricTarget["evaluation"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "selected-value" };
  const record = value as Record<string, unknown>;
  const kind = readString(record.kind);
  if (kind === "latest-lab") return { kind };
  if (kind === "rolling-window") {
    const statistic = readString(record.statistic);
    const windowDays = readNumber(record.windowDays);
    if ((statistic === "mean" || statistic === "median") && windowDays !== null) {
      return { kind, statistic, windowDays };
    }
  }
  return { kind: "selected-value" };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readComparator(value: unknown): GoalMetricTarget["comparator"] | null {
  return value === "<" || value === "<=" || value === ">" || value === ">=" || value === "between" ? value : null;
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
    links: projectEntityLinks(entity),
    lookupIds: projectEntityLookupIds(entity),
    occurredAt: entity.occurredAt,
    recordClass: entity.recordClass,
    status: entity.status,
    stream: entity.stream,
    tags: projectEntityTags(entity),
    title: projectEntityTitle(entity),
  };
}

function projectEntityLinks(entity: CanonicalEntity): BrowserVaultEntity["links"] {
  if (entity.family === "event") {
    return [];
  }

  return entity.links.map((link) => ({ targetId: link.targetId, type: link.type }));
}

function projectEntityLookupIds(entity: CanonicalEntity): string[] {
  if (entity.family === "event") {
    return [entity.entityId];
  }

  return uniqueStrings([entity.primaryLookupId, ...entity.lookupIds, entity.entityId]);
}

function projectEntityTags(entity: CanonicalEntity): string[] {
  if (entity.family === "event") {
    return [];
  }

  return entity.tags.slice();
}

function projectEntityTitle(entity: CanonicalEntity): string | null {
  if (entity.family === "event") {
    return null;
  }

  return entity.title;
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
        "protocolId",
        "sessionStatus",
        "sessionLocalDate",
        "scheduledLocalDate",
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
    tags: projectTimelineTags(entry),
    title: projectTimelineTitle(entry),
  };
}

function projectTimelineTags(entry: TimelineEntry): string[] {
  if (entry.entryType === "event") {
    return [];
  }

  return entry.tags.slice();
}

function projectTimelineTitle(entry: TimelineEntry): string {
  if (entry.entryType !== "event") {
    return entry.title;
  }

  switch (entry.kind) {
    case "intervention_session":
      return "Intervention session";
    case "experiment_context":
      return "Experiment context";
    default:
      return "Event";
  }
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
