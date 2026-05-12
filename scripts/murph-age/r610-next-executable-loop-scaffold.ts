import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R610_NEXT_EXECUTABLE_LOOP_SCAFFOLD_SCHEMA_VERSION =
  "murph-age-r610-next-executable-loop-scaffold.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r610-next-executable-loop-scaffold.latest.json";

type RequiredInputKey = "r603TransportReadiness" | "r606GlycemiaAblation" | "r607ReviewPacket" | "r608FreezeManifest" | "r609SourceActivationQueue";
type ScaffoldStatus = "blocked-missing-required-artifacts" | "research-local-aggregate-only";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ExecutableLoop {
  blockedActions: string[];
  evidenceArtifacts: string[];
  laneId: string;
  localAction: string;
  loopId: string;
  outcomeScoringUnlocked: false;
  reviewGptHighLevelSourceStrategyOnly: boolean;
  source: "r609-source-activation-queue";
}

interface BlockedLoop {
  blockedUntil: string[];
  loopId: string;
  outcomeScoringUnlocked: false;
  reason: string;
}

export interface R610NextExecutableLoopScaffoldOptions {
  createdAt?: string;
  outputDir?: string;
  r603Path?: string;
  r606Path?: string;
  r607Path?: string;
  r608Path?: string;
  r609Path?: string;
}

export interface R610NextExecutableLoopScaffold {
  boundary: {
    aggregateOnly: true;
    codebookProseStored: false;
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
    recommendationClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitIdentifiersStored: false;
    splitMembershipStored: false;
  };
  blockedLoops: BlockedLoop[];
  createdAt: string;
  executableLocalLoops: ExecutableLoop[];
  frozenCandidate: {
    candidateId: string | null;
    minimumNextEvidenceClass: string | null;
    status: string | null;
  };
  inputArtifacts: Record<RequiredInputKey, ArtifactSummary>;
  packetId: "r610-next-executable-loop-scaffold";
  schemaVersion: typeof R610_NEXT_EXECUTABLE_LOOP_SCAFFOLD_SCHEMA_VERSION;
  status: ScaffoldStatus;
  summary: {
    conclusion: "metadata_loop_ready_no_scoring_unlocked" | "missing_required_aggregate_artifacts";
    executableLoopCountBand: string;
    nextActionForParent: string;
    outcomeScoringUnlockedCountBand: "0";
  };
}

