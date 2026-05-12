import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R976_EXTERNAL_GENERALIZATION_EVALUATOR_SCHEMA_VERSION =
  "murph-age-r976-external-generalization-evaluator.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r976-external-generalization-evaluator.latest.json";
const MINIMUM_CELL_THRESHOLD = 10;

type ArtifactKey = "sourceLocalBenchmark" | "transportBenchmark" | "crossSourceActivationMatrix";
type ArtifactStatus = "available" | "missing";
type MetricStatus = "available_from_aggregate_artifact" | "missing" | "suppressed_small_cell";
type SplitKey = "calibration" | "test" | "train";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface MetricValues {
  auc: number | null;
  brier: number;
  logLoss: number;
  meanPrediction: number;
  observedRate: number;
}

interface MetricSlot {
  countBands: {
    eventCount: string;
    rows: string;
  };
  metricSource: "precomputed_aggregate_artifact" | "not_computed_by_r976";
  status: MetricStatus;
  values: MetricValues | null;
}

interface CandidateFamilySlot {
  calibrationPolicy: string | null;
  candidateFamilyId: string;
  candidateRole: string;
  metricSlots: Partial<Record<SplitKey, MetricSlot>>;
  variableListsStored: false;
}

export interface R976ExternalGeneralizationEvaluatorOptions {
  activationMatrixPath?: string;
  createdAt?: string;
  outputDir?: string;
  sourceLocalBenchmarkPath?: string;
  transportBenchmarkPath?: string;
}

