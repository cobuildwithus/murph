import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1122_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_INTAKE_SCHEMA_VERSION =
  "murph-age-r1122-local-private-consumer-receipt-runner-config-intake.v1" as const;

const PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION =
  "murph-age-local-private-consumer-receipt-runner-config.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1122-local-private-consumer-receipt-runner-config-intake.latest.json";
const R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts" as const;

const R1121_EXPECTED = {
  artifact: "r1121-local-private-consumer-receipt-runner-contract.latest.json",
  packetId: "r1121-local-private-consumer-receipt-runner-contract",
  schemaVersion: "murph-age-r1121-local-private-consumer-receipt-runner-contract.v1",
} as const;

const SEMANTIC_CATEGORIES = [
  "personJoinKey",
  "dateOrTimeKey",
  "outcomeEvent",
  "labGlycemia",
  "commonLabCore",
  "vitalsBody",
  "wearableActivity",
  "wearableSleep",
  "wearableRecovery",
] as const;
const REQUIRED_SUBMISSION_CONTEXT_FAMILIES = [
  "bloodwork_labs",
  "vitals_body_context",
  "wearable_activity",
] as const;
const REQUIRED_SEMANTIC_REF_FAMILIES = [
  "personJoinKey",
  "dateOrTimeKey",
  "outcomeEvent",
  "labGlycemia",
  "commonLabCore",
  "vitalsBody",
  "wearableActivity",
] as const;
const REQUIRED_TABLE_REF_KEYS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
] as const;
const REQUIRED_SUBMISSION_CONTEXT_FIELDS = [
  "evidenceRole",
  "ordinaryConsumerSubmission",
  "outcomeLinked",
  "priorityInputFamilies",
  "targetAgeBand",
] as const;
const ORDINARY_SUBMITTER_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
] as const;
const ORDINARY_TABLE_LAYOUTS = [
  "single_primary_table_fallback",
  "multi_table_or_explicit_refs",
] as const;

type SemanticCategory = typeof SEMANTIC_CATEGORIES[number];
type RequiredSemanticRefFamily = typeof REQUIRED_SEMANTIC_REF_FAMILIES[number];
type RequiredTableRefKey = typeof REQUIRED_TABLE_REF_KEYS[number];
type RequiredSubmissionContextField = typeof REQUIRED_SUBMISSION_CONTEXT_FIELDS[number];
type OrdinarySubmitterSourceFamilyId = typeof ORDINARY_SUBMITTER_SOURCE_FAMILY_IDS[number];
type SubmissionEvidenceRole =
  | "historical_shadow_context"
  | "real_first_pass_evidence"
  | "synthetic_pipeline_smoke";
type SubmissionContextStatus =
  | "complete_non_evidence"
  | "complete_real_evidence"
  | "missing_or_invalid"
  | "not_provided";
type CandidateId =
  | "I1_integrated_lab_wearable_small_panel"
  | "L1_tiny_glycemia_only"
  | "L2_common_lab_core_shadow"
  | "QC_missingness_coverage"
  | "W1_activity_steps_minutes"
  | "W2_sleep_duration_regularity"
  | "W3_rhr_hrv_recovery";
type CountBand = "0" | "1" | "2-9" | "10-99" | "100+";
type OrdinaryTableLayout =
  | "incomplete"
  | "multi_table_or_explicit_refs"
  | "not_provided"
  | "single_primary_table_fallback";
type OrdinaryPrivateInputKind =
  | "bloodwork_table_or_lab_portal_export"
  | "body_or_vitals_table"
  | "daily_wearable_activity_export_or_spreadsheet"
  | "outcome_or_followup_table"
  | "stable_join_key_and_date_fields";
type OrdinarySubmitterSourceFamilyRole =
  | "bloodwork_glycemia_signal"
  | "common_bloodwork_shadow_signal"
  | "join_and_time_alignment"
  | "outcome_linkage"
  | "vitals_body_context"
  | "wearable_activity_signal";
type OrdinarySubmitterSourceFamilyStatus =
  | "mapped_or_not_blocking"
  | "needs_private_config"
  | "ready_for_private_runner";
type MissingSlotType =
  | "first_pass_candidate"
  | "semantic_ref_family"
  | "submission_context_field"
  | "table_ref";
