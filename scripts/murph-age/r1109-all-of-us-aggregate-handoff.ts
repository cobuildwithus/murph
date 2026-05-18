import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1109_ALL_OF_US_AGGREGATE_HANDOFF_SCHEMA_VERSION =
  "murph-age-r1109-all-of-us-aggregate-handoff.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1109-all-of-us-aggregate-handoff.latest.json";

const INPUTS = {
  r1105: {
    artifact: "r1105-consumer-aggregate-receipt-template.latest.json",
    packetId: "r1105-consumer-aggregate-receipt-template",
    schemaVersion: "murph-age-r1105-consumer-aggregate-receipt-template.v1",
  },
  r1108: {
    artifact: "r1108-consumer-source-endpoint-router.latest.json",
    packetId: "r1108-consumer-source-endpoint-router",
    schemaVersion: "murph-age-r1108-consumer-source-endpoint-router.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface EndpointFamily {
  endpointFamilyId:
    | "E1_incident_cardiometabolic_disease"
    | "E2_risk_factor_progression"
    | "E3_hospitalization_or_acute_event"
    | "E4_all_cause_mortality_secondary";
  priority: number;
  role: "primary" | "secondary" | "sensitivity";
  why: string;
}

interface FeatureBlock {
  blockId:
    | "F1_common_labs"
    | "F2_vitals_body"
    | "F3_activity"
    | "F4_sleep"
    | "F5_resting_hr_recovery"
    | "F6_missingness_coverage";
  candidateIds: string[];
  scoreBearingCondition: string;
}

interface CandidateRun {
  candidateId: string;
  comparatorId: string;
  runOrder: number;
  runPolicy: "run_first" | "run_after_lab_receipt" | "run_only_if_outcome_linked_wearable_coverage_exists" | "negative_control_required";
}

export interface R1109AllOfUsAggregateHandoffOptions {
  createdAt?: string;
  outputDir?: string;
  r1105Path?: string;
  r1108Path?: string;
}

export interface R1109AllOfUsAggregateHandoffOutput {
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
    rowParsingPerformedByR1109: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1109-all-of-us-aggregate-handoff";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1109_ALL_OF_US_AGGREGATE_HANDOFF_SCHEMA_VERSION;
  sourceHandoff: {
    candidateRunOrder: CandidateRun[];
    endpointFamilies: EndpointFamily[];
    featureBlocks: FeatureBlock[];
    primarySourceRoute: "all_of_us_workbench_aggregate";
    requiredAggregateReceiptSchema: "murph-age-consumer-lab-wearable-aggregate-receipt.v1" | null;
    requiredEvaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1" | null;
    requiredReceiptTemplateArtifact: "r1105-fillable-consumer-aggregate-receipt-template.json" | null;
    runEnvironment: "source_workbench_or_equivalent_row_owning_environment";
    validationCommand: "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts";
  };
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "all_of_us_aggregate_handoff_ready"
      | "all_of_us_aggregate_handoff_waiting_on_router_or_template";
    nextAction:
      | "run_or_request_all_of_us_aggregate_receipt"
      | "regenerate_r1105_r1108_before_handoff";
    productDisplayAuthorized: false;
    reviewGptRequiredBeforeReceipt: false;
    reviewGptUseAfterReceipt: "only_if_r1104_routes_valid_delta_to_reviewgpt";
    rowParsingPerformedByR1109: false;
  };
}

