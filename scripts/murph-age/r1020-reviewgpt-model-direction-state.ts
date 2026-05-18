import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1020_REVIEWGPT_MODEL_DIRECTION_STATE_SCHEMA_VERSION =
  "murph-age-r1020-reviewgpt-model-direction-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_REVIEWGPT_REDUCED_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "reviewgpt",
  "reduced",
);
const OUTPUT_FILE_NAME = "r1020-reviewgpt-model-direction-state.latest.json";

type ArtifactKey = "r1018ScoreBearingModelSignalReceipt" | "r1019ReviewGptReduction";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface Inputs {
  r1018ScoreBearingModelSignalReceipt: unknown | null;
  r1019ReviewGptReduction: unknown | null;
}

export interface R1020ReviewGptModelDirectionStateOptions {
  createdAt?: string;
  outputDir?: string;
  r1018Path?: string;
  r1019ReductionPath?: string;
}

export interface R1020ReviewGptModelDirectionStateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1020: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextActions: Array<{
    actionId:
      | "complete_nshap_source_confirmation"
      | "build_fresh_nshap_function_cognition_harness_after_confirmation"
      | "continue_mhas_function_fallback_if_nshap_blocked"
      | "carry_compact_glycemia_shadow_only"
      | "hold_broad_labs_and_wearables"
      | "send_reviewgpt_only_after_fresh_aggregate_delta";
    blockedBy: string[];
    owner: "human_user" | "local_codex" | "reviewgpt";
    status: "blocked" | "held" | "runnable";
    why: string;
  }>;
  packetId: "r1020-reviewgpt-model-direction-state";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  reviewGptConsensus: {
    decision: string | null;
    nextLoop: string | null;
    trustedReviewerCount: number;
    familyPolicyCounts: Record<string, number>;
    sourcePolicyCounts: Record<string, number>;
  };
  schemaVersion: typeof R1020_REVIEWGPT_MODEL_DIRECTION_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "reviewgpt_confirms_function_lead_glycemia_shadow"
      | "reviewgpt_model_direction_pending_or_missing";
    nextLocalAction:
      | "build_fresh_nshap_harness_after_confirmation_else_continue_mhas_function"
      | "wait_for_r1019_reduction_or_recover_inputs";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1020: false;
  };
}

export async function runR1020ReviewGptModelDirectionState(
  options: R1020ReviewGptModelDirectionStateOptions = {},
): Promise<{ output: R1020ReviewGptModelDirectionStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const trustedReviewerCount = readNumberAt(inputs.r1019ReviewGptReduction, ["counts", "trusted"]) ?? 0;
  const consensusDecision = readStringAt(inputs.r1019ReviewGptReduction, ["consensus", "decision"]);
  const consensusNextLoop = readStringAt(inputs.r1019ReviewGptReduction, ["consensus", "next_loop"]);
  const functionLead = readStringAt(inputs.r1018ScoreBearingModelSignalReceipt, [
    "modelSignalState",
    "functionSidecarStatus",
  ]) === "lead_diagnostic_supported_pending_fresh_nshap";
  const nextProposalBatch = readStringAt(inputs.r1018ScoreBearingModelSignalReceipt, [
    "modelSignalState",
    "nextProposalBatch",
  ]);
  const nshapFreshHarnessState = readStringAt(inputs.r1018ScoreBearingModelSignalReceipt, [
    "modelSignalState",
    "nshapFreshHarnessState",
  ]);
  const confirmed = trustedReviewerCount === 3
    && consensusDecision === "keep_function_lead_glycemia_shadow"
    && functionLead
    && nextProposalBatch === "function_lead_with_glycemia_shadow_no_product";
  const nshapReady = nshapFreshHarnessState === "ready_after_confirmation_no_scoring";
  const conclusion = confirmed
    ? "reviewgpt_confirms_function_lead_glycemia_shadow"
    : "reviewgpt_model_direction_pending_or_missing";

  const output: R1020ReviewGptModelDirectionStateOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1020: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    nextActions: [
      {
        actionId: "complete_nshap_source_confirmation",
        blockedBy: nshapReady ? [] : ["nshap_source_confirmation_missing"],
        owner: "human_user",
        status: nshapReady ? "runnable" : "blocked",
        why: "R1019 makes fresh NSHAP the decisive next falsification source for the function/disability lead.",
      },
      {
        actionId: "build_fresh_nshap_function_cognition_harness_after_confirmation",
        blockedBy: nshapReady ? [] : ["nshap_source_confirmation_missing"],
        owner: "local_codex",
        status: nshapReady ? "runnable" : "blocked",
        why: "The harness should test function/disability as lead and cognition as shadow against the frozen outcome-risk anchor.",
      },
      {
        actionId: "continue_mhas_function_fallback_if_nshap_blocked",
        blockedBy: [],
        owner: "local_codex",
        status: functionLead ? "runnable" : "blocked",
        why: "MHAS/Gateway MHAS remains supporting fallback evidence while NSHAP is blocked.",
      },
      {
        actionId: "carry_compact_glycemia_shadow_only",
        blockedBy: [],
        owner: "local_codex",
        status: confirmed ? "runnable" : "held",
        why: "Compact glycemia remains useful shadow evidence but is not score-bearing or product-promotable.",
      },
      {
        actionId: "hold_broad_labs_and_wearables",
        blockedBy: [],
        owner: "local_codex",
        status: "held",
        why: "R1019 consensus holds broad labs and wearables until transport or outcome increment improves.",
      },
      {
        actionId: "send_reviewgpt_only_after_fresh_aggregate_delta",
        blockedBy: [],
        owner: "reviewgpt",
        status: "held",
        why: "ReviewGPT should review meaningful fresh aggregate deltas or model-family forks, not local handoffs.",
      },
    ],
    packetId: "r1020-reviewgpt-model-direction-state",
    productPolicy: {
      displayAuthorized: false,
      productClaimsAuthorized: false,
      promotionAuthorized: false,
    },
    reviewGptConsensus: {
      decision: consensusDecision,
      familyPolicyCounts: readRecordOfNumbersAt(inputs.r1019ReviewGptReduction, [
        "aggregateCounts",
        "familyPolicyCounts",
      ]),
      nextLoop: consensusNextLoop,
      sourcePolicyCounts: readRecordOfNumbersAt(inputs.r1019ReviewGptReduction, [
        "aggregateCounts",
        "sourcePolicyCounts",
      ]),
      trustedReviewerCount,
    },
    schemaVersion: R1020_REVIEWGPT_MODEL_DIRECTION_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextLocalAction: conclusion === "reviewgpt_confirms_function_lead_glycemia_shadow"
        ? "build_fresh_nshap_harness_after_confirmation_else_continue_mhas_function"
        : "wait_for_r1019_reduction_or_recover_inputs",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1020: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1020Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1020 ReviewGPT model direction state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1020ReviewGptModelDirectionStateOptions): Promise<Inputs> {
  return {
    r1018ScoreBearingModelSignalReceipt: await readJsonIfPresent(
      options.r1018Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1018-score-bearing-model-signal-receipt.latest.json"),
    ),
    r1019ReviewGptReduction: await readJsonIfPresent(
      options.r1019ReductionPath
        ?? path.join(DEFAULT_REVIEWGPT_REDUCED_DIR, "r1019-score-bearing-model-direction-summary.json"),
    ),
  };
}

