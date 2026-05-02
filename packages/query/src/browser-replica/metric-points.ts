import type { CanonicalEntity } from "../canonical-entities.ts";
import type {
  BrowserVaultMetricDomain,
  BrowserVaultMetricPoint,
  BrowserVaultMetricPointFilters,
  BrowserVaultMetricRow,
  BrowserVaultMetricSelectionRow,
} from "./shared.ts";

export const BROWSER_VAULT_METRIC_POINT_SCHEMA = "murph.browser-vault.metric-point.v1" as const;
export const BROWSER_VAULT_METRIC_SELECTION_SCHEMA = "murph.browser-vault.metric-selection.v1" as const;

interface MetricDefinition {
  readonly aliases: readonly string[];
  readonly biomarkerKey: string | null;
  readonly displayName: string;
  readonly metric: string;
  readonly metricKey: string;
  readonly primaryDomain: BrowserVaultMetricDomain;
  readonly sourceDomains: readonly BrowserVaultMetricDomain[];
  readonly staleAfterDays: number;
  readonly unit: string;
  readonly valuePrecision: number;
}

type MetricPointInput =
  | readonly BrowserVaultMetricRow[]
  | {
      readonly generatedAt?: string;
      readonly lookbackDays?: number;
      readonly metricRows: readonly BrowserVaultMetricRow[];
      readonly vault?: {
        readonly entities: readonly CanonicalEntity[];
      };
    };

