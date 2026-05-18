import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R992_NSHAP_FUNCTION_COGNITION_SCAFFOLD_SCHEMA_VERSION =
  "murph-age-r992-nshap-function-cognition-scaffold.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r992-nshap-function-cognition-scaffold.latest.json";

type ArtifactStatus = "available" | "missing" | "optional_missing";
type ScaffoldStatus = "blocked" | "no_score_scaffold_only";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface ScaffoldStep {
  candidateFamilyId: "anchor_plus_function_sidecar" | "cognition_shadow_after_function";
  executionState: "planned_no_score_only";
  freshExecutionRole: "lead_sidecar" | "shadow_after_function";
  prerequisites: string[];
  rowExecutionUnlocked: false;
  scoringUnlocked: false;
}

export interface R992NshapFunctionCognitionScaffoldOptions {
  activationLabelsPath?: string;
  createdAt?: string;
  outputDir?: string;
  r977ProbePath?: string;
  r991MhasDiagnosticPath?: string;
}

export interface R992NshapFunctionCognitionScaffoldOutput {
  artifactBoundary: {
    aggregateOnly: true;
    archiveBasenamesStored: false;
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
    rowParsingPerformed: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
    variableNameSamplesStored: false;
  };
  blockedReason: string | null;
  createdAt: string;
  freshExecutionScaffold: {
    noScorePlan: ScaffoldStep[];
    rowExecutionUnlocked: false;
    scoringUnlocked: false;
    status: ScaffoldStatus;
  };
  inputArtifacts: {
    activationLabels: ArtifactSummary;
    r977Probe: ArtifactSummary;
    r991MhasDiagnostic: ArtifactSummary;
  };
  packetId: "r992-nshap-function-cognition-scaffold";
  readiness: {
    activationLabelsComplete: boolean;
    r977RowGateStatus: string | null;
    r991SupportiveDiagnosticPresent: boolean;
  };
  schemaVersion: typeof R992_NSHAP_FUNCTION_COGNITION_SCAFFOLD_SCHEMA_VERSION;
  source: "NSHAP";
  status: "research-local-aggregate-only";
  summary: {
    artifactVerdict: "blocked_no_execution" | "no_score_scaffold_ready";
    productPromotionAuthorized: false;
    rowExecutionUnlocked: false;
    scoringUnlocked: false;
  };
}

