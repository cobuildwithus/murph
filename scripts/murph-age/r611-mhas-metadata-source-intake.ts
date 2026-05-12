import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R611_MHAS_METADATA_SOURCE_INTAKE_SCHEMA_VERSION =
  "murph-age-r611-mhas-metadata-source-intake.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r611-mhas-metadata-source-intake.latest.json";
const LANE_ID = "mhas-harmonized-eol";

type ArtifactKey = "r610Scaffold" | "r609Queue" | "mhasSourceFeasibility" | "mhasJoinProbe";
type ArtifactStatus = "available" | "missing";
type IntakeStatus = "blocked-missing-required-artifacts" | "research-local-aggregate-only";
type IntakeConclusion =
  | "missing_required_metadata_artifacts"
  | "mhas_metadata_source_intake_completed_activation_labels_needed"
  | "mhas_metadata_source_intake_completed_join_labels_needed";
type NextGate =
  | "refresh_mhas_metadata_artifacts"
  | "complete_join_key_family_metadata"
  | "fill_source_rights_labels_before_locked_benchmark";

export interface R611MhasMetadataSourceIntakeOptions {
  createdAt?: string;
  mhasJoinProbePath?: string;
  mhasSourceFeasibilityPath?: string;
  outputDir?: string;
  r609Path?: string;
  r610Path?: string;
}

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface R611LoopSummary {
  evidenceArtifactsAvailable: string[];
  evidenceArtifactsMissing: string[];
  laneId: typeof LANE_ID;
  r609LaneStatus: string | null;
  requestedLocalAction: string | null;
  r610NextActionMatched: boolean;
}

export interface R611MhasMetadataSourceIntakeOutput {
  boundary: {
    aggregateOnly: true;
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
  };
  completedLoop: R611LoopSummary;
  createdAt: string;
  gates: {
    blockedActions: string[];
    nextGate: NextGate;
    outcomeScoringUnlocked: false;
    outcomeScoringUnlockRequires: string[];
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  joinAndEndpointMetadata: {
    eolEndpointMetadataStatus: string | null;
    joinBlockerReasons: string[];
    joinKeyFamilyStatus: string | null;
    matchingFamilyCountBand: string | null;
    mortalityOrEolSignal: "absent" | "present" | "unknown";
    readyForLockedJoinContract: boolean | null;
  };
  packetId: "r611-mhas-metadata-source-intake";
  schemaVersion: typeof R611_MHAS_METADATA_SOURCE_INTAKE_SCHEMA_VERSION;
  sourceCoverage: {
    broadFeatureFamilyStatuses: Array<{
      family: string;
      status: "absent" | "available";
    }>;
    eolDatasetPresent: boolean | null;
    eolInventoryLanePresent: boolean | null;
    harmonizedDatasetPresent: boolean | null;
    harmonizedInventoryLanePresent: boolean | null;
    requiredDatasetsPresent: boolean | null;
  };
  sourceRightsAndActivation: {
    activationLabelsComplete: false;
    aggregateOutputPermission: "unconfirmed_human_required";
    rowParsingUnlocked: false;
    sourceActivationStatus: "metadata-only-not-activated" | "unknown";
    termsAllowLocalResearchRows: "unconfirmed_human_required";
  };
  status: IntakeStatus;
  summary: {
    conclusion: IntakeConclusion;
    metadataIntakeCompleted: boolean;
    outcomeScoringUnlockedCountBand: "0";
  };
}

export async function runR611MhasMetadataSourceIntake(
  options: R611MhasMetadataSourceIntakeOptions = {},
): Promise<{ output: R611MhasMetadataSourceIntakeOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  const inputArtifacts = summarizeInputs(inputs);
  const missingRequired = Object.values(inputArtifacts).some((artifact) => artifact.status === "missing");

  const completedLoop = summarizeCompletedLoop(inputs, inputArtifacts);
  const sourceCoverage = summarizeSourceCoverage(inputs.mhasSourceFeasibility);
  const sourceRightsAndActivation = summarizeSourceRightsAndActivation(inputs.mhasSourceFeasibility);
  const joinAndEndpointMetadata = summarizeJoinAndEndpointMetadata(inputs.mhasJoinProbe);
  const readyForLockedJoinContract = joinAndEndpointMetadata.readyForLockedJoinContract === true;
  const nextGate = chooseNextGate(missingRequired, readyForLockedJoinContract);
  const output: R611MhasMetadataSourceIntakeOutput = {
    boundary: {
      aggregateOnly: true,
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
    },
    completedLoop,
    createdAt: options.createdAt ?? new Date().toISOString(),
    gates: {
      blockedActions: summarizeBlockedActions(inputs.r610Scaffold, inputs.r609Queue),
      nextGate,
      outcomeScoringUnlocked: false,
      outcomeScoringUnlockRequires: [
        "source_activation",
        "locked_benchmark_card",
        "aggregate_export_policy",
      ],
    },
    inputArtifacts,
    joinAndEndpointMetadata,
    packetId: "r611-mhas-metadata-source-intake",
    schemaVersion: R611_MHAS_METADATA_SOURCE_INTAKE_SCHEMA_VERSION,
    sourceCoverage,
    sourceRightsAndActivation,
    status: missingRequired ? "blocked-missing-required-artifacts" : "research-local-aggregate-only",
    summary: {
      conclusion: conclusionFor(missingRequired, readyForLockedJoinContract),
      metadataIntakeCompleted: !missingRequired,
      outcomeScoringUnlockedCountBand: "0",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R611 MHAS metadata source intake failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R611MhasMetadataSourceIntakeOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    mhasJoinProbe: await readJsonIfPresent(
      options.mhasJoinProbePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "mhas-join-probe.latest.json"),
    ),
    mhasSourceFeasibility: await readJsonIfPresent(
      options.mhasSourceFeasibilityPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "mhas-source-feasibility.latest.json"),
    ),
    r609Queue: await readJsonIfPresent(
      options.r609Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r609-source-activation-queue.latest.json"),
    ),
    r610Scaffold: await readJsonIfPresent(
      options.r610Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r610-next-executable-loop-scaffold.latest.json"),
    ),
  };
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    mhasJoinProbe: summarizeArtifact("mhas-join-probe.latest.json", inputs.mhasJoinProbe),
    mhasSourceFeasibility: summarizeArtifact("mhas-source-feasibility.latest.json", inputs.mhasSourceFeasibility),
    r609Queue: summarizeArtifact("r609-source-activation-queue.latest.json", inputs.r609Queue),
    r610Scaffold: summarizeArtifact("r610-next-executable-loop-scaffold.latest.json", inputs.r610Scaffold),
  };
}

