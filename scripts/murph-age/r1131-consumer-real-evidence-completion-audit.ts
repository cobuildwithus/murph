import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1131_CONSUMER_REAL_EVIDENCE_COMPLETION_AUDIT_SCHEMA_VERSION =
  "murph-age-r1131-consumer-real-evidence-completion-audit.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1131-consumer-real-evidence-completion-audit.latest.json";

const INPUTS = {
  r1076: {
    artifact: "r1076-current-autoresearch-loop-executor.latest.json",
    packetId: "r1076-current-autoresearch-loop-executor",
    schemaVersion: "murph-age-r1076-current-autoresearch-loop-executor.v1",
  },
  r1125: {
    artifact: "r1125-local-private-first-pass-aggregate-metric-runner.latest.json",
    packetId: "r1125-local-private-first-pass-aggregate-metric-runner",
    schemaVersion: "murph-age-r1125-local-private-first-pass-aggregate-metric-runner.v1",
  },
  r1129: {
    artifact: "r1129-consumer-real-evidence-gate.latest.json",
    packetId: "r1129-consumer-real-evidence-gate",
    schemaVersion: "murph-age-r1129-consumer-real-evidence-gate.v1",
  },
  r1130: {
    artifact: "r1130-ordinary-consumer-real-evidence-handoff.latest.json",
    packetId: "r1130-ordinary-consumer-real-evidence-handoff",
    schemaVersion: "murph-age-r1130-ordinary-consumer-real-evidence-handoff.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type RequirementStatus = "missing" | "satisfied" | "weakly_verified";
type AuditConclusion =
  | "consumer_real_evidence_completion_audit_blocked_on_real_aggregate"
  | "consumer_real_evidence_completion_audit_ready_for_completion"
  | "consumer_real_evidence_completion_audit_waiting_on_refresh";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface AuditChecklistItem {
  evidenceArtifacts: string[];
  requirementId:
    | "active_autoresearch_loop_has_concrete_next_action"
    | "ordinary_16_50_submission_path_available"
    | "privacy_and_product_gate_closed"
    | "real_outcome_linked_labs_wearables_aggregate_exists"
    | "wearable_and_bloodwork_priority_visible";
  status: RequirementStatus;
  why: string;
}

export interface R1131ConsumerRealEvidenceCompletionAuditOptions {
  createdAt?: string;
  outputDir?: string;
  r1076Path?: string;
  r1125Path?: string;
  r1129Path?: string;
  r1130Path?: string;
}

export interface R1131ConsumerRealEvidenceCompletionAuditOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
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
    rowParsingPerformedByR1131: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  completionAudit: {
    blockers: string[];
    checklist: AuditChecklistItem[];
    goalAchieved: boolean;
    missingRequirementIds: AuditChecklistItem["requirementId"][];
    nextConcreteAction: string | null;
    readyToMarkComplete: boolean;
    restatedObjective: "build_murph_age_model_prioritizing_ordinary_16_50_labs_wearables";
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1131-consumer-real-evidence-completion-audit";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1131_CONSUMER_REAL_EVIDENCE_COMPLETION_AUDIT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: AuditConclusion;
    goalAchieved: boolean;
    nextAction: string | null;
    productDisplayAuthorized: false;
    readyToMarkComplete: boolean;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1131: false;
    topMissingRequirement: AuditChecklistItem["requirementId"] | null;
  };
}

export async function runR1131ConsumerRealEvidenceCompletionAudit(
  options: R1131ConsumerRealEvidenceCompletionAuditOptions = {},
): Promise<{ output: R1131ConsumerRealEvidenceCompletionAuditOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);
  const requiredInputsReady = inputMatchesExpected("r1076", inputs.r1076)
    && inputMatchesExpected("r1125", inputs.r1125)
    && inputMatchesExpected("r1129", inputs.r1129)
    && inputMatchesExpected("r1130", inputs.r1130);
  const checklist = checklistFor({ inputs, requiredInputsReady });
  const missingRequirementIds = checklist
    .filter((item) => item.status !== "satisfied")
    .map((item) => item.requirementId);
  const blockers = blockersFor(inputs, requiredInputsReady);
  const goalAchieved = requiredInputsReady && missingRequirementIds.length === 0 && blockers.length === 0;
  const nextConcreteAction = readStringAt(inputs.r1076, ["summary", "nextAction"])
    ?? readStringAt(inputs.r1130, ["summary", "nextAction"]);
  const output: R1131ConsumerRealEvidenceCompletionAuditOutput = {
    artifactBoundary: safeBoundary(),
    completionAudit: {
      blockers,
      checklist,
      goalAchieved,
      missingRequirementIds,
      nextConcreteAction,
      readyToMarkComplete: goalAchieved,
      restatedObjective: "build_murph_age_model_prioritizing_ordinary_16_50_labs_wearables",
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1131-consumer-real-evidence-completion-audit",
    productDisplayAuthorized: false,
    schemaVersion: R1131_CONSUMER_REAL_EVIDENCE_COMPLETION_AUDIT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: conclusionFor({ goalAchieved, missingRequirementIds, requiredInputsReady }),
      goalAchieved,
      nextAction: nextConcreteAction,
      productDisplayAuthorized: false,
      readyToMarkComplete: goalAchieved,
      reviewGptRequiredNow: readBooleanAt(inputs.r1076, ["summary", "reviewGptRequiredNow"]) === true,
      rowParsingPerformedByR1131: false,
      topMissingRequirement: missingRequirementIds[0] ?? null,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1131 consumer real evidence completion audit failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function checklistFor(input: {
  inputs: Record<InputKey, unknown | null>;
  requiredInputsReady: boolean;
}): AuditChecklistItem[] {
  if (!input.requiredInputsReady) {
    return baseChecklist("weakly_verified");
  }
  return [
    {
      evidenceArtifacts: [INPUTS.r1076.artifact],
      requirementId: "active_autoresearch_loop_has_concrete_next_action",
      status: readStringAt(input.inputs.r1076, ["summary", "nextAction"])
        === "complete_private_config_for_real_outcome_linked_labs_wearables"
        ? "satisfied"
        : "weakly_verified",
      why: "R1076 should name the concrete next action for the active consumer labs/wearables branch.",
    },
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1129.artifact, INPUTS.r1130.artifact],
      requirementId: "wearable_and_bloodwork_priority_visible",
      status: priorityVisible(input.inputs) ? "satisfied" : "missing",
      why: "The active path must prioritize bloodwork/labs, vitals/body context, and wearable activity.",
    },
    {
      evidenceArtifacts: [INPUTS.r1130.artifact],
      requirementId: "ordinary_16_50_submission_path_available",
      status: ordinarySubmissionPathVisible(input.inputs.r1130) ? "satisfied" : "missing",
      why: "The handoff must target ordinary roughly 16-50 consumer submissions with accepted table layouts.",
    },
    {
      evidenceArtifacts: [INPUTS.r1125.artifact, INPUTS.r1129.artifact, INPUTS.r1130.artifact],
      requirementId: "real_outcome_linked_labs_wearables_aggregate_exists",
      status: realAggregateExists(input.inputs) ? "satisfied" : "missing",
      why: "The model goal needs a real outcome-linked labs/wearables aggregate, not synthetic smoke or historical shadow context.",
    },
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1125.artifact, INPUTS.r1129.artifact, INPUTS.r1130.artifact],
      requirementId: "privacy_and_product_gate_closed",
      status: privacyProductGateClosed(input.inputs) ? "satisfied" : "weakly_verified",
      why: "Artifacts must stay aggregate-only with no product display, private rows, predictions, or coefficients.",
    },
  ];
}

