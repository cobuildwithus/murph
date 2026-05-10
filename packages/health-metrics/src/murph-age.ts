import { resolveMetricDefinition, resolveMetricInputKey } from "./catalog.ts";
import { normalizeUnit, unitsEquivalent } from "./normalize.ts";
import { selectMetricValue } from "./selectors.ts";
import type {
  MetricConfidence,
  MetricPoint,
  MetricSelection,
  MetricSelectionPolicy,
  MetricSelectionWarning,
} from "./types.ts";

export const MURPH_AGE_RESULT_SCHEMA_VERSION = "murph.age.result.v1" as const;

export type MurphAgeSex = "female" | "male";
export type MurphAgeStatus = "abstain" | "ready";

export type MurphAgeWarningCode =
  | "BLOCKED_MODEL_FEATURE"
  | "INVALID_INPUT"
  | "METRIC_SELECTION_WARNING"
  | "MODEL_FEATURE_MISSING"
  | "OUT_OF_REFERENCE_RANGE"
  | "TRANSFORM_UNSUPPORTED";

export interface MurphAgeWarning {
  code: MurphAgeWarningCode;
  featureKey?: string;
  message: string;
  metricKey?: string;
}

export type MurphAgeFeatureTransform =
  | { kind: "identity" }
  | { kind: "ln"; offset?: number }
  | { clamp?: { max?: number; min?: number }; kind: "z-score"; mean: number; standardDeviation: number };

export interface MurphAgeModelFeatureBase {
  coefficient: number;
  key: string;
  label: string;
  moduleId?: string;
  transform?: MurphAgeFeatureTransform;
}

export type MurphAgeModelFeature =
  | (MurphAgeModelFeatureBase & { kind: "chronological-age" })
  | (MurphAgeModelFeatureBase & { kind: "sex"; sex: MurphAgeSex })
  | (MurphAgeModelFeatureBase & {
      biomarkerKey?: string;
      expectedUnit?: string;
      kind: "metric";
      metricKey: string;
      required?: boolean;
      selectionPolicy?: MetricSelectionPolicy;
    });

export interface MurphAgeReferenceRiskPoint {
  ageYears: number;
  riskProbability: number;
}

export interface MurphAgeRiskModel {
  blockedBiomarkerKeys?: readonly string[];
  blockedMetricKeys?: readonly string[];
  calibration?: {
    intercept: number;
    slope: number;
  };
  endpoint: string;
  features: readonly MurphAgeModelFeature[];
  horizonYears: number;
  intercept: number;
  modelId: string;
  modelVersion?: string;
  referencePopulation: string;
  referenceRiskCurve: readonly MurphAgeReferenceRiskPoint[];
  uncertainty?: {
    baseYears?: number;
    perLowConfidenceMetricYears?: number;
    perMissingOptionalFeatureYears?: number;
  };
}

export interface MurphAgeCalculationInput {
  asOf?: string;
  chronologicalAgeYears: number;
  model: MurphAgeRiskModel;
  points: readonly MetricPoint[];
  sex: MurphAgeSex;
}

export interface MurphAgeRiskEstimate {
  endpoint: string;
  horizonYears: number;
  probability: number;
  referencePopulation: string;
}

export interface MurphAgeFeatureAttribution {
  contributionLogit: number | null;
  contributionYears: number | null;
  featureKey: string;
  label: string;
  metricKey: string | null;
  moduleId: string;
  selectedPointIds: string[];
  status: "blocked" | "missing" | "ready";
  unit: string | null;
  value: number | null;
  valueLabel: string | null;
  warnings: MurphAgeWarning[];
}

export interface MurphAgeModuleAttribution {
  contributionLogit: number;
  contributionYears: number | null;
  featureKeys: string[];
  moduleId: string;
}

export interface MurphAgeResult {
  ageDeltaYears: number | null;
  biologicalAgeYears: number | null;
  chronologicalAgeYears: number;
  featureAttributions: MurphAgeFeatureAttribution[];
  intervalYears: { high: number; low: number } | null;
  modelId: string;
  modelVersion: string | null;
  moduleAttributions: MurphAgeModuleAttribution[];
  risk: MurphAgeRiskEstimate | null;
  schemaVersion: typeof MURPH_AGE_RESULT_SCHEMA_VERSION;
  status: MurphAgeStatus;
  warnings: MurphAgeWarning[];
}

