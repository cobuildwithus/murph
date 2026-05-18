import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1091_CONSUMER_INPUT_LOOP_STATE_SCHEMA_VERSION =
  "murph-age-r1091-consumer-input-loop-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1091-consumer-input-loop-state.latest.json";

const INPUTS = {
  r1047: {
    artifact: "r1047-biomarker-evidence-state.latest.json",
    packetId: "r1047-biomarker-evidence-state",
    schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
  },
  r1049: {
    artifact: "r1049-nhanes-activity-sensitivity-control.latest.json",
    packetId: "r1049-nhanes-activity-sensitivity-control",
    schemaVersion: "murph-age-r1049-nhanes-activity-sensitivity-control.v1",
  },
  r1050: {
    artifact: "r1050-wearable-adjacent-physiology-state.latest.json",
    packetId: "r1050-wearable-adjacent-physiology-state",
    schemaVersion: "murph-age-r1050-wearable-adjacent-physiology-state.v1",
  },
  r1060: {
    artifact: "r1060-local-true-wearable-source-inventory.latest.json",
    packetId: "r1060-local-true-wearable-source-inventory",
    schemaVersion: "murph-age-r1060-local-true-wearable-source-inventory.v1",
  },
  r1061: {
    artifact: "r1061-true-wearable-data-unblocker.latest.json",
    packetId: "r1061-true-wearable-data-unblocker",
    schemaVersion: "murph-age-r1061-true-wearable-data-unblocker.v1",
  },
  r1089: {
    artifact: "r1089-labs-wearables-candidate-batch-manifest.latest.json",
    packetId: "r1089-labs-wearables-candidate-batch-manifest",
    schemaVersion: "murph-age-r1089-labs-wearables-candidate-batch-manifest.v1",
  },
  r1090: {
    artifact: "r1090-consumer-feature-registry-state.latest.json",
    packetId: "r1090-consumer-feature-registry-state",
    schemaVersion: "murph-age-r1090-consumer-feature-registry-state.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type LabStatus =
  | "blocked_missing_consumer_registry"
  | "mixed_shadow_ready_for_control_hardening";
type WearableStatus =
  | "blocked_missing_consumer_registry"
  | "blocked_until_true_wearable_outcome_aggregate";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface EvidenceReference {
  evidenceId: string;
  interpretation: string;
  status: "available" | "missing";
}

export interface R1091ConsumerInputLoopStateOptions {
  createdAt?: string;
  outputDir?: string;
  r1047Path?: string;
  r1049Path?: string;
  r1050Path?: string;
  r1060Path?: string;
  r1061Path?: string;
  r1089Path?: string;
  r1090Path?: string;
}

export interface R1091ConsumerInputLoopStateOutput {
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
    rowParsingPerformedByR1091: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  consumerInputLoop: {
    bloodwork: {
      queuedFamilies: string[];
      reviewGptUse: "after_clean_control_hardened_delta";
      status: LabStatus;
      supportingEvidence: EvidenceReference[];
    };
    blockedProductBehaviors: [
      "user_facing_biological_age_display",
      "recommendations_or_protocol_claims",
      "wearable_score_promotion_without_true_outcome_link",
    ];
    functionMobilityRole: "supporting_context_not_primary_for_16_50";
    targetAgeBand: "roughly_16_50";
    wearables: {
      blockedFamilies: string[];
      reviewGptUse: "after_true_wearable_outcome_aggregate_receipt";
      shadowEvidence: EvidenceReference[];
      status: WearableStatus;
    };
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1091-consumer-input-loop-state";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1091_CONSUMER_INPUT_LOOP_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "consumer_input_loop_ready_for_bloodwork_control_hardening_wearables_blocked"
      | "consumer_input_loop_blocked_missing_registry";
    nextLocalAction:
      | "repair_consumer_feature_registry"
      | "run_bloodwork_control_hardening_keep_wearable_receipt_open";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1091: false;
  };
}

export async function runR1091ConsumerInputLoopState(
  options: R1091ConsumerInputLoopStateOptions = {},
): Promise<{ output: R1091ConsumerInputLoopStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const queuedFamilies = readStringArrayAt(inputs.r1090, ["summary", "currentExecutableShadowFamilies"]);
  const blockedFamilies = readStringArrayAt(inputs.r1090, ["summary", "trueWearableFamiliesBlocked"]);
  const registryReady = queuedFamilies.length > 0 && blockedFamilies.length > 0;
  const output: R1091ConsumerInputLoopStateOutput = {
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
      rowParsingPerformedByR1091: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    consumerInputLoop: {
      bloodwork: {
        queuedFamilies,
        reviewGptUse: "after_clean_control_hardened_delta",
        status: registryReady
          ? "mixed_shadow_ready_for_control_hardening"
          : "blocked_missing_consumer_registry",
        supportingEvidence: bloodworkEvidence(inputs),
      },
      blockedProductBehaviors: [
        "user_facing_biological_age_display",
        "recommendations_or_protocol_claims",
        "wearable_score_promotion_without_true_outcome_link",
      ],
      functionMobilityRole: "supporting_context_not_primary_for_16_50",
      targetAgeBand: "roughly_16_50",
      wearables: {
        blockedFamilies,
        reviewGptUse: "after_true_wearable_outcome_aggregate_receipt",
        shadowEvidence: wearableEvidence(inputs),
        status: registryReady
          ? "blocked_until_true_wearable_outcome_aggregate"
          : "blocked_missing_consumer_registry",
      },
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1091-consumer-input-loop-state",
    productDisplayAuthorized: false,
    schemaVersion: R1091_CONSUMER_INPUT_LOOP_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: registryReady
        ? "consumer_input_loop_ready_for_bloodwork_control_hardening_wearables_blocked"
        : "consumer_input_loop_blocked_missing_registry",
      nextLocalAction: registryReady
        ? "run_bloodwork_control_hardening_keep_wearable_receipt_open"
        : "repair_consumer_feature_registry",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1091: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1091 consumer input loop state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1091ConsumerInputLoopStateOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1047: await readJsonIfPresent(options.r1047Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1047.artifact)),
    r1049: await readJsonIfPresent(options.r1049Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1049.artifact)),
    r1050: await readJsonIfPresent(options.r1050Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1050.artifact)),
    r1060: await readJsonIfPresent(options.r1060Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1060.artifact)),
    r1061: await readJsonIfPresent(options.r1061Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1061.artifact)),
    r1089: await readJsonIfPresent(options.r1089Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1089.artifact)),
    r1090: await readJsonIfPresent(options.r1090Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1090.artifact)),
  };
}

