import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R604_NEXT_SOURCE_INVENTORY_SCHEMA_VERSION =
  "murph-age-r604-next-source-inventory.v1" as const;

const DEFAULT_RESEARCH_DIR = path.join(".runtime", "operations", "research", "murph-age");
const DEFAULT_MODEL_RUNS_DIR = path.join(DEFAULT_RESEARCH_DIR, "model-runs");
const DEFAULT_SOURCE_INTAKE_DIR = path.join(DEFAULT_RESEARCH_DIR, "source-intake");
const DEFAULT_REVIEWGPT_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "reviewgpt",
  "reduced",
);
const OUTPUT_FILE_NAME = "r604-next-source-inventory.latest.json";
const MAX_METADATA_LABEL_LENGTH = 96;
const MAX_METADATA_LABEL_WORDS = 10;

type ArtifactStatus = "available" | "missing";
type NextActionKind =
  | "activation_label_fill"
  | "benchmark_card_design"
  | "endpoint_feature_mapping"
  | "local_packet_refresh"
  | "review_reduced_decision";

export interface R604NextSourceInventoryOptions {
  activationQueuePath?: string;
  createdAt?: string;
  downloadInventoryPath?: string;
  haalsiPreflightPath?: string;
  mhasPreflightPath?: string;
  nshapPreflightPath?: string;
  outputDir?: string;
  r603Path?: string;
  reviewDecisionDir?: string;
}

