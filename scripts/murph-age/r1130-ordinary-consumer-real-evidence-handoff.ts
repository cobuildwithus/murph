import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_SCHEMA_VERSION =
  "murph-age-r1130-ordinary-consumer-real-evidence-handoff.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1130-ordinary-consumer-real-evidence-handoff.latest.json";
const DEFAULT_CONFIG_INTAKE_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts" as const;
const DEFAULT_PRIVATE_RUNNER_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts" as const;
const R1124_METRIC_INTAKE_COMMAND =
  "MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH=<aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts" as const;

const INPUTS = {
  r1122: {
    artifact: "r1122-local-private-consumer-receipt-runner-config-intake.latest.json",
    packetId: "r1122-local-private-consumer-receipt-runner-config-intake",
    schemaVersion: "murph-age-r1122-local-private-consumer-receipt-runner-config-intake.v1",
  },
  r1127: {
    artifact: "r1127-ordinary-consumer-first-pass-submission-handoff.latest.json",
    packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
    schemaVersion: "murph-age-r1127-ordinary-consumer-first-pass-submission-handoff.v1",
  },
  r1129: {
    artifact: "r1129-consumer-real-evidence-gate.latest.json",
    packetId: "r1129-consumer-real-evidence-gate",
    schemaVersion: "murph-age-r1129-consumer-real-evidence-gate.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type HandoffConclusion =
  | "ordinary_consumer_real_evidence_handoff_no_delta_continue_search"
  | "ordinary_consumer_real_evidence_handoff_ready_for_private_runner"
  | "ordinary_consumer_real_evidence_handoff_ready_for_reviewgpt_delta"
  | "ordinary_consumer_real_evidence_handoff_ready_for_row_owner_config"
  | "ordinary_consumer_real_evidence_handoff_waiting_on_refresh";
type HandoffNextAction =
  | "complete_private_config_for_real_outcome_linked_labs_wearables"
  | "continue_consumer_source_search_after_real_no_delta"
  | "refresh_r1122_r1127_r1129_before_handoff"
  | "run_r1125_private_runner_then_r1124_real_metric_intake"
  | "send_real_consumer_first_pass_delta_to_reviewgpt";
type PrivateConfigReadiness =
  | "config_intake_missing_or_stale"
  | "private_config_needs_completion"
  | "private_config_ready_for_r1125";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface NonEvidenceExclusion {
  artifact: string;
  evidenceRole: string;
  reason: string;
}

interface MissingConfigChecklistItem {
  acceptedTableLayouts: string[];
  detail: string;
  requiredForCandidateIds: string[];
  slotId: string;
  slotType:
    | "first_pass_candidate"
    | "semantic_ref_family"
    | "submission_context_field"
      | "table_ref";
}

interface SourceFamilyMissingSlotRollup {
  acceptableForAverageUser: true;
  familyId: string;
  inputKind: string | null;
  missingSlotCount: number;
  missingSlotIds: string[];
  privateDetailsStored: false;
  requiredForCandidateIds: string[];
  requiredSemanticRefFamilies: string[];
  requiredTableRefs: string[];
  status: string | null;
}

export interface R1130OrdinaryConsumerRealEvidenceHandoffOptions {
  createdAt?: string;
  outputDir?: string;
  r1122Path?: string;
  r1127Path?: string;
  r1129Path?: string;
}

export interface R1130OrdinaryConsumerRealEvidenceHandoffOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1130: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1130: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
    syntheticRowsPersisted: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1130-ordinary-consumer-real-evidence-handoff";
  productDisplayAuthorized: false;
  realEvidenceHandoff: {
    acceptedTableLayouts: string[];
    blockers: string[];
    commands: {
      configIntakeCommand: string;
      metricIntakeCommand: typeof R1124_METRIC_INTAKE_COMMAND;
      privateRunnerCommand: string;
    };
    currentPrivateConfig: {
      candidateRunCountBand: string | null;
      missingFirstPassCandidateIds: string[];
      missingSemanticRefFamilies: string[];
      missingSubmissionContextFields: string[];
      missingTableRefs: string[];
      ordinaryTableLayout: string | null;
      readiness: PrivateConfigReadiness;
      requiredTableRefsStatus: string | null;
      semanticRefCountBand: string | null;
      submissionContextStatus: string | null;
    };
    firstPassCandidateIds: string[];
    minimumEvidenceFloor: {
      eventCount: string | null;
      usableRecordCount: string | null;
    };
    missingConfigChecklist: MissingConfigChecklistItem[];
    nonEvidenceExcluded: NonEvidenceExclusion[];
    ordinarySubmitterGuidance: {
      acceptedTableLayouts: string[];
      averageSubmitterFamilyIds: string[];
      missingSlotCount: number | null;
      missingSlotTypes: string[];
      privateDetailsStored: false;
      readyForR1125: boolean | null;
      realAggregateStillMissing: boolean;
      sourceFamilyMissingSlotRollup: SourceFamilyMissingSlotRollup[];
    };
    priorityInputFamilies: [
      "bloodwork_labs",
      "vitals_body_context",
      "wearable_activity",
    ];
    privateConfigTemplateArtifact: string | null;
    privateValuesStored: false;
    requiredPrivateFieldRefFamilies: string[];
    requiredPrivateTableRefs: string[];
    rowOwnerWorkType:
      | "complete_private_config"
      | "continue_source_search"
      | "refresh_handoff_inputs"
      | "review_real_delta"
      | "run_private_runner";
    sourceFamilyIds: string[];
    submissionPlanArtifact: string | null;
    targetAgeBand: "roughly_16_50";
  };
  schemaVersion: typeof R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: HandoffConclusion;
    nextAction: HandoffNextAction;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1130: false;
    rowOwnerWorkType: R1130OrdinaryConsumerRealEvidenceHandoffOutput["realEvidenceHandoff"]["rowOwnerWorkType"];
    topPriority: "real_outcome_linked_labs_wearables_for_average_16_50_user";
  };
}

