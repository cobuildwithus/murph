import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1121_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONTRACT_SCHEMA_VERSION =
  "murph-age-r1121-local-private-consumer-receipt-runner-contract.v1" as const;

const PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION =
  "murph-age-local-private-consumer-receipt-runner-config.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1121-local-private-consumer-receipt-runner-contract.latest.json";
const PRIVATE_RUNNER_CONFIG_TEMPLATE_FILE_NAME =
  "r1121-fillable-local-private-consumer-receipt-runner-config.json";
const R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts" as const;
const ACCEPTED_PRIVATE_TABLE_LAYOUTS = [
  "single_primary_table_fallback",
  "multi_table_or_explicit_refs",
] as const;

const INPUTS = {
  r1103: {
    artifact: "r1103-consumer-candidate-family-manifest.latest.json",
    packetId: "r1103-consumer-candidate-family-manifest",
    schemaVersion: "murph-age-r1103-consumer-candidate-family-manifest.v1",
  },
  r1106: {
    artifact: "r1106-consumer-aggregate-handoff-bundle.latest.json",
    packetId: "r1106-consumer-aggregate-handoff-bundle",
    schemaVersion: "murph-age-r1106-consumer-aggregate-handoff-bundle.v1",
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
  r1113: {
    artifact: "r1113-consumer-source-execution-packet.latest.json",
    packetId: "r1113-consumer-source-execution-packet",
    schemaVersion: "murph-age-r1113-consumer-source-execution-packet.v1",
  },
  r1120: {
    artifact: "r1120-consumer-lab-vitals-shadow-arbitration.latest.json",
    packetId: "r1120-consumer-lab-vitals-shadow-arbitration",
    schemaVersion: "murph-age-r1120-consumer-lab-vitals-shadow-arbitration.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type CandidateId =
  | "I1_integrated_lab_wearable_small_panel"
  | "L1_tiny_glycemia_only"
  | "L2_common_lab_core_shadow"
  | "QC_missingness_coverage"
  | "W1_activity_steps_minutes"
  | "W2_sleep_duration_regularity"
  | "W3_rhr_hrv_recovery";
type SemanticCategory =
  | "commonLabCore"
  | "dateOrTimeKey"
  | "labGlycemia"
  | "outcomeEvent"
  | "personJoinKey"
  | "vitalsBody"
  | "wearableActivity"
  | "wearableRecovery"
  | "wearableSleep";
type AcceptedPrivateTableLayout = typeof ACCEPTED_PRIVATE_TABLE_LAYOUTS[number];

interface SubmissionContext {
  evidenceRole: "real_first_pass_evidence";
  ordinaryConsumerSubmission: true;
  outcomeLinked: true;
  priorityInputFamilies: [
    "bloodwork_labs",
    "vitals_body_context",
    "wearable_activity",
  ];
  targetAgeBand: "roughly_16_50";
}

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface CandidateRun {
  candidateId: CandidateId;
  inputFamilies: SemanticCategory[];
  requiredBeforeScoreBearing: string[];
  runOrder: number;
  runPhase:
    | "first_pass"
    | "deferred_until_components_pass"
    | "deferred_until_first_pass_receipt";
  runPolicy:
    | "first_score_bearing_if_outcome_linked"
    | "negative_control_required"
    | "secondary_comparator_not_lead"
    | "score_only_after_lab_and_wearable_components_pass"
    | "score_only_if_outcome_linked_wearable_coverage_exists";
}

interface FillableLocalPrivateConsumerReceiptRunnerConfig {
  acceptedPrivateTableLayouts: AcceptedPrivateTableLayout[];
  aggregateReceiptTarget: {
    evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1";
    localPrivateFirstPassRunnerCommand: typeof R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_COMMAND;
    schemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1";
    validationCommand: "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts";
  };
  attestations: {
    localOnly: true;
    noCoefficientEgress: true;
    noHeaderNameEgress: true;
    noParticipantEgress: true;
    noPredictionEgress: true;
    noRowEgress: true;
    noSmallCellEgress: true;
    noSourceTextEgress: true;
  };
  candidateRunOrder: CandidateRun[];
  deferredCandidateIds: CandidateId[];
  firstPassCandidateIds: CandidateId[];
  privateFieldRefs: Record<SemanticCategory, string>;
  privateTableRefs: {
    labTableRef: string;
    outcomeTableRef: string;
    primaryTableRef: string;
    wearableTableRef: string;
  };
  schemaVersion: typeof PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION;
  singlePrimaryTableFallback: {
    accepted: true;
    minimumTableRef: "primaryTableRef";
  };
  submissionContext: SubmissionContext;
}

export interface R1121LocalPrivateConsumerReceiptRunnerContractOptions {
  createdAt?: string;
  outputDir?: string;
  r1103Path?: string;
  r1106Path?: string;
  r1115Path?: string;
  r1116Path?: string;
  r1113Path?: string;
  r1120Path?: string;
}

export interface R1121LocalPrivateConsumerReceiptRunnerContractOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1121: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1121: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  localPrivateRunner: {
    blockedEgress: [
      "participant_identifiers",
      "row_values",
      "split_membership",
      "participant_level_predictions",
      "coefficients",
      "model_parameters",
      "source_bodies_or_codebook_text",
      "header_names",
      "file_names",
      "local_paths",
      "small_cells",
      "product_claims",
    ];
    candidateRunOrder: CandidateRun[];
    configSchemaVersion: typeof PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION;
    deferredCandidateIds: CandidateId[];
    firstPassCandidateIds: CandidateId[];
    acceptedPrivateTableLayouts: AcceptedPrivateTableLayout[];
    privateConfigTemplateArtifact: typeof PRIVATE_RUNNER_CONFIG_TEMPLATE_FILE_NAME;
    privateConfigValuesStored: false;
    localPrivateFirstPassRunnerCommand: typeof R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_COMMAND;
    publicOutputAllowlist: [
      "aggregate_metric_deltas",
      "coverage_status",
      "calibration_status",
      "missingness_or_coverage_control_status",
      "evidence_support_band",
      "gate_verdicts",
      "attestations",
    ];
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
    validationCommand: typeof R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_COMMAND;
  };
  packetId: "r1121-local-private-consumer-receipt-runner-contract";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1121_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONTRACT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "local_private_consumer_receipt_runner_contract_ready_awaiting_mapping"
      | "local_private_consumer_receipt_runner_contract_ready_for_execution"
      | "local_private_consumer_receipt_runner_contract_waiting_on_inputs";
    nextAction:
      | "fill_private_mapping_and_runner_config_for_l1_l2_w1"
      | "refresh_consumer_manifest_handoff_mapping_and_arbitration"
      | "run_local_private_l1_l2_wearable_first_pass_to_aggregate_receipt";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1121: false;
    firstPassCandidateIds: CandidateId[];
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
    topCandidate: "L1_tiny_glycemia_only";
  };
}

export async function runR1121LocalPrivateConsumerReceiptRunnerContract(
  options: R1121LocalPrivateConsumerReceiptRunnerContractOptions = {},
): Promise<{
  output: R1121LocalPrivateConsumerReceiptRunnerContractOutput;
  outputPath: string;
  privateRunnerConfigTemplatePath: string;
}> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const firstPassCandidateIds = firstPassCandidateIdsFor(inputs.r1113);
  const deferredCandidateIds = deferredCandidateIdsFor(inputs.r1113, firstPassCandidateIds);
  const candidateRunOrder = createCandidateRunOrder({
    deferredCandidateIds,
    firstPassCandidateIds,
  });
  const contractReady = contractInputsReady(inputs);
  const mappingReady = readStringAt(inputs.r1115, ["summary", "conclusion"])
    === "local_private_header_mapping_ready_for_local_aggregate_receipt";
  const summary = summaryFor({ contractReady, firstPassCandidateIds, mappingReady });
  const output: R1121LocalPrivateConsumerReceiptRunnerContractOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    localPrivateRunner: {
      blockedEgress: [
        "participant_identifiers",
        "row_values",
        "split_membership",
        "participant_level_predictions",
        "coefficients",
        "model_parameters",
        "source_bodies_or_codebook_text",
        "header_names",
        "file_names",
        "local_paths",
        "small_cells",
        "product_claims",
      ],
      candidateRunOrder,
      configSchemaVersion: PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION,
      deferredCandidateIds,
      firstPassCandidateIds,
      acceptedPrivateTableLayouts: [...ACCEPTED_PRIVATE_TABLE_LAYOUTS],
      privateConfigTemplateArtifact: PRIVATE_RUNNER_CONFIG_TEMPLATE_FILE_NAME,
      privateConfigValuesStored: false,
      publicOutputAllowlist: [
        "aggregate_metric_deltas",
        "coverage_status",
        "calibration_status",
        "missingness_or_coverage_control_status",
        "evidence_support_band",
        "gate_verdicts",
        "attestations",
      ],
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      localPrivateFirstPassRunnerCommand: R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_COMMAND,
      validationCommand: R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_COMMAND,
    },
    packetId: "r1121-local-private-consumer-receipt-runner-contract",
    productDisplayAuthorized: false,
    schemaVersion: R1121_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONTRACT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary,
  };
  const privateRunnerConfigTemplate = createPrivateRunnerConfigTemplate({
    candidateRunOrder,
    deferredCandidateIds,
    firstPassCandidateIds,
  });

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenAggregateEgress(privateRunnerConfigTemplate),
  ];
  if (findings.length > 0) {
    throw new Error(`R1121 local private consumer receipt runner contract failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const privateRunnerConfigTemplatePath = path.join(outputDir, PRIVATE_RUNNER_CONFIG_TEMPLATE_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(privateRunnerConfigTemplatePath, `${JSON.stringify(privateRunnerConfigTemplate, null, 2)}\n`),
  ]);
  return { output, outputPath, privateRunnerConfigTemplatePath };
}

function contractInputsReady(inputs: Record<InputKey, unknown | null>): boolean {
  return inputMatchesExpected("r1103", inputs.r1103)
    && inputMatchesExpected("r1106", inputs.r1106)
    && inputMatchesExpected("r1115", inputs.r1115)
    && inputMatchesExpected("r1116", inputs.r1116)
    && inputMatchesExpected("r1113", inputs.r1113)
    && inputMatchesExpected("r1120", inputs.r1120)
    && readStringAt(inputs.r1103, ["summary", "conclusion"]) === "consumer_candidate_family_manifest_ready"
    && readStringAt(inputs.r1106, ["summary", "conclusion"]) === "consumer_aggregate_handoff_ready"
    && readStringAt(inputs.r1116, ["summary", "conclusion"]) === "local_private_header_mapping_template_ready"
    && readStringAt(inputs.r1113, ["summary", "conclusion"]) === "consumer_source_execution_packet_ready"
    && firstPassCandidateIdsComplete(firstPassCandidateIdsFor(inputs.r1113))
    && readStringAt(inputs.r1120, ["summary", "conclusion"]) === "consumer_lab_vitals_shadow_arbitration_l1_first";
}

function summaryFor(input: {
  contractReady: boolean;
  firstPassCandidateIds: CandidateId[];
  mappingReady: boolean;
}): R1121LocalPrivateConsumerReceiptRunnerContractOutput["summary"] {
  if (!input.contractReady) {
    return {
      conclusion: "local_private_consumer_receipt_runner_contract_waiting_on_inputs",
      firstPassCandidateIds: input.firstPassCandidateIds,
      nextAction: "refresh_consumer_manifest_handoff_mapping_and_arbitration",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1121: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      topCandidate: "L1_tiny_glycemia_only",
    };
  }
  if (input.mappingReady) {
    return {
      conclusion: "local_private_consumer_receipt_runner_contract_ready_for_execution",
      firstPassCandidateIds: input.firstPassCandidateIds,
      nextAction: "run_local_private_l1_l2_wearable_first_pass_to_aggregate_receipt",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1121: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      topCandidate: "L1_tiny_glycemia_only",
    };
  }
  return {
    conclusion: "local_private_consumer_receipt_runner_contract_ready_awaiting_mapping",
    firstPassCandidateIds: input.firstPassCandidateIds,
    nextAction: "fill_private_mapping_and_runner_config_for_l1_l2_w1",
    productDisplayAuthorized: false,
    reviewGptRequiredNow: false,
    rowParsingPerformedByR1121: false,
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    topCandidate: "L1_tiny_glycemia_only",
  };
}

function createCandidateRunOrder(input: {
  deferredCandidateIds: CandidateId[];
  firstPassCandidateIds: CandidateId[];
}): CandidateRun[] {
  const definitions = candidateRunDefinitions();
  const orderedCandidateIds = dedupeCandidateIds([
    ...input.firstPassCandidateIds,
    ...input.deferredCandidateIds,
  ]);
  return orderedCandidateIds.map((candidateId, index) => {
    const definition = definitions[candidateId];
    return {
      ...definition,
      candidateId,
      runOrder: index + 1,
      runPhase: runPhaseFor(candidateId, input.firstPassCandidateIds),
    };
  });
}

function candidateRunDefinitions(): Record<CandidateId, Omit<CandidateRun, "candidateId" | "runOrder" | "runPhase">> {
  return {
    I1_integrated_lab_wearable_small_panel: {
      inputFamilies: [
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
        "commonLabCore",
        "vitalsBody",
        "wearableActivity",
        "wearableSleep",
        "wearableRecovery",
      ],
      requiredBeforeScoreBearing: [
        "one_lab_component_passes_separately",
        "one_wearable_component_passes_separately",
        "incremental_gain_over_best_single_family",
      ],
      runPolicy: "score_only_after_lab_and_wearable_components_pass",
    },
    L1_tiny_glycemia_only: {
      inputFamilies: ["personJoinKey", "dateOrTimeKey", "outcomeEvent", "labGlycemia"],
      requiredBeforeScoreBearing: [
        "outcome_linked_same_denominator_receipt",
        "consumer_viable_glycemia_coverage",
        "proper_score_improvement_over_frozen_reference",
        "non_worse_calibration",
      ],
      runPolicy: "first_score_bearing_if_outcome_linked",
    },
    L2_common_lab_core_shadow: {
      inputFamilies: ["personJoinKey", "dateOrTimeKey", "outcomeEvent", "labGlycemia", "commonLabCore", "vitalsBody"],
      requiredBeforeScoreBearing: [
        "l1_available_on_same_denominator",
        "incremental_gain_over_l1",
        "consumer_viable_common_lab_coverage",
        "no_missingness_or_body_only_artifact",
      ],
      runPolicy: "secondary_comparator_not_lead",
    },
    QC_missingness_coverage: {
      inputFamilies: ["personJoinKey", "dateOrTimeKey", "outcomeEvent"],
      requiredBeforeScoreBearing: [
        "negative_control_only",
      ],
      runPolicy: "negative_control_required",
    },
    W1_activity_steps_minutes: {
      inputFamilies: ["personJoinKey", "dateOrTimeKey", "outcomeEvent", "wearableActivity"],
      requiredBeforeScoreBearing: [
        "outcome_linked_wearable_activity_receipt",
        "valid_wear_coverage_summary",
        "coverage_quality_control_beaten",
      ],
      runPolicy: "score_only_if_outcome_linked_wearable_coverage_exists",
    },
    W2_sleep_duration_regularity: {
      inputFamilies: ["personJoinKey", "dateOrTimeKey", "outcomeEvent", "wearableSleep"],
      requiredBeforeScoreBearing: [
        "outcome_linked_sleep_receipt",
        "valid_sleep_night_coverage_summary",
        "missingness_control_beaten",
      ],
      runPolicy: "score_only_if_outcome_linked_wearable_coverage_exists",
    },
    W3_rhr_hrv_recovery: {
      inputFamilies: ["personJoinKey", "dateOrTimeKey", "outcomeEvent", "wearableRecovery"],
      requiredBeforeScoreBearing: [
        "outcome_linked_recovery_receipt",
        "source_or_device_coverage_summary",
        "coverage_quality_control_beaten",
      ],
      runPolicy: "score_only_if_outcome_linked_wearable_coverage_exists",
    },
  };
}

function firstPassCandidateIdsFor(r1113: unknown | null): CandidateId[] {
  const candidateIds = readStringArrayAt(r1113, ["summary", "firstPassCandidateIds"]).filter(isCandidateId);
  return candidateIds.length > 0
    ? dedupeCandidateIds(candidateIds)
    : [
      "L1_tiny_glycemia_only",
      "L2_common_lab_core_shadow",
      "W1_activity_steps_minutes",
      "QC_missingness_coverage",
    ];
}

function deferredCandidateIdsFor(r1113: unknown | null, firstPassCandidateIds: readonly CandidateId[]): CandidateId[] {
  const firstSourceTarget = readArrayAt(r1113, ["executionPacket", "sourceTargets"])[0];
  const fromSourcePacket = readStringArrayAt(firstSourceTarget, ["minimumAggregateReceipt", "deferredCandidateIds"])
    .filter(isCandidateId);
  const fallbackCandidateIds: CandidateId[] = [
    "W2_sleep_duration_regularity",
    "W3_rhr_hrv_recovery",
    "I1_integrated_lab_wearable_small_panel",
  ];
  const candidateIds: CandidateId[] = fromSourcePacket.length > 0
    ? fromSourcePacket
    : fallbackCandidateIds;
  const firstPassSet = new Set(firstPassCandidateIds);
  return dedupeCandidateIds(candidateIds.filter((candidateId) => !firstPassSet.has(candidateId)));
}

function firstPassCandidateIdsComplete(candidateIds: readonly CandidateId[]): boolean {
  return candidateIds.includes("L1_tiny_glycemia_only")
    && candidateIds.includes("L2_common_lab_core_shadow")
    && candidateIds.includes("W1_activity_steps_minutes")
    && candidateIds.includes("QC_missingness_coverage");
}

function runPhaseFor(
  candidateId: CandidateId,
  firstPassCandidateIds: readonly CandidateId[],
): CandidateRun["runPhase"] {
  if (firstPassCandidateIds.includes(candidateId)) return "first_pass";
  if (candidateId === "I1_integrated_lab_wearable_small_panel") return "deferred_until_components_pass";
  return "deferred_until_first_pass_receipt";
}

function dedupeCandidateIds(candidateIds: readonly CandidateId[]): CandidateId[] {
  return Array.from(new Set(candidateIds));
}

function isCandidateId(value: string): value is CandidateId {
  return value === "I1_integrated_lab_wearable_small_panel"
    || value === "L1_tiny_glycemia_only"
    || value === "L2_common_lab_core_shadow"
    || value === "QC_missingness_coverage"
    || value === "W1_activity_steps_minutes"
    || value === "W2_sleep_duration_regularity"
    || value === "W3_rhr_hrv_recovery";
}

function createPrivateRunnerConfigTemplate(
  input: {
    candidateRunOrder: CandidateRun[];
    deferredCandidateIds: CandidateId[];
    firstPassCandidateIds: CandidateId[];
  },
): FillableLocalPrivateConsumerReceiptRunnerConfig {
  return {
    acceptedPrivateTableLayouts: [...ACCEPTED_PRIVATE_TABLE_LAYOUTS],
    aggregateReceiptTarget: {
      evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
      localPrivateFirstPassRunnerCommand: R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_COMMAND,
      schemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1",
      validationCommand:
        "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts",
    },
    attestations: {
      localOnly: true,
      noCoefficientEgress: true,
      noHeaderNameEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      noSourceTextEgress: true,
    },
    candidateRunOrder: input.candidateRunOrder,
    deferredCandidateIds: input.deferredCandidateIds,
    firstPassCandidateIds: input.firstPassCandidateIds,
    privateFieldRefs: {
      commonLabCore: "",
      dateOrTimeKey: "",
      labGlycemia: "",
      outcomeEvent: "",
      personJoinKey: "",
      vitalsBody: "",
      wearableActivity: "",
      wearableRecovery: "",
      wearableSleep: "",
    },
    privateTableRefs: {
      labTableRef: "",
      outcomeTableRef: "",
      primaryTableRef: "",
      wearableTableRef: "",
    },
    schemaVersion: PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION,
    singlePrimaryTableFallback: {
      accepted: true,
      minimumTableRef: "primaryTableRef",
    },
    submissionContext: realSubmissionContext(),
  };
}

function realSubmissionContext(): SubmissionContext {
  return {
    evidenceRole: "real_first_pass_evidence",
    ordinaryConsumerSubmission: true,
    outcomeLinked: true,
    priorityInputFamilies: [
      "bloodwork_labs",
      "vitals_body_context",
      "wearable_activity",
    ],
    targetAgeBand: "roughly_16_50",
  };
}

async function readInputs(
  options: R1121LocalPrivateConsumerReceiptRunnerContractOptions,
): Promise<Record<InputKey, unknown | null>> {
  return {
    r1103: await readJsonIfPresent(options.r1103Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1103.artifact)),
    r1106: await readJsonIfPresent(options.r1106Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1106.artifact)),
    r1115: await readJsonIfPresent(options.r1115Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1115.artifact)),
    r1116: await readJsonIfPresent(options.r1116Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1116.artifact)),
    r1113: await readJsonIfPresent(options.r1113Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1113.artifact)),
    r1120: await readJsonIfPresent(options.r1120Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1120.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1121 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
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
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readArrayAt(value: unknown, pathParts: readonly string[]): unknown[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
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

function safeBoundary(): R1121LocalPrivateConsumerReceiptRunnerContractOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1121: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1121: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1121LocalPrivateConsumerReceiptRunnerContract({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1103Path: process.env.MURPH_AGE_R1103_CONSUMER_CANDIDATE_MANIFEST_PATH,
    r1106Path: process.env.MURPH_AGE_R1106_CONSUMER_HANDOFF_BUNDLE_PATH,
    r1115Path: process.env.MURPH_AGE_R1115_PRIVATE_HEADER_MAPPING_INTAKE_PATH,
    r1116Path: process.env.MURPH_AGE_R1116_PRIVATE_HEADER_MAPPING_TEMPLATE_PATH,
    r1113Path: process.env.MURPH_AGE_R1113_CONSUMER_SOURCE_EXECUTION_PACKET_PATH,
    r1120Path: process.env.MURPH_AGE_R1120_LAB_VITALS_ARBITRATION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    candidateCount: output.localPrivateRunner.candidateRunOrder.length,
    conclusion: output.summary.conclusion,
    deferredCandidateIds: output.localPrivateRunner.deferredCandidateIds,
    firstPassCandidateIds: output.localPrivateRunner.firstPassCandidateIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1121: output.summary.rowParsingPerformedByR1121,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetInputPriority: output.summary.targetInputPriority,
    topCandidate: output.summary.topCandidate,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1121 local private consumer receipt runner contract failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
