import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R609_SOURCE_ACTIVATION_QUEUE_SCHEMA_VERSION =
  "murph-age-r609-source-activation-queue.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r609-source-activation-queue.latest.json";
const MAX_METADATA_LABEL_LENGTH = 96;
const MAX_METADATA_LABEL_WORDS = 10;

type ArtifactKey =
  | "haalsiSourceFeasibility"
  | "mhasJoinProbe"
  | "mhasSourceFeasibility"
  | "nshapActivationFeasibility"
  | "r604NextSourceInventory";
type ArtifactStatus = "available" | "missing";
type CandidateLaneStatus =
  | "inventory_candidate"
  | "metadata_ready"
  | "metadata_ready_activation_required"
  | "missing_input_artifact"
  | "not_ready";

export interface R609SourceActivationQueueOptions {
  createdAt?: string;
  haalsiSourceFeasibilityPath?: string;
  mhasJoinProbePath?: string;
  mhasSourceFeasibilityPath?: string;
  nshapActivationFeasibilityPath?: string;
  outputDir?: string;
  r604NextSourceInventoryPath?: string;
}

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface CandidateLane {
  allowedNextLocalAction: string;
  blockedActions: string[];
  currentStatus: CandidateLaneStatus;
  evidenceArtifacts: string[];
  laneId: string;
  outcomeScoringUnlocked: false;
  reviewGptHighLevelSourceStrategyOnly: boolean;
  reviewGptReason: string | null;
}

export interface R609SourceActivationQueueOutput {
  artifactInputs: Record<ArtifactKey, ArtifactSummary>;
  boundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformed: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    protocolClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitIdentifiersStored: false;
  };
  candidateLanes: CandidateLane[];
  createdAt: string;
  packetId: "r609-source-activation-queue";
  reviewGptStrategyQueue: Array<{
    laneId: string;
    reviewScope: "high_level_source_strategy_only";
    reason: string;
  }>;
  schemaVersion: typeof R609_SOURCE_ACTIVATION_QUEUE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    candidateLaneCountBand: string;
    conclusion: "source_activation_queue_ready";
    outcomeScoringUnlockedCountBand: "0";
    reviewGptLaneCountBand: string;
  };
}

export async function runR609SourceActivationQueue(
  options: R609SourceActivationQueueOptions = {},
): Promise<{ output: R609SourceActivationQueueOutput; outputPath: string }> {
  const [mhasSource, mhasJoin, nshap, haalsi, r604] = await Promise.all([
    readJsonIfPresent(options.mhasSourceFeasibilityPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "mhas-source-feasibility.latest.json")),
    readJsonIfPresent(options.mhasJoinProbePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "mhas-join-probe.latest.json")),
    readJsonIfPresent(options.nshapActivationFeasibilityPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "nshap-activation-feasibility.latest.json")),
    readJsonIfPresent(options.haalsiSourceFeasibilityPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "haalsi-source-feasibility.latest.json")),
    readJsonIfPresent(options.r604NextSourceInventoryPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r604-next-source-inventory.latest.json")),
  ]);

  const artifactInputs: R609SourceActivationQueueOutput["artifactInputs"] = {
    haalsiSourceFeasibility: summarizeArtifact("haalsi-source-feasibility.latest.json", haalsi),
    mhasJoinProbe: summarizeArtifact("mhas-join-probe.latest.json", mhasJoin),
    mhasSourceFeasibility: summarizeArtifact("mhas-source-feasibility.latest.json", mhasSource),
    nshapActivationFeasibility: summarizeArtifact("nshap-activation-feasibility.latest.json", nshap),
    r604NextSourceInventory: summarizeArtifact("r604-next-source-inventory.latest.json", r604),
  };
  const candidateLanes = buildCandidateLanes({ artifactInputs, haalsi, mhasJoin, mhasSource, nshap, r604 });
  const reviewGptStrategyQueue = candidateLanes
    .filter((lane) => lane.reviewGptHighLevelSourceStrategyOnly)
    .map((lane) => ({
      laneId: lane.laneId,
      reason: lane.reviewGptReason ?? "source_strategy_transition",
      reviewScope: "high_level_source_strategy_only" as const,
    }));

  const output: R609SourceActivationQueueOutput = {
    artifactInputs,
    boundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformed: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      protocolClaimsIncluded: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitIdentifiersStored: false,
    },
    candidateLanes,
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r609-source-activation-queue",
    reviewGptStrategyQueue,
    schemaVersion: R609_SOURCE_ACTIVATION_QUEUE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      candidateLaneCountBand: countBand(candidateLanes.length),
      conclusion: "source_activation_queue_ready",
      outcomeScoringUnlockedCountBand: "0",
      reviewGptLaneCountBand: countBand(reviewGptStrategyQueue.length),
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R609 source activation queue failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function buildCandidateLanes(input: {
  artifactInputs: R609SourceActivationQueueOutput["artifactInputs"];
  haalsi: unknown | null;
  mhasJoin: unknown | null;
  mhasSource: unknown | null;
  nshap: unknown | null;
  r604: unknown | null;
}): CandidateLane[] {
  const lanes = new Map<string, CandidateLane>();
  lanes.set("mhas-harmonized-eol", summarizeMhasLane(input.artifactInputs, input.mhasSource, input.mhasJoin));
  lanes.set("nshap", summarizeNshapLane(input.artifactInputs, input.nshap));
  lanes.set("haalsi", summarizeHaalsiLane(input.artifactInputs, input.haalsi));
  mergeR604InventoryLanes(lanes, input.r604);
  return [...lanes.values()].sort((left, right) => laneSortKey(left.laneId) - laneSortKey(right.laneId)
    || left.laneId.localeCompare(right.laneId));
}