export async function runR1130OrdinaryConsumerRealEvidenceHandoff(
  options: R1130OrdinaryConsumerRealEvidenceHandoffOptions = {},
): Promise<{ output: R1130OrdinaryConsumerRealEvidenceHandoffOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const requiredInputsReady = inputMatchesExpected("r1127", inputs.r1127)
    && inputMatchesExpected("r1129", inputs.r1129);
  const configReadiness = privateConfigReadinessFor(inputs.r1122);
  const gateConclusion = readStringAt(inputs.r1129, ["summary", "conclusion"]);
  const conclusion = conclusionFor({ configReadiness, gateConclusion, requiredInputsReady });
  const rowOwnerWorkType = rowOwnerWorkTypeFor(conclusion);
  const acceptedTableLayouts = acceptedTableLayoutsFor(inputs);
  const blockers = blockersFor({ conclusion, configReadiness, inputs, requiredInputsReady });
  const output: R1130OrdinaryConsumerRealEvidenceHandoffOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1130-ordinary-consumer-real-evidence-handoff",
    productDisplayAuthorized: false,
    realEvidenceHandoff: {
      acceptedTableLayouts,
      blockers,
      commands: {
        configIntakeCommand: readStringAt(inputs.r1127, [
          "ordinarySubmissionHandoff",
          "commands",
          "configIntakeCommand",
        ]) ?? DEFAULT_CONFIG_INTAKE_COMMAND,
        metricIntakeCommand: R1124_METRIC_INTAKE_COMMAND,
        privateRunnerCommand: readStringAt(inputs.r1127, [
          "ordinarySubmissionHandoff",
          "commands",
          "executionCommand",
        ]) ?? DEFAULT_PRIVATE_RUNNER_COMMAND,
      },
      currentPrivateConfig: {
        candidateRunCountBand: readStringAt(inputs.r1122, ["configIntake", "candidateRunCountBand"]),
        missingFirstPassCandidateIds: readStringArrayAt(inputs.r1122, [
          "configIntake",
          "missingFirstPassCandidateIds",
        ]),
        missingSemanticRefFamilies: readStringArrayAt(inputs.r1122, [
          "configIntake",
          "missingSemanticRefFamilies",
        ]),
        missingSubmissionContextFields: readStringArrayAt(inputs.r1122, [
          "configIntake",
          "missingSubmissionContextFields",
        ]),
        missingTableRefs: readStringArrayAt(inputs.r1122, ["configIntake", "missingTableRefs"]),
        ordinaryTableLayout: readStringAt(inputs.r1122, ["configIntake", "ordinaryTableLayout"]),
        readiness: configReadiness,
        requiredTableRefsStatus: readStringAt(inputs.r1122, ["configIntake", "requiredTableRefsStatus"]),
        semanticRefCountBand: readStringAt(inputs.r1122, ["configIntake", "semanticRefCountBand"]),
        submissionContextStatus: readStringAt(inputs.r1122, ["configIntake", "submissionContextStatus"]),
      },
      firstPassCandidateIds: firstPassCandidateIdsFor(inputs),
      minimumEvidenceFloor: {
        eventCount: readStringAt(inputs.r1127, [
          "ordinarySubmissionHandoff",
          "minimumEvidenceFloor",
          "eventCount",
        ]),
        usableRecordCount: readStringAt(inputs.r1127, [
          "ordinarySubmissionHandoff",
          "minimumEvidenceFloor",
          "usableRecordCount",
        ]),
      },
      missingConfigChecklist: missingConfigChecklistFor({ acceptedTableLayouts, inputs }),
      nonEvidenceExcluded: nonEvidenceExcludedFor(inputs.r1129),
      ordinarySubmitterGuidance: ordinarySubmitterGuidanceFor({
        r1122: inputs.r1122,
        realAggregateStillMissing: blockers.includes("real_outcome_linked_labs_wearables_aggregate_missing"),
      }),
      priorityInputFamilies: [
        "bloodwork_labs",
        "vitals_body_context",
        "wearable_activity",
      ],
      privateConfigTemplateArtifact: readStringAt(inputs.r1127, [
        "ordinarySubmissionHandoff",
        "privateConfigTemplateArtifact",
      ]),
      privateValuesStored: false,
      requiredPrivateFieldRefFamilies: readStringArrayAt(inputs.r1127, [
        "ordinarySubmissionHandoff",
        "requiredPrivateFieldRefFamilies",
      ]),
      requiredPrivateTableRefs: readStringArrayAt(inputs.r1127, [
        "ordinarySubmissionHandoff",
        "requiredPrivateTableRefs",
      ]),
      rowOwnerWorkType,
      sourceFamilyIds: sourceFamilyIdsFor(inputs),
      submissionPlanArtifact: readStringAt(inputs.r1127, ["summary", "submissionPlanArtifact"]),
      targetAgeBand: "roughly_16_50",
    },
    schemaVersion: R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextAction: nextActionFor(conclusion),
      productDisplayAuthorized: false,
      reviewGptRequiredNow: conclusion === "ordinary_consumer_real_evidence_handoff_ready_for_reviewgpt_delta",
      rowOwnerWorkType,
      rowParsingPerformedByR1130: false,
      topPriority: "real_outcome_linked_labs_wearables_for_average_16_50_user",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1130 ordinary consumer real evidence handoff failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  configReadiness: PrivateConfigReadiness;
  gateConclusion: string | null;
  requiredInputsReady: boolean;
}): HandoffConclusion {
  if (!input.requiredInputsReady) {
    return "ordinary_consumer_real_evidence_handoff_waiting_on_refresh";
  }
  if (input.gateConclusion === "consumer_real_evidence_gate_ready_for_reviewgpt_delta") {
    return "ordinary_consumer_real_evidence_handoff_ready_for_reviewgpt_delta";
  }
  if (input.gateConclusion === "consumer_real_evidence_gate_valid_no_delta_continue_source_search") {
    return "ordinary_consumer_real_evidence_handoff_no_delta_continue_search";
  }
  if (input.configReadiness === "private_config_ready_for_r1125") {
    return "ordinary_consumer_real_evidence_handoff_ready_for_private_runner";
  }
  return "ordinary_consumer_real_evidence_handoff_ready_for_row_owner_config";
}

