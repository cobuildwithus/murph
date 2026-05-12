import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import {
  calculateMurphAge,
  METRIC_POINT_SCHEMA_VERSION,
  parseMurphAgeLocalModelCardArtifact,
  validateMurphAgeRiskModel,
  type MetricPoint,
  type MurphAgeIncrementEvaluationCard,
  type MurphAgeRiskModel,
  type MurphAgeSex,
} from "@murphai/health-metrics";

import { calculateAuc, findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R399_LOCAL_MODEL_CARD_FILENAME,
  R399_RESEARCH_CARD_ID,
} from "./r399-local-model-card.ts";

export const R399_MIDUS2_BIOMARKER_INCREMENT_SCHEMA_VERSION =
  "murph-age-r399-midus2-biomarker-increment.v1" as const;
export const R399_MIDUS_REFRESHER_BIOMARKER_INCREMENT_SCHEMA_VERSION =
  "murph-age-r399-midus-refresher-biomarker-increment.v1" as const;
const INCREMENT_EVALUATION_CARD_SCHEMA_VERSION = "murph.age.increment-evaluation-card.v1" as const;

const MIDUS2_SURVEY_ZIP = "ICPSR_04652-V8.zip";
const MIDUS2_BIOMARKER_ZIP = "ICPSR_29282-V11.zip";
const MIDUS2_MORTALITY_ZIP = "ICPSR_37237-V6.zip";
const MIDUS_REFRESHER_SURVEY_ZIP = "ICPSR_36532-V4.zip";
const MIDUS_REFRESHER_BIOMARKER_ZIP = "ICPSR_36901-V6.zip";
const MIDUS_REFRESHER_MORTALITY_ZIP = "ICPSR_38024-V3.zip";

const MIDUS2_SURVEY_ENTRY = "ICPSR_04652/DS0001/04652-0001-Data.tsv";
const MIDUS2_BIOMARKER_ENTRY = "ICPSR_29282/DS0001/29282-0001-Data.tsv";
const MIDUS2_MORTALITY_ENTRY = "ICPSR_37237/DS0001/37237-0001-Data.tsv";
const MIDUS_REFRESHER_SURVEY_ENTRY = "ICPSR_36532/DS0001/36532-0001-Data.tsv";
const MIDUS_REFRESHER_BIOMARKER_ENTRY = "ICPSR_36901/DS0001/36901-0001-Data.tsv";
const MIDUS_REFRESHER_MORTALITY_ENTRY = "ICPSR_38024/DS0001/38024-0001-Data.tsv";

const DEFAULT_OUTPUT_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R399_MODEL_CARD_PATH = path.join(
  ".runtime",
  "operations",
  "murph-age",
  "model-cards",
  R399_LOCAL_MODEL_CARD_FILENAME,
);
const OUTPUT_FILE_NAME = "r399-midus2-biomarker-increment.latest.json";

const R399_PROXY_FEATURE_KEYS = [
  "bmi",
  "self-rated-health",
  "hypertension-history-proxy-yes",
  "diabetes-history-proxy-yes",
  "smoking-status-proxy",
  "physical-activity-proxy",
] as const;

const BIOMARKER_FEATURE_DEFINITIONS = [
  { columnKey: "hba1cColumn", key: "hba1c", transform: (value: number) => value },
  { columnKey: "triglyceridesColumn", key: "log-triglycerides", transform: (value: number) => value > 0 ? Math.log(value) : null },
  { columnKey: "hdlColumn", key: "hdl-c", transform: (value: number) => value },
] as const;

const MODEL_CANDIDATE_DEFINITIONS = {
  age_sex_reference: {
    candidateRole: "reference",
    featureKeys: ["age", "female"],
    hypothesis: "Age and sex reference model on the same cohort denominator.",
    hypothesisSource: "literature or mechanistic rationale",
  },
  r399_anchor_recalibrated: {
    candidateRole: "base_anchor",
    featureKeys: ["r399-logit"],
    hypothesis: "Frozen R399 transported to MIDUS with train-only intercept/slope recalibration.",
    hypothesisSource: "external-source feasibility need",
  },
  r399_plus_bmi_increment: {
    candidateRole: "proposal",
    featureKeys: ["r399-logit", "bmi"],
    hypothesis: "Body-size residual signal may improve transport over the frozen R399 proxy anchor without introducing lab dependencies.",
    hypothesisSource: "train/calibration diagnostic",
  },
  r399_plus_lab3_increment: {
    candidateRole: "proposal",
    featureKeys: ["r399-logit", "hba1c", "log-triglycerides", "hdl-c"],
    hypothesis: "Compact MIDUS glycemia/lipid biomarkers may add stable residual signal over the R399 proxy anchor.",
    hypothesisSource: "train/calibration diagnostic",
  },
  r399_plus_lab3_bmi_increment: {
    candidateRole: "proposal",
    featureKeys: ["r399-logit", "bmi", "hba1c", "log-triglycerides", "hdl-c"],
    hypothesis: "Re-estimating BMI alongside MIDUS biomarkers checks whether body-size transport changes the R399 residual increment.",
    hypothesisSource: "robustness stress test",
  },
  lab3_age_sex_reference: {
    candidateRole: "reference",
    featureKeys: ["age", "female", "bmi", "hba1c", "log-triglycerides", "hdl-c"],
    hypothesis: "Non-layered compact lab reference for judging whether R399 should remain the spine.",
    hypothesisSource: "robustness stress test",
  },
} as const;