export async function runR992NshapFunctionCognitionScaffold(
  options: R992NshapFunctionCognitionScaffoldOptions = {},
): Promise<{ output: R992NshapFunctionCognitionScaffoldOutput; outputPath: string }> {
  const inputs = {
    activationLabels: await readJsonIfPresent(
      options.activationLabelsPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-nshap-activation-labels.latest.json"),
    ),
    r977Probe: await readJsonIfPresent(
      options.r977ProbePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r977-nshap-next-activation-probe.latest.json"),
    ),
    r991MhasDiagnostic: await readJsonIfPresent(
      options.r991MhasDiagnosticPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r991-mhas-deep-diagnostic-reducer.latest.json"),
    ),
  };
  validateInputBoundaries(inputs);

  const inputArtifacts = summarizeInputs(inputs);
  const activationStatus = summarizeActivationLabels(inputs.activationLabels);
  const r977GateStatus = readSafeStringAt(inputs.r977Probe, ["rowExecutionGate", "status"]);
  const r977GateReason = summarizeR977Gate(inputs.r977Probe, inputArtifacts.r977Probe.status);
  const r991SupportiveDiagnosticPresent =
    readSafeStringAt(inputs.r991MhasDiagnostic, ["summary", "verdict"])
      === "function_disability_survives_age_residualized_deep_diagnostic";
  const blockedReason = activationStatus.complete ? r977GateReason : activationStatus.blockedReason;
  const scaffoldStatus: ScaffoldStatus = blockedReason ? "blocked" : "no_score_scaffold_only";

  const output: R992NshapFunctionCognitionScaffoldOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      archiveBasenamesStored: false,
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
      rowParsingPerformed: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
      variableNameSamplesStored: false,
    },
    blockedReason,
    createdAt: options.createdAt ?? new Date().toISOString(),
    freshExecutionScaffold: {
      noScorePlan: scaffoldStatus === "no_score_scaffold_only" ? buildNoScorePlan(r991SupportiveDiagnosticPresent) : [],
      rowExecutionUnlocked: false,
      scoringUnlocked: false,
      status: scaffoldStatus,
    },
    inputArtifacts,
    packetId: "r992-nshap-function-cognition-scaffold",
    readiness: {
      activationLabelsComplete: activationStatus.complete,
      r977RowGateStatus: r977GateStatus,
      r991SupportiveDiagnosticPresent,
    },
    schemaVersion: R992_NSHAP_FUNCTION_COGNITION_SCAFFOLD_SCHEMA_VERSION,
    source: "NSHAP",
    status: "research-local-aggregate-only",
    summary: {
      artifactVerdict: scaffoldStatus === "no_score_scaffold_only"
        ? "no_score_scaffold_ready"
        : "blocked_no_execution",
      productPromotionAuthorized: false,
      rowExecutionUnlocked: false,
      scoringUnlocked: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R992 NSHAP function cognition scaffold failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeActivationLabels(value: unknown | null): { blockedReason: string | null; complete: boolean } {
  if (!value) return { blockedReason: "missing_r614_nshap_activation_labels_artifact", complete: false };
  const rights = optionalRecord(readAtPath(value, ["sourceRightsAndAggregateOutput"]));
  const rowReadiness = optionalRecord(readAtPath(value, ["rowExecutionReadiness"]));
  const labelsComplete = readBoolean(rights?.labelsComplete) === true;
  const aggregateOutputsActive = readBoolean(rights?.aggregateOutputsActive) === true;
  const requiredLabels = readSafeStringArray(rights?.requiredHumanLabels, "NSHAP activation labels");
  const upstreamReasons = readSafeStringArray(rowReadiness?.blockingReasons, "NSHAP row blocking reasons");
  const rowStatus = readSafeString(rowReadiness?.status);
  const complete = labelsComplete
    && aggregateOutputsActive
    && requiredLabels.length === 0
    && rowStatus === "metadata_ready_activation_labels_complete_no_scoring";
  if (complete) return { blockedReason: null, complete: true };
  const reasons = dedupeLabels([
    ...upstreamReasons,
    ...requiredLabels.map((label) => `missing_activation_label_${label}`),
    labelsComplete ? null : "activation_labels_incomplete",
    aggregateOutputsActive ? null : "aggregate_output_permission_not_active",
    rowStatus ? `row_readiness_${rowStatus}` : "missing_row_execution_readiness_status",
  ]);
  return { blockedReason: reasons.join(";"), complete: false };
}

function summarizeR977Gate(value: unknown | null, artifactStatus: ArtifactStatus): string | null {
  if (artifactStatus !== "available" || !value) return "missing_r977_nshap_next_activation_probe_artifact";
  const status = readSafeStringAt(value, ["rowExecutionGate", "status"]);
  if (status === "metadata_ready_no_score_scaffold_only") return null;
  const blockingReasons = readSafeStringArray(
    readAtPath(value, ["rowExecutionGate", "blockingReasons"]),
    "R977 row gate blocking reasons",
  );
  return dedupeLabels([
    status ? `r977_row_gate_${status}` : "missing_r977_row_gate_status",
    ...blockingReasons,
  ]).join(";");
}

function buildNoScorePlan(r991SupportiveDiagnosticPresent: boolean): ScaffoldStep[] {
  const sharedPrerequisites = [
    "activation_labels_complete",
    "r977_row_gate_metadata_ready_no_score_scaffold_only",
    "no_row_execution_unlocked",
    "no_scoring_unlocked",
  ];
  return [
    {
      candidateFamilyId: "anchor_plus_function_sidecar",
      executionState: "planned_no_score_only",
      freshExecutionRole: "lead_sidecar",
      prerequisites: dedupeLabels([
        ...sharedPrerequisites,
        r991SupportiveDiagnosticPresent ? "mhas_function_diagnostic_supportive" : "mhas_function_diagnostic_optional",
      ]),
      rowExecutionUnlocked: false,
      scoringUnlocked: false,
    },
    {
      candidateFamilyId: "cognition_shadow_after_function",
      executionState: "planned_no_score_only",
      freshExecutionRole: "shadow_after_function",
      prerequisites: dedupeLabels([
        ...sharedPrerequisites,
        "anchor_plus_function_sidecar_scaffold_precedes_shadow",
      ]),
      rowExecutionUnlocked: false,
      scoringUnlocked: false,
    },
  ];
}

function validateInputBoundaries(inputs: {
  activationLabels: unknown | null;
  r977Probe: unknown | null;
  r991MhasDiagnostic: unknown | null;
}): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const root = requiredRecord(value, key);
    for (const boundary of [
      optionalRecord(root.artifactBoundary),
      optionalRecord(root.boundary),
    ]) {
      if (!boundary) continue;
      assertBoundaryFlags(boundary, `${key} boundary`);
    }
  }
}

