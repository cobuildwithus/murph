import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const HAALSI_SOURCE_FEASIBILITY_SCHEMA_VERSION = "murph-age-haalsi-source-feasibility.v1" as const;

const DEFAULT_SOURCE_INTAKE_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "source-intake",
);
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const HEADER_PREFLIGHT_FILE_NAME = "haalsi-header-preflight.latest.json";
const DOWNLOAD_INVENTORY_FILE_NAME = "download-inventory.latest.json";
const OUTPUT_FILE_NAME = "haalsi-source-feasibility.latest.json";

type CoverageStatus = "absent" | "partial" | "present";
type LaneClassification = "no-score_activation_lane" | "feature_transport_lane" | "executable_future_outcome_lane";
type EndpointReadinessStatus =
  | "blocked_missing_file_or_header_coverage"
  | "blocked_missing_mortality_or_followup_header_coverage"
  | "metadata_ready_activation_required_before_rows"
  | "metadata_ready_for_future_outcome_design";
type FeatureFamilyKey = "anthropometric" | "lab" | "vitals";

interface HeaderSignalSummary {
  datasetCountBand: string;
  headerMatchBand: string;
  status: CoverageStatus;
}

interface DatasetMetadata {
  categorySignals: Record<string, unknown>;
  columnCount: number;
  dataset: string;
  rowCount: number | null;
}

export interface HaalsiSourceFeasibilityOptions {
  createdAt?: string;
  downloadInventoryPath?: string;
  headerPreflightPath?: string;
  outputDir?: string;
  sourceIntakeDir?: string;
}

export interface HaalsiSourceFeasibilityOutput {
  boundary: {
    abstractsStored: false;
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    modelScoringPerformed: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowParsingPerformed: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitIdentifiersStored: false;
    variableNameSamplesStored: false;
  };
  createdAt: string;
  endpointReadiness: {
    mortalityOrFollowupHeaderCoverage: HeaderSignalSummary;
    readyForFutureOutcomeDesign: boolean;
    rowActivationRequiredBeforeExecution: boolean;
    status: EndpointReadinessStatus;
  };
  featureFamilyCoverage: Record<FeatureFamilyKey, HeaderSignalSummary>;
  fileCoverage: {
    haalsiLaneCountBand: string;
    presentFileCountBand: string;
    status: CoverageStatus;
  };
  headerCoverage: {
    datasetCountBand: string;
    datasetsWithHeadersBand: string;
    status: CoverageStatus;
    totalHeaderCountBand: string;
  };
  laneAssessment: {
    classification: LaneClassification;
    noScoreActivationLane: boolean;
    featureTransportLane: boolean;
    executableFutureOutcomeLane: boolean;
    nextAction:
      | "complete_haalsi_source_intake_metadata"
      | "fill_source_rights_and_activation_labels_before_row_execution"
      | "draft_locked_haalsi_future_outcome_benchmark_card";
    rationaleLabels: string[];
  };
  packetId: "haalsi-source-feasibility";
  schemaVersion: typeof HAALSI_SOURCE_FEASIBILITY_SCHEMA_VERSION;
  source: "HAALSI";
  status: "research-local-metadata-only";
}