export interface R976ExternalGeneralizationEvaluatorOutput {
  artifactBoundary: {
    aggregateOnly: true;
    calibrationParametersStored: false;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    metricComputationPerformedByR976: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR976: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    protocolClaimsIncluded: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR976: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitIdentifiersStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  evaluatorMode: {
    actualMetricComputationByR976: false;
    metricSlotPolicy: "copy_precomputed_aggregate_metrics_or_mark_missing";
    reason: string;
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  minimumCellThreshold: typeof MINIMUM_CELL_THRESHOLD;
  missingnessAndAbstention: {
    abstentionCountBand: string;
    completeCaseRowsBand: string;
    excludedFollowupRowsBand: string;
    knownStatusRowsBand: string;
    missingFeatureExcludedRowsBand: string;
    policy: "bands_only_small_cells_suppressed";
  };
  packetId: "r976-external-generalization-evaluator";
  schemaVersion: typeof R976_EXTERNAL_GENERALIZATION_EVALUATOR_SCHEMA_VERSION;
  sourceAgeSexReference: {
    metricSlots: Partial<Record<SplitKey, MetricSlot>>;
    referenceId: string;
    status: "available" | "missing";
  };
  sourceCalibratedDiagnostic: {
    calibrationParametersStored: false;
    calibrationPolicy: string | null;
    comparisonVsAgeSexReference: {
      aucDelta: number | null;
      brierDelta: number | null;
      logLossDelta: number | null;
      status: "available_from_aggregate_artifact" | "missing";
    };
    diagnosticId: string;
    metricSlots: Partial<Record<SplitKey, MetricSlot>>;
    status: "available" | "missing";
  };
  status: "research-local-aggregate-only" | "blocked-missing-aggregate-artifacts";
  summary: {
    conclusion: "external_generalization_slots_ready" | "external_generalization_manifest_only";
    metricBearingCandidateFamilyCountBand: string;
    nextAction: "review_aggregate_external_generalization_slots" | "refresh_required_aggregate_artifacts";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
  };
  transportedCandidateFamilies: CandidateFamilySlot[];
}

export async function runR976ExternalGeneralizationEvaluator(
  options: R976ExternalGeneralizationEvaluatorOptions = {},
): Promise<{ output: R976ExternalGeneralizationEvaluatorOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const transportRoot = optionalRecord(inputs.transportBenchmark);
  const sourceRoot = optionalRecord(inputs.sourceLocalBenchmark);
  const sourceAgeSexReference = buildSourceAgeSexReference(sourceRoot, transportRoot);
  const transportedCandidateFamilies = buildTransportedCandidateFamilies(transportRoot);
  const sourceCalibratedDiagnostic = buildSourceCalibratedDiagnostic(transportRoot);
  const metricBearingCandidateCount = transportedCandidateFamilies.filter((candidate) =>
    Object.values(candidate.metricSlots).some((slot) => slot.status === "available_from_aggregate_artifact")
  ).length;
  const hasRequiredSlots = sourceAgeSexReference.status === "available" && sourceCalibratedDiagnostic.status === "available";

  const output: R976ExternalGeneralizationEvaluatorOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      calibrationParametersStored: false,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      metricComputationPerformedByR976: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR976: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      protocolClaimsIncluded: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR976: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitIdentifiersStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    evaluatorMode: {
      actualMetricComputationByR976: false,
      metricSlotPolicy: "copy_precomputed_aggregate_metrics_or_mark_missing",
      reason: "R976 is a local evaluator scaffold. It does not parse rows, score models, fit calibration, or compute metrics; it only reduces already aggregate artifacts into suppressed metric slots.",
    },
    inputArtifacts: summarizeInputs(inputs),
    minimumCellThreshold: MINIMUM_CELL_THRESHOLD,
    missingnessAndAbstention: summarizeMissingnessAndAbstention(transportRoot),
    packetId: "r976-external-generalization-evaluator",
    schemaVersion: R976_EXTERNAL_GENERALIZATION_EVALUATOR_SCHEMA_VERSION,
    sourceAgeSexReference,
    sourceCalibratedDiagnostic,
    status: hasRequiredSlots ? "research-local-aggregate-only" : "blocked-missing-aggregate-artifacts",
    summary: {
      conclusion: hasRequiredSlots ? "external_generalization_slots_ready" : "external_generalization_manifest_only",
      metricBearingCandidateFamilyCountBand: itemCountBand(metricBearingCandidateCount),
      nextAction: hasRequiredSlots ? "review_aggregate_external_generalization_slots" : "refresh_required_aggregate_artifacts",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
    },
    transportedCandidateFamilies,
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR976Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R976 external generalization evaluator failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R976ExternalGeneralizationEvaluatorOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    crossSourceActivationMatrix: await readJsonIfPresent(
      options.activationMatrixPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r615-cross-source-activation-matrix.latest.json"),
    ),
    sourceLocalBenchmark: await readJsonIfPresent(
      options.sourceLocalBenchmarkPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "creles-local-benchmark.latest.json"),
    ),
    transportBenchmark: await readJsonIfPresent(
      options.transportBenchmarkPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-creles-transport-benchmark.latest.json"),
    ),
  };
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    crossSourceActivationMatrix: summarizeArtifact(
      "r615-cross-source-activation-matrix.latest.json",
      inputs.crossSourceActivationMatrix,
    ),
    sourceLocalBenchmark: summarizeArtifact("creles-local-benchmark.latest.json", inputs.sourceLocalBenchmark),
    transportBenchmark: summarizeArtifact("midus2-creles-transport-benchmark.latest.json", inputs.transportBenchmark),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, artifact);
  return {
    artifact,
    packetId: optionalMetadataLabel(root.packetId, `${artifact} packet id`)
      ?? optionalMetadataLabel(root.benchmarkId, `${artifact} benchmark id`),
    schemaVersion: optionalMetadataLabel(root.schemaVersion, `${artifact} schema version`),
    status: "available",
  };
}

function buildSourceAgeSexReference(
  sourceRoot: Record<string, unknown> | null,
  transportRoot: Record<string, unknown> | null,
): R976ExternalGeneralizationEvaluatorOutput["sourceAgeSexReference"] {
  const sourceModels = optionalRecord(sourceRoot?.models);
  const sourceReference = optionalRecord(sourceModels?.age_sex_reference);
  if (sourceReference) {
    return {
      metricSlots: metricSlotsFromModel(sourceReference),
      referenceId: "age_sex_reference",
      status: "available",
    };
  }

  const transportModels = optionalRecord(transportRoot?.transportModels);
  const transportReference = optionalRecord(transportModels?.creles_age_sex_reference);
  if (transportReference) {
    return {
      metricSlots: metricSlotsFromModel(transportReference),
      referenceId: "creles_age_sex_reference",
      status: "available",
    };
  }

  return {
    metricSlots: {},
    referenceId: "age_sex_reference",
    status: "missing",
  };
}

