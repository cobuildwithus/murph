import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1023_FUNCTION_TRANSPORT_CANDIDATE_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1023-function-transport-candidate-manifest.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1023-function-transport-candidate-manifest.latest.json";

type ArtifactKey =
  | "r1009MhasFunctionResult"
  | "r1011MhasDomainAttribution"
  | "r1013BiomarkerShadowState"
  | "r1021FastPathState"
  | "r1022NshapBoundedHarnessState";

interface ArtifactSummary {
  artifact: ArtifactKey;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface Inputs {
  r1009MhasFunctionResult: unknown | null;
  r1011MhasDomainAttribution: unknown | null;
  r1013BiomarkerShadowState: unknown | null;
  r1021FastPathState: unknown | null;
  r1022NshapBoundedHarnessState: unknown | null;
}

export interface R1023FunctionTransportCandidateManifestOptions {
  createdAt?: string;
  outputDir?: string;
  r1009Path?: string;
  r1011Path?: string;
  r1013Path?: string;
  r1021Path?: string;
  r1022Path?: string;
}

export interface R1023FunctionTransportCandidateManifestOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1023: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  batch: {
    activationRequired: true;
    allowedExecution: Array<"locked_local_evaluator" | "aggregate_only_export">;
    batchId: "function_transport_v1";
    blockedExecution: string[];
    candidateLimit: 3;
    candidates: Array<{
      candidateId:
        | "anchor_same_denominator_reference"
        | "function_disability_lead"
        | "cognition_shadow_after_function";
      requires: string | null;
      role: "reference" | "lead_diagnostic" | "shadow";
      status:
        | "ready_reference"
        | "queued_after_activation"
        | "ready_after_activation"
        | "held_after_function";
    }>;
    hypothesis: string;
    hypothesisSource: "reviewgpt_direction_plus_mhas_aggregate_support";
    sourceLane: "mhas_pre_nshap_nshap_post_activation";
  };
  createdAt: string;
  decisionRules: {
    discard: string[];
    keep: string[];
    sendToReviewGpt: string[];
  };
  evaluator: {
    calibrationPolicy: "predeclared_only";
    diagnostics: string[];
    endpoint: "predeclared_source_endpoint";
    metrics: string[];
    sameDenominatorRequired: true;
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextActions: Array<{
    actionId:
      | "keep_mhas_function_receipts_fresh"
      | "prepare_nshap_harness_after_activation"
      | "execute_function_transport_batch"
      | "reduce_aggregate_delta_before_reviewgpt";
    blockedBy: string[];
    owner: "local_codex" | "reviewgpt";
    status: "blocked" | "completed" | "held" | "runnable";
    why: string;
  }>;
  packetId: "r1023-function-transport-candidate-manifest";
  schemaVersion: typeof R1023_FUNCTION_TRANSPORT_CANDIDATE_MANIFEST_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "function_transport_v1_manifest_ready_waiting_on_nshap_activation"
      | "function_transport_v1_ready_for_bounded_execution"
      | "function_transport_v1_inputs_missing";
    nextLocalAction:
      | "complete_nshap_activation_then_run_function_transport_batch"
      | "run_bounded_function_transport_batch"
      | "recover_function_transport_inputs";
    productDisplayAuthorized: false;
    reviewGptNextUse: "fresh_aggregate_delta_or_architecture_fork_only";
    rowParsingPerformedByR1023: false;
  };
}

