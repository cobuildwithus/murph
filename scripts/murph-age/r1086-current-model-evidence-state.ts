import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1086_CURRENT_MODEL_EVIDENCE_STATE_SCHEMA_VERSION =
  "murph-age-r1086-current-model-evidence-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1086-current-model-evidence-state.latest.json";

type ArtifactKey =
  | "r1057FunctionActivityPulseBatch"
  | "r1074TrueWearableRefresh"
  | "r1084HaalsiFunctionAdjudication"
  | "r1047BiomarkerEvidenceState"
  | "r986CrossSourceFunctionArbitration"
  | "r988MhasAnchorFunctionIncrement"
  | "r994ExpandedSourceCacheReadiness";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

type FunctionLeadStatus =
  | "lead_supported_with_missingness_caveat"
  | "candidate_supported_but_not_converged"
  | "hold_or_missing";
type GlycemiaStatus = "shadow_mixed_transport" | "not_current_shadow";
type TrueWearableStatus =
  | "blocked_on_source_ready_data"
  | "aggregate_delta_ready_for_review"
  | "local_receipt_fill_ready"
  | "unknown_or_missing";

export interface R1086CurrentModelEvidenceStateOptions {
  createdAt?: string;
  outputDir?: string;
  r1047Path?: string;
  r1057Path?: string;
  r1074Path?: string;
  r1084Path?: string;
  r986Path?: string;
  r988Path?: string;
  r994Path?: string;
}

export interface R1086CurrentModelEvidenceStateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1086: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1086: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  evidenceState: {
    functionDisability: {
      caveats: string[];
      status: FunctionLeadStatus;
      supportingSignals: string[];
    };
    glycemiaLabs: {
      status: GlycemiaStatus;
      role: "secondary_shadow_only" | "not_active";
    };
    trueWearable: {
      status: TrueWearableStatus;
      blocker: string | null;
    };
    sourceReadiness: {
      fastestLaneNow: string | null;
      scoreBearingCompleteCountBand: string | null;
      verdict: string | null;
    };
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  modelArchitecture: {
    anchor: "frozen_nhis_outcome_risk_anchor";
    biomarkerLayer: "shadow_only_until_external_transport_clears";
    functionLayer: "lead_research_sidecar_not_product_claim";
    integrationPolicy: "sidecar_increment_then_external_validation_before_age_display";
    trueWearableLayer: "blocked_until_real_sleep_autonomic_or_partner_aggregate_delta";
  };
  nextLoop: {
    immediateLocalAction:
      | "run_downloaded_function_biomarker_source_feasibility"
      | "repair_or_refresh_direction_chain"
      | "send_true_wearable_delta_to_reviewgpt"
      | "fill_true_wearable_aggregate_receipt";
    rationale: string;
    reviewGptUse: "only_after_eragon_strategy_or_fresh_aggregate_delta";
  };
  packetId: "r1086-current-model-evidence-state";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1086_CURRENT_MODEL_EVIDENCE_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "function_disability_lead_research_sidecar_ready_for_fresh_source_feasibility"
      | "direction_chain_needs_repair"
      | "true_wearable_delta_ready_for_scientific_review"
      | "true_wearable_receipt_fill_ready";
    functionLeadStatus: FunctionLeadStatus;
    glycemiaStatus: GlycemiaStatus;
    productDisplayAuthorized: false;
    rowParsingPerformedByR1086: false;
    trueWearableStatus: TrueWearableStatus;
  };
}