const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  defineMetric({
    aliases: ["rhr", "resting_heart_rate", "restingHeartRate", "resting-pulse"],
    biomarkerKey: "biomarker:resting-heart-rate",
    displayName: "Resting heart rate",
    metric: "restingHeartRate",
    metricKey: "resting-heart-rate",
    primaryDomain: "recovery",
    sourceDomains: ["recovery"],
    staleAfterDays: 14,
    unit: "bpm",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["hrv", "hrv_rmssd", "rmssd", "heart-rate-variability", "heart_rate_variability"],
    biomarkerKey: "biomarker:hrv-rmssd",
    displayName: "HRV",
    metric: "hrv",
    metricKey: "hrv-rmssd",
    primaryDomain: "recovery",
    sourceDomains: ["recovery", "sleep"],
    staleAfterDays: 14,
    unit: "ms",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["deep", "deep_minutes", "deepMinutes", "deep-sleep", "deep_sleep"],
    biomarkerKey: "biomarker:deep-sleep-minutes",
    displayName: "Deep sleep",
    metric: "deepMinutes",
    metricKey: "deep-sleep-minutes",
    primaryDomain: "sleep",
    sourceDomains: ["sleep"],
    staleAfterDays: 14,
    unit: "minutes",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["rem", "rem_minutes", "remMinutes", "rem-sleep", "rem_sleep"],
    biomarkerKey: "biomarker:rem-sleep-minutes",
    displayName: "REM sleep",
    metric: "remMinutes",
    metricKey: "rem-sleep-minutes",
    primaryDomain: "sleep",
    sourceDomains: ["sleep"],
    staleAfterDays: 14,
    unit: "minutes",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["weight", "body_weight", "bodyWeight", "bodyweight", "weightKg"],
    biomarkerKey: null,
    displayName: "Body weight",
    metric: "body-weight",
    metricKey: "body-weight",
    primaryDomain: "body_state",
    sourceDomains: ["body_state"],
    staleAfterDays: 45,
    unit: "kg",
    valuePrecision: 1,
  }),
  defineMetric({
    aliases: ["body_fat", "bodyFat", "body_fat_pct", "body-fat-pct", "bodyFatPercentage", "body_fat_percentage"],
    biomarkerKey: null,
    displayName: "Body fat",
    metric: "body-fat-percentage",
    metricKey: "body-fat-percentage",
    primaryDomain: "body_state",
    sourceDomains: ["body_state"],
    staleAfterDays: 45,
    unit: "percent",
    valuePrecision: 1,
  }),
  defineMetric({
    aliases: ["blood-glucose", "blood_glucose", "fasting-glucose", "fasting_glucose"],
    biomarkerKey: "biomarker:blood-glucose",
    displayName: "Glucose",
    metric: "glucose",
    metricKey: "glucose",
    primaryDomain: "body_state",
    sourceDomains: ["body_state"],
    staleAfterDays: 45,
    unit: "mg/dL",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["apo-b", "apo_b", "apolipoprotein-b", "apolipoprotein_b", "apolipoprotein b"],
    biomarkerKey: "biomarker:apob",
    displayName: "ApoB",
    metric: "apob",
    metricKey: "apob",
    primaryDomain: "body_state",
    sourceDomains: [],
    staleAfterDays: 365,
    unit: "mg/dL",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["ldl", "ldl_cholesterol", "ldl-cholesterol", "ldlc", "ldl_c"],
    biomarkerKey: "biomarker:ldl-c",
    displayName: "LDL-C",
    metric: "ldl-c",
    metricKey: "ldl-c",
    primaryDomain: "body_state",
    sourceDomains: [],
    staleAfterDays: 365,
    unit: "mg/dL",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["a1c", "hba1c", "hemoglobin-a1c", "hemoglobin_a1c"],
    biomarkerKey: "biomarker:hba1c",
    displayName: "HbA1c",
    metric: "hba1c",
    metricKey: "hba1c",
    primaryDomain: "body_state",
    sourceDomains: [],
    staleAfterDays: 365,
    unit: "percent",
    valuePrecision: 1,
  }),
  defineMetric({
    aliases: ["alanine-aminotransferase", "alanine_aminotransferase"],
    biomarkerKey: "biomarker:alt",
    displayName: "ALT",
    metric: "alt",
    metricKey: "alt",
    primaryDomain: "body_state",
    sourceDomains: [],
    staleAfterDays: 365,
    unit: "U/L",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["aspartate-aminotransferase", "aspartate_aminotransferase"],
    biomarkerKey: "biomarker:ast",
    displayName: "AST",
    metric: "ast",
    metricKey: "ast",
    primaryDomain: "body_state",
    sourceDomains: [],
    staleAfterDays: 365,
    unit: "U/L",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["gamma-glutamyl-transferase", "gamma_glutamyl_transferase"],
    biomarkerKey: "biomarker:ggt",
    displayName: "GGT",
    metric: "ggt",
    metricKey: "ggt",
    primaryDomain: "body_state",
    sourceDomains: [],
    staleAfterDays: 365,
    unit: "U/L",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["crp", "hs_crp", "hs-crp", "high-sensitivity-crp", "high_sensitivity_crp", "c-reactive-protein"],
    biomarkerKey: "biomarker:hs-crp",
    displayName: "hs-CRP",
    metric: "hs-crp",
    metricKey: "hs-crp",
    primaryDomain: "body_state",
    sourceDomains: [],
    staleAfterDays: 365,
    unit: "mg/L",
    valuePrecision: 1,
  }),
  defineMetric({
    aliases: [],
    biomarkerKey: "biomarker:ferritin",
    displayName: "Ferritin",
    metric: "ferritin",
    metricKey: "ferritin",
    primaryDomain: "body_state",
    sourceDomains: [],
    staleAfterDays: 365,
    unit: "ng/mL",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["hdl", "hdl_cholesterol", "hdl-cholesterol", "hdlc", "hdl_c"],
    biomarkerKey: "biomarker:hdl-c",
    displayName: "HDL-C",
    metric: "hdl-c",
    metricKey: "hdl-c",
    primaryDomain: "body_state",
    sourceDomains: [],
    staleAfterDays: 365,
    unit: "mg/dL",
    valuePrecision: 0,
  }),
  defineMetric({
    aliases: ["tg", "triglyceride"],
    biomarkerKey: "biomarker:triglycerides",
    displayName: "Triglycerides",
    metric: "triglycerides",
    metricKey: "triglycerides",
    primaryDomain: "body_state",
    sourceDomains: [],
    staleAfterDays: 365,
    unit: "mg/dL",
    valuePrecision: 0,
  }),
];

const SUPPORTED_BY_METRIC_KEY = new Map(
  METRIC_DEFINITIONS.map((definition) => [definition.metricKey, definition]),
);

