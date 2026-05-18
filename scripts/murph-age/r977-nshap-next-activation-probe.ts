import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R977_NSHAP_NEXT_ACTIVATION_PROBE_SCHEMA_VERSION =
  "murph-age-r977-nshap-next-activation-probe.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_SOURCE_INTAKE_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "source-intake",
);
const OUTPUT_FILE_NAME = "r977-nshap-next-activation-probe.latest.json";

type ArtifactKey = "activationFeasibility" | "metadataBenchmarkCard" | "activationLabels" | "headerPreflight";
type ArtifactStatus = "available" | "missing";
type LaneStatus =
  | "blocked_missing_metadata"
  | "blocked_source_rights_or_endpoint_labels"
  | "metadata_ready_for_no_score_scaffold"
  | "not_ready";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface FeatureSignal {
  datasetCountBand: string;
  headerMatchBand: string;
  present: boolean;
}

interface LaneReadiness {
  blockedUntil: string[];
  candidateFamilyAvailable: boolean;
  headerSignal: FeatureSignal;
  nextAction: string;
  status: LaneStatus;
}

export interface R977NshapNextActivationProbeOptions {
  activationFeasibilityPath?: string;
  activationLabelsPath?: string;
  createdAt?: string;
  headerPreflightPath?: string;
  metadataBenchmarkCardPath?: string;
  outputDir?: string;
}

export interface R977NshapNextActivationProbeOutput {
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
  benchmarkCardReadiness: {
    available: boolean;
    endpointFamily: string | null;
    readyForBenchmarkCard: boolean;
    status: "available_locked_no_execution" | "missing_or_not_locked";
  };
  createdAt: string;
  functionCognitionSidecar: {
    cognitionLane: LaneReadiness;
    functionLane: LaneReadiness;
    laneStatus:
      | "blocked_activation_report_only"
      | "metadata_ready_for_no_score_sidecar_scaffold"
      | "not_ready";
    rowExecutionUnlocked: false;
    scoringUnlocked: false;
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r977-nshap-next-activation-probe";
  rowExecutionGate: {
    blockingReasons: string[];
    aggregateOutputsActive: boolean;
    endpointLabelComplete: boolean;
    nextAction:
      | "complete_source_rights_endpoint_and_aggregate_output_labels"
      | "refresh_nshap_metadata_artifacts"
      | "draft_no_score_function_sidecar_scaffold";
    rowExecutionUnlocked: false;
    sourceRightsLabelsComplete: boolean;
    status:
      | "blocked_missing_metadata"
      | "blocked_source_rights_or_endpoint_labels"
      | "metadata_ready_no_score_scaffold_only";
  };
  schemaVersion: typeof R977_NSHAP_NEXT_ACTIVATION_PROBE_SCHEMA_VERSION;
  source: "NSHAP";
  status: "research-local-aggregate-only";
  summary: {
    benchmarkCardReady: boolean;
    conclusion:
      | "nshap_benchmark_card_ready_but_sidecar_blocked_by_activation_labels"
      | "nshap_metadata_ready_for_no_score_sidecar_scaffold"
      | "nshap_metadata_incomplete_for_sidecar_probe";
    productPromotionAuthorized: false;
    rowExecutionUnlocked: false;
  };
}

export async function runR977NshapNextActivationProbe(
  options: R977NshapNextActivationProbeOptions = {},
): Promise<{ output: R977NshapNextActivationProbeOutput; outputPath: string }> {
  const inputs = {
    activationFeasibility: await readJsonIfPresent(
      options.activationFeasibilityPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "nshap-activation-feasibility.latest.json"),
    ),
    activationLabels: await readJsonIfPresent(
      options.activationLabelsPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-nshap-activation-labels.latest.json"),
    ),
    headerPreflight: await readJsonIfPresent(
      options.headerPreflightPath ?? path.join(DEFAULT_SOURCE_INTAKE_DIR, "nshap-header-preflight.latest.json"),
    ),
    metadataBenchmarkCard: await readJsonIfPresent(
      options.metadataBenchmarkCardPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r613-nshap-metadata-benchmark-card.latest.json"),
    ),
  };
  validateInputBoundaries(inputs);

  const inputArtifacts = summarizeInputs(inputs);
  const benchmarkCardReadiness = summarizeBenchmarkCardReadiness(inputs.metadataBenchmarkCard);
  const rowExecutionGate = summarizeRowExecutionGate(inputs.activationLabels, inputArtifacts);
  const functionCognitionSidecar = summarizeFunctionCognitionSidecar({
    activationFeasibility: inputs.activationFeasibility,
    metadataBenchmarkCard: inputs.metadataBenchmarkCard,
    rowExecutionGate,
  });

