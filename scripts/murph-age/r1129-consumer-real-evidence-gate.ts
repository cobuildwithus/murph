import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1129_CONSUMER_REAL_EVIDENCE_GATE_SCHEMA_VERSION =
  "murph-age-r1129-consumer-real-evidence-gate.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1129-consumer-real-evidence-gate.latest.json";
const FIRST_PASS_CANDIDATE_IDS = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "QC_missingness_coverage",
] as const;

const INPUTS = {
  r1101: {
    artifact: "r1101-consumer-labs-wearables-loop-executor.latest.json",
    packetId: "r1101-consumer-labs-wearables-loop-executor",
    schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
  },
  r1124: {
    artifact: "r1124-consumer-first-pass-aggregate-metric-intake.latest.json",
    packetId: "r1124-consumer-first-pass-aggregate-metric-intake",
    schemaVersion: "murph-age-r1124-consumer-first-pass-aggregate-metric-intake.v1",
  },
  r1125: {
    artifact: "r1125-local-private-first-pass-aggregate-metric-runner.latest.json",
    packetId: "r1125-local-private-first-pass-aggregate-metric-runner",
    schemaVersion: "murph-age-r1125-local-private-first-pass-aggregate-metric-runner.v1",
  },
  r1126: {
    artifact: "r1126-nhanes-shadow-first-pass-metric-adapter.latest.json",
    packetId: "r1126-nhanes-shadow-first-pass-metric-adapter",
    schemaVersion: "murph-age-r1126-nhanes-shadow-first-pass-metric-adapter.v1",
  },
  r1127: {
    artifact: "r1127-ordinary-consumer-first-pass-submission-handoff.latest.json",
    packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
    schemaVersion: "murph-age-r1127-ordinary-consumer-first-pass-submission-handoff.v1",
  },
  r1128: {
    artifact: "r1128-ordinary-consumer-pipeline-smoke-proof.latest.json",
    packetId: "r1128-ordinary-consumer-pipeline-smoke-proof",
    schemaVersion: "murph-age-r1128-ordinary-consumer-pipeline-smoke-proof.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type FirstPassCandidateId = typeof FIRST_PASS_CANDIDATE_IDS[number];
type GateConclusion =
  | "consumer_real_evidence_gate_ready_for_reviewgpt_delta"
  | "consumer_real_evidence_gate_valid_no_delta_continue_source_search"
  | "consumer_real_evidence_gate_waiting_on_pipeline_refresh"
  | "consumer_real_evidence_gate_waiting_on_real_labs_wearables_aggregate";
type GateNextAction =
  | "collect_or_run_real_outcome_linked_labs_wearables_aggregate_metrics"
  | "record_no_delta_and_continue_consumer_receipt_search"
  | "refresh_r1101_r1124_r1125_r1127_r1128"
  | "send_real_consumer_first_pass_delta_to_reviewgpt";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface RejectedEvidence {
  artifact: string;
  evidenceRole: string;
  reason: string;
}

export interface R1129ConsumerRealEvidenceGateOptions {
  createdAt?: string;
  outputDir?: string;
  r1101Path?: string;
  r1124Path?: string;
  r1125Path?: string;
  r1126Path?: string;
  r1127Path?: string;
  r1128Path?: string;
}

export interface R1129ConsumerRealEvidenceGateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1129: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1129: false;
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
  packetId: "r1129-consumer-real-evidence-gate";
  productDisplayAuthorized: false;
  realEvidenceGate: {
    acceptedTableLayouts: string[];
    blockers: string[];
    currentEvidence: {
      aggregateMetricsProvidedToR1124: boolean;
      firstPassReceiptArtifact: string | null;
      localPrivateRunnerConclusion: string | null;
      r1124Conclusion: string | null;
      r1124SubmissionEvidenceRole: string | null;
      r1128SmokeConclusion: string | null;
      r1128SyntheticEvidenceRole: string | null;
      r1101Conclusion: string | null;
      shadowEvidenceRole: string | null;
    };
    firstPassCandidateIds: FirstPassCandidateId[];
    missingFirstPassCandidateIds: string[];
    priorityInputFamilies: [
      "bloodwork_labs",
      "vitals_body_context",
      "wearable_activity",
    ];
    rejectedAsModelEvidence: RejectedEvidence[];
    reviewGptUse: "only_after_real_r1124_r1104_delta";
    smokePassedTableLayouts: string[];
    sourceFamilyIds: string[];
    targetAgeBand: "roughly_16_50";
  };
  schemaVersion: typeof R1129_CONSUMER_REAL_EVIDENCE_GATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: GateConclusion;
    nextAction: GateNextAction;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1129: false;
    topPriority: "real_outcome_linked_labs_wearables_for_average_16_50_user";
  };
}