export interface MurphAgeModelValidationResult {
  status: "invalid" | "valid";
  warnings: MurphAgeWarning[];
}

interface EvaluatedFeature {
  attribution: MurphAgeFeatureAttribution;
  confidence: MetricConfidence | null;
  contributionLogit: number;
  required: boolean;
}

const DEFAULT_BLOCKED_METRIC_KEYS = ["hs-crp"] as const;
const DEFAULT_BLOCKED_BIOMARKER_KEYS = [
  "biomarker:c-reactive-protein",
  "biomarker:crp",
  "biomarker:high-sensitivity-crp",
  "biomarker:hs-crp",
] as const;

export function calculateMurphAge(input: MurphAgeCalculationInput): MurphAgeResult {
  const warnings: MurphAgeWarning[] = [];

  if (!Number.isFinite(input.chronologicalAgeYears) || input.chronologicalAgeYears <= 0) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Chronological age must be a positive finite number of years.",
    });
  }

  warnings.push(...validateMurphAgeRiskModel(input.model).warnings);

  if (warnings.some((warning) => warning.code === "INVALID_INPUT")) {
    return emptyMurphAgeResult({
      chronologicalAgeYears: input.chronologicalAgeYears,
      featureAttributions: [],
      model: input.model,
      status: "abstain",
      warnings,
    });
  }

  const blockedIdentifiers = normalizedBlockedIdentifiers(input.model);
  const evaluatedFeatures = input.model.features.map((feature) =>
    evaluateFeature({ blockedIdentifiers, feature, input })
  );
  const featureAttributions = evaluatedFeatures.map((feature) => feature.attribution);

  for (const attribution of featureAttributions) {
    warnings.push(...attribution.warnings);
  }

  const requiredFeatureMissing = evaluatedFeatures.some((feature) =>
    feature.required && feature.attribution.status === "missing"
  );
  const blockedFeatureSeen = featureAttributions.some((feature) => feature.status === "blocked");

  if (warnings.some((warning) => warning.code === "INVALID_INPUT") || requiredFeatureMissing || blockedFeatureSeen) {
    return emptyMurphAgeResult({
      chronologicalAgeYears: input.chronologicalAgeYears,
      featureAttributions,
      model: input.model,
      status: "abstain",
      warnings,
    });
  }

  const readyFeatures = evaluatedFeatures.filter((feature) => feature.attribution.status === "ready");
  const linearScore = input.model.intercept + readyFeatures.reduce((sum, feature) => sum + feature.contributionLogit, 0);
  const calibratedLogit = applyCalibration(linearScore, input.model.calibration);
  const riskProbability = logistic(calibratedLogit);
  const ageMapping = mapRiskToReferenceAge(riskProbability, input.model.referenceRiskCurve);
  warnings.push(...ageMapping.warnings);

  const biologicalAgeYears = roundYears(ageMapping.ageYears);
  const intervalYears = buildAgeInterval({
    ageYears: biologicalAgeYears,
    lowConfidenceMetricCount: readyFeatures.filter((feature) => feature.confidence === "low").length,
    missingOptionalFeatureCount: evaluatedFeatures.filter((feature) =>
      !feature.required && feature.attribution.status === "missing"
    ).length,
    model: input.model,
  });

  return {
    ageDeltaYears: roundYears(biologicalAgeYears - input.chronologicalAgeYears),
    biologicalAgeYears,
    chronologicalAgeYears: input.chronologicalAgeYears,
    featureAttributions: withContributionYears({
      ageYears: biologicalAgeYears,
      calibratedLogit,
      features: evaluatedFeatures,
      model: input.model,
    }),
    intervalYears,
    modelId: input.model.modelId,
    modelVersion: input.model.modelVersion ?? null,
    moduleAttributions: buildModuleAttributions({
      ageYears: biologicalAgeYears,
      calibratedLogit,
      features: readyFeatures,
      model: input.model,
    }),
    risk: {
      endpoint: input.model.endpoint,
      horizonYears: input.model.horizonYears,
      probability: roundProbability(riskProbability),
      referencePopulation: input.model.referencePopulation,
    },
    schemaVersion: MURPH_AGE_RESULT_SCHEMA_VERSION,
    status: "ready",
    warnings,
  };
}