function baseChecklist(status: RequirementStatus): AuditChecklistItem[] {
  return [
    {
      evidenceArtifacts: [INPUTS.r1076.artifact],
      requirementId: "active_autoresearch_loop_has_concrete_next_action",
      status,
      why: "Required inputs need refresh before the current loop can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1129.artifact, INPUTS.r1130.artifact],
      requirementId: "wearable_and_bloodwork_priority_visible",
      status,
      why: "Required inputs need refresh before priority can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1130.artifact],
      requirementId: "ordinary_16_50_submission_path_available",
      status,
      why: "Required inputs need refresh before submission path can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1125.artifact, INPUTS.r1129.artifact, INPUTS.r1130.artifact],
      requirementId: "real_outcome_linked_labs_wearables_aggregate_exists",
      status,
      why: "Required inputs need refresh before real aggregate evidence can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1125.artifact, INPUTS.r1129.artifact, INPUTS.r1130.artifact],
      requirementId: "privacy_and_product_gate_closed",
      status,
      why: "Required inputs need refresh before privacy/product gates can be audited.",
    },
  ];
}

function priorityVisible(inputs: Record<InputKey, unknown | null>): boolean {
  const families = readStringArrayAt(inputs.r1129, ["realEvidenceGate", "priorityInputFamilies"]);
  return families.includes("bloodwork_labs")
    && families.includes("vitals_body_context")
    && families.includes("wearable_activity")
    && readStringAt(inputs.r1129, ["realEvidenceGate", "targetAgeBand"]) === "roughly_16_50";
}

