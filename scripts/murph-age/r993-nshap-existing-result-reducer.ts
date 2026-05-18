import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R993_NSHAP_EXISTING_RESULT_REDUCER_SCHEMA_VERSION =
  "murph-age-r993-nshap-existing-result-reducer.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R770_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r770_nshap_function_cognition_external_repeat",
);
const DEFAULT_R773_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r773_nshap_single_domain_breakdown",
);
const OUTPUT_FILE_NAME = "r993-nshap-existing-result-reducer.latest.json";

type ArtifactStatus = "available" | "missing";
type ValidationStatus = "passed" | "failed" | "missing" | "unknown";
type ExistingSupportStatus = "historical_aggregate_support_exists" | "historical_aggregate_support_incomplete";

interface ExistingResultInput {
  artifact: string;
  result: unknown | null;
  validation: unknown | null;
  validationArtifact: string;
}

interface ExistingResultSummary {
  allowedEffect: string | null;
  artifact: string;
  evidenceClass: string | null;
  existingResultStatus: ArtifactStatus;
  nextActionAllowedEffect: string | null;
  nextActionId: string | null;
  priorExecution: {
    externalTransportScoringExecuted: boolean;
    modelPromotionAuthorized: boolean;
    modelRefitExecuted: boolean;
    modelTrainingExecuted: boolean;
    privateSourceCalibrationFitExecuted: boolean;
    productClaimsCreated: boolean;
    rowParseExecutedPrivateOnly: boolean;
  };
  schemaVersion: string | null;
  sourceId: string | null;
  supportClassification: string | null;
  validationArtifact: string;
  validationIssueCountBand: "0" | "nonzero_or_unknown";
  validationStatus: ValidationStatus;
}

export interface R993NshapExistingResultReducerOptions {
  createdAt?: string;
  outputDir?: string;
  r614ActivationLabelsPath?: string;
  r770ResultPath?: string;
  r770ValidationPath?: string;
  r773ResultPath?: string;
  r773ValidationPath?: string;
  r992ScaffoldPath?: string;
}

export interface R993NshapExistingResultReducerOutput {
  activationLabelConflict: {
    activationArtifactStatus: ArtifactStatus;
    activationLabelsComplete: boolean;
    aggregateOutputsActive: boolean;
    blockedReasonLabels: string[];
    conflictVerdict: "historical_results_do_not_unlock_current_activation";
    requiredHumanLabelCountBand: string;
    rowExecutionReadinessStatus: string | null;
    scaffoldArtifactStatus: ArtifactStatus;
    scaffoldBlockedReasonLabels: string[];
    scaffoldStatus: string | null;
  };
  artifactBoundary: {
    aggregateOnly: true;
    archiveBasenamesStored: false;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    modelScoringPerformed: false;
    outcomeScoringPerformed: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    protocolClaimsIncluded: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformed: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitIdentifiersStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
    variableNameSamplesStored: false;
  };
  createdAt: string;
  currentState: {
    existingAggregatesReconcilable: boolean;
    futureRowExecutionAuthorized: false;
    futureScoringAuthorized: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    usePriorResultsForResearchDirectionOnly: boolean;
  };
  existingResultSupport: {
    evidenceClasses: string[];
    resultCountBand: string;
    results: ExistingResultSummary[];
    supportClassifications: string[];
    supportStatus: ExistingSupportStatus;
    validationPassedCountBand: string;
  };
  nextAction: {
    actionId: "complete_current_activation_labels_before_any_new_nshap_rows";
    allowedEffect: "research_reconciliation_only";
    blockedUntil: string[];
    productDisplayAuthorized: false;
    rowExecutionAuthorized: false;
    scoringAuthorized: false;
  };
  packetId: "r993-nshap-existing-result-reducer";
  schemaVersion: typeof R993_NSHAP_EXISTING_RESULT_REDUCER_SCHEMA_VERSION;
  source: "NSHAP";
  status: "research-local-aggregate-only";
  summary: {
    artifactVerdict: "historical_aggregate_support_current_activation_blocked";
    existingSupportStatus: ExistingSupportStatus;
    productPromotionAuthorized: false;
    rowExecutionUnlocked: false;
    scoringUnlocked: false;
  };
}

