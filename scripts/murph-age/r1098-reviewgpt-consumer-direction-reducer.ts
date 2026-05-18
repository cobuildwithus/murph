import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1098_REVIEWGPT_CONSUMER_DIRECTION_REDUCER_SCHEMA_VERSION =
  "murph-age-r1098-reviewgpt-consumer-direction-reducer.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_REVIEWGPT_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1095-reviewgpt-science-direction.raw.json");
const OUTPUT_FILE_NAME = "r1098-reviewgpt-consumer-direction-reducer.latest.json";

const INPUTS = {
  r1096: {
    artifact: "r1096-consumer-validation-route-priority.latest.json",
    packetId: "r1096-consumer-validation-route-priority",
    schemaVersion: "murph-age-r1096-consumer-validation-route-priority.v1",
  },
  r1097: {
    artifact: "r1097-consumer-lab-wearable-aggregate-template.latest.json",
    packetId: "r1097-consumer-lab-wearable-aggregate-template",
    schemaVersion: "murph-age-r1097-consumer-lab-wearable-aggregate-template.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1098ReviewGptConsumerDirectionReducerOptions {
  createdAt?: string;
  outputDir?: string;
  reviewGptPath?: string;
  r1096Path?: string;
  r1097Path?: string;
}

export interface R1098ReviewGptConsumerDirectionReducerOutput {
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
    rowParsingPerformedByR1098: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1098-reviewgpt-consumer-direction-reducer";
  productDisplayAuthorized: false;
  reducedDecision: {
    ageEvidenceSubbands: ["16_17", "18_39", "40_50"];
    candidateDecision: "keep_common_lab_core_shadow";
    modelShape: "nested_source_aware_horizon_specific_prognosis_models";
    nhanesRole: "public_bridge_not_true_wearable_certification";
    routeDecision:
      | "all_of_us_or_partner_workbench_first_nhanes_bridge_ukb_supporting"
      | "blocked_missing_reviewgpt_or_local_alignment";
    wearableStatus: "blocked_until_true_consumer_outcome_linked_aggregate_receipt";
  };
  reviewGptInput: {
    decision: string | null;
    keepCommonLabCoreShadow: boolean;
    status: "available" | "missing";
  };
  schemaVersion: typeof R1098_REVIEWGPT_CONSUMER_DIRECTION_REDUCER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "reviewgpt_direction_aligned_consumer_lab_wearable_route_locked"
      | "reviewgpt_direction_missing_or_misaligned";
    nextLocalAction:
      | "annotate_age_subbands_and_continue_aggregate_receipt_path"
      | "rerun_high_value_reviewgpt_direction";
    productDisplayAuthorized: false;
    reviewGptUse: "next_only_for_valid_scientific_delta_or_major_architecture_question";
    rowParsingPerformedByR1098: false;
  };
}

export async function runR1098ReviewGptConsumerDirectionReducer(
  options: R1098ReviewGptConsumerDirectionReducerOptions = {},
): Promise<{ output: R1098ReviewGptConsumerDirectionReducerOutput; outputPath: string }> {
  const reviewGpt = await readJsonIfPresent(options.reviewGptPath ?? DEFAULT_REVIEWGPT_PATH);
  const inputs = await readInputs(options);
  validateInputBoundaries({ reviewGpt, ...inputs });

  const decision = readStringAt(reviewGpt, ["decision"]);
  const keepCommonLabCoreShadow = readBooleanAt(reviewGpt, ["candidate_shape", "keep_common_lab_core_shadow"]) === true;
  const ageGuardCorrect = readStringAt(reviewGpt, ["age_domain_guard", "verdict"]) === "correct";
  const localRoutesReady = readStringAt(inputs.r1096, ["summary", "conclusion"])
    === "consumer_lab_wearable_validation_routes_ranked";
  const templateReady = readStringAt(inputs.r1097, ["summary", "conclusion"])
    === "consumer_lab_wearable_template_ready_for_data_holder_fill";
  const routeText = readStringAt(reviewGpt, ["next_validation_priority", "0", "route"]);
  const routeDecisionReady = decision === "approve_direction"
    && keepCommonLabCoreShadow
    && ageGuardCorrect
    && localRoutesReady
    && templateReady
    && routeText === null;
  const reviewRouteReady = hasAllOfUsPartnerFirstRoute(reviewGpt);
  const ready = routeDecisionReady && reviewRouteReady;

  const output: R1098ReviewGptConsumerDirectionReducerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1098-reviewgpt-consumer-direction-reducer",
    productDisplayAuthorized: false,
    reducedDecision: {
      ageEvidenceSubbands: ["16_17", "18_39", "40_50"],
      candidateDecision: "keep_common_lab_core_shadow",
      modelShape: "nested_source_aware_horizon_specific_prognosis_models",
      nhanesRole: "public_bridge_not_true_wearable_certification",
      routeDecision: ready
        ? "all_of_us_or_partner_workbench_first_nhanes_bridge_ukb_supporting"
        : "blocked_missing_reviewgpt_or_local_alignment",
      wearableStatus: "blocked_until_true_consumer_outcome_linked_aggregate_receipt",
    },
    reviewGptInput: {
      decision,
      keepCommonLabCoreShadow,
      status: reviewGpt ? "available" : "missing",
    },
    schemaVersion: R1098_REVIEWGPT_CONSUMER_DIRECTION_REDUCER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "reviewgpt_direction_aligned_consumer_lab_wearable_route_locked"
        : "reviewgpt_direction_missing_or_misaligned",
      nextLocalAction: ready
        ? "annotate_age_subbands_and_continue_aggregate_receipt_path"
        : "rerun_high_value_reviewgpt_direction",
      productDisplayAuthorized: false,
      reviewGptUse: "next_only_for_valid_scientific_delta_or_major_architecture_question",
      rowParsingPerformedByR1098: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1098 ReviewGPT consumer direction reducer failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function hasAllOfUsPartnerFirstRoute(reviewGpt: unknown | null): boolean {
  const firstRoute = readStringAt(readArrayAt(reviewGpt, ["next_validation_priority"])[0] ?? null, ["route"]);
  if (!firstRoute) return false;
  const normalized = firstRoute.toLowerCase();
  return normalized.includes("all of us") && normalized.includes("partner") && normalized.includes("aggregate");
}

async function readInputs(options: R1098ReviewGptConsumerDirectionReducerOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1096: await readJsonIfPresent(options.r1096Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1096.artifact)),
    r1097: await readJsonIfPresent(options.r1097Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1097.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<string, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1098 rejected unsafe ${key} input: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.keys(INPUTS) as InputKey[]).map((key) => [key, summarizeInput(INPUTS[key].artifact, inputs[key])]),
  ) as Record<InputKey, ArtifactSummary>;
}

function summarizeInput(artifact: string, value: unknown | null): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
}

function safeBoundary() {
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
    rowParsingPerformedByR1098: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  } as const;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readArrayAt(value: unknown, pathParts: readonly string[]): unknown[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function main(): Promise<void> {
  const { output } = await runR1098ReviewGptConsumerDirectionReducer({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    reviewGptPath: process.env.MURPH_AGE_R1098_REVIEWGPT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    ageEvidenceSubbands: output.reducedDecision.ageEvidenceSubbands,
    conclusion: output.summary.conclusion,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptUse: output.summary.reviewGptUse,
    rowParsingPerformedByR1098: output.summary.rowParsingPerformedByR1098,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1098 ReviewGPT consumer direction reducer failed."}\n`);
    process.exitCode = 1;
  });
}
