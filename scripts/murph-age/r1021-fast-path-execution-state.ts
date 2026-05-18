import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1021_FAST_PATH_EXECUTION_STATE_SCHEMA_VERSION =
  "murph-age-r1021-fast-path-execution-state.v1" as const;

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
const OUTPUT_FILE_NAME = "r1021-fast-path-execution-state.latest.json";

type ArtifactKey =
  | "nshapActivationFeasibility"
  | "r614NshapActivationLabels"
  | "r614MhasActivationLabels"
  | "r979MhasEndpointJoinContract"
  | "r980MhasFunctionReducer"
  | "r991MhasDeepDiagnostic"
  | "r1014ReviewGptReduction"
  | "r1016ReviewGptReduction"
  | "r1018ScoreBearingSignal"
  | "r1019ReviewGptReduction"
  | "r1020ModelDirectionState";

interface ArtifactSummary {
  artifact: ArtifactKey;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface Inputs {
  nshapActivationFeasibility: unknown | null;
  r614NshapActivationLabels: unknown | null;
  r614MhasActivationLabels: unknown | null;
  r979MhasEndpointJoinContract: unknown | null;
  r980MhasFunctionReducer: unknown | null;
  r991MhasDeepDiagnostic: unknown | null;
  r1014ReviewGptReduction: unknown | null;
  r1016ReviewGptReduction: unknown | null;
  r1018ScoreBearingSignal: unknown | null;
  r1019ReviewGptReduction: unknown | null;
  r1020ModelDirectionState: unknown | null;
}

export interface R1021FastPathExecutionStateOptions {
  createdAt?: string;
  nshapActivationFeasibilityPath?: string;
  outputDir?: string;
  r614MhasPath?: string;
  r614NshapPath?: string;
  r979Path?: string;
  r980Path?: string;
  r991Path?: string;
  r1014ReductionPath?: string;
  r1016ReductionPath?: string;
  r1018Path?: string;
  r1019ReductionPath?: string;
  r1020Path?: string;
}

export interface R1021FastPathExecutionStateOutput {
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
    rowParsingPerformedByR1021: false;
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
    broadLabsPolicy: "hold";
    compactGlycemiaPolicy: "shadow_only";
    functionDisabilityPolicy: "lead_diagnostic_research";
    mhasFastPathState:
      | "refreshed_supportive_research_only"
      | "blocked_or_not_supportive";
    nextExecutableLocalLoop:
      | "bounded_nshap_function_cognition_after_activation"
      | "mhas_function_receipts_refreshed_waiting_on_nshap_activation"
      | "recover_missing_fast_path_inputs";
    nshapState:
      | "metadata_ready_activation_labels_block_rows"
      | "activation_labels_complete_harness_design_ready_no_scoring"
      | "metadata_incomplete_or_missing";
    productDisplayAuthorized: false;
    reviewGptOperatingMode: "big_science_architecture_only";
    wearablePolicy: "hold_shadow_only";
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextActions: Array<{
    actionId:
      | "keep_mhas_function_receipts_fresh"
      | "complete_nshap_activation_labels"
      | "build_bounded_nshap_function_cognition_harness_after_activation"
      | "carry_compact_glycemia_shadow"
      | "hold_broad_labs_and_wearables"
      | "send_reviewgpt_only_after_fresh_aggregate_delta";
    blockedBy: string[];
    owner: "human_user" | "local_codex" | "reviewgpt";
    status: "blocked" | "completed" | "held" | "runnable";
    why: string;
  }>;
  packetId: "r1021-fast-path-execution-state";
  reviewGptConsensus: {
    r1014Decision: string | null;
    r1014TrustedCount: number | null;
    r1016Decision: string | null;
    r1016FirstLoop: string | null;
    r1016TrustedCount: number | null;
    r1019Decision: string | null;
    r1019NextLoop: string | null;
    r1019TrustedCount: number | null;
  };
  schemaVersion: typeof R1021_FAST_PATH_EXECUTION_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "mhas_refreshed_nshap_activation_next"
      | "fast_path_inputs_missing_or_not_supportive";
    nextLocalAction:
      | "build_bounded_nshap_harness_after_activation_else_keep_mhas_receipts_fresh"
      | "recover_fast_path_inputs";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1021: false;
  };
}