export async function runR993NshapExistingResultReducer(
  options: R993NshapExistingResultReducerOptions = {},
): Promise<{ output: R993NshapExistingResultReducerOutput; outputPath: string }> {
  const inputs = {
    activationLabels: await readJsonIfPresent(
      options.r614ActivationLabelsPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-nshap-activation-labels.latest.json"),
    ),
    r992Scaffold: await readJsonIfPresent(
      options.r992ScaffoldPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r992-nshap-function-cognition-scaffold.latest.json"),
    ),
    existingResults: [
      {
        artifact: "nshap-function-cognition-external-repeat-r770.json",
        result: await readJsonIfPresent(
          options.r770ResultPath ?? path.join(DEFAULT_R770_DIR, "nshap-function-cognition-external-repeat-r770.json"),
        ),
        validation: await readJsonIfPresent(
          options.r770ValidationPath
            ?? path.join(DEFAULT_R770_DIR, "nshap-function-cognition-external-repeat-validation-r770.json"),
        ),
        validationArtifact: "nshap-function-cognition-external-repeat-validation-r770.json",
      },
      {
        artifact: "nshap-single-domain-breakdown-r773.json",
        result: await readJsonIfPresent(
          options.r773ResultPath ?? path.join(DEFAULT_R773_DIR, "nshap-single-domain-breakdown-r773.json"),
        ),
        validation: await readJsonIfPresent(
          options.r773ValidationPath ?? path.join(DEFAULT_R773_DIR, "nshap-single-domain-breakdown-validation-r773.json"),
        ),
        validationArtifact: "nshap-single-domain-breakdown-validation-r773.json",
      },
    ],
  };

  validateCurrentArtifactBoundary("activationLabels", inputs.activationLabels);
  validateCurrentArtifactBoundary("r992Scaffold", inputs.r992Scaffold);

  const results = inputs.existingResults.map(summarizeExistingResult);
  const passedResults = results.filter((result) => result.validationStatus === "passed");
  const supportClassifications = dedupeLabels(results.map((result) => result.supportClassification));
  const evidenceClasses = dedupeLabels(results.map((result) => result.evidenceClass));
  const supportStatus: ExistingSupportStatus = passedResults.length === results.length && results.length > 0
    ? "historical_aggregate_support_exists"
    : "historical_aggregate_support_incomplete";
  const activationLabelConflict = summarizeActivationConflict(inputs.activationLabels, inputs.r992Scaffold);

  const output: R993NshapExistingResultReducerOutput = {
    activationLabelConflict,
    artifactBoundary: {
      aggregateOnly: true,
      archiveBasenamesStored: false,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      modelScoringPerformed: false,
      outcomeScoringPerformed: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      protocolClaimsIncluded: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformed: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitIdentifiersStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
      variableNameSamplesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    currentState: {
      existingAggregatesReconcilable: supportStatus === "historical_aggregate_support_exists",
      futureRowExecutionAuthorized: false,
      futureScoringAuthorized: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      usePriorResultsForResearchDirectionOnly: supportStatus === "historical_aggregate_support_exists",
    },
    existingResultSupport: {
      evidenceClasses,
      resultCountBand: countBand(results.length),
      results,
      supportClassifications,
      supportStatus,
      validationPassedCountBand: countBand(passedResults.length),
    },
    nextAction: {
      actionId: "complete_current_activation_labels_before_any_new_nshap_rows",
      allowedEffect: "research_reconciliation_only",
      blockedUntil: dedupeLabels([
        "current_activation_labels_complete",
        "aggregate_output_permission_active",
        "separate_future_execution_gate_approved",
        "minimum_cell_suppression_policy_locked",
      ]),
      productDisplayAuthorized: false,
      rowExecutionAuthorized: false,
      scoringAuthorized: false,
    },
    packetId: "r993-nshap-existing-result-reducer",
    schemaVersion: R993_NSHAP_EXISTING_RESULT_REDUCER_SCHEMA_VERSION,
    source: "NSHAP",
    status: "research-local-aggregate-only",
    summary: {
      artifactVerdict: "historical_aggregate_support_current_activation_blocked",
      existingSupportStatus: supportStatus,
      productPromotionAuthorized: false,
      rowExecutionUnlocked: false,
      scoringUnlocked: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R993 NSHAP existing result reducer failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeExistingResult(input: ExistingResultInput): ExistingResultSummary {
  const result = optionalRecord(input.result);
  const validation = optionalRecord(input.validation);
  return {
    allowedEffect: readSafeStringAt(result, ["execution_contract", "allowed_effect"]),
    artifact: input.artifact,
    evidenceClass: readSafeString(result?.evidence_class),
    existingResultStatus: result ? "available" : "missing",
    nextActionAllowedEffect: readSafeStringAt(result, ["next_action", "allowed_effect"]),
    nextActionId: readSafeStringAt(result, ["next_action", "action_id"]),
    priorExecution: {
      externalTransportScoringExecuted: readBooleanAt(result, ["status_snapshot", "external_transport_scoring_executed"]),
      modelPromotionAuthorized: readBooleanAt(result, ["status_snapshot", "model_promotion_authorized"]),
      modelRefitExecuted: readBooleanAt(result, ["status_snapshot", "model_refit_executed"]),
      modelTrainingExecuted: readBooleanAt(result, ["status_snapshot", "model_training_executed"]),
      privateSourceCalibrationFitExecuted: readBooleanAt(
        result,
        ["status_snapshot", "private_source_calibration_fit_executed"],
      ),
      productClaimsCreated: readBooleanAt(result, ["status_snapshot", "product_claims_created"]),
      rowParseExecutedPrivateOnly: readBooleanAt(result, ["status_snapshot", "row_parse_executed_private_only"]),
    },
    schemaVersion: readSafeString(result?.schema_version),
    sourceId: readSafeString(result?.source_id),
    supportClassification: readSafeString(result?.support_classification),
    validationArtifact: input.validationArtifact,
    validationIssueCountBand: validation?.issue_count === 0 ? "0" : "nonzero_or_unknown",
    validationStatus: readValidationStatus(validation),
  };
}

function summarizeActivationConflict(
  activationLabels: unknown | null,
  r992Scaffold: unknown | null,
): R993NshapExistingResultReducerOutput["activationLabelConflict"] {
  const activation = optionalRecord(activationLabels);
  const sourceRights = optionalRecord(readAtPath(activation, ["sourceRightsAndAggregateOutput"]));
  const rowExecution = optionalRecord(readAtPath(activation, ["rowExecutionReadiness"]));
  const scaffold = optionalRecord(r992Scaffold);
  return {
    activationArtifactStatus: activation ? "available" : "missing",
    activationLabelsComplete: readBoolean(sourceRights?.labelsComplete),
    aggregateOutputsActive: readBoolean(sourceRights?.aggregateOutputsActive),
    blockedReasonLabels: dedupeLabels([
      ...readSafeStringArray(rowExecution?.blockingReasons, "R614 blocking reasons"),
      ...readSafeStringArray(sourceRights?.requiredHumanLabels, "R614 required labels").map((label) =>
        `missing_activation_label_${label}`
      ),
      readBoolean(sourceRights?.labelsComplete) ? null : "activation_labels_incomplete",
      readBoolean(sourceRights?.aggregateOutputsActive) ? null : "aggregate_output_permission_not_active",
    ]),
    conflictVerdict: "historical_results_do_not_unlock_current_activation",
    requiredHumanLabelCountBand: countBand(readSafeStringArray(sourceRights?.requiredHumanLabels, "R614 labels").length),
    rowExecutionReadinessStatus: readSafeString(rowExecution?.status),
    scaffoldArtifactStatus: scaffold ? "available" : "missing",
    scaffoldBlockedReasonLabels: splitSafeReasonList(scaffold?.blockedReason),
    scaffoldStatus: readSafeStringAt(scaffold, ["freshExecutionScaffold", "status"]),
  };
}

function validateCurrentArtifactBoundary(label: string, value: unknown | null): void {
  if (!value) return;
  const root = requiredRecord(value, label);
  const boundary = optionalRecord(root.artifactBoundary);
  if (!boundary) return;
  for (const flag of [
    "archiveBasenamesStored",
    "codebookProseStored",
    "codebookTextStored",
    "coefficientsStored",
    "localPathsStored",
    "modelParametersStored",
    "modelScoringPerformed",
    "outcomeScoringPerformed",
    "participantIdentifiersStored",
    "participantIdentifiersWritten",
    "predictionsStored",
    "productClaimsIncluded",
    "productDisplayAuthorized",
    "productPromotionAuthorized",
    "protocolClaimsIncluded",
    "recommendationClaimsIncluded",
    "rowParsingPerformed",
    "rowValuesStored",
    "smallCellsStored",
    "sourceBodiesStored",
    "splitIdentifiersStored",
    "splitMembershipStored",
    "variableLabelsStored",
    "variableListsStored",
    "variableNamesStored",
    "variableNameSamplesStored",
  ]) {
    if (boundary[flag] !== undefined && boundary[flag] !== false) {
      throw new Error(`${label} boundary has unsafe boundary flag ${flag}.`);
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (optionalRecord(error)?.code === "ENOENT") return null;
    throw new Error("Failed to read R993 aggregate metadata artifact.");
  }
}

function readAtPath(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[part];
  }
  return current;
}

function readSafeStringAt(value: unknown, pathParts: readonly string[]): string | null {
  return readSafeString(readAtPath(value, pathParts));
}

function readValidationStatus(value: Record<string, unknown> | null): ValidationStatus {
  if (!value) return "missing";
  const status = readSafeString(value.status);
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  return "unknown";
}

function readSafeString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? requiredSafeLabel(value, "metadata label") : null;
}

function readSafeStringArray(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a string array.`);
  return value.map((item, index) => requiredSafeLabel(item, `${label} ${index + 1}`));
}

function readBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean {
  return readBoolean(readAtPath(value, pathParts));
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function requiredSafeLabel(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 180 ||
    /[\r\n\t/\\]/u.test(value) ||
    /\b(?:authorization|caseid|codebook|coefficient|identifier|participant|prediction|raw\s*row|row\s*value|small\s*cell|source\s*body|source\s*text|split\s*id|variable\s*name)\b/iu.test(value)
  ) {
    throw new Error(`${label} is not a safe aggregate metadata label.`);
  }
  return value;
}

function splitSafeReasonList(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return dedupeLabels(value.split(";").map((part) => part.trim()).filter(Boolean));
}

function dedupeLabels(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map((value) =>
    requiredSafeLabel(value, "metadata label")
  ))].sort();
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count <= 9) return "1-9";
  if (count <= 99) return "10-99";
  return "gte_100";
}

async function main(): Promise<void> {
  const { output } = await runR993NshapExistingResultReducer({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r614ActivationLabelsPath: process.env.MURPH_AGE_R614_NSHAP_LABELS_PATH,
    r770ResultPath: process.env.MURPH_AGE_R770_NSHAP_RESULT_PATH,
    r770ValidationPath: process.env.MURPH_AGE_R770_NSHAP_VALIDATION_PATH,
    r773ResultPath: process.env.MURPH_AGE_R773_NSHAP_RESULT_PATH,
    r773ValidationPath: process.env.MURPH_AGE_R773_NSHAP_VALIDATION_PATH,
    r992ScaffoldPath: process.env.MURPH_AGE_R992_NSHAP_SCAFFOLD_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    artifactVerdict: output.summary.artifactVerdict,
    existingSupportStatus: output.summary.existingSupportStatus,
    packetId: output.packetId,
    productPromotionAuthorized: output.summary.productPromotionAuthorized,
    rowExecutionUnlocked: output.summary.rowExecutionUnlocked,
    schemaVersion: output.schemaVersion,
    scoringUnlocked: output.summary.scoringUnlocked,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R993 NSHAP existing result reducer failed.\n");
    process.exitCode = 1;
  });
}
