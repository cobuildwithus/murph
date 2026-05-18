import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1018_SCORE_BEARING_MODEL_SIGNAL_RECEIPT_SCHEMA_VERSION =
  "murph-age-r1018-score-bearing-model-signal-receipt.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1018-score-bearing-model-signal-receipt.latest.json";

type ArtifactKey =
  | "midus2LocalBenchmark"
  | "crelesLocalBenchmark"
  | "midus2CrelesTransportBenchmark"
  | "r399LayeringReadiness"
  | "r600AggregateResultsPacket"
  | "r987CrelesGlycemiaReceipt"
  | "r1012CrossSourceFunctionConsistency"
  | "r1013BiomarkerShadowLayerState"
  | "r1017ExpandedDataExecutionState";

type SignalVerdict =
  | "supportive_internal_only"
  | "supportive_shadow_external_validation_only"
  | "not_supportive_or_deprioritize"
  | "not_confirmed_transport"
  | "missing";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface MetricSummary {
  auc: number | null;
  brier: number | null;
  logLoss: number | null;
  meanPrediction: number | null;
  observedRate: number | null;
}

interface MetricDelta {
  aucDelta: number | null;
  brierDelta: number | null;
  logLossDelta: number | null;
}

interface CandidateSignal {
  candidateId: string;
  metricDeltaVsReference: MetricDelta;
  metrics: MetricSummary;
  signalVerdict: SignalVerdict;
}

interface Inputs {
  midus2LocalBenchmark: unknown | null;
  crelesLocalBenchmark: unknown | null;
  midus2CrelesTransportBenchmark: unknown | null;
  r399LayeringReadiness: unknown | null;
  r600AggregateResultsPacket: unknown | null;
  r987CrelesGlycemiaReceipt: unknown | null;
  r1012CrossSourceFunctionConsistency: unknown | null;
  r1013BiomarkerShadowLayerState: unknown | null;
  r1017ExpandedDataExecutionState: unknown | null;
}

export interface R1018ScoreBearingModelSignalReceiptOptions {
  createdAt?: string;
  crelesPath?: string;
  midus2Path?: string;
  outputDir?: string;
  r399Path?: string;
  r600Path?: string;
  r987Path?: string;
  r1012Path?: string;
  r1013Path?: string;
  r1017Path?: string;
  transportPath?: string;
}

export interface R1018ScoreBearingModelSignalReceiptOutput {
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
    rowParsingPerformedByR1018: false;
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
  modelSignalState: {
    bloodworkBodyPolicy: "shadow_research_not_promotable";
    broadLabPolicy: "deprioritize_until_transport_confirmed";
    crelesBestSignal: CandidateSignal;
    functionSidecarStatus:
      | "lead_diagnostic_supported_pending_fresh_nshap"
      | "hold_pending_support_or_missing";
    midusBestSignal: CandidateSignal;
    nextProposalBatch:
      | "function_lead_with_glycemia_shadow_no_product"
      | "recover_missing_score_bearing_inputs";
    nshapFreshHarnessState:
      | "blocked_source_confirmation"
      | "ready_after_confirmation_no_scoring"
      | "missing";
    productDisplayAuthorized: false;
    reviewGptNextUse: "meaningful_aggregate_delta_or_model_family_fork_only";
    transportSignal: {
      metricDeltaVsTargetReference: MetricDelta;
      status: "not_confirmed" | "confirmed" | "missing";
    };
    wearablePolicy: "shadow_only_no_score_bearing_increment";
  };
  nextActions: Array<{
    actionId:
      | "keep_function_disability_as_research_lead"
      | "hold_broad_bloodwork_expansion"
      | "carry_compact_glycemia_as_shadow_external_validation_candidate"
      | "build_fresh_nshap_function_cognition_harness_after_confirmation"
      | "send_to_reviewgpt_after_new_aggregate_delta";
    owner: "local_codex" | "reviewgpt";
    status: "blocked" | "held" | "runnable";
    why: string;
  }>;
  packetId: "r1018-score-bearing-model-signal-receipt";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  schemaVersion: typeof R1018_SCORE_BEARING_MODEL_SIGNAL_RECEIPT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "function_lead_glycemia_shadow_broad_labs_hold"
      | "score_bearing_signal_inputs_missing";
    nextLocalAction:
      | "build_fresh_nshap_harness_after_confirmation_else_continue_mhas_function"
      | "recover_score_bearing_signal_inputs";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1018: false;
  };
}