function ordinarySubmissionPathVisible(r1130: unknown | null): boolean {
  const layouts = readStringArrayAt(r1130, ["realEvidenceHandoff", "acceptedTableLayouts"]);
  return readStringAt(r1130, ["realEvidenceHandoff", "targetAgeBand"]) === "roughly_16_50"
    && layouts.includes("single_primary_table_fallback")
    && layouts.includes("multi_table_or_explicit_refs")
    && readStringAt(r1130, ["summary", "rowOwnerWorkType"]) !== null;
}

function realAggregateExists(inputs: Record<InputKey, unknown | null>): boolean {
  const blockers = new Set([
    ...readStringArrayAt(inputs.r1129, ["realEvidenceGate", "blockers"]),
    ...readStringArrayAt(inputs.r1130, ["realEvidenceHandoff", "blockers"]),
  ]);
  if (
    blockers.has("real_outcome_linked_labs_wearables_aggregate_missing")
    || blockers.has("r1124_first_pass_aggregate_metrics_not_provided")
    || blockers.has("l1_l2_w1_qc_first_pass_metrics_incomplete")
  ) {
    return false;
  }
  return readStringAt(inputs.r1129, ["summary", "conclusion"]) === "consumer_real_evidence_gate_ready_for_reviewgpt_delta"
    || readStringAt(inputs.r1129, ["summary", "conclusion"]) === "consumer_real_evidence_gate_valid_no_delta_continue_source_search"
    || readStringAt(inputs.r1125, ["privateExecution", "aggregateMetricsArtifact"]) !== null;
}

function privacyProductGateClosed(inputs: Record<InputKey, unknown | null>): boolean {
  return (Object.values(inputs) as Array<unknown | null>).every((input) =>
    input !== null
    && findForbiddenAggregateEgress(input).length === 0
    && readBooleanAt(input, ["productDisplayAuthorized"]) === false
  );
}

function blockersFor(inputs: Record<InputKey, unknown | null>, requiredInputsReady: boolean): string[] {
  if (!requiredInputsReady) return ["refresh_required_audit_inputs"];
  const blockers = [
    ...readStringArrayAt(inputs.r1129, ["realEvidenceGate", "blockers"]),
    ...readStringArrayAt(inputs.r1130, ["realEvidenceHandoff", "blockers"]),
  ];
  if (readStringAt(inputs.r1125, ["privateExecution", "aggregateMetricsArtifact"]) === null) {
    blockers.push("r1125_real_aggregate_metrics_not_materialized");
  }
  return Array.from(new Set(blockers));
}

function conclusionFor(input: {
  goalAchieved: boolean;
  missingRequirementIds: readonly string[];
  requiredInputsReady: boolean;
}): AuditConclusion {
  if (!input.requiredInputsReady) return "consumer_real_evidence_completion_audit_waiting_on_refresh";
  if (input.goalAchieved) return "consumer_real_evidence_completion_audit_ready_for_completion";
  return "consumer_real_evidence_completion_audit_blocked_on_real_aggregate";
}

async function readInputs(
  options: R1131ConsumerRealEvidenceCompletionAuditOptions,
): Promise<Record<InputKey, unknown | null>> {
  return {
    r1076: await readJsonIfPresent(options.r1076Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1076.artifact)),
    r1125: await readJsonIfPresent(options.r1125Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1125.artifact)),
    r1129: await readJsonIfPresent(options.r1129Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1129.artifact)),
    r1130: await readJsonIfPresent(options.r1130Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1130.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1131 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return {
    r1076: summarizeInput("r1076", inputs.r1076),
    r1125: summarizeInput("r1125", inputs.r1125),
    r1129: summarizeInput("r1129", inputs.r1129),
    r1130: summarizeInput("r1130", inputs.r1130),
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

function safeBoundary(): R1131ConsumerRealEvidenceCompletionAuditOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
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
    rowParsingPerformedByR1131: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1131ConsumerRealEvidenceCompletionAudit({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1076Path: process.env.MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH,
    r1125Path: process.env.MURPH_AGE_R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_PATH,
    r1129Path: process.env.MURPH_AGE_R1129_CONSUMER_REAL_EVIDENCE_GATE_PATH,
    r1130Path: process.env.MURPH_AGE_R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    blockers: output.completionAudit.blockers,
    conclusion: output.summary.conclusion,
    goalAchieved: output.summary.goalAchieved,
    missingRequirementIds: output.completionAudit.missingRequirementIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyToMarkComplete: output.summary.readyToMarkComplete,
    rowParsingPerformedByR1131: output.summary.rowParsingPerformedByR1131,
    schemaVersion: output.schemaVersion,
    status: output.status,
    topMissingRequirement: output.summary.topMissingRequirement,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1131 consumer real evidence completion audit failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