function summarizeCompletedLoop(
  inputs: Record<ArtifactKey, unknown | null>,
  artifacts: Record<ArtifactKey, ArtifactSummary>,
): R611LoopSummary {
  const r610Loop = findR610MhasLoop(inputs.r610Scaffold);
  const r609Lane = findR609MhasLane(inputs.r609Queue);
  const r610Summary = optionalRecord(optionalRecord(inputs.r610Scaffold)?.summary);
  const evidenceArtifacts = new Set([
    ...readMetadataLabelArray(optionalRecord(r610Loop)?.evidenceArtifacts, "R610 MHAS evidence artifacts", false),
    ...readMetadataLabelArray(optionalRecord(r609Lane)?.evidenceArtifacts, "R609 MHAS evidence artifacts", false),
  ]);
  if (evidenceArtifacts.size === 0) {
    evidenceArtifacts.add("mhas-join-probe.latest.json");
    evidenceArtifacts.add("mhas-source-feasibility.latest.json");
  }
  const availableNames = new Set(Object.values(artifacts)
    .filter((artifact) => artifact.status === "available")
    .map((artifact) => artifact.artifact));
  return {
    evidenceArtifactsAvailable: [...evidenceArtifacts].filter((artifact) => availableNames.has(artifact)).sort(),
    evidenceArtifactsMissing: [...evidenceArtifacts].filter((artifact) => !availableNames.has(artifact)).sort(),
    laneId: LANE_ID,
    r609LaneStatus: optionalMetadataLabel(optionalRecord(r609Lane)?.currentStatus, "R609 MHAS lane status"),
    requestedLocalAction: optionalMetadataLabel(optionalRecord(r610Loop)?.localAction, "R610 MHAS local action")
      ?? optionalMetadataLabel(optionalRecord(r609Lane)?.allowedNextLocalAction, "R609 MHAS local action"),
    r610NextActionMatched: optionalString(r610Summary?.nextActionForParent)
      === "run_metadata_only_loop:mhas-harmonized-eol:complete_mhas_metadata_source_intake",
  };
}