function assertBoundaryFlags(boundary: Record<string, unknown>, label: string): void {
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
    "rowParsingPerformed",
    "rowParsingPerformedByR991",
    "rowValuesStored",
    "smallCellsStored",
    "sourceBodiesStored",
    "splitMembershipStored",
    "variableLabelsStored",
    "variableListsStored",
    "variableNamesStored",
    "variableNameSamplesStored",
  ]) {
    if (boundary[flag] !== undefined && boundary[flag] !== false) {
      throw new Error(`${label} has unsafe boundary flag ${flag}.`);
    }
  }
}

function summarizeInputs(inputs: {
  activationLabels: unknown | null;
  r977Probe: unknown | null;
  r991MhasDiagnostic: unknown | null;
}): R992NshapFunctionCognitionScaffoldOutput["inputArtifacts"] {
  return {
    activationLabels: summarizeArtifact("r614-nshap-activation-labels.latest.json", inputs.activationLabels),
    r977Probe: summarizeArtifact("r977-nshap-next-activation-probe.latest.json", inputs.r977Probe),
    r991MhasDiagnostic: summarizeArtifact(
      "r991-mhas-deep-diagnostic-reducer.latest.json",
      inputs.r991MhasDiagnostic,
      true,
    ),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null, optional = false): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: optional ? "optional_missing" : "missing" };
  const root = requiredRecord(value, artifact);
  return {
    artifact,
    packetId: readSafeString(root.packetId),
    schemaVersion: readSafeString(root.schemaVersion) ?? readSafeString(root.schema_version),
    status: "available",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (optionalRecord(error)?.code === "ENOENT") return null;
    throw new Error("Failed to read R992 aggregate metadata artifact.");
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

function readSafeString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? requiredSafeLabel(value, "metadata label") : null;
}

function readSafeStringArray(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a string array.`);
  return value.map((item, index) => requiredSafeLabel(item, `${label} ${index + 1}`));
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
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
    value.length > 160 ||
    /[\r\n\t/\\]/u.test(value) ||
    /\b(?:authorization|caseid|codebook|coefficient|identifier|participant|prediction|raw\s*row|row\s*value|small\s*cell|source\s*body|source\s*text|split\s*id|variable\s*name)\b/iu.test(value)
  ) {
    throw new Error(`${label} is not a safe aggregate metadata label.`);
  }
  return value;
}

function dedupeLabels(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map((value) =>
    requiredSafeLabel(value, "metadata label")
  ))].sort();
}

async function main(): Promise<void> {
  const { output } = await runR992NshapFunctionCognitionScaffold({
    activationLabelsPath: process.env.MURPH_AGE_R614_NSHAP_LABELS_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r977ProbePath: process.env.MURPH_AGE_R977_NSHAP_PROBE_PATH,
    r991MhasDiagnosticPath: process.env.MURPH_AGE_R991_MHAS_DIAGNOSTIC_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    artifactVerdict: output.summary.artifactVerdict,
    blockedReason: output.blockedReason,
    packetId: output.packetId,
    productPromotionAuthorized: output.summary.productPromotionAuthorized,
    rowExecutionUnlocked: output.summary.rowExecutionUnlocked,
    schemaVersion: output.schemaVersion,
    scaffoldStatus: output.freshExecutionScaffold.status,
    scoringUnlocked: output.summary.scoringUnlocked,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R992 NSHAP function cognition scaffold failed.\n");
    process.exitCode = 1;
  });
}