export function mapRiskToReferenceAge(
  riskProbability: number,
  referenceRiskCurve: readonly MurphAgeReferenceRiskPoint[],
): { ageYears: number; warnings: MurphAgeWarning[] } {
  if (!Number.isFinite(riskProbability) || riskProbability < 0 || riskProbability > 1) {
    throw new TypeError("Risk probability must be between 0 and 1.");
  }

  const curve = validateReferenceRiskCurve(referenceRiskCurve);
  const warnings: MurphAgeWarning[] = [];
  const first = curve[0];
  const last = curve[curve.length - 1];

  if (!first || !last) {
    throw new TypeError("Reference risk curve must include at least two points.");
  }

  if (riskProbability < first.riskProbability) {
    warnings.push({
      code: "OUT_OF_REFERENCE_RANGE",
      message: "Risk is below the reference curve; age was clamped to the lowest reference age.",
    });
    return { ageYears: first.ageYears, warnings };
  }

  if (riskProbability > last.riskProbability) {
    warnings.push({
      code: "OUT_OF_REFERENCE_RANGE",
      message: "Risk is above the reference curve; age was clamped to the highest reference age.",
    });
    return { ageYears: last.ageYears, warnings };
  }

  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1];
    const current = curve[index];
    if (!previous || !current) continue;
    if (riskProbability <= current.riskProbability) {
      const riskSpan = current.riskProbability - previous.riskProbability;
      const ageSpan = current.ageYears - previous.ageYears;
      const fraction = riskSpan === 0 ? 0 : (riskProbability - previous.riskProbability) / riskSpan;
      return { ageYears: previous.ageYears + fraction * ageSpan, warnings };
    }
  }

  return { ageYears: last.ageYears, warnings };
}

