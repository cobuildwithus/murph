import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1092_CONSUMER_BLOODWORK_CONTROL_HARDENING_SCHEMA_VERSION =
  "murph-age-r1092-consumer-bloodwork-control-hardening.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1092-consumer-bloodwork-control-hardening.latest.json";

const INPUTS = {
  r1041: {
    artifact: "r1041-minimal-glycemia-transport-loop.latest.json",
    packetId: "r1041-minimal-glycemia-transport-loop",
    schemaVersion: "murph-age-r1041-minimal-glycemia-transport-loop.v1",
  },
  r1043: {
    artifact: "r1043-midus-family-glycemia-stability-loop.latest.json",
    packetId: "r1043-midus-family-glycemia-stability-loop",
    schemaVersion: "murph-age-r1043-midus-family-glycemia-stability-loop.v1",
  },
  r1044: {
    artifact: "r1044-haalsi-external-biomarker-loop.latest.json",
    packetId: "r1044-haalsi-external-biomarker-loop",
    schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
  },
  r1048: {
    artifact: "r1048-nshap-hba1c-control-diagnostic.latest.json",
    packetId: "r1048-nshap-hba1c-control-diagnostic",
    schemaVersion: "murph-age-r1048-nshap-hba1c-control-diagnostic.v1",
  },
  r1091: {
    artifact: "r1091-consumer-input-loop-state.latest.json",
    packetId: "r1091-consumer-input-loop-state",
    schemaVersion: "murph-age-r1091-consumer-input-loop-state.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type CandidateDecision =
  | "blocked_or_missing_consumer_loop"
  | "negative_control_or_context_only"
  | "shadow_candidate_control_limited"
  | "shadow_candidate_supported_one_source";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface CohortEvidence {
  evidenceId: string;
  interpretation: string;
  status: "clean_support" | "control_limited" | "missing" | "not_supported";
}

interface LabFamilyDecision {
  decision: CandidateDecision;
  featureFamilyId:
    | "blood_pressure_vitals"
    | "body_composition"
    | "glycemia_hba1c_glucose"
    | "lipids_triglycerides_cholesterol"
    | "missingness_coverage_quality";
  modelUse:
    | "control_hardening_only"
    | "next_shadow_candidate"
    | "paired_quality_gate";
  requiredBeforePromotion: string[];
}

export interface R1092ConsumerBloodworkControlHardeningOptions {
  createdAt?: string;
  outputDir?: string;
  r1041Path?: string;
  r1043Path?: string;
  r1044Path?: string;
  r1048Path?: string;
  r1091Path?: string;
}

export interface R1092ConsumerBloodworkControlHardeningOutput {
  artifactBoundary: {
    aggregateOnly: true;
    calibrationParametersStored: false;
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
    rowParsingPerformedByR1092: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  bloodworkControlHardening: {
    cohortEvidence: CohortEvidence[];
    familyDecisions: LabFamilyDecision[];
    loopPolicy: {
      forbidAgeYearAttribution: true;
      keepSameDenominatorComparisons: true;
      requireNegativeControlSeparation: true;
      requireQualityMissingnessControl: true;
    };
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1092-consumer-bloodwork-control-hardening";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1092_CONSUMER_BLOODWORK_CONTROL_HARDENING_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "bloodwork_shadow_loop_control_limited_keep_glycemia_lead"
      | "bloodwork_shadow_loop_missing_consumer_state";
    nextLocalAction:
      | "repair_consumer_input_loop_state"
      | "run_next_lab_candidate_as_shadow_with_missingness_controls";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1092: false;
  };
}

export async function runR1092ConsumerBloodworkControlHardening(
  options: R1092ConsumerBloodworkControlHardeningOptions = {},
): Promise<{ output: R1092ConsumerBloodworkControlHardeningOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const loopReady = readStringAt(inputs.r1091, ["summary", "conclusion"])
    === "consumer_input_loop_ready_for_bloodwork_control_hardening_wearables_blocked";
  const cohortEvidence = summarizeCohortEvidence(inputs);
  const output: R1092ConsumerBloodworkControlHardeningOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      calibrationParametersStored: false,
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
      rowParsingPerformedByR1092: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    bloodworkControlHardening: {
      cohortEvidence,
      familyDecisions: buildFamilyDecisions(loopReady, cohortEvidence),
      loopPolicy: {
        forbidAgeYearAttribution: true,
        keepSameDenominatorComparisons: true,
        requireNegativeControlSeparation: true,
        requireQualityMissingnessControl: true,
      },
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1092-consumer-bloodwork-control-hardening",
    productDisplayAuthorized: false,
    schemaVersion: R1092_CONSUMER_BLOODWORK_CONTROL_HARDENING_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: loopReady
        ? "bloodwork_shadow_loop_control_limited_keep_glycemia_lead"
        : "bloodwork_shadow_loop_missing_consumer_state",
      nextLocalAction: loopReady
        ? "run_next_lab_candidate_as_shadow_with_missingness_controls"
        : "repair_consumer_input_loop_state",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1092: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1092 consumer bloodwork control hardening failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1092ConsumerBloodworkControlHardeningOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1041: await readJsonIfPresent(options.r1041Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1041.artifact)),
    r1043: await readJsonIfPresent(options.r1043Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1043.artifact)),
    r1044: await readJsonIfPresent(options.r1044Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1044.artifact)),
    r1048: await readJsonIfPresent(options.r1048Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1048.artifact)),
    r1091: await readJsonIfPresent(options.r1091Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1091.artifact)),
  };
}