const LAMBDAS = [0, 0.0001, 0.001, 0.01, 0.1, 1] as const;

export type R399MidusCohortId = "midus-refresher" | "midus2";
type R399MidusSchemaVersion =
  | typeof R399_MIDUS2_BIOMARKER_INCREMENT_SCHEMA_VERSION
  | typeof R399_MIDUS_REFRESHER_BIOMARKER_INCREMENT_SCHEMA_VERSION;

interface R399MidusCohortConfig {
  batchId: string;
  benchmarkId: string;
  biomarker: {
    ageColumn: string;
    bmiColumn: string;
    hba1cColumn: string;
    hdlColumn: string;
    idColumn: string;
    sexColumn: string;
    triglyceridesColumn: string;
  };
  biomarkerEntry: string;
  biomarkerZip: string;
  candidateId: string;
  cohortId: R399MidusCohortId;
  endpoint: string;
  label: string;
  metricPointRecordId: string;
  metricPointSourceLabel: string;
  metricPointSourcePath: string;
  outputFileName: string;
  schemaVersion: R399MidusSchemaVersion;
  splitSalt: string;
  survey: {
    baselineYearColumn: string;
    diabetesColumn: string;
    hypertensionColumn: string;
    idColumn: string;
    moderateActivityColumns: readonly string[];
    selfRatedHealthColumn: string;
    smokingEverColumn: string;
    smokingNowColumn: string;
    vigorousActivityColumns: readonly string[];
  };
  surveyEntry: string;
  surveyZip: string;
  mortality: {
    deathYearColumn: string;
    idColumn: string;
  };
  mortalityEntry: string;
  mortalityZip: string;
}

const R399_MIDUS_COHORT_CONFIGS = {
  midus2: {
    batchId: "r399-midus2-first-biomarker-increment-batch",
    benchmarkId: "r399-midus2-biomarker-increment-local-0",
    biomarker: {
      ageColumn: "B4ZAGE",
      bmiColumn: "B4PBMI",
      hba1cColumn: "B4BHA1C",
      hdlColumn: "B4BHDL",
      idColumn: "M2ID",
      sexColumn: "B1PRSEX",
      triglyceridesColumn: "B4BTRIGL",
    },
    biomarkerEntry: MIDUS2_BIOMARKER_ENTRY,
    biomarkerZip: MIDUS2_BIOMARKER_ZIP,
    candidateId: "r399-plus-lab3-bmi-increment",
    cohortId: "midus2",
    endpoint: "10-year all-cause mortality, MIDUS 2 complete-window baseline years",
    label: "MIDUS 2",
    metricPointRecordId: "midus2-local-research-row",
    metricPointSourceLabel: "MIDUS 2 local research adapter",
    metricPointSourcePath: "local://midus2-r399-adapter",
    mortality: {
      deathYearColumn: "DOD_Y",
      idColumn: "M2ID",
    },
    mortalityEntry: MIDUS2_MORTALITY_ENTRY,
    mortalityZip: MIDUS2_MORTALITY_ZIP,
    outputFileName: OUTPUT_FILE_NAME,
    schemaVersion: R399_MIDUS2_BIOMARKER_INCREMENT_SCHEMA_VERSION,
    splitSalt: "r399-midus2-increment-v0",
    survey: {
      baselineYearColumn: "B1PIDATE_YR",
      diabetesColumn: "B1SA11X",
      hypertensionColumn: "B1PA24",
      idColumn: "M2ID",
      moderateActivityColumns: ["B1SA31A", "B1SA31B", "B1SA31C", "B1SA31D", "B1SA31E", "B1SA31F"],
      selfRatedHealthColumn: "B1PA1",
      smokingEverColumn: "B1PA38A",
      smokingNowColumn: "B1PA39",
      vigorousActivityColumns: ["B1SA30A", "B1SA30B", "B1SA30C", "B1SA30D", "B1SA30E", "B1SA30F"],
    },
    surveyEntry: MIDUS2_SURVEY_ENTRY,
    surveyZip: MIDUS2_SURVEY_ZIP,
  },
  "midus-refresher": {
    batchId: "r399-midus-refresher-biomarker-increment-batch",
    benchmarkId: "r399-midus-refresher-biomarker-increment-local-0",
    biomarker: {
      ageColumn: "RA4ZAGE",
      bmiColumn: "RA4PBMI",
      hba1cColumn: "RA4BHA1C",
      hdlColumn: "RA4BHDL",
      idColumn: "MRID",
      sexColumn: "RA1PRSEX",
      triglyceridesColumn: "RA4BTRIGL",
    },
    biomarkerEntry: MIDUS_REFRESHER_BIOMARKER_ENTRY,
    biomarkerZip: MIDUS_REFRESHER_BIOMARKER_ZIP,
    candidateId: "r399-plus-refresher-lab3-bmi-increment",
    cohortId: "midus-refresher",
    endpoint: "10-year all-cause mortality, MIDUS Refresher complete-window baseline years",
    label: "MIDUS Refresher",
    metricPointRecordId: "midus-refresher-local-research-row",
    metricPointSourceLabel: "MIDUS Refresher local research adapter",
    metricPointSourcePath: "local://midus-refresher-r399-adapter",
    mortality: {
      deathYearColumn: "DOD_Y",
      idColumn: "MRID",
    },
    mortalityEntry: MIDUS_REFRESHER_MORTALITY_ENTRY,
    mortalityZip: MIDUS_REFRESHER_MORTALITY_ZIP,
    outputFileName: "r399-midus-refresher-biomarker-increment.latest.json",
    schemaVersion: R399_MIDUS_REFRESHER_BIOMARKER_INCREMENT_SCHEMA_VERSION,
    splitSalt: "r399-midus-refresher-increment-v0",
    survey: {
      baselineYearColumn: "RA1PIDATE_YR",
      diabetesColumn: "RA1SA11X",
      hypertensionColumn: "RA1PA24",
      idColumn: "MRID",
      moderateActivityColumns: ["RA1SA31"],
      selfRatedHealthColumn: "RA1PA1",
      smokingEverColumn: "RA1PA38A",
      smokingNowColumn: "RA1PA39",
      vigorousActivityColumns: ["RA1SA30A", "RA1SA30B", "RA1SA30C", "RA1SA30D", "RA1SA30E", "RA1SA30F"],
    },
    surveyEntry: MIDUS_REFRESHER_SURVEY_ENTRY,
    surveyZip: MIDUS_REFRESHER_SURVEY_ZIP,
  },
} satisfies Record<R399MidusCohortId, R399MidusCohortConfig>;