function summarizeSourceCoverage(value: unknown | null): R611MhasMetadataSourceIntakeOutput["sourceCoverage"] {
  if (!value) {
    return {
      broadFeatureFamilyStatuses: [],
      eolDatasetPresent: null,
      eolInventoryLanePresent: null,
      harmonizedDatasetPresent: null,
      harmonizedInventoryLanePresent: null,
      requiredDatasetsPresent: null,
    };
  }
  const root = requiredRecord(value, "MHAS source feasibility");
  assertBoundaryFlags(root.boundary, "MHAS source feasibility boundary");
  const coverage = optionalRecord(root.coverage);
  const datasets = readRecordArray(coverage?.datasets, "MHAS source feasibility datasets", false);
  const broadFeatureFamilies = optionalRecord(coverage?.broadFeatureFamilies) ?? {};
  const downloadInventory = optionalRecord(root.downloadInventory);
  const lanes = readRecordArray(downloadInventory?.lanes, "MHAS source feasibility lanes", false);
  return {
    broadFeatureFamilyStatuses: Object.entries(broadFeatureFamilies).map(([family, summary]) => {
      const record = requiredRecord(summary, `${family} feature-family summary`);
      return {
        family: requiredMetadataLabel(family, "feature family"),
        status: readAvailability(record.status),
      };
    }).sort((left, right) => left.family.localeCompare(right.family)),
    eolDatasetPresent: datasets.some((dataset) => optionalString(dataset.dataset) === "mhas_eol"),
    eolInventoryLanePresent: lanes.some((lane) => optionalString(lane.lane) === "mhas-end-of-life" && lane.present === true),
    harmonizedDatasetPresent: datasets.some((dataset) => optionalString(dataset.dataset) === "mhas_harmonized"),
    harmonizedInventoryLanePresent: lanes.some((lane) => optionalString(lane.lane) === "mhas-harmonized" && lane.present === true),
    requiredDatasetsPresent: optionalBoolean(coverage?.requiredDatasetsPresent),
  };
}

function summarizeSourceRightsAndActivation(
  value: unknown | null,
): R611MhasMetadataSourceIntakeOutput["sourceRightsAndActivation"] {
  if (!value) return sourceRightsDefaults("unknown");
  const root = requiredRecord(value, "MHAS source feasibility");
  const lanes = readRecordArray(optionalRecord(root.downloadInventory)?.lanes, "MHAS source feasibility lanes", false);
  const activationStatuses = lanes
    .map((lane) => optionalMetadataLabel(lane.activationStatus, "MHAS activation status"))
    .filter(isString);
  const sourceActivationStatus = activationStatuses.length > 0
    && activationStatuses.every((status) => status === "metadata-only-not-activated")
    ? "metadata-only-not-activated"
    : "unknown";
  return sourceRightsDefaults(sourceActivationStatus);
}

function sourceRightsDefaults(
  sourceActivationStatus: R611MhasMetadataSourceIntakeOutput["sourceRightsAndActivation"]["sourceActivationStatus"],
): R611MhasMetadataSourceIntakeOutput["sourceRightsAndActivation"] {
  return {
    activationLabelsComplete: false,
    aggregateOutputPermission: "unconfirmed_human_required",
    rowParsingUnlocked: false,
    sourceActivationStatus,
    termsAllowLocalResearchRows: "unconfirmed_human_required",
  };
}

function summarizeJoinAndEndpointMetadata(
  value: unknown | null,
): R611MhasMetadataSourceIntakeOutput["joinAndEndpointMetadata"] {
  if (!value) {
    return {
      eolEndpointMetadataStatus: null,
      joinBlockerReasons: [],
      joinKeyFamilyStatus: null,
      matchingFamilyCountBand: null,
      mortalityOrEolSignal: "unknown",
      readyForLockedJoinContract: null,
    };
  }
  const root = requiredRecord(value, "MHAS join probe");
  assertBoundaryFlags(root.boundary, "MHAS join probe boundary");
  const endpoint = optionalRecord(root.endpointEolMetadataStatus);
  const join = optionalRecord(root.joinFeasibility);
  return {
    eolEndpointMetadataStatus: optionalMetadataLabel(endpoint?.status, "MHAS EOL endpoint status"),
    joinBlockerReasons: readMetadataLabelArray(join?.blockerReasons, "MHAS join blocker reasons", false),
    joinKeyFamilyStatus: optionalMetadataLabel(join?.joinKeyFamilyStatus, "MHAS join-key family status"),
    matchingFamilyCountBand: optionalMetadataLabel(join?.matchingFamilyCountBand, "MHAS matching family count band"),
    mortalityOrEolSignal: readMortalitySignal(endpoint?.mortalityOrEolSignal),
    readyForLockedJoinContract: optionalBoolean(join?.readyForLockedJoinContract),
  };
}

