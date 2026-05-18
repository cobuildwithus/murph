import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1022_NSHAP_BOUNDED_HARNESS_STATE_SCHEMA_VERSION =
  "murph-age-r1022-nshap-bounded-harness-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1022-nshap-bounded-harness-state.latest.json";

type ArtifactKey =
  | "r613NshapBenchmarkCard"
  | "r614NshapActivationLabels"
  | "r977NshapActivationProbe"
  | "r992NshapScaffold"
  | "r1018ScoreBearingSignal"
  | "r1021FastPathState";

interface ArtifactSummary {
  artifact: ArtifactKey;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface Inputs {
  r613NshapBenchmarkCard: unknown | null;
  r614NshapActivationLabels: unknown | null;
  r977NshapActivationProbe: unknown | null;
  r992NshapScaffold: unknown | null;
  r1018ScoreBearingSignal: unknown | null;
  r1021FastPathState: unknown | null;
}

export interface R1022NshapBoundedHarnessStateOptions {
  createdAt?: string;
  outputDir?: string;
  r613Path?: string;
  r614Path?: string;
  r977Path?: string;
  r992Path?: string;
  r1018Path?: string;
  r1021Path?: string;
}

export interface R1022NshapBoundedHarnessStateOutput {
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
    rowParsingPerformedByR1022: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  harnessContract: {
    allowedAggregateOutputs: string[];
    blockedOutputs: string[];
    candidateFamilies: Array<{
      familyId: "anchor_only_reference" | "function_disability_lead" | "cognition_shadow_after_function";
      role: "reference" | "lead_diagnostic" | "shadow";
      status: "blocked_until_activation" | "planned_after_activation";
    }>;
    comparisonPolicy: "same_denominator_anchor_vs_function_then_cognition_shadow";
    minimumCellSuppressionPolicy: "required_before_export";
    productDisplayAuthorized: false;
    scoringAuthorizedByR1022: false;
    status:
      | "blocked_activation_labels_missing"
      | "ready_after_activation_no_scoring";
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextActions: Array<{
    actionId:
      | "complete_nshap_activation_labels"
      | "prepare_row_adapter_after_activation"
      | "run_bounded_function_disability_falsification"
      | "run_cognition_shadow_only_after_function"
      | "send_reviewgpt_after_fresh_aggregate_delta";
    blockedBy: string[];
    owner: "human_user" | "local_codex" | "reviewgpt";
    status: "blocked" | "held" | "runnable";
    why: string;
  }>;
  packetId: "r1022-nshap-bounded-harness-state";
  schemaVersion: typeof R1022_NSHAP_BOUNDED_HARNESS_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "bounded_nshap_harness_contract_ready_but_activation_blocked"
      | "bounded_nshap_harness_ready_after_activation"
      | "bounded_nshap_harness_inputs_missing";
    nextLocalAction:
      | "wait_for_nshap_activation_then_prepare_row_adapter"
      | "prepare_bounded_nshap_row_adapter_no_product"
      | "recover_nshap_harness_inputs";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1022: false;
  };
}

export async function runR1022NshapBoundedHarnessState(
  options: R1022NshapBoundedHarnessStateOptions = {},
): Promise<{ output: R1022NshapBoundedHarnessStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const benchmarkCardReady =
    readStringAt(inputs.r613NshapBenchmarkCard, ["summary", "conclusion"])
      === "nshap_metadata_benchmark_card_locked_without_execution";
  const sidecarProbeReady =
    readStringAt(inputs.r977NshapActivationProbe, ["summary", "conclusion"])
      === "nshap_benchmark_card_ready_but_sidecar_blocked_by_activation_labels"
    || readStringAt(inputs.r977NshapActivationProbe, ["summary", "conclusion"])
      === "nshap_metadata_ready_for_no_score_sidecar_scaffold";
  const scaffoldPresent =
    readStringAt(inputs.r992NshapScaffold, ["packetId"]) === "r992-nshap-function-cognition-scaffold";
  const scoreBearingSignalReady =
    readStringAt(inputs.r1018ScoreBearingSignal, ["summary", "conclusion"])
      === "function_lead_glycemia_shadow_broad_labs_hold";
  const fastPathReady =
    readStringAt(inputs.r1021FastPathState, ["summary", "conclusion"])
      === "mhas_refreshed_nshap_activation_next";
  const activationComplete =
    readBooleanAt(inputs.r614NshapActivationLabels, ["summary", "sourceRightsLabelsComplete"]) === true
    && readBooleanAt(inputs.r614NshapActivationLabels, ["summary", "aggregateOutputsActive"]) === true;
  const requiredInputsReady =
    benchmarkCardReady
    && sidecarProbeReady
    && scaffoldPresent
    && scoreBearingSignalReady
    && fastPathReady;
  const harnessStatus = activationComplete
    ? "ready_after_activation_no_scoring"
    : "blocked_activation_labels_missing";
  const conclusion = !requiredInputsReady
    ? "bounded_nshap_harness_inputs_missing"
    : activationComplete
      ? "bounded_nshap_harness_ready_after_activation"
      : "bounded_nshap_harness_contract_ready_but_activation_blocked";
  const activationBlockers = activationComplete ? [] : activationBlockingReasons(inputs.r614NshapActivationLabels);

  const output: R1022NshapBoundedHarnessStateOutput = {
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
      rowParsingPerformedByR1022: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    harnessContract: {
      allowedAggregateOutputs: [
        "eligible_denominator_count_band",
        "same_denominator_metric_deltas",
        "calibration_summary",
        "function_vs_anchor_summary",
        "cognition_shadow_after_function_summary",
        "missingness_and_abstention_summary",
        "suppression_verdict",
      ],
      blockedOutputs: [
        "row_values",
        "participant_identifiers",
        "split_memberships",
        "individual_predictions",
        "coefficients_or_model_parameters",
        "source_text_or_codebook_prose",
        "unsuppressed_small_cells",
        "product_claims_or_recommendations",
      ],
      candidateFamilies: [
        {
          familyId: "anchor_only_reference",
          role: "reference",
          status: activationComplete ? "planned_after_activation" : "blocked_until_activation",
        },
        {
          familyId: "function_disability_lead",
          role: "lead_diagnostic",
          status: activationComplete ? "planned_after_activation" : "blocked_until_activation",
        },
        {
          familyId: "cognition_shadow_after_function",
          role: "shadow",
          status: activationComplete ? "planned_after_activation" : "blocked_until_activation",
        },
      ],
      comparisonPolicy: "same_denominator_anchor_vs_function_then_cognition_shadow",
      minimumCellSuppressionPolicy: "required_before_export",
      productDisplayAuthorized: false,
      scoringAuthorizedByR1022: false,
      status: harnessStatus,
    },
    inputArtifacts: summarizeInputs(inputs),
    nextActions: [
      {
        actionId: "complete_nshap_activation_labels",
        blockedBy: activationBlockers,
        owner: "human_user",
        status: activationComplete ? "held" : "blocked",
        why: "The bounded NSHAP harness cannot prepare local rows until source and aggregate-output labels are complete.",
      },
      {
        actionId: "prepare_row_adapter_after_activation",
        blockedBy: requiredInputsReady && activationComplete ? [] : [
          ...activationBlockers,
          ...(!requiredInputsReady ? ["nshap_harness_inputs_missing"] : []),
        ],
        owner: "local_codex",
        status: requiredInputsReady && activationComplete ? "runnable" : "blocked",
        why: "After activation, Codex should build only the bounded local adapter for same-denominator aggregate evaluation.",
      },
      {
        actionId: "run_bounded_function_disability_falsification",
        blockedBy: requiredInputsReady && activationComplete ? [] : ["row_adapter_not_prepared"],
        owner: "local_codex",
        status: requiredInputsReady && activationComplete ? "runnable" : "blocked",
        why: "Function/disability is the lead diagnostic sidecar and needs fresh NSHAP falsification.",
      },
      {
        actionId: "run_cognition_shadow_only_after_function",
        blockedBy: ["function_disability_result_missing"],
        owner: "local_codex",
        status: "held",
        why: "Cognition stays shadow-only and should be evaluated after the function lead result.",
      },
      {
        actionId: "send_reviewgpt_after_fresh_aggregate_delta",
        blockedBy: ["fresh_aggregate_delta_missing"],
        owner: "reviewgpt",
        status: "held",
        why: "ReviewGPT should review the fresh aggregate delta, not the local harness plumbing.",
      },
    ],
    packetId: "r1022-nshap-bounded-harness-state",
    schemaVersion: R1022_NSHAP_BOUNDED_HARNESS_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextLocalAction: !requiredInputsReady
        ? "recover_nshap_harness_inputs"
        : activationComplete
          ? "prepare_bounded_nshap_row_adapter_no_product"
          : "wait_for_nshap_activation_then_prepare_row_adapter",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1022: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1022Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1022 NSHAP bounded harness state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1022NshapBoundedHarnessStateOptions): Promise<Inputs> {
  return {
    r613NshapBenchmarkCard: await readJsonIfPresent(
      options.r613Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r613-nshap-metadata-benchmark-card.latest.json"),
    ),
    r614NshapActivationLabels: await readJsonIfPresent(
      options.r614Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-nshap-activation-labels.latest.json"),
    ),
    r977NshapActivationProbe: await readJsonIfPresent(
      options.r977Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r977-nshap-next-activation-probe.latest.json"),
    ),
    r992NshapScaffold: await readJsonIfPresent(
      options.r992Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r992-nshap-function-cognition-scaffold.latest.json"),
    ),
    r1018ScoreBearingSignal: await readJsonIfPresent(
      options.r1018Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1018-score-bearing-model-signal-receipt.latest.json"),
    ),
    r1021FastPathState: await readJsonIfPresent(
      options.r1021Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1021-fast-path-execution-state.latest.json"),
    ),
  };
}

function validateInputs(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1022 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
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

function activationBlockingReasons(value: unknown | null): string[] {
  const reasons = readStringArrayAt(value, ["rowExecutionReadiness", "blockingReasons"])
    .filter((reason) => reason !== "outcome_scoring_requires_separate_execution_gate");
  const labels = readStringArrayAt(value, [
    "sourceRightsAndAggregateOutput",
    "requiredHumanLabels",
  ]).map((label) => `missing_${label}`);
  return dedupe([
    ...reasons,
    ...labels,
    reasons.length === 0 && labels.length === 0 ? "nshap_activation_labels_missing" : null,
  ]);
}

function findForbiddenR1022Output(output: R1022NshapBoundedHarnessStateOutput): string[] {
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

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const valueAtPath = readAtPath(value, pathParts);
  return typeof valueAtPath === "boolean" ? valueAtPath : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const valueAtPath = readAtPath(value, pathParts);
  return Array.isArray(valueAtPath)
    ? valueAtPath.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function readAtPath(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function dedupe(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1022NshapBoundedHarnessState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r613Path: process.env.MURPH_AGE_R613_NSHAP_BENCHMARK_CARD_PATH,
    r614Path: process.env.MURPH_AGE_R614_NSHAP_ACTIVATION_LABELS_PATH,
    r977Path: process.env.MURPH_AGE_R977_NSHAP_ACTIVATION_PROBE_PATH,
    r992Path: process.env.MURPH_AGE_R992_NSHAP_SCAFFOLD_PATH,
    r1018Path: process.env.MURPH_AGE_R1018_SCORE_BEARING_SIGNAL_PATH,
    r1021Path: process.env.MURPH_AGE_R1021_FAST_PATH_STATE_PATH,
  }).then(({ output }) => {
    const cliSummary = toCliSummary(output);
    console.log(JSON.stringify(cliSummary, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R1022 NSHAP bounded harness state failed.");
    process.exitCode = 1;
  });
}

function toCliSummary(value: R1022NshapBoundedHarnessStateOutput): Record<string, unknown> {
  return {
    conclusion: value.summary.conclusion,
    harnessStatus: value.harnessContract.status,
    nextLocalAction: value.summary.nextLocalAction,
    packetId: value.packetId,
    productDisplayAuthorized: value.summary.productDisplayAuthorized,
    rowParsingPerformedByR1022: value.summary.rowParsingPerformedByR1022,
    schemaVersion: value.schemaVersion,
    status: value.status,
  };
}
