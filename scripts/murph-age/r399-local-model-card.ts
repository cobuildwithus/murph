import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  parseMurphAgeLocalModelCardArtifact,
  validateMurphAgeLocalModelCardArtifactPolicy,
  type MurphAgeFeatureTransform,
  type MurphAgeLocalModelCardArtifact,
  type MurphAgeModelFeature,
  type MurphAgeReferenceRiskPoint,
  type MurphAgeRiskModel,
  type MurphAgeSex,
} from "@murphai/health-metrics";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R399_LOCAL_MODEL_CARD_EXPORT_SCHEMA_VERSION =
  "murph-age-r399-local-model-card-export.v1" as const;
export const FROZEN_R399_MODEL_ID = "r399_compact_age_nonlinear_l2_0p000" as const;
export const R399_RESEARCH_CARD_ID = "r399_nhis_proxy_10y_acm_research" as const;
export const R399_LOCAL_MODEL_CARD_FILENAME = "r399-nhis-proxy-anchor-local-research.json" as const;

export const DEFAULT_R399_PARAMS_PATH = path.join(
  ".runtime",
  "cache",
  "murph-age",
  "external-sources",
  "nhis-public-lmf",
  "ml-loop",
  "runs",
  "session_murph_age_r399_nhis_compact_ultralow_l2_loop",
  "local-model-params-r399.json",
);
export const DEFAULT_R399_MODEL_CARD_OUTPUT_DIR = path.join(
  ".runtime",
  "operations",
  "murph-age",
  "model-cards",
);

export const FROZEN_R399_FEATURE_KEYS = [
  "age_years",
  "sex_female",
  "body_mass_index",
  "self_rated_health",
  "hypertension_history_proxy_yes",
  "diabetes_history_proxy_yes",
  "smoking_status_proxy",
  "physical_activity_proxy",
  "body_mass_index_missing",
  "self_rated_health_missing",
  "hypertension_history_proxy_missing",
  "diabetes_history_proxy_missing",
  "smoking_status_proxy_missing",
  "physical_activity_proxy_missing",
  "age_years_squared",
  "age_x_sex_female",
] as const;

export type FrozenR399FeatureKey = typeof FROZEN_R399_FEATURE_KEYS[number];

const FROZEN_R399_FEATURE_KEY_ALLOWLIST = new Set<string>(FROZEN_R399_FEATURE_KEYS);
const REFERENCE_CURVE_AGE_GRID = [20, 30, 40, 50, 60, 70, 80, 90] as const;
const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Z_SCORE_CLAMP = { max: 3, min: -3 } as const;

export interface R399LocalModelCardExportOptions {
  createdAt?: string;
  modelCardOutputDir?: string;
  paramsPath?: string;
}

export interface R399LocalModelCardExportSummary {
  artifact: typeof R399_LOCAL_MODEL_CARD_FILENAME;
  cardId: typeof R399_RESEARCH_CARD_ID;
  coefficientsStored: false;
  featureCount: number;
  localPathsStored: false;
  modelId: typeof FROZEN_R399_MODEL_ID;
  modelParametersStored: false;
  participantIdentifiersStored: false;
  predictionsStored: false;
  rowValuesStored: false;
  schemaVersion: typeof R399_LOCAL_MODEL_CARD_EXPORT_SCHEMA_VERSION;
  sourceBodiesStored: false;
  splitMembershipStored: false;
  status: "research-local-model-card-ready";
}

interface R399SelectedModel {
  calibration?: {
    intercept: number;
    slope: number;
  };
  coefficients: Record<FrozenR399FeatureKey, number>;
  features: readonly FrozenR399FeatureKey[];
  imputationMedians: Record<FrozenR399FeatureKey, number>;
  intercept: number;
  standardizationMeans: Record<FrozenR399FeatureKey, number>;
  standardizationStds: Record<FrozenR399FeatureKey, number>;
}

interface R399RuntimeInputFixture {
  ageYears: number;
  metrics: Partial<Record<R399MetricKey, number>>;
  sex: MurphAgeSex;
}

type R399MetricKey =
  | "bmi"
  | "diabetes-history-proxy-yes"
  | "hypertension-history-proxy-yes"
  | "physical-activity-proxy"
  | "self-rated-health"
  | "smoking-status-proxy";