export interface R399Midus2BiomarkerIncrementOptions {
  cohortId?: R399MidusCohortId;
  createdAt?: string;
  downloadsDir?: string;
  outputDir?: string;
  r399ModelCardPath?: string;
}

export interface R399Midus2AggregateMetricSummary {
  auc: number | null;
  brier: number;
  events: number;
  logLoss: number;
  meanPrediction: number;
  n: number;
  observedRate: number;
}

export interface R399Midus2BiomarkerIncrementOutput {
  anchor: {
    cardId: typeof R399_RESEARCH_CARD_ID;
    coefficientsStored: false;
    featureCount: number;
    localArtifactPathStored: false;
    modelId: string;
    modelParametersStored: false;
    predictionsStored: false;
  };
  benchmarkId: string;
  candidateBatch: {
    batchId: string;
    candidateCount: number;
    exposureLabel: "diagnostic-only";
    hypothesisSources: Array<ModelCandidateDefinition["hypothesisSource"]>;
    promotionAuthorized: false;
    testSelectionAuthorized: false;
  };
  codebookTextStored: false;
  coefficientsStored: false;
  createdAt: string;
  dataShape: {
    eligibleRows: number;
    events: number;
    r399ProxyFeatureObservedCounts: Record<typeof R399_PROXY_FEATURE_KEYS[number], number>;
    splitCounts: Record<"calibration" | "test" | "train", { events: number; n: number }>;
  };
  endpoint: string;
  incrementEvaluationCard: MurphAgeIncrementEvaluationCard;
  modelScoringPerformed: true;
  models: Record<string, {
    anchorCardId: typeof R399_RESEARCH_CARD_ID | null;
    candidateRole: "base_anchor" | "proposal" | "reference";
    coefficientsStored: false;
    featureKeys: string[];
    featureObservedCounts: Record<string, number>;
    hypothesis: string;
    hypothesisSource: ModelCandidateDefinition["hypothesisSource"];
    predictionsStored: false;
    selectedLambda: number;
    splitMetrics: Record<"calibration" | "test" | "train", R399Midus2AggregateMetricSummary>;
  }>;
  participantIdentifiersStored: false;
  participantIdentifiersWritten: false;
  predictionsStored: false;
  rowValuesStored: false;
  schemaVersion: R399MidusSchemaVersion;
  sourceBodiesStored: false;
  splitMembershipStored: false;
  status: "research-local-aggregate-only";
}

type ModelCandidateDefinition = typeof MODEL_CANDIDATE_DEFINITIONS[keyof typeof MODEL_CANDIDATE_DEFINITIONS];
type TsvRow = Record<string, string>;
type Split = "calibration" | "test" | "train";

interface ParsedRow {
  r399Risk: number;
  split: Split;
  values: Record<string, number | null>;
  y: 0 | 1;
}

interface TrainedModel {
  featureKeys: string[];
  lambda: number;
  predict(row: ParsedRow): number;
  stats: Record<string, { mean: number; median: number; observedCount: number; sd: number }>;
}

export async function runR399Midus2BiomarkerIncrement(
  options: R399Midus2BiomarkerIncrementOptions = {},
): Promise<{ output: R399Midus2BiomarkerIncrementOutput; outputPath: string }> {
  return runR399MidusBiomarkerIncrement({ ...options, cohortId: "midus2" });
}

export async function runR399MidusRefresherBiomarkerIncrement(
  options: Omit<R399Midus2BiomarkerIncrementOptions, "cohortId"> = {},
): Promise<{ output: R399Midus2BiomarkerIncrementOutput; outputPath: string }> {
  return runR399MidusBiomarkerIncrement({ ...options, cohortId: "midus-refresher" });
}

