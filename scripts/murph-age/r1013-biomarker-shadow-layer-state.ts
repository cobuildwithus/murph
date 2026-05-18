import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1013_BIOMARKER_SHADOW_LAYER_STATE_SCHEMA_VERSION =
  "murph-age-r1013-biomarker-shadow-layer-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1013-biomarker-shadow-layer-state.latest.json";

type ArtifactKey =
  | "r399LayeringReadiness"
  | "r600AggregateResultsPacket"
  | "r612NhanesLayeringMap"
  | "r1012CrossSourceFunctionConsistency"
  | "midusCoreBenchmark"
  | "midusRefresherBenchmark"
  | "crelesBenchmark"
  | "transportBenchmark";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface Inputs {
  crelesBenchmark: unknown | null;
  midusCoreBenchmark: unknown | null;
  midusRefresherBenchmark: unknown | null;
  r399LayeringReadiness: unknown | null;
  r600AggregateResultsPacket: unknown | null;
  r612NhanesLayeringMap: unknown | null;
  r1012CrossSourceFunctionConsistency: unknown | null;
  transportBenchmark: unknown | null;
}

export interface R1013BiomarkerShadowLayerStateOptions {
  createdAt?: string;
  crelesPath?: string;
  midusCorePath?: string;
  midusRefresherPath?: string;
  outputDir?: string;
  r399Path?: string;
  r600Path?: string;
  r612Path?: string;
  r1012Path?: string;
  transportPath?: string;
}

export interface R1013BiomarkerShadowLayerStateOutput {
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
    rowParsingPerformedByR1013: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  biomarkerShadowState: {
    bloodworkBodyStatus:
      | "shadow_research_layer_not_promotable"
      | "hold_missing_aggregate_context";
    bestInternalCandidate: string | null;
    broadLabsPolicy: "hold_or_kill_until_transport_confirmed";
    crelesSignal: "glycemia_shadow_supportive_body_not_confirmed" | "not_available";
    midusSignal: "weak_internal_signal_not_promotable" | "not_available";
    nhanesLayerRole: "lab_bp_body_research_context_only" | "not_available";
    transportStatus: "not_confirmed" | "confirmed";
    wearableStatus: "hold_shadow_context_only";
  };
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextActions: Array<{
    actionId:
      | "keep_biomarker_body_as_shadow_layer"
      | "use_nhanes_only_as_same_family_lab_context"
      | "wait_for_fresh_nshap_function_cognition_before_biomarker_expansion"
      | "send_biomarker_transport_to_reviewgpt_only_after_new_aggregate_delta";
    owner: "local_codex" | "reviewgpt";
    priority: "p0" | "p1" | "p2";
    status: "runnable" | "held";
    why: string;
  }>;
  packetId: "r1013-biomarker-shadow-layer-state";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  schemaVersion: typeof R1013_BIOMARKER_SHADOW_LAYER_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "biomarker_body_shadow_layer_mapped_not_promotable"
      | "biomarker_body_shadow_layer_hold_missing_context";
    nextLocalAction:
      | "keep_biomarker_body_shadow_while_nshap_function_falsification_runs"
      | "recover_biomarker_shadow_inputs";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1013: false;
  };
}

