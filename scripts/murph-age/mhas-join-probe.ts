import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const MHAS_JOIN_PROBE_SCHEMA_VERSION = "murph-age-mhas-join-probe.v1" as const;

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
const HEADER_PREFLIGHT_FILE_NAME = "mhas-header-preflight.latest.json";
const DOWNLOAD_INVENTORY_FILE_NAME = "download-inventory.latest.json";
const OUTPUT_FILE_NAME = "mhas-join-probe.latest.json";

const REQUIRED_ARTIFACTS = {
  eol: {
    dataset: "mhas_eol",
    fileName: "GH_MHAS_EOL_c.dta",
    lane: "mhas-end-of-life",
    role: "endOfLife",
  },
  harmonized: {
    dataset: "mhas_harmonized",
    fileName: "H_MHAS_d.dta",
    lane: "mhas-harmonized",
    role: "harmonizedPanel",
  },
} as const;

const JOIN_FAMILY_RULES = [
  { family: "household_or_sample_identity", pattern: /(^|[_\W])(household|hh|sample|folio|subhog|hogar)([_\W]|$)/i },
  { family: "person_or_respondent_identity", pattern: /(^|[_\W])(person|respondent|subject|participant|interviewee|individ|pn|id)([_\W]|$)/i },
  { family: "wave_or_visit_identity", pattern: /(^|[_\W])(wave|visit|round|year|yr|intdate|survey)([_\W]|$)/i },
] as const;

type ArtifactRole = typeof REQUIRED_ARTIFACTS[keyof typeof REQUIRED_ARTIFACTS]["role"];
type JoinKeyFamily = typeof JOIN_FAMILY_RULES[number]["family"];

export interface MhasJoinProbeOptions {
  createdAt?: string;
  downloadInventoryPath?: string;
  headerPreflightPath?: string;
  localDataDir?: string;
  outputDir?: string;
  sourceIntakeDir?: string;
}

export interface MhasJoinProbeOutput {
  boundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    joinKeyValuesStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParamsStored: false;
    modelScoringPerformed: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowParsingPerformed: false;
    rowValuesStored: false;
    sourceBodiesStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  endpointEolMetadataStatus: {
    eolArtifactPresent: boolean;
    eolHeaderPresent: boolean;
    mortalityOrEolSignal: "absent" | "present";
    status: "blocked_missing_eol_artifact_or_metadata" | "endpoint_metadata_ready_for_contract";
  };
  joinFeasibility: {
    blockerReasons: string[];
    joinKeyFamilyStatus:
      | "blocked_missing_required_metadata"
      | "candidate_family_overlap_detected"
      | "candidate_family_overlap_not_detected";
    matchingFamilyCountBand: string;
    readyForLockedJoinContract: boolean;
    status: "blocked" | "metadata_ready";
  };
  localFileStructure: {
    inspected: boolean;
    requiredRoleStatus: Record<ArtifactRole, "detected" | "missing" | "not_inspected">;
    status: "artifacts_detected" | "incomplete" | "not_configured";
  };
  nextRunnableAction:
    | "draft_locked_mhas_join_and_endpoint_contract"
    | "complete_mhas_metadata_source_intake"
    | "configure_optional_mhas_local_data_dir_for_structure_probe";
  packetId: "mhas-harmonized-eol-aggregate-join-probe";
  requiredSourceArtifacts: Record<ArtifactRole, {
    headerMetadataPresent: boolean;
    inventoryArtifactPresent: boolean;
    localStructureDetected: boolean | null;
    role: ArtifactRole;
  }>;
  rowParsingAndScoring: {
    blocked: true;
    reason: "join_probe_is_metadata_and_file_structure_only";
    rowParsingPerformed: false;
    scoringPerformed: false;
  };
  schemaVersion: typeof MHAS_JOIN_PROBE_SCHEMA_VERSION;
  sourceArtifactsPresent: {
    allRequiredInventoryArtifactsPresent: boolean;
    allRequiredLocalArtifactsDetected: boolean | null;
    allRequiredMetadataPresent: boolean;
  };
  status: "research-local-aggregate-only";
}

interface DatasetSummary {
  dataset: string;
  families: Set<JoinKeyFamily>;
  hasHeaderMetadata: boolean;
  hasMortalityOrEolSignal: boolean;
}

