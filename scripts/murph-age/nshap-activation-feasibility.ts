import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const NSHAP_ACTIVATION_FEASIBILITY_SCHEMA_VERSION =
  "murph-age-nshap-activation-feasibility.v1" as const;

const DEFAULT_SOURCE_INTAKE_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "source-intake",
);
const DEFAULT_MODEL_RUNS_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const HEADER_PREFLIGHT_FILE_NAME = "nshap-header-preflight.latest.json";
const DOWNLOAD_INVENTORY_FILE_NAME = "download-inventory.latest.json";
const OUTPUT_FILE_NAME = "nshap-activation-feasibility.latest.json";

type CoverageStatus = "absent" | "partial" | "present";
type EndpointReadiness =
  | "blocked_missing_files_or_headers"
  | "metadata_ready_activation_required_before_rows"
  | "metadata_ready_for_locked_benchmark_design";

interface HeaderSignalSummary {
  datasetCount: number;
  headerMatchBand: string;
  present: boolean;
}

interface NshapActivationFeasibilityOptions {
  createdAt?: string;
  downloadInventoryPath?: string;
  headerPreflightPath?: string;
  outputDir?: string;
  sourceIntakeDir?: string;
}

export interface NshapActivationFeasibilityOutput {
  boundary: {
    aggregateOnly: true;
    abstractsStored: false;
    activationMetadataOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelScoringPerformed: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowParsingPerformed: false;
    rowValuesStored: false;
    sourceBodiesStored: false;
    variableNameSamplesStored: false;
  };
  createdAt: string;
  endpointReadiness: {
    mortalityOrFollowupHeaderCoverage: HeaderSignalSummary;
    readyForLockedBenchmarkDesign: boolean;
    rowActivationRequiredBeforeExecution: boolean;
    status: EndpointReadiness;
  };
  featureFamilies: {
    activityOrFunction: HeaderSignalSummary;
    anthropometricOrVitals: HeaderSignalSummary;
    biomarkerOrLab: HeaderSignalSummary;
    cognition: HeaderSignalSummary;
    selfRatedOrDiseaseHistory: HeaderSignalSummary;
    sleepOrRecovery: HeaderSignalSummary;
    socialOrNetwork: HeaderSignalSummary;
  };
  fileCoverage: {
    allExpectedArchivesPresent: boolean;
    archiveBasenames: string[];
    expectedArchiveCount: number;
    presentArchiveCount: number;
    status: CoverageStatus;
  };
  headerCoverage: {
    datasetCount: number;
    datasetCountBand: string;
    datasetsWithHeaders: number;
    status: CoverageStatus;
    totalHeaderCountBand: string;
  };
  noScoreReadiness: {
    conclusion:
      | "nshap_metadata_ready_for_activation_design"
      | "nshap_metadata_ready_but_endpoint_needs_locking"
      | "nshap_metadata_incomplete";
    nextAction: "design_locked_metadata_only_benchmark_card" | "complete_source_intake_metadata";
  };
  packetId: "nshap-activation-feasibility";
  schemaVersion: typeof NSHAP_ACTIVATION_FEASIBILITY_SCHEMA_VERSION;
  source: "NSHAP";
  status: "research-local-metadata-only";
}

interface IntakeDataset {
  categorySignals: Record<string, unknown>;
  columnCount: number;
  dataset: string;
  fileName: string;
}

