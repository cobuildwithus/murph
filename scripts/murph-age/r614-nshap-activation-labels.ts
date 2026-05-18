import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R614_NSHAP_ACTIVATION_LABELS_SCHEMA_VERSION =
  "murph-age-r614-nshap-activation-labels.v1" as const;

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
const DEFAULT_DOWNLOADS_DIR = path.join(os.homedir(), "Downloads");
const DEFAULT_NSHAP_SOURCE_CONFIRMATION_PATH = path.join(
  ".runtime",
  "murph-age",
  "source-confirmations",
  "nshap-public-use-confirmation.local.json",
);
const OUTPUT_FILE_NAME = "r614-nshap-activation-labels.latest.json";
const LANE_GROUP_ID = "nshap-rounds";
const DEFAULT_REQUIRED_HUMAN_LABELS = [
  "aggregate_output_permission_clear",
  "mortality_or_followup_endpoint_available",
  "terms_allow_local_research_rows",
] as const;
const ALLOWED_REQUIRED_HUMAN_LABELS = new Set<string>([
  ...DEFAULT_REQUIRED_HUMAN_LABELS,
  "biomarker_overlap_clear",
  "wave_linkage_policy_clear",
]);

type ArtifactKey =
  | "downloadInventory"
  | "nshapActivationFeasibility"
  | "r613MetadataBenchmarkCard"
  | "sourceActivationQueue";
type InputMap = Record<ArtifactKey, unknown | null> & { sourceConfirmation: unknown | null };
type ArtifactStatus = "available" | "missing";
type ReadinessStatus =
  | "blocked_missing_metadata_or_archives"
  | "blocked_source_rights_or_output_permission_unconfirmed"
  | "metadata_ready_activation_labels_complete_no_scoring";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

export interface R614NshapActivationLabelsOptions {
  createdAt?: string;
  downloadInventoryPath?: string;
  downloadsDir?: string;
  nshapActivationFeasibilityPath?: string;
  outputDir?: string;
  r613Path?: string;
  sourceConfirmationPath?: string;
  sourceActivationQueuePath?: string;
}

