import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1084_HAALSI_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION =
  "murph-age-r1084-haalsi-function-missingness-calibration-adjudication.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R1044_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1044-haalsi-external-biomarker-loop.latest.json");
const OUTPUT_FILE_NAME = "r1084-haalsi-function-missingness-calibration-adjudication.latest.json";

type CandidateId =
  | "A0_age_sex"
  | "F1_walk_difficulty_shadow"
  | "F2_glucose_walk_difficulty_shadow"
  | "I1_glucose_body_pulse_walk_shadow"
  | "NC6_missingness_quality_only";
type Verdict =
  | "function_content_fails_missingness_or_calibration"
  | "function_content_supported_with_missingness_caveat"
  | "missing_required_haalsi_aggregate";

interface CandidateMetricSummary {
  auc: number | null;
  aucDeltaVsReference: number | null;
  brier: number | null;
  brierDeltaVsReference: number | null;
  calibrationIntercept: number | null;
  calibrationSlope: number | null;
  expectedOverObserved: number | null;
  logLoss: number | null;
  logLossDeltaVsReference: number | null;
  verdict: string | null;
}

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1084HaalsiFunctionMissingnessCalibrationAdjudicationOptions {
  createdAt?: string;
  outputDir?: string;
  r1044Path?: string;
}

export interface R1084HaalsiFunctionMissingnessCalibrationAdjudicationOutput {
  adjudication: {
    calibrationNonWorse: boolean | null;
    functionBeatsMissingnessControl: boolean | null;
    functionContentBeatsReference: boolean | null;
    functionPlusGlucoseBeatsFunction: boolean | null;
    integratedShadowBeatsFunctionPlusGlucose: boolean | null;
    missingnessControlBeatsReference: boolean | null;
    verdict: Verdict;
  };
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1084: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1084: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  candidateMetrics: Record<CandidateId, CandidateMetricSummary>;
  createdAt: string;
  inputArtifacts: {
    r1044HaalsiExternalBiomarker: ArtifactSummary;
  };
  nextLocalAction:
    | "await_haalsi_aggregate"
    | "hold_function_content_and_redirect_candidate_generation"
    | "keep_function_lead_seek_fresh_function_source_or_true_wearable";
  packetId: "r1084-haalsi-function-missingness-calibration-adjudication";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1084_HAALSI_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "haalsi_function_adjudication_blocked_missing_aggregate"
      | "haalsi_function_adjudication_hold"
      | "haalsi_function_adjudication_supportive_with_missingness_caveat";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1084: false;
  };
}

