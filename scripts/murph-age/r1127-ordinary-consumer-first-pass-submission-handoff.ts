import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1127_ORDINARY_CONSUMER_FIRST_PASS_SUBMISSION_HANDOFF_SCHEMA_VERSION =
  "murph-age-r1127-ordinary-consumer-first-pass-submission-handoff.v1" as const;

const SUBMISSION_PLAN_SCHEMA_VERSION =
  "murph-age-r1127-fillable-ordinary-consumer-first-pass-submission-plan.v1" as const;
const PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION =
  "murph-age-local-private-consumer-receipt-runner-config.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1127-ordinary-consumer-first-pass-submission-handoff.latest.json";
const SUBMISSION_PLAN_FILE_NAME = "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json";
const R1121_PRIVATE_CONFIG_TEMPLATE_ARTIFACT =
  "r1121-fillable-local-private-consumer-receipt-runner-config.json" as const;
const R1122_CONFIG_INTAKE_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts" as const;
const R1125_EXECUTION_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts" as const;

const INPUTS = {
  r1101: {
    artifact: "r1101-consumer-labs-wearables-loop-executor.latest.json",
    packetId: "r1101-consumer-labs-wearables-loop-executor",
    schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
  },
  r1121: {
    artifact: "r1121-local-private-consumer-receipt-runner-contract.latest.json",
    packetId: "r1121-local-private-consumer-receipt-runner-contract",
    schemaVersion: "murph-age-r1121-local-private-consumer-receipt-runner-contract.v1",
  },
  r1125: {
    artifact: "r1125-local-private-first-pass-aggregate-metric-runner.latest.json",
    packetId: "r1125-local-private-first-pass-aggregate-metric-runner",
    schemaVersion: "murph-age-r1125-local-private-first-pass-aggregate-metric-runner.v1",
  },
} as const;

const FIRST_PASS_CANDIDATE_IDS = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "QC_missingness_coverage",
] as const;
const REQUIRED_PRIVATE_FIELD_REF_FAMILIES = [
  "personJoinKey",
  "dateOrTimeKey",
  "outcomeEvent",
  "labGlycemia",
  "commonLabCore",
  "vitalsBody",
  "wearableActivity",
] as const;
const REQUIRED_PRIVATE_TABLE_REFS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
] as const;
const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
] as const;

type InputKey = keyof typeof INPUTS;
type FirstPassCandidateId = typeof FIRST_PASS_CANDIDATE_IDS[number];
type RequiredFieldRefFamily = typeof REQUIRED_PRIVATE_FIELD_REF_FAMILIES[number];
type RequiredTableRef = typeof REQUIRED_PRIVATE_TABLE_REFS[number];
type OrdinarySourceFamilyId = typeof ORDINARY_SOURCE_FAMILY_IDS[number];
type OrdinaryTableLayout =
  | "multi_table_or_explicit_refs"
  | "single_primary_table_fallback";
type OrdinaryPrivateInputKind =
  | "bloodwork_table_or_lab_portal_export"
  | "body_or_vitals_table"
  | "daily_wearable_activity_export_or_spreadsheet"
  | "outcome_or_followup_table"
  | "stable_join_key_and_date_fields";

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

interface SemanticFieldFamily {
  familyId: RequiredFieldRefFamily;
  requiredForCandidateIds: FirstPassCandidateId[];
  role:
    | "join_records_without_egress"
    | "time_alignment_only"
    | "outcome_linkage_only"
    | "lab_glycemia_first_pass"
    | "common_lab_core_shadow"
    | "vitals_body_context_shadow"
    | "wearable_activity_first_pass";
}