function nextActionFor(conclusion: HandoffConclusion): HandoffNextAction {
  if (conclusion === "ordinary_consumer_real_evidence_handoff_waiting_on_refresh") {
    return "refresh_r1122_r1127_r1129_before_handoff";
  }
  if (conclusion === "ordinary_consumer_real_evidence_handoff_ready_for_reviewgpt_delta") {
    return "send_real_consumer_first_pass_delta_to_reviewgpt";
  }
  if (conclusion === "ordinary_consumer_real_evidence_handoff_no_delta_continue_search") {
    return "continue_consumer_source_search_after_real_no_delta";
  }
  if (conclusion === "ordinary_consumer_real_evidence_handoff_ready_for_private_runner") {
    return "run_r1125_private_runner_then_r1124_real_metric_intake";
  }
  return "complete_private_config_for_real_outcome_linked_labs_wearables";
}

function rowOwnerWorkTypeFor(
  conclusion: HandoffConclusion,
): R1130OrdinaryConsumerRealEvidenceHandoffOutput["realEvidenceHandoff"]["rowOwnerWorkType"] {
  if (conclusion === "ordinary_consumer_real_evidence_handoff_waiting_on_refresh") {
    return "refresh_handoff_inputs";
  }
  if (conclusion === "ordinary_consumer_real_evidence_handoff_ready_for_reviewgpt_delta") {
    return "review_real_delta";
  }
  if (conclusion === "ordinary_consumer_real_evidence_handoff_no_delta_continue_search") {
    return "continue_source_search";
  }
  if (conclusion === "ordinary_consumer_real_evidence_handoff_ready_for_private_runner") {
    return "run_private_runner";
  }
  return "complete_private_config";
}

