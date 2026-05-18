import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1138_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION =
  "murph-age-r1138-ordinary-consumer-partial-aggregate-metric-intake.v1" as const;

const PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION =
  "murph-age-ordinary-consumer-partial-aggregate-metrics.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1138-ordinary-consumer-partial-aggregate-metric-intake.latest.json";
const PARTIAL_AGGREGATE_METRICS_TEMPLATE_FILE_NAME =
  "r1138-fillable-ordinary-consumer-partial-aggregate-metrics.json";
const R1138_PARTIAL_METRIC_INTAKE_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRICS_PATH=<partial-aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1138-ordinary-consumer-partial-aggregate-metric-intake.ts" as const;

const R1137_EXPECTED = {
  artifact: "r1137-ordinary-consumer-partial-route-planner.latest.json",
  packetId: "r1137-ordinary-consumer-partial-route-planner",
  schemaVersion: "murph-age-r1137-ordinary-consumer-partial-route-planner.v1",
} as const;
const PARTIAL_ROUTE_DEFINITIONS = [
  {
    candidateIds: ["L1_tiny_glycemia_only"],
    routeId: "lab_glycemia_minimum_route",
    routeKind: "partial_lab_route",
  },
  {
    candidateIds: ["L2_common_lab_core_shadow"],
    routeId: "common_lab_core_with_context_route",
    routeKind: "partial_lab_route",
  },
  {
    candidateIds: ["W1_activity_steps_minutes"],
    routeId: "wearable_activity_minimum_route",
    routeKind: "partial_wearable_route",
  },
] as const;
const PRIMARY_SUBMITTER_INPUT_FAMILY_IDS = [
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "wearable_activity_daily",
  "vitals_body_context",
] as const;

type EvidenceRole = "real_partial_route_evidence" | "synthetic_pipeline_smoke";
type PartialMetricConclusion =
  | "ordinary_partial_aggregate_metric_intake_waiting_on_route_plan"
  | "ordinary_partial_aggregate_metrics_incomplete"
  | "ordinary_partial_aggregate_metrics_missing"
  | "ordinary_partial_aggregate_metrics_recorded_not_full_evidence";
type PartialMetricNextAction =
  | "fill_partial_aggregate_metrics_template_after_route_plan"
  | "fill_safe_availability_manifest_then_run_r1136_r1137_chain"
  | "provide_complete_partial_route_aggregate_metrics"
  | "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence";
type CandidateMetricStatus = "complete" | "missing";
type RouteMetricStatus = "complete" | "incomplete";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface PartialCandidateMetric {
  aucDelta: number | null;
  brierDelta: number | null;
  calibrationStatus: string;
  candidateId: string;
  candidateKind: "lab" | "wearable";
  comparatorId: string;
  coverageStatus: string;
  evidenceSupport: string;
  logLossDelta: number | null;
  missingnessOrCoverageControlStatus: string;
}

interface PartialRouteMetricInput {
  candidateResults: PartialCandidateMetric[];
  routeId: string;
}

export interface R1138PartialAggregateMetricsInput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  evaluatorId: "ordinary_consumer_partial_route_aggregate_evaluator_v1";
  packetId: string;
  receiptAttestations: {
    aggregateOnly: true;
    endpointFrozenBeforeScoring: true;
    evaluatorFrozenBeforeExecution: true;
    noCoefficientEgress: true;
    noParticipantEgress: true;
    noPredictionEgress: true;
    noRowEgress: true;
    noSmallCellEgress: true;
    sameDenominatorComparisons: true;
  };
  routeResults: PartialRouteMetricInput[];
  schemaVersion: typeof PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION;
  submissionContext: {
    evidenceRole: EvidenceRole;
    ordinaryConsumerSubmission: true;
    outcomeLinked: true;
    partialEvidenceOnly: true;
    targetAgeBand: "roughly_16_50";
  };
}

export interface R1138OrdinaryConsumerPartialAggregateMetricIntakeOptions {
  createdAt?: string;
  outputDir?: string;
  partialAggregateMetrics?: R1138PartialAggregateMetricsInput | null;
  partialAggregateMetricsPath?: string;
  r1137Path?: string;
}