interface OrdinarySourceFamily {
  acceptableForAverageUser: true;
  familyId: OrdinarySourceFamilyId;
  inputKind: OrdinaryPrivateInputKind;
  privateDetailsStored: false;
  requiredForCandidateIds: FirstPassCandidateId[];
  requiredPrivateFieldRefFamilies: RequiredFieldRefFamily[];
  requiredPrivateTableRefs: RequiredTableRef[];
  role:
    | "bloodwork_glycemia_signal"
    | "common_bloodwork_shadow_signal"
    | "join_and_time_alignment"
    | "outcome_linkage"
    | "vitals_body_context"
    | "wearable_activity_signal";
}

interface FillableSubmissionPlan {
  artifactBoundary: R1127OrdinaryConsumerFirstPassSubmissionHandoffOutput["artifactBoundary"];
  candidateRunOrder: FirstPassCandidateId[];
  commands: {
    configIntakeCommand: typeof R1122_CONFIG_INTAKE_COMMAND;
    executionCommand: typeof R1125_EXECUTION_COMMAND;
  };
  minimumEvidenceFloor: {
    eventCount: "10_plus";
    usableRecordCount: "50_plus";
  };
  packetId: "r1127-fillable-ordinary-consumer-first-pass-submission-plan";
  privateConfigSkeleton: {
    privateFieldRefs: Record<RequiredFieldRefFamily, "">;
    privateTableRefs: Record<RequiredTableRef, "">;
    schemaVersion: typeof PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION;
    submissionContext: SubmissionContext;
  };
  ordinarySourceFamilies: OrdinarySourceFamily[];
  ordinaryTableLayouts: OrdinaryTableLayout[];
  requiredPrivateFieldRefFamilies: RequiredFieldRefFamily[];
  requiredPrivateTableRefs: RequiredTableRef[];
  schemaVersion: typeof SUBMISSION_PLAN_SCHEMA_VERSION;
  targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
}

export interface R1127OrdinaryConsumerFirstPassSubmissionHandoffOptions {
  createdAt?: string;
  outputDir?: string;
  r1101Path?: string;
  r1121Path?: string;
  r1125Path?: string;
}