type MissingSlotId =
  | CandidateId
  | RequiredSemanticRefFamily
  | RequiredSubmissionContextField
  | RequiredTableRefKey;

interface OrdinarySubmitterSourceFamilyDefinition {
  acceptableForAverageUser: true;
  familyId: OrdinarySubmitterSourceFamilyId;
  inputKind: OrdinaryPrivateInputKind;
  privateDetailsStored: false;
  requiredForCandidateIds: CandidateId[];
  requiredSemanticRefFamilies: RequiredSemanticRefFamily[];
  requiredTableRefs: RequiredTableRefKey[];
  role: OrdinarySubmitterSourceFamilyRole;
}

interface OrdinarySubmitterSourceFamilyGuidance extends OrdinarySubmitterSourceFamilyDefinition {
  missingSlotIds: MissingSlotId[];
  status: OrdinarySubmitterSourceFamilyStatus;
}

const ORDINARY_SUBMITTER_SOURCE_FAMILIES: OrdinarySubmitterSourceFamilyDefinition[] = [
  {
    acceptableForAverageUser: true,
    familyId: "join_time_alignment",
    inputKind: "stable_join_key_and_date_fields",
    privateDetailsStored: false,
    requiredForCandidateIds: [
      "L1_tiny_glycemia_only",
      "L2_common_lab_core_shadow",
      "W1_activity_steps_minutes",
      "QC_missingness_coverage",
    ],
    requiredSemanticRefFamilies: ["personJoinKey", "dateOrTimeKey"],
    requiredTableRefs: [...REQUIRED_TABLE_REF_KEYS],
    role: "join_and_time_alignment",
  },
  {
    acceptableForAverageUser: true,
    familyId: "outcome_linkage",
    inputKind: "outcome_or_followup_table",
    privateDetailsStored: false,
    requiredForCandidateIds: [
      "L1_tiny_glycemia_only",
      "L2_common_lab_core_shadow",
      "W1_activity_steps_minutes",
      "QC_missingness_coverage",
    ],
    requiredSemanticRefFamilies: ["outcomeEvent"],
    requiredTableRefs: ["outcomeTableRef"],
    role: "outcome_linkage",
  },
  {
    acceptableForAverageUser: true,
    familyId: "bloodwork_glycemia",
    inputKind: "bloodwork_table_or_lab_portal_export",
    privateDetailsStored: false,
    requiredForCandidateIds: ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"],
    requiredSemanticRefFamilies: ["labGlycemia"],
    requiredTableRefs: ["labTableRef"],
    role: "bloodwork_glycemia_signal",
  },
  {
    acceptableForAverageUser: true,
    familyId: "common_bloodwork_core",
    inputKind: "bloodwork_table_or_lab_portal_export",
    privateDetailsStored: false,
    requiredForCandidateIds: ["L2_common_lab_core_shadow"],
    requiredSemanticRefFamilies: ["commonLabCore"],
    requiredTableRefs: ["labTableRef"],
    role: "common_bloodwork_shadow_signal",
  },
  {
    acceptableForAverageUser: true,
    familyId: "vitals_body_context",
    inputKind: "body_or_vitals_table",
    privateDetailsStored: false,
    requiredForCandidateIds: ["L2_common_lab_core_shadow"],
    requiredSemanticRefFamilies: ["vitalsBody"],
    requiredTableRefs: ["labTableRef", "primaryTableRef"],
    role: "vitals_body_context",
  },
  {
    acceptableForAverageUser: true,
    familyId: "wearable_activity_daily",
    inputKind: "daily_wearable_activity_export_or_spreadsheet",
    privateDetailsStored: false,
    requiredForCandidateIds: ["W1_activity_steps_minutes"],
    requiredSemanticRefFamilies: ["wearableActivity"],
    requiredTableRefs: ["wearableTableRef"],
    role: "wearable_activity_signal",
  },
];

interface ArtifactSummary {
  artifact: typeof R1121_EXPECTED.artifact;
  packetId: typeof R1121_EXPECTED.packetId | null;
  schemaVersion: typeof R1121_EXPECTED.schemaVersion | null;
  status: "available" | "missing";
}

