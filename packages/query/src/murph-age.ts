import {
  MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION,
  MURPH_AGE_RESULT_SCHEMA_VERSION,
  calculateMurphAge,
  calculateMurphAgeFromInputBundle,
  listMurphAgeInputBundleMetricKeys,
  resolveMetricInputKey,
  validateMurphAgeRiskModel,
  type MetricPoint,
  type MurphAgeCalculationInput,
  type MurphAgeCalculatorInput,
  type MurphAgeCalculatorMode,
  type MurphAgeCalculatorOutput,
  type MurphAgeResult,
  type MurphAgeRiskModel,
  type MurphAgeWarning,
} from "@murphai/health-metrics";

import {
  listMetricPointsRuntime,
  type QueryMetricPointFilters,
} from "./query-projection.ts";

export interface CalculateMurphAgeForVaultInput extends Omit<MurphAgeCalculationInput, "points"> {
  asOf: string;
  vaultRoot: string;
}

export interface CalculateMurphAgeFromVaultInputBundleInput extends Omit<MurphAgeCalculatorInput, "points"> {
  asOf: string;
  vaultRoot: string;
}

export async function calculateMurphAgeForVault(
  input: CalculateMurphAgeForVaultInput,
): Promise<MurphAgeResult> {
  const asOf = parseFlexibleAsOf(input.asOf);
  if (!asOf) {
    return invalidAsOfResult(input);
  }

  const validation = validateMurphAgeRiskModel(input.model);
  if (validation.status === "invalid") {
    return calculateMurphAge({
      asOf,
      chronologicalAgeYears: input.chronologicalAgeYears,
      model: input.model,
      points: [],
      sex: input.sex,
    });
  }

  const points = await loadMurphAgeMetricPoints({
    asOf,
    model: input.model,
    vaultRoot: input.vaultRoot,
  });

  return calculateMurphAge({
    asOf,
    chronologicalAgeYears: input.chronologicalAgeYears,
    model: input.model,
    points,
    sex: input.sex,
  });
}

export async function calculateMurphAgeFromVaultInputBundle(
  input: CalculateMurphAgeFromVaultInputBundleInput,
): Promise<MurphAgeCalculatorOutput> {
  const asOf = parseStrictUtcAsOf(input.asOf);
  if (!asOf) {
    return invalidCalculatorOutput({
      message: "Murph Age query runtime requires a valid asOf timestamp.",
      mode: normalizeCalculatorMode(input.mode) ?? "product",
    });
  }

  const mode = normalizeCalculatorMode(input.mode);
  if (!mode) {
    return invalidCalculatorOutput({
      message: "Murph Age query runtime requires mode to be product or research.",
      mode: "product",
    });
  }

  const points = await loadMurphAgeInputBundleMetricPoints({
    asOf,
    vaultRoot: input.vaultRoot,
  });

  return calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: input.chronologicalAgeYears,
    mode,
    models: input.models,
    points,
    sex: input.sex,
  });
}

export function metricPointFiltersForMurphAgeModel(
  model: MurphAgeRiskModel,
  asOf: string,
): QueryMetricPointFilters[] {
  const to = isoDayFromDateTime(asOf);
  const filtersByKey = new Map<string, QueryMetricPointFilters>();

  for (const feature of model.features) {
    if (feature.kind !== "metric") continue;
    const filter: QueryMetricPointFilters = {
      limit: null,
      metricKey: resolveMetricInputKey(feature.metricKey),
    };
    if (feature.biomarkerKey) {
      filter.biomarkerKey = feature.biomarkerKey;
    }
    if (to) {
      filter.to = to;
    }
    filtersByKey.set(metricFilterKey(filter), filter);
  }

  return [...filtersByKey.values()];
}

export function metricPointFiltersForMurphAgeInputBundle(asOf: string): QueryMetricPointFilters[] {
  const to = isoDayFromDateTime(asOf);
  return [...new Set(listMurphAgeInputBundleMetricKeys().map(resolveMetricInputKey))].map((metricKey) => {
    const filter: QueryMetricPointFilters = {
      limit: null,
      metricKey,
    };
    if (to) {
      filter.to = to;
    }
    return filter;
  });
}

async function loadMurphAgeMetricPoints(input: {
  asOf: string;
  model: MurphAgeRiskModel;
  vaultRoot: string;
}): Promise<MetricPoint[]> {
  const filters = metricPointFiltersForMurphAgeModel(input.model, input.asOf);
  return loadMetricPointsForFilters({ asOf: input.asOf, filters, vaultRoot: input.vaultRoot });
}

async function loadMurphAgeInputBundleMetricPoints(input: {
  asOf: string;
  vaultRoot: string;
}): Promise<MetricPoint[]> {
  const filters = metricPointFiltersForMurphAgeInputBundle(input.asOf);
  const points = await loadMetricPointsForFilters({ asOf: input.asOf, filters, vaultRoot: input.vaultRoot });
  return points.filter(isAllowedMurphAgeInputBundlePoint);
}