export async function runNshapActivationFeasibility(
  options: NshapActivationFeasibilityOptions = {},
): Promise<{ output: NshapActivationFeasibilityOutput; outputPath: string }> {
  const sourceIntakeDir = options.sourceIntakeDir ?? DEFAULT_SOURCE_INTAKE_DIR;
  const headerPreflight = await readJsonIfPresent(
    options.headerPreflightPath ?? path.join(sourceIntakeDir, HEADER_PREFLIGHT_FILE_NAME),
  );
  const downloadInventory = await readJsonIfPresent(
    options.downloadInventoryPath ?? path.join(sourceIntakeDir, DOWNLOAD_INVENTORY_FILE_NAME),
  );
  const datasets = readNshapDatasets(headerPreflight);
  const fileCoverage = summarizeFileCoverage(downloadInventory);
  const headerCoverage = summarizeHeaderCoverage(datasets);
  const featureFamilies = summarizeFeatureFamilies(datasets);
  const rowActivationRequiredBeforeExecution = readActivationRequired(downloadInventory);
  const endpointReadiness = summarizeEndpointReadiness({
    fileCoverage,
    headerCoverage,
    mortalityOrFollowupHeaderCoverage: summarizeCategory(datasets, "mortality_or_followup"),
    rowActivationRequiredBeforeExecution,
  });
  const conclusion = readinessConclusion({ endpointReadiness, featureFamilies, fileCoverage, headerCoverage });

  const output: NshapActivationFeasibilityOutput = {
    boundary: {
      aggregateOnly: true,
      abstractsStored: false,
      activationMetadataOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelScoringPerformed: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformed: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
      variableNameSamplesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    endpointReadiness,
    featureFamilies,
    fileCoverage,
    headerCoverage,
    noScoreReadiness: {
      conclusion,
      nextAction: conclusion === "nshap_metadata_incomplete"
        ? "complete_source_intake_metadata"
        : "design_locked_metadata_only_benchmark_card",
    },
    packetId: "nshap-activation-feasibility",
    schemaVersion: NSHAP_ACTIVATION_FEASIBILITY_SCHEMA_VERSION,
    source: "NSHAP",
    status: "research-local-metadata-only",
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`NSHAP activation feasibility failed metadata-only egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeFileCoverage(value: unknown | null): NshapActivationFeasibilityOutput["fileCoverage"] {
  const lanes = value ? readArray(requiredRecord(value, "download inventory").lanes, "download inventory lanes") : [];
  const nshapLanes = lanes
    .map((lane) => requiredRecord(lane, "download inventory lane"))
    .filter((lane) => stringValue(lane.lane).toLowerCase().includes("nshap"));
  const archiveBasenames = [...new Set(nshapLanes.flatMap((lane) =>
    readOptionalStringArray(lane.files).map((fileName) => path.basename(fileName))
  ))].sort();
  const presentArchiveCount = nshapLanes.reduce(
    (sum, lane) => sum + numberValue(lane.presentFileCount, "present file count"),
    0,
  );
  const expectedArchiveCount = Math.max(archiveBasenames.length, presentArchiveCount);
  const allExpectedArchivesPresent = expectedArchiveCount > 0 && presentArchiveCount >= expectedArchiveCount;
  return {
    allExpectedArchivesPresent,
    archiveBasenames,
    expectedArchiveCount,
    presentArchiveCount,
    status: coverageStatus(presentArchiveCount, expectedArchiveCount),
  };
}

function summarizeHeaderCoverage(datasets: IntakeDataset[]): NshapActivationFeasibilityOutput["headerCoverage"] {
  const totalHeaderCount = datasets.reduce((sum, dataset) => sum + dataset.columnCount, 0);
  return {
    datasetCount: datasets.length,
    datasetCountBand: countBand(datasets.length),
    datasetsWithHeaders: datasets.filter((dataset) => dataset.columnCount > 0).length,
    status: coverageStatus(datasets.filter((dataset) => dataset.columnCount > 0).length, datasets.length),
    totalHeaderCountBand: countBand(totalHeaderCount),
  };
}

function summarizeFeatureFamilies(datasets: IntakeDataset[]): NshapActivationFeasibilityOutput["featureFamilies"] {
  return {
    activityOrFunction: summarizeCategory(datasets, "activity_or_function"),
    anthropometricOrVitals: summarizeCategory(datasets, "anthropometric_or_vitals"),
    biomarkerOrLab: summarizeCategory(datasets, "biomarker_or_lab"),
    cognition: summarizeCategory(datasets, "cognition"),
    selfRatedOrDiseaseHistory: summarizeCategory(datasets, "self_rated_or_disease_history"),
    sleepOrRecovery: summarizeCategory(datasets, "sleep_or_recovery"),
    socialOrNetwork: summarizeSocialOrNetwork(datasets),
  };
}

function summarizeEndpointReadiness(input: {
  fileCoverage: NshapActivationFeasibilityOutput["fileCoverage"];
  headerCoverage: NshapActivationFeasibilityOutput["headerCoverage"];
  mortalityOrFollowupHeaderCoverage: HeaderSignalSummary;
  rowActivationRequiredBeforeExecution: boolean;
}): NshapActivationFeasibilityOutput["endpointReadiness"] {
  const readyForLockedBenchmarkDesign = input.fileCoverage.status === "present"
    && input.headerCoverage.status === "present"
    && input.mortalityOrFollowupHeaderCoverage.present;
  const status: EndpointReadiness = !readyForLockedBenchmarkDesign
    ? "blocked_missing_files_or_headers"
    : input.rowActivationRequiredBeforeExecution
      ? "metadata_ready_activation_required_before_rows"
      : "metadata_ready_for_locked_benchmark_design";
  return {
    mortalityOrFollowupHeaderCoverage: input.mortalityOrFollowupHeaderCoverage,
    readyForLockedBenchmarkDesign,
    rowActivationRequiredBeforeExecution: input.rowActivationRequiredBeforeExecution,
    status,
  };
}

function readinessConclusion(input: {
  endpointReadiness: NshapActivationFeasibilityOutput["endpointReadiness"];
  featureFamilies: NshapActivationFeasibilityOutput["featureFamilies"];
  fileCoverage: NshapActivationFeasibilityOutput["fileCoverage"];
  headerCoverage: NshapActivationFeasibilityOutput["headerCoverage"];
}): NshapActivationFeasibilityOutput["noScoreReadiness"]["conclusion"] {
  if (
    input.fileCoverage.status !== "present"
    || input.headerCoverage.status !== "present"
    || !input.featureFamilies.biomarkerOrLab.present
    || !input.featureFamilies.anthropometricOrVitals.present
    || !input.featureFamilies.socialOrNetwork.present
  ) {
    return "nshap_metadata_incomplete";
  }
  return input.endpointReadiness.readyForLockedBenchmarkDesign
    ? "nshap_metadata_ready_for_activation_design"
    : "nshap_metadata_ready_but_endpoint_needs_locking";
}

function summarizeCategory(datasets: IntakeDataset[], category: string): HeaderSignalSummary {
  let headerMatchCount = 0;
  let datasetCount = 0;
  for (const dataset of datasets) {
    const signal = recordValue(dataset.categorySignals[category]);
    const matchCount = signal ? numberValue(signal.matchCount, `${category} match count`) : 0;
    if (matchCount > 0) datasetCount += 1;
    headerMatchCount += matchCount;
  }
  return {
    datasetCount,
    headerMatchBand: countBand(headerMatchCount),
    present: headerMatchCount > 0,
  };
}

function summarizeSocialOrNetwork(datasets: IntakeDataset[]): HeaderSignalSummary {
  let headerMatchCount = 0;
  let datasetCount = 0;
  for (const dataset of datasets) {
    let datasetMatches = 0;
    for (const [category, rawSignal] of Object.entries(dataset.categorySignals)) {
      if (/social|network|relationship|engagement|support/i.test(category)) {
        const signal = recordValue(rawSignal);
        datasetMatches += signal ? numberValue(signal.matchCount, `${category} match count`) : 0;
      }
      const signal = recordValue(rawSignal);
      const names = signal ? readOptionalStringArray(signal.sampleVariableNames) : [];
      datasetMatches += names.filter((name) =>
        /^(NODE_)|SOC|SOCIAL|FRIEND|FAMILY|RELAT|SPOUSE|PARTNER|MARITAL|ENGAGE|SEX|TALK/i.test(name)
      ).length;
    }
    if (datasetMatches > 0) datasetCount += 1;
    headerMatchCount += datasetMatches;
  }
  return {
    datasetCount,
    headerMatchBand: countBand(headerMatchCount),
    present: headerMatchCount > 0,
  };
}

function readNshapDatasets(value: unknown | null): IntakeDataset[] {
  if (!value) return [];
  const root = requiredRecord(value, "NSHAP header preflight");
  const boundary = recordValue(root.boundary);
  if (boundary) {
    for (const key of ["rowValuesStored", "participantIdentifiersStored", "sourceBodiesStored", "codebookTextStored"]) {
      if (boundary[key] !== false) throw new Error(`NSHAP header preflight has unsafe boundary flag ${key}.`);
    }
  }
  return readArray(root.datasets, "NSHAP datasets").map((rawDataset) => {
    const dataset = requiredRecord(rawDataset, "NSHAP dataset");
    const fileName = stringValue(dataset.fileName);
    return {
      categorySignals: recordValue(dataset.categorySignals) ?? {},
      columnCount: numberValue(dataset.columnCount, "dataset column count"),
      dataset: stringValue(dataset.dataset),
      fileName,
    };
  }).filter((dataset) => {
    const searchable = `${dataset.dataset} ${dataset.fileName}`;
    return searchable.toLowerCase().includes("nshap") || searchable.includes("20541")
      || searchable.includes("34921") || searchable.includes("36873");
  });
}

function readActivationRequired(value: unknown | null): boolean {
  if (!value) return true;
  const root = requiredRecord(value, "download inventory");
  if (root.rowValuesStored !== false) throw new Error("download inventory has unsafe rowValuesStored flag.");
  if (root.participantIdentifiersStored !== false) {
    throw new Error("download inventory has unsafe participantIdentifiersStored flag.");
  }
  if (root.sourceBodiesStored !== false) throw new Error("download inventory has unsafe sourceBodiesStored flag.");
  if (root.modelScoringPerformed !== false) throw new Error("download inventory has unsafe modelScoringPerformed flag.");
  return root.activationNeededBeforeParsingRows !== false;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read NSHAP activation metadata artifact.");
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

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function readOptionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = recordValue(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runNshapActivationFeasibility({
    downloadInventoryPath: process.env.MURPH_AGE_DOWNLOAD_INVENTORY_PATH,
    headerPreflightPath: process.env.MURPH_AGE_NSHAP_HEADER_PREFLIGHT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    sourceIntakeDir: process.env.MURPH_AGE_SOURCE_INTAKE_DIR,
  }).then(({ output: packet, outputPath }) => {
    console.log(JSON.stringify({
      artifact: path.basename(outputPath),
      conclusion: packet.noScoreReadiness.conclusion,
      endpointReadiness: packet.endpointReadiness.status,
      fileCoverage: packet.fileCoverage.status,
      headerCoverage: packet.headerCoverage.status,
      packetId: packet.packetId,
      productPromotionAuthorized: packet.boundary.productPromotionAuthorized,
      schemaVersion: packet.schemaVersion,
      status: packet.status,
    }, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "NSHAP activation feasibility failed.");
    process.exitCode = 1;
  });
}
