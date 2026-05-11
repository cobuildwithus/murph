import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION,
  MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  MURPH_AGE_RESULT_SCHEMA_VERSION,
  calculateMurphAge,
  calculateMurphAgeFromInputBundle,
  createMurphAgeLocalModelCardWarning,
  createMurphAgeAbstainedAuthorization,
  createMurphAgeCustomModelAuthorization,
  isMurphAgeInputBundleMetricPointAllowed,
  listMurphAgeInputBundleMetricKeys,
  parseMurphAgeLocalModelCardArtifact,
  resolveMetricInputKey,
  summarizeMurphAgeCalculatorPublicOutput,
  toPublicMurphAgeCalculatorReport,
  validateMurphAgeRiskModel,
  validateMurphAgeLocalModelCardArtifactPolicy,
  type MetricPoint,
  type MurphAgeCalculationInput,
  type MurphAgeCalculatorInput,
  type MurphAgeCalculatorMode,
  type MurphAgeCalculatorOutput,
  type MurphAgeLocalModelCardArtifact,
  type MurphAgePublicCalculatorReport,
  type MurphAgePublicDisplaySummary,
  type MurphAgeModelFeature,
  type MurphAgeResult,
  type MurphAgeRiskModel,
  type MurphAgeScoreBearingCardId,
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

export { MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION, type MurphAgeLocalModelCardArtifact };

export interface MurphAgeLocalModelCardLoadResult {
  models: Partial<Record<MurphAgeScoreBearingCardId, MurphAgeRiskModel>>;
  warnings: MurphAgeWarning[];
}

const MURPH_AGE_MODEL_CARD_RELATIVE_DIR = path.join(".runtime", "operations", "murph-age", "model-cards");

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

export async function summarizeMurphAgeFromVaultInputBundle(
  input: CalculateMurphAgeFromVaultInputBundleInput,
): Promise<MurphAgePublicDisplaySummary> {
  const output = await calculateMurphAgeFromVaultInputBundle(input);
  return summarizeMurphAgeCalculatorPublicOutput(output);
}

export async function calculateMurphAgePublicReportFromVaultInputBundle(
  input: CalculateMurphAgeFromVaultInputBundleInput,
): Promise<MurphAgePublicCalculatorReport> {
  const output = await calculateMurphAgeFromVaultInputBundle(input);
  return toPublicMurphAgeCalculatorReport(output);
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
      warnings: [createMurphAgeLocalModelCardWarning(
        "A local Murph Age model-card artifact directory could not be read.",
      )],
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
      warnings.push(createMurphAgeLocalModelCardWarning(
        "Duplicate local Murph Age model-card artifacts were found for the same card id.",
      ));
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
      warnings: [createMurphAgeLocalModelCardWarning("A local Murph Age model-card artifact could not be read.")],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      value: null,
      warnings: [createMurphAgeLocalModelCardWarning("A local Murph Age model-card artifact is not valid JSON.")],
    };
  }

  const artifact = parseMurphAgeLocalModelCardArtifact(parsed);
  if (!artifact.value) return artifact;

  const warnings = validateMurphAgeLocalModelCardArtifactPolicy(artifact.value);
  if (warnings.length > 0) {
    return { value: null, warnings };
  }
  return { value: artifact.value, warnings: [] };
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
  return points.filter(isMurphAgeInputBundleMetricPointAllowed);
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
    authorization: createMurphAgeCustomModelAuthorization(input.model),
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
    authorization: createMurphAgeAbstainedAuthorization(),
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
    wearableShadowIncrementAssessments: [],
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