function evaluateFeature(input: {
  blockedIdentifiers: BlockedIdentifiers;
  feature: MurphAgeModelFeature;
  input: MurphAgeCalculationInput;
}): EvaluatedFeature {
  const moduleId = input.feature.moduleId ?? "demographics";
  const required = input.feature.kind === "metric" ? input.feature.required !== false : true;
  const baseAttribution = {
    contributionLogit: null,
    contributionYears: null,
    featureKey: input.feature.key,
    label: input.feature.label,
    moduleId,
    selectedPointIds: [],
    unit: null,
    value: null,
    valueLabel: null,
    warnings: [] as MurphAgeWarning[],
  };

  switch (input.feature.kind) {
    case "chronological-age":
      return evaluateRawFeature({
        attribution: {
          ...baseAttribution,
          metricKey: null,
          value: input.input.chronologicalAgeYears,
          valueLabel: input.input.chronologicalAgeYears.toFixed(1),
        },
        feature: input.feature,
        moduleId,
        rawValue: input.input.chronologicalAgeYears,
        required,
      });
    case "sex": {
      const sexValue = input.input.sex === input.feature.sex ? 1 : 0;
      return evaluateRawFeature({
        attribution: {
          ...baseAttribution,
          metricKey: null,
          value: sexValue,
          valueLabel: input.input.sex,
        },
        feature: input.feature,
        moduleId,
        rawValue: sexValue,
        required,
      });
    }
    case "metric": {
      const metricKey = resolveMetricInputKey(input.feature.metricKey);
      const metricDefinition = resolveMetricDefinition(metricKey);
      const expectedUnit = input.feature.expectedUnit ?? metricDefinition?.canonicalUnit ?? null;
      if (isBlockedMetricFeature({
        biomarkerKey: input.feature.biomarkerKey ?? null,
        blockedIdentifiers: input.blockedIdentifiers,
        metricKey,
      })) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "blocked",
            warnings: [{
              code: "BLOCKED_MODEL_FEATURE",
              featureKey: input.feature.key,
              message: `${input.feature.label} is blocked for Murph Age calculator models until separately validated.`,
              metricKey,
            }],
          },
          confidence: null,
          contributionLogit: 0,
          required,
        };
      }

      if (!metricDefinition && !expectedUnit) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "missing",
            warnings: [{
              code: "MODEL_FEATURE_MISSING",
              featureKey: input.feature.key,
              message: `${input.feature.label} is not a registered metric and did not declare an expected unit.`,
              metricKey,
            }],
          },
          confidence: null,
          contributionLogit: 0,
          required,
        };
      }

      const selection = selectMetricValue({
        biomarkerKey: input.feature.biomarkerKey,
        metricKey,
        now: input.input.asOf,
        points: input.input.points,
        policyOverride: input.feature.selectionPolicy,
      });
      const selectionWarnings = mapMetricSelectionWarnings(input.feature, selection);
      if (isBlockedMetricFeature({
        biomarkerKey: selection.biomarkerKey,
        blockedIdentifiers: input.blockedIdentifiers,
        metricKey: selection.metricKey,
      })) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "blocked",
            warnings: [{
              code: "BLOCKED_MODEL_FEATURE",
              featureKey: input.feature.key,
              message: `${input.feature.label} selected a blocked biomarker for Murph Age calculator models.`,
              metricKey: selection.metricKey,
            }],
          },
          confidence: selection.confidence,
          contributionLogit: 0,
          required,
        };
      }

      if (selection.warnings.some((warning) => warning.code === "UNIT_NOT_NORMALIZED")) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "missing",
            unit: selection.unit,
            warnings: [{
              code: "MODEL_FEATURE_MISSING",
              featureKey: input.feature.key,
              message: `${input.feature.label} could not be scored because its unit was not normalized for this model.`,
              metricKey,
            }, ...selectionWarnings],
          },
          confidence: selection.confidence,
          contributionLogit: 0,
          required,
        };
      }

      const value = selection.value;
      if (selection.status !== "ready" || value === null || !Number.isFinite(value)) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "missing",
            unit: selection.unit,
            warnings: [{
              code: "MODEL_FEATURE_MISSING",
              featureKey: input.feature.key,
              message: required
                ? `${input.feature.label} is required by this model but was not available as a ready normalized metric.`
                : `${input.feature.label} is optional in this model and was not available as a ready normalized metric.`,
              metricKey,
            }, ...selectionWarnings],
          },
          confidence: selection.confidence,
          contributionLogit: 0,
          required,
        };
      }

      if (selection.warnings.some((warning) => warning.code === "COMPARATOR_VALUE")) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "missing",
            unit: selection.unit,
            warnings: [{
              code: "MODEL_FEATURE_MISSING",
              featureKey: input.feature.key,
              message: `${input.feature.label} could not be scored because its selected value is censored by a comparator.`,
              metricKey,
            }, ...selectionWarnings],
          },
          confidence: selection.confidence,
          contributionLogit: 0,
          required,
        };
      }

      if (expectedUnit && !unitsEquivalent(selection.unit, expectedUnit)) {
        return {
          attribution: {
            ...baseAttribution,
            metricKey,
            status: "missing",
            unit: selection.unit,
            warnings: [{
              code: "MODEL_FEATURE_MISSING",
              featureKey: input.feature.key,
              message: `${input.feature.label} could not be scored because its selected unit was not ${normalizeUnit(expectedUnit) ?? expectedUnit}.`,
              metricKey,
            }, ...selectionWarnings],
          },
          confidence: selection.confidence,
          contributionLogit: 0,
          required,
        };
      }

      return evaluateRawFeature({
        attribution: {
          ...baseAttribution,
          metricKey,
          selectedPointIds: selection.provenance.pointIds,
          unit: selection.unit,
          value,
          valueLabel: selection.valueLabel,
          warnings: selectionWarnings,
        },
        confidence: selection.confidence,
        feature: input.feature,
        moduleId,
        rawValue: value,
        required,
      });
    }
  }
}