export async function runR399LocalModelCardExport(
  options: R399LocalModelCardExportOptions = {},
): Promise<{
  artifact: MurphAgeLocalModelCardArtifact;
  artifactPath: string;
  summary: R399LocalModelCardExportSummary;
}> {
  const params = await readR399SelectedModel(resolveR399RepoPath(options.paramsPath ?? DEFAULT_R399_PARAMS_PATH));
  const outputDir = resolveR399RepoPath(options.modelCardOutputDir ?? DEFAULT_R399_MODEL_CARD_OUTPUT_DIR);
  await assertAllowedR399LocalModelCardOutputDir(outputDir);

  const artifact = createR399LocalModelCardArtifact(params, options.createdAt);
  assertR399LocalModelCardArtifactValid(artifact);
  assertR399ModelCardMatchesSelectedModel(params, artifact.model);

  const artifactPath = path.join(outputDir, R399_LOCAL_MODEL_CARD_FILENAME);
  try {
    await mkdir(outputDir, { recursive: true });
    await assertNoExistingSymlink(artifactPath);
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  } catch {
    throw new Error("Failed to write R399 local model-card artifact.");
  }

  const summary: R399LocalModelCardExportSummary = {
    artifact: R399_LOCAL_MODEL_CARD_FILENAME,
    cardId: R399_RESEARCH_CARD_ID,
    coefficientsStored: false,
    featureCount: artifact.model.features.length,
    localPathsStored: false,
    modelId: FROZEN_R399_MODEL_ID,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    predictionsStored: false,
    rowValuesStored: false,
    schemaVersion: R399_LOCAL_MODEL_CARD_EXPORT_SCHEMA_VERSION,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-model-card-ready",
  };
  const egressFindings = findForbiddenAggregateEgress(summary);
  if (egressFindings.length > 0) {
    throw new Error(`R399 local model-card summary failed aggregate-egress validation: ${egressFindings.join("; ")}`);
  }
  return { artifact, artifactPath, summary };
}

export async function assertR399LocalModelCardMatchesParams(input: {
  artifact: MurphAgeLocalModelCardArtifact;
  paramsPath: string;
}): Promise<void> {
  const params = await readR399SelectedModel(input.paramsPath);
  const expectedArtifact = createR399LocalModelCardArtifact(params, undefined);
  assertR399LocalModelCardArtifactEquivalent(input.artifact, expectedArtifact);
  assertR399ModelCardMatchesSelectedModel(params, input.artifact.model);
}

export function resolveR399RepoPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(SCRIPT_REPO_ROOT, filePath);
}

export function validateFrozenR399FeatureKeys(features: readonly string[]): asserts features is readonly FrozenR399FeatureKey[] {
  const allowedCount = FROZEN_R399_FEATURE_KEYS.length;
  if (
    features.length !== allowedCount
    || new Set(features).size !== allowedCount
    || features.some((feature) => !FROZEN_R399_FEATURE_KEY_ALLOWLIST.has(feature))
  ) {
    throw new Error("Frozen R399 feature set does not match the expected allowlist.");
  }
}

export async function assertAllowedR399LocalModelCardOutputDir(outputDir: string): Promise<void> {
  await assertAllowedLocalRuntimeOutputDir({
    errorMessage: "R399 local model-card output must target an ignored local runtime model-card directory.",
    outputDir,
    repoRelativeDir: DEFAULT_R399_MODEL_CARD_OUTPUT_DIR,
  });
}

export async function assertAllowedR399LocalModelCardArtifactPath(filePath: string): Promise<void> {
  await assertAllowedR399LocalModelCardOutputDir(path.dirname(filePath));
}

export async function assertAllowedR399ReadinessOutputDir(outputDir: string): Promise<void> {
  await assertAllowedLocalRuntimeOutputDir({
    errorMessage: "R399 readiness output must target an ignored local runtime model-runs directory.",
    outputDir,
    repoRelativeDir: path.join(".runtime", "operations", "research", "murph-age", "model-runs"),
  });
}