const SUPPORTED_BY_ALIAS = new Map<string, MetricDefinition>();
for (const definition of METRIC_DEFINITIONS) {
  for (const alias of [definition.metricKey, definition.metric, ...definition.aliases]) {
    SUPPORTED_BY_ALIAS.set(normalizeMetricSlug(alias), definition);
  }
}

function defineMetric(definition: MetricDefinition): MetricDefinition {
  return definition;
}

export function resolveBrowserVaultMetricKey(input: {
  domain: BrowserVaultMetricDomain | string;
  metric: string;
}): string | null {
  const domain = parseBrowserVaultMetricDomain(input.domain);
  if (!domain) {
    return null;
  }

  const definition = METRIC_DEFINITIONS.find((candidate) =>
    candidate.sourceDomains.includes(domain) && metricDefinitionMatches(candidate, input.metric)
  );

  return definition?.metricKey ?? null;
}

function metricDefinitionMatches(definition: MetricDefinition, metric: string): boolean {
  const normalized = normalizeMetricSlug(metric);
  return definition.metricKey === normalized
    || normalizeMetricSlug(definition.metric) === normalized
    || definition.aliases.some((alias) => normalizeMetricSlug(alias) === normalized);
}

export function resolveBrowserVaultMetricPointBiomarkerKey(metricKey: string): string | null {
  return SUPPORTED_BY_METRIC_KEY.get(metricKey)?.biomarkerKey ?? null;
}

export function createBrowserVaultMetricPoints(input: MetricPointInput): BrowserVaultMetricPoint[] {
  let generatedAt: string | null = null;
  let lookbackDays: number | null = null;
  let metricRows: readonly BrowserVaultMetricRow[];
  let vaultEntities: readonly CanonicalEntity[];

  if (isMetricRowArray(input)) {
    metricRows = input;
    vaultEntities = [];
  } else {
    generatedAt = input.generatedAt ?? null;
    lookbackDays = input.lookbackDays ?? null;
    metricRows = input.metricRows;
    vaultEntities = input.vault?.entities ?? [];
  }

  const metricPoints = dedupeMetricPoints([
    ...createMetricPointsFromRows(metricRows),
    ...createMetricPointsFromVaultEntities(vaultEntities),
  ]);

  return filterMetricPointsByLookback(metricPoints, {
    generatedAt,
    lookbackDays,
  }).sort(compareMetricPointsByDateDesc);
}

function isMetricRowArray(input: MetricPointInput): input is readonly BrowserVaultMetricRow[] {
  return Array.isArray(input);
}

function createMetricPointsFromRows(
  metricRows: readonly BrowserVaultMetricRow[],
): BrowserVaultMetricPoint[] {
  return metricRows.flatMap((row) => {
    const metricKey = resolveBrowserVaultMetricKey(row);
    const definition = metricKey ? SUPPORTED_BY_METRIC_KEY.get(metricKey) : null;

    if (!definition || typeof row.value !== "number" || !Number.isFinite(row.value)) {
      return [];
    }

    const normalized = normalizeMetricValue({
      definition,
      unit: row.unit ?? definition.unit,
      value: row.value,
    });
    const observedAt = metricRowObservedAt(row);
    const sourceLabel = metricPointSourceLabel(row);

    return [buildMetricPoint({
      confidence: row.confidence,
      date: row.date,
      definition,
      observedAt,
      recordIds: row.recordIds,
      sourceFamily: row.sourceFamily ?? "derived",
      sourceId: row.id,
      sourceKind: "wearable-summary",
      sourceLabel,
      statistic: "value",
      unit: normalized.unit,
      value: normalized.value,
    })];
  });
}

function createMetricPointsFromVaultEntities(
  entities: readonly CanonicalEntity[],
): BrowserVaultMetricPoint[] {
  return entities.flatMap((entity) => {
    if (entity.family !== "event") {
      return [];
    }

    switch (entity.kind) {
      case "measurement":
        return extractMeasurementMetricPoints(entity);
      case "body_measurement":
        return extractBodyMeasurementMetricPoints(entity);
      case "observation":
        return extractObservationMetricPoints(entity);
      case "test":
        return extractTestResultMetricPoints(entity);
      default:
        return [];
    }
  });
}