interface PrivateRunnerConfigInput {
  aggregateReceiptTarget?: {
    evaluatorId?: string;
    schemaVersion?: string;
    validationCommand?: string;
  };
  attestations?: {
    localOnly?: boolean;
    noCoefficientEgress?: boolean;
    noHeaderNameEgress?: boolean;
    noParticipantEgress?: boolean;
    noPredictionEgress?: boolean;
    noRowEgress?: boolean;
    noSmallCellEgress?: boolean;
    noSourceTextEgress?: boolean;
  };
  candidateRunOrder?: unknown[];
  privateFieldRefs?: Partial<Record<SemanticCategory, unknown>>;
  privateTableRefs?: {
    labTableRef?: unknown;
    outcomeTableRef?: unknown;
    primaryTableRef?: unknown;
    wearableTableRef?: unknown;
  };
  schemaVersion?: string;
  submissionContext?: {
    evidenceRole?: unknown;
    ordinaryConsumerSubmission?: unknown;
    outcomeLinked?: unknown;
    priorityInputFamilies?: unknown;
    targetAgeBand?: unknown;
  };
}

interface SemanticRefCoverage {
  commonLabCore: boolean;
  dateOrTimeKey: boolean;
  labGlycemia: boolean;
  outcomeEvent: boolean;
  personJoinKey: boolean;
  vitalsBody: boolean;
  wearableActivity: boolean;
  wearableRecovery: boolean;
  wearableSleep: boolean;
}

export interface R1122LocalPrivateConsumerReceiptRunnerConfigIntakeOptions {
  configPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1121Path?: string;
}

export interface R1122LocalPrivateConsumerReceiptRunnerConfigIntakeOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    mappingPathStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1122: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    privateConfigPathStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1122: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  configIntake: {
    aggregateReceiptTargetStatus: "complete" | "missing_or_invalid" | "not_provided";
    attestationStatus: "complete" | "missing_or_false" | "not_provided";
    blockedConfigContent: [
      "private_paths",
      "header_names",
      "source_variable_names",
      "file_names",
      "row_values",
      "participant_identifiers",
      "predictions",
      "coefficients",
      "source_text",
    ];
    candidateRunCountBand: CountBand;
    configPathConfigured: boolean;
    firstPassCandidateStatus: "complete" | "missing_or_invalid" | "not_provided";
    missingFirstPassCandidateIds: CandidateId[];
    missingSemanticRefFamilies: RequiredSemanticRefFamily[];
    missingSubmissionContextFields: RequiredSubmissionContextField[];
    missingTableRefs: RequiredTableRefKey[];
    ordinarySubmitterGuidance: {
      acceptedTableLayouts: Array<typeof ORDINARY_TABLE_LAYOUTS[number]>;
      averageSubmitterAgeBand: "roughly_16_50";
      averageSubmitterFamilyIds: OrdinarySubmitterSourceFamilyId[];
      minimumEvidenceFloor: {
        eventCount: "10_plus";
        usableRecordCount: "50_plus";
      };
      missingSlotCount: number;
      missingSlotTypes: MissingSlotType[];
      privateDetailsStored: false;
      readyForR1125: boolean;
      realAggregateStillMissing: true;
      sourceFamilies: OrdinarySubmitterSourceFamilyGuidance[];
      submissionContext: {
        missingFields: RequiredSubmissionContextField[];
        requiredFields: RequiredSubmissionContextField[];
        status: SubmissionContextStatus;
      };
    };
    ordinaryTableLayout: OrdinaryTableLayout;
    privateConfigStatus: "available" | "missing";
    privateConfigValuesStored: false;
    requiredTableRefsStatus: "complete" | "incomplete" | "not_provided";
    r1125LocalPrivateFirstPassRunnerCommand: typeof R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_COMMAND;
    schemaVersion: typeof PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION | null;
    semanticRefCoverage: SemanticRefCoverage;
    semanticRefCountBand: CountBand;
    submissionContextStatus: SubmissionContextStatus;
  };
  createdAt: string;
  inputArtifacts: {
    r1121: ArtifactSummary;
  };
  packetId: "r1122-local-private-consumer-receipt-runner-config-intake";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1122_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_INTAKE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "local_private_runner_config_incomplete"
      | "local_private_runner_config_not_provided"
      | "local_private_runner_config_ready_for_local_aggregate_receipt"
      | "local_private_runner_config_waiting_on_contract";
    nextAction:
      | "complete_private_runner_config_for_l1_l2_w1"
      | "fill_private_runner_config_before_local_receipt"
      | "refresh_r1121_contract_before_config_intake"
      | "run_r1125_local_private_first_pass_runner_then_r1124";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1122: false;
    firstPassCandidateIds: CandidateId[];
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
    topCandidate: "L1_tiny_glycemia_only";
  };
}