export async function runR1023FunctionTransportCandidateManifest(
  options: R1023FunctionTransportCandidateManifestOptions = {},
): Promise<{ output: R1023FunctionTransportCandidateManifestOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const mhasSupportive =
    readStringAt(inputs.r1009MhasFunctionResult, ["summary", "conclusion"])
      === "mhas_function_panel_extension_supports_lead_sidecar"
    && readStringAt(inputs.r1011MhasDomainAttribution, ["summary", "conclusion"])
      === "mhas_function_domain_attribution_supportive";
  const shadowContextReady =
    readStringAt(inputs.r1013BiomarkerShadowState, ["summary", "conclusion"])
      === "biomarker_body_shadow_layer_mapped_not_promotable";
  const fastPathReady =
    readStringAt(inputs.r1021FastPathState, ["summary", "conclusion"])
      === "mhas_refreshed_nshap_activation_next";
  const nshapHarnessReady =
    readStringAt(inputs.r1022NshapBoundedHarnessState, ["summary", "conclusion"])
      === "bounded_nshap_harness_ready_after_activation";
  const nshapHarnessBlocked =
    readStringAt(inputs.r1022NshapBoundedHarnessState, ["summary", "conclusion"])
      === "bounded_nshap_harness_contract_ready_but_activation_blocked";
  const requiredInputsReady = mhasSupportive && shadowContextReady && fastPathReady;
  const conclusion = requiredInputsReady
    ? nshapHarnessReady
      ? "function_transport_v1_ready_for_bounded_execution"
      : "function_transport_v1_manifest_ready_waiting_on_nshap_activation"
    : "function_transport_v1_inputs_missing";
  const activationBlockers = nshapHarnessReady ? [] : readBlockedBy(
    inputs.r1022NshapBoundedHarnessState,
    "prepare_row_adapter_after_activation",
  );

  const output: R1023FunctionTransportCandidateManifestOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1023: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    batch: {
      activationRequired: true,
      allowedExecution: ["locked_local_evaluator", "aggregate_only_export"],
      batchId: "function_transport_v1",
      blockedExecution: [
        "nhis_anchor_retune",
        "broad_lab_expansion",
        "wearable_expansion",
        "product_display_or_claim",
        "individual_level_export",
      ],
      candidateLimit: 3,
      candidates: [
        {
          candidateId: "anchor_same_denominator_reference",
          requires: null,
          role: "reference",
          status: "ready_reference",
        },
        {
          candidateId: "function_disability_lead",
          requires: "nshap_activation_and_same_denominator_harness",
          role: "lead_diagnostic",
          status: nshapHarnessReady ? "ready_after_activation" : "queued_after_activation",
        },
        {
          candidateId: "cognition_shadow_after_function",
          requires: "valid_function_disability_aggregate_result",
          role: "shadow",
          status: "held_after_function",
        },
      ],
      hypothesis: "Function/disability adds portable outcome-risk signal beyond the frozen anchor; cognition is shadow-only unless function survives.",
      hypothesisSource: "reviewgpt_direction_plus_mhas_aggregate_support",
      sourceLane: "mhas_pre_nshap_nshap_post_activation",
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    decisionRules: {
      discard: [
        "no_proper_score_gain",
        "calibration_worse",
        "denominator_drift",
        "missingness_explains_lift",
        "unstable_suppressed_band_only",
        "source_boundary_ambiguous",
      ],
      keep: [
        "same_denominator_valid",
        "proper_score_improves",
        "calibration_non_worse",
        "discrimination_not_materially_worse",
        "missingness_or_abstention_not_explanatory",
        "consistent_with_mhas_function_evidence",
      ],
      sendToReviewGpt: [
        "fresh_meaningful_aggregate_delta",
        "nshap_contradicts_mhas_function_evidence",
        "cognition_unexpectedly_dominates_function",
        "model_family_or_evaluator_fork_needed",
      ],
    },
    evaluator: {
      calibrationPolicy: "predeclared_only",
      diagnostics: [
        "missingness",
        "abstention",
        "suppression_verdict",
        "subgroup_calibration_bands",
      ],
      endpoint: "predeclared_source_endpoint",
      metrics: [
        "auc_or_c",
        "brier",
        "log_loss",
        "calibration",
        "mean_prediction_error",
      ],
      sameDenominatorRequired: true,
    },
    inputArtifacts: summarizeInputs(inputs),
    nextActions: [
      {
        actionId: "keep_mhas_function_receipts_fresh",
        blockedBy: mhasSupportive ? [] : ["mhas_function_receipts_not_supportive"],
        owner: "local_codex",
        status: mhasSupportive ? "completed" : "blocked",
        why: "MHAS remains the unblocked function/disability support lane while NSHAP waits on activation.",
      },
      {
        actionId: "prepare_nshap_harness_after_activation",
        blockedBy: requiredInputsReady && nshapHarnessReady ? [] : [
          ...activationBlockers,
          ...(!requiredInputsReady ? ["function_transport_inputs_missing"] : []),
        ],
        owner: "local_codex",
        status: requiredInputsReady && nshapHarnessReady ? "runnable" : "blocked",
        why: "NSHAP is the next fresh falsification lane for the function/disability sidecar.",
      },
      {
        actionId: "execute_function_transport_batch",
        blockedBy: requiredInputsReady && nshapHarnessReady ? [] : ["bounded_nshap_harness_not_ready"],
        owner: "local_codex",
        status: requiredInputsReady && nshapHarnessReady ? "runnable" : "blocked",
        why: "The batch should execute only after the bounded same-denominator harness is ready.",
      },
      {
        actionId: "reduce_aggregate_delta_before_reviewgpt",
        blockedBy: ["fresh_aggregate_result_missing"],
        owner: "local_codex",
        status: nshapHarnessBlocked || nshapHarnessReady ? "held" : "blocked",
        why: "Codex should reduce fresh aggregate deltas before asking ReviewGPT to make a high-level call.",
      },
    ],
    packetId: "r1023-function-transport-candidate-manifest",
    schemaVersion: R1023_FUNCTION_TRANSPORT_CANDIDATE_MANIFEST_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextLocalAction: conclusion === "function_transport_v1_ready_for_bounded_execution"
        ? "run_bounded_function_transport_batch"
        : conclusion === "function_transport_v1_manifest_ready_waiting_on_nshap_activation"
          ? "complete_nshap_activation_then_run_function_transport_batch"
          : "recover_function_transport_inputs",
      productDisplayAuthorized: false,
      reviewGptNextUse: "fresh_aggregate_delta_or_architecture_fork_only",
      rowParsingPerformedByR1023: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1023 function-transport manifest failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1023FunctionTransportCandidateManifestOptions): Promise<Inputs> {
  return {
    r1009MhasFunctionResult: await readJsonIfPresent(
      options.r1009Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1009-mhas-function-panel-extension-result.latest.json"),
    ),
    r1011MhasDomainAttribution: await readJsonIfPresent(
      options.r1011Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1011-mhas-function-domain-attribution.latest.json"),
    ),
    r1013BiomarkerShadowState: await readJsonIfPresent(
      options.r1013Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1013-biomarker-shadow-layer-state.latest.json"),
    ),
    r1021FastPathState: await readJsonIfPresent(
      options.r1021Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1021-fast-path-execution-state.latest.json"),
    ),
    r1022NshapBoundedHarnessState: await readJsonIfPresent(
      options.r1022Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1022-nshap-bounded-harness-state.latest.json"),
    ),
  };
}

function validateInputBoundaries(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (value === null) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1023 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function summarizeInputs(inputs: Inputs): Record<ArtifactKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.entries(inputs) as Array<[ArtifactKey, unknown | null]>).map(([artifact, value]) => [
      artifact,
      {
        artifact,
        packetId: readStringAt(value, ["packetId"]),
        schemaVersion: readStringAt(value, ["schemaVersion"]),
        status: value === null ? "missing" : "available",
      },
    ]),
  ) as Record<ArtifactKey, ArtifactSummary>;
}