export async function runR399MidusBiomarkerIncrement(
  options: R399Midus2BiomarkerIncrementOptions = {},
): Promise<{ output: R399Midus2BiomarkerIncrementOutput; outputPath: string }> {
  const config = R399_MIDUS_COHORT_CONFIGS[options.cohortId ?? "midus2"];
  const downloadsDir = options.downloadsDir ?? path.join(os.homedir(), "Downloads");
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const r399Model = await readR399ModelCard(options.r399ModelCardPath ?? DEFAULT_R399_MODEL_CARD_PATH);
  const rows = await buildBenchmarkRows({ config, downloadsDir, r399Model });
  const dataShape: R399Midus2BiomarkerIncrementOutput["dataShape"] = {
    eligibleRows: rows.length,
    events: rows.reduce((sum, row) => sum + row.y, 0),
    r399ProxyFeatureObservedCounts: r399ProxyFeatureObservedCounts(rows),
    splitCounts: splitCounts(rows),
  };

  const models = Object.fromEntries(
    Object.entries(MODEL_CANDIDATE_DEFINITIONS).map(([modelId, candidate]) => {
      const trained = selectModel(rows, [...candidate.featureKeys]);
      return [modelId, summarizeModel(rows, trained, candidate)];
    }),
  ) as R399Midus2BiomarkerIncrementOutput["models"];
  const incrementEvaluationCard = buildIncrementEvaluationCard({ config, dataShape, models });
  assertIncrementEvaluationCardBoundary({ card: incrementEvaluationCard, config });

  const output: R399Midus2BiomarkerIncrementOutput = {
    anchor: {
      cardId: R399_RESEARCH_CARD_ID,
      coefficientsStored: false,
      featureCount: r399Model.features.length,
      localArtifactPathStored: false,
      modelId: r399Model.modelId,
      modelParametersStored: false,
      predictionsStored: false,
    },
    benchmarkId: config.benchmarkId,
    candidateBatch: {
      batchId: config.batchId,
      candidateCount: Object.keys(MODEL_CANDIDATE_DEFINITIONS).length,
      exposureLabel: "diagnostic-only",
      hypothesisSources: Array.from(new Set(
        Object.values(MODEL_CANDIDATE_DEFINITIONS).map((candidate) => candidate.hypothesisSource),
      )),
      promotionAuthorized: false,
      testSelectionAuthorized: false,
    },
    codebookTextStored: false,
    coefficientsStored: false,
    createdAt: options.createdAt ?? new Date().toISOString(),
    dataShape,
    endpoint: config.endpoint,
    incrementEvaluationCard,
    modelScoringPerformed: true,
    models,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    rowValuesStored: false,
    schemaVersion: config.schemaVersion,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
  };

  const forbiddenFindings = findForbiddenAggregateEgress(output);
  if (forbiddenFindings.length > 0) {
    throw new Error(`R399 ${config.label} biomarker increment output failed egress validation: ${forbiddenFindings.join("; ")}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, config.outputFileName);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readR399ModelCard(modelCardPath: string): Promise<MurphAgeRiskModel> {
  const artifact = JSON.parse(await readFile(modelCardPath, "utf8")) as unknown;
  const parsed = parseMurphAgeLocalModelCardArtifact(artifact);
  if (!parsed.value || parsed.warnings.length > 0) {
    throw new Error("R399 local model-card artifact failed schema validation.");
  }
  if (parsed.value.cardId !== R399_RESEARCH_CARD_ID) {
    throw new Error(`Expected R399 local model-card artifact ${R399_RESEARCH_CARD_ID}.`);
  }
  const validation = validateMurphAgeRiskModel(parsed.value.model);
  if (validation.status !== "valid") {
    throw new Error("R399 local model-card model failed validation.");
  }
  return parsed.value.model;
}

async function buildBenchmarkRows(input: {
  config: R399MidusCohortConfig;
  downloadsDir: string;
  r399Model: MurphAgeRiskModel;
}): Promise<ParsedRow[]> {
  const config = input.config;
  const surveyRows = await readZippedTsvColumns(
    path.join(input.downloadsDir, config.surveyZip),
    config.surveyEntry,
    uniqueColumns([
      config.survey.idColumn,
      config.survey.baselineYearColumn,
      config.survey.selfRatedHealthColumn,
      config.survey.hypertensionColumn,
      config.survey.smokingEverColumn,
      config.survey.smokingNowColumn,
      config.survey.diabetesColumn,
      ...config.survey.vigorousActivityColumns,
      ...config.survey.moderateActivityColumns,
    ]),
  );
  const biomarkerRows = await readZippedTsvColumns(
    path.join(input.downloadsDir, config.biomarkerZip),
    config.biomarkerEntry,
    uniqueColumns([
      config.biomarker.idColumn,
      config.biomarker.ageColumn,
      config.biomarker.sexColumn,
      config.biomarker.bmiColumn,
      ...BIOMARKER_FEATURE_DEFINITIONS.map((feature) => config.biomarker[feature.columnKey]),
    ]),
  );
  const mortalityRows = await readZippedTsvColumns(
    path.join(input.downloadsDir, config.mortalityZip),
    config.mortalityEntry,
    [config.mortality.idColumn, config.mortality.deathYearColumn],
  );

  const surveyById = new Map(
    surveyRows.filter((row) => row[config.survey.idColumn]).map((row) => [row[config.survey.idColumn]!, row]),
  );
  const mortalityById = new Map(
    mortalityRows
      .filter((row) => row[config.mortality.idColumn])
      .map((row) => [row[config.mortality.idColumn]!, row]),
  );
  const rows: ParsedRow[] = [];
  for (const biomarkerRow of biomarkerRows) {
    const id = biomarkerRow[config.biomarker.idColumn];
    if (!id) continue;
    const surveyRow = surveyById.get(id);
    if (!surveyRow) continue;
    const baselineYear = parseYear(surveyRow[config.survey.baselineYearColumn]);
    if (!baselineYear || baselineYear + 10 > 2023) continue;
    const age = parseMetricValue(biomarkerRow[config.biomarker.ageColumn]);
    const sex = parseMidusSex(biomarkerRow[config.biomarker.sexColumn]);
    if (age === null || sex === null) continue;

    const deathYear = parseYear(mortalityById.get(id)?.[config.mortality.deathYearColumn]);
    const values: Record<string, number | null> = {
      age,
      female: sex === "female" ? 1 : 0,
      "r399-logit": null,
      ...buildR399ProxyValues({ biomarkerRow, config, surveyRow }),
    };
    for (const definition of BIOMARKER_FEATURE_DEFINITIONS) {
      const rawValue = parseMetricValue(biomarkerRow[config.biomarker[definition.columnKey]]);
      values[definition.key] = rawValue === null ? null : definition.transform(rawValue);
    }

    const r399Risk = scoreR399Risk({
      age,
      config,
      r399Model: input.r399Model,
      sex,
      values,
    });
    values["r399-logit"] = logit(r399Risk);
    rows.push({
      r399Risk,
      split: stableSplit(id, config),
      values,
      y: deathYear && deathYear - baselineYear > 0 && deathYear - baselineYear <= 10 ? 1 : 0,
    });
  }
  return rows;
}

function buildR399ProxyValues(input: {
  biomarkerRow: TsvRow;
  config: R399MidusCohortConfig;
  surveyRow: TsvRow;
}): Record<typeof R399_PROXY_FEATURE_KEYS[number], number | null> {
  return {
    bmi: parseMetricValue(input.biomarkerRow[input.config.biomarker.bmiColumn]),
    "diabetes-history-proxy-yes": parseYesNo(input.surveyRow[input.config.survey.diabetesColumn]),
    "hypertension-history-proxy-yes": parseYesNo(input.surveyRow[input.config.survey.hypertensionColumn]),
    "physical-activity-proxy": parsePhysicalActivityProxy(input.surveyRow, input.config),
    "self-rated-health": parseLikert(input.surveyRow[input.config.survey.selfRatedHealthColumn], { max: 5, min: 1 }),
    "smoking-status-proxy": parseSmokingStatusProxy(input.surveyRow, input.config),
  };
}

function scoreR399Risk(input: {
  age: number;
  config: R399MidusCohortConfig;
  r399Model: MurphAgeRiskModel;
  sex: MurphAgeSex;
  values: Record<string, number | null>;
}): number {
  const result = calculateMurphAge({
    asOf: "2026-05-12T00:00:00.000Z",
    chronologicalAgeYears: input.age,
    model: input.r399Model,
    points: R399_PROXY_FEATURE_KEYS
      .map((metricKey) => {
        const value = input.values[metricKey];
        return value === null ? null : metricPoint(metricKey, value, input.config);
      })
      .filter((point): point is MetricPoint => point !== null),
    sex: input.sex,
  });
  if (result.status !== "ready" || !result.risk) {
    throw new Error("R399 anchor failed to score a MIDUS row.");
  }
  return result.risk.probability;
}

function selectModel(rows: readonly ParsedRow[], featureKeys: string[]): TrainedModel {
  const candidates = LAMBDAS.map((lambda) => {
    const model = trainLogistic(rows, featureKeys, lambda);
    return {
      calibrationLogLoss: aggregateMetrics(rows, model.predict, "calibration").logLoss,
      model,
    };
  });
  return candidates.sort((a, b) => a.calibrationLogLoss - b.calibrationLogLoss)[0]!.model;
}

function trainLogistic(rows: readonly ParsedRow[], featureKeys: string[], lambda: number): TrainedModel {
  const { stats, vectorForRow } = prepareFeatureMatrix(rows, featureKeys);
  const trainRows = rows.filter((row) => row.split === "train");
  const weights = new Array(featureKeys.length + 1).fill(0);
  for (let iteration = 0; iteration < 5000; iteration += 1) {
    const gradient = new Array(weights.length).fill(0);
    for (const row of trainRows) {
      const vector = vectorForRow(row);
      const prediction = sigmoid(dot(weights, vector));
      for (let index = 0; index < weights.length; index += 1) {
        gradient[index] += (prediction - row.y) * vector[index]!;
      }
    }
    for (let index = 0; index < weights.length; index += 1) {
      gradient[index] /= Math.max(1, trainRows.length);
      if (index > 0) gradient[index] += lambda * weights[index]!;
      weights[index] -= 0.05 * gradient[index]!;
    }
  }
  return {
    featureKeys,
    lambda,
    predict: (row) => sigmoid(dot(weights, vectorForRow(row))),
    stats,
  };
}

function prepareFeatureMatrix(
  rows: readonly ParsedRow[],
  featureKeys: readonly string[],
): {
  stats: Record<string, { mean: number; median: number; observedCount: number; sd: number }>;
  vectorForRow(row: ParsedRow): number[];
} {
  const trainRows = rows.filter((row) => row.split === "train");
  const stats = Object.fromEntries(featureKeys.map((featureKey) => {
    const observed = trainRows
      .map((row) => row.values[featureKey])
      .filter((value): value is number => value !== null && Number.isFinite(value))
      .sort((left, right) => left - right);
    const median = percentile(observed, 0.5);
    const mean = observed.reduce((sum, value) => sum + value, 0) / Math.max(1, observed.length);
    const variance = observed.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(1, observed.length);
    return [featureKey, {
      mean: Number.isFinite(mean) ? mean : 0,
      median: Number.isFinite(median) ? median : 0,
      observedCount: observed.length,
      sd: Math.max(Math.sqrt(variance), 1e-6),
    }];
  }));

  return {
    stats,
    vectorForRow(row) {
      return [
        1,
        ...featureKeys.map((featureKey) => {
          const stat = stats[featureKey]!;
          const rawValue = row.values[featureKey];
          const value = rawValue !== null && Number.isFinite(rawValue) ? rawValue : stat.median;
          return (value - stat.mean) / stat.sd;
        }),
      ];
    },
  };
}

function summarizeModel(
  rows: readonly ParsedRow[],
  model: TrainedModel,
  candidate: ModelCandidateDefinition,
): R399Midus2BiomarkerIncrementOutput["models"][string] {
  return {
    anchorCardId: candidate.featureKeys.some((featureKey) => featureKey === "r399-logit")
      ? R399_RESEARCH_CARD_ID
      : null,
    candidateRole: candidate.candidateRole,
    coefficientsStored: false,
    featureKeys: [...candidate.featureKeys],
    featureObservedCounts: featureObservedCounts(rows, candidate.featureKeys),
    hypothesis: candidate.hypothesis,
    hypothesisSource: candidate.hypothesisSource,
    predictionsStored: false,
    selectedLambda: model.lambda,
    splitMetrics: {
      calibration: aggregateMetrics(rows, model.predict, "calibration"),
      test: aggregateMetrics(rows, model.predict, "test"),
      train: aggregateMetrics(rows, model.predict, "train"),
    },
  };
}

function buildIncrementEvaluationCard(input: {
  config: R399MidusCohortConfig;
  dataShape: R399Midus2BiomarkerIncrementOutput["dataShape"];
  models: R399Midus2BiomarkerIncrementOutput["models"];
}): MurphAgeIncrementEvaluationCard {
  const anchorMetrics = input.models.r399_anchor_recalibrated?.splitMetrics.test;
  const candidateMetrics = input.models.r399_plus_lab3_bmi_increment?.splitMetrics.test;
  if (!anchorMetrics || !candidateMetrics) {
    throw new Error(`R399 ${input.config.label} biomarker increment card requires anchor and candidate test metrics.`);
  }
  const testSplit = input.dataShape.splitCounts.test;
  return {
    anchorCardId: R399_RESEARCH_CARD_ID,
    candidateBatchId: input.config.batchId,
    candidateId: input.config.candidateId,
    evaluation: {
      aggregateMetricDeltas: {
        aucDelta: nullableMetricDelta(candidateMetrics.auc, anchorMetrics.auc),
        brierDelta: roundMetric(candidateMetrics.brier - anchorMetrics.brier),
        logLossDelta: roundMetric(candidateMetrics.logLoss - anchorMetrics.logLoss),
      },
      aggregateSample: {
        evaluatedRowCount: testSplit.n,
        eventCount: testSplit.events,
        minimumCellCount: Math.min(testSplit.events, Math.max(0, testSplit.n - testSplit.events)),
        suppressedCellCount: 0,
      },
      anchorMetrics,
      candidateMetrics,
      comparator: "anchor-vs-anchor-plus-increment",
      evidenceTier: "internal-diagnostic",
      sameDenominator: true,
    },
    flatteningAuthorized: false,
    layer: "biomarker-increment",
    outputBoundary: {
      aggregateOnly: true,
      coefficientsExportAllowed: false,
      localArtifactPathExportAllowed: false,
      modelParametersExportAllowed: false,
      participantIdentifiersExportAllowed: false,
      participantLevelExportAllowed: false,
      predictionsExportAllowed: false,
      productDisplayExportAllowed: false,
      rowValuesExportAllowed: false,
      sourceTextExportAllowed: false,
      splitMembershipExportAllowed: false,
    },
    productAuthorized: false,
    riskEffect: "aggregate-estimated",
    schemaVersion: INCREMENT_EVALUATION_CARD_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    sourceRouteId: "midus-biomarker-mortality",
  };
}

function assertIncrementEvaluationCardBoundary(input: {
  card: MurphAgeIncrementEvaluationCard;
  config: R399MidusCohortConfig;
}): void {
  const boundary = input.card.outputBoundary;
  if (
    input.card.productAuthorized !== false
    || input.card.scoreBearing !== false
    || input.card.scoreContributionAuthorized !== false
    || input.card.flatteningAuthorized !== false
    || input.card.evaluation.sameDenominator !== true
    || boundary.aggregateOnly !== true
    || boundary.coefficientsExportAllowed !== false
    || boundary.localArtifactPathExportAllowed !== false
    || boundary.modelParametersExportAllowed !== false
    || boundary.participantIdentifiersExportAllowed !== false
    || boundary.participantLevelExportAllowed !== false
    || boundary.predictionsExportAllowed !== false
    || boundary.productDisplayExportAllowed !== false
    || boundary.rowValuesExportAllowed !== false
    || boundary.sourceTextExportAllowed !== false
    || boundary.splitMembershipExportAllowed !== false
  ) {
    throw new Error(`R399 ${input.config.label} biomarker increment card must remain aggregate-only and research-only.`);
  }
}

function aggregateMetrics(
  rows: readonly ParsedRow[],
  predict: (row: ParsedRow) => number,
  split: Split,
): R399Midus2AggregateMetricSummary {
  const splitRows = rows.filter((row) => row.split === split);
  const predictions = splitRows.map((row) => clampProbability(predict(row)));
  const outcomes = splitRows.map((row) => row.y);
  const n = splitRows.length;
  const events = outcomes.reduce<number>((sum, value) => sum + value, 0);
  return {
    auc: calculateAuc(outcomes, predictions),
    brier: roundMetric(predictions.reduce((sum, prediction, index) =>
      sum + ((prediction - outcomes[index]!) ** 2), 0) / Math.max(1, n)),
    events,
    logLoss: roundMetric(predictions.reduce((sum, prediction, index) => {
      const y = outcomes[index]!;
      return sum - (y * Math.log(prediction) + (1 - y) * Math.log(1 - prediction));
    }, 0) / Math.max(1, n)),
    meanPrediction: roundMetric(predictions.reduce((sum, value) => sum + value, 0) / Math.max(1, n)),
    n,
    observedRate: roundMetric(events / Math.max(1, n)),
  };
}

async function readZippedTsvColumns(
  zipPath: string,
  entry: string,
  columns: readonly string[],
): Promise<TsvRow[]> {
  const unzip = spawn("unzip", ["-p", zipPath, entry], { stdio: ["ignore", "pipe", "pipe"] });
  const rl = createInterface({ crlfDelay: Infinity, input: unzip.stdout });
  let header: string[] | null = null;
  let indexes: Record<string, number> | null = null;
  const rows: TsvRow[] = [];
  for await (const line of rl) {
    if (!header) {
      header = line.split("\t");
      indexes = Object.fromEntries(columns.map((column) => [column, header!.indexOf(column)]));
      const missingColumns = Object.entries(indexes)
        .filter(([, index]) => index < 0)
        .map(([column]) => column);
      if (missingColumns.length > 0) {
        throw new Error(`Missing expected TSV columns: ${missingColumns.join(", ")}`);
      }
      continue;
    }
    const cells = line.split("\t");
    const row: TsvRow = {};
    for (const [column, index] of Object.entries(indexes ?? {})) {
      row[column] = index >= 0 ? String(cells[index] ?? "").trim() : "";
    }
    rows.push(row);
  }
  await new Promise<void>((resolve, reject) => {
    unzip.on("close", (code) => code === 0 ? resolve() : reject(new Error(`unzip exited with ${code}`)));
    unzip.on("error", reject);
  });
  return rows;
}

function metricPoint(metricKey: string, value: number, config: R399MidusCohortConfig): MetricPoint {
  const unit = metricKey === "bmi" ? "kg/m^2" : null;
  return {
    biomarkerKey: null,
    canonicalUnit: unit,
    canonicalValue: value,
    comparator: null,
    confidence: "medium",
    context: {
      aggregationWindow: null,
      deviceModel: null,
      labName: null,
      method: null,
      notes: [],
      provider: null,
      rawRefs: [],
      sourceLabel: config.metricPointSourceLabel,
    },
    effectiveDate: "2026-05-12",
    grain: "instant",
    id: `metric-point:${metricKey}:${config.cohortId}-local-research`,
    metricKey,
    observedAt: "2026-05-12T00:00:00.000Z",
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: config.metricPointSourceLabel,
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: "derived",
      kind: metricKey === "bmi" ? "measurement" : "survey-response",
      path: config.metricPointSourcePath,
      recordId: config.metricPointRecordId,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit,
    value,
  };
}

function parseMidusSex(value: string | undefined): MurphAgeSex | null {
  const parsed = parseMetricValue(value);
  if (parsed === 1) return "male";
  if (parsed === 2) return "female";
  return null;
}

function parseYear(value: string | undefined): number | null {
  const parsed = parseMetricValue(value);
  if (parsed === null) return null;
  const rounded = Math.trunc(parsed);
  return rounded >= 1900 && rounded <= 2100 ? rounded : null;
}

function parseMetricValue(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === ".") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed >= 90_000) return null;
  return parsed;
}

function parseLikert(value: string | undefined, input: { max: number; min: number }): number | null {
  const parsed = parseMetricValue(value);
  return parsed !== null && parsed >= input.min && parsed <= input.max ? parsed : null;
}

function parseYesNo(value: string | undefined): 0 | 1 | null {
  const parsed = parseMetricValue(value);
  if (parsed === 1) return 1;
  if (parsed === 2) return 0;
  return null;
}

function parseSmokingStatusProxy(row: TsvRow, config: R399MidusCohortConfig): number | null {
  const everRegular = parseYesNo(row[config.survey.smokingEverColumn]);
  const nowRegular = parseYesNo(row[config.survey.smokingNowColumn]);
  if (everRegular === 0) return 0;
  if (everRegular === 1 && nowRegular === 0) return 1;
  if (everRegular === 1 && nowRegular === 1) return 2;
  return null;
}

function parsePhysicalActivityProxy(row: TsvRow, config: R399MidusCohortConfig): number | null {
  const values: number[] = [];
  for (const key of config.survey.vigorousActivityColumns) {
    const parsed = parseActivityFrequency(row[key]);
    if (parsed !== null) values.push(parsed * 2);
  }
  for (const key of config.survey.moderateActivityColumns) {
    const parsed = parseActivityFrequency(row[key]);
    if (parsed !== null) values.push(parsed);
  }
  if (values.length === 0) return null;
  return (values.reduce((sum, value) => sum + value, 0) / values.length) * 20;
}

function parseActivityFrequency(value: string | undefined): number | null {
  const parsed = parseMetricValue(value);
  if (parsed === null || parsed < 1 || parsed > 6) return null;
  return 6 - parsed;
}

function stableSplit(id: string, config: R399MidusCohortConfig): Split {
  const digest = createHash("sha256").update(`${config.splitSalt}:${id}`).digest();
  const bucket = digest.readUInt32BE(0) / 0xffffffff;
  if (bucket < 0.6) return "train";
  if (bucket < 0.8) return "calibration";
  return "test";
}

function uniqueColumns(columns: readonly string[]): string[] {
  return [...new Set(columns)];
}

function splitCounts(rows: readonly ParsedRow[]): Record<Split, { events: number; n: number }> {
  return {
    calibration: summarizeSplit(rows, "calibration"),
    test: summarizeSplit(rows, "test"),
    train: summarizeSplit(rows, "train"),
  };
}

function summarizeSplit(rows: readonly ParsedRow[], split: Split): { events: number; n: number } {
  const splitRows = rows.filter((row) => row.split === split);
  return {
    events: splitRows.reduce((sum, row) => sum + row.y, 0),
    n: splitRows.length,
  };
}

function r399ProxyFeatureObservedCounts(
  rows: readonly ParsedRow[],
): Record<typeof R399_PROXY_FEATURE_KEYS[number], number> {
  return featureObservedCounts(rows, R399_PROXY_FEATURE_KEYS) as Record<typeof R399_PROXY_FEATURE_KEYS[number], number>;
}

function featureObservedCounts(rows: readonly ParsedRow[], featureKeys: readonly string[]): Record<string, number> {
  return Object.fromEntries(featureKeys.map((featureKey) => [
    featureKey,
    rows.reduce((count, row) => {
      const value = row.values[featureKey];
      return count + (value !== null && Number.isFinite(value) ? 1 : 0);
    }, 0),
  ]));
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * fraction)));
  return values[index]!;
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}

function sigmoid(value: number): number {
  if (value < -35) return 1e-15;
  if (value > 35) return 1 - 1e-15;
  return 1 / (1 + Math.exp(-value));
}

function logit(value: number): number {
  const probability = clampProbability(value);
  return Math.log(probability / (1 - probability));
}

function clampProbability(value: number): number {
  return Math.min(1 - 1e-12, Math.max(1e-12, value));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function nullableMetricDelta(candidate: number | null, anchor: number | null): number | undefined {
  if (candidate === null || anchor === null) return undefined;
  return roundMetric(candidate - anchor);
}

async function main(): Promise<void> {
  const { output, outputPath } = await runR399MidusBiomarkerIncrement({
    cohortId: parseR399MidusCohortId(process.env.MURPH_AGE_MIDUS_COHORT),
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r399ModelCardPath: process.env.MURPH_AGE_R399_MODEL_CARD_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    anchor: {
      cardId: output.anchor.cardId,
      featureCount: output.anchor.featureCount,
      modelId: output.anchor.modelId,
    },
    artifact: path.basename(outputPath),
    benchmarkId: output.benchmarkId,
    candidateBatch: output.candidateBatch,
    dataShape: summarizeDataShapeForCli(output.dataShape),
    modelIds: Object.keys(output.models),
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

function summarizeDataShapeForCli(
  dataShape: R399Midus2BiomarkerIncrementOutput["dataShape"],
): {
  eligibleRowsBand: string;
  eventCountBand: string;
  r399ProxyFeatureObservedCountBands: Record<typeof R399_PROXY_FEATURE_KEYS[number], string>;
  splitCountBands: Record<Split, { eventCountBand: string; rowCountBand: string }>;
} {
  return {
    eligibleRowsBand: countBand(dataShape.eligibleRows),
    eventCountBand: countBand(dataShape.events),
    r399ProxyFeatureObservedCountBands: Object.fromEntries(
      Object.entries(dataShape.r399ProxyFeatureObservedCounts).map(([key, count]) => [key, countBand(count)]),
    ) as Record<typeof R399_PROXY_FEATURE_KEYS[number], string>,
    splitCountBands: Object.fromEntries(
      Object.entries(dataShape.splitCounts).map(([split, counts]) => [
        split,
        {
          eventCountBand: countBand(counts.events),
          rowCountBand: countBand(counts.n),
        },
      ]),
    ) as Record<Split, { eventCountBand: string; rowCountBand: string }>,
  };
}

function countBand(count: number): string {
  if (count <= 0) return "0";
  if (count < 10) return "1-9";
  if (count < 50) return "10-49";
  if (count < 100) return "50-99";
  if (count < 500) return "100-499";
  if (count < 1000) return "500-999";
  return "1000+";
}

function parseR399MidusCohortId(value: string | undefined): R399MidusCohortId | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (value === "midus2" || value === "midus-refresher") return value;
  throw new Error(`Unsupported MIDUS cohort id: ${value}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
