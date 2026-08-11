import type { CanonicalEntity } from "../canonical-entities.ts";
import { experimentOutcomeSchema } from "@murphai/contracts";
import { metricPointRecordIds } from "../metrics/index.ts";
import { buildPersonalPatternReport } from "../personal-patterns.ts";
import { isDefaultProjectedQueryEntity } from "../query-visibility.ts";
import type { OverviewWeeklySampleSummary } from "../overview.ts";
import { summarizeDailySamples, type DailySampleSummary } from "../summaries.ts";
import { buildTimeline, type TimelineEntry } from "../timeline.ts";
import { createVaultReadModel, type VaultReadModel } from "../read-model.ts";
import { resolveAdherenceObservationActivityKind } from "../experiment-adherence.ts";
import {
  buildWearableAssistantSummary,
  summarizeWearableSourceHealth,
  type WearableAssistantSummary,
  type WearableSourceHealthSummary,
} from "../wearables.ts";
import {
  listMetricDefinitions,
  normalizeMetricKey,
  parseGoalMetricTargets,
  resolveCanonicalBiomarkerKey,
  selectMetricGoalProgress,
  type GoalMetricTarget,
  type MetricPoint,
} from "../metrics/index.ts";
import {
  BODY_PREVIEW_CHARS,
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  EXCLUDED_FAMILIES,
  INCLUDED_FAMILIES,
  METRIC_LOOKBACK_DAYS,
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
  type BrowserVaultRequestedMetric,
} from "./metric-points.ts";
import { toBrowserVaultLabResultRows } from "./lab-results.ts";
import { projectBrowserTrainingSession } from "./training.ts";