interface ArtifactSummary {
  artifact: string;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface DownloadInventorySummary extends ArtifactSummary {
  activationNeededBeforeParsingRows: boolean | null;
  laneCountBand: string | null;
  presentLaneCountBand: string | null;
  recommendedNearTermOrder: string[];
  rowParsing: string | null;
  storedPathPolicy: string | null;
}

interface ActivationQueueSummary extends ArtifactSummary {
  queue: Array<{
    activationLabelsNeeded: string[];
    evidenceLabelTarget: string | null;
    filesPresent: boolean | null;
    laneGroup: string;
    priorityBand: string;
    rowParsingUnlocked: boolean | null;
  }>;
}

interface HeaderPreflightSummary extends ArtifactSummary {
  boundary: {
    codebookTextStored: boolean | null;
    localPathsStored: boolean | null;
    participantIdentifiersStored: boolean | null;
    rowValuesStored: boolean | null;
    sourceBodiesStored: boolean | null;
    variableLabelsStored: boolean | null;
  };
  categoryAvailability: Record<string, "present" | "absent">;
  conclusionLabel: string | null;
  datasetCountBand: string | null;
  sourceLabel: string | null;
  tableSizeBands: Array<{
    columnCountBand: string | null;
    dataset: string;
    rowCountBand: string | null;
  }>;
}

interface TransportReadinessSummary extends ArtifactSummary {
  conclusion: string | null;
  productPromotionAuthorized: boolean | null;
  statusLabel: string | null;
  transportArtifacts: Array<{
    name: "crelesLocal" | "midusToCreles";
    status: string;
  }>;
}

interface ReviewDecisionSummary {
  artifactCountBand: string;
  files: Array<{
    artifact: string;
    decisionId: string | null;
    packetId: string | null;
    schemaVersion: string | null;
    status: string | null;
  }>;
  status: "none_present" | "present";
}

export interface R604NextSourceInventoryPacket {
  boundary: {
    abstractsStored: false;
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitIdentifiersStored: false;
  };
  createdAt: string;
  inventory: {
    activationQueue: ActivationQueueSummary;
    downloadInventory: DownloadInventorySummary;
    preflights: {
      haalsi: HeaderPreflightSummary;
      mhas: HeaderPreflightSummary;
      nshap: HeaderPreflightSummary;
    };
    r603TransportReadiness: TransportReadinessSummary;
    reviewGptReducedDecisions: ReviewDecisionSummary;
  };
  nextLocalActionQueue: Array<{
    actionId: string;
    actionKind: NextActionKind;
    blockedUntil: string[];
    laneGroup: string;
    priority: number;
    rationaleLabel: string;
    runnableNow: boolean;
  }>;
  packetId: "r604-next-source-inventory";
  schemaVersion: typeof R604_NEXT_SOURCE_INVENTORY_SCHEMA_VERSION;
  status: "research-local-metadata-only";
  summary: {
    conclusion: "metadata_inventory_ready";
    localActionCountBand: string;
    productPromotionAuthorized: false;
    safestNextAction: string | null;
  };
}

export async function runR604NextSourceInventory(
  options: R604NextSourceInventoryOptions = {},
): Promise<{ output: R604NextSourceInventoryPacket; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const [downloadInventory, activationQueue, nshapPreflight, haalsiPreflight, mhasPreflight, r603Readiness] =
    await Promise.all([
      readJsonIfPresent(options.downloadInventoryPath ?? path.join(DEFAULT_SOURCE_INTAKE_DIR, "download-inventory.latest.json")),
      readJsonIfPresent(options.activationQueuePath ?? path.join(DEFAULT_SOURCE_INTAKE_DIR, "activation-queue.latest.json")),
      readJsonIfPresent(options.nshapPreflightPath ?? path.join(DEFAULT_SOURCE_INTAKE_DIR, "nshap-header-preflight.latest.json")),
      readJsonIfPresent(options.haalsiPreflightPath ?? path.join(DEFAULT_SOURCE_INTAKE_DIR, "haalsi-header-preflight.latest.json")),
      readJsonIfPresent(options.mhasPreflightPath ?? path.join(DEFAULT_SOURCE_INTAKE_DIR, "mhas-header-preflight.latest.json")),
      readJsonIfPresent(options.r603Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r603-transport-readiness-packet.latest.json")),
    ]);

  const inventory = {
    activationQueue: summarizeActivationQueue("activation-queue.latest.json", activationQueue),
    downloadInventory: summarizeDownloadInventory("download-inventory.latest.json", downloadInventory),
    preflights: {
      haalsi: summarizeHeaderPreflight("haalsi-header-preflight.latest.json", haalsiPreflight),
      mhas: summarizeHeaderPreflight("mhas-header-preflight.latest.json", mhasPreflight),
      nshap: summarizeHeaderPreflight("nshap-header-preflight.latest.json", nshapPreflight),
    },
    r603TransportReadiness: summarizeR603("r603-transport-readiness-packet.latest.json", r603Readiness),
    reviewGptReducedDecisions: await summarizeReviewDecisions(options.reviewDecisionDir ?? DEFAULT_REVIEWGPT_DIR),
  };
  const nextLocalActionQueue = buildNextLocalActionQueue(inventory.activationQueue, inventory.preflights, inventory.r603TransportReadiness, inventory.reviewGptReducedDecisions);
  const output: R604NextSourceInventoryPacket = {
    boundary: {
      abstractsStored: false,
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitIdentifiersStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inventory,
    nextLocalActionQueue,
    packetId: "r604-next-source-inventory",
    schemaVersion: R604_NEXT_SOURCE_INVENTORY_SCHEMA_VERSION,
    status: "research-local-metadata-only",
    summary: {
      conclusion: "metadata_inventory_ready",
      localActionCountBand: countBand(nextLocalActionQueue.length),
      productPromotionAuthorized: false,
      safestNextAction: nextLocalActionQueue[0]?.actionId ?? null,
    },
  };
  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R604 next-source inventory failed metadata-egress validation: ${findings.join("; ")}`);
  }
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  } catch {
    throw new Error("R604 next-source inventory failed to write metadata packet.");
  }
  return { output, outputPath };
}

function summarizeDownloadInventory(artifact: string, value: unknown | null): DownloadInventorySummary {
  if (!value) return missingDownloadInventory(artifact);
  const root = requiredRecord(value, artifact);
  const lanes = readRecordArray(root.lanes, `${artifact} lanes`);
  const recommendedNearTermOrder = readMetadataLabelArray(root.recommendedNearTermOrder, `${artifact} recommended order`);
  return {
    activationNeededBeforeParsingRows: optionalBoolean(root.activationNeededBeforeParsingRows),
    artifact,
    laneCountBand: countBand(lanes.length),
    presentLaneCountBand: countBand(lanes.filter((lane) => (optionalNumber(lane.presentFileCount) ?? 0) > 0).length),
    recommendedNearTermOrder,
    rowParsing: optionalMetadataLabel(root.rowParsing, `${artifact} row parsing`),
    schemaVersion: optionalMetadataLabel(root.schemaVersion, `${artifact} schema version`),
    status: "available",
    storedPathPolicy: optionalMetadataLabel(root.storedPathPolicy, `${artifact} stored path policy`),
  };
}

function summarizeActivationQueue(artifact: string, value: unknown | null): ActivationQueueSummary {
  if (!value) {
    return {
      artifact,
      queue: [],
      schemaVersion: null,
      status: "missing",
    };
  }
  const root = requiredRecord(value, artifact);
  return {
    artifact,
    queue: readRecordArray(root.queue, `${artifact} queue`).map((item) => ({
      activationLabelsNeeded: readMetadataLabelArray(item.activationLabelsNeeded, "activation labels"),
      evidenceLabelTarget: optionalMetadataLabel(item.evidenceLabelTarget, "evidence label target"),
      filesPresent: optionalBoolean(item.filesPresent),
      laneGroup: requiredMetadataLabel(item.laneGroup, "lane group"),
      priorityBand: priorityBand(optionalNumber(item.priority)),
      rowParsingUnlocked: optionalBoolean(item.rowParsingUnlocked),
    })),
    schemaVersion: optionalMetadataLabel(root.schemaVersion, `${artifact} schema version`),
    status: "available",
  };
}

function summarizeHeaderPreflight(artifact: string, value: unknown | null): HeaderPreflightSummary {
  if (!value) return missingHeaderPreflight(artifact);
  const root = requiredRecord(value, artifact);
  const datasets = readRecordArray(root.datasets, `${artifact} datasets`);
  return {
    artifact,
    boundary: summarizeBoundary(root.boundary),
    categoryAvailability: summarizeCategories(datasets),
    conclusionLabel: optionalMetadataLabel(root.preflightConclusion, `${artifact} conclusion`),
    datasetCountBand: countBand(datasets.length),
    schemaVersion: optionalMetadataLabel(root.schemaVersion, `${artifact} schema version`),
    sourceLabel: optionalMetadataLabel(root.source, `${artifact} source label`),
    status: "available",
    tableSizeBands: datasets.map((dataset) => ({
      columnCountBand: bandOptionalNumber(dataset.columnCount),
      dataset: requiredMetadataLabel(dataset.dataset, "dataset id"),
      rowCountBand: bandOptionalNumber(dataset.rowCount),
    })),
  };
}

function summarizeR603(artifact: string, value: unknown | null): TransportReadinessSummary {
  if (!value) {
    return {
      artifact,
      conclusion: null,
      productPromotionAuthorized: false,
      schemaVersion: null,
      status: "missing",
      statusLabel: null,
      transportArtifacts: [],
    };
  }
  const root = requiredRecord(value, artifact);
  const readiness = requiredRecord(root.readiness, "R603 readiness");
  const boundary = requiredRecord(root.boundary, "R603 boundary");
  const transport = requiredRecord(root.transport, "R603 transport");
  return {
    artifact,
    conclusion: optionalMetadataLabel(readiness.conclusion, "R603 conclusion"),
    productPromotionAuthorized: requiredFalse(boundary.productPromotionAuthorized, "R603 productPromotionAuthorized"),
    schemaVersion: optionalMetadataLabel(root.schemaVersion, `${artifact} schema version`),
    status: "available",
    statusLabel: optionalMetadataLabel(root.status, "R603 status"),
    transportArtifacts: [
      summarizeTransportArtifact("crelesLocal", transport.crelesLocal),
      summarizeTransportArtifact("midusToCreles", transport.midusToCreles),
    ],
  };
}

async function summarizeReviewDecisions(directory: string): Promise<ReviewDecisionSummary> {
  const entries = await readdirIfPresent(directory);
  const decisionFiles = entries
    .filter((entry) => /(?:reduced|decision).*\.json$/i.test(entry) || /.*(?:reduced|decision)\.latest\.json$/i.test(entry))
    .sort();
  const files = [];
  for (const entry of decisionFiles) {
    const parsed = await readJsonIfPresent(path.join(directory, entry));
    if (!parsed) continue;
    const root = optionalRecord(parsed);
    if (!root) continue;
    files.push({
      artifact: path.basename(entry),
      decisionId: optionalMetadataLabel(root.decisionId, `${entry} decision id`),
      packetId: optionalMetadataLabel(root.packetId, `${entry} packet id`) ?? optionalMetadataLabel(root.packet_id, `${entry} packet id`),
      schemaVersion: optionalMetadataLabel(root.schemaVersion, `${entry} schema version`) ?? optionalMetadataLabel(root.schema_version, `${entry} schema version`),
      status: optionalMetadataLabel(root.status, `${entry} status`),
    });
  }
  return {
    artifactCountBand: countBand(files.length),
    files,
    status: files.length === 0 ? "none_present" : "present",
  };
}

function buildNextLocalActionQueue(
  activationQueue: ActivationQueueSummary,
  preflights: R604NextSourceInventoryPacket["inventory"]["preflights"],
  r603: TransportReadinessSummary,
  reviewDecisions: ReviewDecisionSummary,
): R604NextSourceInventoryPacket["nextLocalActionQueue"] {
  const actions: R604NextSourceInventoryPacket["nextLocalActionQueue"] = activationQueue.queue.map((item, index) => ({
    actionId: `fill-activation-labels-${item.laneGroup}`,
    actionKind: "activation_label_fill" as const,
    blockedUntil: item.rowParsingUnlocked === false ? ["lane-specific source-rights labels", "locked benchmark card before row parsing"] : [],
    laneGroup: item.laneGroup,
    priority: index + 1,
    rationaleLabel: item.evidenceLabelTarget ?? "source-candidate",
    runnableNow: item.filesPresent === true,
  }));

  if (preflights.haalsi.status === "available") {
    actions.push({
      actionId: "map-haalsi-endpoint-feature-labels",
      actionKind: "endpoint_feature_mapping",
      blockedUntil: ["terms and aggregate-output labels before scoring"],
      laneGroup: "haalsi",
      priority: actions.length + 1,
      rationaleLabel: "header-preflight-readable",
      runnableNow: true,
    });
  }
  if (preflights.mhas.status === "available") {
    actions.push({
      actionId: "classify-mhas-survey-eol-transport-fit",
      actionKind: "endpoint_feature_mapping",
      blockedUntil: ["terms and endpoint-join labels before scoring"],
      laneGroup: "mhas-harmonized-eol",
      priority: actions.length + 1,
      rationaleLabel: "header-preflight-readable",
      runnableNow: true,
    });
  }
  if (preflights.nshap.status === "available") {
    actions.push({
      actionId: "classify-nshap-wave-endpoint-biomarker-fit",
      actionKind: "endpoint_feature_mapping",
      blockedUntil: ["wave-linkage and endpoint labels before scoring"],
      laneGroup: "nshap-rounds",
      priority: actions.length + 1,
      rationaleLabel: "header-preflight-readable",
      runnableNow: true,
    });
  }
  if (r603.status === "available") {
    actions.push({
      actionId: "refresh-r603-transport-readiness-before-next-review",
      actionKind: "local_packet_refresh",
      blockedUntil: [],
      laneGroup: "creles-transport",
      priority: actions.length + 1,
      rationaleLabel: r603.conclusion ?? "transport-readiness-present",
      runnableNow: true,
    });
  }
  if (reviewDecisions.status === "present") {
    actions.push({
      actionId: "fold-reduced-reviewgpt-decisions-into-source-priority",
      actionKind: "review_reduced_decision",
      blockedUntil: [],
      laneGroup: "reviewgpt-reduced-decisions",
      priority: actions.length + 1,
      rationaleLabel: "reduced-decisions-present",
      runnableNow: true,
    });
  }
  return rankNextLocalActions(actions, r603);
}

function rankNextLocalActions(
  actions: R604NextSourceInventoryPacket["nextLocalActionQueue"],
  r603: TransportReadinessSummary,
): R604NextSourceInventoryPacket["nextLocalActionQueue"] {
  const transportNotConfirmed = r603.conclusion === "transport_signal_not_confirmed";
  return [...actions]
    .sort((left, right) => actionScore(left, transportNotConfirmed) - actionScore(right, transportNotConfirmed))
    .map((action, index) => ({ ...action, priority: index + 1 }));
}

function actionScore(
  action: R604NextSourceInventoryPacket["nextLocalActionQueue"][number],
  transportNotConfirmed: boolean,
): number {
  if (!transportNotConfirmed) return action.priority;
  if (action.actionKind === "endpoint_feature_mapping" && action.laneGroup === "mhas-harmonized-eol") return 10;
  if (action.actionKind === "endpoint_feature_mapping" && action.laneGroup === "nshap-rounds") return 11;
  if (action.actionKind === "endpoint_feature_mapping" && action.laneGroup === "haalsi") return 12;
  if (action.actionKind === "activation_label_fill" && action.laneGroup === "mhas-harmonized-eol") return 20;
  if (action.actionKind === "activation_label_fill" && action.laneGroup === "nshap-rounds") return 21;
  if (action.actionKind === "activation_label_fill" && action.laneGroup === "haalsi") return 22;
  if (action.actionKind === "activation_label_fill" && action.laneGroup === "sage-south-africa") return 23;
  if (action.actionKind === "local_packet_refresh") return 30;
  if (action.actionKind === "review_reduced_decision") return 40;
  if (action.laneGroup === "midus-refresher-triad") return 90;
  return 50 + action.priority;
}

function summarizeBoundary(value: unknown): HeaderPreflightSummary["boundary"] {
  const boundary = requiredRecord(value, "preflight boundary");
  return {
    codebookTextStored: requiredFalse(boundary.codebookTextStored, "codebookTextStored"),
    localPathsStored: requiredFalse(boundary.localPathsStored, "localPathsStored"),
    participantIdentifiersStored: requiredFalse(boundary.participantIdentifiersStored, "participantIdentifiersStored"),
    rowValuesStored: requiredFalse(boundary.rowValuesStored, "rowValuesStored"),
    sourceBodiesStored: requiredFalse(boundary.sourceBodiesStored, "sourceBodiesStored"),
    variableLabelsStored: requiredFalse(boundary.variableLabelsStored, "variableLabelsStored"),
  };
}

function summarizeCategories(datasets: Record<string, unknown>[]): Record<string, "present" | "absent"> {
  const categories = new Map<string, "present" | "absent">();
  for (const dataset of datasets) {
    const signals = requiredRecord(dataset.categorySignals, "category signals");
    for (const [category, value] of Object.entries(signals)) {
      const signal = requiredRecord(value, `${category} signal`);
      const safeCategory = requiredMetadataLabel(category, "category signal");
      const present = (optionalNumber(signal.matchCount) ?? 0) > 0;
      if (!categories.has(safeCategory)) categories.set(safeCategory, present ? "present" : "absent");
      if (present) categories.set(safeCategory, "present");
    }
  }
  return Object.fromEntries([...categories.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function summarizeTransportArtifact(
  name: "crelesLocal" | "midusToCreles",
  value: unknown,
): TransportReadinessSummary["transportArtifacts"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { name, status: "missing" };
  return {
    name,
    status: optionalMetadataLabel((value as { status?: unknown }).status, `${name} status`) ?? "unknown",
  };
}

function missingDownloadInventory(artifact: string): DownloadInventorySummary {
  return {
    activationNeededBeforeParsingRows: null,
    artifact,
    laneCountBand: null,
    presentLaneCountBand: null,
    recommendedNearTermOrder: [],
    rowParsing: null,
    schemaVersion: null,
    status: "missing",
    storedPathPolicy: null,
  };
}

function missingHeaderPreflight(artifact: string): HeaderPreflightSummary {
  return {
    artifact,
    boundary: {
      codebookTextStored: false,
      localPathsStored: false,
      participantIdentifiersStored: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
      variableLabelsStored: false,
    },
    categoryAvailability: {},
    conclusionLabel: null,
    datasetCountBand: null,
    schemaVersion: null,
    sourceLabel: null,
    status: "missing",
    tableSizeBands: [],
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

async function readdirIfPresent(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return [];
    throw new Error("Failed to inspect Murph Age ReviewGPT decision artifacts.");
  }
}

function readRecordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`${label} must be an object array.`);
  }
  return value as Record<string, unknown>[];
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array.`);
  }
  return [...value];
}

function readMetadataLabelArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a string array.`);
  return value.map((item, index) => requiredMetadataLabel(item, `${label} item ${index + 1}`));
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string.`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredMetadataLabel(value: unknown, label: string): string {
  return sanitizeMetadataLabel(requiredString(value, label), label);
}

function optionalMetadataLabel(value: unknown, label: string): string | null {
  const stringValue = optionalString(value);
  if (stringValue === null) return null;
  const firstClause = stringValue.split(";")[0]?.trim();
  if (firstClause) return sanitizeMetadataLabel(firstClause, label);
  return sanitizeMetadataLabel(stringValue, label);
}

function sanitizeMetadataLabel(value: string, label: string): string {
  if (value.length > MAX_METADATA_LABEL_LENGTH) throw new Error(`${label} is not a safe metadata label.`);
  if (/[\r\n\t]/u.test(value)) throw new Error(`${label} is not a safe metadata label.`);
  if (/[\\/]/u.test(value) || /\b(?:https?|file):/iu.test(value)) throw new Error(`${label} is not a safe metadata label.`);
  if (value.trim().split(/\s+/u).filter(Boolean).length > MAX_METADATA_LABEL_WORDS) {
    throw new Error(`${label} is not a safe metadata label.`);
  }
  if (/\b(?:abstract|authorization|codebook|coefficient|home|participant|prediction|raw\s*row|row\s*value|source\s*body|split\s*id)\b/iu.test(value)) {
    throw new Error(`${label} is not a safe metadata label.`);
  }
  return value;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function requiredFalse(value: unknown, label: string): false {
  if (value !== false) throw new Error(`Unsafe or missing metadata boundary flag: ${label}.`);
  return false;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bandOptionalNumber(value: unknown): string | null {
  const number = optionalNumber(value);
  return number === null ? null : countBand(number);
}

function priorityBand(value: number | null): string {
  if (value === null) return "unknown";
  if (value <= 3) return "top-3";
  if (value <= 6) return "top-6";
  return "later";
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR604NextSourceInventory({
    activationQueuePath: process.env.MURPH_AGE_ACTIVATION_QUEUE_PATH,
    downloadInventoryPath: process.env.MURPH_AGE_DOWNLOAD_INVENTORY_PATH,
    haalsiPreflightPath: process.env.MURPH_AGE_HAALSI_PREFLIGHT_PATH,
    mhasPreflightPath: process.env.MURPH_AGE_MHAS_PREFLIGHT_PATH,
    nshapPreflightPath: process.env.MURPH_AGE_NSHAP_PREFLIGHT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r603Path: process.env.MURPH_AGE_R603_PACKET_PATH,
    reviewDecisionDir: process.env.MURPH_AGE_REVIEW_DECISION_DIR,
  }).then(({ output: packet, outputPath }) => {
    console.log(JSON.stringify({
      actionCountBand: packet.summary.localActionCountBand,
      artifact: path.basename(outputPath),
      packetId: packet.packetId,
      productPromotionAuthorized: packet.boundary.productPromotionAuthorized,
      safestNextAction: packet.summary.safestNextAction,
      schemaVersion: packet.schemaVersion,
      status: packet.status,
    }, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R604 next-source inventory failed.");
    process.exitCode = 1;
  });
}
