import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1102_REVIEWGPT_CONSUMER_DIRECTION_REDUCER_SCHEMA_VERSION =
  "murph-age-r1102-reviewgpt-consumer-direction-reducer.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_REVIEWGPT_PATH = path.join(
  DEFAULT_MODEL_RUNS_DIR,
  "r1100-reviewgpt-consumer-labs-wearables-direction.phlebas.continued.raw.md",
);
const OUTPUT_FILE_NAME = "r1102-reviewgpt-consumer-direction-reducer.latest.json";

interface R1100LoopDecision {
  candidate_family?: unknown;
  data_requirement?: unknown;
  discard_threshold?: unknown;
  loop_id?: unknown;
  priority?: unknown;
  success_threshold?: unknown;
  why?: unknown;
}

interface R1100ReviewGptJson {
  codex_next_actions_without_reviewgpt?: unknown;
  confidence?: unknown;
  decision?: unknown;
  lab_candidate_policy?: unknown;
  negative_result_memory?: unknown;
  next_model_loops?: unknown;
  reviewgpt_next_use?: unknown;
  schema_version?: unknown;
  source_priority_for_16_50_consumer_features?: unknown;
  wearable_policy?: unknown;
}

export interface R1102ReviewGptConsumerDirectionReducerOptions {
  createdAt?: string;
  outputDir?: string;
  reviewGptRawPath?: string;
}

export interface R1102ReviewGptConsumerDirectionReducerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1102: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  packetId: "r1102-reviewgpt-consumer-direction-reducer";
  productDisplayAuthorized: false;
  reducedDecision: {
    codexNextActionCount: number;
    confidence: number | null;
    decision: string | null;
    immediateLabCandidate: "tiny_glycemia_only";
    integratedPanelPolicy: "held_until_components_pass";
    nextLoopIds: string[];
    reviewGptNextUse: string | null;
    wearableScoreBearingUnlockCondition: string | null;
    wearableStatus: "blocked_until_outcome_linked_aggregate_receipt";
  };
  reviewGptJson: R1100ReviewGptJson | null;
  schemaVersion: typeof R1102_REVIEWGPT_CONSUMER_DIRECTION_REDUCER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "reviewgpt_consumer_direction_reduced"
      | "reviewgpt_consumer_direction_missing_or_unusable";
    nextLocalAction:
      | "materialize_candidate_family_manifest_and_receipt_validator"
      | "rerun_or_reharvest_r1100_reviewgpt_direction";
    productDisplayAuthorized: false;
    reviewGptUse: "only_after_real_aggregate_delta_or_major_science_fork";
    rowParsingPerformedByR1102: false;
  };
}

export async function runR1102ReviewGptConsumerDirectionReducer(
  options: R1102ReviewGptConsumerDirectionReducerOptions = {},
): Promise<{ output: R1102ReviewGptConsumerDirectionReducerOutput; outputPath: string }> {
  const raw = await readTextIfPresent(options.reviewGptRawPath ?? DEFAULT_REVIEWGPT_PATH);
  const reviewGptJson = raw ? extractR1100Json(raw) : null;
  validateReviewGptBoundary(reviewGptJson);

  const nextLoops = readLoopDecisions(reviewGptJson);
  const ready = reviewGptJson
    && readStringAt(reviewGptJson, ["schema_version"]) === "murph-age-r1100-consumer-labs-wearables-direction.v1"
    && readStringAt(reviewGptJson, ["decision"])?.includes("tiny_glycemia_only") === true
    && readStringAt(reviewGptJson, ["wearable_policy", "score_bearing_unlock_condition"]) !== null;

  const output: R1102ReviewGptConsumerDirectionReducerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r1102-reviewgpt-consumer-direction-reducer",
    productDisplayAuthorized: false,
    reducedDecision: {
      codexNextActionCount: readStringArrayLike(reviewGptJson, ["codex_next_actions_without_reviewgpt"]).length,
      confidence: readNumberAt(reviewGptJson, ["confidence"]),
      decision: readStringAt(reviewGptJson, ["decision"]),
      immediateLabCandidate: "tiny_glycemia_only",
      integratedPanelPolicy: "held_until_components_pass",
      nextLoopIds: nextLoops.map((loop) => readStringField(loop, "loop_id")).filter((id): id is string => Boolean(id)),
      reviewGptNextUse: readStringAt(reviewGptJson, ["reviewgpt_next_use"]),
      wearableScoreBearingUnlockCondition: readStringAt(reviewGptJson, ["wearable_policy", "score_bearing_unlock_condition"]),
      wearableStatus: "blocked_until_outcome_linked_aggregate_receipt",
    },
    reviewGptJson,
    schemaVersion: R1102_REVIEWGPT_CONSUMER_DIRECTION_REDUCER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "reviewgpt_consumer_direction_reduced"
        : "reviewgpt_consumer_direction_missing_or_unusable",
      nextLocalAction: ready
        ? "materialize_candidate_family_manifest_and_receipt_validator"
        : "rerun_or_reharvest_r1100_reviewgpt_direction",
      productDisplayAuthorized: false,
      reviewGptUse: "only_after_real_aggregate_delta_or_major_science_fork",
      rowParsingPerformedByR1102: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1102 ReviewGPT consumer direction reducer failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function extractR1100Json(raw: string): R1100ReviewGptJson | null {
  const markerIndex = raw.indexOf("R1100_CONSUMER_LABS_WEARABLES_DIRECTION_JSON");
  const searchStart = markerIndex >= 0 ? markerIndex : 0;
  const firstBrace = raw.indexOf("{", searchStart);
  if (firstBrace < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = firstBrace; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(raw.slice(firstBrace, index + 1)) as R1100ReviewGptJson;
      }
    }
  }
  return null;
}

function validateReviewGptBoundary(value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1102 rejected unsafe ReviewGPT input: ${findings.join("; ")}`);
  }
}

function readLoopDecisions(value: unknown | null): R1100LoopDecision[] {
  const loops = readAt(value, ["next_model_loops"]);
  return Array.isArray(loops)
    ? loops.filter((loop): loop is R1100LoopDecision => Boolean(loop) && typeof loop === "object" && !Array.isArray(loop))
    : [];
}

function safeBoundary(): R1102ReviewGptConsumerDirectionReducerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1102: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function readTextIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readNumberAt(value: unknown, pathParts: readonly string[]): number | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "number" ? resolved : null;
}

function readStringArrayLike(value: unknown, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readStringField(value: R1100LoopDecision, key: keyof R1100LoopDecision): string | null {
  const resolved = value[key];
  return typeof resolved === "string" ? resolved : null;
}

async function main(): Promise<void> {
  const { output } = await runR1102ReviewGptConsumerDirectionReducer({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    reviewGptRawPath: process.env.MURPH_AGE_R1100_REVIEWGPT_RAW_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    immediateLabCandidate: output.reducedDecision.immediateLabCandidate,
    nextLocalAction: output.summary.nextLocalAction,
    nextLoopIds: output.reducedDecision.nextLoopIds,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptUse: output.summary.reviewGptUse,
    rowParsingPerformedByR1102: output.summary.rowParsingPerformedByR1102,
    schemaVersion: output.schemaVersion,
    status: output.status,
    wearableStatus: output.reducedDecision.wearableStatus,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1102 ReviewGPT consumer direction reducer failed."}\n`);
    process.exitCode = 1;
  });
}
