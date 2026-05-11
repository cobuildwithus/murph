import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION,
  MURPH_AGE_RESULT_SCHEMA_VERSION,
  calculateMurphAge,
  calculateMurphAgeFromInputBundle,
  listMurphAgeInputBundleMetricKeys,
  resolveMurphAgeModelCardPolicy,
  resolveMetricInputKey,
  validateMurphAgeRiskModel,
  type MetricPoint,
  type MetricSelectionPolicy,
  type MurphAgeCalculationInput,
  type MurphAgeCalculatorInput,
  type MurphAgeCalculatorMode,
  type MurphAgeCalculatorOutput,
  type MurphAgeModelFeature,
  type MurphAgeResult,
  type MurphAgeRiskModel,
  type MurphAgeScoreBearingCardId,
  type MurphAgeWarning,
} from "@murphai/health-metrics";
import { z } from "zod";

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

export const MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION = "murph.age.model-card-artifact.v1" as const;

export interface MurphAgeLocalModelCardArtifact {
  cardId: MurphAgeScoreBearingCardId;
  model: MurphAgeRiskModel;
  schemaVersion: typeof MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION;
}

export interface MurphAgeLocalModelCardLoadResult {
  models: Partial<Record<MurphAgeScoreBearingCardId, MurphAgeRiskModel>>;
  warnings: MurphAgeWarning[];
}

const MURPH_AGE_MODEL_CARD_RELATIVE_DIR = path.join(".runtime", "operations", "murph-age", "model-cards");

const murphAgeScoreBearingCardIdSchema = z.enum([
  "lab5_bp_bmi_transport_research",
  "lab9_bp_body_10y_acm_research",
]);

const metricSelectionPolicySchema: z.ZodType<MetricSelectionPolicy> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("latest-valid"),
    staleAfterDays: z.number().finite().positive().optional(),
  }).strict(),
  z.object({
    kind: z.literal("latest-lab"),
    preferCollectedAt: z.literal(true),
    preferFasting: z.boolean().optional(),
    staleAfterDays: z.number().finite().positive().optional(),
  }).strict(),
  z.object({
    kind: z.literal("daily-aggregate"),
    latestWindowDays: z.number().finite().positive().optional(),
    minimumPoints: z.number().finite().positive().optional(),
    staleAfterDays: z.number().finite().positive().optional(),
    statistic: z.enum(["mean", "median", "min", "max", "sum", "count"]),
  }).strict(),
  z.object({
    kind: z.literal("latest-device-estimate"),
    staleAfterDays: z.number().finite().positive().optional(),
  }).strict(),
  z.object({
    kind: z.literal("qualified-latest"),
    requiredQualifiers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    staleAfterDays: z.number().finite().positive().optional(),
  }).strict(),
]);

const featureTransformSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("identity") }).strict(),
  z.object({
    kind: z.literal("ln"),
    offset: z.number().finite().optional(),
  }).strict(),
  z.object({
    clamp: z.object({
      max: z.number().finite().optional(),
      min: z.number().finite().optional(),
    }).strict().optional(),
    kind: z.literal("z-score"),
    mean: z.number().finite(),
    standardDeviation: z.number().finite().positive(),
  }).strict(),
]);

const murphAgeModelFeatureSchema: z.ZodType<MurphAgeModelFeature> = z.discriminatedUnion("kind", [
  z.object({
    coefficient: z.number().finite(),
    key: z.string().min(1),
    kind: z.literal("chronological-age"),
    label: z.string().min(1),
    moduleId: z.string().min(1).optional(),
    transform: featureTransformSchema.optional(),
  }).strict(),
  z.object({
    coefficient: z.number().finite(),
    key: z.string().min(1),
    kind: z.literal("sex"),
    label: z.string().min(1),
    moduleId: z.string().min(1).optional(),
    sex: z.enum(["female", "male"]),
    transform: featureTransformSchema.optional(),
  }).strict(),
  z.object({
    biomarkerKey: z.string().min(1).optional(),
    coefficient: z.number().finite(),
    expectedUnit: z.string().min(1).optional(),
    key: z.string().min(1),
    kind: z.literal("metric"),
    label: z.string().min(1),
    metricKey: z.string().min(1),
    moduleId: z.string().min(1).optional(),
    required: z.boolean().optional(),
    selectionPolicy: metricSelectionPolicySchema.optional(),
    transform: featureTransformSchema.optional(),
  }).strict(),
]);

const murphAgeRiskModelSchema: z.ZodType<MurphAgeRiskModel> = z.object({
  blockedBiomarkerKeys: z.array(z.string().min(1)).optional(),
  blockedMetricKeys: z.array(z.string().min(1)).optional(),
  calibration: z.object({
    intercept: z.number().finite(),
    slope: z.number().finite(),
  }).strict().optional(),
  endpoint: z.string().min(1),
  features: z.array(murphAgeModelFeatureSchema).min(1),
  horizonYears: z.number().finite().positive(),
  intercept: z.number().finite(),
  modelId: z.string().min(1),
  modelVersion: z.string().min(1).optional(),
  referencePopulation: z.string().min(1),
  referenceRiskCurve: z.array(z.object({
    ageYears: z.number().finite(),
    riskProbability: z.number().finite().min(0).max(1),
  }).strict()).min(2),
  uncertainty: z.object({
    baseYears: z.number().finite().nonnegative().optional(),
    perLowConfidenceMetricYears: z.number().finite().nonnegative().optional(),
    perMissingOptionalFeatureYears: z.number().finite().nonnegative().optional(),
  }).strict().optional(),
}).strict();