async function assertAllowedLocalRuntimeOutputDir(input: {
  errorMessage: string;
  outputDir: string;
  repoRelativeDir: string;
}): Promise<void> {
  const normalized = path.resolve(input.outputDir);
  const scriptRepoRoot = await realpath(SCRIPT_REPO_ROOT);
  const repoRuntimeRoot = path.join(scriptRepoRoot, input.repoRelativeDir);
  const realOutputDir = await resolveRealBoundaryPath(normalized);
  const requiredSuffix = input.repoRelativeDir;
  const tempRoot = await realpath(os.tmpdir());

  if (normalized === repoRuntimeRoot && realOutputDir === repoRuntimeRoot) return;
  if (isPathInside(scriptRepoRoot, normalized) || isPathInside(scriptRepoRoot, realOutputDir)) {
    throw new Error(input.errorMessage);
  }
  if (isPathInside(tempRoot, realOutputDir) && !(await hasDotGitAncestor(realOutputDir, tempRoot))) return;
  if (
    normalized.endsWith(requiredSuffix)
    && !isPathInside(scriptRepoRoot, realOutputDir)
    && !(await hasDotGitAncestor(realOutputDir, path.parse(realOutputDir).root))
  ) return;
  throw new Error(input.errorMessage);
}

async function resolveRealBoundaryPath(targetPath: string): Promise<string> {
  const missingParts: string[] = [];
  let cursor = targetPath;
  while (true) {
    try {
      await lstat(cursor);
      const realCursor = await realpath(cursor);
      return path.join(realCursor, ...missingParts.reverse());
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw new Error("Failed to resolve R399 local model-card output directory.");
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new Error("Failed to resolve R399 local model-card output directory.");
      }
      missingParts.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function hasDotGitAncestor(targetPath: string, stopRoot: string): Promise<boolean> {
  let cursor = targetPath;
  while (isPathInside(stopRoot, cursor)) {
    if (await pathExists(path.join(cursor, ".git"))) return true;
    if (cursor === stopRoot) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return false;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) return false;
    throw new Error("Failed to inspect R399 local model-card output directory.");
  }
}

async function assertNoExistingSymlink(filePath: string): Promise<void> {
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error("R399 local model-card artifact target must not be a symlink.");
    }
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) return;
    throw error;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readR399SelectedModel(filePath: string): Promise<R399SelectedModel> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    throw new Error("Failed to read R399 local parameter artifact.");
  }
  const value = parseJson(raw, "R399 local parameter artifact");
  const root = requiredRecord(value, "R399 local parameter artifact");
  if (root.stored_under_ignored_runtime_only !== true) {
    throw new Error("R399 local parameter artifact must attest that it stays under ignored runtime only.");
  }
  if (root.row_values_in_this_artifact !== false || root.predictions_in_this_artifact !== false) {
    throw new Error("R399 local parameter artifact must attest that row values and predictions are absent.");
  }
  if (root.model_params_in_output_package !== false) {
    throw new Error("R399 local parameter artifact must attest that model params are not in output packages.");
  }

  const models = requiredRecord(root.models, "R399 models");
  const selected = requiredRecord(models[FROZEN_R399_MODEL_ID], "frozen R399 model");
  const featureStrings = requiredStringArray(selected.features, "frozen R399 feature keys");
  validateFrozenR399FeatureKeys(featureStrings);
  const features = [...featureStrings];
  const coefficients = requiredNumberArray(selected.coefficients, "frozen R399 coefficients");
  if (coefficients.length !== features.length) {
    throw new Error("Frozen R399 coefficient count does not match the feature count.");
  }

  return {
    calibration: parseCalibration(selected.posthoc_calibration),
    coefficients: numbersByFeature(features, coefficients, "frozen R399 coefficients"),
    features,
    imputationMedians: numberMapByFeature(selected.imputation_medians, features, "frozen R399 imputation medians"),
    intercept: requiredFiniteNumber(selected.intercept, "frozen R399 intercept"),
    standardizationMeans: numberMapByFeature(
      selected.standardization_means,
      features,
      "frozen R399 standardization means",
    ),
    standardizationStds: positiveNumberMapByFeature(
      selected.standardization_stds,
      features,
      "frozen R399 standardization standard deviations",
    ),
  };
}