export async function runR1129ConsumerRealEvidenceGate(
  options: R1129ConsumerRealEvidenceGateOptions = {},
): Promise<{ output: R1129ConsumerRealEvidenceGateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const requiredInputsReady = inputMatchesExpected("r1101", inputs.r1101)
    && inputMatchesExpected("r1124", inputs.r1124)
    && inputMatchesExpected("r1125", inputs.r1125)
    && inputMatchesExpected("r1127", inputs.r1127)
    && inputMatchesExpected("r1128", inputs.r1128);
  const r1124Conclusion = readStringAt(inputs.r1124, ["summary", "conclusion"]);
  const conclusion = conclusionFor({ r1124Conclusion, requiredInputsReady });
  const output: R1129ConsumerRealEvidenceGateOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1129-consumer-real-evidence-gate",
    productDisplayAuthorized: false,
    realEvidenceGate: {
      acceptedTableLayouts: acceptedTableLayoutsFor(inputs),
      blockers: blockersFor({ conclusion, inputs, requiredInputsReady }),
      currentEvidence: {
        aggregateMetricsProvidedToR1124: readBooleanAt(inputs.r1124, [
          "metricIntake",
          "aggregateMetricsProvided",
        ]) === true,
        firstPassReceiptArtifact: readStringAt(inputs.r1124, ["metricIntake", "receiptArtifact"]),
        localPrivateRunnerConclusion: readStringAt(inputs.r1125, ["summary", "conclusion"]),
        r1101Conclusion: readStringAt(inputs.r1101, ["summary", "conclusion"]),
        r1124Conclusion,
        r1124SubmissionEvidenceRole: readStringAt(inputs.r1124, ["metricIntake", "submissionEvidenceRole"]),
        r1128SmokeConclusion: readStringAt(inputs.r1128, ["summary", "conclusion"]),
        r1128SyntheticEvidenceRole: readStringAt(inputs.r1128, ["smokeProof", "syntheticEvidenceRole"]),
        shadowEvidenceRole: readStringAt(inputs.r1126, ["shadowAdapter", "evidenceRole"]),
      },
      firstPassCandidateIds: firstPassCandidateIdsFor(inputs.r1124),
      missingFirstPassCandidateIds: readStringArrayAt(inputs.r1124, [
        "metricIntake",
        "missingRequiredCandidateIds",
      ]),
      priorityInputFamilies: [
        "bloodwork_labs",
        "vitals_body_context",
        "wearable_activity",
      ],
      rejectedAsModelEvidence: rejectedEvidenceFor(inputs),
      reviewGptUse: "only_after_real_r1124_r1104_delta",
      smokePassedTableLayouts: readStringArrayAt(inputs.r1128, [
        "smokeProof",
        "ordinaryTableLayoutsSmokePassed",
      ]),
      sourceFamilyIds: sourceFamilyIdsFor(inputs),
      targetAgeBand: "roughly_16_50",
    },
    schemaVersion: R1129_CONSUMER_REAL_EVIDENCE_GATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextAction: nextActionFor(conclusion),
      productDisplayAuthorized: false,
      reviewGptRequiredNow: conclusion === "consumer_real_evidence_gate_ready_for_reviewgpt_delta",
      rowParsingPerformedByR1129: false,
      topPriority: "real_outcome_linked_labs_wearables_for_average_16_50_user",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1129 consumer real evidence gate failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  r1124Conclusion: string | null;
  requiredInputsReady: boolean;
}): GateConclusion {
  if (!input.requiredInputsReady) {
    return "consumer_real_evidence_gate_waiting_on_pipeline_refresh";
  }
  if (input.r1124Conclusion === "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt") {
    return "consumer_real_evidence_gate_ready_for_reviewgpt_delta";
  }
  if (input.r1124Conclusion === "consumer_first_pass_aggregate_receipt_valid_but_no_delta") {
    return "consumer_real_evidence_gate_valid_no_delta_continue_source_search";
  }
  return "consumer_real_evidence_gate_waiting_on_real_labs_wearables_aggregate";
}