export interface R1138OrdinaryConsumerPartialAggregateMetricIntakeOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1138: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1138: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1137: ArtifactSummary;
  };
  packetId: "r1138-ordinary-consumer-partial-aggregate-metric-intake";
  partialMetricIntake: {
    aggregateMetricsProvided: boolean;
    candidateMetricStatus: Array<{
      candidateId: string;
      routeId: string;
      status: CandidateMetricStatus;
    }>;
    fullEvidenceGateCleared: false;
    partialAggregateMetricsTemplateArtifact: typeof PARTIAL_AGGREGATE_METRICS_TEMPLATE_FILE_NAME;
    partialRouteIdsReadyButUnsupported: string[];
    privateDetailsStored: false;
    readyPartialRouteIds: string[];
    routeMetricStatus: Array<{
      missingCandidateIds: string[];
      routeId: string;
      status: RouteMetricStatus;
    }>;
    submissionEvidenceRole: EvidenceRole | null;
  };
  productDisplayAuthorized: false;
  schemaVersion: typeof R1138_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: PartialMetricConclusion;
    nextAction: PartialMetricNextAction;
    partialAggregateMetricsTemplateArtifact: typeof PARTIAL_AGGREGATE_METRICS_TEMPLATE_FILE_NAME;
    productDisplayAuthorized: false;
    readyPartialRouteIds: string[];
    realAggregateStillMissing: true;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1138: false;
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1138OrdinaryConsumerPartialAggregateMetricIntake(
  options: R1138OrdinaryConsumerPartialAggregateMetricIntakeOptions = {},
): Promise<{
  output: R1138OrdinaryConsumerPartialAggregateMetricIntakeOutput;
  outputPath: string;
  partialAggregateMetricsTemplatePath: string;
}> {
  const r1137 = await readJsonIfPresent(options.r1137Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1137_EXPECTED.artifact));
  validateInputBoundary("r1137", r1137);
  const partialAggregateMetrics = options.partialAggregateMetrics
    ?? await readPartialAggregateMetrics(options.partialAggregateMetricsPath);
  if (partialAggregateMetrics) validatePartialAggregateMetrics(partialAggregateMetrics);

  const r1137Ready = matchesExpected(r1137, R1137_EXPECTED);
  const routePlanReady = r1137Ready
    && readStringAt(r1137, ["summary", "conclusion"]) !== "ordinary_partial_route_planner_waiting_on_safe_manifest"
    && readStringAt(r1137, ["summary", "conclusion"]) !== "ordinary_partial_route_planner_waiting_on_refresh";
  const partialRouteIdsReadyButUnsupported = r1137Ready
    ? readStringArrayAt(r1137, ["summary", "partialRouteIdsReadyButUnsupported"])
    : [];
  const routeMetricStatus = routeMetricStatusFor(partialAggregateMetrics);
  const candidateMetricStatus = candidateMetricStatusFor(partialAggregateMetrics);
  const readyPartialRouteIds = routeMetricStatus
    .filter((route) => route.status === "complete")
    .map((route) => route.routeId);
  const conclusion = conclusionFor({
    aggregateMetricsProvided: partialAggregateMetrics !== null,
    r1137Ready,
    routePlanReady,
    readyPartialRouteIds,
    routeMetricStatus,
  });
  const template = createPartialAggregateMetricsTemplate(partialRouteIdsReadyButUnsupported);
  const output: R1138OrdinaryConsumerPartialAggregateMetricIntakeOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1137: summarizeInput(R1137_EXPECTED, r1137),
    },
    packetId: "r1138-ordinary-consumer-partial-aggregate-metric-intake",
    partialMetricIntake: {
      aggregateMetricsProvided: partialAggregateMetrics !== null,
      candidateMetricStatus,
      fullEvidenceGateCleared: false,
      partialAggregateMetricsTemplateArtifact: PARTIAL_AGGREGATE_METRICS_TEMPLATE_FILE_NAME,
      partialRouteIdsReadyButUnsupported,
      privateDetailsStored: false,
      readyPartialRouteIds,
      routeMetricStatus,
      submissionEvidenceRole: partialAggregateMetrics?.submissionContext.evidenceRole ?? null,
    },
    productDisplayAuthorized: false,
    schemaVersion: R1138_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextAction: nextActionFor(conclusion),
      partialAggregateMetricsTemplateArtifact: PARTIAL_AGGREGATE_METRICS_TEMPLATE_FILE_NAME,
      productDisplayAuthorized: false,
      readyPartialRouteIds,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1138: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenAggregateEgress(template),
  ];
  if (partialAggregateMetrics) findings.push(...findForbiddenAggregateEgress(partialAggregateMetrics));
  if (findings.length > 0) {
    throw new Error(`R1138 ordinary consumer partial aggregate metric intake failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const partialAggregateMetricsTemplatePath = path.join(outputDir, PARTIAL_AGGREGATE_METRICS_TEMPLATE_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(partialAggregateMetricsTemplatePath, `${JSON.stringify(template, null, 2)}\n`),
  ]);
  return { output, outputPath, partialAggregateMetricsTemplatePath };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readPartialAggregateMetrics(filePath: string | undefined): Promise<R1138PartialAggregateMetricsInput | null> {
  if (!filePath?.trim()) return null;
  return JSON.parse(await readFile(filePath, "utf8")) as R1138PartialAggregateMetricsInput;
}

function validateInputBoundary(name: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1138 ${name} failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }
}

function validatePartialAggregateMetrics(metrics: R1138PartialAggregateMetricsInput): void {
  if (metrics.schemaVersion !== PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION) {
    throw new Error("partial aggregate metrics schema version is invalid or stale");
  }
  if (metrics.submissionContext.partialEvidenceOnly !== true) {
    throw new Error("partial aggregate metrics must declare partialEvidenceOnly");
  }
  const findings = findForbiddenAggregateEgress(metrics);
  if (findings.length > 0) {
    throw new Error(`partial aggregate metrics failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }
}