export async function runR1084HaalsiFunctionMissingnessCalibrationAdjudication(
  options: R1084HaalsiFunctionMissingnessCalibrationAdjudicationOptions = {},
): Promise<{ output: R1084HaalsiFunctionMissingnessCalibrationAdjudicationOutput; outputPath: string }> {
  const r1044 = await readJsonIfPresent(options.r1044Path ?? DEFAULT_R1044_PATH);
  validateInputBoundary(r1044);
  const candidateMetrics = summarizeCandidateMetrics(r1044);
  const adjudication = adjudicate(candidateMetrics, r1044);
  const output: R1084HaalsiFunctionMissingnessCalibrationAdjudicationOutput = {
    adjudication,
    artifactBoundary: safeBoundary(),
    candidateMetrics,
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1044HaalsiExternalBiomarker: summarizeArtifact("r1044-haalsi-external-biomarker-loop", r1044),
    },
    nextLocalAction: nextLocalActionFor(adjudication.verdict),
    packetId: "r1084-haalsi-function-missingness-calibration-adjudication",
    productDisplayAuthorized: false,
    schemaVersion: R1084_HAALSI_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: conclusionFor(adjudication.verdict),
      productDisplayAuthorized: false,
      rowParsingPerformedByR1084: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1084 HAALSI function adjudication failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function validateInputBoundary(value: unknown | null): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1084 input failed aggregate boundary validation: ${findings.join("; ")}`);
  }
}

function summarizeCandidateMetrics(value: unknown | null): Record<CandidateId, CandidateMetricSummary> {
  const ids: CandidateId[] = [
    "A0_age_sex",
    "F1_walk_difficulty_shadow",
    "F2_glucose_walk_difficulty_shadow",
    "I1_glucose_body_pulse_walk_shadow",
    "NC6_missingness_quality_only",
  ];
  const referenceAuc = readNumberAt(value, ["models", "A0_age_sex", "splitMetrics", "test", "auc"]);
  return Object.fromEntries(ids.map((candidateId) => {
    const auc = readNumberAt(value, ["models", candidateId, "splitMetrics", "test", "auc"]);
    return [candidateId, {
      auc,
      aucDeltaVsReference: auc !== null && referenceAuc !== null ? roundMetric(auc - referenceAuc) : null,
      brier: readNumberAt(value, ["models", candidateId, "splitMetrics", "test", "brier"]),
      brierDeltaVsReference: readNumberAt(value, ["models", candidateId, "deltasVsAgeSexReference", "brierDelta"]),
      calibrationIntercept: readNumberAt(value, ["models", candidateId, "splitMetrics", "test", "calibrationIntercept"]),
      calibrationSlope: readNumberAt(value, ["models", candidateId, "splitMetrics", "test", "calibrationSlope"]),
      expectedOverObserved: readNumberAt(value, ["models", candidateId, "splitMetrics", "test", "expectedOverObserved"]),
      logLoss: readNumberAt(value, ["models", candidateId, "splitMetrics", "test", "logLoss"]),
      logLossDeltaVsReference: readNumberAt(value, ["models", candidateId, "deltasVsAgeSexReference", "logLossDelta"]),
      verdict: readStringAt(value, ["models", candidateId, "verdict"]),
    }];
  })) as Record<CandidateId, CandidateMetricSummary>;
}

function adjudicate(
  metrics: Record<CandidateId, CandidateMetricSummary>,
  source: unknown | null,
): R1084HaalsiFunctionMissingnessCalibrationAdjudicationOutput["adjudication"] {
  if (source === null) {
    return {
      calibrationNonWorse: null,
      functionBeatsMissingnessControl: null,
      functionContentBeatsReference: null,
      functionPlusGlucoseBeatsFunction: null,
      integratedShadowBeatsFunctionPlusGlucose: null,
      missingnessControlBeatsReference: null,
      verdict: "missing_required_haalsi_aggregate",
    };
  }
  const functionContentBeatsReference = beatsReference(metrics.F1_walk_difficulty_shadow);
  const missingnessControlBeatsReference = beatsReferenceOnProperScores(metrics.NC6_missingness_quality_only);
  const functionBeatsMissingnessControl = beatsComparator(metrics.F1_walk_difficulty_shadow, metrics.NC6_missingness_quality_only);
  const calibrationNonWorse = calibrationNonWorseThanReference(metrics.F1_walk_difficulty_shadow, metrics.A0_age_sex);
  const functionPlusGlucoseBeatsFunction = beatsComparator(
    metrics.F2_glucose_walk_difficulty_shadow,
    metrics.F1_walk_difficulty_shadow,
  );
  const integratedShadowBeatsFunctionPlusGlucose = beatsComparator(
    metrics.I1_glucose_body_pulse_walk_shadow,
    metrics.F2_glucose_walk_difficulty_shadow,
  );
  const supportive = functionContentBeatsReference
    && functionBeatsMissingnessControl
    && calibrationNonWorse;
  return {
    calibrationNonWorse,
    functionBeatsMissingnessControl,
    functionContentBeatsReference,
    functionPlusGlucoseBeatsFunction,
    integratedShadowBeatsFunctionPlusGlucose,
    missingnessControlBeatsReference,
    verdict: supportive
      ? "function_content_supported_with_missingness_caveat"
      : "function_content_fails_missingness_or_calibration",
  };
}

function beatsReference(candidate: CandidateMetricSummary): boolean {
  return candidate.verdict === "beats_age_sex"
    && (candidate.aucDeltaVsReference ?? -1) > 0
    && (candidate.brierDeltaVsReference ?? 1) < 0
    && (candidate.logLossDeltaVsReference ?? 1) < 0;
}

function beatsReferenceOnProperScores(candidate: CandidateMetricSummary): boolean {
  return candidate.verdict === "beats_age_sex"
    && (candidate.brierDeltaVsReference ?? 1) < 0
    && (candidate.logLossDeltaVsReference ?? 1) < 0;
}

function beatsComparator(candidate: CandidateMetricSummary, comparator: CandidateMetricSummary): boolean {
  const aucOk = candidate.auc !== null && comparator.auc !== null && candidate.auc > comparator.auc;
  const brierOk = candidate.brier !== null && comparator.brier !== null && candidate.brier < comparator.brier;
  const logLossOk = candidate.logLoss !== null && comparator.logLoss !== null && candidate.logLoss < comparator.logLoss;
  return aucOk && brierOk && logLossOk;
}

function calibrationNonWorseThanReference(candidate: CandidateMetricSummary, reference: CandidateMetricSummary): boolean {
  const candidateScore = calibrationDistance(candidate);
  const referenceScore = calibrationDistance(reference);
  if (candidateScore === null || referenceScore === null) return false;
  return candidateScore <= referenceScore + 0.01;
}

function calibrationDistance(candidate: CandidateMetricSummary): number | null {
  if (
    candidate.calibrationIntercept === null
    || candidate.calibrationSlope === null
    || candidate.expectedOverObserved === null
  ) {
    return null;
  }
  return Math.abs(candidate.calibrationIntercept)
    + Math.abs(candidate.calibrationSlope - 1)
    + Math.abs(candidate.expectedOverObserved - 1);
}

function nextLocalActionFor(
  verdict: Verdict,
): R1084HaalsiFunctionMissingnessCalibrationAdjudicationOutput["nextLocalAction"] {
  if (verdict === "missing_required_haalsi_aggregate") return "await_haalsi_aggregate";
  if (verdict === "function_content_fails_missingness_or_calibration") {
    return "hold_function_content_and_redirect_candidate_generation";
  }
  return "keep_function_lead_seek_fresh_function_source_or_true_wearable";
}

function conclusionFor(
  verdict: Verdict,
): R1084HaalsiFunctionMissingnessCalibrationAdjudicationOutput["summary"]["conclusion"] {
  if (verdict === "missing_required_haalsi_aggregate") return "haalsi_function_adjudication_blocked_missing_aggregate";
  if (verdict === "function_content_fails_missingness_or_calibration") return "haalsi_function_adjudication_hold";
  return "haalsi_function_adjudication_supportive_with_missingness_caveat";
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value === null ? "missing" : "available",
  };
}

function safeBoundary(): R1084HaalsiFunctionMissingnessCalibrationAdjudicationOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1084: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1084: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function readNumberAt(value: unknown | null, pathParts: readonly string[]): number | null {
  const current = readAt(value, pathParts);
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const current = readAt(value, pathParts);
  return typeof current === "string" && current.length > 0 ? current : null;
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(8));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1084HaalsiFunctionMissingnessCalibrationAdjudication({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1044Path: process.env.MURPH_AGE_R1044_HAALSI_PATH,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      nextLocalAction: output.nextLocalAction,
      packetId: output.packetId,
      productDisplayAuthorized: output.productDisplayAuthorized,
      rowParsingPerformedByR1084: output.summary.rowParsingPerformedByR1084,
      schemaVersion: output.schemaVersion,
      status: output.status,
      verdict: output.adjudication.verdict,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    const message = error instanceof Error && !/(?:\/|\\)/u.test(error.message)
      ? error.message
      : "R1084 HAALSI function adjudication failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