function nextActionFor(conclusion: GateConclusion): GateNextAction {
  if (conclusion === "consumer_real_evidence_gate_ready_for_reviewgpt_delta") {
    return "send_real_consumer_first_pass_delta_to_reviewgpt";
  }
  if (conclusion === "consumer_real_evidence_gate_valid_no_delta_continue_source_search") {
    return "record_no_delta_and_continue_consumer_receipt_search";
  }
  if (conclusion === "consumer_real_evidence_gate_waiting_on_pipeline_refresh") {
    return "refresh_r1101_r1124_r1125_r1127_r1128";
  }
  return "collect_or_run_real_outcome_linked_labs_wearables_aggregate_metrics";
}

function blockersFor(input: {
  conclusion: GateConclusion;
  inputs: Record<InputKey, unknown | null>;
  requiredInputsReady: boolean;
}): string[] {
  if (input.conclusion === "consumer_real_evidence_gate_waiting_on_pipeline_refresh") {
    return ["refresh_required_pipeline_artifacts_before_real_evidence_gate"];
  }
  if (input.conclusion === "consumer_real_evidence_gate_ready_for_reviewgpt_delta") {
    return [];
  }
  if (input.conclusion === "consumer_real_evidence_gate_valid_no_delta_continue_source_search") {
    return ["stronger_or_independent_real_consumer_receipt_needed"];
  }

  const blockers = ["real_outcome_linked_labs_wearables_aggregate_missing"];
  if (readBooleanAt(input.inputs.r1124, ["metricIntake", "aggregateMetricsProvided"]) !== true) {
    blockers.push("r1124_first_pass_aggregate_metrics_not_provided");
  }
  if (readStringArrayAt(input.inputs.r1124, ["metricIntake", "missingRequiredCandidateIds"]).length > 0) {
    blockers.push("l1_l2_w1_qc_first_pass_metrics_incomplete");
  }
  if (
    readBooleanAt(input.inputs.r1124, ["metricIntake", "aggregateMetricsProvided"]) === true
    && readStringAt(input.inputs.r1124, ["metricIntake", "submissionEvidenceRole"]) !== "real_first_pass_evidence"
  ) {
    blockers.push("r1124_aggregate_metrics_not_real_first_pass_evidence");
  }
  if (readStringArrayAt(input.inputs.r1128, ["smokeProof", "ordinaryTableLayoutsSmokePassed"]).length === 0) {
    blockers.push("ordinary_submission_layout_smoke_proof_missing");
  }
  if (!input.requiredInputsReady) {
    blockers.push("pipeline_artifact_identity_mismatch");
  }
  return blockers;
}

function rejectedEvidenceFor(inputs: Record<InputKey, unknown | null>): RejectedEvidence[] {
  const rejected: RejectedEvidence[] = [];
  const shadowRole = readStringAt(inputs.r1126, ["shadowAdapter", "evidenceRole"]);
  if (inputMatchesExpected("r1126", inputs.r1126) && shadowRole) {
    rejected.push({
      artifact: INPUTS.r1126.artifact,
      evidenceRole: shadowRole,
      reason: "historical_shadow_context_not_consumer_16_50_outcome_linked_validation",
    });
  }
  const smokeRole = readStringAt(inputs.r1128, ["smokeProof", "syntheticEvidenceRole"]);
  if (inputMatchesExpected("r1128", inputs.r1128) && smokeRole) {
    rejected.push({
      artifact: INPUTS.r1128.artifact,
      evidenceRole: smokeRole,
      reason: "synthetic_pipeline_smoke_proof_not_model_evidence",
    });
  }
  return rejected;
}