export async function createBrowserVaultReplica(
  input: CreateBrowserVaultReplicaInput,
): Promise<BrowserVaultReplica> {
  const generatedAt = input.generatedAt
    ? requireIsoDateTime(input.generatedAt, "Browser vault replica generatedAt")
    : new Date().toISOString();
  const policy = createBrowserVaultReplicaPolicy();
  const defaultProjectedVault = createDefaultProjectedVault(input.vault);
  const entities = defaultProjectedVault.entities
    .filter((entity) => isBrowserVaultIncludedFamily(entity.family))
    .map((entity) => projectEntity(entity, generatedAt));
  const timelineRows = buildTimeline(defaultProjectedVault, { limit: TIMELINE_LIMIT })
    .map(projectTimelineRow);
  const weeklySampleSummaries = projectWeeklySampleSummaries(defaultProjectedVault, generatedAt);
  const allMetricPoints = input.metricPoints;
  const requestedMetrics = collectRequestedBrowserVaultMetrics(defaultProjectedVault.entities);
  const explicitRequestedMetrics = collectExplicitBrowserVaultMetrics(defaultProjectedVault.entities);
  const anchoredMetricRecords = collectExperimentMeasurementAnchorRecords(defaultProjectedVault.entities);
  const cutoff = subtractDaysFromIsoDate(generatedAt.slice(0, 10), METRIC_LOOKBACK_DAYS);
  const metricPoints = allMetricPoints.filter((point) =>
    isBrowserVaultMetricRowPoint(point, requestedMetrics) &&
    (point.effectiveDate >= cutoff || isAnchoredBrowserMetricPoint(point, anchoredMetricRecords))
  );
  const selectionMetricPoints = allMetricPoints.filter((point) =>
    isBrowserVaultRequestedMetricPoint(point, requestedMetrics) &&
    (point.effectiveDate >= cutoff ||
      isAnchoredBrowserMetricPoint(point, anchoredMetricRecords) ||
      isBrowserVaultRequestedMetricPoint(point, explicitRequestedMetrics))
  );
  const metricRows = toBrowserVaultMetricRows({ points: metricPoints });
  const labResultRows = toBrowserVaultLabResultRows({
    entities: defaultProjectedVault.entities,
    points: allMetricPoints,
  });
  const metricRowPointIds = new Set(metricRows.flatMap((row) => row.pointIds));
  const metricSelectionRows = createBrowserVaultMetricSelectionRows({
    generatedAt,
    metricPoints,
    metricRowPointIds,
    requestedMetrics,
    selectionPoints: selectionMetricPoints,
  });
  const sourceHealthRows = summarizeWearableSourceHealth(defaultProjectedVault, { limit: SOURCE_HEALTH_LIMIT })
    .map(projectSourceHealthRow);
  const replicaWithoutVersion: BrowserVaultReplica = {
    assistantSummary: projectWearableAssistantSummary(buildWearableAssistantSummary(defaultProjectedVault)),
    entities,
    experimentOutcomes: (input.experimentOutcomes ?? []).map((outcome) =>
      experimentOutcomeSchema.parse(outcome)
    ),
    generatedAt,
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
    labResultRows,
    metricGoalProgressRows: buildMetricGoalProgressRows(defaultProjectedVault.entities, allMetricPoints, generatedAt),
    metricRows,
    metricSelectionRows,
    personalPatterns: buildPersonalPatternReport(input.vault, { asOf: generatedAt }),
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
    ...(replica.personalPatterns
      ? {
          personalPatterns: {
            ...replica.personalPatterns,
            asOfDate: "",
          },
        }
      : {}),
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

function createDefaultProjectedVault(vault: VaultReadModel): VaultReadModel {
  return createVaultReadModel({
    entities: vault.entities.filter(isDefaultProjectedQueryEntity),
    metadata: vault.metadata,
    vaultRoot: vault.vaultRoot,
  });
}

function buildMetricGoalProgressRows(
  entities: readonly CanonicalEntity[],
  points: readonly MetricPoint[],
  now: string,
): BrowserVaultMetricGoalProgressRow[] {
  return entities
    .filter(isActiveGoalEntity)
    .flatMap((entity) => parseGoalMetricTargets(entity).map((target) =>
      selectMetricGoalProgress({
        goalId: entity.entityId,
        now,
        points,
        target,
      }) satisfies BrowserVaultMetricGoalProgressRow
    ));
}

function collectRequestedBrowserVaultMetrics(entities: readonly CanonicalEntity[]): BrowserVaultRequestedMetric[] {
  return dedupeRequestedMetrics([
    ...listMetricDefinitions().map((definition) => ({
      metricKey: definition.key,
      biomarkerKey: definition.biomarkerKey,
    })),
    ...collectExplicitBrowserVaultMetrics(entities),
  ]);
}

function collectExplicitBrowserVaultMetrics(entities: readonly CanonicalEntity[]): BrowserVaultRequestedMetric[] {
  return dedupeRequestedMetrics([
    ...entities.flatMap(privateMetricBindingRequests),
    ...entities.filter(isActiveGoalEntity).flatMap((entity) =>
      parseGoalMetricTargets(entity).map((target) => ({
        metricKey: target.metricKey,
        biomarkerKey: target.biomarkerKey ?? null,
      }))
    ),
  ]);
}

function privateMetricBindingRequests(entity: CanonicalEntity): BrowserVaultRequestedMetric[] {
  const source = entity.frontmatter ?? entity.attributes;
  const rawBindings = Array.isArray(source.privateMetricBindings) ? source.privateMetricBindings : [];
  const entityKey = readOptionalString(source.key);
  const entityBiomarkerKey = entityKey?.startsWith("biomarker:") ? entityKey : null;
  return rawBindings.flatMap((binding) => {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) return [];
    const record = binding as Record<string, unknown>;
    if (readOptionalString(record.source) !== "metric") return [];
    const metricKey = readOptionalString(record.metricKey);
    if (!metricKey) return [];
    return [{
      metricKey,
      biomarkerKey: readOptionalString(record.biomarkerKey) ?? entityBiomarkerKey,
    }];
  });
}

function collectExperimentMeasurementAnchorRecords(
  entities: readonly CanonicalEntity[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const records = new Map<string, Set<string>>();
  for (const entity of entities) {
    if (entity.family !== "experiment") {
      continue;
    }

    const source = entity.frontmatter ?? entity.attributes;
    const analysisPlan = source.analysisPlan;
    if (!analysisPlan || typeof analysisPlan !== "object" || Array.isArray(analysisPlan)) {
      continue;
    }

    const anchors = (analysisPlan as Record<string, unknown>).measurementAnchors;
    if (!Array.isArray(anchors)) {
      continue;
    }

    for (const anchor of anchors) {
      if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
        continue;
      }
      const recordId = readOptionalString((anchor as Record<string, unknown>).recordId);
      const biomarkerKeys = readStringArray((anchor as Record<string, unknown>).biomarkerKeys);
      if (recordId && biomarkerKeys.length > 0) {
        const existing = records.get(recordId) ?? new Set<string>();
        for (const biomarkerKey of biomarkerKeys) {
          existing.add(resolveCanonicalBiomarkerKey(biomarkerKey));
        }
        records.set(recordId, existing);
      }
    }
  }

  return records;
}

function isAnchoredBrowserMetricPoint(
  point: MetricPoint,
  anchoredRecords: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const biomarkerKey = point.biomarkerKey;
  if (!biomarkerKey) {
    return false;
  }

  return metricPointRecordIds(point).some((recordId) =>
    anchoredRecords.get(recordId)?.has(biomarkerKey) ?? false
  );
}

function dedupeRequestedMetrics(metrics: readonly BrowserVaultRequestedMetric[]): BrowserVaultRequestedMetric[] {
  const byKey = new Map<string, BrowserVaultRequestedMetric>();
  for (const metric of metrics) {
    if (!metric.metricKey) continue;
    const metricKey = normalizeMetricKey(metric.metricKey);
    byKey.set(`${metricKey}\u001f${metric.biomarkerKey ?? ""}`, {
      metricKey,
      biomarkerKey: metric.biomarkerKey ?? null,
    });
  }
  return [...byKey.values()].sort((left, right) =>
    left.metricKey.localeCompare(right.metricKey) || (left.biomarkerKey ?? "").localeCompare(right.biomarkerKey ?? "")
  );
}

// Observation points join the row/series surface without catalog
// enrollment, exactly as test-results do: the projection is the source of
// truth for which metrics exist (universal queryability). Metric
// observations are default-hidden as ENTITIES purely to keep timelines
// lean — their data is meant to surface here. Ad-hoc manual MEASUREMENT
// keys stay registry-gated (private unless bound), and the
// metric-SELECTION surface keeps its stricter requested-only gate.
function isBrowserVaultMetricRowPoint(
  point: MetricPoint,
  requestedMetrics: readonly BrowserVaultRequestedMetric[],
): boolean {
  return isBrowserVaultRequestedMetricPoint(point, requestedMetrics)
    || point.source.kind === "test-result"
    || point.source.kind === "observation";
}

function isBrowserVaultRequestedMetricPoint(
  point: MetricPoint,
  requestedMetrics: readonly BrowserVaultRequestedMetric[],
): boolean {
  return requestedMetrics.some((metric) => metric.metricKey === point.metricKey);
}

function isActiveGoalEntity(entity: CanonicalEntity): boolean {
  if (entity.family !== "goal") return false;
  const source = entity.frontmatter ?? entity.attributes;
  const status = readOptionalString(source.status) ?? entity.status;
  return status === "active";
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readOptionalString)
    .filter((entry): entry is string => entry !== null);
}