function summarizeMhasLane(
  artifacts: R609SourceActivationQueueOutput["artifactInputs"],
  sourceValue: unknown | null,
  joinValue: unknown | null,
): CandidateLane {
  const evidenceArtifacts = availableArtifacts([
    artifacts.mhasSourceFeasibility,
    artifacts.mhasJoinProbe,
  ]);
  if (!sourceValue && !joinValue) return missingLane("mhas-harmonized-eol", "generate_mhas_source_feasibility_artifacts");

  const join = optionalRecord(joinValue);
  const source = optionalRecord(sourceValue);
  const joinFeasibility = optionalRecord(join?.joinFeasibility);
  const sourceJoinReadiness = optionalRecord(source?.joinReadiness);
  const joinReady = optionalBoolean(joinFeasibility?.readyForLockedJoinContract) === true
    || optionalString(joinFeasibility?.status) === "metadata_ready"
    || optionalString(sourceJoinReadiness?.status) === "metadata_join_probe_ready";
  const allowedNextLocalAction =
    optionalLabel(join?.nextRunnableAction, "MHAS next action")
    ?? optionalLabel(optionalRecord(source?.transportLoopEligibility)?.nextGate, "MHAS next gate")
    ?? "complete_mhas_metadata_source_intake";
  return {
    allowedNextLocalAction,
    blockedActions: dedupeLabels([
      "row_parsing_until_source_activation",
      "outcome_scoring_until_locked_benchmark",
      "model_mutation_until_execution_gate",
    ]),
    currentStatus: joinReady ? "metadata_ready" : "not_ready",
    evidenceArtifacts,
    laneId: "mhas-harmonized-eol",
    outcomeScoringUnlocked: false,
    reviewGptHighLevelSourceStrategyOnly: joinReady,
    reviewGptReason: joinReady ? "locked_join_strategy_needed" : null,
  };
}