function summarizeCohortEvidence(inputs: Record<InputKey, unknown | null>): CohortEvidence[] {
  return [
    {
      evidenceId: "r1044_haalsi_glucose",
      interpretation: readStringAt(inputs.r1044, ["decision", "conclusion"]) === "haalsi_glucose_biomarker_signal_supported"
        ? "glucose_support_with_clean_negative_controls"
        : "glucose_support_not_clean",
      status: inputs.r1044
        ? readStringAt(inputs.r1044, ["decision", "controlVerdict"]) === "negative_controls_clean"
          ? "clean_support"
          : "control_limited"
        : "missing",
    },
    {
      evidenceId: "r1048_nshap_hba1c",
      interpretation: readStringAt(inputs.r1048, ["decision", "conclusion"]) === "nshap_hba1c_signal_partial_control_limited"
        ? "hba1c_partial_with_control_competition"
        : "hba1c_not_partial_or_missing",
      status: inputs.r1048
        ? readStringAt(inputs.r1048, ["decision", "conclusion"]) === "nshap_hba1c_separation_clean"
          ? "clean_support"
          : readStringAt(inputs.r1048, ["decision", "conclusion"]) === "nshap_hba1c_signal_partial_control_limited"
            ? "control_limited"
            : "not_supported"
        : "missing",
    },
    {
      evidenceId: "r1041_mixed_source_glycemia_transport",
      interpretation: readStringAt(inputs.r1041, ["decision", "controlVerdict"]) === "negative_controls_compete_with_glycemia"
        ? "cross_source_controls_compete"
        : "cross_source_controls_clean_or_missing",
      status: inputs.r1041
        ? readStringAt(inputs.r1041, ["decision", "controlVerdict"]) === "negative_controls_clean"
          ? "clean_support"
          : "control_limited"
        : "missing",
    },
    {
      evidenceId: "r1043_midus_family_stability",
      interpretation: readStringAt(inputs.r1043, ["decision", "controlVerdict"]) === "negative_controls_compete_with_glycemia"
        ? "same_family_controls_compete"
        : "same_family_controls_clean_or_missing",
      status: inputs.r1043
        ? readStringAt(inputs.r1043, ["decision", "controlVerdict"]) === "negative_controls_clean"
          ? "clean_support"
          : "control_limited"
        : "missing",
    },
  ];
}

function buildFamilyDecisions(loopReady: boolean, cohortEvidence: CohortEvidence[]): LabFamilyDecision[] {
  const glycemiaCleanCount = cohortEvidence.filter((item) => item.status === "clean_support").length;
  const glycemiaControlLimitedCount = cohortEvidence.filter((item) => item.status === "control_limited").length;
  const glycemiaDecision: CandidateDecision = !loopReady
    ? "blocked_or_missing_consumer_loop"
    : glycemiaCleanCount > 0 && glycemiaControlLimitedCount > 0
      ? "shadow_candidate_supported_one_source"
      : "shadow_candidate_control_limited";

  return [
    {
      decision: glycemiaDecision,
      featureFamilyId: "glycemia_hba1c_glucose",
      modelUse: "next_shadow_candidate",
      requiredBeforePromotion: [
        "clean_negative_control_separation_in_at_least_two_independent_sources",
        "stable_calibration_with_same_denominator_controls",
        "fresh_external_or_true_partner_aggregate_validation",
      ],
    },
    {
      decision: loopReady ? "shadow_candidate_control_limited" : "blocked_or_missing_consumer_loop",
      featureFamilyId: "lipids_triglycerides_cholesterol",
      modelUse: "control_hardening_only",
      requiredBeforePromotion: [
        "separate_lipid_signal_from_body_only_controls",
        "show_non_worse_calibration_than_glycemia_body_model",
      ],
    },
    {
      decision: loopReady ? "shadow_candidate_control_limited" : "blocked_or_missing_consumer_loop",
      featureFamilyId: "blood_pressure_vitals",
      modelUse: "control_hardening_only",
      requiredBeforePromotion: [
        "harmonize_bp_across_more_than_one_source",
        "separate_bp_signal_from_age_body_missingness_controls",
      ],
    },
    {
      decision: loopReady ? "negative_control_or_context_only" : "blocked_or_missing_consumer_loop",
      featureFamilyId: "body_composition",
      modelUse: "control_hardening_only",
      requiredBeforePromotion: [
        "do_not_treat_body_only_as_specific_biological_age_signal",
        "use_as_confounder_or_attribution_context_until_transport_is_clean",
      ],
    },
    {
      decision: loopReady ? "negative_control_or_context_only" : "blocked_or_missing_consumer_loop",
      featureFamilyId: "missingness_coverage_quality",
      modelUse: "paired_quality_gate",
      requiredBeforePromotion: [
        "candidate_must_beat_missingness_or_coverage_only_control",
        "candidate_must_not_depend_on_source_or_device_completeness_artifact",
      ],
    },
  ];
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1092 rejected unsafe ${key} input: ${findings.join("; ")}`);
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

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : null;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1092ConsumerBloodworkControlHardening()
    .then(({ output }) => {
      process.stdout.write(`${JSON.stringify({
        conclusion: output.summary.conclusion,
        familyDecisions: output.bloodworkControlHardening.familyDecisions.map((item) => ({
          decision: item.decision,
          featureFamilyId: item.featureFamilyId,
          modelUse: item.modelUse,
        })),
        nextLocalAction: output.summary.nextLocalAction,
        packetId: output.packetId,
        productDisplayAuthorized: output.productDisplayAuthorized,
        rowParsingPerformedByR1092: output.summary.rowParsingPerformedByR1092,
        schemaVersion: output.schemaVersion,
        status: output.status,
      }, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "R1092 consumer bloodwork control hardening failed."}\n`);
      process.exitCode = 1;
    });
}