export interface R614NshapActivationLabelsOutput {
  archiveReadiness: {
    downloadInventoryStatus: ArtifactStatus;
    downloadsDirectoryChecked: boolean;
    exactArchiveNamesStored: false;
    expectedArchiveCount: number;
    expectedArchiveCountBand: string;
    missingArchiveCount: number;
    observedArchiveCount: number;
    observedArchiveCountBand: string;
    status: "all_expected_archives_observed" | "inventory_missing" | "missing_expected_archives";
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
    variableNamesStored: false;
    variableNameSamplesStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  lockedBenchmarkCard: {
    aggregateOutputLabelCountBand: string | null;
    available: boolean;
    candidateFamilyCountBand: string | null;
    cardStatus: string | null;
    endpointFamily: string | null;
  };
  packetId: "r614-nshap-activation-labels";
  rowExecutionReadiness: {
    blockingReasons: string[];
    nextAction:
      | "complete_source_rights_and_aggregate_output_labels"
      | "refresh_metadata_and_archive_presence"
      | "design_row_execution_harness_without_scoring";
    outcomeScoringUnlocked: false;
    rowExecutionUnlocked: false;
    rowParsingUnlocked: false;
    status: ReadinessStatus;
  };
  schemaVersion: typeof R614_NSHAP_ACTIVATION_LABELS_SCHEMA_VERSION;
  source: "NSHAP";
  sourceRightsAndAggregateOutput: {
    aggregateOutputActivationStatus:
      | "active_for_suppressed_aggregate_outputs"
      | "blocked_permission_unconfirmed"
      | "blocked_source_rights_unconfirmed";
    aggregateOutputPermission: string;
    aggregateOutputsActive: boolean;
    confirmationArtifactStatus: "available" | "missing";
    labelsComplete: boolean;
    minimumCellSuppressionPolicy: "not_locked";
    requiredHumanLabels: string[];
    rowParsingUnlockedBySourceRights: false;
    termsAllowLocalResearchRows: string;
  };
  status: "research-local-aggregate-only";
  summary: {
    aggregateOutputsActive: boolean;
    conclusion:
      | "nshap_activation_labels_block_row_execution"
      | "nshap_activation_labels_missing_metadata"
      | "nshap_activation_labels_ready_for_row_harness_no_scoring";
    outcomeScoringUnlockedCountBand: "0";
    productPromotionAuthorized: false;
    sourceRightsLabelsComplete: boolean;
  };
}

export async function runR614NshapActivationLabels(
  options: R614NshapActivationLabelsOptions = {},
): Promise<{ output: R614NshapActivationLabelsOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const inputArtifacts = summarizeInputs(inputs);
  const archiveReadiness = await summarizeArchiveReadiness({
    downloadInventory: inputs.downloadInventory,
    downloadsDir: options.downloadsDir ?? DEFAULT_DOWNLOADS_DIR,
  });
  const lockedBenchmarkCard = summarizeBenchmarkCard(inputs.r613MetadataBenchmarkCard);
  const sourceRightsAndAggregateOutput = summarizeSourceRightsAndAggregateOutput({
    r613: inputs.r613MetadataBenchmarkCard,
    sourceConfirmation: inputs.sourceConfirmation,
    sourceActivationQueue: inputs.sourceActivationQueue,
  });
  const rowExecutionReadiness = summarizeRowExecutionReadiness({
    archiveReadiness,
    inputArtifacts,
    lockedBenchmarkCard,
    sourceRightsAndAggregateOutput,
  });

  const output: R614NshapActivationLabelsOutput = {
    archiveReadiness,
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
      variableNamesStored: false,
      variableNameSamplesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts,
    lockedBenchmarkCard,
    packetId: "r614-nshap-activation-labels",
    rowExecutionReadiness,
    schemaVersion: R614_NSHAP_ACTIVATION_LABELS_SCHEMA_VERSION,
    source: "NSHAP",
    sourceRightsAndAggregateOutput,
    status: "research-local-aggregate-only",
    summary: {
      aggregateOutputsActive: sourceRightsAndAggregateOutput.aggregateOutputsActive,
      conclusion: conclusionFor(rowExecutionReadiness.status),
      outcomeScoringUnlockedCountBand: "0",
      productPromotionAuthorized: false,
      sourceRightsLabelsComplete: sourceRightsAndAggregateOutput.labelsComplete,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R614 NSHAP activation labels failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R614NshapActivationLabelsOptions,
): Promise<InputMap> {
  return {
    downloadInventory: await readJsonIfPresent(
      options.downloadInventoryPath ?? path.join(DEFAULT_SOURCE_INTAKE_DIR, "download-inventory.latest.json"),
    ),
    nshapActivationFeasibility: await readJsonIfPresent(
      options.nshapActivationFeasibilityPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "nshap-activation-feasibility.latest.json"),
    ),
    r613MetadataBenchmarkCard: await readJsonIfPresent(
      options.r613Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r613-nshap-metadata-benchmark-card.latest.json"),
    ),
    sourceActivationQueue: await readJsonIfPresent(
      options.sourceActivationQueuePath ?? path.join(DEFAULT_SOURCE_INTAKE_DIR, "activation-queue.latest.json"),
    ),
    sourceConfirmation: await readJsonIfPresent(options.sourceConfirmationPath ?? DEFAULT_NSHAP_SOURCE_CONFIRMATION_PATH),
  };
}

async function summarizeArchiveReadiness(input: {
  downloadInventory: unknown | null;
  downloadsDir: string;
}): Promise<R614NshapActivationLabelsOutput["archiveReadiness"]> {
  const expectedArchiveBasenames = nshapArchiveBasenames(input.downloadInventory);
  const observedArchiveCount = (await Promise.all(expectedArchiveBasenames.map(async (archive) =>
    await fileExists(path.join(input.downloadsDir, archive))
  ))).filter(Boolean).length;
  const expectedArchiveCount = expectedArchiveBasenames.length;
  const missingArchiveCount = Math.max(expectedArchiveCount - observedArchiveCount, 0);
  const status = !input.downloadInventory
    ? "inventory_missing"
    : expectedArchiveCount > 0 && missingArchiveCount === 0
      ? "all_expected_archives_observed"
      : "missing_expected_archives";
  return {
    downloadInventoryStatus: input.downloadInventory ? "available" : "missing",
    downloadsDirectoryChecked: true,
    exactArchiveNamesStored: false,
    expectedArchiveCount,
    expectedArchiveCountBand: countBand(expectedArchiveCount),
    missingArchiveCount,
    observedArchiveCount,
    observedArchiveCountBand: countBand(observedArchiveCount),
    status,
  };
}

function nshapArchiveBasenames(value: unknown | null): string[] {
  if (!value) return [];
  const root = requiredRecord(value, "download inventory");
  assertSourceIntakeBoundary(root, "download inventory");
  const lanes = readRecordArray(root.lanes, "download inventory lanes", false);
  return [...new Set(lanes
    .filter((lane) => optionalString(lane.lane)?.toLowerCase().includes("nshap"))
    .flatMap((lane) => readMetadataLabelArray(lane.files, "NSHAP inventory files", false))
    .map((fileName) => path.basename(fileName)))].sort();
}

function summarizeBenchmarkCard(
  value: unknown | null,
): R614NshapActivationLabelsOutput["lockedBenchmarkCard"] {
  if (!value) {
    return {
      aggregateOutputLabelCountBand: null,
      available: false,
      candidateFamilyCountBand: null,
      cardStatus: null,
      endpointFamily: null,
    };
  }
  const root = requiredRecord(value, "R613 NSHAP metadata benchmark card");
  const card = optionalRecord(root.benchmarkCard) ?? {};
  return {
    aggregateOutputLabelCountBand: countBand(readMetadataLabelArray(card.aggregateOutputsAllowed, "aggregate output labels", false).length),
    available: true,
    candidateFamilyCountBand: countBand(readRecordArray(card.candidateFamilies, "candidate families", false).length),
    cardStatus: optionalMetadataLabel(card.cardStatus, "benchmark card status"),
    endpointFamily: optionalMetadataLabel(card.endpointFamily, "benchmark card endpoint family"),
  };
}

function summarizeSourceRightsAndAggregateOutput(input: {
  r613: unknown | null;
  sourceConfirmation: unknown | null;
  sourceActivationQueue: unknown | null;
}): R614NshapActivationLabelsOutput["sourceRightsAndAggregateOutput"] {
  const sourceActivation = optionalRecord(optionalRecord(requiredOrNull(input.r613)?.benchmarkCard)?.sourceActivation);
  const confirmation = summarizeLocalConfirmation(input.sourceConfirmation);
  const termsAllowLocalResearchRows = confirmation.complete
    ? "confirmed_yes"
    :
    optionalMetadataLabel(sourceActivation?.termsAllowLocalResearchRows, "NSHAP terms label")
      ?? "unconfirmed_human_required";
  const aggregateOutputPermission = confirmation.complete
    ? "confirmed_yes"
    :
    optionalMetadataLabel(sourceActivation?.aggregateOutputPermission, "NSHAP aggregate-output label")
      ?? "unconfirmed_human_required";
  const sourceRightsLabelsComplete = confirmation.complete
    || optionalBoolean(sourceActivation?.sourceRightsLabelsComplete) === true;
  const aggregateOutputsActive = sourceRightsLabelsComplete
    && termsAllowLocalResearchRows === "confirmed_yes"
    && aggregateOutputPermission === "confirmed_yes";
  return {
    aggregateOutputActivationStatus: aggregateOutputsActive
      ? "active_for_suppressed_aggregate_outputs"
      : aggregateOutputPermission === "confirmed_yes"
        ? "blocked_source_rights_unconfirmed"
        : "blocked_permission_unconfirmed",
    aggregateOutputPermission,
    aggregateOutputsActive,
    confirmationArtifactStatus: confirmation.status,
    labelsComplete: sourceRightsLabelsComplete,
    minimumCellSuppressionPolicy: "not_locked",
    requiredHumanLabels: confirmation.complete ? [] : requiredHumanLabels(input.sourceActivationQueue),
    rowParsingUnlockedBySourceRights: false,
    termsAllowLocalResearchRows,
  };
}

function summarizeLocalConfirmation(value: unknown | null): { complete: boolean; status: "available" | "missing" } {
  const root = optionalRecord(value);
  if (!root) return { complete: false, status: "missing" };
  const requiredFields = [
    "user_confirms_terms_allow_local_research_rows",
    "user_confirms_aggregate_output_permission_clear",
    "user_confirms_mortality_or_followup_endpoint_available",
    "user_confirms_wave_linkage_policy_clear",
    "user_confirms_biomarker_overlap_clear",
    "user_confirms_local_ignored_cache_only",
    "user_confirms_no_rows_or_source_bodies_to_reviewgpt",
    "user_confirms_aggregate_export_with_attribution_and_small_cell_suppression_only",
    "user_confirms_no_reidentification_attempt",
    "user_confirms_no_third_party_transfer",
    "user_confirms_no_product_claims_from_nshap_results",
  ];
  return {
    complete: requiredFields.every((field) => root[field] === true),
    status: "available",
  };
}

function requiredHumanLabels(value: unknown | null): string[] {
  if (!value) {
    return [...DEFAULT_REQUIRED_HUMAN_LABELS];
  }
  const root = requiredRecord(value, "source activation queue");
  assertSourceIntakeBoundary(root.artifactBoundary, "source activation queue boundary");
  const entry = readRecordArray(root.queue, "source activation queue", false)
    .find((queueEntry) => optionalString(queueEntry.laneGroup) === LANE_GROUP_ID);
  const labels = readMetadataLabelArray(optionalRecord(entry)?.activationLabelsNeeded, "NSHAP activation labels", false)
    .map((label) => requiredClosedActivationLabel(label));
  return labels.length > 0 ? labels.sort() : [...DEFAULT_REQUIRED_HUMAN_LABELS];
}

function requiredClosedActivationLabel(value: string): string {
  if (!ALLOWED_REQUIRED_HUMAN_LABELS.has(value)) {
    throw new Error("NSHAP activation labels contains a label outside the R614 allowlist.");
  }
  return value;
}

function summarizeRowExecutionReadiness(input: {
  archiveReadiness: R614NshapActivationLabelsOutput["archiveReadiness"];
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  lockedBenchmarkCard: R614NshapActivationLabelsOutput["lockedBenchmarkCard"];
  sourceRightsAndAggregateOutput: R614NshapActivationLabelsOutput["sourceRightsAndAggregateOutput"];
}): R614NshapActivationLabelsOutput["rowExecutionReadiness"] {
  const missingMetadata = Object.values(input.inputArtifacts).some((artifact) => artifact.status === "missing")
    || !input.lockedBenchmarkCard.available;
  const missingArchives = input.archiveReadiness.status !== "all_expected_archives_observed";
  const sourceBlocked = !input.sourceRightsAndAggregateOutput.labelsComplete
    || !input.sourceRightsAndAggregateOutput.aggregateOutputsActive;
  const blockingReasons = dedupeLabels([
    missingMetadata ? "missing_required_metadata_artifacts" : null,
    missingArchives ? "missing_expected_archives" : null,
    sourceBlocked ? "source_rights_or_aggregate_output_permission_unconfirmed" : null,
    "outcome_scoring_requires_separate_execution_gate",
  ]);
  const status: ReadinessStatus = missingMetadata || missingArchives
    ? "blocked_missing_metadata_or_archives"
    : sourceBlocked
      ? "blocked_source_rights_or_output_permission_unconfirmed"
      : "metadata_ready_activation_labels_complete_no_scoring";
  return {
    blockingReasons,
    nextAction: status === "blocked_missing_metadata_or_archives"
      ? "refresh_metadata_and_archive_presence"
      : status === "blocked_source_rights_or_output_permission_unconfirmed"
        ? "complete_source_rights_and_aggregate_output_labels"
        : "design_row_execution_harness_without_scoring",
    outcomeScoringUnlocked: false,
    rowExecutionUnlocked: false,
    rowParsingUnlocked: false,
    status,
  };
}

function validateInputBoundaries(inputs: InputMap): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (key === "sourceConfirmation") continue;
    if (!value) continue;
    const root = requiredRecord(value, key);
    const boundary = optionalRecord(root.boundary) ?? optionalRecord(root.artifactBoundary);
    if (boundary) assertBoundaryFlags(boundary, `${key} boundary`);
  }
}