function evaluateRawFeature(input: {
  attribution: Omit<MurphAgeFeatureAttribution, "status">;
  confidence?: MetricConfidence | null;
  feature: MurphAgeModelFeature;
  moduleId: string;
  rawValue: number;
  required: boolean;
}): EvaluatedFeature {
  const transformed = transformFeatureValue(input.rawValue, input.feature.transform ?? { kind: "identity" });
  if (transformed.warning) {
    return {
      attribution: {
        ...input.attribution,
        contributionLogit: null,
        status: "missing",
        warnings: [...input.attribution.warnings, {
          code: "TRANSFORM_UNSUPPORTED",
          featureKey: input.feature.key,
          message: transformed.warning,
          metricKey: input.attribution.metricKey ?? undefined,
        }],
      },
      confidence: input.confidence ?? null,
      contributionLogit: 0,
      required: input.required,
    };
  }

  const contributionLogit = input.feature.coefficient * transformed.value;
  return {
    attribution: {
      ...input.attribution,
      contributionLogit: roundContribution(contributionLogit),
      status: "ready",
    },
    confidence: input.confidence ?? null,
    contributionLogit,
    required: input.required,
  };
}

function transformFeatureValue(
  value: number,
  transform: MurphAgeFeatureTransform,
): { value: number; warning: string | null } {
  switch (transform.kind) {
    case "identity":
      return { value, warning: null };
    case "ln": {
      const adjusted = value + (transform.offset ?? 0);
      return adjusted > 0
        ? { value: Math.log(adjusted), warning: null }
        : { value: 0, warning: "Log transform requires a positive value after offset." };
    }
    case "z-score": {
      if (!Number.isFinite(transform.standardDeviation) || transform.standardDeviation <= 0) {
        return { value: 0, warning: "Z-score transform requires a positive standard deviation." };
      }
      const unclamped = (value - transform.mean) / transform.standardDeviation;
      const min = transform.clamp?.min ?? Number.NEGATIVE_INFINITY;
      const max = transform.clamp?.max ?? Number.POSITIVE_INFINITY;
      return { value: Math.min(max, Math.max(min, unclamped)), warning: null };
    }
  }
}

function withContributionYears(input: {
  ageYears: number;
  calibratedLogit: number;
  features: readonly EvaluatedFeature[];
  model: MurphAgeRiskModel;
}): MurphAgeFeatureAttribution[] {
  return input.features.map((feature) => {
    if (feature.attribution.status !== "ready") {
      return feature.attribution;
    }
    const omittedLogit = input.calibratedLogit - calibratedContribution(feature.contributionLogit, input.model.calibration);
    const omittedAge = mapRiskToReferenceAge(logistic(omittedLogit), input.model.referenceRiskCurve).ageYears;
    return {
      ...feature.attribution,
      contributionYears: roundYears(input.ageYears - omittedAge),
    };
  });
}

function buildModuleAttributions(input: {
  ageYears: number;
  calibratedLogit: number;
  features: readonly EvaluatedFeature[];
  model: MurphAgeRiskModel;
}): MurphAgeModuleAttribution[] {
  const modules = new Map<string, { contributionLogit: number; featureKeys: string[] }>();

  for (const feature of input.features) {
    const moduleId = feature.attribution.moduleId;
    const current = modules.get(moduleId) ?? { contributionLogit: 0, featureKeys: [] };
    current.contributionLogit += feature.contributionLogit;
    current.featureKeys.push(feature.attribution.featureKey);
    modules.set(moduleId, current);
  }

  return [...modules.entries()].map(([moduleId, module]) => {
    const omittedLogit = input.calibratedLogit - calibratedContribution(module.contributionLogit, input.model.calibration);
    const omittedAge = mapRiskToReferenceAge(logistic(omittedLogit), input.model.referenceRiskCurve).ageYears;
    return {
      contributionLogit: roundContribution(module.contributionLogit),
      contributionYears: roundYears(input.ageYears - omittedAge),
      featureKeys: module.featureKeys,
      moduleId,
    };
  });
}