export async function runR1021FastPathExecutionState(
  options: R1021FastPathExecutionStateOptions = {},
): Promise<{ output: R1021FastPathExecutionStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const r1014Trusted = readNumberAt(inputs.r1014ReviewGptReduction, ["counts", "trusted"]);
  const r1016Trusted = readNumberAt(inputs.r1016ReviewGptReduction, ["counts", "trusted"]);
  const r1019Trusted = readNumberAt(inputs.r1019ReviewGptReduction, ["counts", "trusted"]);
  const r1014Decision = readStringAt(inputs.r1014ReviewGptReduction, ["consensus", "decision"]);
  const r1016Decision = readStringAt(inputs.r1016ReviewGptReduction, ["consensus", "decision"]);
  const r1016FirstLoop = readStringAt(inputs.r1016ReviewGptReduction, ["consensus", "first_loop"]);
  const r1019Decision = readStringAt(inputs.r1019ReviewGptReduction, ["consensus", "decision"]);
  const r1019NextLoop = readStringAt(inputs.r1019ReviewGptReduction, ["consensus", "next_loop"]);

  const reviewGptConsensusReady =
    r1014Trusted === 5
    && r1014Decision === "mhas_plus_nshap_parallel"
    && r1016Trusted === 5
    && r1016Decision === "run_mhas_and_nshap_function_batch"
    && r1019Trusted === 3
    && r1019Decision === "keep_function_lead_glycemia_shadow";
  const mhasSupportive =
    readStringAt(inputs.r614MhasActivationLabels, ["summary", "conclusion"])
      === "mhas_activation_labels_and_contract_metadata_ready_no_execution"
    && readStringAt(inputs.r979MhasEndpointJoinContract, ["summary", "conclusion"])
      === "mhas_endpoint_join_contract_locked_next_reducer_ready"
    && readStringAt(inputs.r980MhasFunctionReducer, ["summary", "conclusion"])
      === "mhas_function_disability_supportive_diagnostic_only"
    && readStringAt(inputs.r991MhasDeepDiagnostic, ["summary", "verdict"])
      === "function_disability_survives_age_residualized_deep_diagnostic";
  const nshapMetadataReady =
    readStringAt(inputs.nshapActivationFeasibility, ["noScoreReadiness", "conclusion"])
      === "nshap_metadata_ready_for_activation_design";
  const nshapLabelsComplete =
    readBooleanAt(inputs.r614NshapActivationLabels, ["summary", "sourceRightsLabelsComplete"]) === true
    && readBooleanAt(inputs.r614NshapActivationLabels, ["summary", "aggregateOutputsActive"]) === true;
  const scoreBearingSignalReady =
    readStringAt(inputs.r1018ScoreBearingSignal, ["summary", "conclusion"])
      === "function_lead_glycemia_shadow_broad_labs_hold"
    && readStringAt(inputs.r1020ModelDirectionState, ["summary", "conclusion"])
      === "reviewgpt_confirms_function_lead_glycemia_shadow";
  const fastPathReady = reviewGptConsensusReady && mhasSupportive && nshapMetadataReady && scoreBearingSignalReady;
  const nshapState = nshapLabelsComplete
    ? "activation_labels_complete_harness_design_ready_no_scoring"
    : nshapMetadataReady
      ? "metadata_ready_activation_labels_block_rows"
      : "metadata_incomplete_or_missing";
  const nextExecutableLocalLoop = fastPathReady
    ? nshapLabelsComplete
      ? "bounded_nshap_function_cognition_after_activation"
      : "mhas_function_receipts_refreshed_waiting_on_nshap_activation"
    : "recover_missing_fast_path_inputs";
  const conclusion = fastPathReady
    ? "mhas_refreshed_nshap_activation_next"
    : "fast_path_inputs_missing_or_not_supportive";

  const output: R1021FastPathExecutionStateOutput = {
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
      rowParsingPerformedByR1021: false,
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
      broadLabsPolicy: "hold",
      compactGlycemiaPolicy: "shadow_only",
      functionDisabilityPolicy: "lead_diagnostic_research",
      mhasFastPathState: mhasSupportive
        ? "refreshed_supportive_research_only"
        : "blocked_or_not_supportive",
      nextExecutableLocalLoop,
      nshapState,
      productDisplayAuthorized: false,
      reviewGptOperatingMode: "big_science_architecture_only",
      wearablePolicy: "hold_shadow_only",
    },
    inputArtifacts: summarizeInputs(inputs),
    nextActions: [
      {
        actionId: "keep_mhas_function_receipts_fresh",
        blockedBy: mhasSupportive ? [] : ["mhas_supportive_receipts_missing_or_failed"],
        owner: "local_codex",
        status: mhasSupportive ? "completed" : "blocked",
        why: "MHAS is the current executable fallback while NSHAP activation is incomplete.",
      },
      {
        actionId: "complete_nshap_activation_labels",
        blockedBy: nshapLabelsComplete ? [] : ["nshap_activation_labels_missing"],
        owner: "human_user",
        status: nshapLabelsComplete ? "completed" : "blocked",
        why: "NSHAP is the highest-value fresh falsification source for function/cognition.",
      },
      {
        actionId: "build_bounded_nshap_function_cognition_harness_after_activation",
        blockedBy: nshapLabelsComplete ? [] : ["nshap_activation_labels_missing"],
        owner: "local_codex",
        status: nshapLabelsComplete ? "runnable" : "blocked",
        why: "The bounded harness should test function/disability lead and cognition shadow only.",
      },
      {
        actionId: "carry_compact_glycemia_shadow",
        blockedBy: [],
        owner: "local_codex",
        status: scoreBearingSignalReady ? "runnable" : "held",
        why: "Compact glycemia remains shadow context, not a score-bearing product increment.",
      },
      {
        actionId: "hold_broad_labs_and_wearables",
        blockedBy: [],
        owner: "local_codex",
        status: "held",
        why: "ReviewGPT consensus holds broad labs and wearables until transport evidence changes.",
      },
      {
        actionId: "send_reviewgpt_only_after_fresh_aggregate_delta",
        blockedBy: [],
        owner: "reviewgpt",
        status: "held",
        why: "ReviewGPT should see new aggregate deltas or architecture-changing contradictions, not local chores.",
      },
    ],
    packetId: "r1021-fast-path-execution-state",
    reviewGptConsensus: {
      r1014Decision,
      r1014TrustedCount: r1014Trusted,
      r1016Decision,
      r1016FirstLoop,
      r1016TrustedCount: r1016Trusted,
      r1019Decision,
      r1019NextLoop,
      r1019TrustedCount: r1019Trusted,
    },
    schemaVersion: R1021_FAST_PATH_EXECUTION_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextLocalAction: fastPathReady
        ? "build_bounded_nshap_harness_after_activation_else_keep_mhas_receipts_fresh"
        : "recover_fast_path_inputs",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1021: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1021Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1021 fast-path execution state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1021FastPathExecutionStateOptions): Promise<Inputs> {
  return {
    nshapActivationFeasibility: await readJsonIfPresent(
      options.nshapActivationFeasibilityPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "nshap-activation-feasibility.latest.json"),
    ),
    r614NshapActivationLabels: await readJsonIfPresent(
      options.r614NshapPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-nshap-activation-labels.latest.json"),
    ),
    r614MhasActivationLabels: await readJsonIfPresent(
      options.r614MhasPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-mhas-source-rights-activation-labels.latest.json"),
    ),
    r979MhasEndpointJoinContract: await readJsonIfPresent(
      options.r979Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r979-mhas-endpoint-join-contract.latest.json"),
    ),
    r980MhasFunctionReducer: await readJsonIfPresent(
      options.r980Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r980-mhas-function-disability-aggregate-reducer.latest.json"),
    ),
    r991MhasDeepDiagnostic: await readJsonIfPresent(
      options.r991Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r991-mhas-deep-diagnostic-reducer.latest.json"),
    ),
    r1014ReviewGptReduction: await readJsonIfPresent(
      options.r1014ReductionPath ?? path.join(DEFAULT_REVIEWGPT_REDUCED_DIR, "r1014-new-data-acceleration-direction-summary.json"),
    ),
    r1016ReviewGptReduction: await readJsonIfPresent(
      options.r1016ReductionPath ?? path.join(DEFAULT_REVIEWGPT_REDUCED_DIR, "r1016-expanded-data-execution-batch-summary.json"),
    ),
    r1018ScoreBearingSignal: await readJsonIfPresent(
      options.r1018Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1018-score-bearing-model-signal-receipt.latest.json"),
    ),
    r1019ReviewGptReduction: await readJsonIfPresent(
      options.r1019ReductionPath ?? path.join(DEFAULT_REVIEWGPT_REDUCED_DIR, "r1019-score-bearing-model-direction-summary.json"),
    ),
    r1020ModelDirectionState: await readJsonIfPresent(
      options.r1020Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1020-reviewgpt-model-direction-state.latest.json"),
    ),
  };
}