function extractMeasurementMetricPoints(entity: CanonicalEntity): BrowserVaultMetricPoint[] {
  const entries = Array.isArray(entity.attributes.measurements) ? entity.attributes.measurements : [];

  return entries.flatMap((entry, index) => {
    const record = readRecord(entry);
    const rawMetric = readNonEmptyString(record?.metric);
    const value = readNumber(record?.value);
    const unit = readNonEmptyString(record?.unit);

    if (!rawMetric || value === null) {
      return [];
    }

    const point = buildMetricPointFromScalar({
      confidence: readNonEmptyString(entity.attributes.source) === "manual" ? "medium" : "high",
      entity,
      index,
      rawMetric,
      sourceKind: "measurement",
      sourceLabel: sourceLabelForEvent(entity),
      unit,
      value,
    });

    return point ? [point] : [];
  });
}

function extractBodyMeasurementMetricPoints(entity: CanonicalEntity): BrowserVaultMetricPoint[] {
  const entries = Array.isArray(entity.attributes.measurements) ? entity.attributes.measurements : [];

  return entries.flatMap((entry, index) => {
    const record = readRecord(entry);
    const rawMetric = readNonEmptyString(record?.type);
    const value = readNumber(record?.value);
    const unit = readNonEmptyString(record?.unit);

    if (!rawMetric || value === null) {
      return [];
    }

    const point = buildMetricPointFromScalar({
      confidence: readNonEmptyString(entity.attributes.source) === "manual" ? "medium" : "high",
      entity,
      index,
      rawMetric,
      sourceKind: "compat-body-measurement",
      sourceLabel: sourceLabelForEvent(entity),
      unit,
      value,
    });

    return point ? [point] : [];
  });
}

function extractObservationMetricPoints(entity: CanonicalEntity): BrowserVaultMetricPoint[] {
  const rawMetric = readNonEmptyString(entity.attributes.metric);
  const value = readNumber(entity.attributes.value);
  const unit = readNonEmptyString(entity.attributes.unit);

  if (!rawMetric || value === null) {
    return [];
  }

  const point = buildMetricPointFromScalar({
    confidence: readNonEmptyString(entity.attributes.source) === "manual" ? "medium" : "high",
    entity,
    index: 0,
    rawMetric,
    sourceKind: "compat-observation",
    sourceLabel: sourceLabelForEvent(entity),
    unit,
    value,
  });

  return point ? [point] : [];
}

function extractTestResultMetricPoints(entity: CanonicalEntity): BrowserVaultMetricPoint[] {
  const results = Array.isArray(entity.attributes.results) ? entity.attributes.results : [];
  const labName = readNonEmptyString(entity.attributes.labName);
  const collectedAt = readNonEmptyString(entity.attributes.collectedAt);
  const reportedAt = readNonEmptyString(entity.attributes.reportedAt);
  const observedAt = collectedAt ?? entity.occurredAt ?? reportedAt ?? entity.date ?? "";

  if (!observedAt) {
    return [];
  }

  return results.flatMap((entry, index) => {
    const record = readRecord(entry);
    const rawMetric = readNonEmptyString(record?.biomarkerSlug)
      ?? readNonEmptyString(record?.slug)
      ?? readNonEmptyString(record?.analyte);
    const value = readNumber(record?.value);
    const unit = readNonEmptyString(record?.unit);

    if (!rawMetric || value === null) {
      return [];
    }

    const point = buildMetricPointFromScalar({
      comparator: readComparator(record?.comparator),
      confidence: "high",
      entity,
      index,
      observedAt,
      rawMetric,
      sourceKind: "test-result",
      sourceLabel: labName ?? "Lab result",
      unit,
      value,
    });

    return point ? [point] : [];
  });
}