export async function runR1013BiomarkerShadowLayerState(
  options: R1013BiomarkerShadowLayerStateOptions = {},
): Promise<{ output: R1013BiomarkerShadowLayerStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const r600Conclusion = readStringAt(inputs.r600AggregateResultsPacket, ["summary", "conclusion"]);
  const r600BestCandidate = readStringAt(inputs.r600AggregateResultsPacket, ["summary", "bestCurrentCandidate"]);
  const r612Layer = readStringAt(inputs.r612NhanesLayeringMap, ["summary", "scoreBearingResearchLayer"]);
  const transportConfirmed = readStringAt(inputs.r399LayeringReadiness, [
    "gates",
    "biomarkerTransportConfirmed",
    "status",
  ]) === "passed";
  const crelesGlycemiaSupportive = hasCrelesGlycemiaShadowSignal(inputs.crelesBenchmark);
  const functionFalsificationPending = readStringAt(inputs.r1012CrossSourceFunctionConsistency, [
    "summary",
    "nextLocalAction",
  ]) === "complete_nshap_source_confirmation_then_run_fresh_function_cognition";
  const contextAvailable = r600Conclusion !== null || r612Layer !== null || inputs.r399LayeringReadiness !== null;
  const bloodworkBodyStatus = contextAvailable
    ? "shadow_research_layer_not_promotable"
    : "hold_missing_aggregate_context";

  const output: R1013BiomarkerShadowLayerStateOutput = {
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
      rowParsingPerformedByR1013: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    biomarkerShadowState: {
      bestInternalCandidate: r600BestCandidate,
      bloodworkBodyStatus,
      broadLabsPolicy: "hold_or_kill_until_transport_confirmed",
      crelesSignal: crelesGlycemiaSupportive ? "glycemia_shadow_supportive_body_not_confirmed" : "not_available",
      midusSignal: r600Conclusion === "weak_internal_signal_not_promotable"
        ? "weak_internal_signal_not_promotable"
        : "not_available",
      nhanesLayerRole: r612Layer === "lab_bp_body" ? "lab_bp_body_research_context_only" : "not_available",
      transportStatus: transportConfirmed ? "confirmed" : "not_confirmed",
      wearableStatus: "hold_shadow_context_only",
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    nextActions: [
      {
        actionId: "keep_biomarker_body_as_shadow_layer",
        owner: "local_codex",
        priority: "p0",
        status: contextAvailable ? "runnable" : "held",
        why: "Internal lab/body evidence is useful context but is not transport-confirmed or product-promotable.",
      },
      {
        actionId: "use_nhanes_only_as_same_family_lab_context",
        owner: "local_codex",
        priority: "p1",
        status: r612Layer === "lab_bp_body" ? "runnable" : "held",
        why: "NHANES can keep lab/unit/context plumbing honest but should not become the live external validation target.",
      },
      {
        actionId: "wait_for_fresh_nshap_function_cognition_before_biomarker_expansion",
        owner: "local_codex",
        priority: "p1",
        status: functionFalsificationPending ? "runnable" : "held",
        why: "The current lead sidecar should be falsified in the next source before reopening broad biomarker expansion.",
      },
      {
        actionId: "send_biomarker_transport_to_reviewgpt_only_after_new_aggregate_delta",
        owner: "reviewgpt",
        priority: "p2",
        status: "held",
        why: "ReviewGPT should review meaningful aggregate biomarker deltas, not bless a shadow-layer bookkeeping receipt.",
      },
    ],
    packetId: "r1013-biomarker-shadow-layer-state",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    schemaVersion: R1013_BIOMARKER_SHADOW_LAYER_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: bloodworkBodyStatus === "shadow_research_layer_not_promotable"
        ? "biomarker_body_shadow_layer_mapped_not_promotable"
        : "biomarker_body_shadow_layer_hold_missing_context",
      nextLocalAction: bloodworkBodyStatus === "shadow_research_layer_not_promotable"
        ? "keep_biomarker_body_shadow_while_nshap_function_falsification_runs"
        : "recover_biomarker_shadow_inputs",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1013: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1013Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1013 biomarker shadow layer state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1013BiomarkerShadowLayerStateOptions): Promise<Inputs> {
  return {
    crelesBenchmark: await readJsonIfPresent(
      options.crelesPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "creles-local-benchmark.latest.json"),
    ),
    midusCoreBenchmark: await readJsonIfPresent(
      options.midusCorePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-local-benchmark.latest.json"),
    ),
    midusRefresherBenchmark: await readJsonIfPresent(
      options.midusRefresherPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r399-midus-refresher-biomarker-increment.latest.json"),
    ),
    r399LayeringReadiness: await readJsonIfPresent(
      options.r399Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r399-layering-readiness.latest.json"),
    ),
    r600AggregateResultsPacket: await readJsonIfPresent(
      options.r600Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r600-aggregate-results-packet.latest.json"),
    ),
    r612NhanesLayeringMap: await readJsonIfPresent(
      options.r612Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r612-nhanes-layering-map.latest.json"),
    ),
    r1012CrossSourceFunctionConsistency: await readJsonIfPresent(
      options.r1012Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1012-cross-source-function-consistency.latest.json"),
    ),
    transportBenchmark: await readJsonIfPresent(
      options.transportPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-creles-transport-benchmark.latest.json"),
    ),
  };
}

function validateInputs(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1013 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function hasCrelesGlycemiaShadowSignal(value: unknown | null): boolean {
  const models = optionalRecord(readAt(value, ["models"]));
  if (!models) return false;
  const reference = readMetricRecord(models.age_sex_reference);
  const glycemia = readMetricRecord(models.glycemia_only_no_crp);
  if (!reference || !glycemia) return false;
  return glycemia.brier < reference.brier && glycemia.logLoss < reference.logLoss;
}

function readMetricRecord(value: unknown): { brier: number; logLoss: number } | null {
  const record = optionalRecord(value);
  const metrics = optionalRecord(record?.metrics) ?? optionalRecord(readAt(record, ["splitMetrics", "test"])) ?? record;
  const brier = typeof metrics?.brier === "number" ? metrics.brier : null;
  const logLoss = typeof metrics?.logLoss === "number" ? metrics.logLoss : null;
  return brier !== null && logLoss !== null ? { brier, logLoss } : null;
}

function summarizeInputs(inputs: Inputs): Record<ArtifactKey, ArtifactSummary> {
  return {
    crelesBenchmark: summarizeArtifact("crelesBenchmark", inputs.crelesBenchmark),
    midusCoreBenchmark: summarizeArtifact("midusCoreBenchmark", inputs.midusCoreBenchmark),
    midusRefresherBenchmark: summarizeArtifact("midusRefresherBenchmark", inputs.midusRefresherBenchmark),
    r399LayeringReadiness: summarizeArtifact("r399LayeringReadiness", inputs.r399LayeringReadiness),
    r600AggregateResultsPacket: summarizeArtifact("r600AggregateResultsPacket", inputs.r600AggregateResultsPacket),
    r612NhanesLayeringMap: summarizeArtifact("r612NhanesLayeringMap", inputs.r612NhanesLayeringMap),
    r1012CrossSourceFunctionConsistency: summarizeArtifact(
      "r1012CrossSourceFunctionConsistency",
      inputs.r1012CrossSourceFunctionConsistency,
    ),
    transportBenchmark: summarizeArtifact("transportBenchmark", inputs.transportBenchmark),
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

function findForbiddenR1013Output(output: R1013BiomarkerShadowLayerStateOutput): string[] {
  const encoded = JSON.stringify(output);
  const findings: string[] = [];
  if (/[A-Za-z]:[\\/]|(?:^|")\/(?:Users|home|tmp|var)\//u.test(encoded)) {
    findings.push("output contains path-like local text");
  }
  if (/Downloads|external-sources|cache-entry|\.dta|\.zip|\.rar|\.pdf|latest\.json|ICPSR_/u.test(encoded)) {
    findings.push("output contains local source file/cache text");
  }
  if (/field_names_private|fit_params_private_only|calibration_params_private_only|model_artifact_manifest_private/u.test(encoded)) {
    findings.push("output contains private-state implementation fields");
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
  const { output } = await runR1013BiomarkerShadowLayerState({
    crelesPath: process.env.MURPH_AGE_CRELES_BENCHMARK_PATH,
    midusCorePath: process.env.MURPH_AGE_MIDUS_CORE_BENCHMARK_PATH,
    midusRefresherPath: process.env.MURPH_AGE_MIDUS_REFRESHER_BENCHMARK_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r399Path: process.env.MURPH_AGE_R399_LAYERING_READINESS_PATH,
    r600Path: process.env.MURPH_AGE_R600_AGGREGATE_RESULTS_PACKET_PATH,
    r612Path: process.env.MURPH_AGE_R612_NHANES_LAYERING_MAP_PATH,
    r1012Path: process.env.MURPH_AGE_R1012_CROSS_SOURCE_FUNCTION_PATH,
    transportPath: process.env.MURPH_AGE_TRANSPORT_BENCHMARK_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    bloodworkBodyStatus: output.biomarkerShadowState.bloodworkBodyStatus,
    conclusion: output.summary.conclusion,
    crelesSignal: output.biomarkerShadowState.crelesSignal,
    midusSignal: output.biomarkerShadowState.midusSignal,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    rowParsingPerformedByR1013: output.summary.rowParsingPerformedByR1013,
    schemaVersion: output.schemaVersion,
    status: output.status,
    transportStatus: output.biomarkerShadowState.transportStatus,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1013 biomarker shadow layer state failed."}\n`);
    process.exit(1);
  });
}