function validateInputs(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1021 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Inputs): Record<ArtifactKey, ArtifactSummary> {
  return Object.fromEntries(Object.entries(inputs).map(([artifact, value]) => [
    artifact,
    {
      artifact,
      packetId: readStringAt(value, ["packetId"]),
      schemaVersion: readStringAt(value, ["schemaVersion"]) ?? readStringAt(value, ["schema_version"]),
      status: value ? "available" : "missing",
    },
  ])) as Record<ArtifactKey, ArtifactSummary>;
}

function findForbiddenR1021Output(output: R1021FastPathExecutionStateOutput): string[] {
  const encoded = JSON.stringify(output);
  const findings: string[] = [];
  if (/Downloads|external-sources|cache-entry|\.dta|\.zip|\.rar|\.pdf|latest\.json|ICPSR_/u.test(encoded)) {
    findings.push("local_source_file_or_cache_text_present");
  }
  if (/[A-Za-z]:[\\/]|(?:^|["\s])\/(?:Users|home|tmp|var)\//u.test(encoded)) {
    findings.push("path_like_local_text_present");
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

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const valueAtPath = readAtPath(value, pathParts);
  return typeof valueAtPath === "string" && valueAtPath.length > 0 ? valueAtPath : null;
}

function readNumberAt(value: unknown, pathParts: readonly string[]): number | null {
  const valueAtPath = readAtPath(value, pathParts);
  return typeof valueAtPath === "number" && Number.isFinite(valueAtPath) ? valueAtPath : null;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const valueAtPath = readAtPath(value, pathParts);
  return typeof valueAtPath === "boolean" ? valueAtPath : null;
}

function readAtPath(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1021FastPathExecutionState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output }) => {
    const cliSummary = toCliSummary(output);
    console.log(JSON.stringify(cliSummary, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R1021 fast-path execution state failed.");
    process.exitCode = 1;
  });
}

function toCliSummary(value: R1021FastPathExecutionStateOutput): Record<string, unknown> {
  return {
    conclusion: value.summary.conclusion,
    mhasFastPathState: value.executionState.mhasFastPathState,
    nextExecutableLocalLoop: value.executionState.nextExecutableLocalLoop,
    nextLocalAction: value.summary.nextLocalAction,
    nshapState: value.executionState.nshapState,
    packetId: value.packetId,
    productDisplayAuthorized: value.summary.productDisplayAuthorized,
    rowParsingPerformedByR1021: value.summary.rowParsingPerformedByR1021,
    schemaVersion: value.schemaVersion,
    status: value.status,
  };
}
