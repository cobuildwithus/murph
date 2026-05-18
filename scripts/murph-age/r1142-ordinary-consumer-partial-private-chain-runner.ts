import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1140OrdinaryConsumerPartialReadinessChainRunner } from "./r1140-ordinary-consumer-partial-readiness-chain-runner.ts";
import { runR1141OrdinaryConsumerPartialPrivateMetricRunner } from "./r1141-ordinary-consumer-partial-private-metric-runner.ts";

export const R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_SCHEMA_VERSION =
  "murph-age-r1142-ordinary-consumer-partial-private-chain-runner.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1142-ordinary-consumer-partial-private-chain-runner.latest.json";
const R1139_PARTIAL_PRIVATE_CONFIG_HANDOFF_ARTIFACT =
  "r1139-ordinary-consumer-partial-private-config-handoff.latest.json";
const R1142_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts" as const;
const R1140_PARTIAL_READINESS_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> pnpm exec tsx scripts/murph-age/r1140-ordinary-consumer-partial-readiness-chain-runner.ts" as const;
const R1141_PARTIAL_PRIVATE_METRIC_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1141-ordinary-consumer-partial-private-metric-runner.ts" as const;

type ChainConclusion =
  | "ordinary_partial_private_chain_full_route_ready_existing_runner_preferred"
  | "ordinary_partial_private_chain_partial_metrics_recorded_research_only"
  | "ordinary_partial_private_chain_waiting_on_partial_private_config"
  | "ordinary_partial_private_chain_waiting_on_partial_private_metrics"
  | "ordinary_partial_private_chain_waiting_on_safe_manifest";
type ChainNextAction =
  | "fill_private_config_mapping_for_full_labs_wearable_route"
  | "fill_safe_availability_manifest_then_run_r1142_partial_private_chain"
  | "provide_partial_private_runner_config"
  | "send_r1141_partial_metrics_to_r1138_or_r1140"
  | "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence";

interface StageResult {
  artifact: string | null;
  conclusion: string | null;
  packetId: string | null;
  schemaVersion: string | null;
  stageId:
    | "r1140_route_plan"
    | "r1141_partial_private_metric_runner"
    | "r1140_metric_recording_refresh";
}

export interface R1142OrdinaryConsumerPartialPrivateChainRunnerOptions {
  availabilityManifestPath?: string;
  createdAt?: string;
  outputDir?: string;
  partialPrivateRunnerConfigPath?: string;
  r1076Path?: string;
  r1132Path?: string;
}