function privateConfigReadinessFor(r1122: unknown | null): PrivateConfigReadiness {
  if (!inputMatchesExpected("r1122", r1122)) {
    return "config_intake_missing_or_stale";
  }
  const conclusion = readStringAt(r1122, ["summary", "conclusion"]);
  const submissionContextStatus = readStringAt(r1122, ["configIntake", "submissionContextStatus"]);
  if (
    conclusion === "local_private_runner_config_ready_for_local_aggregate_receipt"
    && submissionContextStatus === "complete_real_evidence"
  ) {
    return "private_config_ready_for_r1125";
  }
  return "private_config_needs_completion";
}

function blockersFor(input: {
  conclusion: HandoffConclusion;
  configReadiness: PrivateConfigReadiness;
  inputs: Record<InputKey, unknown | null>;
  requiredInputsReady: boolean;
}): string[] {
  if (!input.requiredInputsReady || input.conclusion === "ordinary_consumer_real_evidence_handoff_waiting_on_refresh") {
    return ["refresh_r1127_r1129_before_real_evidence_handoff"];
  }
  if (input.conclusion === "ordinary_consumer_real_evidence_handoff_ready_for_reviewgpt_delta") {
    return [];
  }

  const blockers = readStringArrayAt(input.inputs.r1129, ["realEvidenceGate", "blockers"]);
  if (input.conclusion === "ordinary_consumer_real_evidence_handoff_no_delta_continue_search") {
    return blockers;
  }
  if (input.configReadiness !== "private_config_ready_for_r1125") {
    blockers.push("private_config_not_ready_for_r1125");
  }
  if (readStringAt(input.inputs.r1122, ["configIntake", "submissionContextStatus"]) === "complete_non_evidence") {
    blockers.push("private_config_context_not_real_first_pass_evidence");
  }
  return Array.from(new Set(blockers));
}

function acceptedTableLayoutsFor(inputs: Record<InputKey, unknown | null>): string[] {
  const fromGate = readStringArrayAt(inputs.r1129, ["realEvidenceGate", "acceptedTableLayouts"]);
  if (fromGate.length > 0) return fromGate;
  return readStringArrayAt(inputs.r1127, ["ordinarySubmissionHandoff", "ordinaryTableLayouts"]);
}

function firstPassCandidateIdsFor(inputs: Record<InputKey, unknown | null>): string[] {
  const fromGate = readStringArrayAt(inputs.r1129, ["realEvidenceGate", "firstPassCandidateIds"]);
  if (fromGate.length > 0) return fromGate;
  return readStringArrayAt(inputs.r1127, ["ordinarySubmissionHandoff", "firstPassCandidateIds"]);
}

function sourceFamilyIdsFor(inputs: Record<InputKey, unknown | null>): string[] {
  const fromGate = readStringArrayAt(inputs.r1129, ["realEvidenceGate", "sourceFamilyIds"]);
  if (fromGate.length > 0) return fromGate;
  const fromConfigIntake = readStringArrayAt(inputs.r1122, [
    "configIntake",
    "ordinarySubmitterGuidance",
    "averageSubmitterFamilyIds",
  ]);
  if (fromConfigIntake.length > 0) return fromConfigIntake;
  return readStringArrayAt(inputs.r1127, ["summary", "ordinarySourceFamilyIds"]);
}

