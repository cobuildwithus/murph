import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1093_CONSUMER_LAB_SHADOW_CANDIDATE_SELECTOR_SCHEMA_VERSION =
  "murph-age-r1093-consumer-lab-shadow-candidate-selector.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1093-consumer-lab-shadow-candidate-selector.latest.json";

const INPUTS = {
  r1038: {
    artifact: "r1038-nhanes-modern-lab-activity-loop.latest.json",
    packetId: "r1038-nhanes-modern-lab-activity-loop",
    schemaVersion: "murph-age-r1038-nhanes-modern-lab-activity-loop.v1",
  },
  r1044: {
    artifact: "r1044-haalsi-external-biomarker-loop.latest.json",
    packetId: "r1044-haalsi-external-biomarker-loop",
    schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
  },
  r1092: {
    artifact: "r1092-consumer-bloodwork-control-hardening.latest.json",
    packetId: "r1092-consumer-bloodwork-control-hardening",
    schemaVersion: "murph-age-r1092-consumer-bloodwork-control-hardening.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ComparisonSummary {
  aucDelta: number | null;
  brierDelta: number | null;
  comparisonId: string;
  eventCountBand: string | null;
  logLossDelta: number | null;
  nBand: string | null;
  verdict: "improves_both_proper_scores" | "not_clean" | "missing";
}

interface DirectDeltaSummary {
  brierDelta: number | null;
  comparisonId: string;
  logLossDelta: number | null;
  verdict: "improves_both_proper_scores" | "not_clean" | "missing";
}

export interface R1093ConsumerLabShadowCandidateSelectorOptions {
  createdAt?: string;
  outputDir?: string;
  r1038Path?: string;
  r1044Path?: string;
  r1092Path?: string;
}

export interface R1093ConsumerLabShadowCandidateSelectorOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1093: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1093-consumer-lab-shadow-candidate-selector";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1093_CONSUMER_LAB_SHADOW_CANDIDATE_SELECTOR_SCHEMA_VERSION;
  selection: {
    candidateId:
      | "common_lab_core_shadow"
      | "hold_no_lab_shadow_candidate";
    evidence: {
      haalsiBroadLipidPanel: DirectDeltaSummary;
      haalsiGlucoseBodyHemoglobin: DirectDeltaSummary;
      haalsiMissingnessQuality: DirectDeltaSummary;
      nhanesCoverageQualityVsLab9: ComparisonSummary;
      nhanesLab5VsBpBody: ComparisonSummary;
      nhanesLab9VsBpBody: ComparisonSummary;
    };
    featureFamilyEmphasis: [
      "glycemia_hba1c_glucose",
      "blood_pressure_vitals",
      "body_composition",
      "cbc_or_basic_chemistry_context",
      "lipids_secondary_controlled",
    ] | [];
    promotionBlockedBy: string[];
    selectedForNextShadowRun: boolean;
  };
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "common_lab_shadow_candidate_selected_not_promoted"
      | "lab_shadow_candidate_blocked_missing_or_unclean";
    nextLocalAction:
      | "keep_lab_candidate_shadow_and_seek_external_replication"
      | "repair_lab_control_hardening_inputs";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1093: false;
  };
}

export async function runR1093ConsumerLabShadowCandidateSelector(
  options: R1093ConsumerLabShadowCandidateSelectorOptions = {},
): Promise<{ output: R1093ConsumerLabShadowCandidateSelectorOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const hardeningReady = readStringAt(inputs.r1092, ["summary", "conclusion"])
    === "bloodwork_shadow_loop_control_limited_keep_glycemia_lead";
  const evidence = {
    haalsiBroadLipidPanel: summarizeR1044Model(inputs.r1044, "B1_glucose_lipid_body_no_crp"),
    haalsiGlucoseBodyHemoglobin: summarizeR1044Model(inputs.r1044, "A3_glucose_body_hemoglobin"),
    haalsiMissingnessQuality: summarizeR1044Model(inputs.r1044, "NC6_missingness_quality_only"),
    nhanesCoverageQualityVsLab9: compareR1038Runs(inputs.r1038, "N1_coverage_quality_only_negative_control", "C3_lab9_hba1c_bp_body_primary"),
    nhanesLab5VsBpBody: compareR1038Runs(inputs.r1038, "C1_lab5_hba1c_bp_body", "R1_age_sex_bp_body_reference"),
    nhanesLab9VsBpBody: compareR1038Runs(inputs.r1038, "C3_lab9_hba1c_bp_body_primary", "R1_age_sex_bp_body_reference"),
  };
  const selected = hardeningReady
    && evidence.nhanesLab5VsBpBody.verdict === "improves_both_proper_scores"
    && evidence.haalsiGlucoseBodyHemoglobin.verdict === "improves_both_proper_scores"
    && evidence.nhanesCoverageQualityVsLab9.verdict !== "improves_both_proper_scores";

  const output: R1093ConsumerLabShadowCandidateSelectorOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1093: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1093-consumer-lab-shadow-candidate-selector",
    productDisplayAuthorized: false,
    schemaVersion: R1093_CONSUMER_LAB_SHADOW_CANDIDATE_SELECTOR_SCHEMA_VERSION,
    selection: {
      candidateId: selected ? "common_lab_core_shadow" : "hold_no_lab_shadow_candidate",
      evidence,
      featureFamilyEmphasis: selected
        ? [
          "glycemia_hba1c_glucose",
          "blood_pressure_vitals",
          "body_composition",
          "cbc_or_basic_chemistry_context",
          "lipids_secondary_controlled",
        ]
        : [],
      promotionBlockedBy: [
        "external_replication_is_mixed",
        "age_year_attribution_not_validated",
        "lipid_and_body_controls_can_compete_in_some_sources",
        "true_wearable_outcome_aggregate_is_missing",
      ],
      selectedForNextShadowRun: selected,
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: selected
        ? "common_lab_shadow_candidate_selected_not_promoted"
        : "lab_shadow_candidate_blocked_missing_or_unclean",
      nextLocalAction: selected
        ? "keep_lab_candidate_shadow_and_seek_external_replication"
        : "repair_lab_control_hardening_inputs",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1093: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1093 consumer lab shadow candidate selector failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1093ConsumerLabShadowCandidateSelectorOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1038: await readJsonIfPresent(options.r1038Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1038.artifact)),
    r1044: await readJsonIfPresent(options.r1044Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1044.artifact)),
    r1092: await readJsonIfPresent(options.r1092Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1092.artifact)),
  };
}