const murphAgeLocalModelCardArtifactSchema: z.ZodType<MurphAgeLocalModelCardArtifact> = z.object({
  cardId: murphAgeScoreBearingCardIdSchema,
  model: murphAgeRiskModelSchema,
  schemaVersion: z.literal(MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION),
}).strip();

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
  const localModelCards = mode === "research"
    ? await loadMurphAgeLocalModelCardArtifacts({ vaultRoot: input.vaultRoot })
    : { models: {}, warnings: [] };

  const output = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: input.chronologicalAgeYears,
    mode,
    models: { ...localModelCards.models, ...input.models },
    points,
    sex: input.sex,
  });
  return withPrependedWarnings(output, localModelCards.warnings);
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

export function defaultMurphAgeModelCardArtifactRoot(vaultRoot: string): string {
  return path.join(vaultRoot, MURPH_AGE_MODEL_CARD_RELATIVE_DIR);
}

export async function loadMurphAgeLocalModelCardArtifacts(input: {
  vaultRoot: string;
}): Promise<MurphAgeLocalModelCardLoadResult> {
  const root = defaultMurphAgeModelCardArtifactRoot(input.vaultRoot);
  let entries: Array<{ isFile(): boolean; name: string }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return { models: {}, warnings: [] };
    }
    return {
      models: {},
      warnings: [localModelCardWarning("A local Murph Age model-card artifact directory could not be read.")],
    };
  }

  const models: Partial<Record<MurphAgeScoreBearingCardId, MurphAgeRiskModel>> = {};
  const warnings: MurphAgeWarning[] = [];
  const jsonEntries = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of jsonEntries) {
    const artifact = await readLocalModelCardArtifact(path.join(root, entry.name));
    warnings.push(...artifact.warnings);
    if (!artifact.value) continue;
    if (models[artifact.value.cardId]) {
      warnings.push(localModelCardWarning("Duplicate local Murph Age model-card artifacts were found for the same card id."));
      continue;
    }
    models[artifact.value.cardId] = artifact.value.model;
  }

  return { models, warnings };
}

async function readLocalModelCardArtifact(filePath: string): Promise<{
  value: MurphAgeLocalModelCardArtifact | null;
  warnings: MurphAgeWarning[];
}> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return {
      value: null,
      warnings: [localModelCardWarning("A local Murph Age model-card artifact could not be read.")],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      value: null,
      warnings: [localModelCardWarning("A local Murph Age model-card artifact is not valid JSON.")],
    };
  }

  const artifact = murphAgeLocalModelCardArtifactSchema.safeParse(parsed);
  if (!artifact.success) {
    return {
      value: null,
      warnings: [localModelCardWarning("A local Murph Age model-card artifact does not match the expected schema.")],
    };
  }

  const warnings = validateLocalModelCardArtifactPolicy(artifact.data);
  if (warnings.length > 0) {
    return { value: null, warnings };
  }
  return { value: artifact.data, warnings: [] };
}

function validateLocalModelCardArtifactPolicy(artifact: MurphAgeLocalModelCardArtifact): MurphAgeWarning[] {
  const modelValidation = validateMurphAgeRiskModel(artifact.model);
  const warnings: MurphAgeWarning[] = [];
  if (modelValidation.status === "invalid") {
    return [localModelCardWarning("A local Murph Age model-card artifact contains an invalid model.")];
  }
  const policy = resolveMurphAgeModelCardPolicy(artifact.cardId);
  if (!policy?.scoreBearing) {
    warnings.push(localModelCardWarning("A local Murph Age model-card artifact selected a non-score-bearing card id."));
    return warnings;
  }

  const allowedMetricKeys = new Set(policy.scoreBearingMetricKeys.map(resolveMetricInputKey));
  for (const feature of artifact.model.features) {
    if (feature.kind !== "metric") continue;
    const metricKey = resolveMetricInputKey(feature.metricKey);
    if (!allowedMetricKeys.has(metricKey)) {
      warnings.push({
        code: "MODEL_CARD_POLICY_VIOLATION",
        featureKey: feature.key,
        message: `${artifact.cardId} does not authorize a local score-bearing feature for this metric.`,
        metricKey,
      });
    }
  }
  return warnings;
}

function localModelCardWarning(message: string): MurphAgeWarning {
  return {
    code: "INVALID_INPUT",
    message,
  };
}

function withPrependedWarnings(
  output: MurphAgeCalculatorOutput,
  warnings: readonly MurphAgeWarning[],
): MurphAgeCalculatorOutput {
  if (warnings.length === 0) return output;
  return {
    ...output,
    warnings: [...warnings, ...output.warnings],
  };
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
    contextAssessments: [],
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

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && error.code === "ENOENT";
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