function summarizeNshapLane(
  artifacts: R609SourceActivationQueueOutput["artifactInputs"],
  value: unknown | null,
): CandidateLane {
  if (!value) return missingLane("nshap", "generate_nshap_activation_feasibility_artifact");
  const root = requiredRecord(value, "NSHAP activation feasibility");
  const endpoint = optionalRecord(root.endpointReadiness);
  const noScore = optionalRecord(root.noScoreReadiness);
  const endpointReady = optionalBoolean(endpoint?.readyForLockedBenchmarkDesign) === true;
  const activationRequired = optionalBoolean(endpoint?.rowActivationRequiredBeforeExecution) !== false;
  return {
    allowedNextLocalAction: optionalLabel(noScore?.nextAction, "NSHAP next action") ?? "complete_source_intake_metadata",
    blockedActions: dedupeLabels([
      activationRequired ? "row_execution_until_source_activation" : null,
      "outcome_scoring_until_locked_benchmark",
      "model_mutation_until_execution_gate",
    ]),
    currentStatus: endpointReady
      ? activationRequired ? "metadata_ready_activation_required" : "metadata_ready"
      : "not_ready",
    evidenceArtifacts: availableArtifacts([artifacts.nshapActivationFeasibility]),
    laneId: "nshap",
    outcomeScoringUnlocked: false,
    reviewGptHighLevelSourceStrategyOnly: endpointReady,
    reviewGptReason: endpointReady ? "benchmark_design_strategy_needed" : null,
  };
}

function summarizeHaalsiLane(
  artifacts: R609SourceActivationQueueOutput["artifactInputs"],
  value: unknown | null,
): CandidateLane {
  if (!value) return missingLane("haalsi", "generate_haalsi_source_feasibility_artifact");
  const root = requiredRecord(value, "HAALSI source feasibility");
  const endpoint = optionalRecord(root.endpointReadiness);
  const assessment = optionalRecord(root.laneAssessment);
  const endpointReady = optionalBoolean(endpoint?.readyForFutureOutcomeDesign) === true;
  const activationRequired = optionalBoolean(endpoint?.rowActivationRequiredBeforeExecution) !== false;
  return {
    allowedNextLocalAction: optionalLabel(assessment?.nextAction, "HAALSI next action") ?? "complete_haalsi_source_intake_metadata",
    blockedActions: dedupeLabels([
      activationRequired ? "row_execution_until_source_activation" : null,
      "outcome_scoring_until_locked_benchmark",
      "model_mutation_until_execution_gate",
    ]),
    currentStatus: endpointReady
      ? activationRequired ? "metadata_ready_activation_required" : "metadata_ready"
      : "not_ready",
    evidenceArtifacts: availableArtifacts([artifacts.haalsiSourceFeasibility]),
    laneId: "haalsi",
    outcomeScoringUnlocked: false,
    reviewGptHighLevelSourceStrategyOnly: endpointReady,
    reviewGptReason: endpointReady ? "future_outcome_strategy_needed" : null,
  };
}

function mergeR604InventoryLanes(lanes: Map<string, CandidateLane>, value: unknown | null): void {
  const root = optionalRecord(value);
  const queue = Array.isArray(root?.nextLocalActionQueue) ? root.nextLocalActionQueue : [];
  for (const item of queue) {
    const action = optionalRecord(item);
    if (!action) continue;
    const laneId = optionalLabel(action.laneGroup, "R604 lane group");
    if (!laneId || laneId === "reviewgpt-reduced-decisions") continue;
    const blockedUntil = readOptionalLabelArray(action.blockedUntil, "R604 blocked labels");
    const allowedNextLocalAction = optionalLabel(action.actionId, "R604 action id") ?? "fill_source_activation_labels";
    const existing = lanes.get(laneId);
    if (existing) {
      lanes.set(laneId, {
        ...existing,
        blockedActions: dedupeLabels([...existing.blockedActions, ...blockedUntil]),
      });
      continue;
    }
    lanes.set(laneId, {
      allowedNextLocalAction,
      blockedActions: dedupeLabels([
        ...blockedUntil,
        "row_parsing_until_source_activation",
        "outcome_scoring_until_locked_benchmark",
      ]),
      currentStatus: "inventory_candidate",
      evidenceArtifacts: ["r604-next-source-inventory.latest.json"],
      laneId,
      outcomeScoringUnlocked: false,
      reviewGptHighLevelSourceStrategyOnly: optionalLabel(action.actionKind, "R604 action kind") === "endpoint_feature_mapping",
      reviewGptReason: optionalLabel(action.actionKind, "R604 action kind") === "endpoint_feature_mapping"
        ? "source_priority_strategy_needed"
        : null,
    });
  }
}