function sourceFamilyIdsFor(inputs: Record<InputKey, unknown | null>): string[] {
  const fromR1127 = readStringArrayAt(inputs.r1127, ["summary", "ordinarySourceFamilyIds"]);
  if (fromR1127.length > 0) return fromR1127;
  return readStringArrayAt(inputs.r1101, ["summary", "ordinaryConsumerSourceFamilyIds"]);
}

function acceptedTableLayoutsFor(inputs: Record<InputKey, unknown | null>): string[] {
  const fromR1127 = readStringArrayAt(inputs.r1127, ["ordinarySubmissionHandoff", "ordinaryTableLayouts"]);
  if (fromR1127.length > 0) return fromR1127;
  return readStringArrayAt(inputs.r1101, ["summary", "ordinaryConsumerTableLayouts"]);
}

function firstPassCandidateIdsFor(r1124: unknown | null): FirstPassCandidateId[] {
  const fromR1124 = readStringArrayAt(r1124, ["metricIntake", "firstPassCandidateIds"])
    .filter(isFirstPassCandidateId);
  return missingRequiredCandidates(fromR1124).length === 0 ? fromR1124 : [...FIRST_PASS_CANDIDATE_IDS];
}

function missingRequiredCandidates(candidateIds: readonly string[]): FirstPassCandidateId[] {
  const present = new Set(candidateIds);
  return FIRST_PASS_CANDIDATE_IDS.filter((candidateId) => !present.has(candidateId));
}

function isFirstPassCandidateId(value: string): value is FirstPassCandidateId {
  return (FIRST_PASS_CANDIDATE_IDS as readonly string[]).includes(value);
}

async function readInputs(options: R1129ConsumerRealEvidenceGateOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1101: await readJsonIfPresent(options.r1101Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1101.artifact)),
    r1124: await readJsonIfPresent(options.r1124Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1124.artifact)),
    r1125: await readJsonIfPresent(options.r1125Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1125.artifact)),
    r1126: await readJsonIfPresent(options.r1126Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1126.artifact)),
    r1127: await readJsonIfPresent(options.r1127Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1127.artifact)),
    r1128: await readJsonIfPresent(options.r1128Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1128.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1129 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
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

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
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

function safeBoundary(): R1129ConsumerRealEvidenceGateOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1129: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1129: false,
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
  const { output } = await runR1129ConsumerRealEvidenceGate({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1101Path: process.env.MURPH_AGE_R1101_CONSUMER_LOOP_EXECUTOR_PATH,
    r1124Path: process.env.MURPH_AGE_R1124_CONSUMER_FIRST_PASS_METRIC_INTAKE_PATH,
    r1125Path: process.env.MURPH_AGE_R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_PATH,
    r1126Path: process.env.MURPH_AGE_R1126_NHANES_SHADOW_FIRST_PASS_ADAPTER_PATH,
    r1127Path: process.env.MURPH_AGE_R1127_ORDINARY_CONSUMER_SUBMISSION_HANDOFF_PATH,
    r1128Path: process.env.MURPH_AGE_R1128_ORDINARY_CONSUMER_PIPELINE_SMOKE_PROOF_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    blockers: output.realEvidenceGate.blockers,
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    rejectedAsModelEvidence: output.realEvidenceGate.rejectedAsModelEvidence.map((item) => item.artifact),
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1129: output.summary.rowParsingPerformedByR1129,
    schemaVersion: output.schemaVersion,
    smokePassedTableLayouts: output.realEvidenceGate.smokePassedTableLayouts,
    status: output.status,
    topPriority: output.summary.topPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1129 consumer real evidence gate failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
