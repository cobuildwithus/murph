import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R995_SIDECAR_EVIDENCE_ARBITRATION_SCHEMA_VERSION =
  "murph-age-r995-sidecar-evidence-arbitration.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_LOOP_RUNS_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
);
const OUTPUT_FILE_NAME = "r995-sidecar-evidence-arbitration.latest.json";

type ArtifactKey =
  | "r983CurrentCandidateState"
  | "r986CrossSourceFunctionArbitration"
  | "r987CrelesGlycemiaReceipt"
  | "r988MhasAnchorFunctionIncrement"
  | "r991MhasDeepDiagnostic"
  | "r770NshapFunctionCognition"
  | "r773NshapSingleDomain"
  | "crelesLocalBenchmark"
  | "midus2LocalBenchmark"
  | "midus2CrelesTransportBenchmark";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

type FamilyStatus =
  | "optimize_or_falsify_next"
  | "hold_external_validation_only"
  | "hold_shadow_only"
  | "hold_historical_context_only";

interface FamilyDecision {
  candidateFamily: string;
  decision: FamilyStatus;
  evidenceLabels: string[];
  nextUse: string;
  priority: "p0_now" | "p1_hold" | "p2_shadow";
  productDisplayAuthorized: false;
  productPromotionAuthorized: false;
}

export interface R995SidecarEvidenceArbitrationOptions {
  createdAt?: string;
  crelesLocalBenchmarkPath?: string;
  midus2CrelesTransportBenchmarkPath?: string;
  midus2LocalBenchmarkPath?: string;
  nshapCombinedPath?: string;
  nshapSingleDomainPath?: string;
  outputDir?: string;
  r983Path?: string;
  r986Path?: string;
  r987Path?: string;
  r988Path?: string;
  r991Path?: string;
}

export interface R995SidecarEvidenceArbitrationOutput {
  arbitration: {
    heldFamilies: FamilyDecision[];
    minimalNextLoop: {
      loopId:
        | "cached_nshap_function_cognition_falsification"
        | "mhas_deep_diagnostic_before_external_falsification"
        | "candidate_family_recovery";
      objective: string;
      requiredEvidence: string[];
      runnableNow: boolean;
      scope: "aggregate_only_cached_sidecar_loop";
      stopCondition: string;
    };
    nextFamily: FamilyDecision;
    recommendation:
      | "run_cached_nshap_function_cognition_falsification_for_function_disability"
      | "finish_mhas_anchor_diagnostics_before_external_falsification"
      | "recover_candidate_state_before_new_loop";
  };
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    modelPromotionAuthorized: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR995: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  evidenceState: {
    crelesMidusBenchmarkEvidence: "available" | "partial_or_missing";
    mhasAnchorIncrement: "supportive" | "missing_or_hold";
    mhasDeepDiagnostic: "supportive" | "missing_or_hold";
    nshapFunctionCognition: "supportive_available" | "missing_or_blocked";
    r983LeadFamily: "function_disability" | "none";
    r986Verdict: "function_supported" | "function_hold_or_missing";
    r987GlycemiaBody: "keep_future_validation" | "hold_or_missing";
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r995-sidecar-evidence-arbitration";
  schemaVersion: typeof R995_SIDECAR_EVIDENCE_ARBITRATION_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    nextCandidateFamily: "function_disability" | "candidate_state_recovery";
    nextLoop: R995SidecarEvidenceArbitrationOutput["arbitration"]["minimalNextLoop"]["loopId"];
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendation: R995SidecarEvidenceArbitrationOutput["arbitration"]["recommendation"];
  };
}