function buildMetricPointFromScalar(input: {
  comparator?: "<" | "<=" | ">" | ">=" | null;
  confidence: BrowserVaultMetricPoint["confidence"];
  entity: CanonicalEntity;
  index: number;
  observedAt?: string;
  rawMetric: string;
  sourceKind: string;
  sourceLabel: string | null;
  unit: string | null;
  value: number;
}): BrowserVaultMetricPoint | null {
  const metricKey = normalizeMetricSlug(input.rawMetric);
  const definition = resolveMetricDefinition(metricKey);
  if (!definition) {
    return null;
  }

  const normalized = normalizeMetricValue({
    definition,
    unit: input.unit ?? definition.unit,
    value: input.value,
  });
  const observedAt = input.observedAt ?? entityObservedAt(input.entity);
  const date = observedAt.slice(0, 10);

  return buildMetricPoint({
    comparator: input.comparator ?? null,
    confidence: input.confidence,
    date,
    definition,
    observedAt,
    recordIds: [input.entity.entityId],
    sourceFamily: "event",
    sourceId: `${input.entity.entityId}:${input.sourceKind}:${input.index + 1}`,
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel,
    statistic: "value",
    unit: normalized.unit,
    value: normalized.value,
  });
}

function buildMetricPoint(input: {
  comparator?: "<" | "<=" | ">" | ">=" | null;
  confidence: BrowserVaultMetricPoint["confidence"];
  date: string;
  definition: MetricDefinition;
  observedAt: string;
  recordIds: readonly string[];
  sourceFamily: string | null;
  sourceId: string;
  sourceKind: string | null;
  sourceLabel: string | null;
  statistic: BrowserVaultMetricPoint["statistic"];
  unit: string | null;
  value: number;
}): BrowserVaultMetricPoint {
  const valueLabel = `${input.comparator ?? ""}${formatMetricValue(input.value, input.definition.valuePrecision)}`;

  return {
    biomarkerKey: input.definition.biomarkerKey,
    confidence: input.confidence,
    date: input.date,
    grain: "day",
    id: `metric-point:${input.definition.metricKey}:${input.date}:${input.sourceId}`,
    metricKey: input.definition.metricKey,
    observedAt: input.observedAt,
    pointSchema: BROWSER_VAULT_METRIC_POINT_SCHEMA,
    recordIds: input.recordIds.slice(),
    sourceFamily: input.sourceFamily,
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel,
    sourceMetricRowId: input.sourceId,
    statistic: input.statistic,
    unit: input.unit,
    value: input.value,
    valueLabel,
  };
}

export function createBrowserVaultMetricSelectionRows(input: {
  generatedAt: string;
  metricPoints: readonly BrowserVaultMetricPoint[];
}): BrowserVaultMetricSelectionRow[] {
  const rows: BrowserVaultMetricSelectionRow[] = [];
  const metricKeys = [...new Set(input.metricPoints.map((point) => point.metricKey))].sort();

  for (const metricKey of metricKeys) {
    const definition = SUPPORTED_BY_METRIC_KEY.get(metricKey)
      ?? customMetricDefinition(metricKey, null);
    const points = input.metricPoints
      .filter((point) => point.metricKey === metricKey)
      .sort(compareMetricPointsForSelection);
    const selected = points[0] ?? null;

    if (!selected) {
      continue;
    }

    const stale = isOlderThanDays(
      selected.observedAt,
      input.generatedAt,
      definition.staleAfterDays,
    );
    const warnings: BrowserVaultMetricSelectionRow["warnings"] = [];

    if (stale) {
      warnings.push({
        code: "SOURCE_STALE",
        message: `${definition.displayName} has not synced in the last ${definition.staleAfterDays} days.`,
      });
    }

    const sourceKinds = uniqueStrings(points.map((point) => point.sourceKind));
    if (sourceKinds.length > 1) {
      warnings.push({
        code: "MIXED_SOURCES",
        message: `${definition.displayName} has values from multiple source types; Murph selected the highest-priority latest value.`,
      });
    }

    rows.push({
      biomarkerKey: selected.biomarkerKey,
      confidence: selected.confidence,
      date: selected.date,
      id: `metric-selection:${definition.metricKey}`,
      metricKey: definition.metricKey,
      observedAt: selected.observedAt,
      pointIds: [selected.id],
      recordIds: selected.recordIds.slice(),
      selectionSchema: BROWSER_VAULT_METRIC_SELECTION_SCHEMA,
      sourceLabel: selected.sourceLabel,
      status: stale ? "stale" : "ready",
      unit: selected.unit,
      value: selected.value,
      valueLabel: selected.valueLabel,
      warnings,
    });
  }

  return rows;
}