  const output: R977NshapNextActivationProbeOutput = {
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
    benchmarkCardReadiness,
    createdAt: options.createdAt ?? new Date().toISOString(),
    functionCognitionSidecar,
    inputArtifacts,
    packetId: "r977-nshap-next-activation-probe",
    rowExecutionGate,
    schemaVersion: R977_NSHAP_NEXT_ACTIVATION_PROBE_SCHEMA_VERSION,
    source: "NSHAP",
    status: "research-local-aggregate-only",
    summary: {
      benchmarkCardReady: benchmarkCardReadiness.readyForBenchmarkCard,
      conclusion: conclusionFor({ benchmarkCardReadiness, functionCognitionSidecar, rowExecutionGate }),
      productPromotionAuthorized: false,
      rowExecutionUnlocked: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R977 NSHAP activation probe failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeBenchmarkCardReadiness(
  value: unknown | null,
): R977NshapNextActivationProbeOutput["benchmarkCardReadiness"] {
  const root = optionalRecord(value);
  const card = optionalRecord(root?.benchmarkCard);
  const cardStatus = optionalMetadataLabel(card?.cardStatus, "NSHAP benchmark card status");
  const readyForBenchmarkCard = cardStatus === "metadata_locked_no_execution"
    && optionalBoolean(optionalRecord(card?.sourceFit)?.endpointReadyForBenchmarkDesign) === true;
  return {
    available: Boolean(root),
    endpointFamily: optionalMetadataLabel(card?.endpointFamily, "NSHAP endpoint family"),
    readyForBenchmarkCard,
    status: readyForBenchmarkCard ? "available_locked_no_execution" : "missing_or_not_locked",
  };
}

function summarizeRowExecutionGate(
  activationLabels: unknown | null,
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>,
): R977NshapNextActivationProbeOutput["rowExecutionGate"] {
  const missingMetadata = Object.values(inputArtifacts).some((artifact) => artifact.status === "missing");
  const root = optionalRecord(activationLabels);
  const rights = optionalRecord(root?.sourceRightsAndAggregateOutput);
  const rowReadiness = optionalRecord(root?.rowExecutionReadiness);
  const requiredLabels = readMetadataLabelArray(rights?.requiredHumanLabels, "NSHAP required human labels", false)
    .map((label) => allowedActivationLabel(label));
  const sourceRightsLabelsComplete = optionalBoolean(rights?.labelsComplete) === true;
  const aggregateOutputsActive = optionalBoolean(rights?.aggregateOutputsActive) === true;
  const endpointLabelComplete = sourceRightsLabelsComplete
    && !requiredLabels.includes("mortality_or_followup_endpoint_available");
  const priorBlockingReasons = readMetadataLabelArray(rowReadiness?.blockingReasons, "NSHAP blocking reasons", false)
    .map((reason) => allowedBlockingReason(reason));
  const blockingReasons = dedupeLabels([
    missingMetadata ? "missing_required_metadata_artifacts" : null,
    ...priorBlockingReasons,
    sourceRightsLabelsComplete && requiredLabels.length > 0 ? "required_activation_labels_still_present" : null,
    sourceRightsLabelsComplete && !aggregateOutputsActive ? "aggregate_output_permission_not_active" : null,
    !endpointLabelComplete ? "mortality_or_followup_endpoint_label_unconfirmed" : null,
    "outcome_scoring_requires_separate_execution_gate",
  ]);
  const status = missingMetadata
    ? "blocked_missing_metadata"
    : sourceRightsLabelsComplete && aggregateOutputsActive && endpointLabelComplete && requiredLabels.length === 0
      ? "metadata_ready_no_score_scaffold_only"
      : "blocked_source_rights_or_endpoint_labels";
  return {
    blockingReasons,
    aggregateOutputsActive,
    endpointLabelComplete,
    nextAction: status === "blocked_missing_metadata"
      ? "refresh_nshap_metadata_artifacts"
      : status === "metadata_ready_no_score_scaffold_only"
        ? "draft_no_score_function_sidecar_scaffold"
        : "complete_source_rights_endpoint_and_aggregate_output_labels",
    rowExecutionUnlocked: false,
    sourceRightsLabelsComplete,
    status,
  };
}

function summarizeFunctionCognitionSidecar(input: {
  activationFeasibility: unknown | null;
  metadataBenchmarkCard: unknown | null;
  rowExecutionGate: R977NshapNextActivationProbeOutput["rowExecutionGate"];
}): R977NshapNextActivationProbeOutput["functionCognitionSidecar"] {
  const card = optionalRecord(optionalRecord(input.metadataBenchmarkCard)?.benchmarkCard);
  const familyIds = readRecordArray(card?.candidateFamilies, "NSHAP candidate families", false)
    .map((family) => optionalMetadataLabel(family.candidateFamilyId, "NSHAP candidate family id"))
    .filter(isString);
  const featureFamilies = optionalRecord(optionalRecord(input.activationFeasibility)?.featureFamilies);
  const functionLane = summarizeLane({
    candidateFamilyAvailable: familyIds.includes("anchor_plus_function_sidecar"),
    featureSignal: readFeatureSignal(featureFamilies?.activityOrFunction),
    missingCandidateBlocker: "function_sidecar_candidate_missing",
    missingSignalBlocker: "function_header_signal_missing",
    nextActionIfBlocked: "complete_source_rights_endpoint_and_aggregate_output_labels",
    nextActionIfReady: "draft_no_score_function_sidecar_scaffold",
    rowExecutionGate: input.rowExecutionGate,
    upstreamBlockers: ["source_activation_complete", "mortality_or_followup_endpoint_label_complete"],
  });
  const cognitionLane = summarizeLane({
    candidateFamilyAvailable: familyIds.includes("cognition_shadow_after_function"),
    featureSignal: readFeatureSignal(featureFamilies?.cognition),
    missingCandidateBlocker: "cognition_shadow_candidate_missing",
    missingSignalBlocker: "cognition_header_signal_missing",
    nextActionIfBlocked: "keep_cognition_shadow_until_function_sidecar_review",
    nextActionIfReady: "draft_cognition_shadow_checks_after_function_result",
    rowExecutionGate: input.rowExecutionGate,
    upstreamBlockers: [
      "function_sidecar_result_available",
      "source_activation_complete",
      "mortality_or_followup_endpoint_label_complete",
    ],
  });
  const laneStatus = input.rowExecutionGate.status === "blocked_missing_metadata"
    || functionLane.status === "not_ready"
    || cognitionLane.status === "not_ready"
    ? "not_ready"
    : input.rowExecutionGate.status === "metadata_ready_no_score_scaffold_only"
      ? "metadata_ready_for_no_score_sidecar_scaffold"
      : "blocked_activation_report_only";
  return {
    cognitionLane,
    functionLane,
    laneStatus,
    rowExecutionUnlocked: false,
    scoringUnlocked: false,
  };
}

function summarizeLane(input: {
  candidateFamilyAvailable: boolean;
  featureSignal: FeatureSignal;
  missingCandidateBlocker: string;
  missingSignalBlocker: string;
  nextActionIfBlocked: string;
  nextActionIfReady: string;
  rowExecutionGate: R977NshapNextActivationProbeOutput["rowExecutionGate"];
  upstreamBlockers: string[];
}): LaneReadiness {
  const localBlockers = [
    input.candidateFamilyAvailable ? null : input.missingCandidateBlocker,
    input.featureSignal.present ? null : input.missingSignalBlocker,
  ];
  const blockedUntil = dedupeLabels([
    ...localBlockers,
    ...(
      input.rowExecutionGate.status === "metadata_ready_no_score_scaffold_only" ? [] : input.upstreamBlockers
    ),
  ]);
  const status: LaneStatus = localBlockers.some(isString)
    ? "not_ready"
    : input.rowExecutionGate.status === "metadata_ready_no_score_scaffold_only"
      ? "metadata_ready_for_no_score_scaffold"
      : input.rowExecutionGate.status;
  return {
    blockedUntil,
    candidateFamilyAvailable: input.candidateFamilyAvailable,
    headerSignal: input.featureSignal,
    nextAction: status === "metadata_ready_for_no_score_scaffold" ? input.nextActionIfReady : input.nextActionIfBlocked,
    status,
  };
}

function readFeatureSignal(value: unknown): FeatureSignal {
  const root = optionalRecord(value);
  const datasetCount = optionalNumber(root?.datasetCount) ?? 0;
  return {
    datasetCountBand: optionalMetadataLabel(root?.datasetCountBand, "feature dataset count band")
      ?? countBand(datasetCount),
    headerMatchBand: optionalMetadataLabel(root?.headerMatchBand, "feature header match band") ?? "0",
    present: optionalBoolean(root?.present) === true,
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[ArtifactKey, unknown | null]>) {
    if (!value) continue;
    const root = requiredRecord(value, key);
    const boundaries = [
      optionalRecord(root.boundary),
      optionalRecord(root.artifactBoundary),
    ].filter(isRecord);
    for (const boundary of boundaries) {
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

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    activationFeasibility: summarizeArtifact("nshap-activation-feasibility.latest.json", inputs.activationFeasibility),
    activationLabels: summarizeArtifact("r614-nshap-activation-labels.latest.json", inputs.activationLabels),
    headerPreflight: summarizeArtifact("nshap-header-preflight.latest.json", inputs.headerPreflight),
    metadataBenchmarkCard: summarizeArtifact(
      "r613-nshap-metadata-benchmark-card.latest.json",
      inputs.metadataBenchmarkCard,
    ),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, artifact);
  return {
    artifact,
    packetId: optionalMetadataLabel(root.packetId, `${artifact} packet id`),
    schemaVersion: optionalMetadataLabel(root.schemaVersion, `${artifact} schema version`),
    status: "available",
  };
}

function conclusionFor(input: {
  benchmarkCardReadiness: R977NshapNextActivationProbeOutput["benchmarkCardReadiness"];
  functionCognitionSidecar: R977NshapNextActivationProbeOutput["functionCognitionSidecar"];
  rowExecutionGate: R977NshapNextActivationProbeOutput["rowExecutionGate"];
}): R977NshapNextActivationProbeOutput["summary"]["conclusion"] {
  if (!input.benchmarkCardReadiness.readyForBenchmarkCard || input.functionCognitionSidecar.laneStatus === "not_ready") {
    return "nshap_metadata_incomplete_for_sidecar_probe";
  }
  if (input.rowExecutionGate.status === "metadata_ready_no_score_scaffold_only") {
    return "nshap_metadata_ready_for_no_score_sidecar_scaffold";
  }
  return "nshap_benchmark_card_ready_but_sidecar_blocked_by_activation_labels";
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (optionalRecord(error)?.code === "ENOENT") return null;
    throw new Error("Failed to read NSHAP activation probe metadata.");
  }
}

function readRecordArray(value: unknown, label: string, required = true): Record<string, unknown>[] {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} must be an object array.`);
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`${label} must be an object array.`);
  }
  return value as Record<string, unknown>[];
}

function readMetadataLabelArray(value: unknown, label: string, required = true): string[] {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label} must be a string array.`);
    return [];
  }
  if (!Array.isArray(value)) throw new Error(`${label} must be a string array.`);
  return value.map((item, index) => requiredMetadataLabel(item, `${label} ${index + 1}`));
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalMetadataLabel(value: unknown, label: string): string | null {
  return typeof value === "string" && value.length > 0 ? requiredMetadataLabel(value, label) : null;
}

function requiredMetadataLabel(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    /[\r\n\t/\\]/u.test(value) ||
    /\b(?:authorization|codebook|coefficient|identifier|participant|prediction|raw\s*row|row\s*value|small\s*cell|source\s*body|source\s*text|split\s*id)\b/iu.test(value)
  ) {
    throw new Error(`${label} is not a safe metadata label.`);
  }
  return value;
}