function createR399LocalModelCardArtifact(
  params: R399SelectedModel,
  createdAt: string | undefined,
): MurphAgeLocalModelCardArtifact {
  const model: MurphAgeRiskModel = {
    blockedBiomarkerKeys: ["crp", "hs-crp", "hscrp", "c-reactive-protein"],
    endpoint: "10-year all-cause mortality",
    features: params.features.map((featureKey) => runtimeFeature(params, featureKey)),
    horizonYears: 10,
    intercept: params.intercept,
    modelId: FROZEN_R399_MODEL_ID,
    modelVersion: createdAt ? `local-r399.${createdAt}` : "local-r399",
    referencePopulation: "NHIS 1997-2009 linked mortality proxy anchor; ignored local research artifact",
    referenceRiskCurve: createReferenceRiskCurve(params),
    uncertainty: {
      baseYears: 5,
      perLowConfidenceMetricYears: 1,
      perMissingOptionalFeatureYears: 2,
    },
  };
  if (params.calibration) model.calibration = params.calibration;
  return {
    cardId: R399_RESEARCH_CARD_ID,
    model,
    schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  };
}

function assertR399LocalModelCardArtifactEquivalent(
  actual: MurphAgeLocalModelCardArtifact,
  expected: MurphAgeLocalModelCardArtifact,
): void {
  const modelVersion = actual.model.modelVersion ?? "";
  const modelVersionAllowed = modelVersion === "local-r399" || modelVersion.startsWith("local-r399.");
  if (
    actual.cardId !== expected.cardId
    || actual.schemaVersion !== expected.schemaVersion
    || actual.model.modelId !== expected.model.modelId
    || actual.model.endpoint !== expected.model.endpoint
    || actual.model.horizonYears !== expected.model.horizonYears
    || actual.model.intercept !== expected.model.intercept
    || actual.model.referencePopulation !== expected.model.referencePopulation
    || !modelVersionAllowed
    || stableStringify(actual.model.blockedBiomarkerKeys ?? []) !== stableStringify(expected.model.blockedBiomarkerKeys ?? [])
    || stableStringify(actual.model.calibration ?? null) !== stableStringify(expected.model.calibration ?? null)
    || stableStringify(actual.model.features) !== stableStringify(expected.model.features)
    || stableStringify(actual.model.referenceRiskCurve) !== stableStringify(expected.model.referenceRiskCurve)
    || stableStringify(actual.model.uncertainty ?? null) !== stableStringify(expected.model.uncertainty ?? null)
  ) {
    throw new Error("R399 local model-card artifact does not match the frozen R399 parameter artifact.");
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortJsonValue(record[key])]),
  );
}