function assertSourceIntakeBoundary(value: unknown, label: string): void {
  const root = requiredRecord(value, label);
  for (const key of [
    "codebookTextStored",
    "modelScoringPerformed",
    "participantIdentifiersStored",
    "rowValuesStored",
    "sourceBodiesStored",
  ]) {
    if (root[key] !== undefined && root[key] !== false) {
      throw new Error(`${label} has unsafe boundary flag ${key}.`);
    }
  }
  if (root.rowParsing !== undefined && root.rowParsing !== "not-performed" && root.rowParsing !== "metadata-only") {
    throw new Error(`${label} has unsafe row parsing status.`);
  }
}

function assertBoundaryFlags(value: unknown, label: string): void {
  const boundary = requiredRecord(value, label);
  for (const key of [
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
    "variableNamesStored",
    "variableNameSamplesStored",
  ]) {
    if (boundary[key] !== undefined && boundary[key] !== false) {
      throw new Error(`${label} has unsafe boundary flag ${key}.`);
    }
  }
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    downloadInventory: summarizeArtifact("download-inventory.latest.json", inputs.downloadInventory),
    nshapActivationFeasibility: summarizeArtifact(
      "nshap-activation-feasibility.latest.json",
      inputs.nshapActivationFeasibility,
    ),
    r613MetadataBenchmarkCard: summarizeArtifact(
      "r613-nshap-metadata-benchmark-card.latest.json",
      inputs.r613MetadataBenchmarkCard,
    ),
    sourceActivationQueue: summarizeArtifact("activation-queue.latest.json", inputs.sourceActivationQueue),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, artifact);
  return {
    artifact,
    packetId: optionalMetadataLabel(root.packetId, `${artifact} packet id`) ?? optionalMetadataLabel(root.cardId, `${artifact} card id`),
    schemaVersion: optionalMetadataLabel(root.schemaVersion, `${artifact} schema version`),
    status: "available",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read a Murph Age metadata artifact.");
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
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

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function requiredOrNull(value: unknown | null): Record<string, unknown> | null {
  return value ? requiredRecord(value, "metadata artifact") : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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

function dedupeLabels(values: Array<string | null>): string[] {
  return [...new Set(values.filter(isString).map((value) => requiredMetadataLabel(value, "status label")))].sort();
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 50) return "10-49";
  if (count < 100) return "50-99";
  return "100+";
}

function conclusionFor(
  status: R614NshapActivationLabelsOutput["rowExecutionReadiness"]["status"],
): R614NshapActivationLabelsOutput["summary"]["conclusion"] {
  if (status === "blocked_missing_metadata_or_archives") return "nshap_activation_labels_missing_metadata";
  if (status === "metadata_ready_activation_labels_complete_no_scoring") {
    return "nshap_activation_labels_ready_for_row_harness_no_scoring";
  }
  return "nshap_activation_labels_block_row_execution";
}

async function main(): Promise<void> {
  const { output } = await runR614NshapActivationLabels({
    downloadInventoryPath: process.env.MURPH_AGE_SOURCE_DOWNLOAD_INVENTORY_PATH,
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    nshapActivationFeasibilityPath: process.env.MURPH_AGE_NSHAP_ACTIVATION_FEASIBILITY_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r613Path: process.env.MURPH_AGE_R613_NSHAP_BENCHMARK_CARD_PATH,
    sourceConfirmationPath: process.env.MURPH_AGE_NSHAP_SOURCE_CONFIRMATION_PATH,
    sourceActivationQueuePath: process.env.MURPH_AGE_SOURCE_ACTIVATION_QUEUE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    aggregateOutputsActive: output.summary.aggregateOutputsActive,
    artifact: OUTPUT_FILE_NAME,
    conclusion: output.summary.conclusion,
    outcomeScoringUnlockedCountBand: output.summary.outcomeScoringUnlockedCountBand,
    packetId: output.packetId,
    rowExecutionUnlocked: output.rowExecutionReadiness.rowExecutionUnlocked,
    schemaVersion: output.schemaVersion,
    sourceRightsLabelsComplete: output.summary.sourceRightsLabelsComplete,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R614 NSHAP activation labels failed.\n");
    process.exitCode = 1;
  });
}