function allowedActivationLabel(value: string): string {
  const allowed = new Set([
    "aggregate_output_permission_clear",
    "biomarker_overlap_clear",
    "mortality_or_followup_endpoint_available",
    "terms_allow_local_research_rows",
    "wave_linkage_policy_clear",
  ]);
  if (!allowed.has(value)) throw new Error("R977 NSHAP activation probe saw an unexpected activation label.");
  return value;
}

function allowedBlockingReason(value: string): string {
  const allowed = new Set([
    "aggregate_output_permission_not_active",
    "missing_expected_archives",
    "missing_required_metadata_artifacts",
    "mortality_or_followup_endpoint_label_unconfirmed",
    "outcome_scoring_requires_separate_execution_gate",
    "required_activation_labels_still_present",
    "source_rights_or_aggregate_output_permission_unconfirmed",
  ]);
  if (!allowed.has(value)) return "unrecognized_upstream_blocking_reason";
  return value;
}

function dedupeLabels(values: Array<string | null>): string[] {
  return [...new Set(values.filter(isString).map((value) => requiredMetadataLabel(value, "status label")))].sort();
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function countBand(count: number): string {
  if (count <= 0) return "0";
  if (count < 10) return "1-9";
  if (count < 50) return "10-49";
  if (count < 100) return "50-99";
  if (count < 500) return "100-499";
  if (count < 1000) return "500-999";
  return "1000+";
}

async function main(): Promise<void> {
  const { output } = await runR977NshapNextActivationProbe({
    activationFeasibilityPath: process.env.MURPH_AGE_NSHAP_ACTIVATION_FEASIBILITY_PATH,
    activationLabelsPath: process.env.MURPH_AGE_R614_NSHAP_LABELS_PATH,
    headerPreflightPath: process.env.MURPH_AGE_NSHAP_HEADER_PREFLIGHT_PATH,
    metadataBenchmarkCardPath: process.env.MURPH_AGE_R613_NSHAP_BENCHMARK_CARD_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    benchmarkCardReady: output.summary.benchmarkCardReady,
    conclusion: output.summary.conclusion,
    nextAction: output.rowExecutionGate.nextAction,
    packetId: output.packetId,
    productPromotionAuthorized: output.summary.productPromotionAuthorized,
    rowExecutionUnlocked: output.summary.rowExecutionUnlocked,
    schemaVersion: output.schemaVersion,
    sidecarLaneStatus: output.functionCognitionSidecar.laneStatus,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R977 NSHAP next activation probe failed.\n");
    process.exitCode = 1;
  });
}
