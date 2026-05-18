import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1015_NEW_DATA_ACCELERATION_STATE_SCHEMA_VERSION =
  "murph-age-r1015-new-data-acceleration-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_REVIEWGPT_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "reviewgpt",
);
const OUTPUT_FILE_NAME = "r1015-new-data-acceleration-state.latest.json";

type ArtifactKey =
  | "r614NshapActivationLabels"
  | "r994ExpandedSourceCacheReadiness"
  | "r1012CrossSourceFunctionConsistency"
  | "r1013BiomarkerShadowLayerState"
  | "r1014ReviewGptReduction"
  | "r1014ReviewGptSendSummary";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface Inputs {
  r614NshapActivationLabels: unknown | null;
  r994ExpandedSourceCacheReadiness: unknown | null;
  r1012CrossSourceFunctionConsistency: unknown | null;
  r1013BiomarkerShadowLayerState: unknown | null;
  r1014ReviewGptReduction: unknown | null;
  r1014ReviewGptSendSummary: unknown | null;
}

export interface R1015NewDataAccelerationStateOptions {
  createdAt?: string;
  outputDir?: string;
  r614NshapPath?: string;
  r994Path?: string;
  r1012Path?: string;
  r1013Path?: string;
  r1014ReductionPath?: string;
  r1014SendSummaryPath?: string;
}

export interface R1015NewDataAccelerationStateOutput {
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
    rowParsingPerformedByR1015: false;
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
  newDataAcceleration: {
    biomarkerShadowReady: boolean;
    fastestCachedLane: string | null;
    functionLeadSupported: boolean;
    reviewGptDirectionConsensus: string | null;
    reviewGptDirectionChorusSent: boolean;
    reviewGptMhasExecuteNowConsensus: boolean;
    reviewGptNshapActivateNextConsensus: boolean;
    reviewGptTrustedReviewerCount: number | null;
    scoreBearingSourceCountBand: string | null;
    sourceCoverageBuckets: Record<string, string[]>;
  };
  nextBatch: Array<{
    actionId:
      | "complete_nshap_source_confirmation"
      | "prepare_nshap_no_score_row_harness_after_confirmation"
      | "run_mhas_no_score_generalization_card_now"
      | "reuse_mhas_mh_source_evidence_without_retune"
      | "reuse_midus_creles_as_shadow_context"
      | "run_haalsi_sage_endpoint_feasibility_only";
    blockedBy: string[];
    owner: "human_user" | "local_codex";
    priority: "p0" | "p1" | "p2";
    status: "blocked" | "runnable" | "held";
    why: string;
  }>;
  packetId: "r1015-new-data-acceleration-state";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  schemaVersion: typeof R1015_NEW_DATA_ACCELERATION_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "new_data_acceleration_ready_but_nshap_source_confirmation_blocks_fresh_rows"
      | "new_data_acceleration_hold_missing_source_map";
    nextLocalAction:
      | "complete_nshap_source_confirmation_then_prepare_no_score_row_harness"
      | "run_mhas_now_while_completing_nshap_confirmation"
      | "recover_source_acceleration_inputs";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1015: false;
  };
}