function ordinarySubmitterGuidanceFor(input: {
  r1122: unknown | null;
  realAggregateStillMissing: boolean;
}): R1130OrdinaryConsumerRealEvidenceHandoffOutput["realEvidenceHandoff"]["ordinarySubmitterGuidance"] {
  return {
    acceptedTableLayouts: readStringArrayAt(input.r1122, [
      "configIntake",
      "ordinarySubmitterGuidance",
      "acceptedTableLayouts",
    ]),
    averageSubmitterFamilyIds: readStringArrayAt(input.r1122, [
      "configIntake",
      "ordinarySubmitterGuidance",
      "averageSubmitterFamilyIds",
    ]),
    missingSlotCount: readNumberAt(input.r1122, [
      "configIntake",
      "ordinarySubmitterGuidance",
      "missingSlotCount",
    ]),
    missingSlotTypes: readStringArrayAt(input.r1122, [
      "configIntake",
      "ordinarySubmitterGuidance",
      "missingSlotTypes",
    ]),
    privateDetailsStored: false,
    readyForR1125: readBooleanAt(input.r1122, [
      "configIntake",
      "ordinarySubmitterGuidance",
      "readyForR1125",
    ]),
    realAggregateStillMissing: input.realAggregateStillMissing,
    sourceFamilyMissingSlotRollup: sourceFamilyMissingSlotRollupFor(input.r1122),
  };
}

function sourceFamilyMissingSlotRollupFor(r1122: unknown | null): SourceFamilyMissingSlotRollup[] {
  return readObjectArrayAt(r1122, [
    "configIntake",
    "ordinarySubmitterGuidance",
    "sourceFamilies",
  ]).map((family) => {
    const missingSlotIds = readStringArrayAt(family, ["missingSlotIds"]);
    return {
      acceptableForAverageUser: true,
      familyId: readStringAt(family, ["familyId"]) ?? "unknown_source_family",
      inputKind: readStringAt(family, ["inputKind"]),
      missingSlotCount: missingSlotIds.length,
      missingSlotIds,
      privateDetailsStored: false,
      requiredForCandidateIds: readStringArrayAt(family, ["requiredForCandidateIds"]),
      requiredSemanticRefFamilies: readStringArrayAt(family, ["requiredSemanticRefFamilies"]),
      requiredTableRefs: readStringArrayAt(family, ["requiredTableRefs"]),
      status: readStringAt(family, ["status"]),
    };
  });
}

function nonEvidenceExcludedFor(r1129: unknown | null): NonEvidenceExclusion[] {
  const value = readAt(r1129, ["realEvidenceGate", "rejectedAsModelEvidence"]);
  if (!Array.isArray(value)) return [];
  const excluded: NonEvidenceExclusion[] = [];
  for (const item of value) {
    const artifact = readStringAt(item, ["artifact"]);
    const evidenceRole = readStringAt(item, ["evidenceRole"]);
    const reason = readStringAt(item, ["reason"]);
    if (artifact && evidenceRole && reason) {
      excluded.push({ artifact, evidenceRole, reason });
    }
  }
  return excluded;
}

function missingConfigChecklistFor(input: {
  acceptedTableLayouts: string[];
  inputs: Record<InputKey, unknown | null>;
}): MissingConfigChecklistItem[] {
  return [
    ...readStringArrayAt(input.inputs.r1122, [
      "configIntake",
      "missingFirstPassCandidateIds",
    ]).map((slotId): MissingConfigChecklistItem => ({
      acceptedTableLayouts: [],
      detail: "include_candidate_in_private_config_candidate_run_order",
      requiredForCandidateIds: [slotId],
      slotId,
      slotType: "first_pass_candidate",
    })),
    ...readStringArrayAt(input.inputs.r1122, [
      "configIntake",
      "missingSemanticRefFamilies",
    ]).map((slotId): MissingConfigChecklistItem => ({
      acceptedTableLayouts: [],
      detail: semanticRefDetailFor(input.inputs.r1127, slotId),
      requiredForCandidateIds: semanticRefRequiredCandidatesFor(input.inputs.r1127, slotId),
      slotId,
      slotType: "semantic_ref_family",
    })),
    ...readStringArrayAt(input.inputs.r1122, [
      "configIntake",
      "missingSubmissionContextFields",
    ]).map((slotId): MissingConfigChecklistItem => ({
      acceptedTableLayouts: [],
      detail: submissionContextDetailFor(slotId),
      requiredForCandidateIds: [],
      slotId,
      slotType: "submission_context_field",
    })),
    ...readStringArrayAt(input.inputs.r1122, ["configIntake", "missingTableRefs"])
      .map((slotId): MissingConfigChecklistItem => ({
        acceptedTableLayouts: input.acceptedTableLayouts,
        detail: "provide_table_ref_slot_or_use_single_primary_table_fallback",
        requiredForCandidateIds: [],
        slotId,
        slotType: "table_ref",
      })),
  ];
}

function semanticRefDetailFor(r1127: unknown | null, familyId: string): string {
  const semanticField = semanticFieldFor(r1127, familyId);
  return readStringAt(semanticField, ["role"]) ?? "required_semantic_ref_family_for_first_pass";
}