export async function runR610NextExecutableLoopScaffold(
  options: R610NextExecutableLoopScaffoldOptions = {},
): Promise<{ output: R610NextExecutableLoopScaffold; outputPath: string }> {
  const inputs = await readRequiredInputs(options);
  const inputArtifacts = summarizeInputs(inputs);
  const missingRequired = Object.values(inputArtifacts).some((artifact) => artifact.status === "missing");
  const executableLocalLoops = missingRequired ? [] : executableLoopsFromR609(inputs.r609SourceActivationQueue);
  const output: R610NextExecutableLoopScaffold = {
    boundary: {
      aggregateOnly: true,
      codebookProseStored: false,
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
      recommendationClaimsIncluded: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitIdentifiersStored: false,
      splitMembershipStored: false,
    },
    blockedLoops: blockedLoopsFromInputs(inputs, missingRequired),
    createdAt: options.createdAt ?? new Date().toISOString(),
    executableLocalLoops,
    frozenCandidate: frozenCandidateFromR608(inputs.r608FreezeManifest),
    inputArtifacts,
    packetId: "r610-next-executable-loop-scaffold",
    schemaVersion: R610_NEXT_EXECUTABLE_LOOP_SCAFFOLD_SCHEMA_VERSION,
    status: missingRequired ? "blocked-missing-required-artifacts" : "research-local-aggregate-only",
    summary: {
      conclusion: missingRequired ? "missing_required_aggregate_artifacts" : "metadata_loop_ready_no_scoring_unlocked",
      executableLoopCountBand: countBand(executableLocalLoops.length),
      nextActionForParent: nextActionForParent(executableLocalLoops, missingRequired),
      outcomeScoringUnlockedCountBand: "0",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R610 next executable loop scaffold failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readRequiredInputs(options: R610NextExecutableLoopScaffoldOptions): Promise<Record<RequiredInputKey, unknown | null>> {
  return {
    r603TransportReadiness: await readJsonIfPresent(options.r603Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r603-transport-readiness-packet.latest.json")),
    r606GlycemiaAblation: await readJsonIfPresent(options.r606Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r606-parsimonious-glycemia-ablation.latest.json")),
    r607ReviewPacket: await readJsonIfPresent(options.r607Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r607-glycemia-ablation-review-packet.latest.json")),
    r608FreezeManifest: await readJsonIfPresent(options.r608Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r608-freeze-glycemia-candidate.latest.json")),
    r609SourceActivationQueue: await readJsonIfPresent(options.r609Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r609-source-activation-queue.latest.json")),
  };
}

function summarizeInputs(inputs: Record<RequiredInputKey, unknown | null>): Record<RequiredInputKey, ArtifactSummary> {
  return {
    r603TransportReadiness: summarizeArtifact("r603-transport-readiness-packet.latest.json", inputs.r603TransportReadiness),
    r606GlycemiaAblation: summarizeArtifact("r606-parsimonious-glycemia-ablation.latest.json", inputs.r606GlycemiaAblation),
    r607ReviewPacket: summarizeArtifact("r607-glycemia-ablation-review-packet.latest.json", inputs.r607ReviewPacket),
    r608FreezeManifest: summarizeArtifact("r608-freeze-glycemia-candidate.latest.json", inputs.r608FreezeManifest),
    r609SourceActivationQueue: summarizeArtifact("r609-source-activation-queue.latest.json", inputs.r609SourceActivationQueue),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, artifact);
  return {
    artifact,
    packetId: optionalMetadataLabel(root.packetId, `${artifact} packet id`) ?? optionalMetadataLabel(root.manifestId, `${artifact} manifest id`),
    schemaVersion: optionalMetadataLabel(root.schemaVersion, `${artifact} schema version`),
    status: "available",
  };
}

function executableLoopsFromR609(value: unknown | null): ExecutableLoop[] {
  if (!value) return [];
  const root = requiredRecord(value, "R609 source activation queue");
  const lanes = readRecordArray(root.candidateLanes, "R609 candidate lanes");
  return lanes.map((lane) => {
    const laneId = requiredMetadataLabel(lane.laneId, "R609 lane id");
    return {
      blockedActions: readMetadataLabelArray(lane.blockedActions, `${laneId} blocked actions`),
      evidenceArtifacts: readMetadataLabelArray(lane.evidenceArtifacts, `${laneId} evidence artifacts`),
      laneId,
      localAction: requiredMetadataLabel(lane.allowedNextLocalAction, `${laneId} local action`),
      loopId: `activate-${laneId}`,
      outcomeScoringUnlocked: false as const,
      reviewGptHighLevelSourceStrategyOnly: lane.reviewGptHighLevelSourceStrategyOnly === true,
      source: "r609-source-activation-queue" as const,
    };
  }).filter((loop) => loop.evidenceArtifacts.length > 0);
}

function blockedLoopsFromInputs(inputs: Record<RequiredInputKey, unknown | null>, missingRequired: boolean): BlockedLoop[] {
  const blocked: BlockedLoop[] = [
    {
      blockedUntil: [
        "source_activation",
        "locked_benchmark_card",
        "aggregate_export_policy",
      ],
      loopId: "outcome-scoring",
      outcomeScoringUnlocked: false,
      reason: "R609 reports zero outcome-scoring lanes unlocked.",
    },
    {
      blockedUntil: [
        "external_source_validation",
        "product_translation_review",
      ],
      loopId: "product-display",
      outcomeScoringUnlocked: false,
      reason: "R399/R608 remain research-only and not product-promotable.",
    },
  ];
  if (missingRequired) {
    blocked.unshift({
      blockedUntil: ["refresh_required_aggregate_packets"],
      loopId: "post-r609-loop-scaffold",
      outcomeScoringUnlocked: false,
      reason: "One or more R603/R606-R609 aggregate artifacts are missing.",
    });
  }
  if (transportSignalNotConfirmed(inputs.r603TransportReadiness)) {
    blocked.push({
      blockedUntil: ["new_external_or_source_validation_lane"],
      loopId: "same-family-transport-claim",
      outcomeScoringUnlocked: false,
      reason: "R603 transport readiness does not confirm the CRELES transport signal.",
    });
  }
  return blocked;
}

function frozenCandidateFromR608(value: unknown | null): R610NextExecutableLoopScaffold["frozenCandidate"] {
  if (!value) return { candidateId: null, minimumNextEvidenceClass: null, status: null };
  const root = requiredRecord(value, "R608 freeze manifest");
  const validationNeed = optionalRecord(root.sourceValidationNeed);
  return {
    candidateId: optionalMetadataLabel(root.frozenCandidateId, "R608 frozen candidate id"),
    minimumNextEvidenceClass: optionalMetadataLabel(validationNeed?.minimumNextEvidenceClass, "R608 minimum evidence class"),
    status: optionalMetadataLabel(root.status, "R608 status"),
  };
}

function transportSignalNotConfirmed(value: unknown | null): boolean {
  if (!value) return false;
  const root = requiredRecord(value, "R603 transport readiness");
  const readiness = optionalRecord(root.readiness);
  return readiness?.conclusion === "transport_signal_not_confirmed";
}

function nextActionForParent(loops: ExecutableLoop[], missingRequired: boolean): string {
  if (missingRequired) return "refresh_r603_r606_r607_r608_r609_aggregate_packets";
  const metadataLoop = loops.find((loop) => loop.reviewGptHighLevelSourceStrategyOnly) ?? loops[0];
  return metadataLoop
    ? `run_metadata_only_loop:${metadataLoop.laneId}:${metadataLoop.localAction}`
    : "no_local_loop_available_without_new_source_metadata";
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read a Murph Age aggregate artifact.");
  }
}

function readRecordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`${label} must be an object array.`);
  }
  return value as Record<string, unknown>[];
}

function readMetadataLabelArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a string array.`);
  return value.map((item, index) => requiredMetadataLabel(item, `${label} ${index}`));
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
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

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 50) return "10-49";
  if (count < 100) return "50-99";
  return "100+";
}

async function main(): Promise<void> {
  const { output } = await runR610NextExecutableLoopScaffold({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r603Path: process.env.MURPH_AGE_R603_PACKET_PATH,
    r606Path: process.env.MURPH_AGE_R606_PACKET_PATH,
    r607Path: process.env.MURPH_AGE_R607_PACKET_PATH,
    r608Path: process.env.MURPH_AGE_R608_MANIFEST_PATH,
    r609Path: process.env.MURPH_AGE_R609_PACKET_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: output.summary.conclusion,
    executableLoopCountBand: output.summary.executableLoopCountBand,
    outcomeScoringUnlockedCountBand: output.summary.outcomeScoringUnlockedCountBand,
    packetId: output.packetId,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R610 next executable loop scaffold failed."}\n`);
    process.exitCode = 1;
  });
}