export function metricPointMatchesFilters(
  point: BrowserVaultMetricPoint,
  filters: BrowserVaultMetricPointFilters,
): boolean {
  if (filters.metricKey && point.metricKey !== filters.metricKey) {
    return false;
  }

  if (filters.biomarkerKey && point.biomarkerKey !== filters.biomarkerKey) {
    return false;
  }

  if (filters.from && point.date < filters.from) {
    return false;
  }

  if (filters.to && point.date > filters.to) {
    return false;
  }

  return true;
}

export function browserVaultMetricPointToMetricRow(input: {
  binding: {
    domain: BrowserVaultMetricDomain;
    metric: string;
  };
  point: BrowserVaultMetricPoint;
}): BrowserVaultMetricRow {
  return {
    confidence: input.point.confidence,
    date: input.point.date,
    domain: input.binding.domain,
    id: `metric-point-row:${input.point.id}`,
    metric: input.binding.metric,
    recordIds: input.point.recordIds.slice(),
    sourceFamily: input.point.sourceFamily,
    sourceKind: input.point.sourceLabel ?? input.point.sourceKind,
    unit: input.point.unit,
    value: input.point.value,
  };
}

function resolveMetricDefinition(metricKey: string): MetricDefinition | null {
  return SUPPORTED_BY_METRIC_KEY.get(metricKey)
    ?? SUPPORTED_BY_ALIAS.get(metricKey)
    ?? null;
}

function customMetricDefinition(metricKey: string, unit: string | null): MetricDefinition {
  return defineMetric({
    aliases: [],
    biomarkerKey: null,
    displayName: formatWords(metricKey),
    metric: metricKey,
    metricKey,
    primaryDomain: "body_state",
    sourceDomains: [],
    staleAfterDays: 90,
    unit: unit ?? "value",
    valuePrecision: guessValuePrecision(unit),
  });
}

function normalizeMetricValue(input: {
  definition: MetricDefinition;
  unit: string | null;
  value: number;
}): { unit: string | null; value: number } {
  const normalizedUnit = normalizeUnit(input.unit);

  switch (input.definition.metricKey) {
    case "body-weight":
      return normalizeWeightKilograms(input.value, normalizedUnit);
    case "body-fat-percentage":
    case "hba1c":
      return { unit: "percent", value: input.value };
    case "glucose":
    case "apob":
    case "ldl-c":
    case "hdl-c":
    case "triglycerides":
      return { unit: "mg/dL", value: input.value };
    case "hs-crp":
      return { unit: "mg/L", value: input.value };
    case "ferritin":
      return { unit: "ng/mL", value: input.value };
    case "alt":
    case "ast":
    case "ggt":
      return { unit: "U/L", value: input.value };
    default:
      return { unit: input.unit ?? input.definition.unit, value: input.value };
  }
}

function normalizeWeightKilograms(value: number, unit: string | null): { unit: string; value: number } {
  switch (unit) {
    case null:
    case "kg":
    case "kilogram":
    case "kilograms":
      return { unit: "kg", value };
    case "lb":
    case "lbs":
    case "pound":
    case "pounds":
      return { unit: "kg", value: Number((value * 0.45359237).toFixed(4)) };
    default:
      return { unit: "kg", value };
  }
}

function compareMetricPointsByDateDesc(
  left: BrowserVaultMetricPoint,
  right: BrowserVaultMetricPoint,
): number {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  if (left.observedAt !== right.observedAt) {
    return right.observedAt.localeCompare(left.observedAt);
  }

  return left.id.localeCompare(right.id);
}

function compareMetricPointsForSelection(
  left: BrowserVaultMetricPoint,
  right: BrowserVaultMetricPoint,
): number {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  const priorityDelta = metricPointSourcePriority(left) - metricPointSourcePriority(right);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  if (left.observedAt !== right.observedAt) {
    return right.observedAt.localeCompare(left.observedAt);
  }

  return left.id.localeCompare(right.id);
}

function metricPointSourcePriority(point: BrowserVaultMetricPoint): number {
  switch (point.sourceKind) {
    case "test-result":
      return 0;
    case "measurement":
      return 1;
    case "compat-body-measurement":
    case "compat-observation":
      return 2;
    case "wearable-summary":
      return 3;
    default:
      return 4;
  }
}

