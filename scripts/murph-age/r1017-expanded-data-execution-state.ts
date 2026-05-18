import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1017_EXPANDED_DATA_EXECUTION_STATE_SCHEMA_VERSION =
  "murph-age-r1017-expanded-data-execution-state.v1" as const;

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
const OUTPUT_FILE_NAME = "r1017-expanded-data-execution-state.latest.json";

type ArtifactKey =
  | "r399LayeringReadiness"
  | "r614NshapActivationLabels"
  | "r1005MhasPanelSourceCard"
  | "r1009MhasFunctionPanelResult"
  | "r1012CrossSourceFunctionConsistency"
  | "r1015NewDataAccelerationState"
  | "r1016ReviewGptReduction";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface Inputs {
  r399LayeringReadiness: unknown | null;
  r614NshapActivationLabels: unknown | null;
  r1005MhasPanelSourceCard: unknown | null;
  r1009MhasFunctionPanelResult: unknown | null;
  r1012CrossSourceFunctionConsistency: unknown | null;
  r1015NewDataAccelerationState: unknown | null;
  r1016ReviewGptReduction: unknown | null;
}

export interface R1017ExpandedDataExecutionStateOptions {
  createdAt?: string;
  outputDir?: string;
  r399Path?: string;
  r614NshapPath?: string;
  r1005Path?: string;
  r1009Path?: string;
  r1012Path?: string;
  r1015Path?: string;
  r1016ReductionPath?: string;
}

export interface R1017ExpandedDataExecutionStateOutput {
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
    rowParsingPerformedByR1017: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  executionState: {
    biomarkerTransportConfirmed: boolean;
    functionLeadSupported: boolean;
    latestReviewGptDecision: string | null;
    latestReviewGptFirstLoop: string | null;
    latestReviewGptTrustedCount: number | null;
    mhasFunctionBatchState:
      | "complete_supportive_research_only"
      | "incomplete_or_not_supportive";
    nhanesRole: "feature_contracts_same_family_sanity_only";
    nshapAggregateOutputsActive: boolean;
    nshapFreshHarnessState:
      | "blocked_source_confirmation"
      | "ready_after_confirmation_no_scoring";
    nshapSourceRightsLabelsComplete: boolean;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    wearableIncrementValidated: boolean;
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextBatch: Array<{
    actionId:
      | "complete_nshap_source_confirmation"
      | "prepare_nshap_fresh_function_cognition_harness_after_confirmation"
      | "keep_mhas_function_sidecar_as_current_research_lead"
      | "reuse_nhanes_midus_creles_shadow_context_without_retune"
      | "use_reviewgpt_only_after_meaningful_aggregate_delta";
    blockedBy: string[];
    owner: "human_user" | "local_codex" | "reviewgpt";
    priority: "p0" | "p1" | "p2";
    status: "blocked" | "runnable";
    why: string;
  }>;
  packetId: "r1017-expanded-data-execution-state";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  schemaVersion: typeof R1017_EXPANDED_DATA_EXECUTION_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "mhas_function_batch_done_nshap_confirmation_blocks_fresh_falsification"
      | "execution_state_incomplete_recover_inputs";
    nextLocalAction:
      | "prepare_nshap_harness_only_after_source_confirmation"
      | "recover_execution_state_inputs";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1017: false;
  };
}