function runtimeFeature(params: R399SelectedModel, featureKey: FrozenR399FeatureKey): MurphAgeModelFeature {
  const coefficient = params.coefficients[featureKey];
  const transform = zScoreTransform(params, featureKey);
  switch (featureKey) {
    case "age_years":
      return {
        coefficient,
        key: "age",
        kind: "chronological-age",
        label: "Age",
        moduleId: "demographics",
        transform,
      };
    case "sex_female":
      return {
        coefficient,
        key: "female",
        kind: "sex",
        label: "Female",
        moduleId: "demographics",
        sex: "female",
        transform,
      };
    case "body_mass_index":
      return metricFeature(params, featureKey, {
        expectedUnit: "kg/m^2",
        key: "bmi",
        label: "BMI",
        metricKey: "bmi",
        moduleId: "body",
      });
    case "self_rated_health":
      return metricFeature(params, featureKey, {
        key: "self-rated-health",
        label: "Self-rated health",
        metricKey: "self-rated-health",
        moduleId: "function",
      });
    case "hypertension_history_proxy_yes":
      return metricFeature(params, featureKey, {
        key: "hypertension-history",
        label: "Hypertension history",
        metricKey: "hypertension-history-proxy-yes",
        moduleId: "cardiovascular",
      });
    case "diabetes_history_proxy_yes":
      return metricFeature(params, featureKey, {
        key: "diabetes-history",
        label: "Diabetes history",
        metricKey: "diabetes-history-proxy-yes",
        moduleId: "metabolic",
      });
    case "smoking_status_proxy":
      return metricFeature(params, featureKey, {
        key: "smoking-status",
        label: "Smoking status",
        metricKey: "smoking-status-proxy",
        moduleId: "behavior",
      });
    case "physical_activity_proxy":
      return metricFeature(params, featureKey, {
        key: "physical-activity-proxy",
        label: "Physical activity",
        metricKey: "physical-activity-proxy",
        moduleId: "activity",
      });
    case "body_mass_index_missing":
      return missingnessFeature(params, featureKey, "bmi", "BMI missing");
    case "self_rated_health_missing":
      return missingnessFeature(params, featureKey, "self-rated-health", "Self-rated health missing");
    case "hypertension_history_proxy_missing":
      return missingnessFeature(params, featureKey, "hypertension-history-proxy-yes", "Hypertension history missing");
    case "diabetes_history_proxy_missing":
      return missingnessFeature(params, featureKey, "diabetes-history-proxy-yes", "Diabetes history missing");
    case "smoking_status_proxy_missing":
      return missingnessFeature(params, featureKey, "smoking-status-proxy", "Smoking status missing");
    case "physical_activity_proxy_missing":
      return missingnessFeature(params, featureKey, "physical-activity-proxy", "Physical activity missing");
    case "age_years_squared":
      return {
        coefficient,
        key: "age-squared",
        kind: "chronological-age-squared",
        label: "Age squared",
        moduleId: "demographics",
        transform,
      };
    case "age_x_sex_female":
      return {
        coefficient,
        key: "age-x-female",
        kind: "age-sex-interaction",
        label: "Age by female",
        moduleId: "demographics",
        sex: "female",
        transform,
      };
  }
}

function metricFeature(
  params: R399SelectedModel,
  featureKey: FrozenR399FeatureKey,
  spec: {
    expectedUnit?: string;
    key: string;
    label: string;
    metricKey: R399MetricKey;
    moduleId: string;
  },
): MurphAgeModelFeature {
  const feature: MurphAgeModelFeature = {
    coefficient: params.coefficients[featureKey],
    key: spec.key,
    kind: "metric",
    label: spec.label,
    metricKey: spec.metricKey,
    missingValue: params.imputationMedians[featureKey],
    moduleId: spec.moduleId,
    required: false,
    transform: zScoreTransform(params, featureKey),
  };
  if (spec.expectedUnit) feature.expectedUnit = spec.expectedUnit;
  return feature;
}

function missingnessFeature(
  params: R399SelectedModel,
  featureKey: FrozenR399FeatureKey,
  metricKey: R399MetricKey,
  label: string,
): MurphAgeModelFeature {
  return {
    coefficient: params.coefficients[featureKey],
    key: `${metricKey}-missing`,
    kind: "metric-missingness",
    label,
    metricKey,
    moduleId: "data-quality",
    transform: zScoreTransform(params, featureKey),
  };
}

function zScoreTransform(params: R399SelectedModel, featureKey: FrozenR399FeatureKey): MurphAgeFeatureTransform {
  return {
    clamp: Z_SCORE_CLAMP,
    kind: "z-score",
    mean: params.standardizationMeans[featureKey],
    standardDeviation: params.standardizationStds[featureKey],
  };
}

function createReferenceRiskCurve(params: R399SelectedModel): readonly MurphAgeReferenceRiskPoint[] {
  const referenceMetrics: Partial<Record<R399MetricKey, number>> = {
    bmi: params.imputationMedians.body_mass_index,
    "diabetes-history-proxy-yes": params.imputationMedians.diabetes_history_proxy_yes,
    "hypertension-history-proxy-yes": params.imputationMedians.hypertension_history_proxy_yes,
    "physical-activity-proxy": params.imputationMedians.physical_activity_proxy,
    "self-rated-health": params.imputationMedians.self_rated_health,
    "smoking-status-proxy": params.imputationMedians.smoking_status_proxy,
  };
  let previousRisk = 0;
  return REFERENCE_CURVE_AGE_GRID.map((ageYears) => {
    const riskProbability = Math.max(
      previousRisk,
      scoreSelectedModel(params, {
        ageYears,
        metrics: referenceMetrics,
        sex: params.imputationMedians.sex_female >= 0.5 ? "female" : "male",
      }),
    );
    previousRisk = riskProbability;
    return {
      ageYears,
      riskProbability: roundProbability(riskProbability),
    };
  });
}