export async function runR1018ScoreBearingModelSignalReceipt(
  options: R1018ScoreBearingModelSignalReceiptOptions = {},
): Promise<{ output: R1018ScoreBearingModelSignalReceiptOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const midusBestSignal = bestSignalAgainstReference(inputs.midus2LocalBenchmark, {
    allowedCandidates: [
      "glycemia_only_no_crp",
      "glycemia_body_no_crp",
      "lab5_lipid_body_no_crp",
      "clinical_core_labs_no_albumin_no_crp",
    ],
    referenceId: "age_sex_reference",
    supportiveVerdict: "supportive_internal_only",
  });
  const crelesBestSignal = bestSignalAgainstReference(inputs.crelesLocalBenchmark, {
    allowedCandidates: [
      "glycemia_only_no_crp",
      "glycemia_body_no_crp",
      "lab5_lipid_body_no_crp",
      "bp_lipid_body_no_crp",
      "extended_clinical_no_crp",
    ],
    referenceId: "age_sex_reference",
    supportiveVerdict: "supportive_shadow_external_validation_only",
  });
  const transportSignal = transportSignalAgainstTargetReference(inputs.midus2CrelesTransportBenchmark);
  const functionSidecarStatus =
    readStringAt(inputs.r1012CrossSourceFunctionConsistency, ["summary", "conclusion"])
      === "function_disability_lead_sidecar_supported_pending_fresh_nshap"
      ? "lead_diagnostic_supported_pending_fresh_nshap"
      : "hold_pending_support_or_missing";
  const nshapFreshHarnessState =
    readStringAt(inputs.r1017ExpandedDataExecutionState, ["executionState", "nshapFreshHarnessState"])
      ?? "missing";
  const requiredSignalsAvailable = midusBestSignal.signalVerdict !== "missing"
    && crelesBestSignal.signalVerdict !== "missing"
    && transportSignal.status !== "missing"
    && functionSidecarStatus === "lead_diagnostic_supported_pending_fresh_nshap";
  const conclusion = requiredSignalsAvailable
    ? "function_lead_glycemia_shadow_broad_labs_hold"
    : "score_bearing_signal_inputs_missing";

  const output: R1018ScoreBearingModelSignalReceiptOutput = {
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
      rowParsingPerformedByR1018: false,
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
    modelSignalState: {
      bloodworkBodyPolicy: "shadow_research_not_promotable",
      broadLabPolicy: "deprioritize_until_transport_confirmed",
      crelesBestSignal,
      functionSidecarStatus,
      midusBestSignal,
      nextProposalBatch: requiredSignalsAvailable
        ? "function_lead_with_glycemia_shadow_no_product"
        : "recover_missing_score_bearing_inputs",
      nshapFreshHarnessState: isNshapHarnessState(nshapFreshHarnessState)
        ? nshapFreshHarnessState
        : "missing",
      productDisplayAuthorized: false,
      reviewGptNextUse: "meaningful_aggregate_delta_or_model_family_fork_only",
      transportSignal,
      wearablePolicy: "shadow_only_no_score_bearing_increment",
    },
    nextActions: [
      {
        actionId: "keep_function_disability_as_research_lead",
        owner: "local_codex",
        status: functionSidecarStatus === "lead_diagnostic_supported_pending_fresh_nshap"
          ? "runnable"
          : "blocked",
        why: "Function/disability remains the best-supported diagnostic sidecar until fresh NSHAP falsification is available.",
      },
      {
        actionId: "carry_compact_glycemia_as_shadow_external_validation_candidate",
        owner: "local_codex",
        status: crelesBestSignal.candidateId.includes("glycemia") ? "runnable" : "held",
        why: "CRELES supports compact glycemia variants, but MIDUS-to-CRELES transport is still not confirmed.",
      },
      {
        actionId: "hold_broad_bloodwork_expansion",
        owner: "local_codex",
        status: "held",
        why: "Broader lab/body/lipid expansion is not justified while cross-cohort transport fails to beat the target age/sex reference.",
      },
      {
        actionId: "build_fresh_nshap_function_cognition_harness_after_confirmation",
        owner: "local_codex",
        status: nshapFreshHarnessState === "ready_after_confirmation_no_scoring"
          ? "runnable"
          : "blocked",
        why: "Fresh NSHAP is the next decisive falsification lane, but it must wait for local source confirmation.",
      },
      {
        actionId: "send_to_reviewgpt_after_new_aggregate_delta",
        owner: "reviewgpt",
        status: "held",
        why: "ReviewGPT should critique major result deltas or model-family forks, not local reducer plumbing.",
      },
    ],
    packetId: "r1018-score-bearing-model-signal-receipt",
    productPolicy: {
      displayAuthorized: false,
      productClaimsAuthorized: false,
      promotionAuthorized: false,
    },
    schemaVersion: R1018_SCORE_BEARING_MODEL_SIGNAL_RECEIPT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextLocalAction: conclusion === "function_lead_glycemia_shadow_broad_labs_hold"
        ? "build_fresh_nshap_harness_after_confirmation_else_continue_mhas_function"
        : "recover_score_bearing_signal_inputs",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1018: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1018Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1018 score-bearing model signal receipt failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1018ScoreBearingModelSignalReceiptOptions): Promise<Inputs> {
  return {
    midus2LocalBenchmark: await readJsonIfPresent(
      options.midus2Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-local-benchmark.latest.json"),
    ),
    crelesLocalBenchmark: await readJsonIfPresent(
      options.crelesPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "creles-local-benchmark.latest.json"),
    ),
    midus2CrelesTransportBenchmark: await readJsonIfPresent(
      options.transportPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-creles-transport-benchmark.latest.json"),
    ),
    r399LayeringReadiness: await readJsonIfPresent(
      options.r399Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r399-layering-readiness.latest.json"),
    ),
    r600AggregateResultsPacket: await readJsonIfPresent(
      options.r600Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r600-aggregate-results-packet.latest.json"),
    ),
    r987CrelesGlycemiaReceipt: await readJsonIfPresent(
      options.r987Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r987-creles-glycemia-receipt-reducer.latest.json"),
    ),
    r1012CrossSourceFunctionConsistency: await readJsonIfPresent(
      options.r1012Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1012-cross-source-function-consistency.latest.json"),
    ),
    r1013BiomarkerShadowLayerState: await readJsonIfPresent(
      options.r1013Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1013-biomarker-shadow-layer-state.latest.json"),
    ),
    r1017ExpandedDataExecutionState: await readJsonIfPresent(
      options.r1017Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1017-expanded-data-execution-state.latest.json"),
    ),
  };
}