export async function runR1017ExpandedDataExecutionState(
  options: R1017ExpandedDataExecutionStateOptions = {},
): Promise<{ output: R1017ExpandedDataExecutionStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const latestReviewGptTrustedCount = readNumberAt(inputs.r1016ReviewGptReduction, ["counts", "trusted"]);
  const latestReviewGptDecision = readStringAt(inputs.r1016ReviewGptReduction, ["consensus", "decision"]);
  const latestReviewGptFirstLoop = readStringAt(inputs.r1016ReviewGptReduction, ["consensus", "first_loop"]);
  const mhasSourceCardReady =
    readStringAt(inputs.r1005MhasPanelSourceCard, ["summary", "conclusion"])
      === "mhas_panel_source_card_ready_research_only";
  const mhasFunctionSupportive =
    readStringAt(inputs.r1009MhasFunctionPanelResult, ["summary", "conclusion"])
      === "mhas_function_panel_extension_supports_lead_sidecar";
  const functionLeadSupported =
    readStringAt(inputs.r1012CrossSourceFunctionConsistency, ["summary", "conclusion"])
      === "function_disability_lead_sidecar_supported_pending_fresh_nshap";
  const nshapSourceRightsLabelsComplete =
    readBooleanAt(inputs.r614NshapActivationLabels, ["summary", "sourceRightsLabelsComplete"]) === true;
  const nshapAggregateOutputsActive =
    readBooleanAt(inputs.r614NshapActivationLabels, ["summary", "aggregateOutputsActive"]) === true;
  const biomarkerTransportConfirmed =
    readStringAt(inputs.r399LayeringReadiness, [
      "gates",
      "biomarkerTransportConfirmed",
      "status",
    ]) === "passed";
  const wearableIncrementValidated =
    readStringAt(inputs.r399LayeringReadiness, [
      "gates",
      "wearableIncrementValidated",
      "status",
    ]) === "passed";
  const r1015Conclusion = readStringAt(inputs.r1015NewDataAccelerationState, ["summary", "conclusion"]);
  const mhasFunctionBatchDone =
    latestReviewGptTrustedCount === 5
    && latestReviewGptDecision === "run_mhas_and_nshap_function_batch"
    && latestReviewGptFirstLoop !== null
    && latestReviewGptFirstLoop.includes("mhas")
    && mhasSourceCardReady
    && mhasFunctionSupportive
    && functionLeadSupported;
  const nshapReadyAfterConfirmation = nshapSourceRightsLabelsComplete && nshapAggregateOutputsActive;
  const executionStateComplete = mhasFunctionBatchDone && r1015Conclusion !== null;
  const conclusion = executionStateComplete
    ? "mhas_function_batch_done_nshap_confirmation_blocks_fresh_falsification"
    : "execution_state_incomplete_recover_inputs";
  const nshapBlockers = nshapReadyAfterConfirmation
    ? []
    : [
      "source_rights_labels_incomplete",
      "aggregate_output_permission_inactive",
      "terms_endpoint_wave_linkage_or_biomarker_overlap_unconfirmed",
    ];

  const output: R1017ExpandedDataExecutionStateOutput = {
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
      rowParsingPerformedByR1017: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    executionState: {
      biomarkerTransportConfirmed,
      functionLeadSupported,
      latestReviewGptDecision,
      latestReviewGptFirstLoop,
      latestReviewGptTrustedCount,
      mhasFunctionBatchState: mhasFunctionBatchDone
        ? "complete_supportive_research_only"
        : "incomplete_or_not_supportive",
      nhanesRole: "feature_contracts_same_family_sanity_only",
      nshapAggregateOutputsActive,
      nshapFreshHarnessState: nshapReadyAfterConfirmation
        ? "ready_after_confirmation_no_scoring"
        : "blocked_source_confirmation",
      nshapSourceRightsLabelsComplete,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      wearableIncrementValidated,
    },
    inputArtifacts: summarizeInputs(inputs),
    nextBatch: [
      {
        actionId: "complete_nshap_source_confirmation",
        blockedBy: nshapBlockers,
        owner: "human_user",
        priority: "p0",
        status: nshapReadyAfterConfirmation ? "runnable" : "blocked",
        why: "Fresh NSHAP function/cognition falsification needs explicit source and aggregate-output confirmation before local row harness work.",
      },
      {
        actionId: "prepare_nshap_fresh_function_cognition_harness_after_confirmation",
        blockedBy: nshapReadyAfterConfirmation ? [] : ["nshap_source_confirmation_missing"],
        owner: "local_codex",
        priority: "p0",
        status: nshapReadyAfterConfirmation ? "runnable" : "blocked",
        why: "R1016 consensus made NSHAP the next decisive falsification lane after MHAS.",
      },
      {
        actionId: "keep_mhas_function_sidecar_as_current_research_lead",
        blockedBy: mhasFunctionBatchDone ? [] : ["mhas_function_support_or_reviewgpt_consensus_missing"],
        owner: "local_codex",
        priority: "p1",
        status: mhasFunctionBatchDone ? "runnable" : "blocked",
        why: "MHAS aggregate evidence supports function/disability as the current research-only diagnostic sidecar.",
      },
      {
        actionId: "reuse_nhanes_midus_creles_shadow_context_without_retune",
        blockedBy: [],
        owner: "local_codex",
        priority: "p1",
        status: "runnable",
        why: "NHANES stays feature-contract/same-family context; MIDUS and CRELES stay biomarker/body shadow evidence until transport improves.",
      },
      {
        actionId: "use_reviewgpt_only_after_meaningful_aggregate_delta",
        blockedBy: [],
        owner: "reviewgpt",
        priority: "p2",
        status: "runnable",
        why: "ReviewGPT should critique major result deltas or architecture forks, not local checklist handoffs.",
      },
    ],
    packetId: "r1017-expanded-data-execution-state",
    productPolicy: {
      displayAuthorized: false,
      productClaimsAuthorized: false,
      promotionAuthorized: false,
    },
    schemaVersion: R1017_EXPANDED_DATA_EXECUTION_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextLocalAction: conclusion === "mhas_function_batch_done_nshap_confirmation_blocks_fresh_falsification"
        ? "prepare_nshap_harness_only_after_source_confirmation"
        : "recover_execution_state_inputs",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1017: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1017Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1017 expanded data execution state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1017ExpandedDataExecutionStateOptions): Promise<Inputs> {
  return {
    r399LayeringReadiness: await readJsonIfPresent(
      options.r399Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r399-layering-readiness.latest.json"),
    ),
    r614NshapActivationLabels: await readJsonIfPresent(
      options.r614NshapPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-nshap-activation-labels.latest.json"),
    ),
    r1005MhasPanelSourceCard: await readJsonIfPresent(
      options.r1005Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1005-mhas-panel-source-card.latest.json"),
    ),
    r1009MhasFunctionPanelResult: await readJsonIfPresent(
      options.r1009Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1009-mhas-function-panel-extension-result.latest.json"),
    ),
    r1012CrossSourceFunctionConsistency: await readJsonIfPresent(
      options.r1012Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1012-cross-source-function-consistency.latest.json"),
    ),
    r1015NewDataAccelerationState: await readJsonIfPresent(
      options.r1015Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1015-new-data-acceleration-state.latest.json"),
    ),
    r1016ReviewGptReduction: await readJsonIfPresent(
      options.r1016ReductionPath
        ?? path.join(DEFAULT_REVIEWGPT_REDUCED_DIR, "r1016-expanded-data-execution-batch-summary.json"),
    ),
  };
}

function validateInputs(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1017 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Inputs): Record<ArtifactKey, ArtifactSummary> {
  return {
    r399LayeringReadiness: summarizeArtifact("r399LayeringReadiness", inputs.r399LayeringReadiness),
    r614NshapActivationLabels: summarizeArtifact(
      "r614NshapActivationLabels",
      inputs.r614NshapActivationLabels,
    ),
    r1005MhasPanelSourceCard: summarizeArtifact("r1005MhasPanelSourceCard", inputs.r1005MhasPanelSourceCard),
    r1009MhasFunctionPanelResult: summarizeArtifact(
      "r1009MhasFunctionPanelResult",
      inputs.r1009MhasFunctionPanelResult,
    ),
    r1012CrossSourceFunctionConsistency: summarizeArtifact(
      "r1012CrossSourceFunctionConsistency",
      inputs.r1012CrossSourceFunctionConsistency,
    ),
    r1015NewDataAccelerationState: summarizeArtifact(
      "r1015NewDataAccelerationState",
      inputs.r1015NewDataAccelerationState,
    ),
    r1016ReviewGptReduction: summarizeArtifact("r1016ReviewGptReduction", inputs.r1016ReviewGptReduction),
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

function findForbiddenR1017Output(output: R1017ExpandedDataExecutionStateOutput): string[] {
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
  const { output } = await runR1017ExpandedDataExecutionState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r399Path: process.env.MURPH_AGE_R399_LAYERING_READINESS_PATH,
    r614NshapPath: process.env.MURPH_AGE_R614_NSHAP_ACTIVATION_LABELS_PATH,
    r1005Path: process.env.MURPH_AGE_R1005_MHAS_SOURCE_CARD_PATH,
    r1009Path: process.env.MURPH_AGE_R1009_MHAS_FUNCTION_RESULT_PATH,
    r1012Path: process.env.MURPH_AGE_R1012_CROSS_SOURCE_FUNCTION_PATH,
    r1015Path: process.env.MURPH_AGE_R1015_NEW_DATA_ACCELERATION_STATE_PATH,
    r1016ReductionPath: process.env.MURPH_AGE_R1016_REVIEWGPT_REDUCTION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    functionLeadSupported: output.executionState.functionLeadSupported,
    latestReviewGptDecision: output.executionState.latestReviewGptDecision,
    latestReviewGptTrustedCount: output.executionState.latestReviewGptTrustedCount,
    mhasFunctionBatchState: output.executionState.mhasFunctionBatchState,
    nextLocalAction: output.summary.nextLocalAction,
    nshapFreshHarnessState: output.executionState.nshapFreshHarnessState,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    rowParsingPerformedByR1017: output.summary.rowParsingPerformedByR1017,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1017 expanded data execution state failed."}\n`);
    process.exit(1);
  });
}
