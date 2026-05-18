import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1062TrueWearableAggregateReceiptTemplate } from "./r1062-true-wearable-aggregate-receipt-template.ts";

export const R1097_CONSUMER_LAB_WEARABLE_AGGREGATE_TEMPLATE_SCHEMA_VERSION =
  "murph-age-r1097-consumer-lab-wearable-aggregate-template.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1097-consumer-lab-wearable-aggregate-template.latest.json";

const INPUTS = {
  r1090: {
    artifact: "r1090-consumer-feature-registry-state.latest.json",
    packetId: "r1090-consumer-feature-registry-state",
    schemaVersion: "murph-age-r1090-consumer-feature-registry-state.v1",
  },
  r1093: {
    artifact: "r1093-consumer-lab-shadow-candidate-selector.latest.json",
    packetId: "r1093-consumer-lab-shadow-candidate-selector",
    schemaVersion: "murph-age-r1093-consumer-lab-shadow-candidate-selector.v1",
  },
  r1096: {
    artifact: "r1096-consumer-validation-route-priority.latest.json",
    packetId: "r1096-consumer-validation-route-priority",
    schemaVersion: "murph-age-r1096-consumer-validation-route-priority.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;

type CandidateRowId =
  | "C0_age_sex"
  | "C1_source_clinical_base"
  | "C2a_common_labs_only"
  | "C2b_vitals_body_only"
  | "C2c_common_labs_plus_vitals_body"
  | "C2_lab5_or_lab9_bp_body"
  | "C3_wearable_activity_sleep_rhr_hrv_only"
  | "C3_lab_bp_body_plus_activity_28d"
  | "C4_lab_bp_body_plus_activity_sleep_28d"
  | "C5_lab_bp_body_plus_activity_sleep_rhr"
  | "C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated"
  | "C7_wearable_coverage_quality_only_negative_control"
  | "C8_shuffled_wearable_negative_control";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface CandidateGuideRow {
  candidateId: CandidateRowId;
  consumerFeatureFamilies: string[];
  interpretation: string;
  modelRole: "negative_control" | "reference" | "research_candidate";
}

export interface R1097ConsumerLabWearableAggregateTemplateOptions {
  createdAt?: string;
  outputDir?: string;
  r1090Path?: string;
  r1093Path?: string;
  r1096Path?: string;
}

export interface R1097ConsumerLabWearableAggregateTemplateOutput {
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
    rowParsingPerformedByR1097: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1097-consumer-lab-wearable-aggregate-template";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1097_CONSUMER_LAB_WEARABLE_AGGREGATE_TEMPLATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  templateBundle: {
    ageDomainPolicy: {
      requiredEvidenceSubbands: ["16_17", "18_39", "40_50"];
      targetAgeBand: "roughly_16_50";
      userFacingAgeDisplayAuthorized: false;
      validationNeed: "direct_or_all_age_common_lab_wearable_outcome_aggregate";
    };
    baseReceiptTemplateArtifact: "r1062-fillable-aggregate-receipt-template.json" | null;
    candidateGuide: CandidateGuideRow[];
    nextIntakeCommand: "MURPH_AGE_TRUE_WEARABLE_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1059-true-wearable-aggregate-receipt-intake.ts";
    requiredControls: [
      "same_denominator_comparisons",
      "calibration_and_subgroup_calibration",
      "device_provider_or_measurement_method_calibration",
      "wearable_coverage_quality_negative_control",
      "shuffled_wearable_negative_control",
      "small_cell_suppression",
      "source_release_and_governance_status",
      "feature_window_timing_status",
      "confidence_interval_status",
    ];
    targetRoutes: string[];
  };
  summary: {
    conclusion:
      | "consumer_lab_wearable_template_ready_for_data_holder_fill"
      | "consumer_lab_wearable_template_blocked_missing_route_or_candidate";
    nextLocalAction:
      | "await_true_consumer_lab_wearable_aggregate_receipt_or_workbench_run"
      | "repair_consumer_route_priority_before_template";
    productDisplayAuthorized: false;
    reviewGptUse: "only_after_valid_scientific_delta_or_high_level_direction_change";
    rowParsingPerformedByR1097: false;
    templateReadyForDataFill: boolean;
  };
}

export async function runR1097ConsumerLabWearableAggregateTemplate(
  options: R1097ConsumerLabWearableAggregateTemplateOptions = {},
): Promise<{ output: R1097ConsumerLabWearableAggregateTemplateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const routeReady = readStringAt(inputs.r1096, ["summary", "conclusion"])
    === "consumer_lab_wearable_validation_routes_ranked";
  const candidateReady = readStringAt(inputs.r1093, ["selection", "candidateId"])
    === "common_lab_core_shadow";
  const templateReady = routeReady && candidateReady;
  const generatedTemplate = templateReady
    ? await runR1062TrueWearableAggregateReceiptTemplate({
      createdAt: options.createdAt,
      outputDir: options.outputDir ?? DEFAULT_MODEL_RUNS_DIR,
    })
    : null;

  const output: R1097ConsumerLabWearableAggregateTemplateOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1097-consumer-lab-wearable-aggregate-template",
    productDisplayAuthorized: false,
    schemaVersion: R1097_CONSUMER_LAB_WEARABLE_AGGREGATE_TEMPLATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: templateReady
        ? "consumer_lab_wearable_template_ready_for_data_holder_fill"
        : "consumer_lab_wearable_template_blocked_missing_route_or_candidate",
      nextLocalAction: templateReady
        ? "await_true_consumer_lab_wearable_aggregate_receipt_or_workbench_run"
        : "repair_consumer_route_priority_before_template",
      productDisplayAuthorized: false,
      reviewGptUse: "only_after_valid_scientific_delta_or_high_level_direction_change",
      rowParsingPerformedByR1097: false,
      templateReadyForDataFill: templateReady,
    },
    templateBundle: {
      ageDomainPolicy: {
        requiredEvidenceSubbands: ["16_17", "18_39", "40_50"],
        targetAgeBand: "roughly_16_50",
        userFacingAgeDisplayAuthorized: false,
        validationNeed: "direct_or_all_age_common_lab_wearable_outcome_aggregate",
      },
      baseReceiptTemplateArtifact: generatedTemplate?.output.receiptTemplateArtifact ?? null,
      candidateGuide: candidateGuide(),
      nextIntakeCommand:
        "MURPH_AGE_TRUE_WEARABLE_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1059-true-wearable-aggregate-receipt-intake.ts",
      requiredControls: [
        "same_denominator_comparisons",
        "calibration_and_subgroup_calibration",
        "device_provider_or_measurement_method_calibration",
        "wearable_coverage_quality_negative_control",
        "shuffled_wearable_negative_control",
        "small_cell_suppression",
        "source_release_and_governance_status",
        "feature_window_timing_status",
        "confidence_interval_status",
      ],
      targetRoutes: readRouteIds(inputs.r1096).slice(0, 5),
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1097 consumer lab/wearable aggregate template failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function candidateGuide(): CandidateGuideRow[] {
  return [
    {
      candidateId: "C0_age_sex",
      consumerFeatureFamilies: ["age", "sex"],
      interpretation: "Reference only; not a biological-age product model.",
      modelRole: "reference",
    },
    {
      candidateId: "C1_source_clinical_base",
      consumerFeatureFamilies: ["source_supported_clinical_context"],
      interpretation: "Source-local reference context so lab and wearable deltas are not compared against a weak baseline.",
      modelRole: "reference",
    },
    {
      candidateId: "C2a_common_labs_only",
      consumerFeatureFamilies: [
        "glycemia_hba1c_glucose",
        "lipids_triglycerides_cholesterol",
        "cbc_or_basic_chemistry_context",
      ],
      interpretation: "Lab-only block for isolating bloodwork signal before vitals or wearables are added.",
      modelRole: "research_candidate",
    },
    {
      candidateId: "C2b_vitals_body_only",
      consumerFeatureFamilies: ["blood_pressure_vitals", "body_composition"],
      interpretation: "Vitals/body-only block for isolating device or manual vitals from lab signal.",
      modelRole: "research_candidate",
    },
    {
      candidateId: "C2c_common_labs_plus_vitals_body",
      consumerFeatureFamilies: [
        "glycemia_hba1c_glucose",
        "lipids_triglycerides_cholesterol",
        "blood_pressure_vitals",
        "body_composition",
        "cbc_or_basic_chemistry_context",
      ],
      interpretation: "Primary common labs plus vitals/body block for consumer-submittable bloodwork and measurements.",
      modelRole: "research_candidate",
    },
    {
      candidateId: "C2_lab5_or_lab9_bp_body",
      consumerFeatureFamilies: [
        "glycemia_hba1c_glucose",
        "lipids_triglycerides_cholesterol",
        "blood_pressure_vitals",
        "body_composition",
        "cbc_or_basic_chemistry_context",
      ],
      interpretation: "Current common_lab_core_shadow candidate for normal bloodwork and basic vitals.",
      modelRole: "research_candidate",
    },
    {
      candidateId: "C3_wearable_activity_sleep_rhr_hrv_only",
      consumerFeatureFamilies: [
        "activity_steps_minutes",
        "sleep_duration_regularity",
        "resting_hr_recovery",
        "wearable_hrv_quality_gated",
      ],
      interpretation: "Wearable-only block for separating wearable signal from common labs and vitals.",
      modelRole: "research_candidate",
    },
    {
      candidateId: "C3_lab_bp_body_plus_activity_28d",
      consumerFeatureFamilies: ["common_lab_core_shadow", "activity_steps_minutes"],
      interpretation: "Tests whether steps or active minutes add stable signal beyond common labs and vitals.",
      modelRole: "research_candidate",
    },
    {
      candidateId: "C4_lab_bp_body_plus_activity_sleep_28d",
      consumerFeatureFamilies: ["common_lab_core_shadow", "activity_steps_minutes", "sleep_duration_regularity"],
      interpretation: "Tests sleep and activity as a combined wearable increment beyond labs and vitals.",
      modelRole: "research_candidate",
    },
    {
      candidateId: "C5_lab_bp_body_plus_activity_sleep_rhr",
      consumerFeatureFamilies: ["common_lab_core_shadow", "activity_steps_minutes", "sleep_duration_regularity", "resting_hr_recovery"],
      interpretation: "Tests whether resting heart rate or recovery-like physiology adds stable signal.",
      modelRole: "research_candidate",
    },
    {
      candidateId: "C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated",
      consumerFeatureFamilies: [
        "common_lab_core_shadow",
        "activity_steps_minutes",
        "sleep_duration_regularity",
        "resting_hr_recovery",
        "wearable_hrv_quality_gated",
      ],
      interpretation: "Most complete consumer wearable increment; should only survive if coverage and calibration controls are clean.",
      modelRole: "research_candidate",
    },
    {
      candidateId: "C7_wearable_coverage_quality_only_negative_control",
      consumerFeatureFamilies: ["missingness_coverage_quality"],
      interpretation: "Negative control for whether device coverage, missingness, or engagement explains the apparent wearable signal.",
      modelRole: "negative_control",
    },
    {
      candidateId: "C8_shuffled_wearable_negative_control",
      consumerFeatureFamilies: ["shuffled_wearable_features"],
      interpretation: "Negative control for spurious wearable improvement.",
      modelRole: "negative_control",
    },
  ];
}

function readRouteIds(value: unknown | null): string[] {
  const routes = readArrayAt(value, ["routePriorities"]);
  return routes
    .map((route) => readStringAt(route, ["routeId"]))
    .filter((routeId): routeId is string => routeId !== null);
}

async function readInputs(options: R1097ConsumerLabWearableAggregateTemplateOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1090: await readJsonIfPresent(options.r1090Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1090.artifact)),
    r1093: await readJsonIfPresent(options.r1093Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1093.artifact)),
    r1096: await readJsonIfPresent(options.r1096Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1096.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1097 rejected unsafe ${key} input: ${findings.join("; ")}`);
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

function safeBoundary() {
  return {
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
    rowParsingPerformedByR1097: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  } as const;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readArrayAt(value: unknown, pathParts: readonly string[]): unknown[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function main(): Promise<void> {
  const { output } = await runR1097ConsumerLabWearableAggregateTemplate({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptUse: output.summary.reviewGptUse,
    routeTargets: output.templateBundle.targetRoutes,
    rowParsingPerformedByR1097: output.summary.rowParsingPerformedByR1097,
    schemaVersion: output.schemaVersion,
    status: output.status,
    templateReadyForDataFill: output.summary.templateReadyForDataFill,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1097 consumer lab/wearable aggregate template failed."}\n`);
    process.exitCode = 1;
  });
}