export async function runR1122LocalPrivateConsumerReceiptRunnerConfigIntake(
  options: R1122LocalPrivateConsumerReceiptRunnerConfigIntakeOptions = {},
): Promise<{ output: R1122LocalPrivateConsumerReceiptRunnerConfigIntakeOutput; outputPath: string }> {
  const r1121 = await readJsonIfPresent(options.r1121Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1121_EXPECTED.artifact));
  validateInputBoundary("r1121", r1121);
  const configuredPath = options.configPath ?? process.env.MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH;
  const configPathConfigured = Boolean(configuredPath?.trim());
  const config = await readConfig(configuredPath);
  const contractReady = inputMatchesExpected(r1121)
    && (
      readStringAt(r1121, ["summary", "conclusion"]) === "local_private_consumer_receipt_runner_contract_ready_awaiting_mapping"
      || readStringAt(r1121, ["summary", "conclusion"]) === "local_private_consumer_receipt_runner_contract_ready_for_execution"
    );
  const semanticRefCoverage = config ? semanticRefCoverageFor(config) : emptySemanticRefCoverage();
  const ordinaryTableLayout = tableLayoutFor(config);
  const tableRefsComplete = requiredTableRefsComplete(ordinaryTableLayout);
  const attestationComplete = config ? attestationsComplete(config) : false;
  const aggregateReceiptTargetComplete = config ? aggregateReceiptTargetCompleteFor(config) : false;
  const submissionContextStatus = submissionContextStatusFor(config);
  const submissionContextComplete = submissionContextStatus === "complete_real_evidence"
    || submissionContextStatus === "complete_non_evidence";
  const candidateRunCount = Array.isArray(config?.candidateRunOrder) ? config.candidateRunOrder.length : 0;
  const firstPassCandidateIds = firstPassCandidateIdsFor(r1121);
  const missingFirstPassCandidateIds = config
    ? missingFirstPassCandidateIdsFor(config, firstPassCandidateIds)
    : [...firstPassCandidateIds];
  const firstPassCandidatesComplete = missingFirstPassCandidateIds.length === 0;
  const missingSemanticRefFamilies = config
    ? missingSemanticRefFamiliesFor(semanticRefCoverage)
    : [...REQUIRED_SEMANTIC_REF_FAMILIES];
  const missingTableRefs = missingTableRefsFor(config, ordinaryTableLayout);
  const missingSubmissionContextFields = missingSubmissionContextFieldsFor(config);
  const configReady = config !== null
    && attestationComplete
    && aggregateReceiptTargetComplete
    && firstPassCandidatesComplete
    && submissionContextComplete
    && tableRefsComplete
    && semanticRefsReady(semanticRefCoverage)
    && candidateRunCount > 0;
  const summary = summaryFor({
    config,
    configReady,
    contractReady,
    firstPassCandidateIds,
  });
  const ordinarySubmitterGuidance = ordinarySubmitterGuidanceFor({
    configReady,
    missingFirstPassCandidateIds,
    missingSemanticRefFamilies,
    missingSubmissionContextFields,
    missingTableRefs,
    submissionContextStatus,
  });

  const output: R1122LocalPrivateConsumerReceiptRunnerConfigIntakeOutput = {
    artifactBoundary: safeBoundary(),
    configIntake: {
      aggregateReceiptTargetStatus: config
        ? aggregateReceiptTargetComplete
          ? "complete"
          : "missing_or_invalid"
        : "not_provided",
      attestationStatus: config ? attestationComplete ? "complete" : "missing_or_false" : "not_provided",
      blockedConfigContent: [
        "private_paths",
        "header_names",
        "source_variable_names",
        "file_names",
        "row_values",
        "participant_identifiers",
        "predictions",
        "coefficients",
        "source_text",
      ],
      candidateRunCountBand: countBand(candidateRunCount),
      configPathConfigured,
      firstPassCandidateStatus: config
        ? firstPassCandidatesComplete
          ? "complete"
          : "missing_or_invalid"
        : "not_provided",
      missingFirstPassCandidateIds,
      missingSemanticRefFamilies,
      missingSubmissionContextFields,
      missingTableRefs,
      ordinarySubmitterGuidance,
      ordinaryTableLayout,
      privateConfigStatus: config ? "available" : "missing",
      privateConfigValuesStored: false,
      requiredTableRefsStatus: config ? tableRefsComplete ? "complete" : "incomplete" : "not_provided",
      r1125LocalPrivateFirstPassRunnerCommand: R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_COMMAND,
      schemaVersion: config?.schemaVersion === PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION ? PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION : null,
      semanticRefCoverage,
      semanticRefCountBand: countBand(countReadySemanticRefs(semanticRefCoverage)),
      submissionContextStatus,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1121: summarizeR1121(r1121),
    },
    packetId: "r1122-local-private-consumer-receipt-runner-config-intake",
    productDisplayAuthorized: false,
    schemaVersion: R1122_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary,
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1122 local private consumer receipt runner config intake failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summaryFor(input: {
  config: PrivateRunnerConfigInput | null;
  configReady: boolean;
  contractReady: boolean;
  firstPassCandidateIds: CandidateId[];
}): R1122LocalPrivateConsumerReceiptRunnerConfigIntakeOutput["summary"] {
  if (!input.contractReady) {
    return {
      conclusion: "local_private_runner_config_waiting_on_contract",
      firstPassCandidateIds: input.firstPassCandidateIds,
      nextAction: "refresh_r1121_contract_before_config_intake",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1122: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      topCandidate: "L1_tiny_glycemia_only",
    };
  }
  if (!input.config) {
    return {
      conclusion: "local_private_runner_config_not_provided",
      firstPassCandidateIds: input.firstPassCandidateIds,
      nextAction: "fill_private_runner_config_before_local_receipt",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1122: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      topCandidate: "L1_tiny_glycemia_only",
    };
  }
  if (input.configReady) {
    return {
      conclusion: "local_private_runner_config_ready_for_local_aggregate_receipt",
      firstPassCandidateIds: input.firstPassCandidateIds,
      nextAction: "run_r1125_local_private_first_pass_runner_then_r1124",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1122: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      topCandidate: "L1_tiny_glycemia_only",
    };
  }
  return {
    conclusion: "local_private_runner_config_incomplete",
    firstPassCandidateIds: input.firstPassCandidateIds,
    nextAction: "complete_private_runner_config_for_l1_l2_w1",
    productDisplayAuthorized: false,
    reviewGptRequiredNow: false,
    rowParsingPerformedByR1122: false,
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    topCandidate: "L1_tiny_glycemia_only",
  };
}

function ordinarySubmitterGuidanceFor(input: {
  configReady: boolean;
  missingFirstPassCandidateIds: CandidateId[];
  missingSemanticRefFamilies: RequiredSemanticRefFamily[];
  missingSubmissionContextFields: RequiredSubmissionContextField[];
  missingTableRefs: RequiredTableRefKey[];
  submissionContextStatus: SubmissionContextStatus;
}): R1122LocalPrivateConsumerReceiptRunnerConfigIntakeOutput["configIntake"]["ordinarySubmitterGuidance"] {
  return {
    acceptedTableLayouts: [...ORDINARY_TABLE_LAYOUTS],
    averageSubmitterAgeBand: "roughly_16_50",
    averageSubmitterFamilyIds: [...ORDINARY_SUBMITTER_SOURCE_FAMILY_IDS],
    minimumEvidenceFloor: {
      eventCount: "10_plus",
      usableRecordCount: "50_plus",
    },
    missingSlotCount: input.missingFirstPassCandidateIds.length
      + input.missingSemanticRefFamilies.length
      + input.missingSubmissionContextFields.length
      + input.missingTableRefs.length,
    missingSlotTypes: missingSlotTypesFor(input),
    privateDetailsStored: false,
    readyForR1125: input.configReady,
    realAggregateStillMissing: true,
    sourceFamilies: ORDINARY_SUBMITTER_SOURCE_FAMILIES.map((family) =>
      ordinarySourceFamilyGuidanceFor(family, input)
    ),
    submissionContext: {
      missingFields: input.missingSubmissionContextFields,
      requiredFields: [...REQUIRED_SUBMISSION_CONTEXT_FIELDS],
      status: input.submissionContextStatus,
    },
  };
}

function ordinarySourceFamilyGuidanceFor(
  family: OrdinarySubmitterSourceFamilyDefinition,
  input: {
    configReady: boolean;
    missingFirstPassCandidateIds: CandidateId[];
    missingSemanticRefFamilies: RequiredSemanticRefFamily[];
    missingTableRefs: RequiredTableRefKey[];
  },
): OrdinarySubmitterSourceFamilyGuidance {
  const missingSlotIds = missingSlotIdsForFamily(family, input);
  return {
    ...family,
    missingSlotIds,
    status: ordinarySourceFamilyStatusFor({
      configReady: input.configReady,
      hasMissingSlot: missingSlotIds.length > 0,
    }),
  };
}

function missingSlotIdsForFamily(
  family: OrdinarySubmitterSourceFamilyDefinition,
  input: {
    missingFirstPassCandidateIds: CandidateId[];
    missingSemanticRefFamilies: RequiredSemanticRefFamily[];
    missingTableRefs: RequiredTableRefKey[];
  },
): MissingSlotId[] {
  const missingCandidateIds = family.requiredForCandidateIds.filter((candidateId) =>
    input.missingFirstPassCandidateIds.includes(candidateId)
  );
  const missingSemanticRefFamilies = family.requiredSemanticRefFamilies.filter((familyId) =>
    input.missingSemanticRefFamilies.includes(familyId)
  );
  const missingTableRefs = family.requiredTableRefs.filter((tableRef) => input.missingTableRefs.includes(tableRef));
  return [
    ...missingCandidateIds,
    ...missingSemanticRefFamilies,
    ...missingTableRefs,
  ];
}

function ordinarySourceFamilyStatusFor(input: {
  configReady: boolean;
  hasMissingSlot: boolean;
}): OrdinarySubmitterSourceFamilyStatus {
  if (input.configReady) return "ready_for_private_runner";
  return input.hasMissingSlot ? "needs_private_config" : "mapped_or_not_blocking";
}

function missingSlotTypesFor(input: {
  missingFirstPassCandidateIds: readonly CandidateId[];
  missingSemanticRefFamilies: readonly RequiredSemanticRefFamily[];
  missingSubmissionContextFields: readonly RequiredSubmissionContextField[];
  missingTableRefs: readonly RequiredTableRefKey[];
}): MissingSlotType[] {
  const types: MissingSlotType[] = [];
  if (input.missingFirstPassCandidateIds.length > 0) types.push("first_pass_candidate");
  if (input.missingSemanticRefFamilies.length > 0) types.push("semantic_ref_family");
  if (input.missingSubmissionContextFields.length > 0) types.push("submission_context_field");
  if (input.missingTableRefs.length > 0) types.push("table_ref");
  return types;
}

async function readConfig(filePath?: string): Promise<PrivateRunnerConfigInput | null> {
  if (!filePath?.trim()) return null;
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("R1122 private runner config must be a JSON object.");
  }
  return parsed as PrivateRunnerConfigInput;
}