function assertR399LocalModelCardArtifactValid(artifact: MurphAgeLocalModelCardArtifact): void {
  const parsed = parseMurphAgeLocalModelCardArtifact(artifact);
  if (!parsed.value || parsed.warnings.length > 0) {
    throw new Error("R399 local model-card artifact failed schema validation.");
  }
  const policyWarnings = validateMurphAgeLocalModelCardArtifactPolicy(parsed.value);
  if (policyWarnings.length > 0) {
    throw new Error("R399 local model-card artifact failed policy validation.");
  }
}

function assertR399ModelCardMatchesSelectedModel(
  params: R399SelectedModel,
  runtimeModel: MurphAgeRiskModel,
): void {
  const fixtures: R399RuntimeInputFixture[] = [
    {
      ageYears: 52,
      metrics: {
        "diabetes-history-proxy-yes": 0,
        "hypertension-history-proxy-yes": 1,
        "physical-activity-proxy": 2,
        "self-rated-health": 3,
      },
      sex: "female",
    },
    {
      ageYears: 54,
      metrics: {
        bmi: 26,
        "diabetes-history-proxy-yes": 0,
        "hypertension-history-proxy-yes": 0,
        "physical-activity-proxy": 3,
        "smoking-status-proxy": 1,
      },
      sex: "male",
    },
    {
      ageYears: 58,
      metrics: {
        bmi: 28,
        "diabetes-history-proxy-yes": 0,
        "physical-activity-proxy": 2,
        "self-rated-health": 3,
        "smoking-status-proxy": 1,
      },
      sex: "female",
    },
    {
      ageYears: 62,
      metrics: {
        bmi: 29,
        "hypertension-history-proxy-yes": 1,
        "physical-activity-proxy": 1,
        "self-rated-health": 4,
        "smoking-status-proxy": 2,
      },
      sex: "male",
    },
    {
      ageYears: 66,
      metrics: {
        bmi: 30,
        "diabetes-history-proxy-yes": 1,
        "hypertension-history-proxy-yes": 1,
        "self-rated-health": 4,
        "smoking-status-proxy": 2,
      },
      sex: "female",
    },
    {
      ageYears: 45,
      metrics: {
        bmi: 24,
        "diabetes-history-proxy-yes": 0,
        "hypertension-history-proxy-yes": 0,
        "physical-activity-proxy": 3,
        "self-rated-health": 2,
        "smoking-status-proxy": 0,
      },
      sex: "female",
    },
    {
      ageYears: 68,
      metrics: {
        bmi: 31,
        "diabetes-history-proxy-yes": 1,
        "hypertension-history-proxy-yes": 1,
        "physical-activity-proxy": 1,
        "self-rated-health": 4,
        "smoking-status-proxy": 2,
      },
      sex: "male",
    },
  ];
  for (const fixture of fixtures) {
    const selectedProbability = scoreSelectedModel(params, fixture);
    const runtimeProbability = scoreRuntimeModel(runtimeModel, fixture);
    if (Math.abs(selectedProbability - runtimeProbability) > 1e-10) {
      throw new Error("R399 local model-card export failed selected/runtime parity validation.");
    }
  }
}

function scoreSelectedModel(params: R399SelectedModel, fixture: R399RuntimeInputFixture): number {
  const linearScore = params.features.reduce((sum, featureKey) => {
    const rawValue = selectedRawFeatureValue(params, featureKey, fixture);
    return sum + params.coefficients[featureKey] * transformZScore(rawValue, params, featureKey);
  }, params.intercept);
  return sigmoid(applyCalibration(linearScore, params.calibration));
}