export async function runR995SidecarEvidenceArbitration(
  options: R995SidecarEvidenceArbitrationOptions = {},
): Promise<{ output: R995SidecarEvidenceArbitrationOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const evidenceState = buildEvidenceState(inputs);
  const nextFamily = decideNextFamily(evidenceState);
  const heldFamilies = buildHeldFamilies(evidenceState, nextFamily.candidateFamily);
  const minimalNextLoop = buildMinimalNextLoop(evidenceState);
  const recommendation = buildRecommendation(minimalNextLoop.loopId);

  const output: R995SidecarEvidenceArbitrationOutput = {
    arbitration: {
      heldFamilies,
      minimalNextLoop,
      nextFamily,
      recommendation,
    },
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      modelPromotionAuthorized: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR995: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    evidenceState,
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r995-sidecar-evidence-arbitration",
    schemaVersion: R995_SIDECAR_EVIDENCE_ARBITRATION_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      nextCandidateFamily: nextFamily.candidateFamily === "function_disability"
        ? "function_disability"
        : "candidate_state_recovery",
      nextLoop: minimalNextLoop.loopId,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendation,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R995 sidecar evidence arbitration failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R995SidecarEvidenceArbitrationOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    r983CurrentCandidateState: await readJsonIfPresent(
      options.r983Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r983-current-candidate-family-state.latest.json"),
    ),
    r986CrossSourceFunctionArbitration: await readJsonIfPresent(
      options.r986Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r986-cross-source-function-arbitration.latest.json"),
    ),
    r987CrelesGlycemiaReceipt: await readJsonIfPresent(
      options.r987Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r987-creles-glycemia-receipt-reducer.latest.json"),
    ),
    r988MhasAnchorFunctionIncrement: await readJsonIfPresent(
      options.r988Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r988-mhas-anchor-function-increment-check.latest.json"),
    ),
    r991MhasDeepDiagnostic: await readJsonIfPresent(
      options.r991Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r991-mhas-deep-diagnostic-reducer.latest.json"),
    ),
    r770NshapFunctionCognition: await readJsonIfPresent(
      options.nshapCombinedPath
        ?? path.join(
          DEFAULT_LOOP_RUNS_DIR,
          "session_murph_age_r770_nshap_function_cognition_external_repeat",
          "nshap-function-cognition-external-repeat-r770.json",
        ),
    ),
    r773NshapSingleDomain: await readJsonIfPresent(
      options.nshapSingleDomainPath
        ?? path.join(
          DEFAULT_LOOP_RUNS_DIR,
          "session_murph_age_r773_nshap_single_domain_breakdown",
          "nshap-single-domain-breakdown-r773.json",
        ),
    ),
    crelesLocalBenchmark: await readJsonIfPresent(
      options.crelesLocalBenchmarkPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "creles-local-benchmark.latest.json"),
    ),
    midus2LocalBenchmark: await readJsonIfPresent(
      options.midus2LocalBenchmarkPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-local-benchmark.latest.json"),
    ),
    midus2CrelesTransportBenchmark: await readJsonIfPresent(
      options.midus2CrelesTransportBenchmarkPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-creles-transport-benchmark.latest.json"),
    ),
  };
}

function buildEvidenceState(
  inputs: Record<ArtifactKey, unknown | null>,
): R995SidecarEvidenceArbitrationOutput["evidenceState"] {
  const r983LeadFamily = readStringAt(inputs.r983CurrentCandidateState, ["summary", "currentLeadFamily"]) === "function_disability"
    ? "function_disability"
    : "none";
  const r986Verdict = readStringAt(inputs.r986CrossSourceFunctionArbitration, ["summary", "verdict"])
    === "function_disability_portable_diagnostic_sidecar_supported"
    ? "function_supported"
    : "function_hold_or_missing";
  const mhasAnchorIncrement = readStringAt(inputs.r988MhasAnchorFunctionIncrement, ["summary", "verdict"])
    === "mhas_function_adds_small_increment_over_frozen_anchor"
    ? "supportive"
    : "missing_or_hold";
  const mhasDeepDiagnostic = readStringAt(inputs.r991MhasDeepDiagnostic, ["summary", "verdict"])
    === "function_disability_survives_age_residualized_deep_diagnostic"
    ? "supportive"
    : "missing_or_hold";
  const nshapFunctionCognition = (
      supportStringIncludes(inputs.r770NshapFunctionCognition, ["support_classification"], "supportive")
      || supportStringIncludes(inputs.r773NshapSingleDomain, ["support_classification"], "supportive")
    )
    ? "supportive_available"
    : "missing_or_blocked";
  const r987GlycemiaBody = readStringAt(inputs.r987CrelesGlycemiaReceipt, ["summary", "keyArtifactVerdict"])
    === "keep_tiny_glycemia_only_and_glycemia_body_for_future_external_validation"
    ? "keep_future_validation"
    : "hold_or_missing";
  const benchmarkEvidenceAvailable = [
    inputs.crelesLocalBenchmark,
    inputs.midus2LocalBenchmark,
    inputs.midus2CrelesTransportBenchmark,
  ].every((value) => value !== null);

  return {
    crelesMidusBenchmarkEvidence: benchmarkEvidenceAvailable ? "available" : "partial_or_missing",
    mhasAnchorIncrement,
    mhasDeepDiagnostic,
    nshapFunctionCognition,
    r983LeadFamily,
    r986Verdict,
    r987GlycemiaBody,
  };
}

