import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const SAGE_SOURCE_FEASIBILITY_SCHEMA_VERSION = "murph-age-sage-source-feasibility.v1" as const;

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
const HEADER_PREFLIGHT_FILE_NAME = "sage-south-africa-header-preflight.latest.json";
const DOWNLOAD_INVENTORY_FILE_NAME = "download-inventory.latest.json";
const OUTPUT_FILE_NAME = "sage-source-feasibility.latest.json";

type CoverageStatus = "absent" | "partial" | "present";
type LaneClassification = "no_score_activation_lane" | "source_fit_context_lane" | "future_outcome_candidate";
type FeatureFamilyKey = "activityFunction" | "anthropometricVitals" | "biomarkerLab" | "sleepRecovery";

interface DatasetMetadata {
  categorySignals: Record<string, unknown>;
  columnCount: number;
  dataset: string;
}

interface SignalSummary {
  datasetCountBand: string;
  headerMatchBand: string;
  status: CoverageStatus;
}

export interface SageSourceFeasibilityOptions {
  createdAt?: string;
  downloadInventoryPath?: string;
  headerPreflightPath?: string;
  outputDir?: string;
  sourceIntakeDir?: string;
}

export interface SageSourceFeasibilityOutput {
  boundary: {
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
    variableNameSamplesStored: false;
  };
  createdAt: string;
  endpointJoinReadiness: {
    endpointHeaderCoverage: SignalSummary;
    individualFeatureCoveragePresent: boolean;
    joinContractLocked: false;
    rowActivationRequiredBeforeExecution: boolean;
    status:
      | "blocked_missing_metadata"
      | "blocked_missing_endpoint_or_feature_coverage"
      | "blocked_join_contract_and_activation_labels";
  };
  featureFamilyCoverage: Record<FeatureFamilyKey, SignalSummary>;
  fileCoverage: {
    presentFileCountBand: string;
    sageLaneCountBand: string;
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
    nextAction:
      | "complete_sage_source_intake_metadata"
      | "draft_sage_terms_endpoint_join_feasibility_card"
      | "draft_locked_sage_future_outcome_benchmark_card";
    rationaleLabels: string[];
    scoreBearingNow: false;
  };
  packetId: "sage-source-feasibility";
  schemaVersion: typeof SAGE_SOURCE_FEASIBILITY_SCHEMA_VERSION;
  source: "SAGE South Africa";
  status: "research-local-metadata-only";
}

