import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1072_TRUE_WEARABLE_VALIDATION_HANDOFF_BUNDLE_SCHEMA_VERSION =
  "murph-age-r1072-true-wearable-validation-handoff-bundle.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1072-true-wearable-validation-handoff-bundle.latest.json";

type ArtifactStatus = "available" | "missing";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

export interface R1072TrueWearableValidationHandoffBundleOptions {
  createdAt?: string;
  outputDir?: string;
  r1059Path?: string;
  r1061Path?: string;
  r1062Path?: string;
  r1068Path?: string;
  r1069Path?: string;
  r1070Path?: string;
  r1071Path?: string;
  r1073Path?: string;
}

export interface R1072TrueWearableValidationHandoffBundleOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1072: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1072: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  handoffPackages: {
    nsrrSleepAutonomicAggregate: {
      currentStatus: string;
      evaluatorId: "nsrr_sleep_autonomic_aggregate_evaluator_v1";
      nextValidationCommand: "MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1070-nsrr-sleep-autonomic-aggregate-receipt.ts";
      preferredReadyCohort: string | null;
      receiptTemplateArtifact: string | null;
      sourceReadinessStatus: string;
      templateReadyForDataFill: boolean;
    };
    partnerIntegratedWearableLabAggregate: {
      currentStatus: string;
      evaluatorId: "partner_integrated_wearable_lab_evaluator_v1";
      nextValidationCommand: "MURPH_AGE_TRUE_WEARABLE_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1059-true-wearable-aggregate-receipt-intake.ts";
      receiptTemplateArtifact: string | null;
      templateReadyForDataFill: boolean;
    };
  };
  inputArtifacts: {
    r1059TrueWearableReceiptIntake: ArtifactSummary;
    r1061TrueWearableDataUnblocker: ArtifactSummary;
    r1062TrueWearableReceiptTemplate: ArtifactSummary;
    r1068TrueWearableSourceActivationMatrix: ArtifactSummary;
    r1069NsrrDerivedRoleActivation: ArtifactSummary;
    r1070NsrrAggregateReceipt: ArtifactSummary;
    r1071NsrrReadinessReducer: ArtifactSummary;
    r1073NsrrCohortReadinessIntake: ArtifactSummary;
  };
  nextAction: {
    actionId:
      | "download_nsrr_derived_files_or_secure_workbench_access"
      | "fill_nsrr_aggregate_receipt"
      | "send_nsrr_delta_to_reviewgpt"
      | "send_true_wearable_delta_to_reviewgpt";
    dataAsk: string;
    reviewGptRequiredNow: boolean;
    why: string;
  };
  packetId: "r1072-true-wearable-validation-handoff-bundle";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1072_TRUE_WEARABLE_VALIDATION_HANDOFF_BUNDLE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "true_wearable_delta_ready_for_reviewgpt"
      | "true_wearable_validation_blocked_on_data"
      | "true_wearable_validation_blocked_on_receipt";
    productDisplayAuthorized: false;
    reviewGptUse: "only_for_real_aggregate_delta_or_major_source_strategy";
    rowParsingPerformedByR1072: false;
  };
}