function buildTransportedCandidateFamilies(transportRoot: Record<string, unknown> | null): CandidateFamilySlot[] {
  const models = optionalRecord(transportRoot?.transportModels);
  if (!models) return [];
  return Object.entries(models).map(([candidateFamilyId, value]) => {
    const model = requiredRecord(value, `${candidateFamilyId} transport model`);
    return {
      calibrationPolicy: optionalMetadataLabel(model.calibrationPolicy, `${candidateFamilyId} calibration policy`),
      candidateFamilyId: requiredMetadataLabel(candidateFamilyId, `${candidateFamilyId} candidate family id`),
      candidateRole: requiredMetadataLabel(model.candidateRole, `${candidateFamilyId} candidate role`),
      metricSlots: metricSlotsFromModel(model),
      variableListsStored: false as const,
    };
  }).sort((left, right) => left.candidateFamilyId.localeCompare(right.candidateFamilyId));
}

function buildSourceCalibratedDiagnostic(
  transportRoot: Record<string, unknown> | null,
): R976ExternalGeneralizationEvaluatorOutput["sourceCalibratedDiagnostic"] {
  const models = optionalRecord(transportRoot?.transportModels);
  const diagnostic = optionalRecord(models?.midus2_lab5_source_creles_recalibrated);
  const reference = optionalRecord(models?.creles_age_sex_reference);
  const diagnosticSlots = diagnostic ? metricSlotsFromModel(diagnostic) : {};
  const referenceSlots = reference ? metricSlotsFromModel(reference) : {};
  const diagnosticTest = diagnosticSlots.test;
  const referenceTest = referenceSlots.test;

  return {
    calibrationParametersStored: false,
    calibrationPolicy: diagnostic
      ? optionalMetadataLabel(diagnostic.calibrationPolicy, "source-calibrated diagnostic calibration policy")
      : null,
    comparisonVsAgeSexReference: compareMetricSlots(diagnosticTest, referenceTest),
    diagnosticId: "midus2_lab5_source_creles_recalibrated",
    metricSlots: diagnosticSlots,
    status: diagnostic ? "available" : "missing",
  };
}

function compareMetricSlots(
  diagnostic: MetricSlot | undefined,
  reference: MetricSlot | undefined,
): R976ExternalGeneralizationEvaluatorOutput["sourceCalibratedDiagnostic"]["comparisonVsAgeSexReference"] {
  if (
    diagnostic?.status !== "available_from_aggregate_artifact"
    || reference?.status !== "available_from_aggregate_artifact"
    || !diagnostic.values
    || !reference.values
  ) {
    return {
      aucDelta: null,
      brierDelta: null,
      logLossDelta: null,
      status: "missing",
    };
  }
  return {
    aucDelta: diagnostic.values.auc === null || reference.values.auc === null
      ? null
      : roundMetric(diagnostic.values.auc - reference.values.auc),
    brierDelta: roundMetric(diagnostic.values.brier - reference.values.brier),
    logLossDelta: roundMetric(diagnostic.values.logLoss - reference.values.logLoss),
    status: "available_from_aggregate_artifact",
  };
}

function summarizeMissingnessAndAbstention(
  transportRoot: Record<string, unknown> | null,
): R976ExternalGeneralizationEvaluatorOutput["missingnessAndAbstention"] {
  const shape = optionalRecord(transportRoot?.targetDataShape);
  const known = optionalNumber(shape?.knownStatusRows);
  const complete = optionalNumber(shape?.completeCaseRows);
  const missingFeature = optionalNumber(shape?.missingFeatureExcludedRows);
  const excludedFollowup = optionalNumber(shape?.excludedFollowupRows);
  const abstention = known !== null && complete !== null ? Math.max(0, known - complete) : null;
  return {
    abstentionCountBand: countBand(abstention),
    completeCaseRowsBand: countBand(complete),
    excludedFollowupRowsBand: countBand(excludedFollowup),
    knownStatusRowsBand: countBand(known),
    missingFeatureExcludedRowsBand: countBand(missingFeature),
    policy: "bands_only_small_cells_suppressed",
  };
}

function metricSlotsFromModel(model: Record<string, unknown>): Partial<Record<SplitKey, MetricSlot>> {
  const splitMetrics = optionalRecord(model.splitMetrics);
  if (!splitMetrics) return {};
  const slots: Partial<Record<SplitKey, MetricSlot>> = {};
  for (const split of ["calibration", "test", "train"] as const) {
    const metric = optionalRecord(splitMetrics[split]);
    if (metric) slots[split] = metricSlot(metric);
  }
  return slots;
}