export async function runMhasJoinProbe(
  options: MhasJoinProbeOptions = {},
): Promise<{ output: MhasJoinProbeOutput; outputPath: string }> {
  const sourceIntakeDir = options.sourceIntakeDir ?? DEFAULT_SOURCE_INTAKE_DIR;
  const [headerPreflight, downloadInventory, localFileStructure] = await Promise.all([
    readJsonIfPresent(options.headerPreflightPath ?? path.join(sourceIntakeDir, HEADER_PREFLIGHT_FILE_NAME)),
    readJsonIfPresent(options.downloadInventoryPath ?? path.join(sourceIntakeDir, DOWNLOAD_INVENTORY_FILE_NAME)),
    inspectLocalFileStructure(options.localDataDir),
  ]);

  const datasets = summarizeDatasets(headerPreflight);
  const inventory = summarizeInventory(downloadInventory);
  const requiredSourceArtifacts = summarizeRequiredArtifacts({ datasets, inventory, localFileStructure });
  const sourceArtifactsPresent = summarizeSourceArtifactPresence(requiredSourceArtifacts, localFileStructure.inspected);
  const endpointEolMetadataStatus = summarizeEndpointEolMetadataStatus({ datasets, requiredSourceArtifacts });
  const joinFeasibility = summarizeJoinFeasibility({ datasets, endpointEolMetadataStatus, sourceArtifactsPresent });
  const nextRunnableAction = chooseNextRunnableAction({
    joinFeasibility,
    localFileStructure,
    sourceArtifactsPresent,
  });

  const output: MhasJoinProbeOutput = {
    boundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      joinKeyValuesStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParamsStored: false,
      modelScoringPerformed: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformed: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    endpointEolMetadataStatus,
    joinFeasibility,
    localFileStructure,
    nextRunnableAction,
    packetId: "mhas-harmonized-eol-aggregate-join-probe",
    requiredSourceArtifacts,
    rowParsingAndScoring: {
      blocked: true,
      reason: "join_probe_is_metadata_and_file_structure_only",
      rowParsingPerformed: false,
      scoringPerformed: false,
    },
    schemaVersion: MHAS_JOIN_PROBE_SCHEMA_VERSION,
    sourceArtifactsPresent,
    status: "research-local-aggregate-only",
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`MHAS join probe failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeDatasets(value: unknown | null): DatasetSummary[] {
  if (!value) return [];
  const root = requiredRecord(value, "MHAS header preflight");
  assertHeaderBoundary(root);
  const datasets = Array.isArray(root.datasets) ? root.datasets : [];
  return datasets.flatMap((item) => {
    const dataset = optionalRecord(item);
    if (!dataset) return [];
    const datasetId = optionalString(dataset?.dataset);
    if (datasetId !== REQUIRED_ARTIFACTS.harmonized.dataset && datasetId !== REQUIRED_ARTIFACTS.eol.dataset) return [];
    const categorySignals = optionalRecord(dataset?.categorySignals);
    return [{
      dataset: datasetId,
      families: detectJoinFamilies(dataset),
      hasHeaderMetadata: (optionalNumber(dataset?.columnCount) ?? 0) > 0,
      hasMortalityOrEolSignal: readMatchCount(categorySignals?.mortality_or_eol) > 0,
    }];
  });
}

function summarizeInventory(value: unknown | null): Set<ArtifactRole> {
  if (!value) return new Set();
  const root = requiredRecord(value, "download inventory");
  assertInventoryBoundary(root);
  const lanes = Array.isArray(root.lanes) ? root.lanes.map(optionalRecord).filter(isRecord) : [];
  const roles = new Set<ArtifactRole>();
  for (const artifact of Object.values(REQUIRED_ARTIFACTS)) {
    const lane = lanes.find((item) => optionalString(item.lane) === artifact.lane);
    const presentCount = optionalNumber(lane?.presentFileCount) ?? 0;
    if (presentCount > 0 || readStringArray(lane?.files).some((fileName) => path.basename(fileName) === artifact.fileName)) {
      roles.add(artifact.role);
    }
  }
  return roles;
}

function summarizeRequiredArtifacts(input: {
  datasets: DatasetSummary[];
  inventory: Set<ArtifactRole>;
  localFileStructure: MhasJoinProbeOutput["localFileStructure"];
}): MhasJoinProbeOutput["requiredSourceArtifacts"] {
  return Object.fromEntries(Object.values(REQUIRED_ARTIFACTS).map((artifact) => {
    const localStatus = input.localFileStructure.requiredRoleStatus[artifact.role];
    return [artifact.role, {
      headerMetadataPresent: input.datasets.some((dataset) => dataset.dataset === artifact.dataset && dataset.hasHeaderMetadata),
      inventoryArtifactPresent: input.inventory.has(artifact.role),
      localStructureDetected: localStatus === "not_inspected" ? null : localStatus === "detected",
      role: artifact.role,
    }];
  })) as MhasJoinProbeOutput["requiredSourceArtifacts"];
}

function summarizeSourceArtifactPresence(
  requiredSourceArtifacts: MhasJoinProbeOutput["requiredSourceArtifacts"],
  localStructureInspected: boolean,
): MhasJoinProbeOutput["sourceArtifactsPresent"] {
  const artifactValues = Object.values(requiredSourceArtifacts);
  return {
    allRequiredInventoryArtifactsPresent: artifactValues.every((artifact) => artifact.inventoryArtifactPresent),
    allRequiredLocalArtifactsDetected: localStructureInspected
      ? artifactValues.every((artifact) => artifact.localStructureDetected === true)
      : null,
    allRequiredMetadataPresent: artifactValues.every((artifact) => artifact.headerMetadataPresent),
  };
}

function summarizeEndpointEolMetadataStatus(input: {
  datasets: DatasetSummary[];
  requiredSourceArtifacts: MhasJoinProbeOutput["requiredSourceArtifacts"];
}): MhasJoinProbeOutput["endpointEolMetadataStatus"] {
  const eolDataset = input.datasets.find((dataset) => dataset.dataset === REQUIRED_ARTIFACTS.eol.dataset);
  const eolHeaderPresent = input.requiredSourceArtifacts.endOfLife.headerMetadataPresent;
  const eolArtifactPresent = input.requiredSourceArtifacts.endOfLife.inventoryArtifactPresent;
  const mortalityOrEolSignal = eolDataset?.hasMortalityOrEolSignal === true ? "present" : "absent";
  return {
    eolArtifactPresent,
    eolHeaderPresent,
    mortalityOrEolSignal,
    status: eolArtifactPresent && eolHeaderPresent && mortalityOrEolSignal === "present"
      ? "endpoint_metadata_ready_for_contract"
      : "blocked_missing_eol_artifact_or_metadata",
  };
}

function summarizeJoinFeasibility(input: {
  datasets: DatasetSummary[];
  endpointEolMetadataStatus: MhasJoinProbeOutput["endpointEolMetadataStatus"];
  sourceArtifactsPresent: MhasJoinProbeOutput["sourceArtifactsPresent"];
}): MhasJoinProbeOutput["joinFeasibility"] {
  const blockerReasons: string[] = [];
  if (!input.sourceArtifactsPresent.allRequiredMetadataPresent) blockerReasons.push("missing_required_header_metadata");
  if (!input.sourceArtifactsPresent.allRequiredInventoryArtifactsPresent) blockerReasons.push("missing_required_inventory_artifact");
  if (input.endpointEolMetadataStatus.status !== "endpoint_metadata_ready_for_contract") {
    blockerReasons.push("missing_endpoint_eol_metadata");
  }

  const harmonizedFamilies = datasetFamilies(input.datasets, REQUIRED_ARTIFACTS.harmonized.dataset);
  const eolFamilies = datasetFamilies(input.datasets, REQUIRED_ARTIFACTS.eol.dataset);
  const matchingFamilies = [...harmonizedFamilies].filter((family) => eolFamilies.has(family));
  let joinKeyFamilyStatus: MhasJoinProbeOutput["joinFeasibility"]["joinKeyFamilyStatus"];
  if (!input.sourceArtifactsPresent.allRequiredMetadataPresent) {
    joinKeyFamilyStatus = "blocked_missing_required_metadata";
  } else if (matchingFamilies.length > 0) {
    joinKeyFamilyStatus = "candidate_family_overlap_detected";
  } else {
    joinKeyFamilyStatus = "candidate_family_overlap_not_detected";
    blockerReasons.push("missing_join_key_family_overlap");
  }

  const readyForLockedJoinContract = blockerReasons.length === 0;
  return {
    blockerReasons,
    joinKeyFamilyStatus,
    matchingFamilyCountBand: countBand(matchingFamilies.length),
    readyForLockedJoinContract,
    status: readyForLockedJoinContract ? "metadata_ready" : "blocked",
  };
}

function chooseNextRunnableAction(input: {
  joinFeasibility: MhasJoinProbeOutput["joinFeasibility"];
  localFileStructure: MhasJoinProbeOutput["localFileStructure"];
  sourceArtifactsPresent: MhasJoinProbeOutput["sourceArtifactsPresent"];
}): MhasJoinProbeOutput["nextRunnableAction"] {
  if (input.joinFeasibility.readyForLockedJoinContract) return "draft_locked_mhas_join_and_endpoint_contract";
  if (
    !input.localFileStructure.inspected
    && !input.sourceArtifactsPresent.allRequiredInventoryArtifactsPresent
    && input.sourceArtifactsPresent.allRequiredMetadataPresent
  ) {
    return "configure_optional_mhas_local_data_dir_for_structure_probe";
  }
  return "complete_mhas_metadata_source_intake";
}

async function inspectLocalFileStructure(
  localDataDir: string | undefined,
): Promise<MhasJoinProbeOutput["localFileStructure"]> {
  const notInspected = {
    inspected: false,
    requiredRoleStatus: {
      endOfLife: "not_inspected",
      harmonizedPanel: "not_inspected",
    },
    status: "not_configured",
  } as const;
  if (!localDataDir) return notInspected;

  const detected = new Set<string>();
  await collectDetectedRequiredFileNames(localDataDir, detected, 0);
  const requiredRoleStatus = Object.fromEntries(Object.values(REQUIRED_ARTIFACTS).map((artifact) => [
    artifact.role,
    detected.has(artifact.fileName) ? "detected" : "missing",
  ])) as MhasJoinProbeOutput["localFileStructure"]["requiredRoleStatus"];
  const complete = Object.values(requiredRoleStatus).every((status) => status === "detected");
  return {
    inspected: true,
    requiredRoleStatus,
    status: complete ? "artifacts_detected" : "incomplete",
  };
}

async function collectDetectedRequiredFileNames(directory: string, detected: Set<string>, depth: number): Promise<void> {
  if (depth > 4) return;
  let entries: { isDirectory(): boolean; isFile(): boolean; name: string }[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return;
    throw new Error("Failed to inspect MHAS local file structure.");
  }
  for (const entry of entries) {
    if (entry.isFile() && Object.values(REQUIRED_ARTIFACTS).some((artifact) => artifact.fileName === entry.name)) {
      detected.add(entry.name);
    } else if (entry.isDirectory()) {
      await collectDetectedRequiredFileNames(path.join(directory, entry.name), detected, depth + 1);
    }
  }
}

function detectJoinFamilies(dataset: Record<string, unknown>): Set<JoinKeyFamily> {
  const candidates = collectStrings(dataset).filter((value) => value.length <= 80);
  const families = new Set<JoinKeyFamily>();
  for (const value of candidates) {
    for (const rule of JOIN_FAMILY_RULES) {
      if (rule.pattern.test(value)) families.add(rule.family);
    }
  }
  return families;
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, depth + 1));
  return Object.values(value).flatMap((item) => collectStrings(item, depth + 1));
}

function datasetFamilies(datasets: DatasetSummary[], dataset: string): Set<JoinKeyFamily> {
  return datasets.find((item) => item.dataset === dataset)?.families ?? new Set();
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

function readMatchCount(value: unknown): number {
  return optionalNumber(optionalRecord(value)?.matchCount) ?? 0;
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

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null;
}

function countBand(count: number): string {
  if (count <= 0) return "0";
  if (count < 5) return "1-4";
  return "5+";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runMhasJoinProbe({
    downloadInventoryPath: process.env.MURPH_AGE_DOWNLOAD_INVENTORY_PATH,
    headerPreflightPath: process.env.MURPH_AGE_MHAS_HEADER_PREFLIGHT_PATH,
    localDataDir: process.env.MURPH_AGE_MHAS_LOCAL_DATA_DIR,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    sourceIntakeDir: process.env.MURPH_AGE_SOURCE_INTAKE_DIR,
  }).then(({ output: packet, outputPath }) => {
    const cliSummary = {
      artifact: path.basename(outputPath),
      joinKeyFamilyStatus: packet.joinFeasibility.joinKeyFamilyStatus,
      nextRunnableAction: packet.nextRunnableAction,
      packetId: packet.packetId,
      productPromotionAuthorized: packet.boundary.productPromotionAuthorized,
      readyForLockedJoinContract: packet.joinFeasibility.readyForLockedJoinContract,
      rowParsingPerformed: packet.boundary.rowParsingPerformed,
      schemaVersion: packet.schemaVersion,
      scoringPerformed: packet.boundary.modelScoringPerformed,
      status: packet.status,
    };
    console.log(JSON.stringify(cliSummary, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "MHAS join probe failed.");
    process.exitCode = 1;
  });
}