export async function runR1072TrueWearableValidationHandoffBundle(
  options: R1072TrueWearableValidationHandoffBundleOptions = {},
): Promise<{ output: R1072TrueWearableValidationHandoffBundleOutput; outputPath: string }> {
  const inputs = {
    r1059: await readJsonIfPresent(
      options.r1059Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1059-true-wearable-aggregate-receipt-intake.latest.json"),
    ),
    r1061: await readJsonIfPresent(
      options.r1061Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1061-true-wearable-data-unblocker.latest.json"),
    ),
    r1062: await readJsonIfPresent(
      options.r1062Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1062-true-wearable-aggregate-receipt-template.latest.json"),
    ),
    r1068: await readJsonIfPresent(
      options.r1068Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1068-true-wearable-source-activation-matrix.latest.json"),
    ),
    r1069: await readJsonIfPresent(
      options.r1069Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1069-nsrr-derived-role-activation.latest.json"),
    ),
    r1070: await readJsonIfPresent(
      options.r1070Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1070-nsrr-sleep-autonomic-aggregate-receipt.latest.json"),
    ),
    r1071: await readJsonIfPresent(
      options.r1071Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1071-nsrr-validation-readiness-reducer.latest.json"),
    ),
    r1073: await readJsonIfPresent(
      options.r1073Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1073-nsrr-derived-cohort-readiness-intake.latest.json"),
    ),
  };
  validateInputBoundaries(inputs);

  const nextAction = nextActionFor(inputs);
  const output: R1072TrueWearableValidationHandoffBundleOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    handoffPackages: {
      nsrrSleepAutonomicAggregate: {
        currentStatus: readStringAt(inputs.r1071, ["readiness", "status"]) ?? "missing",
        evaluatorId: "nsrr_sleep_autonomic_aggregate_evaluator_v1",
        nextValidationCommand:
          "MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1070-nsrr-sleep-autonomic-aggregate-receipt.ts",
        preferredReadyCohort: readStringAt(inputs.r1073, ["globalReadiness", "preferredReadyCohort"]),
        receiptTemplateArtifact: readStringAt(inputs.r1071, ["validationPackage", "receiptTemplateArtifact"])
          ?? readStringAt(inputs.r1070, ["receiptTemplateArtifact"]),
        sourceReadinessStatus: readStringAt(inputs.r1073, ["globalReadiness", "status"]) ?? "missing",
        templateReadyForDataFill: readBooleanAt(inputs.r1071, ["validationPackage", "templateReadyForDataFill"])
          || readBooleanAt(inputs.r1070, ["summary", "templateReadyForDataFill"]),
      },
      partnerIntegratedWearableLabAggregate: {
        currentStatus: readStringAt(inputs.r1059, ["summary", "conclusion"]) ?? "missing",
        evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
        nextValidationCommand:
          "MURPH_AGE_TRUE_WEARABLE_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1059-true-wearable-aggregate-receipt-intake.ts",
        receiptTemplateArtifact: readStringAt(inputs.r1062, ["receiptTemplateArtifact"]),
        templateReadyForDataFill: readBooleanAt(inputs.r1062, ["summary", "templateReadyForDataFill"]),
      },
    },
    inputArtifacts: {
      r1059TrueWearableReceiptIntake: summarizeInput("r1059-true-wearable-aggregate-receipt-intake.latest.json", inputs.r1059),
      r1061TrueWearableDataUnblocker: summarizeInput("r1061-true-wearable-data-unblocker.latest.json", inputs.r1061),
      r1062TrueWearableReceiptTemplate: summarizeInput(
        "r1062-true-wearable-aggregate-receipt-template.latest.json",
        inputs.r1062,
      ),
      r1068TrueWearableSourceActivationMatrix: summarizeInput(
        "r1068-true-wearable-source-activation-matrix.latest.json",
        inputs.r1068,
      ),
      r1069NsrrDerivedRoleActivation: summarizeInput("r1069-nsrr-derived-role-activation.latest.json", inputs.r1069),
      r1070NsrrAggregateReceipt: summarizeInput(
        "r1070-nsrr-sleep-autonomic-aggregate-receipt.latest.json",
        inputs.r1070,
      ),
      r1071NsrrReadinessReducer: summarizeInput("r1071-nsrr-validation-readiness-reducer.latest.json", inputs.r1071),
      r1073NsrrCohortReadinessIntake: summarizeInput(
        "r1073-nsrr-derived-cohort-readiness-intake.latest.json",
        inputs.r1073,
      ),
    },
    nextAction,
    packetId: "r1072-true-wearable-validation-handoff-bundle",
    productDisplayAuthorized: false,
    schemaVersion: R1072_TRUE_WEARABLE_VALIDATION_HANDOFF_BUNDLE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: summaryConclusion(nextAction.actionId),
      productDisplayAuthorized: false,
      reviewGptUse: "only_for_real_aggregate_delta_or_major_source_strategy",
      rowParsingPerformedByR1072: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1072 true wearable validation handoff bundle failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function nextActionFor(inputs: {
  r1059: unknown | null;
  r1061: unknown | null;
  r1068: unknown | null;
  r1069: unknown | null;
  r1071: unknown | null;
  r1073: unknown | null;
}): R1072TrueWearableValidationHandoffBundleOutput["nextAction"] {
  const partnerReceiptStatus = readStringAt(inputs.r1059, ["summary", "conclusion"]);
  if (partnerReceiptStatus === "aggregate_receipt_ready_for_reviewgpt") {
    return {
      actionId: "send_true_wearable_delta_to_reviewgpt",
      dataAsk: "No more user download needed for this branch; send the valid true-wearable aggregate delta to ReviewGPT.",
      reviewGptRequiredNow: true,
      why: "The partner/workbench wearable-lab aggregate receipt cleared local intake gates.",
    };
  }

  const nsrrStatus = readStringAt(inputs.r1071, ["readiness", "status"]);
  if (nsrrStatus === "nsrr_delta_ready_for_reviewgpt") {
    return {
      actionId: "send_nsrr_delta_to_reviewgpt",
      dataAsk: "No more NSRR download needed for this branch; send the valid NSRR aggregate delta to ReviewGPT.",
      reviewGptRequiredNow: true,
      why: "The NSRR sleep/autonomic aggregate receipt cleared local scientific gates.",
    };
  }
  if (nsrrStatus === "blocked_fill_nsrr_aggregate_receipt") {
    return {
      actionId: "fill_nsrr_aggregate_receipt",
      dataAsk: "Fill the NSRR aggregate receipt template with suppressed metrics from the local derived NSRR tables.",
      reviewGptRequiredNow: false,
      why: "NSRR role families are present, but the aggregate receipt is still missing.",
    };
  }

  const nsrrCohortReadinessStatus = readStringAt(inputs.r1073, ["globalReadiness", "status"]);
  if (nsrrCohortReadinessStatus === "ready_for_local_materializer_or_aggregate_receipt") {
    const preferredReadyCohort = readStringAt(inputs.r1073, ["globalReadiness", "preferredReadyCohort"]);
    return {
      actionId: "fill_nsrr_aggregate_receipt",
      dataAsk: preferredReadyCohort
        ? `Fill the NSRR aggregate receipt template for the ready ${preferredReadyCohort} cohort.`
        : "Fill the NSRR aggregate receipt template for the ready NSRR cohort.",
      reviewGptRequiredNow: false,
      why: "R1073 detected a cohort with baseline, derived sleep/autonomic, and outcome/follow-up role families; the next step is local aggregate execution or receipt fill, not more ReviewGPT.",
    };
  }

  const nsrrNextAsk = readStringAt(inputs.r1068, ["nextBatch", "nextUserDataAsk"]);
  const publicActivityStatus = readStringAt(inputs.r1061, ["summary", "publicActivityBridgeStatus"]);
  const roleFamilyStatus = readStringAt(inputs.r1069, ["rowExecutionReadiness", "status"]);
  return {
    actionId: "download_nsrr_derived_files_or_secure_workbench_access",
    dataAsk: nsrrNextAsk === "download_nsrr_derived_sleep_cohort_files_or_secure_allofus_workbench_access"
      ? "Download NSRR derived sleep-cohort tables or secure All of Us/UKB workbench access for aggregate evaluation."
      : "Download MESA Sleep / SHHS / HCHS/SOL / MrOS / SOF derived covariate, sleep/autonomic, outcome, and metadata tables.",
    reviewGptRequiredNow: false,
    why: roleFamilyStatus === "blocked_raw_signal_only"
      ? "Only raw signal files are detected; derived tables are the near-term validation path."
      : publicActivityStatus === "wrist_shadow_inconclusive_keep_shadow"
        ? "Public NHANES wrist activity remains shadow-only, so true validation needs a new aggregate source."
        : "The true-wearable validation branch has no valid aggregate receipt yet.",
  };
}

function summaryConclusion(
  actionId: R1072TrueWearableValidationHandoffBundleOutput["nextAction"]["actionId"],
): R1072TrueWearableValidationHandoffBundleOutput["summary"]["conclusion"] {
  if (actionId === "send_true_wearable_delta_to_reviewgpt" || actionId === "send_nsrr_delta_to_reviewgpt") {
    return "true_wearable_delta_ready_for_reviewgpt";
  }
  if (actionId === "fill_nsrr_aggregate_receipt") return "true_wearable_validation_blocked_on_receipt";
  return "true_wearable_validation_blocked_on_data";
}

function safeBoundary(): R1072TrueWearableValidationHandoffBundleOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1072: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1072: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function validateInputBoundaries(inputs: Record<string, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1072 input ${key} failed aggregate-egress validation: ${findings.join("; ")}`);
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function summarizeInput(artifact: string, value: unknown | null): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean {
  const current = readAt(value, pathParts);
  return current === true;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const current = readAt(value, pathParts);
  return typeof current === "string" ? current : null;
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
  const { output } = await runR1072TrueWearableValidationHandoffBundle({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1059Path: process.env.MURPH_AGE_R1059_TRUE_WEARABLE_RECEIPT_INTAKE_PATH,
    r1061Path: process.env.MURPH_AGE_R1061_TRUE_WEARABLE_DATA_UNBLOCKER_PATH,
    r1062Path: process.env.MURPH_AGE_R1062_TRUE_WEARABLE_RECEIPT_TEMPLATE_PATH,
    r1068Path: process.env.MURPH_AGE_R1068_TRUE_WEARABLE_SOURCE_ACTIVATION_PATH,
    r1069Path: process.env.MURPH_AGE_R1069_NSRR_DERIVED_ROLE_ACTIVATION_PATH,
    r1070Path: process.env.MURPH_AGE_R1070_NSRR_AGGREGATE_RECEIPT_PATH,
    r1071Path: process.env.MURPH_AGE_R1071_NSRR_READINESS_REDUCER_PATH,
    r1073Path: process.env.MURPH_AGE_R1073_NSRR_COHORT_READINESS_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    dataAsk: output.nextAction.dataAsk,
    nextAction: output.nextAction.actionId,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.nextAction.reviewGptRequiredNow,
    rowParsingPerformedByR1072: output.artifactBoundary.rowParsingPerformedByR1072,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1072 true wearable validation handoff bundle failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
