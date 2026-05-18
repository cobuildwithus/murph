import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1061_TRUE_WEARABLE_DATA_UNBLOCKER_SCHEMA_VERSION =
  "murph-age-r1061-true-wearable-data-unblocker.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1061-true-wearable-data-unblocker.latest.json";

const DEFAULT_R1038_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1038-nhanes-modern-lab-activity-loop.latest.json");
const DEFAULT_R1058_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1058-true-wearable-partner-validation-readiness.latest.json");
const DEFAULT_R1059_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1059-true-wearable-aggregate-receipt-intake.latest.json");
const DEFAULT_R1060_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1060-local-true-wearable-source-inventory.latest.json");
const DEFAULT_R1067_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1067-nhanes-wrist-final-stress-test.latest.json");

type SourceRoute =
  | "controlled_workbench_aggregate"
  | "ingestion_schema_only"
  | "local_data_holder_aggregate"
  | "partner_aggregate_validation"
  | "public_objective_activity_sidecar";

interface InputArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface DataAcquisitionPriority {
  directLocalDownload: boolean;
  priority: 1 | 2 | 3 | 4 | 5;
  route: SourceRoute;
  sourceId:
    | "all_of_us_fitbit_labs_ehr_workbench"
    | "nhanes_2011_2014_wrist_activity_labs_mortality_sidecar"
    | "nsrr_sleep_autonomic_outcome_cohorts"
    | "personal_wearable_exports_with_no_outcome"
    | "uk_biobank_accelerometry_labs_outcomes";
  unlocks: string;
  why: string;
}

export interface R1061TrueWearableDataUnblockerOptions {
  createdAt?: string;
  outputDir?: string;
  r1038Path?: string;
  r1058Path?: string;
  r1059Path?: string;
  r1060Path?: string;
  r1067Path?: string;
}

export interface R1061TrueWearableDataUnblockerOutput {
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
    rowParsingPerformedByR1061: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  currentBlocker: {
    conclusion:
      | "nhanes_bridge_missing_repair_before_data_ask"
      | "true_wearable_receipt_missing"
      | "true_wearable_receipt_ready_for_reviewgpt";
    localDownloadsNeed: "no_more_public_activity_downloads_needed_for_current_bridge" | "repair_nhanes_bridge_first";
    nextLocalAction:
      | "await_or_collect_true_wearable_aggregate_receipt"
      | "repair_nhanes_public_bridge"
      | "send_existing_true_wearable_delta_to_reviewgpt";
    reviewGptRequiredBeforeNextLocalRun: boolean;
  };
  dataAcquisitionPriority: DataAcquisitionPriority[];
  inputArtifacts: {
    r1038NhanesActivity: InputArtifactSummary;
    r1058Readiness: InputArtifactSummary;
    r1059ReceiptIntake: InputArtifactSummary;
    r1060LocalInventory: InputArtifactSummary;
    r1067WristFinalStress: InputArtifactSummary;
  };
  minimumReceiptShape: {
    candidateMetricFields: readonly string[];
    evaluatorId: "partner_integrated_wearable_lab_evaluator_v1";
    requiredAttestations: readonly string[];
    requiredCandidateIds: readonly string[];
    supportedEndpoints: readonly string[];
  };
  packetId: "r1061-true-wearable-data-unblocker";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1061_TRUE_WEARABLE_DATA_UNBLOCKER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    bestUserDataAsk: "controlled_workbench_or_local_data_holder_aggregate_receipt";
    publicActivityBridgeStatus:
      | "missing"
      | "refreshed_shadow_supported_calibration_limited"
      | "refreshed_shadow_unsupported"
      | "wrist_shadow_inconclusive_keep_shadow";
    productDisplayAuthorized: false;
    reviewGptUse: "only_after_true_wearable_aggregate_delta";
    trueWearableReceiptStatus: "missing" | "ready_for_reviewgpt" | "valid_but_no_delta";
  };
}