function metricSlot(metric: Record<string, unknown>): MetricSlot {
  const rows = requiredNumber(metric.n, "aggregate metric row count");
  const events = requiredNumber(metric.events, "aggregate metric event count");
  const nonEvents = rows - events;
  if (rows < MINIMUM_CELL_THRESHOLD || events < MINIMUM_CELL_THRESHOLD || nonEvents < MINIMUM_CELL_THRESHOLD) {
    return {
      countBands: {
        eventCount: countBand(events),
        rows: countBand(rows),
      },
      metricSource: "not_computed_by_r976",
      status: "suppressed_small_cell",
      values: null,
    };
  }
  return {
    countBands: {
      eventCount: countBand(events),
      rows: countBand(rows),
    },
    metricSource: "precomputed_aggregate_artifact",
    status: "available_from_aggregate_artifact",
    values: {
      auc: metric.auc === null ? null : roundMetric(requiredNumber(metric.auc, "aggregate metric auc")),
      brier: roundMetric(requiredNumber(metric.brier, "aggregate metric brier")),
      logLoss: roundMetric(requiredNumber(metric.logLoss, "aggregate metric logLoss")),
      meanPrediction: roundMetric(requiredNumber(metric.meanPrediction, "aggregate metric mean prediction")),
      observedRate: roundMetric(requiredNumber(metric.observedRate, "aggregate metric observed rate")),
    },
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`${key} failed aggregate-egress validation: ${findings.join("; ")}`);
    }
    const root = requiredRecord(value, key);
    const boundary = optionalRecord(root.boundary) ?? optionalRecord(root.artifactBoundary);
    if (!boundary) continue;
    for (const [flag, flagValue] of Object.entries(boundary)) {
      if (flag === "aggregateOnly") continue;
      if ((flag.endsWith("Stored") || flag.endsWith("Included") || flag.endsWith("Authorized")) && flagValue !== false) {
        throw new Error(`${key} boundary has unsafe boundary flag ${flag}`);
      }
    }
  }
}

function findForbiddenR976Output(value: R976ExternalGeneralizationEvaluatorOutput): string[] {
  const serialized = JSON.stringify(value);
  const findings: string[] = [];
  for (const pattern of [
    "featureKeys",
    "sourceFeatureMappingPolicy",
    "transportStressMatrix",
  ]) {
    if (serialized.includes(pattern)) findings.push(`forbidden R976 output marker ${pattern}`);
  }
  return findings;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (optionalRecord(error)?.code === "ENOENT") return null;
    throw new Error("Failed to read a Murph Age external generalization aggregate artifact.");
  }
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be a JSON object.`);
  return record;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredNumber(value: unknown, label: string): number {
  const number = optionalNumber(value);
  if (number === null) throw new Error(`${label} must be a finite number.`);
  return number;
}

function requiredMetadataLabel(value: unknown, label: string): string {
  const metadataLabel = optionalMetadataLabel(value, label);
  if (metadataLabel === null) throw new Error(`${label} is required.`);
  return metadataLabel;
}

function optionalMetadataLabel(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 128
    || /[\r\n\t/\\]/u.test(value)
    || /\b(?:authorization|codebook|coefficient|identifier|participant|prediction|raw\s*row|row\s*value|small\s*cell|source\s*body|source\s*text|split\s*id|variable)\b/iu.test(value)
  ) {
    throw new Error(`${label} is not a safe metadata label.`);
  }
  return value;
}

function countBand(count: number | null): string {
  if (count === null) return "missing";
  if (count < MINIMUM_CELL_THRESHOLD) return "suppressed_under_10";
  if (count < 50) return "10-49";
  if (count < 100) return "50-99";
  if (count < 500) return "100-499";
  if (count < 1000) return "500-999";
  if (count < 5000) return "1000-4999";
  return "5000+";
}

function itemCountBand(count: number): string {
  if (count === 0) return "0";
  if (count <= 4) return "1-4";
  if (count <= 9) return "5-9";
  return "10+";
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

async function main(): Promise<void> {
  const { output, outputPath } = await runR976ExternalGeneralizationEvaluator({
    activationMatrixPath: process.env.MURPH_AGE_R976_ACTIVATION_MATRIX_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    sourceLocalBenchmarkPath: process.env.MURPH_AGE_R976_SOURCE_BENCHMARK_PATH,
    transportBenchmarkPath: process.env.MURPH_AGE_R976_TRANSPORT_BENCHMARK_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: path.basename(outputPath),
    conclusion: output.summary.conclusion,
    metricBearingCandidateFamilyCountBand: output.summary.metricBearingCandidateFamilyCountBand,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    schemaVersion: output.schemaVersion,
    status: output.status,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "R976 external generalization evaluator failed.");
    process.exitCode = 1;
  });
}