export async function runR1086CurrentModelEvidenceState(
  options: R1086CurrentModelEvidenceStateOptions = {},
): Promise<{ output: R1086CurrentModelEvidenceStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const functionDisability = summarizeFunctionDisability(inputs);
  const glycemiaLabs = summarizeGlycemia(inputs);
  const trueWearable = summarizeTrueWearable(inputs);
  const sourceReadiness = summarizeSourceReadiness(inputs);
  const nextLoop = chooseNextLoop(functionDisability.status, trueWearable.status);
  const output: R1086CurrentModelEvidenceStateOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    evidenceState: {
      functionDisability,
      glycemiaLabs,
      trueWearable,
      sourceReadiness,
    },
    inputArtifacts: summarizeInputs(inputs),
    modelArchitecture: {
      anchor: "frozen_nhis_outcome_risk_anchor",
      biomarkerLayer: "shadow_only_until_external_transport_clears",
      functionLayer: "lead_research_sidecar_not_product_claim",
      integrationPolicy: "sidecar_increment_then_external_validation_before_age_display",
      trueWearableLayer: "blocked_until_real_sleep_autonomic_or_partner_aggregate_delta",
    },
    nextLoop,
    packetId: "r1086-current-model-evidence-state",
    productDisplayAuthorized: false,
    schemaVersion: R1086_CURRENT_MODEL_EVIDENCE_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: conclusionFor(nextLoop.immediateLocalAction),
      functionLeadStatus: functionDisability.status,
      glycemiaStatus: glycemiaLabs.status,
      productDisplayAuthorized: false,
      rowParsingPerformedByR1086: false,
      trueWearableStatus: trueWearable.status,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1086 current model evidence state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R1086CurrentModelEvidenceStateOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    r1057FunctionActivityPulseBatch: await readJsonIfPresent(
      options.r1057Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1057-function-activity-pulse-candidate-batch-result.latest.json"),
    ),
    r1074TrueWearableRefresh: await readJsonIfPresent(
      options.r1074Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1074-true-wearable-post-download-refresh.latest.json"),
    ),
    r1084HaalsiFunctionAdjudication: await readJsonIfPresent(
      options.r1084Path
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1084-haalsi-function-missingness-calibration-adjudication.latest.json"),
    ),
    r1047BiomarkerEvidenceState: await readJsonIfPresent(
      options.r1047Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1047-biomarker-evidence-state.latest.json"),
    ),
    r986CrossSourceFunctionArbitration: await readJsonIfPresent(
      options.r986Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r986-cross-source-function-arbitration.latest.json"),
    ),
    r988MhasAnchorFunctionIncrement: await readJsonIfPresent(
      options.r988Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r988-mhas-anchor-function-increment-check.latest.json"),
    ),
    r994ExpandedSourceCacheReadiness: await readJsonIfPresent(
      options.r994Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r994-expanded-source-cache-readiness.latest.json"),
    ),
  };
}

function summarizeFunctionDisability(
  inputs: Record<ArtifactKey, unknown | null>,
): R1086CurrentModelEvidenceStateOutput["evidenceState"]["functionDisability"] {
  const signals: string[] = [];
  if (readStringAt(inputs.r1057FunctionActivityPulseBatch, ["batchResult", "conclusion"]) === "function_activity_pulse_batch_supports_function_mobility_lead") {
    signals.push("function_activity_batch_supports_mobility_lead");
  }
  if (readStringAt(inputs.r986CrossSourceFunctionArbitration, ["summary", "verdict"]) === "function_disability_portable_diagnostic_sidecar_supported") {
    signals.push("cross_source_arbitration_supports_function_disability");
  }
  if (readStringAt(inputs.r988MhasAnchorFunctionIncrement, ["summary", "verdict"]) === "mhas_function_adds_small_increment_over_frozen_anchor") {
    signals.push("mhas_adds_increment_over_frozen_anchor");
  }
  if (readStringAt(inputs.r1084HaalsiFunctionAdjudication, ["summary", "conclusion"]) === "haalsi_function_adjudication_supportive_with_missingness_caveat") {
    signals.push("haalsi_function_beats_missingness_control_with_caveat");
  }

  const caveats = signals.length > 0
    ? ["research_only", "missingness_quality_signal_present", "needs_fresh_source_or_true_wearable_validation"]
    : ["insufficient_current_aggregate_support"];
  const status = signals.length >= 4
    ? "lead_supported_with_missingness_caveat"
    : signals.length >= 2
      ? "candidate_supported_but_not_converged"
      : "hold_or_missing";

  return {
    caveats,
    status,
    supportingSignals: signals,
  };
}