function decideNextFamily(
  evidenceState: R995SidecarEvidenceArbitrationOutput["evidenceState"],
): FamilyDecision {
  const mhasReady = evidenceState.r983LeadFamily === "function_disability"
    && evidenceState.r986Verdict === "function_supported"
    && evidenceState.mhasAnchorIncrement === "supportive";
  const deepReady = evidenceState.mhasDeepDiagnostic === "supportive";
  if (mhasReady && deepReady) {
    return {
      candidateFamily: "function_disability",
      decision: "optimize_or_falsify_next",
      evidenceLabels: [
        "current_candidate_state_leads_function_disability",
        "cross_source_function_arbitration_supportive",
        "mhas_anchor_increment_supportive",
        "mhas_age_residualized_deep_diagnostic_supportive",
      ],
      nextUse: "falsify_with_cached_nshap_function_cognition_before_any_promotion_review",
      priority: "p0_now",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
    };
  }
  return {
    candidateFamily: "candidate_state_recovery",
    decision: "optimize_or_falsify_next",
    evidenceLabels: ["current_sidecar_evidence_incomplete_or_not_supportive"],
    nextUse: "recover_missing_mhas_or_candidate_state_aggregate_receipts",
    priority: "p0_now",
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
  };
}

function buildHeldFamilies(
  evidenceState: R995SidecarEvidenceArbitrationOutput["evidenceState"],
  nextFamily: string,
): FamilyDecision[] {
  const held: FamilyDecision[] = [];
  if (nextFamily !== "glycemia_body") {
    held.push({
      candidateFamily: "glycemia_body",
      decision: "hold_external_validation_only",
      evidenceLabels: [
        evidenceState.r987GlycemiaBody === "keep_future_validation"
          ? "creles_glycemia_receipt_kept_for_future_external_validation"
          : "glycemia_body_support_missing_or_held",
        "do_not_optimize_from_non_confirming_transport",
      ],
      nextUse: "freeze_until_clean_independent_validation_opportunity",
      priority: "p1_hold",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
    });
  }
  held.push(
    {
      candidateFamily: "nshap_cognition",
      decision: "hold_shadow_only",
      evidenceLabels: [
        evidenceState.nshapFunctionCognition === "supportive_available"
          ? "nshap_function_cognition_aggregate_available"
          : "nshap_function_cognition_missing_or_activation_blocked",
        "use_as_falsification_axis_not_promoted_domain",
      ],
      nextUse: "separate_function_from_cognition_in_the_next_sidecar_loop",
      priority: "p1_hold",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
    },
    {
      candidateFamily: "nhanes_lab_bp_body",
      decision: "hold_historical_context_only",
      evidenceLabels: ["research_layer_available_but_not_default_sidecar_candidate"],
      nextUse: "context_only_no_current_optimization",
      priority: "p2_shadow",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
    },
    {
      candidateFamily: "wearables_sleep_activity",
      decision: "hold_shadow_only",
      evidenceLabels: ["no_score_bearing_sidecar_evidence_in_current_reducer"],
      nextUse: "shadow_registry_only",
      priority: "p2_shadow",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
    },
  );
  return held;
}

function buildMinimalNextLoop(
  evidenceState: R995SidecarEvidenceArbitrationOutput["evidenceState"],
): R995SidecarEvidenceArbitrationOutput["arbitration"]["minimalNextLoop"] {
  if (
    evidenceState.r983LeadFamily === "function_disability"
    && evidenceState.r986Verdict === "function_supported"
    && evidenceState.mhasAnchorIncrement === "supportive"
    && evidenceState.mhasDeepDiagnostic === "supportive"
  ) {
    return {
      loopId: "cached_nshap_function_cognition_falsification",
      objective:
        "Use cached NSHAP aggregate function/cognition evidence to falsify whether function/disability remains the lead sidecar after separating cognition.",
      requiredEvidence: [
        "r770_or_r773_nshap_function_cognition_aggregate",
        "r991_mhas_age_residualized_deep_diagnostic_receipt",
        "r986_cross_source_function_arbitration_receipt",
      ],
      runnableNow: evidenceState.nshapFunctionCognition === "supportive_available",
      scope: "aggregate_only_cached_sidecar_loop",
      stopCondition: "stop_after_aggregate_verdict_no_anchor_refit_no_product_authorization",
    };
  }
  if (evidenceState.mhasDeepDiagnostic !== "supportive") {
    return {
      loopId: "mhas_deep_diagnostic_before_external_falsification",
      objective:
        "Complete or recover the MHAS deep diagnostic receipt before spending the next loop on external function/cognition arbitration.",
      requiredEvidence: [
        "r991_mhas_age_residualized_deep_diagnostic_receipt",
        "r988_mhas_anchor_increment_receipt",
      ],
      runnableNow: false,
      scope: "aggregate_only_cached_sidecar_loop",
      stopCondition: "stop_after_mhas_deep_diagnostic_receipt_no_model_promotion",
    };
  }
  return {
    loopId: "candidate_family_recovery",
    objective: "Recover missing current-state or cross-source arbitration receipts before a new optimization loop.",
    requiredEvidence: ["r983_current_candidate_state", "r986_cross_source_function_arbitration_receipt"],
    runnableNow: false,
    scope: "aggregate_only_cached_sidecar_loop",
    stopCondition: "stop_after_candidate_state_reducer_no_product_authorization",
  };
}

