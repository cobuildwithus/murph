import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R997_STRICT_NSHAP_FUNCTION_COGNITION_REPLAY_SCHEMA_VERSION =
  "murph-age-r997-strict-nshap-function-cognition-replay.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_LOOP_RUNS_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
);
const DEFAULT_R770_DIR = path.join(
  DEFAULT_LOOP_RUNS_DIR,
  "session_murph_age_r770_nshap_function_cognition_external_repeat",
);
const DEFAULT_R773_DIR = path.join(
  DEFAULT_LOOP_RUNS_DIR,
  "session_murph_age_r773_nshap_single_domain_breakdown",
);
const OUTPUT_FILE_NAME = "r997-strict-nshap-function-cognition-replay.latest.json";

type ArtifactStatus = "available" | "missing";
type ValidationStatus = "passed" | "failed" | "missing" | "unknown";
type SupportStatus = "supportive" | "hold";
type ReplayVerdict =
  | "historical_nshap_aggregate_signal_usable_research_direction_only"
  | "historical_nshap_aggregate_signal_hold";
type ActivationFrameStatus =
  | "current_activation_frame_incomplete_blocks_new_rows"
  | "current_activation_frame_complete_but_scoring_still_blocked";

interface InputArtifactSummary {
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface HistoricalAggregateSummary {
  aggregateKey: "r770_function_cognition" | "r773_single_domain";
  resultStatus: ArtifactStatus;
  supportStatus: SupportStatus;
  validationIssueCountBand: "0" | "nonzero_or_unknown";
  validationStatus: ValidationStatus;
}

export interface R997StrictNshapFunctionCognitionReplayOptions {
  createdAt?: string;
  outputDir?: string;
  r614ActivationLabelsPath?: string;
  r770ResultPath?: string;
  r770ValidationPath?: string;
  r773ResultPath?: string;
  r773ValidationPath?: string;
  r992ScaffoldPath?: string;
  r993ExistingResultReducerPath?: string;
}

export interface R997StrictNshapFunctionCognitionReplayOutput {
  activationFrame: {
    activationFrameStatus: ActivationFrameStatus;
    aggregateOutputsActive: boolean;
    labelsComplete: boolean;
    productDisplayAuthorized: false;
    r992ScaffoldStatus: string | null;
    r993HistoricalSupportExists: boolean;
    requiredHumanLabelCountBand: string;
    rowExecutionAuthorized: false;
    rowExecutionStatus: string | null;
    scoringAuthorized: false;
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
    sourceCacheFileNamesStored: false;
    sourceProseStored: false;
    splitIdentifiersStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
    variableNameSamplesStored: false;
  };
  createdAt: string;
  historicalAggregateSupport: {
    allRequiredValidationsPassed: boolean;
    aggregates: HistoricalAggregateSummary[];
    r993HistoricalSupportStatus: string | null;
    supportStatus: "all_supportive" | "hold";
    validationPassedCountBand: string;
  };
  inputArtifacts: {
    r614ActivationLabels: InputArtifactSummary;
    r770Aggregate: InputArtifactSummary;
    r770Validation: InputArtifactSummary;
    r773Aggregate: InputArtifactSummary;
    r773Validation: InputArtifactSummary;
    r992Scaffold: InputArtifactSummary;
    r993ExistingResultReducer: InputArtifactSummary;
  };
  packetId: "r997-strict-nshap-function-cognition-replay";
  replayUse: {
    allowedUse: "research_direction_and_falsification_only" | "hold_for_missing_or_failed_aggregate_evidence";
    modelPromotionAuthorized: false;
    newRowExecutionAuthorized: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    scoringAuthorized: false;
  };
  schemaVersion: typeof R997_STRICT_NSHAP_FUNCTION_COGNITION_REPLAY_SCHEMA_VERSION;
  source: "NSHAP";
  status: "research-local-aggregate-only";
  summary: {
    activationFrameStatus: ActivationFrameStatus;
    artifactVerdict: ReplayVerdict;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowExecutionUnlocked: false;
    scoringUnlocked: false;
  };
}

export async function runR997StrictNshapFunctionCognitionReplay(
  options: R997StrictNshapFunctionCognitionReplayOptions = {},
): Promise<{ output: R997StrictNshapFunctionCognitionReplayOutput; outputPath: string }> {
  const inputs = {
    r614ActivationLabels: await readJsonIfPresent(
      options.r614ActivationLabelsPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-nshap-activation-labels.latest.json"),
    ),
    r770Aggregate: await readJsonIfPresent(
      options.r770ResultPath ?? path.join(DEFAULT_R770_DIR, "nshap-function-cognition-external-repeat-r770.json"),
    ),
    r770Validation: await readJsonIfPresent(
      options.r770ValidationPath
        ?? path.join(DEFAULT_R770_DIR, "nshap-function-cognition-external-repeat-validation-r770.json"),
    ),
    r773Aggregate: await readJsonIfPresent(
      options.r773ResultPath ?? path.join(DEFAULT_R773_DIR, "nshap-single-domain-breakdown-r773.json"),
    ),
    r773Validation: await readJsonIfPresent(
      options.r773ValidationPath ?? path.join(DEFAULT_R773_DIR, "nshap-single-domain-breakdown-validation-r773.json"),
    ),
    r992Scaffold: await readJsonIfPresent(
      options.r992ScaffoldPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r992-nshap-function-cognition-scaffold.latest.json"),
    ),
    r993ExistingResultReducer: await readJsonIfPresent(
      options.r993ExistingResultReducerPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r993-nshap-existing-result-reducer.latest.json"),
    ),
  };
  validateInputBoundaries(inputs);

  const aggregates = [
    summarizeHistoricalAggregate({
      aggregateKey: "r770_function_cognition",
      result: inputs.r770Aggregate,
      supportiveLabels: ["nshap_two_domain_additive_external_supportive_diagnostic_only"],
      validation: inputs.r770Validation,
    }),
    summarizeHistoricalAggregate({
      aggregateKey: "r773_single_domain",
      result: inputs.r773Aggregate,
      supportiveLabels: ["nshap_both_single_domains_supportive"],
      validation: inputs.r773Validation,
    }),
  ];
  const validationPassedCount = aggregates.filter((aggregate) => aggregate.validationStatus === "passed").length;
  const allRequiredValidationsPassed = validationPassedCount === aggregates.length;
  const allSupportive = aggregates.every((aggregate) => aggregate.supportStatus === "supportive");
  const r993HistoricalSupportStatus = readSafeStringAt(inputs.r993ExistingResultReducer, [
    "summary",
    "existingSupportStatus",
  ]);
  const r993HistoricalSupportExists = r993HistoricalSupportStatus === "historical_aggregate_support_exists";
  const artifactVerdict: ReplayVerdict = allRequiredValidationsPassed && allSupportive && r993HistoricalSupportExists
    ? "historical_nshap_aggregate_signal_usable_research_direction_only"
    : "historical_nshap_aggregate_signal_hold";
  const activationFrame = summarizeActivationFrame({
    r614ActivationLabels: inputs.r614ActivationLabels,
    r992Scaffold: inputs.r992Scaffold,
    r993HistoricalSupportExists,
  });

  const output: R997StrictNshapFunctionCognitionReplayOutput = {
    activationFrame,
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
      sourceCacheFileNamesStored: false,
      sourceProseStored: false,
      splitIdentifiersStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
      variableNameSamplesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    historicalAggregateSupport: {
      allRequiredValidationsPassed,
      aggregates,
      r993HistoricalSupportStatus,
      supportStatus: allSupportive ? "all_supportive" : "hold",
      validationPassedCountBand: countBand(validationPassedCount),
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r997-strict-nshap-function-cognition-replay",
    replayUse: {
      allowedUse: artifactVerdict === "historical_nshap_aggregate_signal_usable_research_direction_only"
        ? "research_direction_and_falsification_only"
        : "hold_for_missing_or_failed_aggregate_evidence",
      modelPromotionAuthorized: false,
      newRowExecutionAuthorized: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      scoringAuthorized: false,
    },
    schemaVersion: R997_STRICT_NSHAP_FUNCTION_COGNITION_REPLAY_SCHEMA_VERSION,
    source: "NSHAP",
    status: "research-local-aggregate-only",
    summary: {
      activationFrameStatus: activationFrame.activationFrameStatus,
      artifactVerdict,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowExecutionUnlocked: false,
      scoringUnlocked: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R997 strict NSHAP replay failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeHistoricalAggregate(options: {
  aggregateKey: HistoricalAggregateSummary["aggregateKey"];
  result: unknown | null;
  supportiveLabels: string[];
  validation: unknown | null;
}): HistoricalAggregateSummary {
  const result = optionalRecord(options.result);
  const validation = optionalRecord(options.validation);
  const supportClassification = readSafeString(result?.support_classification);
  return {
    aggregateKey: options.aggregateKey,
    resultStatus: result ? "available" : "missing",
    supportStatus: supportClassification && options.supportiveLabels.includes(supportClassification)
      ? "supportive"
      : "hold",
    validationIssueCountBand: validation?.issue_count === 0 ? "0" : "nonzero_or_unknown",
    validationStatus: readValidationStatus(validation),
  };
}

function summarizeActivationFrame(options: {
  r614ActivationLabels: unknown | null;
  r992Scaffold: unknown | null;
  r993HistoricalSupportExists: boolean;
}): R997StrictNshapFunctionCognitionReplayOutput["activationFrame"] {
  const r614 = optionalRecord(options.r614ActivationLabels);
  const rights = optionalRecord(readAtPath(r614, ["sourceRightsAndAggregateOutput"]));
  const rowExecution = optionalRecord(readAtPath(r614, ["rowExecutionReadiness"]));
  const r992 = optionalRecord(options.r992Scaffold);
  const labelsComplete = readBoolean(rights?.labelsComplete);
  const aggregateOutputsActive = readBoolean(rights?.aggregateOutputsActive);
  const r992ScaffoldStatus = readSafeStringAt(r992, ["freshExecutionScaffold", "status"]);
  const currentFrameIncomplete = !labelsComplete
    || !aggregateOutputsActive
    || r992ScaffoldStatus === "blocked"
    || readBooleanAt(r992, ["summary", "rowExecutionUnlocked"])
    || readBooleanAt(r992, ["summary", "scoringUnlocked"]);
  return {
    activationFrameStatus: currentFrameIncomplete
      ? "current_activation_frame_incomplete_blocks_new_rows"
      : "current_activation_frame_complete_but_scoring_still_blocked",
    aggregateOutputsActive,
    labelsComplete,
    productDisplayAuthorized: false,
    r992ScaffoldStatus,
    r993HistoricalSupportExists: options.r993HistoricalSupportExists,
    requiredHumanLabelCountBand: countBand(readSafeStringArray(rights?.requiredHumanLabels, "R614 labels").length),
    rowExecutionAuthorized: false,
    rowExecutionStatus: readSafeString(rowExecution?.status),
    scoringAuthorized: false,
  };
}

function summarizeInputs(inputs: Record<string, unknown | null>): R997StrictNshapFunctionCognitionReplayOutput["inputArtifacts"] {
  return {
    r614ActivationLabels: summarizeInput(inputs.r614ActivationLabels),
    r770Aggregate: summarizeInput(inputs.r770Aggregate),
    r770Validation: summarizeInput(inputs.r770Validation),
    r773Aggregate: summarizeInput(inputs.r773Aggregate),
    r773Validation: summarizeInput(inputs.r773Validation),
    r992Scaffold: summarizeInput(inputs.r992Scaffold),
    r993ExistingResultReducer: summarizeInput(inputs.r993ExistingResultReducer),
  };
}

function summarizeInput(value: unknown | null): InputArtifactSummary {
  const record = optionalRecord(value);
  return {
    packetId: readSafeString(record?.packetId),
    schemaVersion: readSafeString(record?.schemaVersion ?? record?.schema_version),
    status: record ? "available" : "missing",
  };
}

function validateInputBoundaries(inputs: Record<string, unknown | null>): void {
  for (const [label, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`${label} input failed aggregate-egress validation.`);
    }
    const boundary = optionalRecord(optionalRecord(value)?.artifactBoundary);
    if (!boundary) continue;
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
      "sourceCacheFileNamesStored",
      "sourceProseStored",
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
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (optionalRecord(error)?.code === "ENOENT") return null;
    throw new Error("Failed to read R997 aggregate metadata artifact.");
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

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count <= 9) return "1-9";
  if (count <= 99) return "10-99";
  return "gte_100";
}

async function main(): Promise<void> {
  const { output } = await runR997StrictNshapFunctionCognitionReplay({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r614ActivationLabelsPath: process.env.MURPH_AGE_R614_NSHAP_LABELS_PATH,
    r770ResultPath: process.env.MURPH_AGE_R770_NSHAP_RESULT_PATH,
    r770ValidationPath: process.env.MURPH_AGE_R770_NSHAP_VALIDATION_PATH,
    r773ResultPath: process.env.MURPH_AGE_R773_NSHAP_RESULT_PATH,
    r773ValidationPath: process.env.MURPH_AGE_R773_NSHAP_VALIDATION_PATH,
    r992ScaffoldPath: process.env.MURPH_AGE_R992_NSHAP_SCAFFOLD_PATH,
    r993ExistingResultReducerPath: process.env.MURPH_AGE_R993_NSHAP_EXISTING_RESULT_REDUCER_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    activationFrameStatus: output.summary.activationFrameStatus,
    artifactVerdict: output.summary.artifactVerdict,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    productPromotionAuthorized: output.summary.productPromotionAuthorized,
    rowExecutionUnlocked: output.summary.rowExecutionUnlocked,
    schemaVersion: output.schemaVersion,
    scoringUnlocked: output.summary.scoringUnlocked,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R997 strict NSHAP replay failed.\n");
    process.exitCode = 1;
  });
}
