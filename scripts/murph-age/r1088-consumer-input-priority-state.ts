import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1088_CONSUMER_INPUT_PRIORITY_STATE_SCHEMA_VERSION =
  "murph-age-r1088-consumer-input-priority-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1088-consumer-input-priority-state.latest.json";

type InputKey = "r1047" | "r1050" | "r1051" | "r1074" | "r1086" | "r1087";
type ConsumerFamilyId =
  | "bloodwork_common_labs"
  | "consumer_wearables_activity_sleep_recovery"
  | "function_disability_supporting_sidecar";
type ReadinessStatus =
  | "blocked_on_true_wearable_aggregate_data"
  | "ready_for_local_aggregate_loop"
  | "score_receipts_available_shadow_mixed"
  | "supportive_but_not_primary_for_16_50";

const INPUTS = {
  r1047: {
    artifact: "r1047-biomarker-evidence-state.latest.json",
    packetId: "r1047-biomarker-evidence-state",
    schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
  },
  r1050: {
    artifact: "r1050-wearable-adjacent-physiology-state.latest.json",
    packetId: "r1050-wearable-adjacent-physiology-state",
    schemaVersion: "murph-age-r1050-wearable-adjacent-physiology-state.v1",
  },
  r1051: {
    artifact: "r1051-partner-wearable-aggregate-evaluator.latest.json",
    packetId: "r1051-partner-wearable-aggregate-evaluator",
    schemaVersion: "murph-age-r1051-partner-wearable-aggregate-evaluator.v1",
  },
  r1074: {
    artifact: "r1074-true-wearable-post-download-refresh.latest.json",
    packetId: "r1074-true-wearable-post-download-refresh",
    schemaVersion: "murph-age-r1074-true-wearable-post-download-refresh.v1",
  },
  r1086: {
    artifact: "r1086-current-model-evidence-state.latest.json",
    packetId: "r1086-current-model-evidence-state",
    schemaVersion: "murph-age-r1086-current-model-evidence-state.v1",
  },
  r1087: {
    artifact: "r1087-downloaded-aging-source-feasibility.latest.json",
    packetId: "r1087-downloaded-aging-source-feasibility",
    schemaVersion: "murph-age-r1087-downloaded-aging-source-feasibility.v1",
  },
} as const;

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ConsumerFamilyPriority {
  familyId: ConsumerFamilyId;
  modelRole:
    | "primary_product_relevance_research_lane"
    | "secondary_context_and_attribution_lane"
    | "supporting_external_transport_evidence";
  nextLocalAction:
    | "continue_lab_transport_and_feature_registry_hardening"
    | "run_or_package_partner_wearable_aggregate_evaluator"
    | "use_as_context_not_next_primary_loop";
  priority: "p0_now" | "p1_next" | "p2_supporting";
  readinessStatus: ReadinessStatus;
  reviewGptUse: "after_meaningful_aggregate_delta" | "not_for_local_plumbing";
  userSubmitFit: "high" | "medium" | "low";
  why: string;
}

export interface R1088ConsumerInputPriorityStateOptions {
  createdAt?: string;
  outputDir?: string;
  r1047Path?: string;
  r1050Path?: string;
  r1051Path?: string;
  r1074Path?: string;
  r1086Path?: string;
  r1087Path?: string;
}

export interface R1088ConsumerInputPriorityStateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1088: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableNamesStored: false;
  };
  consumerInputScope: {
    targetAgeBand: "roughly_16_50";
    targetDataSources: [
      "common_bloodwork_and_vitals",
      "consumer_wearables_activity_sleep_recovery",
      "optional_function_or_mobility_context",
    ];
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1088-consumer-input-priority-state";
  priority: ConsumerFamilyPriority[];
  productDisplayAuthorized: false;
  schemaVersion: typeof R1088_CONSUMER_INPUT_PRIORITY_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "prioritize_labs_and_wearables_for_user_submittable_model";
    nextAutoresearchLoop:
      | "bloodwork_plus_wearable_priority_loop"
      | "repair_missing_lab_wearable_inputs_before_loop";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1088: false;
  };
}