function buildRecommendation(
  loopId: R995SidecarEvidenceArbitrationOutput["arbitration"]["minimalNextLoop"]["loopId"],
): R995SidecarEvidenceArbitrationOutput["arbitration"]["recommendation"] {
  if (loopId === "cached_nshap_function_cognition_falsification") {
    return "run_cached_nshap_function_cognition_falsification_for_function_disability";
  }
  if (loopId === "mhas_deep_diagnostic_before_external_falsification") {
    return "finish_mhas_anchor_diagnostics_before_external_falsification";
  }
  return "recover_candidate_state_before_new_loop";
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (value === null) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R995 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    r983CurrentCandidateState:
      summarizeArtifact("r983-current-candidate-family-state.latest.json", inputs.r983CurrentCandidateState),
    r986CrossSourceFunctionArbitration:
      summarizeArtifact("r986-cross-source-function-arbitration.latest.json", inputs.r986CrossSourceFunctionArbitration),
    r987CrelesGlycemiaReceipt:
      summarizeArtifact("r987-creles-glycemia-receipt-reducer.latest.json", inputs.r987CrelesGlycemiaReceipt),
    r988MhasAnchorFunctionIncrement:
      summarizeArtifact("r988-mhas-anchor-function-increment-check.latest.json", inputs.r988MhasAnchorFunctionIncrement),
    r991MhasDeepDiagnostic:
      summarizeArtifact("r991-mhas-deep-diagnostic-reducer.latest.json", inputs.r991MhasDeepDiagnostic),
    r770NshapFunctionCognition:
      summarizeArtifact("nshap-function-cognition-external-repeat-r770.json", inputs.r770NshapFunctionCognition),
    r773NshapSingleDomain:
      summarizeArtifact("nshap-single-domain-breakdown-r773.json", inputs.r773NshapSingleDomain),
    crelesLocalBenchmark: summarizeArtifact("creles-local-benchmark.latest.json", inputs.crelesLocalBenchmark),
    midus2LocalBenchmark: summarizeArtifact("midus2-local-benchmark.latest.json", inputs.midus2LocalBenchmark),
    midus2CrelesTransportBenchmark:
      summarizeArtifact("midus2-creles-transport-benchmark.latest.json", inputs.midus2CrelesTransportBenchmark),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"])
      ?? readStringAt(value, ["run_id"])
      ?? readStringAt(value, ["benchmarkId"])
      ?? null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) ?? readStringAt(value, ["schema_version"]),
    status: "available",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("R995 failed to read an aggregate input artifact.");
  }
}

function supportStringIncludes(value: unknown | null, keys: string[], expected: string): boolean {
  const found = readStringAt(value, keys);
  return found !== null && found.toLowerCase().includes(expected);
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  const found = readAt(value, keys);
  return typeof found === "string" && found.length > 0 && found.length <= 160 && !/[\r\n\t/\\]/u.test(found)
    ? found
    : null;
}

function readAt(value: unknown | null, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function main(): Promise<void> {
  const { output, outputPath } = await runR995SidecarEvidenceArbitration({
    crelesLocalBenchmarkPath: process.env.MURPH_AGE_CRELES_LOCAL_BENCHMARK_PATH,
    midus2CrelesTransportBenchmarkPath: process.env.MURPH_AGE_MIDUS2_CRELES_TRANSPORT_BENCHMARK_PATH,
    midus2LocalBenchmarkPath: process.env.MURPH_AGE_MIDUS2_LOCAL_BENCHMARK_PATH,
    nshapCombinedPath: process.env.MURPH_AGE_R770_NSHAP_COMBINED_PATH,
    nshapSingleDomainPath: process.env.MURPH_AGE_R773_NSHAP_SINGLE_DOMAIN_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r983Path: process.env.MURPH_AGE_R983_CANDIDATE_STATE_PATH,
    r986Path: process.env.MURPH_AGE_R986_FUNCTION_ARBITRATION_PATH,
    r987Path: process.env.MURPH_AGE_R987_GLYCEMIA_RECEIPT_PATH,
    r988Path: process.env.MURPH_AGE_R988_MHAS_INCREMENT_PATH,
    r991Path: process.env.MURPH_AGE_R991_MHAS_DEEP_DIAGNOSTIC_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: path.basename(outputPath),
    nextCandidateFamily: output.summary.nextCandidateFamily,
    nextLoop: output.summary.nextLoop,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    productPromotionAuthorized: output.summary.productPromotionAuthorized,
    recommendation: output.summary.recommendation,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R995 sidecar evidence arbitration failed.\n");
    process.exitCode = 1;
  });
}