function validateInputs(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1018 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Inputs): Record<ArtifactKey, ArtifactSummary> {
  return {
    crelesLocalBenchmark: summarizeArtifact("crelesLocalBenchmark", inputs.crelesLocalBenchmark),
    midus2CrelesTransportBenchmark: summarizeArtifact(
      "midus2CrelesTransportBenchmark",
      inputs.midus2CrelesTransportBenchmark,
    ),
    midus2LocalBenchmark: summarizeArtifact("midus2LocalBenchmark", inputs.midus2LocalBenchmark),
    r399LayeringReadiness: summarizeArtifact("r399LayeringReadiness", inputs.r399LayeringReadiness),
    r600AggregateResultsPacket: summarizeArtifact("r600AggregateResultsPacket", inputs.r600AggregateResultsPacket),
    r987CrelesGlycemiaReceipt: summarizeArtifact("r987CrelesGlycemiaReceipt", inputs.r987CrelesGlycemiaReceipt),
    r1012CrossSourceFunctionConsistency: summarizeArtifact(
      "r1012CrossSourceFunctionConsistency",
      inputs.r1012CrossSourceFunctionConsistency,
    ),
    r1013BiomarkerShadowLayerState: summarizeArtifact(
      "r1013BiomarkerShadowLayerState",
      inputs.r1013BiomarkerShadowLayerState,
    ),
    r1017ExpandedDataExecutionState: summarizeArtifact(
      "r1017ExpandedDataExecutionState",
      inputs.r1017ExpandedDataExecutionState,
    ),
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

function bestSignalAgainstReference(
  value: unknown | null,
  input: {
    allowedCandidates: string[];
    referenceId: string;
    supportiveVerdict: Exclude<SignalVerdict, "missing" | "not_confirmed_transport">;
  },
): CandidateSignal {
  const models = optionalRecord(readAt(value, ["models"]));
  const reference = models ? metricAt(models[input.referenceId], ["splitMetrics", "test"]) : null;
  if (!models || !reference) return missingCandidate();

  let best: CandidateSignal | null = null;
  for (const candidateId of input.allowedCandidates) {
    const metrics = metricAt(models[candidateId], ["splitMetrics", "test"]);
    if (!metrics) continue;
    const delta = metricDelta(metrics, reference);
    const signalVerdict = properScoresImprove(delta) && aucDoesNotDegrade(delta)
      ? input.supportiveVerdict
      : "not_supportive_or_deprioritize";
    const signal: CandidateSignal = {
      candidateId,
      metricDeltaVsReference: delta,
      metrics,
      signalVerdict,
    };
    if (!best || rankSignal(signal) > rankSignal(best)) best = signal;
  }
  return best ?? missingCandidate();
}

function transportSignalAgainstTargetReference(
  value: unknown | null,
): R1018ScoreBearingModelSignalReceiptOutput["modelSignalState"]["transportSignal"] {
  const source = metricAt(value, ["transportModels", "midus2_lab5_source_creles_recalibrated", "splitMetrics", "test"])
    ?? metricAt(value, ["transportModels", "midus2_lab5_source_creles_recalibrated", "test"]);
  const reference = metricAt(value, ["transportModels", "creles_age_sex_reference", "splitMetrics", "test"])
    ?? metricAt(value, ["transportModels", "creles_age_sex_reference", "test"]);
  if (!source || !reference) {
    return {
      metricDeltaVsTargetReference: nullDelta(),
      status: "missing",
    };
  }
  const delta = metricDelta(source, reference);
  const status = properScoresImprove(delta) && aucDoesNotDegrade(delta) ? "confirmed" : "not_confirmed";
  return {
    metricDeltaVsTargetReference: delta,
    status,
  };
}

function metricAt(value: unknown, pathParts: string[]): MetricSummary | null {
  const current = readAt(value, pathParts);
  const record = optionalRecord(current);
  if (!record) return null;
  return {
    auc: readNumber(record.auc),
    brier: readNumber(record.brier),
    logLoss: readNumber(record.logLoss),
    meanPrediction: readNumber(record.meanPrediction),
    observedRate: readNumber(record.observedRate),
  };
}

function metricDelta(candidate: MetricSummary, reference: MetricSummary): MetricDelta {
  return {
    aucDelta: candidate.auc !== null && reference.auc !== null ? round(candidate.auc - reference.auc) : null,
    brierDelta: candidate.brier !== null && reference.brier !== null ? round(candidate.brier - reference.brier) : null,
    logLossDelta: candidate.logLoss !== null && reference.logLoss !== null
      ? round(candidate.logLoss - reference.logLoss)
      : null,
  };
}

function missingCandidate(): CandidateSignal {
  return {
    candidateId: "missing",
    metricDeltaVsReference: nullDelta(),
    metrics: {
      auc: null,
      brier: null,
      logLoss: null,
      meanPrediction: null,
      observedRate: null,
    },
    signalVerdict: "missing",
  };
}

function nullDelta(): MetricDelta {
  return {
    aucDelta: null,
    brierDelta: null,
    logLossDelta: null,
  };
}

function rankSignal(signal: CandidateSignal): number {
  const verdictWeight = signal.signalVerdict === "not_supportive_or_deprioritize" ? -1 : 1;
  const auc = signal.metricDeltaVsReference.aucDelta ?? 0;
  const brier = signal.metricDeltaVsReference.brierDelta ?? 0;
  const logLoss = signal.metricDeltaVsReference.logLossDelta ?? 0;
  return verdictWeight * 100 + auc * 10 - brier * 100 - logLoss * 20;
}

function properScoresImprove(delta: MetricDelta): boolean {
  return (delta.brierDelta ?? 1) < 0 && (delta.logLossDelta ?? 1) < 0;
}

function aucDoesNotDegrade(delta: MetricDelta): boolean {
  return delta.aucDelta === null || delta.aucDelta >= 0;
}

function isNshapHarnessState(value: string): value is R1018ScoreBearingModelSignalReceiptOutput["modelSignalState"]["nshapFreshHarnessState"] {
  return value === "blocked_source_confirmation" || value === "ready_after_confirmation_no_scoring" || value === "missing";
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

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function findForbiddenR1018Output(output: R1018ScoreBearingModelSignalReceiptOutput): string[] {
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
  const { output } = await runR1018ScoreBearingModelSignalReceipt({
    crelesPath: process.env.MURPH_AGE_CRELES_BENCHMARK_PATH,
    midus2Path: process.env.MURPH_AGE_MIDUS2_BENCHMARK_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r399Path: process.env.MURPH_AGE_R399_LAYERING_READINESS_PATH,
    r600Path: process.env.MURPH_AGE_R600_AGGREGATE_RESULTS_PACKET_PATH,
    r987Path: process.env.MURPH_AGE_R987_CRELES_GLYCEMIA_RECEIPT_PATH,
    r1012Path: process.env.MURPH_AGE_R1012_CROSS_SOURCE_FUNCTION_PATH,
    r1013Path: process.env.MURPH_AGE_R1013_BIOMARKER_SHADOW_STATE_PATH,
    r1017Path: process.env.MURPH_AGE_R1017_EXPANDED_DATA_EXECUTION_STATE_PATH,
    transportPath: process.env.MURPH_AGE_TRANSPORT_BENCHMARK_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    broadLabPolicy: output.modelSignalState.broadLabPolicy,
    conclusion: output.summary.conclusion,
    crelesBestCandidate: output.modelSignalState.crelesBestSignal.candidateId,
    functionSidecarStatus: output.modelSignalState.functionSidecarStatus,
    midusBestCandidate: output.modelSignalState.midusBestSignal.candidateId,
    nextLocalAction: output.summary.nextLocalAction,
    nextProposalBatch: output.modelSignalState.nextProposalBatch,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    rowParsingPerformedByR1018: output.summary.rowParsingPerformedByR1018,
    schemaVersion: output.schemaVersion,
    status: output.status,
    transportStatus: output.modelSignalState.transportSignal.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1018 score-bearing model signal receipt failed."}\n`);
    process.exit(1);
  });
}