export async function runSageSourceFeasibility(
  options: SageSourceFeasibilityOptions = {},
): Promise<{ output: SageSourceFeasibilityOutput; outputPath: string }> {
  const sourceIntakeDir = options.sourceIntakeDir ?? DEFAULT_SOURCE_INTAKE_DIR;
  const [downloadInventory, headerPreflight] = await Promise.all([
    readJsonIfPresent(options.downloadInventoryPath ?? path.join(sourceIntakeDir, DOWNLOAD_INVENTORY_FILE_NAME)),
    readJsonIfPresent(options.headerPreflightPath ?? path.join(sourceIntakeDir, HEADER_PREFLIGHT_FILE_NAME)),
  ]);
  const datasets = readSageDatasets(headerPreflight);
  const fileCoverage = summarizeFileCoverage(downloadInventory);
  const headerCoverage = summarizeHeaderCoverage(datasets);
  const featureFamilyCoverage = summarizeFeatureFamilyCoverage(datasets);
  const endpointHeaderCoverage = summarizeCategory(datasets, ["mortality_or_followup"]);
  const rowActivationRequiredBeforeExecution = readActivationRequired(downloadInventory);
  const endpointJoinReadiness = summarizeEndpointJoinReadiness({
    endpointHeaderCoverage,
    featureFamilyCoverage,
    fileCoverage,
    headerCoverage,
    rowActivationRequiredBeforeExecution,
  });
  const laneAssessment = assessLane(endpointJoinReadiness);

  const output: SageSourceFeasibilityOutput = {
    boundary: {
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
      variableNameSamplesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    endpointJoinReadiness,
    featureFamilyCoverage,
    fileCoverage,
    headerCoverage,
    laneAssessment,
    packetId: "sage-source-feasibility",
    schemaVersion: SAGE_SOURCE_FEASIBILITY_SCHEMA_VERSION,
    source: "SAGE South Africa",
    status: "research-local-metadata-only",
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`SAGE source feasibility failed metadata-only egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function readSageDatasets(value: unknown | null): DatasetMetadata[] {
  if (!value) return [];
  const root = requiredRecord(value, "SAGE header preflight");
  assertHeaderBoundary(root);
  return readRecordArray(root.datasets, "SAGE datasets").map((dataset) => ({
    categorySignals: optionalRecord(dataset.categorySignals) ?? {},
    columnCount: optionalNumber(dataset.columnCount) ?? 0,
    dataset: metadataString(dataset.dataset),
  })).filter((dataset) => dataset.dataset.length > 0);
}

function summarizeFileCoverage(value: unknown | null): SageSourceFeasibilityOutput["fileCoverage"] {
  if (!value) return { presentFileCountBand: "0", sageLaneCountBand: "0", status: "absent" };
  const root = requiredRecord(value, "download inventory");
  assertInventoryBoundary(root);
  const lanes = readRecordArray(root.lanes, "download inventory lanes").filter((lane) =>
    metadataString(lane.lane).toLowerCase().includes("sage")
  );
  const presentFileCount = lanes.reduce((sum, lane) => sum + (optionalNumber(lane.presentFileCount) ?? 0), 0);
  const expectedFileCount = Math.max(presentFileCount, lanes.length);
  return {
    presentFileCountBand: countBand(presentFileCount),
    sageLaneCountBand: countBand(lanes.length),
    status: coverageStatus(presentFileCount, expectedFileCount),
  };
}

function summarizeHeaderCoverage(datasets: DatasetMetadata[]): SageSourceFeasibilityOutput["headerCoverage"] {
  const datasetsWithHeaders = datasets.filter((dataset) => dataset.columnCount > 0).length;
  const totalHeaderCount = datasets.reduce((sum, dataset) => sum + dataset.columnCount, 0);
  return {
    datasetCountBand: countBand(datasets.length),
    datasetsWithHeadersBand: countBand(datasetsWithHeaders),
    status: coverageStatus(datasetsWithHeaders, datasets.length),
    totalHeaderCountBand: countBand(totalHeaderCount),
  };
}

function summarizeFeatureFamilyCoverage(datasets: DatasetMetadata[]): Record<FeatureFamilyKey, SignalSummary> {
  return {
    activityFunction: summarizeCategory(datasets, ["activity_or_function"]),
    anthropometricVitals: summarizeCategory(datasets, ["anthropometric_or_vitals"]),
    biomarkerLab: summarizeCategory(datasets, ["biomarker_or_lab"]),
    sleepRecovery: summarizeCategory(datasets, ["sleep_or_recovery"]),
  };
}

function summarizeEndpointJoinReadiness(input: {
  endpointHeaderCoverage: SignalSummary;
  featureFamilyCoverage: Record<FeatureFamilyKey, SignalSummary>;
  fileCoverage: SageSourceFeasibilityOutput["fileCoverage"];
  headerCoverage: SageSourceFeasibilityOutput["headerCoverage"];
  rowActivationRequiredBeforeExecution: boolean;
}): SageSourceFeasibilityOutput["endpointJoinReadiness"] {
  const individualFeatureCoveragePresent = input.featureFamilyCoverage.activityFunction.status !== "absent"
    || input.featureFamilyCoverage.anthropometricVitals.status !== "absent"
    || input.featureFamilyCoverage.sleepRecovery.status !== "absent"
    || input.featureFamilyCoverage.biomarkerLab.status !== "absent";
  if (input.fileCoverage.status === "absent" || input.headerCoverage.status === "absent") {
    return {
      endpointHeaderCoverage: input.endpointHeaderCoverage,
      individualFeatureCoveragePresent,
      joinContractLocked: false,
      rowActivationRequiredBeforeExecution: input.rowActivationRequiredBeforeExecution,
      status: "blocked_missing_metadata",
    };
  }
  if (input.endpointHeaderCoverage.status === "absent" || !individualFeatureCoveragePresent) {
    return {
      endpointHeaderCoverage: input.endpointHeaderCoverage,
      individualFeatureCoveragePresent,
      joinContractLocked: false,
      rowActivationRequiredBeforeExecution: input.rowActivationRequiredBeforeExecution,
      status: "blocked_missing_endpoint_or_feature_coverage",
    };
  }
  return {
    endpointHeaderCoverage: input.endpointHeaderCoverage,
    individualFeatureCoveragePresent,
    joinContractLocked: false,
    rowActivationRequiredBeforeExecution: input.rowActivationRequiredBeforeExecution,
    status: "blocked_join_contract_and_activation_labels",
  };
}

function assessLane(
  endpointJoinReadiness: SageSourceFeasibilityOutput["endpointJoinReadiness"],
): SageSourceFeasibilityOutput["laneAssessment"] {
  if (endpointJoinReadiness.status === "blocked_missing_metadata") {
    return {
      classification: "no_score_activation_lane",
      nextAction: "complete_sage_source_intake_metadata",
      rationaleLabels: ["metadata_missing"],
      scoreBearingNow: false,
    };
  }
  if (endpointJoinReadiness.status === "blocked_join_contract_and_activation_labels") {
    return {
      classification: "source_fit_context_lane",
      nextAction: "draft_sage_terms_endpoint_join_feasibility_card",
      rationaleLabels: [
        "endpoint_header_signal_present",
        "individual_feature_header_signal_present",
        "join_contract_not_locked",
        "terms_activation_required",
      ],
      scoreBearingNow: false,
    };
  }
  return {
    classification: "source_fit_context_lane",
    nextAction: "draft_sage_terms_endpoint_join_feasibility_card",
    rationaleLabels: ["endpoint_or_feature_overlap_incomplete"],
    scoreBearingNow: false,
  };
}

function summarizeCategory(datasets: DatasetMetadata[], categories: string[]): SignalSummary {
  let datasetCount = 0;
  let headerMatchCount = 0;
  for (const dataset of datasets) {
    const matches = categories.reduce((sum, category) => {
      const signal = optionalRecord(dataset.categorySignals[category]);
      return sum + (optionalNumber(signal?.matchCount) ?? 0);
    }, 0);
    if (matches > 0) datasetCount += 1;
    headerMatchCount += matches;
  }
  return {
    datasetCountBand: countBand(datasetCount),
    headerMatchBand: countBand(headerMatchCount),
    status: coverageStatus(datasetCount, datasets.length),
  };
}

function readActivationRequired(value: unknown | null): boolean {
  if (!value) return true;
  const root = optionalRecord(value);
  const explicit = optionalBoolean(root?.activationNeededBeforeParsingRows);
  if (explicit !== null) return explicit;
  const lanes = readRecordArray(root?.lanes, "download inventory lanes");
  return lanes.some((lane) => metadataString(lane.activationStatus) === "metadata-only-not-activated");
}

function assertHeaderBoundary(root: Record<string, unknown>): void {
  const boundary = requiredRecord(root.boundary, "SAGE header boundary");
  for (const [key, value] of Object.entries(boundary)) {
    if (value !== false) throw new Error(`SAGE header preflight has unsafe boundary flag ${key}.`);
  }
}

function assertInventoryBoundary(root: Record<string, unknown>): void {
  for (const key of ["participantIdentifiersStored", "rowValuesStored", "sourceBodiesStored"]) {
    const value = root[key];
    if (value !== undefined && value !== false) {
      throw new Error(`SAGE download inventory has unsafe boundary flag ${key}.`);
    }
  }
}

function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  return readFile(filePath, "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .catch((error: unknown) => {
      if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
      throw new Error("Failed to read SAGE source-intake metadata artifact.");
    });
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
    throw new Error("SAGE metadata label is not safe to summarize.");
  }
  return value;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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
  runSageSourceFeasibility({
    downloadInventoryPath: process.env.MURPH_AGE_DOWNLOAD_INVENTORY_PATH,
    headerPreflightPath: process.env.MURPH_AGE_SAGE_HEADER_PREFLIGHT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    sourceIntakeDir: process.env.MURPH_AGE_SOURCE_INTAKE_DIR,
  }).then(({ output: packet, outputPath }) => {
    const summary = {
      artifact: path.basename(outputPath),
      endpointJoinReadiness: packet.endpointJoinReadiness.status,
      fileCoverage: packet.fileCoverage.status,
      headerCoverage: packet.headerCoverage.status,
      laneClassification: packet.laneAssessment.classification,
      packetId: packet.packetId,
      productPromotionAuthorized: packet.boundary.productPromotionAuthorized,
      schemaVersion: packet.schemaVersion,
      status: packet.status,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "SAGE source feasibility failed.");
    process.exitCode = 1;
  });
}