export interface R1127OrdinaryConsumerFirstPassSubmissionHandoffOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1127: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1127: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  ordinarySubmissionHandoff: {
    acceptedInputProfile: "consumer_bloodwork_labs_wearables_16_50_first";
    commands: {
      configIntakeCommand: typeof R1122_CONFIG_INTAKE_COMMAND;
      executionCommand: typeof R1125_EXECUTION_COMMAND;
    };
    firstPassCandidateIds: FirstPassCandidateId[];
    minimumEvidenceFloor: {
      eventCount: "10_plus";
      usableRecordCount: "50_plus";
    };
    ordinarySourceFamilies: OrdinarySourceFamily[];
    ordinaryTableLayouts: OrdinaryTableLayout[];
    privateConfigTemplateArtifact: typeof R1121_PRIVATE_CONFIG_TEMPLATE_ARTIFACT;
    privateValuesStored: false;
    requiredPrivateFieldRefFamilies: RequiredFieldRefFamily[];
    requiredPrivateTableRefs: RequiredTableRef[];
    semanticFieldFamilies: SemanticFieldFamily[];
    submissionPlanArtifact: typeof SUBMISSION_PLAN_FILE_NAME | null;
  };
  packetId: "r1127-ordinary-consumer-first-pass-submission-handoff";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1127_ORDINARY_CONSUMER_FIRST_PASS_SUBMISSION_HANDOFF_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "ordinary_consumer_first_pass_submission_handoff_ready"
      | "ordinary_consumer_first_pass_submission_handoff_waiting_on_loop_or_contract";
    nextAction:
      | "fill_private_config_with_ordinary_labs_wearable_refs_then_run_r1125"
      | "refresh_r1101_r1121_r1125_before_submission_handoff";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1127: false;
    ordinarySourceFamilyIds: OrdinarySourceFamilyId[];
    submissionPlanArtifact: typeof SUBMISSION_PLAN_FILE_NAME | null;
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1127OrdinaryConsumerFirstPassSubmissionHandoff(
  options: R1127OrdinaryConsumerFirstPassSubmissionHandoffOptions = {},
): Promise<{
  output: R1127OrdinaryConsumerFirstPassSubmissionHandoffOutput;
  outputPath: string;
  submissionPlanPath: string | null;
}> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);
  const ready = inputsReadyForSubmissionHandoff(inputs);
  const submissionPlan = ready ? createFillableSubmissionPlan() : null;
  const output: R1127OrdinaryConsumerFirstPassSubmissionHandoffOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    ordinarySubmissionHandoff: {
      acceptedInputProfile: "consumer_bloodwork_labs_wearables_16_50_first",
      commands: {
        configIntakeCommand: R1122_CONFIG_INTAKE_COMMAND,
        executionCommand: R1125_EXECUTION_COMMAND,
      },
      firstPassCandidateIds: [...FIRST_PASS_CANDIDATE_IDS],
      minimumEvidenceFloor: {
        eventCount: "10_plus",
        usableRecordCount: "50_plus",
      },
      ordinarySourceFamilies: ordinarySourceFamilies(),
      ordinaryTableLayouts: ordinaryTableLayouts(),
      privateConfigTemplateArtifact: R1121_PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
      privateValuesStored: false,
      requiredPrivateFieldRefFamilies: [...REQUIRED_PRIVATE_FIELD_REF_FAMILIES],
      requiredPrivateTableRefs: [...REQUIRED_PRIVATE_TABLE_REFS],
      semanticFieldFamilies: semanticFieldFamilies(),
      submissionPlanArtifact: submissionPlan ? SUBMISSION_PLAN_FILE_NAME : null,
    },
    packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
    productDisplayAuthorized: false,
    schemaVersion: R1127_ORDINARY_CONSUMER_FIRST_PASS_SUBMISSION_HANDOFF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "ordinary_consumer_first_pass_submission_handoff_ready"
        : "ordinary_consumer_first_pass_submission_handoff_waiting_on_loop_or_contract",
      nextAction: ready
        ? "fill_private_config_with_ordinary_labs_wearable_refs_then_run_r1125"
        : "refresh_r1101_r1121_r1125_before_submission_handoff",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1127: false,
      ordinarySourceFamilyIds: [...ORDINARY_SOURCE_FAMILY_IDS],
      submissionPlanArtifact: submissionPlan ? SUBMISSION_PLAN_FILE_NAME : null,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...(submissionPlan ? findForbiddenAggregateEgress(submissionPlan) : []),
  ];
  if (findings.length > 0) {
    throw new Error(`R1127 ordinary consumer first-pass submission handoff failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const submissionPlanPath = submissionPlan ? path.join(outputDir, SUBMISSION_PLAN_FILE_NAME) : null;
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  if (submissionPlanPath && submissionPlan) {
    await writeFile(submissionPlanPath, `${JSON.stringify(submissionPlan, null, 2)}\n`);
  }
  return { output, outputPath, submissionPlanPath };
}

function inputsReadyForSubmissionHandoff(inputs: Record<InputKey, unknown | null>): boolean {
  return inputMatchesExpected("r1101", inputs.r1101)
    && inputMatchesExpected("r1121", inputs.r1121)
    && inputMatchesExpected("r1125", inputs.r1125)
    && readStringAt(inputs.r1101, ["summary", "conclusion"]) === "consumer_loop_ready_awaiting_aggregate_receipt"
    && (
      readStringAt(inputs.r1121, ["summary", "conclusion"])
        === "local_private_consumer_receipt_runner_contract_ready_awaiting_mapping"
      || readStringAt(inputs.r1121, ["summary", "conclusion"])
        === "local_private_consumer_receipt_runner_contract_ready_for_execution"
    )
    && readStringAt(inputs.r1125, ["summary", "conclusion"]) === "local_private_first_pass_runner_missing_config"
    && firstPassCandidatesComplete(readStringArrayAt(inputs.r1125, [
      "privateExecution",
      "firstPassCandidateIds",
    ]));
}

function createFillableSubmissionPlan(): FillableSubmissionPlan {
  return {
    artifactBoundary: safeBoundary(),
    candidateRunOrder: [...FIRST_PASS_CANDIDATE_IDS],
    commands: {
      configIntakeCommand: R1122_CONFIG_INTAKE_COMMAND,
      executionCommand: R1125_EXECUTION_COMMAND,
    },
    minimumEvidenceFloor: {
      eventCount: "10_plus",
      usableRecordCount: "50_plus",
    },
    packetId: "r1127-fillable-ordinary-consumer-first-pass-submission-plan",
    privateConfigSkeleton: {
      privateFieldRefs: Object.fromEntries(
        REQUIRED_PRIVATE_FIELD_REF_FAMILIES.map((family) => [family, ""]),
      ) as Record<RequiredFieldRefFamily, "">,
      privateTableRefs: Object.fromEntries(
        REQUIRED_PRIVATE_TABLE_REFS.map((tableRef) => [tableRef, ""]),
      ) as Record<RequiredTableRef, "">,
      schemaVersion: PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION,
      submissionContext: realSubmissionContext(),
    },
    ordinarySourceFamilies: ordinarySourceFamilies(),
    ordinaryTableLayouts: ordinaryTableLayouts(),
    requiredPrivateFieldRefFamilies: [...REQUIRED_PRIVATE_FIELD_REF_FAMILIES],
    requiredPrivateTableRefs: [...REQUIRED_PRIVATE_TABLE_REFS],
    schemaVersion: SUBMISSION_PLAN_SCHEMA_VERSION,
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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

function semanticFieldFamilies(): SemanticFieldFamily[] {
  return [
    {
      familyId: "personJoinKey",
      requiredForCandidateIds: [...FIRST_PASS_CANDIDATE_IDS],
      role: "join_records_without_egress",
    },
    {
      familyId: "dateOrTimeKey",
      requiredForCandidateIds: [...FIRST_PASS_CANDIDATE_IDS],
      role: "time_alignment_only",
    },
    {
      familyId: "outcomeEvent",
      requiredForCandidateIds: [...FIRST_PASS_CANDIDATE_IDS],
      role: "outcome_linkage_only",
    },
    {
      familyId: "labGlycemia",
      requiredForCandidateIds: ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"],
      role: "lab_glycemia_first_pass",
    },
    {
      familyId: "commonLabCore",
      requiredForCandidateIds: ["L2_common_lab_core_shadow"],
      role: "common_lab_core_shadow",
    },
    {
      familyId: "vitalsBody",
      requiredForCandidateIds: ["L2_common_lab_core_shadow"],
      role: "vitals_body_context_shadow",
    },
    {
      familyId: "wearableActivity",
      requiredForCandidateIds: ["W1_activity_steps_minutes"],
      role: "wearable_activity_first_pass",
    },
  ];
}

function ordinaryTableLayouts(): OrdinaryTableLayout[] {
  return ["single_primary_table_fallback", "multi_table_or_explicit_refs"];
}

function ordinarySourceFamilies(): OrdinarySourceFamily[] {
  return [
    {
      acceptableForAverageUser: true,
      familyId: "join_time_alignment",
      inputKind: "stable_join_key_and_date_fields",
      privateDetailsStored: false,
      requiredForCandidateIds: [...FIRST_PASS_CANDIDATE_IDS],
      requiredPrivateFieldRefFamilies: ["personJoinKey", "dateOrTimeKey"],
      requiredPrivateTableRefs: [...REQUIRED_PRIVATE_TABLE_REFS],
      role: "join_and_time_alignment",
    },
    {
      acceptableForAverageUser: true,
      familyId: "outcome_linkage",
      inputKind: "outcome_or_followup_table",
      privateDetailsStored: false,
      requiredForCandidateIds: [...FIRST_PASS_CANDIDATE_IDS],
      requiredPrivateFieldRefFamilies: ["outcomeEvent"],
      requiredPrivateTableRefs: ["outcomeTableRef"],
      role: "outcome_linkage",
    },
    {
      acceptableForAverageUser: true,
      familyId: "bloodwork_glycemia",
      inputKind: "bloodwork_table_or_lab_portal_export",
      privateDetailsStored: false,
      requiredForCandidateIds: ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"],
      requiredPrivateFieldRefFamilies: ["labGlycemia"],
      requiredPrivateTableRefs: ["labTableRef"],
      role: "bloodwork_glycemia_signal",
    },
    {
      acceptableForAverageUser: true,
      familyId: "common_bloodwork_core",
      inputKind: "bloodwork_table_or_lab_portal_export",
      privateDetailsStored: false,
      requiredForCandidateIds: ["L2_common_lab_core_shadow"],
      requiredPrivateFieldRefFamilies: ["commonLabCore"],
      requiredPrivateTableRefs: ["labTableRef"],
      role: "common_bloodwork_shadow_signal",
    },
    {
      acceptableForAverageUser: true,
      familyId: "vitals_body_context",
      inputKind: "body_or_vitals_table",
      privateDetailsStored: false,
      requiredForCandidateIds: ["L2_common_lab_core_shadow"],
      requiredPrivateFieldRefFamilies: ["vitalsBody"],
      requiredPrivateTableRefs: ["labTableRef", "primaryTableRef"],
      role: "vitals_body_context",
    },
    {
      acceptableForAverageUser: true,
      familyId: "wearable_activity_daily",
      inputKind: "daily_wearable_activity_export_or_spreadsheet",
      privateDetailsStored: false,
      requiredForCandidateIds: ["W1_activity_steps_minutes"],
      requiredPrivateFieldRefFamilies: ["wearableActivity"],
      requiredPrivateTableRefs: ["wearableTableRef"],
      role: "wearable_activity_signal",
    },
  ];
}

async function readInputs(
  options: R1127OrdinaryConsumerFirstPassSubmissionHandoffOptions,
): Promise<Record<InputKey, unknown | null>> {
  return {
    r1101: await readJsonIfPresent(options.r1101Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1101.artifact)),
    r1121: await readJsonIfPresent(options.r1121Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1121.artifact)),
    r1125: await readJsonIfPresent(options.r1125Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1125.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1127 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
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

function firstPassCandidatesComplete(candidateIds: readonly string[]): boolean {
  const present = new Set(candidateIds);
  return FIRST_PASS_CANDIDATE_IDS.every((candidateId) => present.has(candidateId));
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown | null, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
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

function safeBoundary(): R1127OrdinaryConsumerFirstPassSubmissionHandoffOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1127: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1127: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1127OrdinaryConsumerFirstPassSubmissionHandoff({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1101Path: process.env.MURPH_AGE_R1101_CONSUMER_LOOP_EXECUTOR_PATH,
    r1121Path: process.env.MURPH_AGE_R1121_LOCAL_PRIVATE_RUNNER_CONTRACT_PATH,
    r1125Path: process.env.MURPH_AGE_R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    firstPassCandidateIds: output.ordinarySubmissionHandoff.firstPassCandidateIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    requiredPrivateFieldRefFamilies: output.ordinarySubmissionHandoff.requiredPrivateFieldRefFamilies,
    requiredPrivateTableRefs: output.ordinarySubmissionHandoff.requiredPrivateTableRefs,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1127: output.summary.rowParsingPerformedByR1127,
    schemaVersion: output.schemaVersion,
    status: output.status,
    ordinarySourceFamilyIds: output.summary.ordinarySourceFamilyIds,
    ordinaryTableLayouts: output.ordinarySubmissionHandoff.ordinaryTableLayouts,
    submissionPlanArtifact: output.summary.submissionPlanArtifact,
    targetInputPriority: output.summary.targetInputPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1127 ordinary consumer first-pass submission handoff failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