function dedupeMetricPoints(points: readonly BrowserVaultMetricPoint[]): BrowserVaultMetricPoint[] {
  const byKey = new Map<string, BrowserVaultMetricPoint>();

  for (const point of points) {
    const key = [
      point.metricKey,
      point.date,
      point.observedAt,
      point.value,
      point.unit ?? "",
      point.sourceFamily ?? "",
      point.sourceKind ?? "",
      point.recordIds.join(","),
    ].join("|");

    if (!byKey.has(key)) {
      byKey.set(key, point);
    }
  }

  return [...byKey.values()];
}

function filterMetricPointsByLookback(
  points: readonly BrowserVaultMetricPoint[],
  input: {
    generatedAt: string | null;
    lookbackDays: number | null;
  },
): BrowserVaultMetricPoint[] {
  const generatedAt = input.generatedAt;
  const lookbackDays = input.lookbackDays;

  if (!generatedAt || typeof lookbackDays !== "number") {
    return points.slice();
  }

  return points.filter((point) =>
    !isOlderThanDays(point.observedAt, generatedAt, lookbackDays)
  );
}

function entityObservedAt(entity: CanonicalEntity): string {
  return entity.occurredAt ?? entity.date ?? new Date(0).toISOString();
}

function metricRowObservedAt(row: BrowserVaultMetricRow): string {
  return row.date.includes("T") ? row.date : `${row.date}T00:00:00.000Z`;
}

function metricPointSourceLabel(row: BrowserVaultMetricRow): string | null {
  const sourceKind = row.sourceKind?.trim();

  if (sourceKind && sourceKind !== "summary") {
    return formatWords(sourceKind);
  }

  if (sourceKind === "summary") {
    return "Wearable summary";
  }

  const sourceFamily = row.sourceFamily?.trim();
  return sourceFamily ? formatWords(sourceFamily) : "Wearable summary";
}

function sourceLabelForEvent(entity: CanonicalEntity): string | null {
  const labName = readNonEmptyString(entity.attributes.labName);
  if (labName) {
    return labName;
  }

  const source = readNonEmptyString(entity.attributes.source) ?? entity.status;
  if (entity.kind === "test") {
    return source ? formatWords(source) : "Lab result";
  }

  return source ? formatWords(source) : "Manual";
}

function formatMetricValue(value: number, precision: number): string {
  return Number(value.toFixed(precision)).toString();
}

function formatWords(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function guessValuePrecision(unit: string | null): number {
  const normalized = normalizeUnit(unit);
  if (normalized === "percent" || normalized === "%" || normalized === "kg") {
    return 1;
  }

  return 0;
}

function normalizeMetricSlug(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[_\s/]+/gu, "-")
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeUnit(value: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const lower = normalized.toLowerCase();
  switch (lower) {
    case "%":
    case "pct":
    case "percentage":
      return "percent";
    case "mg_dl":
    case "mg/dl":
      return "mg/dL";
    case "u/l":
    case "iu/l":
      return "U/L";
    case "ng/ml":
      return "ng/mL";
    case "mg/l":
      return "mg/L";
    default:
      return lower;
  }
}

function isOlderThanDays(dateOrDateTime: string, nowDateTime: string, days: number): boolean {
  const observed = new Date(dateOrDateTime.includes("T") ? dateOrDateTime : `${dateOrDateTime}T00:00:00.000Z`);
  const now = new Date(nowDateTime.includes("T") ? nowDateTime : `${nowDateTime}T00:00:00.000Z`);

  if (!Number.isFinite(observed.getTime()) || !Number.isFinite(now.getTime())) {
    return false;
  }

  return now.getTime() - observed.getTime() > days * 24 * 60 * 60 * 1000;
}

function parseBrowserVaultMetricDomain(value: string): BrowserVaultMetricDomain | null {
  if (value === "activity" || value === "body_state" || value === "recovery" || value === "sleep") {
    return value;
  }

  return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readComparator(value: unknown): "<" | "<=" | ">" | ">=" | null {
  return value === "<" || value === "<=" || value === ">" || value === ">=" ? value : null;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}