function summarizeGlycemia(
  inputs: Record<ArtifactKey, unknown | null>,
): R1086CurrentModelEvidenceStateOutput["evidenceState"]["glycemiaLabs"] {
  const currentBloodworkLead = readStringAt(inputs.r1047BiomarkerEvidenceState, ["summary", "currentBloodworkLead"]);
  if (currentBloodworkLead === "glucose_hba1c_research_candidate") {
    return {
      role: "secondary_shadow_only",
      status: "shadow_mixed_transport",
    };
  }
  return {
    role: "not_active",
    status: "not_current_shadow",
  };
}

function summarizeTrueWearable(
  inputs: Record<ArtifactKey, unknown | null>,
): R1086CurrentModelEvidenceStateOutput["evidenceState"]["trueWearable"] {
  const nextAction = readStringAt(inputs.r1074TrueWearableRefresh, ["finalHandoff", "nextAction"]);
  if (nextAction === "send_nsrr_delta_to_reviewgpt" || nextAction === "send_true_wearable_delta_to_reviewgpt") {
    return {
      blocker: null,
      status: "aggregate_delta_ready_for_review",
    };
  }
  if (nextAction === "fill_nsrr_aggregate_receipt") {
    return {
      blocker: null,
      status: "local_receipt_fill_ready",
    };
  }
  if (nextAction === "download_nsrr_derived_files_or_secure_workbench_access") {
    return {
      blocker: "source_ready_true_wearable_or_sleep_autonomic_data_missing",
      status: "blocked_on_source_ready_data",
    };
  }
  return {
    blocker: "true_wearable_refresh_missing_or_stale",
    status: "unknown_or_missing",
  };
}

function summarizeSourceReadiness(
  inputs: Record<ArtifactKey, unknown | null>,
): R1086CurrentModelEvidenceStateOutput["evidenceState"]["sourceReadiness"] {
  return {
    fastestLaneNow: readStringAt(inputs.r994ExpandedSourceCacheReadiness, ["summary", "fastestLaneNow"]),
    scoreBearingCompleteCountBand: readStringAt(
      inputs.r994ExpandedSourceCacheReadiness,
      ["summary", "scoreBearingCompleteCountBand"],
    ),
    verdict: readStringAt(inputs.r994ExpandedSourceCacheReadiness, ["summary", "sourcePriorityVerdict"]),
  };
}

function chooseNextLoop(
  functionLeadStatus: FunctionLeadStatus,
  trueWearableStatus: TrueWearableStatus,
): R1086CurrentModelEvidenceStateOutput["nextLoop"] {
  if (trueWearableStatus === "aggregate_delta_ready_for_review") {
    return {
      immediateLocalAction: "send_true_wearable_delta_to_reviewgpt",
      rationale: "A true wearable or sleep-autonomic aggregate delta is ready; this is a high-value scientific interpretation point.",
      reviewGptUse: "only_after_eragon_strategy_or_fresh_aggregate_delta",
    };
  }
  if (trueWearableStatus === "local_receipt_fill_ready") {
    return {
      immediateLocalAction: "fill_true_wearable_aggregate_receipt",
      rationale: "The true wearable lane has enough local evidence for aggregate receipt fill before any scientific review.",
      reviewGptUse: "only_after_eragon_strategy_or_fresh_aggregate_delta",
    };
  }
  if (functionLeadStatus === "lead_supported_with_missingness_caveat") {
    return {
      immediateLocalAction: "run_downloaded_function_biomarker_source_feasibility",
      rationale: "Function/disability is the strongest current research sidecar, but it needs fresh-source feasibility or true wearable validation instead of more same-source search.",
      reviewGptUse: "only_after_eragon_strategy_or_fresh_aggregate_delta",
    };
  }
  return {
    immediateLocalAction: "repair_or_refresh_direction_chain",
    rationale: "The current aggregate receipts do not converge enough to keep the function sidecar as lead.",
    reviewGptUse: "only_after_eragon_strategy_or_fresh_aggregate_delta",
  };
}