function selectedRawFeatureValue(
  params: R399SelectedModel,
  featureKey: FrozenR399FeatureKey,
  fixture: R399RuntimeInputFixture,
): number {
  switch (featureKey) {
    case "age_years":
      return fixture.ageYears;
    case "sex_female":
      return fixture.sex === "female" ? 1 : 0;
    case "body_mass_index":
      return metricFixtureValue(fixture, "bmi") ?? params.imputationMedians.body_mass_index;
    case "self_rated_health":
      return metricFixtureValue(fixture, "self-rated-health") ?? params.imputationMedians.self_rated_health;
    case "hypertension_history_proxy_yes":
      return metricFixtureValue(fixture, "hypertension-history-proxy-yes")
        ?? params.imputationMedians.hypertension_history_proxy_yes;
    case "diabetes_history_proxy_yes":
      return metricFixtureValue(fixture, "diabetes-history-proxy-yes")
        ?? params.imputationMedians.diabetes_history_proxy_yes;
    case "smoking_status_proxy":
      return metricFixtureValue(fixture, "smoking-status-proxy") ?? params.imputationMedians.smoking_status_proxy;
    case "physical_activity_proxy":
      return metricFixtureValue(fixture, "physical-activity-proxy") ?? params.imputationMedians.physical_activity_proxy;
    case "body_mass_index_missing":
      return metricMissingnessFixtureValue(fixture, "bmi");
    case "self_rated_health_missing":
      return metricMissingnessFixtureValue(fixture, "self-rated-health");
    case "hypertension_history_proxy_missing":
      return metricMissingnessFixtureValue(fixture, "hypertension-history-proxy-yes");
    case "diabetes_history_proxy_missing":
      return metricMissingnessFixtureValue(fixture, "diabetes-history-proxy-yes");
    case "smoking_status_proxy_missing":
      return metricMissingnessFixtureValue(fixture, "smoking-status-proxy");
    case "physical_activity_proxy_missing":
      return metricMissingnessFixtureValue(fixture, "physical-activity-proxy");
    case "age_years_squared":
      return fixture.ageYears ** 2;
    case "age_x_sex_female":
      return fixture.ageYears * (fixture.sex === "female" ? 1 : 0);
  }
}

function scoreRuntimeModel(model: MurphAgeRiskModel, fixture: R399RuntimeInputFixture): number {
  const linearScore = model.features.reduce((sum, feature) => {
    const rawValue = runtimeRawFeatureValue(feature, fixture);
    return sum + feature.coefficient * transformRuntimeValue(rawValue, feature.transform ?? { kind: "identity" });
  }, model.intercept);
  return sigmoid(applyCalibration(linearScore, model.calibration));
}

function runtimeRawFeatureValue(feature: MurphAgeModelFeature, fixture: R399RuntimeInputFixture): number {
  switch (feature.kind) {
    case "chronological-age":
      return fixture.ageYears;
    case "chronological-age-squared":
      return fixture.ageYears ** 2;
    case "age-sex-interaction":
      return fixture.ageYears * (fixture.sex === feature.sex ? 1 : 0);
    case "sex":
      return fixture.sex === feature.sex ? 1 : 0;
    case "metric":
      return runtimeMetricFixtureValue(fixture, feature);
    case "metric-missingness":
      return metricMissingnessFixtureValue(fixture, toR399MetricKey(feature.metricKey));
  }
}

function toR399MetricKey(metricKey: string): R399MetricKey {
  switch (metricKey) {
    case "bmi":
    case "diabetes-history-proxy-yes":
    case "hypertension-history-proxy-yes":
    case "physical-activity-proxy":
    case "self-rated-health":
    case "smoking-status-proxy":
      return metricKey;
    default:
      throw new Error("R399 local model-card parity fixture found an unsupported metric key.");
  }
}