function attestationsComplete(config: PrivateRunnerConfigInput): boolean {
  return config.schemaVersion === PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION
    && config.attestations?.localOnly === true
    && config.attestations.noCoefficientEgress === true
    && config.attestations.noHeaderNameEgress === true
    && config.attestations.noParticipantEgress === true
    && config.attestations.noPredictionEgress === true
    && config.attestations.noRowEgress === true
    && config.attestations.noSmallCellEgress === true
    && config.attestations.noSourceTextEgress === true;
}

function aggregateReceiptTargetCompleteFor(config: PrivateRunnerConfigInput): boolean {
  return config.aggregateReceiptTarget?.evaluatorId === "consumer_lab_wearable_aggregate_evaluator_v1"
    && config.aggregateReceiptTarget.schemaVersion === "murph-age-consumer-lab-wearable-aggregate-receipt.v1";
}

function submissionContextStatusFor(config: PrivateRunnerConfigInput | null): SubmissionContextStatus {
  if (!config) return "not_provided";
  const context = config.submissionContext;
  if (!context) return "missing_or_invalid";
  if (
    !isSubmissionEvidenceRole(context.evidenceRole)
    || context.ordinaryConsumerSubmission !== true
    || context.outcomeLinked !== true
    || context.targetAgeBand !== "roughly_16_50"
    || !requiredContextFamiliesPresent(context.priorityInputFamilies)
  ) {
    return "missing_or_invalid";
  }
  return context.evidenceRole === "real_first_pass_evidence"
    ? "complete_real_evidence"
    : "complete_non_evidence";
}