function conclusionFor(
  action: R1086CurrentModelEvidenceStateOutput["nextLoop"]["immediateLocalAction"],
): R1086CurrentModelEvidenceStateOutput["summary"]["conclusion"] {
  if (action === "send_true_wearable_delta_to_reviewgpt") return "true_wearable_delta_ready_for_scientific_review";
  if (action === "fill_true_wearable_aggregate_receipt") return "true_wearable_receipt_fill_ready";
  if (action === "run_downloaded_function_biomarker_source_feasibility") {
    return "function_disability_lead_research_sidecar_ready_for_fresh_source_feasibility";
  }
  return "direction_chain_needs_repair";
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    r1057FunctionActivityPulseBatch: summarizeArtifact(
      "r1057-function-activity-pulse-candidate-batch-result",
      inputs.r1057FunctionActivityPulseBatch,
    ),
    r1074TrueWearableRefresh: summarizeArtifact(
      "r1074-true-wearable-post-download-refresh",
      inputs.r1074TrueWearableRefresh,
    ),
    r1084HaalsiFunctionAdjudication: summarizeArtifact(
      "r1084-haalsi-function-missingness-calibration-adjudication",
      inputs.r1084HaalsiFunctionAdjudication,
    ),
    r1047BiomarkerEvidenceState: summarizeArtifact(
      "r1047-biomarker-evidence-state",
      inputs.r1047BiomarkerEvidenceState,
    ),
    r986CrossSourceFunctionArbitration: summarizeArtifact(
      "r986-cross-source-function-arbitration",
      inputs.r986CrossSourceFunctionArbitration,
    ),
    r988MhasAnchorFunctionIncrement: summarizeArtifact(
      "r988-mhas-anchor-function-increment-check",
      inputs.r988MhasAnchorFunctionIncrement,
    ),
    r994ExpandedSourceCacheReadiness: summarizeArtifact(
      "r994-expanded-source-cache-readiness",
      inputs.r994ExpandedSourceCacheReadiness,
    ),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
}

function validateInputBoundaries(inputs: Record<string, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1086 input ${key} failed aggregate-egress validation: ${findings.join("; ")}`);
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const current = readAt(value, pathParts);
  return typeof current === "string" ? current : null;
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function safeBoundary(): R1086CurrentModelEvidenceStateOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1086: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1086: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    variableNamesStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1086CurrentModelEvidenceState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1047Path: process.env.MURPH_AGE_R1047_BIOMARKER_EVIDENCE_PATH,
    r1057Path: process.env.MURPH_AGE_R1057_FUNCTION_ACTIVITY_BATCH_RESULT_PATH,
    r1074Path: process.env.MURPH_AGE_R1074_TRUE_WEARABLE_REFRESH_PATH,
    r1084Path: process.env.MURPH_AGE_R1084_HAALSI_FUNCTION_ADJUDICATION_PATH,
    r986Path: process.env.MURPH_AGE_R986_FUNCTION_ARBITRATION_PATH,
    r988Path: process.env.MURPH_AGE_R988_MHAS_INCREMENT_PATH,
    r994Path: process.env.MURPH_AGE_R994_SOURCE_READINESS_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    functionLeadStatus: output.summary.functionLeadStatus,
    immediateLocalAction: output.nextLoop.immediateLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    rowParsingPerformedByR1086: output.summary.rowParsingPerformedByR1086,
    schemaVersion: output.schemaVersion,
    status: output.status,
    trueWearableStatus: output.summary.trueWearableStatus,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1086 current model evidence state failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