function routeMetricStatusFor(metrics: R1138PartialAggregateMetricsInput | null): R1138OrdinaryConsumerPartialAggregateMetricIntakeOutput["partialMetricIntake"]["routeMetricStatus"] {
  if (!metrics) return [];
  return metrics.routeResults.map((route) => {
    const requiredCandidateIds = candidateIdsForRoute(route.routeId);
    const presentCandidateIds = new Set(route.candidateResults.map((candidate) => candidate.candidateId));
    const missingCandidateIds = requiredCandidateIds.filter((candidateId) => !presentCandidateIds.has(candidateId));
    return {
      missingCandidateIds,
      routeId: route.routeId,
      status: missingCandidateIds.length === 0 ? "complete" : "incomplete",
    };
  });
}

function candidateMetricStatusFor(metrics: R1138PartialAggregateMetricsInput | null): R1138OrdinaryConsumerPartialAggregateMetricIntakeOutput["partialMetricIntake"]["candidateMetricStatus"] {
  if (!metrics) return [];
  return metrics.routeResults.flatMap((route) => {
    const presentCandidateIds = new Set(route.candidateResults.map((candidate) => candidate.candidateId));
    return candidateIdsForRoute(route.routeId).map((candidateId) => ({
      candidateId,
      routeId: route.routeId,
      status: presentCandidateIds.has(candidateId) ? "complete" : "missing",
    }));
  });
}

function candidateIdsForRoute(routeId: string): string[] {
  return PARTIAL_ROUTE_DEFINITIONS.find((route) => route.routeId === routeId)?.candidateIds.slice() ?? [];
}

function conclusionFor(input: {
  aggregateMetricsProvided: boolean;
  r1137Ready: boolean;
  routePlanReady: boolean;
  readyPartialRouteIds: readonly string[];
  routeMetricStatus: readonly { status: RouteMetricStatus }[];
}): PartialMetricConclusion {
  if (!input.r1137Ready || !input.routePlanReady) {
    return "ordinary_partial_aggregate_metric_intake_waiting_on_route_plan";
  }
  if (!input.aggregateMetricsProvided) return "ordinary_partial_aggregate_metrics_missing";
  if (input.routeMetricStatus.some((route) => route.status === "incomplete")) {
    return "ordinary_partial_aggregate_metrics_incomplete";
  }
  if (input.readyPartialRouteIds.length > 0) return "ordinary_partial_aggregate_metrics_recorded_not_full_evidence";
  return "ordinary_partial_aggregate_metrics_incomplete";
}