function validateInputs(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1020 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Inputs): Record<ArtifactKey, ArtifactSummary> {
  return {
    r1018ScoreBearingModelSignalReceipt: summarizeArtifact(
      "r1018ScoreBearingModelSignalReceipt",
      inputs.r1018ScoreBearingModelSignalReceipt,
    ),
    r1019ReviewGptReduction: summarizeArtifact("r1019ReviewGptReduction", inputs.r1019ReviewGptReduction),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  const root = optionalRecord(value);
  return {
    artifact,
    packetId: readStringAt(root, ["packetId"]) ?? null,
    schemaVersion: readStringAt(root, ["schemaVersion"]) ?? readStringAt(root, ["schema_version"]) ?? null,
    status: root ? "available" : "missing",
  };
}

function readNumberAt(value: unknown | null, keys: string[]): number | null {
  const current = readAt(value, keys);
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  const current = readAt(value, keys);
  return typeof current === "string" && current.length > 0 ? current : null;
}

function readRecordOfNumbersAt(value: unknown | null, keys: string[]): Record<string, number> {
  const record = optionalRecord(readAt(value, keys));
  if (!record) return {};
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, number] =>
    typeof entry[1] === "number" && Number.isFinite(entry[1])
  ));
}

function readAt(value: unknown | null, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return current;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function findForbiddenR1020Output(output: R1020ReviewGptModelDirectionStateOutput): string[] {
  const encoded = JSON.stringify(output);
  const findings: string[] = [];
  if (/[A-Za-z]:[\\/]|(?:^|")\/(?:Users|home|tmp|var)\//u.test(encoded)) {
    findings.push("output contains path-like local text");
  }
  if (/Downloads|external-sources|cache-entry|\.dta|\.zip|\.rar|\.pdf|latest\.json|ICPSR_/u.test(encoded)) {
    findings.push("output contains local source file/cache text");
  }
  return findings;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { output } = await runR1020ReviewGptModelDirectionState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1018Path: process.env.MURPH_AGE_R1018_SCORE_BEARING_SIGNAL_PATH,
    r1019ReductionPath: process.env.MURPH_AGE_R1019_REVIEWGPT_REDUCTION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    decision: output.reviewGptConsensus.decision,
    nextLocalAction: output.summary.nextLocalAction,
    nextLoop: output.reviewGptConsensus.nextLoop,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    rowParsingPerformedByR1020: output.summary.rowParsingPerformedByR1020,
    schemaVersion: output.schemaVersion,
    status: output.status,
    trustedReviewerCount: output.reviewGptConsensus.trustedReviewerCount,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1020 ReviewGPT model direction state failed."}\n`);
    process.exit(1);
  });
}