export async function runR1015NewDataAccelerationState(
  options: R1015NewDataAccelerationStateOptions = {},
): Promise<{ output: R1015NewDataAccelerationStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const sourceMapAvailable = inputs.r994ExpandedSourceCacheReadiness !== null;
  const functionLeadSupported = readStringAt(inputs.r1012CrossSourceFunctionConsistency, ["summary", "conclusion"])
    === "function_disability_lead_sidecar_supported_pending_fresh_nshap";
  const biomarkerShadowReady = readStringAt(inputs.r1013BiomarkerShadowLayerState, ["summary", "conclusion"])
    === "biomarker_body_shadow_layer_mapped_not_promotable";
  const sourceLabelsComplete = readBooleanAt(inputs.r614NshapActivationLabels, [
    "summary",
    "sourceRightsLabelsComplete",
  ]) === true;
  const aggregateOutputsActive = readBooleanAt(inputs.r614NshapActivationLabels, [
    "summary",
    "aggregateOutputsActive",
  ]) === true;
  const r1014Sent = readNumberAt(inputs.r1014ReviewGptSendSummary, ["sent_count"]) === 5
    && readNumberAt(inputs.r1014ReviewGptSendSummary, ["extended_pro_missing_count"]) === 0;
  const r1014TrustedCount = readNumberAt(inputs.r1014ReviewGptReduction, ["counts", "trusted"]);
  const r1014Consensus = readStringAt(inputs.r1014ReviewGptReduction, ["consensus", "decision"]);
  const r1014MhasExecuteNowConsensus =
    readNumberAt(inputs.r1014ReviewGptReduction, [
      "aggregateCounts",
      "sourceFamilyCounts",
      "MHAS/Gateway MHAS:execute_now",
    ]) === 5;
  const r1014NshapActivateNextConsensus =
    readNumberAt(inputs.r1014ReviewGptReduction, [
      "aggregateCounts",
      "sourceFamilyCounts",
      "NSHAP:activate_next",
    ]) === 5;
  const sourceCoverageBuckets = readStringArrayRecordAt(inputs.r994ExpandedSourceCacheReadiness, ["categoryBuckets"]);
  const conclusion = sourceMapAvailable
    ? "new_data_acceleration_ready_but_nshap_source_confirmation_blocks_fresh_rows"
    : "new_data_acceleration_hold_missing_source_map";
  const mhasParallelRunnable = functionLeadSupported && r1014MhasExecuteNowConsensus;

  const output: R1015NewDataAccelerationStateOutput = {
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
      rowParsingPerformedByR1015: false,
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
    newDataAcceleration: {
      biomarkerShadowReady,
      fastestCachedLane: readStringAt(inputs.r994ExpandedSourceCacheReadiness, ["summary", "fastestLaneNow"]),
      functionLeadSupported,
      reviewGptDirectionConsensus: r1014Consensus,
      reviewGptDirectionChorusSent: r1014Sent,
      reviewGptMhasExecuteNowConsensus: r1014MhasExecuteNowConsensus,
      reviewGptNshapActivateNextConsensus: r1014NshapActivateNextConsensus,
      reviewGptTrustedReviewerCount: r1014TrustedCount,
      scoreBearingSourceCountBand: readStringAt(inputs.r994ExpandedSourceCacheReadiness, [
        "summary",
        "scoreBearingCompleteCountBand",
      ]),
      sourceCoverageBuckets,
    },
    nextBatch: [
      {
        actionId: "complete_nshap_source_confirmation",
        blockedBy: sourceLabelsComplete && aggregateOutputsActive
          ? []
          : ["source_rights_or_aggregate_output_permission_unconfirmed"],
        owner: "human_user",
        priority: "p0",
        status: sourceLabelsComplete && aggregateOutputsActive ? "runnable" : "blocked",
        why: "Fresh NSHAP rows stay blocked until the account-holder/source-label confirmation is explicit.",
      },
      {
        actionId: "run_mhas_no_score_generalization_card_now",
        blockedBy: mhasParallelRunnable ? [] : ["mhas_execute_now_consensus_or_function_support_missing"],
        owner: "local_codex",
        priority: "p0",
        status: mhasParallelRunnable ? "runnable" : "held",
        why: "R1014 ReviewGPT consensus says MHAS should run in parallel now as a no-score generalization/explanation lane.",
      },
      {
        actionId: "prepare_nshap_no_score_row_harness_after_confirmation",
        blockedBy: sourceLabelsComplete && aggregateOutputsActive ? [] : ["nshap_source_confirmation_missing"],
        owner: "local_codex",
        priority: "p0",
        status: sourceLabelsComplete && aggregateOutputsActive ? "runnable" : "blocked",
        why: "The next useful model-learning loop is a bounded function/cognition falsification harness, not broad feature search.",
      },
      {
        actionId: "reuse_mhas_mh_source_evidence_without_retune",
        blockedBy: [],
        owner: "local_codex",
        priority: "p1",
        status: functionLeadSupported ? "runnable" : "held",
        why: "Existing aggregate MHAS/function receipts are supportive enough for source-card context without another retune.",
      },
      {
        actionId: "reuse_midus_creles_as_shadow_context",
        blockedBy: [],
        owner: "local_codex",
        priority: "p1",
        status: biomarkerShadowReady ? "runnable" : "held",
        why: "MIDUS and CRELES are useful as lab/body shadow evidence but not as product-promoted age model layers.",
      },
      {
        actionId: "run_haalsi_sage_endpoint_feasibility_only",
        blockedBy: [],
        owner: "local_codex",
        priority: "p2",
        status: "held",
        why: "HAALSI and SAGE are useful transport candidates only after endpoint and denominator feasibility is cleaner.",
      },
    ],
    packetId: "r1015-new-data-acceleration-state",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    schemaVersion: R1015_NEW_DATA_ACCELERATION_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextLocalAction: conclusion === "new_data_acceleration_ready_but_nshap_source_confirmation_blocks_fresh_rows"
        ? mhasParallelRunnable
          ? "run_mhas_now_while_completing_nshap_confirmation"
          : "complete_nshap_source_confirmation_then_prepare_no_score_row_harness"
        : "recover_source_acceleration_inputs",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1015: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1015Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1015 new data acceleration state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1015NewDataAccelerationStateOptions): Promise<Inputs> {
  return {
    r614NshapActivationLabels: await readJsonIfPresent(
      options.r614NshapPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-nshap-activation-labels.latest.json"),
    ),
    r994ExpandedSourceCacheReadiness: await readJsonIfPresent(
      options.r994Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r994-expanded-source-cache-readiness.latest.json"),
    ),
    r1012CrossSourceFunctionConsistency: await readJsonIfPresent(
      options.r1012Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1012-cross-source-function-consistency.latest.json"),
    ),
    r1013BiomarkerShadowLayerState: await readJsonIfPresent(
      options.r1013Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1013-biomarker-shadow-layer-state.latest.json"),
    ),
    r1014ReviewGptReduction: await readJsonIfPresent(
      options.r1014ReductionPath
        ?? path.join(DEFAULT_REVIEWGPT_DIR, "reduced", "r1014-new-data-acceleration-direction-summary.json"),
    ),
    r1014ReviewGptSendSummary: await readJsonIfPresent(
      options.r1014SendSummaryPath
        ?? path.join(DEFAULT_REVIEWGPT_DIR, "send-r1014-new-data-acceleration-direction-status", "send-summary.json"),
    ),
  };
}

function validateInputs(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1015 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Inputs): Record<ArtifactKey, ArtifactSummary> {
  return {
    r614NshapActivationLabels: summarizeArtifact("r614NshapActivationLabels", inputs.r614NshapActivationLabels),
    r994ExpandedSourceCacheReadiness: summarizeArtifact(
      "r994ExpandedSourceCacheReadiness",
      inputs.r994ExpandedSourceCacheReadiness,
    ),
    r1012CrossSourceFunctionConsistency: summarizeArtifact(
      "r1012CrossSourceFunctionConsistency",
      inputs.r1012CrossSourceFunctionConsistency,
    ),
    r1013BiomarkerShadowLayerState: summarizeArtifact(
      "r1013BiomarkerShadowLayerState",
      inputs.r1013BiomarkerShadowLayerState,
    ),
    r1014ReviewGptReduction: summarizeArtifact("r1014ReviewGptReduction", inputs.r1014ReviewGptReduction),
    r1014ReviewGptSendSummary: summarizeArtifact("r1014ReviewGptSendSummary", inputs.r1014ReviewGptSendSummary),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  const root = optionalRecord(value);
  return {
    artifact,
    packetId: readStringAt(root, ["packetId"]) ?? readStringAt(root, ["packet_id"]) ?? null,
    schemaVersion: readStringAt(root, ["schemaVersion"]) ?? readStringAt(root, ["schema_version"]) ?? null,
    status: root ? "available" : "missing",
  };
}

function readBooleanAt(value: unknown | null, keys: string[]): boolean | null {
  const current = readAt(value, keys);
  return typeof current === "boolean" ? current : null;
}

function readNumberAt(value: unknown | null, keys: string[]): number | null {
  const current = readAt(value, keys);
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  const current = readAt(value, keys);
  return typeof current === "string" && current.length > 0 ? current : null;
}

function readStringArrayRecordAt(value: unknown | null, keys: string[]): Record<string, string[]> {
  const record = optionalRecord(readAt(value, keys));
  if (!record) return {};
  return Object.fromEntries(Object.entries(record)
    .map(([key, value]) => [key, Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []])
    .filter(([, value]) => value.length > 0));
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

function findForbiddenR1015Output(output: R1015NewDataAccelerationStateOutput): string[] {
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
  const { output } = await runR1015NewDataAccelerationState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r614NshapPath: process.env.MURPH_AGE_R614_NSHAP_ACTIVATION_LABELS_PATH,
    r994Path: process.env.MURPH_AGE_R994_SOURCE_CACHE_READINESS_PATH,
    r1012Path: process.env.MURPH_AGE_R1012_CROSS_SOURCE_FUNCTION_PATH,
    r1013Path: process.env.MURPH_AGE_R1013_BIOMARKER_SHADOW_STATE_PATH,
    r1014ReductionPath: process.env.MURPH_AGE_R1014_REVIEWGPT_REDUCTION_PATH,
    r1014SendSummaryPath: process.env.MURPH_AGE_R1014_REVIEWGPT_SEND_SUMMARY_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    fastestCachedLane: output.newDataAcceleration.fastestCachedLane,
    functionLeadSupported: output.newDataAcceleration.functionLeadSupported,
    nextLocalAction: output.summary.nextLocalAction,
    nshapActionStatus: output.nextBatch[0]?.status,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptDirectionConsensus: output.newDataAcceleration.reviewGptDirectionConsensus,
    reviewGptDirectionChorusSent: output.newDataAcceleration.reviewGptDirectionChorusSent,
    reviewGptTrustedReviewerCount: output.newDataAcceleration.reviewGptTrustedReviewerCount,
    rowParsingPerformedByR1015: output.summary.rowParsingPerformedByR1015,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1015 new data acceleration state failed."}\n`);
    process.exit(1);
  });
}