function buildAgeInterval(input: {
  ageYears: number;
  lowConfidenceMetricCount: number;
  missingOptionalFeatureCount: number;
  model: MurphAgeRiskModel;
}): { high: number; low: number } | null {
  const uncertainty = input.model.uncertainty;
  if (!uncertainty) return null;
  const width = (uncertainty.baseYears ?? 0)
    + (uncertainty.perMissingOptionalFeatureYears ?? 0) * input.missingOptionalFeatureCount
    + (uncertainty.perLowConfidenceMetricYears ?? 0) * input.lowConfidenceMetricCount;
  if (!Number.isFinite(width) || width <= 0) return null;
  return {
    high: roundYears(input.ageYears + width),
    low: roundYears(input.ageYears - width),
  };
}

function emptyMurphAgeResult(input: {
  chronologicalAgeYears: number;
  featureAttributions: MurphAgeFeatureAttribution[];
  model: MurphAgeRiskModel;
  status: MurphAgeStatus;
  warnings: MurphAgeWarning[];
}): MurphAgeResult {
  return {
    ageDeltaYears: null,
    biologicalAgeYears: null,
    chronologicalAgeYears: input.chronologicalAgeYears,
    featureAttributions: input.featureAttributions,
    intervalYears: null,
    modelId: input.model.modelId,
    modelVersion: input.model.modelVersion ?? null,
    moduleAttributions: [],
    risk: null,
    schemaVersion: MURPH_AGE_RESULT_SCHEMA_VERSION,
    status: input.status,
    warnings: input.warnings,
  };
}

export function validateMurphAgeRiskModel(model: MurphAgeRiskModel): MurphAgeModelValidationResult {
  const warnings: MurphAgeWarning[] = [];

  if (!Number.isFinite(model.intercept)) {
    warnings.push(invalidModelWarning("Murph Age model intercept must be finite."));
  }
  if (!Number.isFinite(model.horizonYears) || model.horizonYears <= 0) {
    warnings.push(invalidModelWarning("Murph Age model horizon must be a positive finite number of years."));
  }
  if (model.calibration) {
    if (!Number.isFinite(model.calibration.intercept)) {
      warnings.push(invalidModelWarning("Murph Age model calibration intercept must be finite."));
    }
    if (!Number.isFinite(model.calibration.slope)) {
      warnings.push(invalidModelWarning("Murph Age model calibration slope must be finite."));
    }
  }

  try {
    validateReferenceRiskCurve(model.referenceRiskCurve);
  } catch (error) {
    warnings.push(invalidModelWarning(error instanceof Error
      ? error.message
      : "Murph Age model reference risk curve is invalid."));
  }

  const featureKeys = new Set<string>();
  for (const feature of model.features) {
    if (featureKeys.has(feature.key)) {
      warnings.push(invalidModelWarning(`Murph Age model feature ${feature.key} is duplicated.`, feature));
    }
    featureKeys.add(feature.key);

    if (!Number.isFinite(feature.coefficient)) {
      warnings.push(invalidModelWarning(`${feature.label} coefficient must be finite.`, feature));
    }
    if (feature.kind === "metric" && feature.expectedUnit !== undefined && normalizeUnit(feature.expectedUnit) === null) {
      warnings.push(invalidModelWarning(`${feature.label} expected unit must be a non-empty string.`, feature));
    }
    warnings.push(...validateFeatureTransform(feature));
  }

  return {
    status: warnings.length > 0 ? "invalid" : "valid",
    warnings,
  };
}