export async function runHaalsiSourceFeasibility(
  options: HaalsiSourceFeasibilityOptions = {},
): Promise<{ output: HaalsiSourceFeasibilityOutput; outputPath: string }> {
  const sourceIntakeDir = options.sourceIntakeDir ?? DEFAULT_SOURCE_INTAKE_DIR;
  const [headerPreflight, downloadInventory] = await Promise.all([
    readJsonIfPresent(options.headerPreflightPath ?? path.join(sourceIntakeDir, HEADER_PREFLIGHT_FILE_NAME)),
    readJsonIfPresent(options.downloadInventoryPath ?? path.join(sourceIntakeDir, DOWNLOAD_INVENTORY_FILE_NAME)),
  ]);

  const datasets = readHaalsiDatasets(headerPreflight);
  const fileCoverage = summarizeFileCoverage(downloadInventory);
  const headerCoverage = summarizeHeaderCoverage(datasets);
  const featureFamilyCoverage = summarizeFeatureFamilyCoverage(datasets);
  const rowActivationRequiredBeforeExecution = readActivationRequired(downloadInventory);
  const endpointReadiness = summarizeEndpointReadiness({
    featureFamilyCoverage,
    fileCoverage,
    headerCoverage,
    mortalityOrFollowupHeaderCoverage: summarizeCategory(datasets, [
      "mortality_or_followup",
      "mortality_or_eol",
      "followup",
      "vital_status",
    ]),
    rowActivationRequiredBeforeExecution,
  });
  const laneAssessment = assessLane({ endpointReadiness, featureFamilyCoverage, fileCoverage, headerCoverage });

  const output: HaalsiSourceFeasibilityOutput = {
    boundary: {
      abstractsStored: false,
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      modelScoringPerformed: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformed: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitIdentifiersStored: false,
      variableNameSamplesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    endpointReadiness,
    featureFamilyCoverage,
    fileCoverage,
    headerCoverage,
    laneAssessment,
    packetId: "haalsi-source-feasibility",
    schemaVersion: HAALSI_SOURCE_FEASIBILITY_SCHEMA_VERSION,
    source: "HAALSI",
    status: "research-local-metadata-only",
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`HAALSI source feasibility failed metadata-only egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeFileCoverage(value: unknown | null): HaalsiSourceFeasibilityOutput["fileCoverage"] {
  if (!value) {
    return {
      haalsiLaneCountBand: "0",
      presentFileCountBand: "0",
      status: "absent",
    };
  }
  const root = requiredRecord(value, "download inventory");
  assertInventoryBoundary(root);
  const lanes = readRecordArray(root.lanes, "download inventory lanes").filter((lane) =>
    metadataString(lane.lane).toLowerCase().includes("haalsi")
  );
  const presentFileCount = lanes.reduce((sum, lane) => sum + (optionalNumber(lane.presentFileCount) ?? 0), 0);
  const expectedFileCount = Math.max(presentFileCount, lanes.length);
  return {
    haalsiLaneCountBand: countBand(lanes.length),
    presentFileCountBand: countBand(presentFileCount),
    status: coverageStatus(presentFileCount, expectedFileCount),
  };
}

function summarizeHeaderCoverage(datasets: DatasetMetadata[]): HaalsiSourceFeasibilityOutput["headerCoverage"] {
  const datasetsWithHeaders = datasets.filter((dataset) => dataset.columnCount > 0).length;
  const totalHeaderCount = datasets.reduce((sum, dataset) => sum + dataset.columnCount, 0);
  return {
    datasetCountBand: countBand(datasets.length),
    datasetsWithHeadersBand: countBand(datasetsWithHeaders),
    status: coverageStatus(datasetsWithHeaders, datasets.length),
    totalHeaderCountBand: countBand(totalHeaderCount),
  };
}

function summarizeFeatureFamilyCoverage(datasets: DatasetMetadata[]): Record<FeatureFamilyKey, HeaderSignalSummary> {
  return {
    anthropometric: summarizeCategory(datasets, [
      "anthropometric",
      "anthropometrics",
      "anthropometric_or_vitals",
      "body_composition",
    ]),
    lab: summarizeCategory(datasets, [
      "biomarker_or_lab",
      "biomarker",
      "biomarkers",
      "lab",
      "labs",
      "blood_biomarker",
    ]),
    vitals: summarizeCategory(datasets, [
      "vitals",
      "vital",
      "vital_signs",
      "blood_pressure_or_vitals",
      "anthropometric_or_vitals",
    ]),
  };
}

function summarizeEndpointReadiness(input: {
  featureFamilyCoverage: Record<FeatureFamilyKey, HeaderSignalSummary>;
  fileCoverage: HaalsiSourceFeasibilityOutput["fileCoverage"];
  headerCoverage: HaalsiSourceFeasibilityOutput["headerCoverage"];
  mortalityOrFollowupHeaderCoverage: HeaderSignalSummary;
  rowActivationRequiredBeforeExecution: boolean;
}): HaalsiSourceFeasibilityOutput["endpointReadiness"] {
  const hasCoreFeatureCoverage = Object.values(input.featureFamilyCoverage).every((summary) => summary.status !== "absent");
  const hasFileAndHeaderCoverage = input.fileCoverage.status !== "absent" && input.headerCoverage.status !== "absent";
  const readyForFutureOutcomeDesign = hasFileAndHeaderCoverage
    && hasCoreFeatureCoverage
    && input.mortalityOrFollowupHeaderCoverage.status !== "absent";
  let status: EndpointReadinessStatus = "blocked_missing_file_or_header_coverage";
  if (hasFileAndHeaderCoverage && input.mortalityOrFollowupHeaderCoverage.status === "absent") {
    status = "blocked_missing_mortality_or_followup_header_coverage";
  } else if (readyForFutureOutcomeDesign) {
    status = input.rowActivationRequiredBeforeExecution
      ? "metadata_ready_activation_required_before_rows"
      : "metadata_ready_for_future_outcome_design";
  }
  return {
    mortalityOrFollowupHeaderCoverage: input.mortalityOrFollowupHeaderCoverage,
    readyForFutureOutcomeDesign,
    rowActivationRequiredBeforeExecution: input.rowActivationRequiredBeforeExecution,
    status,
  };
}

function assessLane(input: {
  endpointReadiness: HaalsiSourceFeasibilityOutput["endpointReadiness"];
  featureFamilyCoverage: Record<FeatureFamilyKey, HeaderSignalSummary>;
  fileCoverage: HaalsiSourceFeasibilityOutput["fileCoverage"];
  headerCoverage: HaalsiSourceFeasibilityOutput["headerCoverage"];
}): HaalsiSourceFeasibilityOutput["laneAssessment"] {
  const hasFileAndHeaderCoverage = input.fileCoverage.status !== "absent" && input.headerCoverage.status !== "absent";
  const hasFeatureCoverage = Object.values(input.featureFamilyCoverage).some((summary) => summary.status !== "absent");
  const hasAllCoreFeatures = Object.values(input.featureFamilyCoverage).every((summary) => summary.status !== "absent");
  const rationaleLabels: string[] = [];
  if (!hasFileAndHeaderCoverage) rationaleLabels.push("missing_file_or_header_metadata");
  if (hasFeatureCoverage) rationaleLabels.push("lab_vital_anthropometric_headers_available");
  if (hasAllCoreFeatures) rationaleLabels.push("core_feature_families_available");
  if (input.endpointReadiness.mortalityOrFollowupHeaderCoverage.status !== "absent") {
    rationaleLabels.push("mortality_or_followup_headers_available");
  }
  if (input.endpointReadiness.rowActivationRequiredBeforeExecution) {
    rationaleLabels.push("row_execution_requires_activation_labels");
  }

  if (!hasFileAndHeaderCoverage || !hasFeatureCoverage) {
    return {
      classification: "no-score_activation_lane",
      executableFutureOutcomeLane: false,
      featureTransportLane: false,
      noScoreActivationLane: true,
      nextAction: "complete_haalsi_source_intake_metadata",
      rationaleLabels,
    };
  }
  if (!input.endpointReadiness.readyForFutureOutcomeDesign || input.endpointReadiness.rowActivationRequiredBeforeExecution) {
    return {
      classification: "feature_transport_lane",
      executableFutureOutcomeLane: false,
      featureTransportLane: true,
      noScoreActivationLane: false,
      nextAction: input.endpointReadiness.rowActivationRequiredBeforeExecution
        ? "fill_source_rights_and_activation_labels_before_row_execution"
        : "draft_locked_haalsi_future_outcome_benchmark_card",
      rationaleLabels,
    };
  }
  return {
    classification: "executable_future_outcome_lane",
    executableFutureOutcomeLane: true,
    featureTransportLane: false,
    noScoreActivationLane: false,
    nextAction: "draft_locked_haalsi_future_outcome_benchmark_card",
    rationaleLabels,
  };
}

function summarizeCategory(datasets: DatasetMetadata[], categories: string[]): HeaderSignalSummary {
  let datasetCount = 0;
  let headerMatchCount = 0;
  for (const dataset of datasets) {
    let datasetMatches = 0;
    for (const category of categories) {
      const signal = optionalRecord(dataset.categorySignals[category]);
      datasetMatches += optionalNumber(signal?.matchCount) ?? 0;
    }
    if (datasetMatches > 0) datasetCount += 1;
    headerMatchCount += datasetMatches;
  }
  return {
    datasetCountBand: countBand(datasetCount),
    headerMatchBand: countBand(headerMatchCount),
    status: coverageStatus(datasetCount, datasets.length),
  };
}

function readHaalsiDatasets(value: unknown | null): DatasetMetadata[] {
  if (!value) return [];
  const root = requiredRecord(value, "HAALSI header preflight");
  assertHeaderBoundary(root);
  return readRecordArray(root.datasets, "HAALSI header datasets")
    .map((dataset): DatasetMetadata => ({
      categorySignals: optionalRecord(dataset.categorySignals) ?? {},
      columnCount: optionalNumber(dataset.columnCount) ?? 0,
      dataset: metadataString(dataset.dataset),
      rowCount: optionalNumber(dataset.rowCount),
    }))
    .filter((dataset) => dataset.dataset.toLowerCase().includes("haalsi"));
}

function readActivationRequired(value: unknown | null): boolean {
  if (!value) return true;
  const root = requiredRecord(value, "download inventory");
  assertInventoryBoundary(root);
  return root.activationNeededBeforeParsingRows !== false;
}

function assertHeaderBoundary(root: Record<string, unknown>): void {
  const boundary = requiredRecord(root.boundary, "HAALSI header boundary");
  for (const key of [
    "abstractsStored",
    "codebookProseStored",
    "codebookTextStored",
    "localPathsStored",
    "modelParametersStored",
    "participantIdentifiersStored",
    "predictionsStored",
    "rowValuesStored",
    "smallCellsStored",
    "sourceBodiesStored",
    "splitIdentifiersStored",
    "variableLabelsStored",
  ]) {
    if (boundary[key] !== false) throw new Error(`HAALSI header preflight has unsafe boundary flag ${key}.`);
  }
}

function assertInventoryBoundary(root: Record<string, unknown>): void {
  for (const key of [
    "modelScoringPerformed",
    "participantIdentifiersStored",
    "rowValuesStored",
    "sourceBodiesStored",
  ]) {
    if (root[key] !== false) throw new Error(`download inventory has unsafe boundary flag ${key}.`);
  }
  const rowParsing = optionalString(root.rowParsing);
  if (rowParsing && rowParsing !== "not-performed" && rowParsing !== "metadata-only") {
    throw new Error("download inventory rowParsing must be metadata-only or not-performed.");
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read HAALSI source-intake metadata artifact.");
  }
}

function coverageStatus(present: number, expected: number): CoverageStatus {
  if (expected <= 0 || present <= 0) return "absent";
  return present >= expected ? "present" : "partial";
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

function metadataString(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.length > 120 || /[\r\n\t\\/]/u.test(value) || /\b(?:https?|file):/iu.test(value)) {
    throw new Error("HAALSI metadata label is not safe to summarize.");
  }
  return value;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRecordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => requiredRecord(item, label));
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runHaalsiSourceFeasibility({
    downloadInventoryPath: process.env.MURPH_AGE_DOWNLOAD_INVENTORY_PATH,
    headerPreflightPath: process.env.MURPH_AGE_HAALSI_HEADER_PREFLIGHT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    sourceIntakeDir: process.env.MURPH_AGE_SOURCE_INTAKE_DIR,
  }).then(({ output: packet, outputPath }) => {
    console.log(JSON.stringify({
      artifact: path.basename(outputPath),
      endpointReadiness: packet.endpointReadiness.status,
      fileCoverage: packet.fileCoverage.status,
      headerCoverage: packet.headerCoverage.status,
      laneClassification: packet.laneAssessment.classification,
      packetId: packet.packetId,
      productPromotionAuthorized: packet.boundary.productPromotionAuthorized,
      schemaVersion: packet.schemaVersion,
      status: packet.status,
    }, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "HAALSI source feasibility failed.");
    process.exitCode = 1;
  });
}