export async function runR1088ConsumerInputPriorityState(
  options: R1088ConsumerInputPriorityStateOptions = {},
): Promise<{ output: R1088ConsumerInputPriorityStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const priority = buildPriority(inputs);
  const hasP0 = priority.some((item) => item.priority === "p0_now");
  const output: R1088ConsumerInputPriorityStateOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1088: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableNamesStored: false,
    },
    consumerInputScope: {
      targetAgeBand: "roughly_16_50",
      targetDataSources: [
        "common_bloodwork_and_vitals",
        "consumer_wearables_activity_sleep_recovery",
        "optional_function_or_mobility_context",
      ],
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1088-consumer-input-priority-state",
    priority,
    productDisplayAuthorized: false,
    schemaVersion: R1088_CONSUMER_INPUT_PRIORITY_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "prioritize_labs_and_wearables_for_user_submittable_model",
      nextAutoresearchLoop: hasP0
        ? "bloodwork_plus_wearable_priority_loop"
        : "repair_missing_lab_wearable_inputs_before_loop",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1088: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1088 consumer input priority state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1088ConsumerInputPriorityStateOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1047: await readJsonIfPresent(options.r1047Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1047.artifact)),
    r1050: await readJsonIfPresent(options.r1050Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1050.artifact)),
    r1051: await readJsonIfPresent(options.r1051Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1051.artifact)),
    r1074: await readJsonIfPresent(options.r1074Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1074.artifact)),
    r1086: await readJsonIfPresent(options.r1086Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1086.artifact)),
    r1087: await readJsonIfPresent(options.r1087Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1087.artifact)),
  };
}

function buildPriority(inputs: Record<InputKey, unknown | null>): ConsumerFamilyPriority[] {
  return [
    bloodworkPriority(inputs.r1047, inputs.r1087),
    wearablePriority(inputs.r1050, inputs.r1051, inputs.r1074),
    functionPriority(inputs.r1086),
  ];
}

function bloodworkPriority(r1047: unknown | null, r1087: unknown | null): ConsumerFamilyPriority {
  const bloodworkLead = readStringAt(r1047, ["summary", "currentBloodworkLead"]);
  const glycemiaStatus = readStringAt(r1047, ["candidateFamilies", "bloodwork", "glucoseHba1c", "status"]);
  const scoreReceiptReady = hasAnyScoreReceiptReady(r1087);
  return {
    familyId: "bloodwork_common_labs",
    modelRole: "primary_product_relevance_research_lane",
    nextLocalAction: "continue_lab_transport_and_feature_registry_hardening",
    priority: bloodworkLead === "glucose_hba1c_research_candidate" || scoreReceiptReady ? "p0_now" : "p1_next",
    readinessStatus: bloodworkLead === "glucose_hba1c_research_candidate"
      ? "score_receipts_available_shadow_mixed"
      : "ready_for_local_aggregate_loop",
    reviewGptUse: "after_meaningful_aggregate_delta",
    userSubmitFit: "high",
    why: glycemiaStatus === "active_research_candidate_mixed_external_support"
      ? "Common labs are highly user-submittable, but current aggregate evidence is mixed and must stay shadow until controls and transport improve."
      : "Common labs and vitals are the most product-relevant source family for users who can upload bloodwork, even while the model remains research-only.",
  };
}

