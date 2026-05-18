import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1117_CONSUMER_MODEL_LOOP_READINESS_REDUCER_SCHEMA_VERSION =
  "murph-age-r1117-consumer-model-loop-readiness-reducer.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1117-consumer-model-loop-readiness-reducer.latest.json";

const INPUTS = {
  r1047: {
    artifact: "r1047-biomarker-evidence-state.latest.json",
    packetId: "r1047-biomarker-evidence-state",
    schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
  },
  r1086: {
    artifact: "r1086-current-model-evidence-state.latest.json",
    packetId: "r1086-current-model-evidence-state",
    schemaVersion: "murph-age-r1086-current-model-evidence-state.v1",
  },
  r1103: {
    artifact: "r1103-consumer-candidate-family-manifest.latest.json",
    packetId: "r1103-consumer-candidate-family-manifest",
    schemaVersion: "murph-age-r1103-consumer-candidate-family-manifest.v1",
  },
  r1112: {
    artifact: "r1112-consumer-data-priority-router.latest.json",
    packetId: "r1112-consumer-data-priority-router",
    schemaVersion: "murph-age-r1112-consumer-data-priority-router.v1",
  },
  r1115: {
    artifact: "r1115-local-private-header-mapping-intake.latest.json",
    packetId: "r1115-local-private-header-mapping-intake",
    schemaVersion: "murph-age-r1115-local-private-header-mapping-intake.v1",
  },
  r1116: {
    artifact: "r1116-local-private-header-mapping-template.latest.json",
    packetId: "r1116-local-private-header-mapping-template",
    schemaVersion: "murph-age-r1116-local-private-header-mapping-template.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type Conclusion =
  | "consumer_model_loop_ready_for_external_or_private_mapping_receipt"
  | "consumer_model_loop_ready_for_r1104_validated_science_review"
  | "consumer_model_loop_waiting_on_consumer_artifact_refresh"
  | "local_private_mapping_ready_for_receipt_build";
type NextAction =
  | "build_local_aggregate_receipt_from_private_mapping_then_run_r1104"
  | "fill_private_mapping_template_or_run_all_of_us_cardia_receipt"
  | "refresh_r1047_r1086_r1103_r1112_r1115_r1116"
  | "send_r1104_valid_delta_to_reviewgpt";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface QueueItem {
  candidateId:
    | "I1_integrated_lab_wearable_small_panel"
    | "L1_tiny_glycemia_only"
    | "L2_common_lab_core_shadow"
    | "W1_activity_steps_minutes"
    | "W2_sleep_duration_regularity"
    | "W3_rhr_hrv_recovery";
  executionStatus:
    | "blocked_until_component_passes"
    | "blocked_until_outcome_linked_wearable_receipt"
    | "external_or_private_aggregate_receipt_next"
    | "ready_after_private_mapping_receipt_builder";
  priority: 1 | 2 | 3 | 4 | 5 | 6;
  reason: string;
  userSubmitFit: "high";
}

export interface R1117ConsumerModelLoopReadinessReducerOptions {
  createdAt?: string;
  outputDir?: string;
  r1047Path?: string;
  r1086Path?: string;
  r1103Path?: string;
  r1112Path?: string;
  r1115Path?: string;
  r1116Path?: string;
}

export interface R1117ConsumerModelLoopReadinessReducerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1117: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1117: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  loopReadiness: {
    bloodworkLeadStatus: "glucose_hba1c_shadow_mixed_transport" | "not_ready";
    candidateQueue: QueueItem[];
    consumerTarget: {
      primaryAgeBand: "roughly_16_50";
      priorityInputFamilies: [
        "bloodwork_common_labs",
        "vitals_body_composition",
        "wearable_activity",
        "wearable_sleep",
        "wearable_recovery",
      ];
    };
    currentBlocker:
      | "consumer_outcome_linked_aggregate_receipt_missing"
      | "consumer_prerequisites_missing_or_stale"
      | "local_private_mapping_ready_but_receipt_not_built"
      | "validated_science_delta_ready";
    localPrivateMapping: {
      status:
        | "mapping_not_provided_template_ready"
        | "mapping_ready_for_receipt_build"
        | "template_missing_or_mapping_stale";
      templateArtifact: "r1116-fillable-private-header-mapping-template.json" | null;
    };
    reviewGptUse: "only_after_r1104_valid_science_delta_or_high_level_direction_conflict";
    wearableStatus: "blocked_until_outcome_linked_receipt";
  };
  packetId: "r1117-consumer-model-loop-readiness-reducer";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1117_CONSUMER_MODEL_LOOP_READINESS_REDUCER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: Conclusion;
    nextAction: NextAction;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1117: false;
    topPriority: "consumer_labs_vitals_wearables_outcome_linked_model_loop";
  };
}