function validateFeatureTransform(feature: MurphAgeModelFeature): MurphAgeWarning[] {
  const transform = feature.transform;
  if (!transform) return [];

  switch (transform.kind) {
    case "identity":
      return [];
    case "ln":
      return transform.offset === undefined || Number.isFinite(transform.offset)
        ? []
        : [invalidModelWarning(`${feature.label} log transform offset must be finite.`, feature)];
    case "z-score": {
      const warnings: MurphAgeWarning[] = [];
      if (!Number.isFinite(transform.mean)) {
        warnings.push(invalidModelWarning(`${feature.label} z-score mean must be finite.`, feature));
      }
      if (!Number.isFinite(transform.standardDeviation) || transform.standardDeviation <= 0) {
        warnings.push(invalidModelWarning(`${feature.label} z-score standard deviation must be positive and finite.`, feature));
      }
      const min = transform.clamp?.min;
      const max = transform.clamp?.max;
      if (min !== undefined && !Number.isFinite(min)) {
        warnings.push(invalidModelWarning(`${feature.label} z-score clamp minimum must be finite.`, feature));
      }
      if (max !== undefined && !Number.isFinite(max)) {
        warnings.push(invalidModelWarning(`${feature.label} z-score clamp maximum must be finite.`, feature));
      }
      if (min !== undefined && max !== undefined && min > max) {
        warnings.push(invalidModelWarning(`${feature.label} z-score clamp minimum cannot exceed maximum.`, feature));
      }
      return warnings;
    }
  }
}

function invalidModelWarning(message: string, feature?: MurphAgeModelFeature): MurphAgeWarning {
  return {
    code: "INVALID_INPUT",
    featureKey: feature?.key,
    message,
    metricKey: feature?.kind === "metric" ? resolveMetricInputKey(feature.metricKey) : undefined,
  };
}

interface BlockedIdentifiers {
  biomarkerKeys: ReadonlySet<string>;
  metricKeys: ReadonlySet<string>;
}

function normalizedBlockedIdentifiers(model: MurphAgeRiskModel): BlockedIdentifiers {
  return {
    biomarkerKeys: new Set([...DEFAULT_BLOCKED_BIOMARKER_KEYS, ...(model.blockedBiomarkerKeys ?? [])]),
    metricKeys: new Set([...DEFAULT_BLOCKED_METRIC_KEYS, ...(model.blockedMetricKeys ?? [])].map(resolveMetricInputKey)),
  };
}

function isBlockedMetricFeature(input: {
  biomarkerKey: string | null;
  blockedIdentifiers: BlockedIdentifiers;
  metricKey: string;
}): boolean {
  return input.blockedIdentifiers.metricKeys.has(input.metricKey)
    || input.blockedIdentifiers.biomarkerKeys.has(input.biomarkerKey ?? "")
    || input.metricKey.includes("crp");
}

function mapMetricSelectionWarnings(
  feature: MurphAgeModelFeature & { kind: "metric" },
  selection: MetricSelection,
): MurphAgeWarning[] {
  return selection.warnings.map((warning: MetricSelectionWarning) => ({
    code: "METRIC_SELECTION_WARNING",
    featureKey: feature.key,
    message: warning.message,
    metricKey: selection.metricKey,
  }));
}

function validateReferenceRiskCurve(
  referenceRiskCurve: readonly MurphAgeReferenceRiskPoint[],
): MurphAgeReferenceRiskPoint[] {
  const curve = [...referenceRiskCurve].sort((left, right) => left.ageYears - right.ageYears);
  if (curve.length < 2) {
    throw new TypeError("Reference risk curve must include at least two points.");
  }

  for (let index = 0; index < curve.length; index += 1) {
    const point = curve[index];
    if (!point || !Number.isFinite(point.ageYears) || !Number.isFinite(point.riskProbability)) {
      throw new TypeError("Reference risk curve points must be finite.");
    }
    if (point.riskProbability < 0 || point.riskProbability > 1) {
      throw new TypeError("Reference risk curve probabilities must be between 0 and 1.");
    }
    const previous = curve[index - 1];
    if (previous && point.riskProbability < previous.riskProbability) {
      throw new TypeError("Reference risk curve probabilities must be monotonic by age.");
    }
  }

  return curve;
}

function applyCalibration(linearScore: number, calibration: MurphAgeRiskModel["calibration"]): number {
  return calibration ? calibration.intercept + calibration.slope * linearScore : linearScore;
}

function calibratedContribution(contributionLogit: number, calibration: MurphAgeRiskModel["calibration"]): number {
  return calibration ? calibration.slope * contributionLogit : contributionLogit;
}

function logistic(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function roundContribution(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundProbability(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundYears(value: number): number {
  return Math.round(value * 10) / 10;
}