function metricFixtureValue(fixture: R399RuntimeInputFixture, metricKey: R399MetricKey): number | null {
  const value = fixture.metrics[metricKey];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function runtimeMetricFixtureValue(
  fixture: R399RuntimeInputFixture,
  feature: MurphAgeModelFeature & { kind: "metric" },
): number {
  const value = metricFixtureValue(fixture, toR399MetricKey(feature.metricKey));
  if (value !== null) return value;
  if (feature.missingValue !== undefined) return feature.missingValue;
  throw new Error("R399 local model-card parity fixture is missing a metric value.");
}

function metricMissingnessFixtureValue(fixture: R399RuntimeInputFixture, metricKey: R399MetricKey): number {
  return Number.isFinite(fixture.metrics[metricKey]) ? 0 : 1;
}

function transformZScore(
  rawValue: number,
  params: R399SelectedModel,
  featureKey: FrozenR399FeatureKey,
): number {
  return clamp(
    (rawValue - params.standardizationMeans[featureKey]) / params.standardizationStds[featureKey],
    Z_SCORE_CLAMP.min,
    Z_SCORE_CLAMP.max,
  );
}

function transformRuntimeValue(rawValue: number, transform: MurphAgeFeatureTransform): number {
  switch (transform.kind) {
    case "identity":
      return rawValue;
    case "ln":
      return Math.log(rawValue + (transform.offset ?? 0));
    case "z-score":
      return clamp(
        (rawValue - transform.mean) / transform.standardDeviation,
        transform.clamp?.min ?? Number.NEGATIVE_INFINITY,
        transform.clamp?.max ?? Number.POSITIVE_INFINITY,
      );
  }
}

function parseCalibration(value: unknown): R399SelectedModel["calibration"] {
  if (value === undefined) return undefined;
  const calibration = requiredRecord(value, "frozen R399 posthoc calibration");
  if (calibration.mode !== undefined && calibration.mode !== "intercept_slope") {
    throw new Error("Frozen R399 posthoc calibration mode must be intercept_slope.");
  }
  return {
    intercept: requiredFiniteNumber(calibration.intercept, "frozen R399 calibration intercept"),
    slope: requiredFiniteNumber(calibration.slope, "frozen R399 calibration slope"),
  };
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${label} must be a string array.`);
  }
  return [...value];
}

function requiredNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error(`${label} must be a finite number array.`);
  }
  return [...value];
}

function numbersByFeature(
  features: readonly FrozenR399FeatureKey[],
  values: readonly number[],
  label: string,
): Record<FrozenR399FeatureKey, number> {
  const output: Partial<Record<FrozenR399FeatureKey, number>> = {};
  features.forEach((feature, index) => {
    output[feature] = requiredFiniteNumber(values[index], `${label}.${feature}`);
  });
  return completeFeatureNumberMap(output, label);
}

function numberMapByFeature(
  value: unknown,
  features: readonly FrozenR399FeatureKey[],
  label: string,
): Record<FrozenR399FeatureKey, number> {
  const record = requiredRecord(value, label);
  const output: Partial<Record<FrozenR399FeatureKey, number>> = {};
  for (const feature of features) {
    output[feature] = requiredFiniteNumber(record[feature], `${label}.${feature}`);
  }
  return completeFeatureNumberMap(output, label);
}

function positiveNumberMapByFeature(
  value: unknown,
  features: readonly FrozenR399FeatureKey[],
  label: string,
): Record<FrozenR399FeatureKey, number> {
  const numbers = numberMapByFeature(value, features, label);
  for (const [feature, numberValue] of Object.entries(numbers)) {
    if (numberValue <= 0) throw new Error(`${label}.${feature} must be positive.`);
  }
  return numbers;
}

function completeFeatureNumberMap(
  value: Partial<Record<FrozenR399FeatureKey, number>>,
  label: string,
): Record<FrozenR399FeatureKey, number> {
  for (const feature of FROZEN_R399_FEATURE_KEYS) {
    if (typeof value[feature] !== "number" || !Number.isFinite(value[feature])) {
      throw new Error(`${label}.${feature} must be finite.`);
    }
  }
  return value as Record<FrozenR399FeatureKey, number>;
}

function requiredFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
  return value;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as Error & { code?: string }).code === code;
}

function applyCalibration(
  linearScore: number,
  calibration: R399SelectedModel["calibration"] | MurphAgeRiskModel["calibration"],
): number {
  return calibration ? calibration.intercept + calibration.slope * linearScore : linearScore;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundProbability(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function main(): Promise<void> {
  const { summary } = await runR399LocalModelCardExport({
    modelCardOutputDir: process.env.MURPH_AGE_MODEL_CARD_OUTPUT_DIR,
    paramsPath: process.env.MURPH_AGE_R399_PARAMS_PATH,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown R399 local model-card export failure.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