function semanticRefRequiredCandidatesFor(r1127: unknown | null, familyId: string): string[] {
  return readStringArrayAt(semanticFieldFor(r1127, familyId), ["requiredForCandidateIds"]);
}

function semanticFieldFor(r1127: unknown | null, familyId: string): unknown | null {
  const value = readAt(r1127, ["ordinarySubmissionHandoff", "semanticFieldFamilies"]);
  if (!Array.isArray(value)) return null;
  return value.find((item) => readStringAt(item, ["familyId"]) === familyId) ?? null;
}

function submissionContextDetailFor(fieldId: string): string {
  if (fieldId === "evidenceRole") return "declare_real_first_pass_evidence_role_for_model_evidence";
  if (fieldId === "ordinaryConsumerSubmission") return "declare_ordinary_consumer_submission_true";
  if (fieldId === "outcomeLinked") return "declare_outcome_linked_true";
  if (fieldId === "priorityInputFamilies") {
    return "include_bloodwork_labs_vitals_body_context_and_wearable_activity";
  }
  if (fieldId === "targetAgeBand") return "declare_roughly_16_50_target_age_band";
  return "complete_required_submission_context_field";
}

async function readInputs(
  options: R1130OrdinaryConsumerRealEvidenceHandoffOptions,
): Promise<Record<InputKey, unknown | null>> {
  return {
    r1122: await readJsonIfPresent(options.r1122Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1122.artifact)),
    r1127: await readJsonIfPresent(options.r1127Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1127.artifact)),
    r1129: await readJsonIfPresent(options.r1129Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1129.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1130 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return {
    r1122: summarizeInput("r1122", inputs.r1122),
    r1127: summarizeInput("r1127", inputs.r1127),
    r1129: summarizeInput("r1129", inputs.r1129),
  };
}

function summarizeInput(key: InputKey, input: unknown | null): ArtifactSummary {
  const expected = INPUTS[key];
  const packetId = readStringAt(input, ["packetId"]);
  const schemaVersion = readStringAt(input, ["schemaVersion"]);
  return {
    artifact: expected.artifact,
    packetId: packetId === expected.packetId ? expected.packetId : null,
    schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
    status: input ? "available" : "missing",
  };
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

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readNumberAt(value: unknown | null, pathParts: readonly string[]): number | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "number" ? resolved : null;
}

function readStringArrayAt(value: unknown | null, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readObjectArrayAt(value: unknown | null, pathParts: readonly string[]): Array<Record<string, unknown>> {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved)
    ? resolved.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
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

function safeBoundary(): R1130OrdinaryConsumerRealEvidenceHandoffOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1130: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1130: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
    syntheticRowsPersisted: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1130OrdinaryConsumerRealEvidenceHandoff({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1122Path: process.env.MURPH_AGE_R1122_LOCAL_PRIVATE_CONFIG_INTAKE_PATH,
    r1127Path: process.env.MURPH_AGE_R1127_ORDINARY_CONSUMER_SUBMISSION_HANDOFF_PATH,
    r1129Path: process.env.MURPH_AGE_R1129_CONSUMER_REAL_EVIDENCE_GATE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    blockers: output.realEvidenceHandoff.blockers,
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    ordinarySubmitterMissingSlotCount: output.realEvidenceHandoff.ordinarySubmitterGuidance.missingSlotCount,
    ordinarySubmitterMissingSlotTypes: output.realEvidenceHandoff.ordinarySubmitterGuidance.missingSlotTypes,
    ordinarySubmitterReadyForR1125: output.realEvidenceHandoff.ordinarySubmitterGuidance.readyForR1125,
    packetId: output.packetId,
    privateConfigReadiness: output.realEvidenceHandoff.currentPrivateConfig.readiness,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowOwnerWorkType: output.summary.rowOwnerWorkType,
    rowParsingPerformedByR1130: output.summary.rowParsingPerformedByR1130,
    schemaVersion: output.schemaVersion,
    sourceFamilyIds: output.realEvidenceHandoff.sourceFamilyIds,
    sourceFamilyMissingSlotRollup: output.realEvidenceHandoff.ordinarySubmitterGuidance.sourceFamilyMissingSlotRollup.map((family) => ({
      familyId: family.familyId,
      missingSlotCount: family.missingSlotCount,
      missingSlotIds: family.missingSlotIds,
      status: family.status,
    })),
    status: output.status,
    topPriority: output.summary.topPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1130 ordinary consumer real evidence handoff failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