function nextActionFor(conclusion: PartialMetricConclusion): PartialMetricNextAction {
  if (conclusion === "ordinary_partial_aggregate_metric_intake_waiting_on_route_plan") {
    return "fill_safe_availability_manifest_then_run_r1136_r1137_chain";
  }
  if (conclusion === "ordinary_partial_aggregate_metrics_missing") {
    return "fill_partial_aggregate_metrics_template_after_route_plan";
  }
  if (conclusion === "ordinary_partial_aggregate_metrics_incomplete") {
    return "provide_complete_partial_route_aggregate_metrics";
  }
  return "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence";
}

function createPartialAggregateMetricsTemplate(
  partialRouteIdsReadyButUnsupported: readonly string[],
): R1138PartialAggregateMetricsInput {
  const allowedRouteIds = partialRouteIdsReadyButUnsupported.length > 0
    ? new Set(partialRouteIdsReadyButUnsupported)
    : new Set(PARTIAL_ROUTE_DEFINITIONS.map((route) => route.routeId));
  return {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    evaluatorId: "ordinary_consumer_partial_route_aggregate_evaluator_v1",
    packetId: "fill-this-ordinary-consumer-partial-aggregate-metrics",
    receiptAttestations: {
      aggregateOnly: true,
      endpointFrozenBeforeScoring: true,
      evaluatorFrozenBeforeExecution: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      sameDenominatorComparisons: true,
    },
    routeResults: PARTIAL_ROUTE_DEFINITIONS
      .filter((route) => allowedRouteIds.has(route.routeId))
      .map((route) => ({
        candidateResults: route.candidateIds.map((candidateId) => ({
          aucDelta: null,
          brierDelta: null,
          calibrationStatus: "missing",
          candidateId,
          candidateKind: route.routeKind === "partial_wearable_route" ? "wearable" : "lab",
          comparatorId: "frozen_recalibrated_r399",
          coverageStatus: "missing",
          evidenceSupport: "underpowered",
          logLossDelta: null,
          missingnessOrCoverageControlStatus: "not_applicable",
        })),
        routeId: route.routeId,
      })),
    schemaVersion: PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION,
    submissionContext: {
      evidenceRole: "real_partial_route_evidence",
      ordinaryConsumerSubmission: true,
      outcomeLinked: true,
      partialEvidenceOnly: true,
      targetAgeBand: "roughly_16_50",
    },
  };
}

function summarizeInput(expected: typeof R1137_EXPECTED, input: unknown | null): ArtifactSummary {
  const packetId = readStringAt(input, ["packetId"]);
  const schemaVersion = readStringAt(input, ["schemaVersion"]);
  return {
    artifact: expected.artifact,
    packetId: packetId === expected.packetId ? expected.packetId : null,
    schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
    status: input ? "available" : "missing",
  };
}

function matchesExpected(input: unknown | null, expected: typeof R1137_EXPECTED): boolean {
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown | null, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function safeBoundary(): R1138OrdinaryConsumerPartialAggregateMetricIntakeOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1138: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1138: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1138OrdinaryConsumerPartialAggregateMetricIntake({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    partialAggregateMetricsPath: process.env.MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRICS_PATH,
    r1137Path: process.env.MURPH_AGE_R1137_ORDINARY_CONSUMER_PARTIAL_ROUTE_PLANNER_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    partialAggregateMetricsTemplateArtifact: output.summary.partialAggregateMetricsTemplateArtifact,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyPartialRouteIds: output.summary.readyPartialRouteIds,
    realAggregateStillMissing: output.summary.realAggregateStillMissing,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1138: output.summary.rowParsingPerformedByR1138,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1138 ordinary consumer partial aggregate metric intake failed.")}\n`);
    process.exitCode = 1;
  });
}