export async function runR1117ConsumerModelLoopReadinessReducer(
  options: R1117ConsumerModelLoopReadinessReducerOptions = {},
): Promise<{ output: R1117ConsumerModelLoopReadinessReducerOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const identitiesReady = (Object.keys(INPUTS) as InputKey[]).every((key) => inputMatchesExpected(key, inputs[key]));
  const r1112Conclusion = readStringAt(inputs.r1112, ["summary", "conclusion"]);
  const r1115Conclusion = readStringAt(inputs.r1115, ["summary", "conclusion"]);
  const r1103Ready = readStringAt(inputs.r1103, ["summary", "conclusion"]) === "consumer_candidate_family_manifest_ready";
  const r1116Ready = readStringAt(inputs.r1116, ["summary", "conclusion"]) === "local_private_header_mapping_template_ready";
  const bloodworkLead = readStringAt(inputs.r1047, ["summary", "currentBloodworkLead"]) === "glucose_hba1c_research_candidate"
    && readStringAt(inputs.r1086, ["summary", "glycemiaStatus"]) === "shadow_mixed_transport";
  const conclusion = conclusionFor({
    identitiesReady,
    r1103Ready,
    r1112Conclusion,
    r1115Conclusion,
    r1116Ready,
  });
  const blocker = blockerFor(conclusion);

  const output: R1117ConsumerModelLoopReadinessReducerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    loopReadiness: {
      bloodworkLeadStatus: bloodworkLead ? "glucose_hba1c_shadow_mixed_transport" : "not_ready",
      candidateQueue: candidateQueue({
        mappingReady: conclusion === "local_private_mapping_ready_for_receipt_build",
      }),
      consumerTarget: {
        primaryAgeBand: "roughly_16_50",
        priorityInputFamilies: [
          "bloodwork_common_labs",
          "vitals_body_composition",
          "wearable_activity",
          "wearable_sleep",
          "wearable_recovery",
        ],
      },
      currentBlocker: blocker,
      localPrivateMapping: {
        status: localPrivateMappingStatus(r1115Conclusion, r1116Ready),
        templateArtifact: r1116Ready ? "r1116-fillable-private-header-mapping-template.json" : null,
      },
      reviewGptUse: "only_after_r1104_valid_science_delta_or_high_level_direction_conflict",
      wearableStatus: "blocked_until_outcome_linked_receipt",
    },
    packetId: "r1117-consumer-model-loop-readiness-reducer",
    productDisplayAuthorized: false,
    schemaVersion: R1117_CONSUMER_MODEL_LOOP_READINESS_REDUCER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextAction: nextActionFor(conclusion),
      productDisplayAuthorized: false,
      reviewGptRequiredNow: conclusion === "consumer_model_loop_ready_for_r1104_validated_science_review",
      rowParsingPerformedByR1117: false,
      topPriority: "consumer_labs_vitals_wearables_outcome_linked_model_loop",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1117 consumer model loop readiness reducer failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  identitiesReady: boolean;
  r1103Ready: boolean;
  r1112Conclusion: string | null;
  r1115Conclusion: string | null;
  r1116Ready: boolean;
}): Conclusion {
  if (!input.identitiesReady || !input.r1103Ready) {
    return "consumer_model_loop_waiting_on_consumer_artifact_refresh";
  }
  if (input.r1112Conclusion === "consumer_aggregate_receipt_ready_for_science_review") {
    return "consumer_model_loop_ready_for_r1104_validated_science_review";
  }
  if (input.r1115Conclusion === "local_private_header_mapping_ready_for_local_aggregate_receipt") {
    return "local_private_mapping_ready_for_receipt_build";
  }
  if (
    input.r1112Conclusion === "consumer_lab_wearable_loop_blocked_on_outcome_linked_aggregate_receipt"
    && input.r1116Ready
  ) {
    return "consumer_model_loop_ready_for_external_or_private_mapping_receipt";
  }
  return "consumer_model_loop_waiting_on_consumer_artifact_refresh";
}

function blockerFor(conclusion: Conclusion): R1117ConsumerModelLoopReadinessReducerOutput["loopReadiness"]["currentBlocker"] {
  if (conclusion === "consumer_model_loop_ready_for_r1104_validated_science_review") {
    return "validated_science_delta_ready";
  }
  if (conclusion === "local_private_mapping_ready_for_receipt_build") {
    return "local_private_mapping_ready_but_receipt_not_built";
  }
  if (conclusion === "consumer_model_loop_ready_for_external_or_private_mapping_receipt") {
    return "consumer_outcome_linked_aggregate_receipt_missing";
  }
  return "consumer_prerequisites_missing_or_stale";
}

function nextActionFor(conclusion: Conclusion): NextAction {
  if (conclusion === "consumer_model_loop_ready_for_r1104_validated_science_review") {
    return "send_r1104_valid_delta_to_reviewgpt";
  }
  if (conclusion === "local_private_mapping_ready_for_receipt_build") {
    return "build_local_aggregate_receipt_from_private_mapping_then_run_r1104";
  }
  if (conclusion === "consumer_model_loop_ready_for_external_or_private_mapping_receipt") {
    return "fill_private_mapping_template_or_run_all_of_us_cardia_receipt";
  }
  return "refresh_r1047_r1086_r1103_r1112_r1115_r1116";
}