function missingLane(laneId: string, allowedNextLocalAction: string): CandidateLane {
  return {
    allowedNextLocalAction,
    blockedActions: [
      "all_source_activation_actions_until_input_artifact_available",
      "outcome_scoring_until_locked_benchmark",
    ],
    currentStatus: "missing_input_artifact",
    evidenceArtifacts: [],
    laneId,
    outcomeScoringUnlocked: false,
    reviewGptHighLevelSourceStrategyOnly: false,
    reviewGptReason: null,
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, artifact);
  return {
    artifact,
    packetId: optionalLabel(root.packetId, `${artifact} packet id`),
    schemaVersion: optionalLabel(root.schemaVersion, `${artifact} schema version`),
    status: "available",
  };
}

function availableArtifacts(artifacts: ArtifactSummary[]): string[] {
  return artifacts
    .filter((artifact) => artifact.status === "available")
    .map((artifact) => artifact.artifact)
    .sort();
}

function readOptionalLabelArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const parsed = optionalLabel(item, `${label} item ${index + 1}`);
    return parsed ? [parsed] : [];
  });
}

function dedupeLabels(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))]
    .sort();
}

function laneSortKey(laneId: string): number {
  if (laneId === "mhas-harmonized-eol") return 10;
  if (laneId === "nshap") return 20;
  if (laneId === "haalsi") return 30;
  if (laneId === "creles-transport") return 40;
  if (laneId === "midus-refresher-triad") return 50;
  return 100;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read a Murph Age metadata artifact.");
  }
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalLabel(value: unknown, label: string): string | null {
  const stringValue = optionalString(value);
  if (!stringValue) return null;
  return sanitizeMetadataLabel(stringValue, label);
}

function sanitizeMetadataLabel(value: string, label: string): string {
  if (value.length > MAX_METADATA_LABEL_LENGTH) throw new Error(`${label} is not a safe metadata label.`);
  if (/[\r\n\t]/u.test(value)) throw new Error(`${label} is not a safe metadata label.`);
  if (/[\\/]/u.test(value) || /\b(?:https?|file):/iu.test(value)) throw new Error(`${label} is not a safe metadata label.`);
  if (value.trim().split(/\s+/u).filter(Boolean).length > MAX_METADATA_LABEL_WORDS) {
    throw new Error(`${label} is not a safe metadata label.`);
  }
  if (/\b(?:abstract|authorization|codebook|coefficient|home|identifier|participant|prediction|raw\s*row|row\s*value|split\s*id)\b/iu.test(value)) {
    throw new Error(`${label} is not a safe metadata label.`);
  }
  return value;
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 50) return "10-49";
  if (count < 100) return "50-99";
  return "100+";
}

async function main(): Promise<void> {
  const { output } = await runR609SourceActivationQueue({
    haalsiSourceFeasibilityPath: process.env.MURPH_AGE_HAALSI_SOURCE_FEASIBILITY_PATH,
    mhasJoinProbePath: process.env.MURPH_AGE_MHAS_JOIN_PROBE_PATH,
    mhasSourceFeasibilityPath: process.env.MURPH_AGE_MHAS_SOURCE_FEASIBILITY_PATH,
    nshapActivationFeasibilityPath: process.env.MURPH_AGE_NSHAP_ACTIVATION_FEASIBILITY_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r604NextSourceInventoryPath: process.env.MURPH_AGE_R604_NEXT_SOURCE_INVENTORY_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    candidateLaneCountBand: output.summary.candidateLaneCountBand,
    outcomeScoringUnlockedCountBand: output.summary.outcomeScoringUnlockedCountBand,
    packetId: output.packetId,
    reviewGptLaneCountBand: output.summary.reviewGptLaneCountBand,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R609 source activation queue failed."}\n`);
    process.exitCode = 1;
  });
}