function isSubmissionEvidenceRole(value: unknown): value is SubmissionEvidenceRole {
  return value === "historical_shadow_context"
    || value === "real_first_pass_evidence"
    || value === "synthetic_pipeline_smoke";
}

function requiredContextFamiliesPresent(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const present = new Set(value.filter((item): item is string => typeof item === "string"));
  return REQUIRED_SUBMISSION_CONTEXT_FAMILIES.every((family) => present.has(family));
}

function requiredTableRefsComplete(layout: OrdinaryTableLayout): boolean {
  return layout === "multi_table_or_explicit_refs" || layout === "single_primary_table_fallback";
}

function tableLayoutFor(config: PrivateRunnerConfigInput | null): OrdinaryTableLayout {
  if (!config) return "not_provided";
  if (explicitTableRefsComplete(config)) return "multi_table_or_explicit_refs";
  if (nonEmptyString(config.privateTableRefs?.primaryTableRef)) return "single_primary_table_fallback";
  return "incomplete";
}

function explicitTableRefsComplete(config: PrivateRunnerConfigInput): boolean {
  return nonEmptyString(config.privateTableRefs?.primaryTableRef)
    && nonEmptyString(config.privateTableRefs?.outcomeTableRef)
    && nonEmptyString(config.privateTableRefs?.labTableRef)
    && nonEmptyString(config.privateTableRefs?.wearableTableRef);
}

