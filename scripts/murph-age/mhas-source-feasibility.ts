import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const MHAS_SOURCE_FEASIBILITY_SCHEMA_VERSION = "murph-age-mhas-source-feasibility.v1" as const;

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
const DEFAULT_MHAS_HEADER_PREFLIGHT_PATH = path.join(DEFAULT_SOURCE_INTAKE_DIR, "mhas-header-preflight.latest.json");
const DEFAULT_DOWNLOAD_INVENTORY_PATH = path.join(DEFAULT_SOURCE_INTAKE_DIR, "download-inventory.latest.json");
const OUTPUT_FILE_NAME = "mhas-source-feasibility.latest.json";

const REQUIRED_DATASETS = {
  eol: "mhas_eol",
  harmonized: "mhas_harmonized",
} as const;

const REQUIRED_LANES = {
  eol: "mhas-end-of-life",
  harmonized: "mhas-harmonized",
} as const;

const FEATURE_FAMILIES = [
  "age_or_demographics",
  "mortality_or_eol",
  "anthropometric_or_vitals",
  "biomarker_or_lab",
  "activity_or_function",
  "sleep_or_recovery",
  "self_rated_or_disease_history",
  "cognition",
] as const;

const ALLOWED_ACTIVATION_STATUSES = new Set(["metadata-only-not-activated"]);
const ALLOWED_FILE_NAMES = new Set(["GH_MHAS_EOL_c.dta", "H_MHAS_d.dta"]);
const ALLOWED_ROLES = new Set(["harmonized-panel", "mortality-eol"]);
const ALLOWED_ROW_PARSING = new Set(["not-performed"]);
const ALLOWED_STORED_PATH_POLICIES = new Set(["base-file-names-only"]);

type FeatureFamily = typeof FEATURE_FAMILIES[number];
type RequiredDatasetRole = keyof typeof REQUIRED_DATASETS;

export interface MhasSourceFeasibilityOptions {
  createdAt?: string;
  downloadInventoryPath?: string;
  headerPreflightPath?: string;
  outputDir?: string;
}

export interface MhasDatasetSummary {
  columnCountBand: string;
  dataset: "mhas_eol" | "mhas_harmonized";
  featureFamilies: Record<FeatureFamily, {
    coverage: "absent" | "present";
    matchCountBand: string;
  }>;
  fileName: string;
  rowCountBand: string;
  status: "available";
}

export interface MhasLaneSummary {
  activationStatus: string;
  fileCountBand: string;
  files: string[];
  lane: "mhas-end-of-life" | "mhas-harmonized";
  present: boolean;
  roles: string[];
  sizeBand: string;
}

export interface MhasSourceFeasibilityOutput {
  boundary: {
    aggregateOnly: true;
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
    variableLabelsStored: false;
  };
  coverage: {
    broadFeatureFamilies: Record<FeatureFamily, {
      datasetsWithCoverage: ("mhas_eol" | "mhas_harmonized")[];
      status: "absent" | "available";
    }>;
    datasets: MhasDatasetSummary[];
    requiredDatasetsPresent: boolean;
  };
  createdAt: string;
  downloadInventory: {
    activationNeededBeforeParsingRows: boolean | null;
    lanes: MhasLaneSummary[];
    modelScoringPerformed: false | null;
    rowParsing: string | null;
    storedPathPolicy: string | null;
  };
  joinReadiness: {
    eolFilePresent: boolean;
    harmonizedFilePresent: boolean;
    mortalityOrEolHeaderCoverage: "absent" | "available";
    status: "metadata_join_probe_ready" | "not_ready";
    blockerReasons: string[];
  };
  packetId: "mhas-harmonized-eol-source-feasibility";
  schemaVersion: typeof MHAS_SOURCE_FEASIBILITY_SCHEMA_VERSION;
  status: "research-local-metadata-only";
  transportLoopEligibility: {
    eligible: boolean;
    nextGate: "declare_mortality_join_contract_before_scoring" | "collect_required_metadata_first";
    reason: string;
  };
}