export async function runR1109AllOfUsAggregateHandoff(
  options: R1109AllOfUsAggregateHandoffOptions = {},
): Promise<{ output: R1109AllOfUsAggregateHandoffOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const templateReady = readBooleanAt(inputs.r1105, ["summary", "templateReadyForDataFill"]) === true;
  const routerReady = readStringAt(inputs.r1108, ["summary", "conclusion"]) === "route_all_of_us_or_cardia_aggregate_first";
  const allOfUsFirst = readStringAt(inputs.r1108, ["sourceRoutes", "0", "routeKey"]) === "all_of_us_workbench_aggregate";
  const ready = templateReady && routerReady && allOfUsFirst;
  const output: R1109AllOfUsAggregateHandoffOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1109-all-of-us-aggregate-handoff",
    productDisplayAuthorized: false,
    schemaVersion: R1109_ALL_OF_US_AGGREGATE_HANDOFF_SCHEMA_VERSION,
    sourceHandoff: {
      candidateRunOrder: candidateRunOrder(),
      endpointFamilies: endpointFamilies(),
      featureBlocks: featureBlocks(),
      primarySourceRoute: "all_of_us_workbench_aggregate",
      requiredAggregateReceiptSchema: readStringAt(inputs.r1105, ["fillableReceiptTemplate", "schemaVersion"]) === "murph-age-consumer-lab-wearable-aggregate-receipt.v1"
        ? "murph-age-consumer-lab-wearable-aggregate-receipt.v1"
        : null,
      requiredEvaluatorId: readStringAt(inputs.r1105, ["fillableReceiptTemplate", "evaluatorId"]) === "consumer_lab_wearable_aggregate_evaluator_v1"
        ? "consumer_lab_wearable_aggregate_evaluator_v1"
        : null,
      requiredReceiptTemplateArtifact: readStringAt(inputs.r1105, ["receiptTemplateArtifact"]) === "r1105-fillable-consumer-aggregate-receipt-template.json"
        ? "r1105-fillable-consumer-aggregate-receipt-template.json"
        : null,
      runEnvironment: "source_workbench_or_equivalent_row_owning_environment",
      validationCommand:
        "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts",
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "all_of_us_aggregate_handoff_ready"
        : "all_of_us_aggregate_handoff_waiting_on_router_or_template",
      nextAction: ready
        ? "run_or_request_all_of_us_aggregate_receipt"
        : "regenerate_r1105_r1108_before_handoff",
      productDisplayAuthorized: false,
      reviewGptRequiredBeforeReceipt: false,
      reviewGptUseAfterReceipt: "only_if_r1104_routes_valid_delta_to_reviewgpt",
      rowParsingPerformedByR1109: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1109 All of Us aggregate handoff failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function endpointFamilies(): EndpointFamily[] {
  return [
    {
      endpointFamilyId: "E1_incident_cardiometabolic_disease",
      priority: 1,
      role: "primary",
      why: "Ages 16-50 are underpowered for mortality-only modeling, so first validation should use earlier outcome-linked cardiometabolic endpoints.",
    },
    {
      endpointFamilyId: "E2_risk_factor_progression",
      priority: 2,
      role: "secondary",
      why: "Progression endpoints can test whether ordinary labs, vitals, and wearables predict worsening health before hard events accrue.",
    },
    {
      endpointFamilyId: "E3_hospitalization_or_acute_event",
      priority: 3,
      role: "sensitivity",
      why: "Acute utilization outcomes stress-test calibration but may reflect access-to-care artifacts.",
    },
    {
      endpointFamilyId: "E4_all_cause_mortality_secondary",
      priority: 4,
      role: "secondary",
      why: "Mortality remains the cleanest long-horizon endpoint, but only when event counts are powered enough for the target age band.",
    },
  ];
}

function featureBlocks(): FeatureBlock[] {
  return [
    {
      blockId: "F1_common_labs",
      candidateIds: ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"],
      scoreBearingCondition: "aggregate proper-score improvement, non-worse calibration, and consumer-viable coverage",
    },
    {
      blockId: "F2_vitals_body",
      candidateIds: ["L2_common_lab_core_shadow"],
      scoreBearingCondition: "must improve beyond the tiny lab candidate without becoming a body-only shortcut",
    },
    {
      blockId: "F3_activity",
      candidateIds: ["W1_activity_steps_minutes"],
      scoreBearingCondition: "requires outcome-linked wearable coverage and must beat missingness and coverage controls",
    },
    {
      blockId: "F4_sleep",
      candidateIds: ["W2_sleep_duration_regularity"],
      scoreBearingCondition: "requires enough valid nights and must beat missingness and coverage controls",
    },
    {
      blockId: "F5_resting_hr_recovery",
      candidateIds: ["W3_rhr_hrv_recovery"],
      scoreBearingCondition: "requires source/device coverage audit and must not be a device-adherence artifact",
    },
    {
      blockId: "F6_missingness_coverage",
      candidateIds: ["QC_missingness_coverage"],
      scoreBearingCondition: "negative control only; if it wins, wearable candidates remain blocked",
    },
  ];
}

function candidateRunOrder(): CandidateRun[] {
  return [
    {
      candidateId: "L1_tiny_glycemia_only",
      comparatorId: "frozen_recalibrated_r399",
      runOrder: 1,
      runPolicy: "run_first",
    },
    {
      candidateId: "L2_common_lab_core_shadow",
      comparatorId: "l1_tiny_glycemia_only",
      runOrder: 2,
      runPolicy: "run_after_lab_receipt",
    },
    {
      candidateId: "QC_missingness_coverage",
      comparatorId: "frozen_recalibrated_r399",
      runOrder: 3,
      runPolicy: "negative_control_required",
    },
    {
      candidateId: "W1_activity_steps_minutes",
      comparatorId: "frozen_recalibrated_r399",
      runOrder: 4,
      runPolicy: "run_only_if_outcome_linked_wearable_coverage_exists",
    },
    {
      candidateId: "W2_sleep_duration_regularity",
      comparatorId: "frozen_recalibrated_r399",
      runOrder: 5,
      runPolicy: "run_only_if_outcome_linked_wearable_coverage_exists",
    },
    {
      candidateId: "W3_rhr_hrv_recovery",
      comparatorId: "frozen_recalibrated_r399",
      runOrder: 6,
      runPolicy: "run_only_if_outcome_linked_wearable_coverage_exists",
    },
    {
      candidateId: "I1_integrated_lab_wearable_small_panel",
      comparatorId: "best_validated_single_family",
      runOrder: 7,
      runPolicy: "run_only_if_outcome_linked_wearable_coverage_exists",
    },
  ];
}

async function readInputs(options: R1109AllOfUsAggregateHandoffOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1105: await readJsonIfPresent(options.r1105Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1105.artifact)),
    r1108: await readJsonIfPresent(options.r1108Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1108.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1109 rejected unsafe ${key} input: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.entries(INPUTS) as Array<[InputKey, typeof INPUTS[InputKey]]>).map(([key, expected]) => {
      const input = inputs[key];
      return [key, {
        artifact: expected.artifact,
        packetId: readStringAt(input, ["packetId"]),
        schemaVersion: readStringAt(input, ["schemaVersion"]),
        status: input ? "available" : "missing",
      }];
    }),
  ) as Record<InputKey, ArtifactSummary>;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return null;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object" || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function safeBoundary(): R1109AllOfUsAggregateHandoffOutput["artifactBoundary"] {
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
    rowParsingPerformedByR1109: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1109AllOfUsAggregateHandoff({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1105Path: process.env.MURPH_AGE_R1105_CONSUMER_AGGREGATE_TEMPLATE_PATH,
    r1108Path: process.env.MURPH_AGE_R1108_CONSUMER_SOURCE_ROUTER_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    endpointFamilyCount: output.sourceHandoff.endpointFamilies.length,
    featureBlockCount: output.sourceHandoff.featureBlocks.length,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    primarySourceRoute: output.sourceHandoff.primarySourceRoute,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredBeforeReceipt: output.summary.reviewGptRequiredBeforeReceipt,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1109 All of Us aggregate handoff failed."}\n`);
    process.exitCode = 1;
  });
}