function readBlockedBy(value: unknown, actionId: string): string[] {
  const actions = optionalArray(optionalRecord(value)?.nextActions);
  for (const action of actions) {
    const record = optionalRecord(action);
    if (!record) continue;
    if (readStringAt(record, ["actionId"]) !== actionId) continue;
    return optionalArray(record.blockedBy).filter((item): item is string => typeof item === "string");
  }
  return [];
}

function readStringAt(value: unknown, pathParts: string[]): string | null {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" && current.length > 0 ? current : null;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1023FunctionTransportCandidateManifest({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1009Path: process.env.MURPH_AGE_R1009_MHAS_FUNCTION_RESULT_PATH,
    r1011Path: process.env.MURPH_AGE_R1011_MHAS_DOMAIN_ATTRIBUTION_PATH,
    r1013Path: process.env.MURPH_AGE_R1013_BIOMARKER_SHADOW_STATE_PATH,
    r1021Path: process.env.MURPH_AGE_R1021_FAST_PATH_STATE_PATH,
    r1022Path: process.env.MURPH_AGE_R1022_NSHAP_BOUNDED_HARNESS_STATE_PATH,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      batchId: output.batch.batchId,
      conclusion: output.summary.conclusion,
      nextLocalAction: output.summary.nextLocalAction,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      reviewGptNextUse: output.summary.reviewGptNextUse,
      rowParsingPerformedByR1023: output.summary.rowParsingPerformedByR1023,
      schemaVersion: output.schemaVersion,
      status: output.status,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    process.stdout.write(`${JSON.stringify({
      error: error instanceof Error ? error.message : "unknown R1023 failure",
      packetId: "r1023-function-transport-candidate-manifest",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1023: false,
      status: "blocked",
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