function summarizeBlockedActions(r610Value: unknown | null, r609Value: unknown | null): string[] {
  const r610Loop = optionalRecord(findR610MhasLoop(r610Value));
  const r609Lane = optionalRecord(findR609MhasLane(r609Value));
  return dedupeLabels([
    ...readMetadataLabelArray(r610Loop?.blockedActions, "R610 MHAS blocked actions", false),
    ...readMetadataLabelArray(r609Lane?.blockedActions, "R609 MHAS blocked actions", false),
    "row_parsing_until_source_activation",
    "outcome_scoring_until_locked_benchmark",
    "model_mutation_until_execution_gate",
  ]);
}

function findR610MhasLoop(value: unknown | null): unknown | null {
  if (!value) return null;
  const root = requiredRecord(value, "R610 scaffold");
  assertBoundaryFlags(root.boundary, "R610 boundary");
  return readRecordArray(root.executableLocalLoops, "R610 executable loops", false)
    .find((loop) => optionalString(loop.laneId) === LANE_ID) ?? null;
}

function findR609MhasLane(value: unknown | null): unknown | null {
  if (!value) return null;
  const root = requiredRecord(value, "R609 queue");
  assertBoundaryFlags(root.boundary, "R609 boundary");
  return readRecordArray(root.candidateLanes, "R609 candidate lanes", false)
    .find((lane) => optionalString(lane.laneId) === LANE_ID) ?? null;
}

function chooseNextGate(missingRequired: boolean, readyForLockedJoinContract: boolean): NextGate {
  if (missingRequired) return "refresh_mhas_metadata_artifacts";
  return readyForLockedJoinContract
    ? "fill_source_rights_labels_before_locked_benchmark"
    : "complete_join_key_family_metadata";
}

function conclusionFor(missingRequired: boolean, readyForLockedJoinContract: boolean): IntakeConclusion {
  if (missingRequired) return "missing_required_metadata_artifacts";
  return readyForLockedJoinContract
    ? "mhas_metadata_source_intake_completed_activation_labels_needed"
    : "mhas_metadata_source_intake_completed_join_labels_needed";
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

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read an aggregate Murph Age metadata artifact.");
  }
}

function assertBoundaryFlags(value: unknown, label: string): void {
  const boundary = requiredRecord(value, label);
  for (const key of [
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
  ]) {
    if (boundary[key] !== undefined && boundary[key] !== false) {
      throw new Error(`${label} has unsafe boundary flag ${key}.`);
    }
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

function readAvailability(value: unknown): "absent" | "available" {
  const label = requiredMetadataLabel(value, "availability status");
  if (label !== "absent" && label !== "available") throw new Error("Unexpected MHAS availability status.");
  return label;
}

function readMortalitySignal(value: unknown): R611MhasMetadataSourceIntakeOutput["joinAndEndpointMetadata"]["mortalityOrEolSignal"] {
  if (value === "present" || value === "absent") return value;
  return "unknown";
}

function dedupeLabels(values: string[]): string[] {
  return [...new Set(values.map((value) => requiredMetadataLabel(value, "blocked action")))].sort();
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}

async function main(): Promise<void> {
  const { output } = await runR611MhasMetadataSourceIntake({
    mhasJoinProbePath: process.env.MURPH_AGE_MHAS_JOIN_PROBE_PATH,
    mhasSourceFeasibilityPath: process.env.MURPH_AGE_MHAS_SOURCE_FEASIBILITY_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r609Path: process.env.MURPH_AGE_R609_PACKET_PATH,
    r610Path: process.env.MURPH_AGE_R610_PACKET_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: output.summary.conclusion,
    metadataIntakeCompleted: output.summary.metadataIntakeCompleted,
    nextGate: output.gates.nextGate,
    outcomeScoringUnlockedCountBand: output.summary.outcomeScoringUnlockedCountBand,
    packetId: output.packetId,
    rowParsingPerformed: output.boundary.rowParsingPerformed,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R611 MHAS metadata source intake failed."}\n`);
    process.exitCode = 1;
  });
}