function firstPassCandidateIdsFor(r1121: unknown | null): CandidateId[] {
  const fromSummary = readStringArrayAt(r1121, ["summary", "firstPassCandidateIds"]).filter(isCandidateId);
  if (fromSummary.length > 0) return dedupeCandidateIds(fromSummary);
  const fromRunner = readStringArrayAt(r1121, ["localPrivateRunner", "firstPassCandidateIds"]).filter(isCandidateId);
  return fromRunner.length > 0
    ? dedupeCandidateIds(fromRunner)
    : [
      "L1_tiny_glycemia_only",
      "L2_common_lab_core_shadow",
      "W1_activity_steps_minutes",
      "QC_missingness_coverage",
    ];
}

function missingFirstPassCandidateIdsFor(
  config: PrivateRunnerConfigInput,
  firstPassCandidateIds: readonly CandidateId[],
): CandidateId[] {
  const configuredCandidateIds = new Set(
    readCandidateRunIds(config.candidateRunOrder).filter(isCandidateId),
  );
  return firstPassCandidateIds.filter((candidateId) => !configuredCandidateIds.has(candidateId));
}

function readCandidateRunIds(candidateRunOrder: unknown[] | undefined): string[] {
  if (!Array.isArray(candidateRunOrder)) return [];
  return candidateRunOrder
    .map((candidate) => readStringAt(candidate, ["candidateId"]))
    .filter((candidateId): candidateId is string => candidateId !== null);
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

function semanticRefCoverageFor(config: PrivateRunnerConfigInput): SemanticRefCoverage {
  const refs = config.privateFieldRefs ?? {};
  return {
    commonLabCore: nonEmptyString(refs.commonLabCore),
    dateOrTimeKey: nonEmptyString(refs.dateOrTimeKey),
    labGlycemia: nonEmptyString(refs.labGlycemia),
    outcomeEvent: nonEmptyString(refs.outcomeEvent),
    personJoinKey: nonEmptyString(refs.personJoinKey),
    vitalsBody: nonEmptyString(refs.vitalsBody),
    wearableActivity: nonEmptyString(refs.wearableActivity),
    wearableRecovery: nonEmptyString(refs.wearableRecovery),
    wearableSleep: nonEmptyString(refs.wearableSleep),
  };
}

function semanticRefsReady(coverage: SemanticRefCoverage): boolean {
  return missingSemanticRefFamiliesFor(coverage).length === 0;
}

function missingSemanticRefFamiliesFor(coverage: SemanticRefCoverage): RequiredSemanticRefFamily[] {
  return REQUIRED_SEMANTIC_REF_FAMILIES.filter((family) => !coverage[family]);
}

function missingTableRefsFor(
  config: PrivateRunnerConfigInput | null,
  layout: OrdinaryTableLayout,
): RequiredTableRefKey[] {
  if (!config) return [...REQUIRED_TABLE_REF_KEYS];
  if (layout === "multi_table_or_explicit_refs" || layout === "single_primary_table_fallback") return [];
  const refs = config.privateTableRefs ?? {};
  return REQUIRED_TABLE_REF_KEYS.filter((tableRef) => !nonEmptyString(refs[tableRef]));
}

function missingSubmissionContextFieldsFor(
  config: PrivateRunnerConfigInput | null,
): RequiredSubmissionContextField[] {
  if (!config?.submissionContext) return [...REQUIRED_SUBMISSION_CONTEXT_FIELDS];
  const context = config.submissionContext;
  const missing: RequiredSubmissionContextField[] = [];
  if (!isSubmissionEvidenceRole(context.evidenceRole)) missing.push("evidenceRole");
  if (context.ordinaryConsumerSubmission !== true) missing.push("ordinaryConsumerSubmission");
  if (context.outcomeLinked !== true) missing.push("outcomeLinked");
  if (!requiredContextFamiliesPresent(context.priorityInputFamilies)) missing.push("priorityInputFamilies");
  if (context.targetAgeBand !== "roughly_16_50") missing.push("targetAgeBand");
  return missing;
}

function countReadySemanticRefs(coverage: SemanticRefCoverage): number {
  return SEMANTIC_CATEGORIES.filter((category) => coverage[category]).length;
}

function emptySemanticRefCoverage(): SemanticRefCoverage {
  return {
    commonLabCore: false,
    dateOrTimeKey: false,
    labGlycemia: false,
    outcomeEvent: false,
    personJoinKey: false,
    vitalsBody: false,
    wearableActivity: false,
    wearableRecovery: false,
    wearableSleep: false,
  };
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function countBand(value: number): CountBand {
  if (value <= 0) return "0";
  if (value === 1) return "1";
  if (value < 10) return "2-9";
  if (value < 100) return "10-99";
  return "100+";
}

function validateInputBoundary(name: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1122 rejected unsafe ${name} input: ${formatFindingCount(findings)}`);
  }
}

function summarizeR1121(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1121_EXPECTED.artifact,
    packetId: readStringAt(value, ["packetId"]) === R1121_EXPECTED.packetId ? R1121_EXPECTED.packetId : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === R1121_EXPECTED.schemaVersion ? R1121_EXPECTED.schemaVersion : null,
    status: value ? "available" : "missing",
  };
}

function inputMatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1121_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1121_EXPECTED.schemaVersion;
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

function safeBoundary(): R1122LocalPrivateConsumerReceiptRunnerConfigIntakeOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    mappingPathStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1122: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    privateConfigPathStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1122: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1122LocalPrivateConsumerReceiptRunnerConfigIntake({
    configPath: process.env.MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1121Path: process.env.MURPH_AGE_R1121_LOCAL_PRIVATE_RUNNER_CONTRACT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    configPathConfigured: output.configIntake.configPathConfigured,
    firstPassCandidateIds: output.summary.firstPassCandidateIds,
    firstPassCandidateStatus: output.configIntake.firstPassCandidateStatus,
    missingFirstPassCandidateIds: output.configIntake.missingFirstPassCandidateIds,
    missingSemanticRefFamilies: output.configIntake.missingSemanticRefFamilies,
    missingSubmissionContextFields: output.configIntake.missingSubmissionContextFields,
    missingTableRefs: output.configIntake.missingTableRefs,
    nextAction: output.summary.nextAction,
    ordinarySubmitterGuidance: output.configIntake.ordinarySubmitterGuidance,
    ordinaryTableLayout: output.configIntake.ordinaryTableLayout,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    r1125LocalPrivateFirstPassRunnerCommand: output.configIntake.r1125LocalPrivateFirstPassRunnerCommand,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1122: output.summary.rowParsingPerformedByR1122,
    schemaVersion: output.schemaVersion,
    semanticRefCountBand: output.configIntake.semanticRefCountBand,
    status: output.status,
    submissionContextStatus: output.configIntake.submissionContextStatus,
    targetInputPriority: output.summary.targetInputPriority,
    topCandidate: output.summary.topCandidate,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1122 local private consumer receipt runner config intake failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