function localPrivateMappingStatus(
  r1115Conclusion: string | null,
  r1116Ready: boolean,
): R1117ConsumerModelLoopReadinessReducerOutput["loopReadiness"]["localPrivateMapping"]["status"] {
  if (r1115Conclusion === "local_private_header_mapping_ready_for_local_aggregate_receipt") {
    return "mapping_ready_for_receipt_build";
  }
  if (r1115Conclusion === "local_private_header_mapping_not_provided" && r1116Ready) {
    return "mapping_not_provided_template_ready";
  }
  return "template_missing_or_mapping_stale";
}

function candidateQueue(input: { mappingReady: boolean }): QueueItem[] {
  const labStatus = input.mappingReady
    ? "ready_after_private_mapping_receipt_builder"
    : "external_or_private_aggregate_receipt_next";
  return [
    {
      candidateId: "L1_tiny_glycemia_only",
      executionStatus: labStatus,
      priority: 1,
      reason: "Smallest consumer bloodwork candidate; current external evidence is mixed but active as a shadow lead.",
      userSubmitFit: "high",
    },
    {
      candidateId: "L2_common_lab_core_shadow",
      executionStatus: labStatus,
      priority: 2,
      reason: "Common lab plus vitals/body candidate should test incremental value over glycemia without adding uncommon assays.",
      userSubmitFit: "high",
    },
    {
      candidateId: "W1_activity_steps_minutes",
      executionStatus: "blocked_until_outcome_linked_wearable_receipt",
      priority: 3,
      reason: "Activity is highly consumer-submit fit, but needs outcome-linked coverage and missingness controls before scoring.",
      userSubmitFit: "high",
    },
    {
      candidateId: "W2_sleep_duration_regularity",
      executionStatus: "blocked_until_outcome_linked_wearable_receipt",
      priority: 4,
      reason: "Sleep is high-fit consumer wearable data, but must beat sleep coverage and missingness controls.",
      userSubmitFit: "high",
    },
    {
      candidateId: "W3_rhr_hrv_recovery",
      executionStatus: "blocked_until_outcome_linked_wearable_receipt",
      priority: 5,
      reason: "Recovery physiology is promising but device and training-state artifacts must be controlled.",
      userSubmitFit: "high",
    },
    {
      candidateId: "I1_integrated_lab_wearable_small_panel",
      executionStatus: "blocked_until_component_passes",
      priority: 6,
      reason: "Integrated lab plus wearable panel should wait until at least one lab and one wearable component pass separately.",
      userSubmitFit: "high",
    },
  ];
}

async function readInputs(options: R1117ConsumerModelLoopReadinessReducerOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1047: await readJsonIfPresent(options.r1047Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1047.artifact)),
    r1086: await readJsonIfPresent(options.r1086Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1086.artifact)),
    r1103: await readJsonIfPresent(options.r1103Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1103.artifact)),
    r1112: await readJsonIfPresent(options.r1112Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1112.artifact)),
    r1115: await readJsonIfPresent(options.r1115Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1115.artifact)),
    r1116: await readJsonIfPresent(options.r1116Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1116.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1117 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.entries(INPUTS) as Array<[InputKey, typeof INPUTS[InputKey]]>).map(([key, expected]) => {
      const input = inputs[key];
      const packetId = readStringAt(input, ["packetId"]);
      const schemaVersion = readStringAt(input, ["schemaVersion"]);
      return [key, {
        artifact: expected.artifact,
        packetId: packetId === expected.packetId ? expected.packetId : null,
        schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
        status: input ? "available" : "missing",
      }];
    }),
  ) as Record<InputKey, ArtifactSummary>;
}

function inputMatchesExpected(key: InputKey, input: unknown | null): boolean {
  const expected = INPUTS[key];
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
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
  let current = value;
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

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1117ConsumerModelLoopReadinessReducerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1117: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1117: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1117ConsumerModelLoopReadinessReducer({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1047Path: process.env.MURPH_AGE_R1047_BIOMARKER_EVIDENCE_PATH,
    r1086Path: process.env.MURPH_AGE_R1086_MODEL_EVIDENCE_PATH,
    r1103Path: process.env.MURPH_AGE_R1103_CONSUMER_CANDIDATE_PATH,
    r1112Path: process.env.MURPH_AGE_R1112_CONSUMER_DATA_PRIORITY_PATH,
    r1115Path: process.env.MURPH_AGE_R1115_LOCAL_PRIVATE_MAPPING_INTAKE_PATH,
    r1116Path: process.env.MURPH_AGE_R1116_LOCAL_PRIVATE_MAPPING_TEMPLATE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    bloodworkLeadStatus: output.loopReadiness.bloodworkLeadStatus,
    conclusion: output.summary.conclusion,
    currentBlocker: output.loopReadiness.currentBlocker,
    localPrivateMappingStatus: output.loopReadiness.localPrivateMapping.status,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1117: output.summary.rowParsingPerformedByR1117,
    schemaVersion: output.schemaVersion,
    status: output.status,
    topCandidate: output.loopReadiness.candidateQueue[0]?.candidateId ?? null,
    wearableStatus: output.loopReadiness.wearableStatus,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1117 consumer model loop readiness reducer failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