function projectEntity(
  entity: CanonicalEntity,
  generatedAt: string,
): BrowserVaultEntity {
  return {
    attributes: projectEntityAttributes(entity, generatedAt),
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

function projectEntityAttributes(
  entity: CanonicalEntity,
  generatedAt: string,
): Record<string, unknown> {
  if (entity.family === "event") {
    return projectSafeEventAttributes(entity, generatedAt);
  }
  if (entity.family === "habitat") {
    return projectSafeAttributeKeys(entity, [
      "aspect",
      "domain",
      "indicators",
      "indicatorRecordedAt",
      "note",
    ]);
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

function projectSafeEventAttributes(
  entity: CanonicalEntity,
  generatedAt: string,
): Record<string, unknown> {
  if (entity.family !== "event") {
    return {};
  }

  switch (entity.kind) {
    case "activity_session": {
      const attributes = projectSafeAttributeKeys(entity, ["source"]);
      const activityKind = resolveAdherenceObservationActivityKind({
        attributes: entity.attributes,
      });
      if (activityKind) {
        attributes.activityKind = activityKind;
      }

      const training = projectBrowserTrainingSession({
        activityKind,
        entity,
        generatedAt,
      });
      if (training) {
        attributes.training = training;
      }
      return attributes;
    }
    case "intervention_session":
      return projectSafeAttributeKeys(entity, [
        "afterExercise",
        "confounders",
        "experimentId",
        "experimentSlug",
        "interventionType",
        "note",
        "protocolId",
        "sessionStatus",
        "sessionLocalDate",
        "scheduledLocalDate",
        "source",
        "symptoms",
      ]);
    case "experiment_context":
      return projectSafeAttributeKeys(entity, [
        "experimentId",
        "experimentSlug",
        "contextType",
        "note",
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