function bloodworkEvidence(inputs: Record<InputKey, unknown | null>): EvidenceReference[] {
  return [
    {
      evidenceId: "r1047_glucose_hba1c_research_candidate",
      interpretation: readStringAt(inputs.r1047, ["summary", "currentBloodworkLead"])
        === "glucose_hba1c_research_candidate"
        ? "active_mixed_external_support"
        : "not_current_lead",
      status: inputs.r1047 ? "available" : "missing",
    },
    {
      evidenceId: "r1089_labs_wearables_batch",
      interpretation: readStringAt(inputs.r1089, ["summary", "conclusion"]) === "labs_wearables_batch_ready"
        ? "common_labs_queued_for_shadow_loop"
        : "batch_not_ready",
      status: inputs.r1089 ? "available" : "missing",
    },
  ];
}

function wearableEvidence(inputs: Record<InputKey, unknown | null>): EvidenceReference[] {
  return [
    {
      evidenceId: "r1049_nhanes_activity_shadow",
      interpretation: readStringAt(inputs.r1049, ["summary", "conclusion"])
        === "activity_signal_control_clean_global_calibration_limited"
        ? "objective_activity_shadow_control_clean_but_calibration_limited"
        : "shadow_not_confirmed",
      status: inputs.r1049 ? "available" : "missing",
    },
    {
      evidenceId: "r1050_pulse_rhr_shadow",
      interpretation: readStringAt(inputs.r1050, ["decision", "conclusion"])
        === "pulse_rhr_shadow_signal_mixed_control_limited"
        ? "wearable_adjacent_control_limited"
        : "shadow_not_confirmed",
      status: inputs.r1050 ? "available" : "missing",
    },
    {
      evidenceId: "r1060_local_wearable_inventory",
      interpretation: readStringAt(inputs.r1060, ["summary", "conclusion"])
        === "possible_local_wearable_files_need_outcome_join"
        ? "possible_local_exports_without_outcome_join"
        : "no_true_wearable_source_ready",
      status: inputs.r1060 ? "available" : "missing",
    },
    {
      evidenceId: "r1061_true_wearable_unblocker",
      interpretation: readStringAt(inputs.r1061, ["currentBlocker", "conclusion"]) === "true_wearable_receipt_missing"
        ? "true_wearable_outcome_aggregate_receipt_missing"
        : "receipt_state_changed_needs_review",
      status: inputs.r1061 ? "available" : "missing",
    },
  ];
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1091 rejected unsafe ${key} input: ${findings.join("; ")}`);
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

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return [];
    current = (current as Record<string, unknown>)[part];
  }
  return Array.isArray(current)
    ? current.filter((item): item is string => typeof item === "string")
    : [];
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1091ConsumerInputLoopState()
    .then(({ output }) => {
      process.stdout.write(`${JSON.stringify({
        bloodworkStatus: output.consumerInputLoop.bloodwork.status,
        conclusion: output.summary.conclusion,
        nextLocalAction: output.summary.nextLocalAction,
        packetId: output.packetId,
        productDisplayAuthorized: output.productDisplayAuthorized,
        rowParsingPerformedByR1091: output.summary.rowParsingPerformedByR1091,
        schemaVersion: output.schemaVersion,
        status: output.status,
        wearableStatus: output.consumerInputLoop.wearables.status,
      }, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "R1091 consumer input loop state failed."}\n`);
      process.exitCode = 1;
    });
}