async function loadMetricPointsForFilters(input: {
  asOf: string;
  filters: readonly QueryMetricPointFilters[];
  vaultRoot: string;
}): Promise<MetricPoint[]> {
  const pointLists = await Promise.all(
    input.filters.map((filter) => listMetricPointsRuntime(input.vaultRoot, filter)),
  );
  const pointsById = new Map<string, MetricPoint>();
  for (const point of pointLists.flat()) {
    if (compareMetricPointToAsOf(point, input.asOf) > 0) continue;
    pointsById.set(point.id, point);
  }
  return [...pointsById.values()];
}

function invalidAsOfResult(input: CalculateMurphAgeForVaultInput): MurphAgeResult {
  const warning: MurphAgeWarning = {
    code: "INVALID_INPUT",
    message: "Murph Age query runtime requires a valid asOf timestamp.",
  };
  return {
    ageDeltaYears: null,
    biologicalAgeYears: null,
    chronologicalAgeYears: input.chronologicalAgeYears,
    featureAttributions: [],
    intervalYears: null,
    modelId: input.model.modelId,
    modelVersion: input.model.modelVersion ?? null,
    moduleAttributions: [],
    risk: null,
    schemaVersion: MURPH_AGE_RESULT_SCHEMA_VERSION,
    status: "abstain",
    warnings: [warning],
  };
}

function invalidCalculatorOutput(input: {
  message: string;
  mode: MurphAgeCalculatorMode;
}): MurphAgeCalculatorOutput {
  const warning: MurphAgeWarning = {
    code: "INVALID_INPUT",
    message: input.message,
  };
  return {
    bundleAssessment: {
      availableFeatureKeys: [],
      bundleId: "insufficient",
      featureStatuses: [],
      missingFeatureKeys: [],
      recommendedCardId: "none",
      schemaVersion: MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION,
      selectedMetricKeys: [],
      selectedPointIds: [],
      status: "abstain",
      warnings: [warning],
    },
    cardPolicy: null,
    mode: input.mode,
    result: null,
    schemaVersion: MURPH_AGE_RESULT_SCHEMA_VERSION,
    status: "abstain",
    warnings: [warning],
  };
}

function metricFilterKey(filter: QueryMetricPointFilters): string {
  return JSON.stringify([
    filter.metricKey ?? null,
    filter.biomarkerKey ?? null,
    filter.from ?? null,
    filter.to ?? null,
  ]);
}

function isoDayFromDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return undefined;
  return parseStrictUtcAsOf(`${day}T00:00:00.000Z`) ? day : undefined;
}

function parseStrictUtcAsOf(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millisecond = "0"] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, "0")),
  );
  if (!Number.isFinite(timestamp)) return null;
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }
  return parsed.toISOString();
}

function parseFlexibleAsOf(value: string): string | null {
  const parsed = parseFlexibleIsoDateTime(value) ?? parseIsoDay(value);
  if (!parsed) return null;
  return parsed.toISOString();
}

function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (!Number.isFinite(timestamp)) return null;
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return parsed;
}

function parseFlexibleIsoDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millisecond = "0", zone] = match;
  const localTimestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, "0")),
  );
  if (!Number.isFinite(localTimestamp)) return null;
  const offsetMinutes = zone === "Z" ? 0 : parseTimezoneOffsetMinutes(zone);
  if (offsetMinutes === null) return null;
  const localParsed = new Date(localTimestamp);
  if (
    localParsed.getUTCFullYear() !== Number(year)
    || localParsed.getUTCMonth() + 1 !== Number(month)
    || localParsed.getUTCDate() !== Number(day)
    || localParsed.getUTCHours() !== Number(hour)
    || localParsed.getUTCMinutes() !== Number(minute)
    || localParsed.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }
  return new Date(localTimestamp - offsetMinutes * 60_000);
}

function parseTimezoneOffsetMinutes(value: string): number | null {
  const match = /^([+-])(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const [, sign, hours, minutes] = match;
  const hourValue = Number(hours);
  const minuteValue = Number(minutes);
  if (hourValue > 23 || minuteValue > 59) return null;
  const absolute = hourValue * 60 + minuteValue;
  return sign === "+" ? absolute : -absolute;
}

function compareMetricPointToAsOf(point: MetricPoint, asOf: string): number {
  const observedAtMs = Date.parse(point.observedAt);
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(observedAtMs) || Number.isNaN(asOfMs)) return 0;
  return observedAtMs - asOfMs;
}

function normalizeCalculatorMode(value: unknown): MurphAgeCalculatorMode | null {
  if (value === undefined) return "product";
  return value === "product" || value === "research" ? value : null;
}

function isAllowedMurphAgeInputBundlePoint(point: MetricPoint): boolean {
  const metricKey = resolveMetricInputKey(point.metricKey);
  if (WEARABLE_CONTEXT_METRIC_KEYS.has(metricKey)) {
    return point.source.kind === "activity-summary"
      || point.source.kind === "sleep-summary"
      || point.source.kind === "wearable-summary";
  }
  return point.source.kind === "measurement" || point.source.kind === "test-result";
}

const WEARABLE_CONTEXT_METRIC_KEYS = new Set([
  "steps",
  "activity-minutes",
  "mvpa-minutes",
  "sedentary-minutes",
  "estimated-vo2-max",
  "total-sleep-minutes",
  "sleep-regularity-score",
  "sleep-midpoint-variability-minutes",
  "resting-heart-rate",
  "hrv-rmssd",
]);