export interface R1142OrdinaryConsumerPartialPrivateChainRunnerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    availabilityManifestPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1142: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    partialPrivateConfigPathStored: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1142: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  packetId: "r1142-ordinary-consumer-partial-private-chain-runner";
  partialPrivateChain: {
    aggregateMetricsArtifact: string | null;
    availabilityManifestSuppliedToRunner: boolean;
    commands: {
      partialPrivateChainRunnerCommand: typeof R1142_CHAIN_RUNNER_COMMAND;
      partialPrivateMetricRunnerCommand: typeof R1141_PARTIAL_PRIVATE_METRIC_RUNNER_COMMAND;
      partialReadinessChainRunnerCommand: typeof R1140_PARTIAL_READINESS_CHAIN_RUNNER_COMMAND;
    };
    eligiblePartialRouteIds: string[];
    executedPartialRouteIds: string[];
    finalReadyPartialMetricRouteIds: string[];
    fullEvidenceGateCleared: false;
    fullSupportedRouteReady: boolean;
    manifestFirstRoutePlanConclusion: string | null;
    metricRecordingRefreshConclusion: string | null;
    partialPrivateConfigSuppliedToRunner: boolean;
    partialPrivateMetricRunnerConclusion: string | null;
    partialPrivateMetricRunnerNextAction: string | null;
    privateDetailsStored: false;
    routeMetricsReadyForR1138: boolean | null;
    stageOrder: StageResult["stageId"][];
    stageResults: StageResult[];
  };
  productDisplayAuthorized: false;
  schemaVersion: typeof R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_SCHEMA_VERSION;
  status: "research-local-private-inputs-aggregate-output";
  summary: {
    aggregateMetricsArtifact: string | null;
    conclusion: ChainConclusion;
    eligiblePartialRouteIds: string[];
    executedPartialRouteIds: string[];
    finalReadyPartialMetricRouteIds: string[];
    fullEvidenceGateCleared: false;
    fullSupportedRouteReady: boolean;
    nextAction: ChainNextAction;
    productDisplayAuthorized: false;
    realAggregateStillMissing: true;
    reviewGptRequiredNow: false;
    routeMetricsReadyForR1138: boolean | null;
    rowParsingPerformedByR1142: false;
    targetAgeBand: "roughly_16_50";
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1142OrdinaryConsumerPartialPrivateChainRunner(
  options: R1142OrdinaryConsumerPartialPrivateChainRunnerOptions = {},
): Promise<{ output: R1142OrdinaryConsumerPartialPrivateChainRunnerOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const availabilityManifestPath = options.availabilityManifestPath
    ?? process.env.MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH;
  const partialPrivateRunnerConfigPath = options.partialPrivateRunnerConfigPath
    ?? process.env.MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH;
  const manifestFirstRun = await runR1140OrdinaryConsumerPartialReadinessChainRunner({
    availabilityManifestPath,
    createdAt: options.createdAt,
    outputDir,
    r1076Path: options.r1076Path,
    r1132Path: options.r1132Path,
  });
  const metricRun = await runR1141OrdinaryConsumerPartialPrivateMetricRunner({
    configPath: partialPrivateRunnerConfigPath,
    createdAt: options.createdAt,
    outputDir,
    r1139Path: path.join(outputDir, R1139_PARTIAL_PRIVATE_CONFIG_HANDOFF_ARTIFACT),
  });
  const metricRecordingRefresh = metricRun.aggregateMetricsPath
    ? await runR1140OrdinaryConsumerPartialReadinessChainRunner({
      availabilityManifestPath,
      createdAt: options.createdAt,
      outputDir,
      partialAggregateMetricsPath: metricRun.aggregateMetricsPath,
      r1076Path: options.r1076Path,
      r1132Path: options.r1132Path,
    })
    : null;
  const finalReadinessOutput = metricRecordingRefresh?.output ?? manifestFirstRun.output;
  const conclusion = conclusionFor({
    finalReadinessConclusion: finalReadinessOutput.summary.conclusion,
    metricRunnerConclusion: metricRun.output.summary.conclusion,
    partialPrivateConfigSuppliedToRunner: Boolean(partialPrivateRunnerConfigPath?.trim()),
  });
  const stageResults = stageResultsFor({
    manifestFirstRun: manifestFirstRun.output,
    metricRecordingRefresh: metricRecordingRefresh?.output ?? null,
    metricRun: metricRun.output,
  });
  const output: R1142OrdinaryConsumerPartialPrivateChainRunnerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r1142-ordinary-consumer-partial-private-chain-runner",
    partialPrivateChain: {
      aggregateMetricsArtifact: metricRun.output.summary.aggregateMetricsArtifact,
      availabilityManifestSuppliedToRunner: Boolean(availabilityManifestPath?.trim()),
      commands: {
        partialPrivateChainRunnerCommand: R1142_CHAIN_RUNNER_COMMAND,
        partialPrivateMetricRunnerCommand: R1141_PARTIAL_PRIVATE_METRIC_RUNNER_COMMAND,
        partialReadinessChainRunnerCommand: R1140_PARTIAL_READINESS_CHAIN_RUNNER_COMMAND,
      },
      eligiblePartialRouteIds: manifestFirstRun.output.summary.eligiblePartialRouteIds,
      executedPartialRouteIds: metricRun.output.summary.executedPartialRouteIds,
      finalReadyPartialMetricRouteIds: finalReadinessOutput.summary.readyPartialMetricRouteIds,
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: finalReadinessOutput.summary.fullSupportedRouteReady,
      manifestFirstRoutePlanConclusion: manifestFirstRun.output.summary.conclusion,
      metricRecordingRefreshConclusion: metricRecordingRefresh?.output.summary.conclusion ?? null,
      partialPrivateConfigSuppliedToRunner: Boolean(partialPrivateRunnerConfigPath?.trim()),
      partialPrivateMetricRunnerConclusion: metricRun.output.summary.conclusion,
      partialPrivateMetricRunnerNextAction: metricRun.output.summary.nextAction,
      privateDetailsStored: false,
      routeMetricsReadyForR1138: metricRun.output.summary.routeMetricsReadyForR1138,
      stageOrder: stageResults.map((stage) => stage.stageId),
      stageResults,
    },
    productDisplayAuthorized: false,
    schemaVersion: R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_SCHEMA_VERSION,
    status: "research-local-private-inputs-aggregate-output",
    summary: {
      aggregateMetricsArtifact: metricRun.output.summary.aggregateMetricsArtifact,
      conclusion,
      eligiblePartialRouteIds: manifestFirstRun.output.summary.eligiblePartialRouteIds,
      executedPartialRouteIds: metricRun.output.summary.executedPartialRouteIds,
      finalReadyPartialMetricRouteIds: finalReadinessOutput.summary.readyPartialMetricRouteIds,
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: finalReadinessOutput.summary.fullSupportedRouteReady,
      nextAction: nextActionFor(conclusion, metricRun.output.summary.nextAction),
      productDisplayAuthorized: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      routeMetricsReadyForR1138: metricRun.output.summary.routeMetricsReadyForR1138,
      rowParsingPerformedByR1142: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1142 ordinary consumer partial private chain runner failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  finalReadinessConclusion: string;
  metricRunnerConclusion: string;
  partialPrivateConfigSuppliedToRunner: boolean;
}): ChainConclusion {
  if (input.finalReadinessConclusion === "ordinary_partial_readiness_chain_waiting_on_safe_manifest") {
    return "ordinary_partial_private_chain_waiting_on_safe_manifest";
  }
  if (input.finalReadinessConclusion === "ordinary_partial_readiness_chain_full_route_ready_existing_runner_preferred") {
    return "ordinary_partial_private_chain_full_route_ready_existing_runner_preferred";
  }
  if (input.finalReadinessConclusion === "ordinary_partial_readiness_chain_partial_metrics_recorded_research_only") {
    return "ordinary_partial_private_chain_partial_metrics_recorded_research_only";
  }
  if (!input.partialPrivateConfigSuppliedToRunner) {
    return "ordinary_partial_private_chain_waiting_on_partial_private_config";
  }
  if (input.metricRunnerConclusion === "ordinary_partial_private_metric_runner_aggregate_metrics_ready_for_r1138") {
    return "ordinary_partial_private_chain_partial_metrics_recorded_research_only";
  }
  return "ordinary_partial_private_chain_waiting_on_partial_private_metrics";
}

function nextActionFor(conclusion: ChainConclusion, metricRunnerNextAction: string | null): ChainNextAction {
  if (conclusion === "ordinary_partial_private_chain_waiting_on_safe_manifest") {
    return "fill_safe_availability_manifest_then_run_r1142_partial_private_chain";
  }
  if (conclusion === "ordinary_partial_private_chain_full_route_ready_existing_runner_preferred") {
    return "fill_private_config_mapping_for_full_labs_wearable_route";
  }
  if (conclusion === "ordinary_partial_private_chain_waiting_on_partial_private_config") {
    return "provide_partial_private_runner_config";
  }
  if (conclusion === "ordinary_partial_private_chain_waiting_on_partial_private_metrics") {
    return metricRunnerNextAction === "send_r1141_partial_metrics_to_r1138_or_r1140"
      ? "send_r1141_partial_metrics_to_r1138_or_r1140"
      : "provide_partial_private_runner_config";
  }
  return "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence";
}

function stageResultsFor(input: {
  manifestFirstRun: { packetId: string; schemaVersion: string; summary: { conclusion: string } };
  metricRecordingRefresh: { packetId: string; schemaVersion: string; summary: { conclusion: string } } | null;
  metricRun: { packetId: string; schemaVersion: string; summary: { conclusion: string } };
}): StageResult[] {
  const stages: StageResult[] = [
    {
      artifact: "r1140-ordinary-consumer-partial-readiness-chain-runner.latest.json",
      conclusion: input.manifestFirstRun.summary.conclusion,
      packetId: input.manifestFirstRun.packetId,
      schemaVersion: input.manifestFirstRun.schemaVersion,
      stageId: "r1140_route_plan",
    },
    {
      artifact: "r1141-ordinary-consumer-partial-private-metric-runner.latest.json",
      conclusion: input.metricRun.summary.conclusion,
      packetId: input.metricRun.packetId,
      schemaVersion: input.metricRun.schemaVersion,
      stageId: "r1141_partial_private_metric_runner",
    },
  ];
  if (input.metricRecordingRefresh) {
    stages.push({
      artifact: "r1140-ordinary-consumer-partial-readiness-chain-runner.latest.json",
      conclusion: input.metricRecordingRefresh.summary.conclusion,
      packetId: input.metricRecordingRefresh.packetId,
      schemaVersion: input.metricRecordingRefresh.schemaVersion,
      stageId: "r1140_metric_recording_refresh",
    });
  }
  return stages;
}

function safeBoundary(): R1142OrdinaryConsumerPartialPrivateChainRunnerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    availabilityManifestPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1142: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    partialPrivateConfigPathStored: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1142: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

async function main(): Promise<void> {
  const { output } = await runR1142OrdinaryConsumerPartialPrivateChainRunner({
    availabilityManifestPath: process.env.MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    partialPrivateRunnerConfigPath: process.env.MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH,
    r1076Path: process.env.MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH,
    r1132Path: process.env.MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    aggregateMetricsArtifact: output.summary.aggregateMetricsArtifact,
    conclusion: output.summary.conclusion,
    eligiblePartialRouteIds: output.summary.eligiblePartialRouteIds,
    executedPartialRouteIds: output.summary.executedPartialRouteIds,
    finalReadyPartialMetricRouteIds: output.summary.finalReadyPartialMetricRouteIds,
    fullEvidenceGateCleared: output.summary.fullEvidenceGateCleared,
    fullSupportedRouteReady: output.summary.fullSupportedRouteReady,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    realAggregateStillMissing: output.summary.realAggregateStillMissing,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    routeMetricsReadyForR1138: output.summary.routeMetricsReadyForR1138,
    schemaVersion: output.schemaVersion,
    stageResults: output.partialPrivateChain.stageResults,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1142 ordinary consumer partial private chain runner failed.")}\n`);
    process.exitCode = 1;
  });
}