function wearablePriority(
  r1050: unknown | null,
  r1051: unknown | null,
  r1074: unknown | null,
): ConsumerFamilyPriority {
  const trueWearableNextAction = readStringAt(r1074, ["finalHandoff", "nextAction"]);
  const partnerConclusion = readStringAt(r1051, ["reduction", "conclusion"]);
  const adjacentLead = readStringAt(r1050, ["summary", "currentWearableAdjacentLead"]);
  const readyForAggregate = partnerConclusion === "partner_wearable_delta_ready_for_scientific_review"
    || trueWearableNextAction === "send_nsrr_delta_to_reviewgpt"
    || trueWearableNextAction === "send_true_wearable_delta_to_reviewgpt";
  return {
    familyId: "consumer_wearables_activity_sleep_recovery",
    modelRole: "primary_product_relevance_research_lane",
    nextLocalAction: "run_or_package_partner_wearable_aggregate_evaluator",
    priority: "p0_now",
    readinessStatus: readyForAggregate ? "ready_for_local_aggregate_loop" : "blocked_on_true_wearable_aggregate_data",
    reviewGptUse: readyForAggregate ? "after_meaningful_aggregate_delta" : "not_for_local_plumbing",
    userSubmitFit: "high",
    why: adjacentLead === "objective_activity_plus_pulse_shadow"
      ? "Activity, sleep, RHR, and HRV are exactly the kind of user-submittable inputs Murph should support, but current pulse/activity evidence is only wearable-adjacent until true device aggregates arrive."
      : "Consumer wearable inputs should be prioritized for architecture and evaluator readiness even when true outcome-linked wearable data is still blocked.",
  };
}

function functionPriority(r1086: unknown | null): ConsumerFamilyPriority {
  const functionStatus = readStringAt(r1086, ["summary", "functionLeadStatus"])
    ?? readStringAt(r1086, ["functionDisability", "status"]);
  return {
    familyId: "function_disability_supporting_sidecar",
    modelRole: "secondary_context_and_attribution_lane",
    nextLocalAction: "use_as_context_not_next_primary_loop",
    priority: "p2_supporting",
    readinessStatus: functionStatus === "lead_supported_with_missingness_caveat"
      ? "supportive_but_not_primary_for_16_50"
      : "blocked_on_true_wearable_aggregate_data",
    reviewGptUse: "not_for_local_plumbing",
    userSubmitFit: "medium",
    why: "Function/disability is scientifically useful and transport-supportive, but it is less central than labs and wearables for a typical 16-50 Murph user.",
  };
}

function hasAnyScoreReceiptReady(value: unknown | null): boolean {
  const rows = readArrayAt(value, ["downloadedSourceFeasibility", "sourceRows"]);
  return rows.some((row) =>
    readStringAt(row, ["sourceReadyStatus"]) === "ready_for_score_receipt_reuse"
    || readStringAt(row, ["sourceReadyStatus"]) === "ready_for_existing_aggregate_loop"
  );
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1088 rejected unsafe ${key} input: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.keys(INPUTS) as InputKey[]).map((key) => [
      key,
      summarizeInput(INPUTS[key].artifact, inputs[key]),
    ]),
  ) as Record<InputKey, ArtifactSummary>;
}

function summarizeInput(artifact: string, value: unknown | null): ArtifactSummary {
  const root = optionalRecord(value);
  return {
    artifact,
    packetId: readStringAt(root, ["packetId"]),
    schemaVersion: readStringAt(root, ["schemaVersion"]),
    status: root ? "available" : "missing",
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
    if (Array.isArray(current) && /^\d+$/u.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : null;
}

function readArrayAt(value: unknown, pathParts: readonly string[]): unknown[] {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return [];
    current = (current as Record<string, unknown>)[part];
  }
  return Array.isArray(current) ? current : [];
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1088ConsumerInputPriorityState()
    .then(({ output }) => {
      process.stdout.write(`${JSON.stringify({
        conclusion: output.summary.conclusion,
        nextAutoresearchLoop: output.summary.nextAutoresearchLoop,
        packetId: output.packetId,
        priorities: output.priority.map((item) => [item.familyId, item.priority, item.readinessStatus]),
        productDisplayAuthorized: output.productDisplayAuthorized,
        rowParsingPerformedByR1088: output.summary.rowParsingPerformedByR1088,
        schemaVersion: output.schemaVersion,
        status: output.status,
      }, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "R1088 consumer input priority state failed."}\n`);
      process.exitCode = 1;
    });
}