function compareR1038Runs(value: unknown | null, candidateId: string, comparatorId: string): ComparisonSummary {
  const candidate = findCandidateRun(value, candidateId);
  const comparator = findCandidateRun(value, comparatorId);
  const candidateTest = readRecordAt(candidate, ["splitMetrics", "test"]);
  const comparatorTest = readRecordAt(comparator, ["splitMetrics", "test"]);
  if (!candidateTest || !comparatorTest) return missingComparison(`${candidateId}_vs_${comparatorId}`);
  const brierDelta = delta(readNumberAt(candidateTest, ["brier"]), readNumberAt(comparatorTest, ["brier"]));
  const logLossDelta = delta(readNumberAt(candidateTest, ["logLoss"]), readNumberAt(comparatorTest, ["logLoss"]));
  const aucDelta = delta(readNumberAt(candidateTest, ["auc"]), readNumberAt(comparatorTest, ["auc"]));
  return {
    aucDelta,
    brierDelta,
    comparisonId: `${candidateId}_vs_${comparatorId}`,
    eventCountBand: readStringAt(candidateTest, ["eventCountBand"]),
    logLossDelta,
    nBand: readStringAt(candidateTest, ["nBand"]),
    verdict: brierDelta !== null && brierDelta < 0 && logLossDelta !== null && logLossDelta < 0
      ? "improves_both_proper_scores"
      : "not_clean",
  };
}

function summarizeR1044Model(value: unknown | null, candidateId: string): DirectDeltaSummary {
  const model = readRecordAt(value, ["models", candidateId]);
  if (!model) {
    return {
      brierDelta: null,
      comparisonId: `${candidateId}_vs_age_sex`,
      logLossDelta: null,
      verdict: "missing",
    };
  }
  const brierDelta = readNumberAt(model, ["deltasVsAgeSexReference", "brierDelta"]);
  const logLossDelta = readNumberAt(model, ["deltasVsAgeSexReference", "logLossDelta"]);
  return {
    brierDelta,
    comparisonId: `${candidateId}_vs_age_sex`,
    logLossDelta,
    verdict: brierDelta !== null && brierDelta < 0 && logLossDelta !== null && logLossDelta < 0
      ? "improves_both_proper_scores"
      : "not_clean",
  };
}

function findCandidateRun(value: unknown | null, candidateId: string): unknown | null {
  const runs = readArrayAt(value, ["candidateRuns"]);
  return runs.find((item) =>
    item && typeof item === "object" && !Array.isArray(item)
    && (item as Record<string, unknown>).candidateId === candidateId
  ) ?? null;
}

function missingComparison(comparisonId: string): ComparisonSummary {
  return {
    aucDelta: null,
    brierDelta: null,
    comparisonId,
    eventCountBand: null,
    logLossDelta: null,
    nBand: null,
    verdict: "missing",
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1093 rejected unsafe ${key} input: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.keys(INPUTS) as InputKey[]).map((key) => [key, summarizeInput(INPUTS[key].artifact, inputs[key])]),
  ) as Record<InputKey, ArtifactSummary>;
}

function summarizeInput(artifact: string, value: unknown | null): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function readArrayAt(value: unknown | null, keys: readonly string[]): unknown[] {
  const found = readAt(value, keys);
  return Array.isArray(found) ? found : [];
}

function readNumberAt(value: unknown | null, keys: readonly string[]): number | null {
  const found = readAt(value, keys);
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

function readRecordAt(value: unknown | null, keys: readonly string[]): Record<string, unknown> | null {
  const found = readAt(value, keys);
  return found && typeof found === "object" && !Array.isArray(found) ? found as Record<string, unknown> : null;
}

function readStringAt(value: unknown | null, keys: readonly string[]): string | null {
  const found = readAt(value, keys);
  return typeof found === "string" ? found : null;
}

function readAt(value: unknown | null, keys: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function delta(candidate: number | null, comparator: number | null): number | null {
  if (candidate === null || comparator === null) return null;
  return Math.round((candidate - comparator) * 100_000_000) / 100_000_000;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1093ConsumerLabShadowCandidateSelector()
    .then(({ output }) => {
      process.stdout.write(`${JSON.stringify({
        candidateId: output.selection.candidateId,
        conclusion: output.summary.conclusion,
        nextLocalAction: output.summary.nextLocalAction,
        packetId: output.packetId,
        productDisplayAuthorized: output.productDisplayAuthorized,
        rowParsingPerformedByR1093: output.summary.rowParsingPerformedByR1093,
        schemaVersion: output.schemaVersion,
        selectedForNextShadowRun: output.selection.selectedForNextShadowRun,
        status: output.status,
      }, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "R1093 consumer lab shadow candidate selector failed."}\n`);
      process.exitCode = 1;
    });
}