export async function runMhasSourceFeasibility(
  options: MhasSourceFeasibilityOptions = {},
): Promise<{ output: MhasSourceFeasibilityOutput; outputPath: string }> {
  const [headerPreflight, downloadInventory] = await Promise.all([
    readJsonIfPresent(options.headerPreflightPath ?? DEFAULT_MHAS_HEADER_PREFLIGHT_PATH),
    readJsonIfPresent(options.downloadInventoryPath ?? DEFAULT_DOWNLOAD_INVENTORY_PATH),
  ]);

  const datasets = summarizeDatasets(headerPreflight);
  const lanes = summarizeLanes(downloadInventory);
  const broadFeatureFamilies = summarizeFeatureFamilies(datasets);
  const requiredDatasetsPresent = hasDataset(datasets, "harmonized") && hasDataset(datasets, "eol");
  const joinReadiness = summarizeJoinReadiness({ datasets, lanes, requiredDatasetsPresent });
  const eligible = joinReadiness.status === "metadata_join_probe_ready";

  const output: MhasSourceFeasibilityOutput = {
    boundary: {
      aggregateOnly: true,
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
      variableLabelsStored: false,
    },
    coverage: {
      broadFeatureFamilies,
      datasets,
      requiredDatasetsPresent,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    downloadInventory: {
      activationNeededBeforeParsingRows: optionalBoolean(optionalRecord(downloadInventory)?.activationNeededBeforeParsingRows),
      lanes,
      modelScoringPerformed: optionalFalse(optionalRecord(downloadInventory)?.modelScoringPerformed, "download inventory modelScoringPerformed"),
      rowParsing: allowedString(optionalRecord(downloadInventory)?.rowParsing, ALLOWED_ROW_PARSING),
      storedPathPolicy: allowedString(optionalRecord(downloadInventory)?.storedPathPolicy, ALLOWED_STORED_PATH_POLICIES),
    },
    joinReadiness,
    packetId: "mhas-harmonized-eol-source-feasibility",
    schemaVersion: MHAS_SOURCE_FEASIBILITY_SCHEMA_VERSION,
    status: "research-local-metadata-only",
    transportLoopEligibility: {
      eligible,
      nextGate: eligible ? "declare_mortality_join_contract_before_scoring" : "collect_required_metadata_first",
      reason: eligible
        ? "MHAS harmonized and end-of-life metadata are present with broad survey and mortality/EOL header coverage; scoring remains blocked until a durable join and endpoint contract exists."
        : "Required MHAS harmonized/end-of-life metadata is missing or insufficient for a metadata-only join probe.",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`MHAS source feasibility failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeDatasets(value: unknown | null): MhasDatasetSummary[] {
  if (!value) return [];
  const root = requiredRecord(value, "MHAS header preflight");
  assertHeaderBoundary(root);
  const datasets = root.datasets;
  if (!Array.isArray(datasets)) return [];

  return datasets.flatMap((item) => {
    const dataset = optionalRecord(item);
    const datasetId = optionalString(dataset?.dataset);
    if (datasetId !== REQUIRED_DATASETS.harmonized && datasetId !== REQUIRED_DATASETS.eol) return [];
    const categorySignals = optionalRecord(dataset?.categorySignals);
    return [{
      columnCountBand: countBand(optionalNumber(dataset?.columnCount) ?? 0),
      dataset: datasetId,
      featureFamilies: Object.fromEntries(FEATURE_FAMILIES.map((family) => {
        const signal = optionalRecord(categorySignals?.[family]);
        const matchCount = optionalNumber(signal?.matchCount) ?? 0;
        return [family, {
          coverage: matchCount > 0 ? "present" : "absent",
          matchCountBand: countBand(matchCount),
        }];
      })) as MhasDatasetSummary["featureFamilies"],
      fileName: allowedFileName(requiredString(dataset?.fileName, `${datasetId} file name`)),
      rowCountBand: countBand(optionalNumber(dataset?.rowCount) ?? 0),
      status: "available" as const,
    }];
  }).sort((a, b) => a.dataset.localeCompare(b.dataset));
}

function summarizeLanes(value: unknown | null): MhasLaneSummary[] {
  if (!value) return [];
  const root = requiredRecord(value, "download inventory");
  assertInventoryBoundary(root);
  const lanes = Array.isArray(root.lanes) ? root.lanes : [];
  const files = Array.isArray(root.files) ? root.files : [];

  return lanes.flatMap((item) => {
    const lane = optionalRecord(item);
    const laneId = optionalString(lane?.lane);
    if (laneId !== REQUIRED_LANES.harmonized && laneId !== REQUIRED_LANES.eol) return [];
    const laneFiles = readStringArray(lane?.files).map(allowedFileName);
    const laneSize = files
      .map(optionalRecord)
      .filter((file) => optionalString(file?.lane) === laneId)
      .reduce((sum, file) => sum + (optionalNumber(file?.sizeBytes) ?? 0), 0);
    return [{
      activationStatus: allowedString(lane?.activationStatus, ALLOWED_ACTIVATION_STATUSES) ?? "unknown",
      fileCountBand: countBand(optionalNumber(lane?.presentFileCount) ?? laneFiles.length),
      files: laneFiles,
      lane: laneId,
      present: (optionalNumber(lane?.presentFileCount) ?? 0) > 0,
      roles: readStringArray(lane?.roles).map((role) => allowedString(role, ALLOWED_ROLES)).filter(isString),
      sizeBand: byteBand(laneSize),
    }];
  }).sort((a, b) => a.lane.localeCompare(b.lane));
}

function summarizeFeatureFamilies(
  datasets: MhasDatasetSummary[],
): MhasSourceFeasibilityOutput["coverage"]["broadFeatureFamilies"] {
  return Object.fromEntries(FEATURE_FAMILIES.map((family) => {
    const datasetsWithCoverage = datasets
      .filter((dataset) => dataset.featureFamilies[family].coverage === "present")
      .map((dataset) => dataset.dataset);
    return [family, {
      datasetsWithCoverage,
      status: datasetsWithCoverage.length > 0 ? "available" : "absent",
    }];
  })) as MhasSourceFeasibilityOutput["coverage"]["broadFeatureFamilies"];
}

function summarizeJoinReadiness(input: {
  datasets: MhasDatasetSummary[];
  lanes: MhasLaneSummary[];
  requiredDatasetsPresent: boolean;
}): MhasSourceFeasibilityOutput["joinReadiness"] {
  const harmonizedFilePresent = input.lanes.some((lane) => lane.lane === REQUIRED_LANES.harmonized && lane.present);
  const eolFilePresent = input.lanes.some((lane) => lane.lane === REQUIRED_LANES.eol && lane.present);
  const eolDataset = input.datasets.find((dataset) => dataset.dataset === REQUIRED_DATASETS.eol);
  const mortalityOrEolHeaderCoverage = eolDataset?.featureFamilies.mortality_or_eol.coverage === "present"
    ? "available"
    : "absent";
  const blockerReasons: string[] = [];
  if (!input.requiredDatasetsPresent) blockerReasons.push("missing_required_header_metadata");
  if (!harmonizedFilePresent) blockerReasons.push("missing_harmonized_inventory_file");
  if (!eolFilePresent) blockerReasons.push("missing_eol_inventory_file");
  if (mortalityOrEolHeaderCoverage === "absent") blockerReasons.push("missing_mortality_or_eol_header_signal");

  return {
    blockerReasons,
    eolFilePresent,
    harmonizedFilePresent,
    mortalityOrEolHeaderCoverage,
    status: blockerReasons.length === 0 ? "metadata_join_probe_ready" : "not_ready",
  };
}

function hasDataset(datasets: MhasDatasetSummary[], role: RequiredDatasetRole): boolean {
  return datasets.some((dataset) => dataset.dataset === REQUIRED_DATASETS[role]);
}

function assertHeaderBoundary(root: Record<string, unknown>): void {
  const boundary = requiredRecord(root.boundary, "MHAS header boundary");
  for (const key of [
    "codebookTextStored",
    "localPathsStored",
    "participantIdentifiersStored",
    "rowValuesStored",
    "sourceBodiesStored",
    "variableLabelsStored",
  ]) {
    if (boundary[key] !== false) throw new Error(`MHAS header preflight has unsafe boundary flag ${key}.`);
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
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read a Murph Age source-intake metadata artifact.");
  }
}

function optionalFalse(value: unknown, label: string): false | null {
  if (value === undefined || value === null) return null;
  if (value !== false) throw new Error(`${label} must be false.`);
  return false;
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

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string.`);
  return value;
}

function allowedFileName(value: string): string {
  const stripped = stripPathLikeSegments(value);
  if (!ALLOWED_FILE_NAMES.has(stripped)) throw new Error("Unexpected MHAS metadata file name.");
  return stripped;
}

function allowedString(value: unknown, allowed: Set<string>): string | null {
  const string = optionalString(value);
  if (!string) return null;
  return allowed.has(string) ? string : null;
}

function stripPathLikeSegments(value: string): string {
  const withoutUrlSuffix = value.split(/[?#]/, 1)[0] ?? "";
  const parts = withoutUrlSuffix.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? "";
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}

function byteBand(bytes: number): string {
  if (bytes <= 0) return "0";
  if (bytes < 10 * 1024 * 1024) return "<10MiB";
  if (bytes < 100 * 1024 * 1024) return "10-99MiB";
  return "100MiB+";
}

function countBand(count: number): string {
  if (count <= 0) return "0";
  if (count < 100) return "1-99";
  if (count < 500) return "100-499";
  if (count < 1000) return "500-999";
  return "1000+";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runMhasSourceFeasibility({
    downloadInventoryPath: process.env.MURPH_AGE_DOWNLOAD_INVENTORY_PATH,
    headerPreflightPath: process.env.MURPH_AGE_MHAS_HEADER_PREFLIGHT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output: packet, outputPath }) => {
    console.log(JSON.stringify({
      artifact: path.basename(outputPath),
      eligibleForTransportLoop: packet.transportLoopEligibility.eligible,
      joinReadiness: packet.joinReadiness.status,
      modelScoringPerformed: packet.boundary.modelScoringPerformed,
      packetId: packet.packetId,
      productPromotionAuthorized: packet.boundary.productPromotionAuthorized,
      schemaVersion: packet.schemaVersion,
      status: packet.status,
    }, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "MHAS source feasibility failed.");
    process.exitCode = 1;
  });
}