export async function runR1061TrueWearableDataUnblocker(
  options: R1061TrueWearableDataUnblockerOptions = {},
): Promise<{ output: R1061TrueWearableDataUnblockerOutput; outputPath: string }> {
  const inputs = {
    r1038NhanesActivity: await readJsonIfPresent(options.r1038Path ?? DEFAULT_R1038_PATH),
    r1058Readiness: await readJsonIfPresent(options.r1058Path ?? DEFAULT_R1058_PATH),
    r1059ReceiptIntake: await readJsonIfPresent(options.r1059Path ?? DEFAULT_R1059_PATH),
    r1060LocalInventory: await readJsonIfPresent(options.r1060Path ?? DEFAULT_R1060_PATH),
    r1067WristFinalStress: await readJsonIfPresent(options.r1067Path ?? DEFAULT_R1067_PATH),
  };
  validateInputBoundaries(inputs);

  const publicActivityStatus = summarizePublicActivityBridge(inputs.r1067WristFinalStress, inputs.r1038NhanesActivity);
  const receiptStatus = summarizeReceiptStatus(inputs.r1059ReceiptIntake);
  const currentBlocker = decideBlocker(publicActivityStatus, receiptStatus);
  const output: R1061TrueWearableDataUnblockerOutput = {
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
      rowParsingPerformedByR1061: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    currentBlocker,
    dataAcquisitionPriority: dataAcquisitionPriority(),
    inputArtifacts: summarizeInputs(inputs),
    minimumReceiptShape: minimumReceiptShape(inputs.r1058Readiness),
    packetId: "r1061-true-wearable-data-unblocker",
    productDisplayAuthorized: false,
    schemaVersion: R1061_TRUE_WEARABLE_DATA_UNBLOCKER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      bestUserDataAsk: "controlled_workbench_or_local_data_holder_aggregate_receipt",
      publicActivityBridgeStatus: publicActivityStatus,
      productDisplayAuthorized: false,
      reviewGptUse: "only_after_true_wearable_aggregate_delta",
      trueWearableReceiptStatus: receiptStatus,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1061 true wearable data unblocker failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizePublicActivityBridge(
  r1067WristFinalStress: unknown | null,
  r1038NhanesActivity: unknown | null,
): R1061TrueWearableDataUnblockerOutput["summary"]["publicActivityBridgeStatus"] {
  const wristConclusion = readStringAt(r1067WristFinalStress, ["summary", "conclusion"]);
  if (
    wristConclusion === "activity_wear_signal_unstable_keep_shadow"
    || wristConclusion === "activity_wear_signal_persistent_but_non_specific_keep_shadow"
  ) {
    return "wrist_shadow_inconclusive_keep_shadow";
  }

  const conclusion = readStringAt(r1038NhanesActivity, ["summary", "conclusion"]);
  if (!conclusion) return "missing";
  if (conclusion === "activity_signal_shadow_hold_for_calibration_or_external_validation") {
    return "refreshed_shadow_supported_calibration_limited";
  }
  return "refreshed_shadow_unsupported";
}

function summarizeReceiptStatus(value: unknown | null): R1061TrueWearableDataUnblockerOutput["summary"]["trueWearableReceiptStatus"] {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  if (conclusion === "aggregate_receipt_ready_for_reviewgpt") return "ready_for_reviewgpt";
  if (conclusion === "aggregate_receipt_valid_but_no_delta") return "valid_but_no_delta";
  return "missing";
}

function decideBlocker(
  publicActivityStatus: R1061TrueWearableDataUnblockerOutput["summary"]["publicActivityBridgeStatus"],
  receiptStatus: R1061TrueWearableDataUnblockerOutput["summary"]["trueWearableReceiptStatus"],
): R1061TrueWearableDataUnblockerOutput["currentBlocker"] {
  if (receiptStatus === "ready_for_reviewgpt") {
    return {
      conclusion: "true_wearable_receipt_ready_for_reviewgpt",
      localDownloadsNeed: publicActivityStatus === "missing"
        ? "repair_nhanes_bridge_first"
        : "no_more_public_activity_downloads_needed_for_current_bridge",
      nextLocalAction: "send_existing_true_wearable_delta_to_reviewgpt",
      reviewGptRequiredBeforeNextLocalRun: true,
    };
  }
  if (publicActivityStatus === "missing") {
    return {
      conclusion: "nhanes_bridge_missing_repair_before_data_ask",
      localDownloadsNeed: "repair_nhanes_bridge_first",
      nextLocalAction: "repair_nhanes_public_bridge",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  return {
    conclusion: "true_wearable_receipt_missing",
    localDownloadsNeed: "no_more_public_activity_downloads_needed_for_current_bridge",
    nextLocalAction: "await_or_collect_true_wearable_aggregate_receipt",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function dataAcquisitionPriority(): DataAcquisitionPriority[] {
  return [
    {
      directLocalDownload: false,
      priority: 1,
      route: "controlled_workbench_aggregate",
      sourceId: "all_of_us_fitbit_labs_ehr_workbench",
      unlocks: "Best near-term true consumer wearable plus labs plus outcome aggregate receipt.",
      why: "Fitbit activity, heart rate, sleep, EHR labs, physical measures, and clinical event labels can be evaluated on the same denominator inside a controlled workbench.",
    },
    {
      directLocalDownload: false,
      priority: 2,
      route: "controlled_workbench_aggregate",
      sourceId: "uk_biobank_accelerometry_labs_outcomes",
      unlocks: "Large external integrated accelerometry, labs, mortality, and event validation.",
      why: "High power for accelerometry and outcomes, but access is administrative rather than a simple local download.",
    },
    {
      directLocalDownload: false,
      priority: 3,
      route: "partner_aggregate_validation",
      sourceId: "nsrr_sleep_autonomic_outcome_cohorts",
      unlocks: "Sleep and autonomic physiology validation for sleep/RHR-style modules.",
      why: "Sleep cohorts can stress the sleep/recovery/autonomic layer with outcome heads, but source terms and endpoint joins must be handled by the data holder.",
    },
    {
      directLocalDownload: false,
      priority: 4,
      route: "public_objective_activity_sidecar",
      sourceId: "nhanes_2011_2014_wrist_activity_labs_mortality_sidecar",
      unlocks: "Already-run public same-family wrist objective-activity sidecar, not true consumer wearable validation.",
      why: "The final wrist stress test keeps this lane shadow-only, so it should not consume the next data-download effort unless a regression replay is needed.",
    },
    {
      directLocalDownload: true,
      priority: 5,
      route: "ingestion_schema_only",
      sourceId: "personal_wearable_exports_with_no_outcome",
      unlocks: "Feature registry and ingestion coverage only unless paired with outcomes.",
      why: "Apple Health, Fitbit, Oura, Whoop, Garmin, or similar exports help schema work but do not train or validate the age model without outcome labels.",
    },
  ];
}

function minimumReceiptShape(value: unknown | null): R1061TrueWearableDataUnblockerOutput["minimumReceiptShape"] {
  const requiredCandidateIds = readCandidateIds(value);
  return {
    candidateMetricFields: [
      "candidateId",
      "comparatorId",
      "role",
      "aucDelta",
      "brierDelta",
      "logLossDelta",
      "calibrationSlope",
      "eOverO",
      "negativeControlStatus",
      "subgroupCalibrationStatus",
      "deviceProviderCalibrationStatus",
    ],
    evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
    requiredAttestations: [
      "aggregateOnly",
      "endpointFrozenBeforeScoring",
      "evaluatorFrozenBeforeExecution",
      "sameDenominatorComparisons",
      "validDayNightCoverageReported",
      "deviceProviderCoverageReported",
      "noRowEgress",
      "noParticipantEgress",
      "noPredictionEgress",
      "noCoefficientEgress",
      "noSmallCellEgress",
    ],
    requiredCandidateIds,
    supportedEndpoints: [
      "all_cause_mortality",
      "major_cardiovascular_event",
      "hospitalization_or_emergency_utilization",
      "incident_cardiometabolic_disease",
      "frailty_disability_or_functional_decline_auxiliary_head",
    ],
  };
}

function readCandidateIds(value: unknown | null): string[] {
  const candidates = readArrayAt(value, ["handoffPackage", "candidateFamilies"]);
  const ids = candidates
    .map((candidate) => readStringAt(candidate, ["candidateId"]))
    .filter((candidateId): candidateId is string => candidateId !== null);
  return ids.length > 0
    ? ids
    : [
      "C0_age_sex",
      "C1_source_clinical_base",
      "C2_lab5_or_lab9_bp_body",
      "C3_lab_bp_body_plus_activity_28d",
      "C4_lab_bp_body_plus_activity_sleep_28d",
      "C5_lab_bp_body_plus_activity_sleep_rhr",
      "C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated",
      "C7_wearable_coverage_quality_only_negative_control",
      "C8_shuffled_wearable_negative_control",
    ];
}

function summarizeInputs(inputs: {
  r1038NhanesActivity: unknown | null;
  r1058Readiness: unknown | null;
  r1059ReceiptIntake: unknown | null;
  r1060LocalInventory: unknown | null;
  r1067WristFinalStress: unknown | null;
}): R1061TrueWearableDataUnblockerOutput["inputArtifacts"] {
  return {
    r1038NhanesActivity: inputSummary("r1038-nhanes-modern-lab-activity-loop.latest.json", inputs.r1038NhanesActivity),
    r1058Readiness: inputSummary("r1058-true-wearable-partner-validation-readiness.latest.json", inputs.r1058Readiness),
    r1059ReceiptIntake: inputSummary("r1059-true-wearable-aggregate-receipt-intake.latest.json", inputs.r1059ReceiptIntake),
    r1060LocalInventory: inputSummary("r1060-local-true-wearable-source-inventory.latest.json", inputs.r1060LocalInventory),
    r1067WristFinalStress: inputSummary("r1067-nhanes-wrist-final-stress-test.latest.json", inputs.r1067WristFinalStress),
  };
}

function inputSummary(artifact: string, value: unknown | null): InputArtifactSummary {
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
  } catch {
    return null;
  }
}

function validateInputBoundaries(inputs: Record<string, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1061 input ${key} failed aggregate-egress validation: ${findings.join("; ")}`);
    }
  }
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const current = readAt(value, pathParts);
  return typeof current === "string" ? current : null;
}

function readArrayAt(value: unknown, pathParts: readonly string[]): unknown[] {
  const current = readAt(value, pathParts);
  return Array.isArray(current) ? current : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function main(): Promise<void> {
  const { output } = await runR1061TrueWearableDataUnblocker({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1038Path: process.env.MURPH_AGE_R1038_NHANES_ACTIVITY_PATH,
    r1058Path: process.env.MURPH_AGE_R1058_TRUE_WEARABLE_READINESS_PATH,
    r1059Path: process.env.MURPH_AGE_R1059_TRUE_WEARABLE_RECEIPT_INTAKE_PATH,
    r1060Path: process.env.MURPH_AGE_R1060_LOCAL_SOURCE_INVENTORY_PATH,
    r1067Path: process.env.MURPH_AGE_R1067_WRIST_FINAL_STRESS_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    bestUserDataAsk: output.summary.bestUserDataAsk,
    conclusion: output.currentBlocker.conclusion,
    localDownloadsNeed: output.currentBlocker.localDownloadsNeed,
    nextLocalAction: output.currentBlocker.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredBeforeNextLocalRun: output.currentBlocker.reviewGptRequiredBeforeNextLocalRun,
    schemaVersion: output.schemaVersion,
    status: output.status,
    publicActivityBridgeStatus: output.summary.publicActivityBridgeStatus,
    trueWearableReceiptStatus: output.summary.trueWearableReceiptStatus,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1061 true wearable data unblocker failed."}\n`);
    process.exitCode = 1;
  });
}
