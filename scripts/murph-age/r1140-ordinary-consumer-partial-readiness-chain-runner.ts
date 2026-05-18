import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1136OrdinaryConsumerAvailabilityChainRunner } from "./r1136-ordinary-consumer-availability-chain-runner.ts";
import { runR1137OrdinaryConsumerPartialRoutePlanner } from "./r1137-ordinary-consumer-partial-route-planner.ts";
import { runR1138OrdinaryConsumerPartialAggregateMetricIntake } from "./r1138-ordinary-consumer-partial-aggregate-metric-intake.ts";
import { runR1139OrdinaryConsumerPartialPrivateConfigHandoff } from "./r1139-ordinary-consumer-partial-private-config-handoff.ts";

export const R1140_ORDINARY_CONSUMER_PARTIAL_READINESS_CHAIN_RUNNER_SCHEMA_VERSION =
  "murph-age-r1140-ordinary-consumer-partial-readiness-chain-runner.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1140-ordinary-consumer-partial-readiness-chain-runner.latest.json";
const R1133_AVAILABILITY_PREFLIGHT_ARTIFACT =
  "r1133-ordinary-consumer-data-availability-preflight.latest.json";
const R1140_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> pnpm exec tsx scripts/murph-age/r1140-ordinary-consumer-partial-readiness-chain-runner.ts" as const;
const R1138_PARTIAL_AGGREGATE_METRIC_INTAKE_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRICS_PATH=<partial-aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1138-ordinary-consumer-partial-aggregate-metric-intake.ts" as const;

const PRIMARY_SUBMITTER_INPUT_FAMILY_IDS = [
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "wearable_activity_daily",
  "vitals_body_context",
] as const;
const REQUIRED_LINKAGE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
] as const;

type ChainConclusion =
  | "ordinary_partial_readiness_chain_blocked_missing_route_inputs"
  | "ordinary_partial_readiness_chain_full_route_ready_existing_runner_preferred"
  | "ordinary_partial_readiness_chain_partial_metrics_recorded_research_only"
  | "ordinary_partial_readiness_chain_ready_for_partial_private_mapping"
  | "ordinary_partial_readiness_chain_waiting_on_safe_manifest";
type ChainNextAction =
  | "collect_outcome_linked_wearable_and_lab_availability_then_run_r1140_partial_chain"
  | "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner"
  | "fill_private_config_mapping_for_full_labs_wearable_route"
  | "fill_safe_availability_manifest_then_run_r1140_partial_chain"
  | "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence";

interface StageResult {
  artifact: string;
  conclusion: string | null;
  packetId: string;
  schemaVersion: string;
  stageId:
    | "r1136_availability_chain"
    | "r1137_partial_route_planner"
    | "r1138_partial_aggregate_metric_intake"
    | "r1139_partial_private_config_handoff";
}

export interface R1140OrdinaryConsumerPartialReadinessChainRunnerOptions {
  availabilityManifestPath?: string;
  createdAt?: string;
  outputDir?: string;
  partialAggregateMetricsPath?: string;
  r1076Path?: string;
  r1132Path?: string;
}

export interface R1140OrdinaryConsumerPartialReadinessChainRunnerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    availabilityManifestPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1140: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    partialAggregateMetricsPathStored: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false,
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1140: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  packetId: "r1140-ordinary-consumer-partial-readiness-chain-runner";
  partialReadinessChain: {
    blockers: string[];
    commands: {
      partialAggregateMetricIntakeCommand: typeof R1138_PARTIAL_AGGREGATE_METRIC_INTAKE_COMMAND;
      partialReadinessChainRunnerCommand: typeof R1140_CHAIN_RUNNER_COMMAND;
    };
    eligiblePartialRouteIds: string[];
    fullEvidenceGateCleared: false;
    fullSupportedRouteReady: boolean;
    manifestSuppliedToRunner: boolean;
    missingSourceFamilyIds: string[];
    partialAggregateMetricsSuppliedToRunner: boolean;
    partialAggregateMetricsTemplateArtifact: string | null;
    partialPrivateConfigTemplateArtifact: string | null;
    primarySubmitterInputFamilyIds: typeof PRIMARY_SUBMITTER_INPUT_FAMILY_IDS[number][];
    privateDetailsStored: false;
    readyPartialMetricRouteIds: string[];
    requiredLinkageFamilyIds: typeof REQUIRED_LINKAGE_FAMILY_IDS[number][];
    requiredPrivateFieldRefFamilies: string[];
    requiredPrivateTableRefs: string[];
    stageOrder: [
      "r1136_availability_chain",
      "r1137_partial_route_planner",
      "r1138_partial_aggregate_metric_intake",
      "r1139_partial_private_config_handoff",
    ];
    stageResults: StageResult[];
  };
  productDisplayAuthorized: false;
  schemaVersion: typeof R1140_ORDINARY_CONSUMER_PARTIAL_READINESS_CHAIN_RUNNER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: ChainConclusion;
    eligiblePartialRouteIds: string[];
    fullEvidenceGateCleared: false;
    fullSupportedRouteReady: boolean;
    manifestSuppliedToRunner: boolean;
    missingSourceFamilyIds: string[];
    nextAction: ChainNextAction;
    partialAggregateMetricsSuppliedToRunner: boolean;
    partialAggregateMetricsTemplateArtifact: string | null;
    partialPrivateConfigTemplateArtifact: string | null;
    productDisplayAuthorized: false,
    readyPartialMetricRouteIds: string[];
    realAggregateStillMissing: true;
    requiredPrivateFieldRefFamilies: string[];
    requiredPrivateTableRefs: string[];
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1140: false;
    targetAgeBand: "roughly_16_50";
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1140OrdinaryConsumerPartialReadinessChainRunner(
  options: R1140OrdinaryConsumerPartialReadinessChainRunnerOptions = {},
): Promise<{ output: R1140OrdinaryConsumerPartialReadinessChainRunnerOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const availabilityManifestPath = options.availabilityManifestPath
    ?? process.env.MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH;
  const partialAggregateMetricsPath = options.partialAggregateMetricsPath
    ?? process.env.MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRICS_PATH;
  const r1136Run = await runR1136OrdinaryConsumerAvailabilityChainRunner({
    availabilityManifestPath,
    createdAt: options.createdAt,
    outputDir,
    r1076Path: options.r1076Path,
    r1132Path: options.r1132Path,
  });
  const r1137Run = await runR1137OrdinaryConsumerPartialRoutePlanner({
    createdAt: options.createdAt,
    outputDir,
    r1133Path: path.join(outputDir, R1133_AVAILABILITY_PREFLIGHT_ARTIFACT),
    r1136Path: r1136Run.outputPath,
  });
  const r1138Run = await runR1138OrdinaryConsumerPartialAggregateMetricIntake({
    createdAt: options.createdAt,
    outputDir,
    partialAggregateMetricsPath,
    r1137Path: r1137Run.outputPath,
  });
  const r1139Run = await runR1139OrdinaryConsumerPartialPrivateConfigHandoff({
    createdAt: options.createdAt,
    outputDir,
    r1137Path: r1137Run.outputPath,
    r1138Path: r1138Run.outputPath,
  });

  const manifestSuppliedToRunner = Boolean(availabilityManifestPath?.trim());
  const partialAggregateMetricsSuppliedToRunner = Boolean(partialAggregateMetricsPath?.trim());
  const conclusion = conclusionFor(r1139Run.output.summary.conclusion);
  const output: R1140OrdinaryConsumerPartialReadinessChainRunnerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r1140-ordinary-consumer-partial-readiness-chain-runner",
    partialReadinessChain: {
      blockers: blockersFor({
        conclusion,
        r1136Blockers: r1136Run.output.availabilityChain.blockers,
        r1139Blockers: r1139Run.output.partialPrivateConfigHandoff.blockers,
      }),
      commands: {
        partialAggregateMetricIntakeCommand: R1138_PARTIAL_AGGREGATE_METRIC_INTAKE_COMMAND,
        partialReadinessChainRunnerCommand: R1140_CHAIN_RUNNER_COMMAND,
      },
      eligiblePartialRouteIds: r1139Run.output.summary.eligiblePartialRouteIds,
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: r1139Run.output.summary.fullSupportedRouteReady,
      manifestSuppliedToRunner,
      missingSourceFamilyIds: r1136Run.output.summary.missingSourceFamilyIds,
      partialAggregateMetricsSuppliedToRunner,
      partialAggregateMetricsTemplateArtifact: r1138Run.output.summary.partialAggregateMetricsTemplateArtifact,
      partialPrivateConfigTemplateArtifact: r1139Run.output.summary.partialPrivateConfigTemplateArtifact,
      primarySubmitterInputFamilyIds: [...PRIMARY_SUBMITTER_INPUT_FAMILY_IDS],
      privateDetailsStored: false,
      readyPartialMetricRouteIds: r1139Run.output.summary.readyPartialMetricRouteIds,
      requiredLinkageFamilyIds: [...REQUIRED_LINKAGE_FAMILY_IDS],
      requiredPrivateFieldRefFamilies: r1139Run.output.summary.requiredPrivateFieldRefFamilies,
      requiredPrivateTableRefs: r1139Run.output.summary.requiredPrivateTableRefs,
      stageOrder: [
        "r1136_availability_chain",
        "r1137_partial_route_planner",
        "r1138_partial_aggregate_metric_intake",
        "r1139_partial_private_config_handoff",
      ],
      stageResults: [
        stageResultFor("r1136_availability_chain", r1136Run.output, r1136Run.output.summary.conclusion),
        stageResultFor("r1137_partial_route_planner", r1137Run.output, r1137Run.output.summary.conclusion),
        stageResultFor("r1138_partial_aggregate_metric_intake", r1138Run.output, r1138Run.output.summary.conclusion),
        stageResultFor("r1139_partial_private_config_handoff", r1139Run.output, r1139Run.output.summary.conclusion),
      ],
    },
    productDisplayAuthorized: false,
    schemaVersion: R1140_ORDINARY_CONSUMER_PARTIAL_READINESS_CHAIN_RUNNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      eligiblePartialRouteIds: r1139Run.output.summary.eligiblePartialRouteIds,
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: r1139Run.output.summary.fullSupportedRouteReady,
      manifestSuppliedToRunner,
      missingSourceFamilyIds: r1136Run.output.summary.missingSourceFamilyIds,
      nextAction: nextActionFor(conclusion),
      partialAggregateMetricsSuppliedToRunner,
      partialAggregateMetricsTemplateArtifact: r1138Run.output.summary.partialAggregateMetricsTemplateArtifact,
      partialPrivateConfigTemplateArtifact: r1139Run.output.summary.partialPrivateConfigTemplateArtifact,
      productDisplayAuthorized: false,
      readyPartialMetricRouteIds: r1139Run.output.summary.readyPartialMetricRouteIds,
      realAggregateStillMissing: true,
      requiredPrivateFieldRefFamilies: r1139Run.output.summary.requiredPrivateFieldRefFamilies,
      requiredPrivateTableRefs: r1139Run.output.summary.requiredPrivateTableRefs,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1140: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1140 ordinary consumer partial readiness chain runner failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(r1139Conclusion: string): ChainConclusion {
  if (r1139Conclusion === "ordinary_partial_private_config_handoff_ready_for_partial_private_mapping") {
    return "ordinary_partial_readiness_chain_ready_for_partial_private_mapping";
  }
  if (r1139Conclusion === "ordinary_partial_private_config_handoff_partial_metrics_recorded_research_only") {
    return "ordinary_partial_readiness_chain_partial_metrics_recorded_research_only";
  }
  if (r1139Conclusion === "ordinary_partial_private_config_handoff_full_route_ready_existing_runner_preferred") {
    return "ordinary_partial_readiness_chain_full_route_ready_existing_runner_preferred";
  }
  if (r1139Conclusion === "ordinary_partial_private_config_handoff_blocked_missing_route_inputs") {
    return "ordinary_partial_readiness_chain_blocked_missing_route_inputs";
  }
  return "ordinary_partial_readiness_chain_waiting_on_safe_manifest";
}

function nextActionFor(conclusion: ChainConclusion): ChainNextAction {
  if (conclusion === "ordinary_partial_readiness_chain_ready_for_partial_private_mapping") {
    return "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner";
  }
  if (conclusion === "ordinary_partial_readiness_chain_partial_metrics_recorded_research_only") {
    return "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence";
  }
  if (conclusion === "ordinary_partial_readiness_chain_full_route_ready_existing_runner_preferred") {
    return "fill_private_config_mapping_for_full_labs_wearable_route";
  }
  if (conclusion === "ordinary_partial_readiness_chain_blocked_missing_route_inputs") {
    return "collect_outcome_linked_wearable_and_lab_availability_then_run_r1140_partial_chain";
  }
  return "fill_safe_availability_manifest_then_run_r1140_partial_chain";
}

function blockersFor(input: {
  conclusion: ChainConclusion;
  r1136Blockers: readonly string[];
  r1139Blockers: readonly string[];
}): string[] {
  if (input.conclusion === "ordinary_partial_readiness_chain_ready_for_partial_private_mapping") {
    return input.r1139Blockers.filter((blocker) => blocker !== "safe_availability_route_plan_missing_or_waiting");
  }
  return [...new Set([...input.r1136Blockers, ...input.r1139Blockers])];
}

function stageResultFor(
  stageId: StageResult["stageId"],
  output: { packetId: string; schemaVersion: string },
  conclusion: string | null,
): StageResult {
  return {
    artifact: artifactForStage(stageId),
    conclusion,
    packetId: output.packetId,
    schemaVersion: output.schemaVersion,
    stageId,
  };
}

function artifactForStage(stageId: StageResult["stageId"]): string {
  if (stageId === "r1136_availability_chain") {
    return "r1136-ordinary-consumer-availability-chain-runner.latest.json";
  }
  if (stageId === "r1137_partial_route_planner") {
    return "r1137-ordinary-consumer-partial-route-planner.latest.json";
  }
  if (stageId === "r1138_partial_aggregate_metric_intake") {
    return "r1138-ordinary-consumer-partial-aggregate-metric-intake.latest.json";
  }
  return "r1139-ordinary-consumer-partial-private-config-handoff.latest.json";
}

function safeBoundary(): R1140OrdinaryConsumerPartialReadinessChainRunnerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    availabilityManifestPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1140: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    partialAggregateMetricsPathStored: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1140: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1140OrdinaryConsumerPartialReadinessChainRunner({
    availabilityManifestPath: process.env.MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    partialAggregateMetricsPath: process.env.MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRICS_PATH,
    r1076Path: process.env.MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH,
    r1132Path: process.env.MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    eligiblePartialRouteIds: output.summary.eligiblePartialRouteIds,
    fullEvidenceGateCleared: output.summary.fullEvidenceGateCleared,
    fullSupportedRouteReady: output.summary.fullSupportedRouteReady,
    manifestSuppliedToRunner: output.summary.manifestSuppliedToRunner,
    missingSourceFamilyIds: output.summary.missingSourceFamilyIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    partialAggregateMetricsSuppliedToRunner: output.summary.partialAggregateMetricsSuppliedToRunner,
    partialAggregateMetricsTemplateArtifact: output.summary.partialAggregateMetricsTemplateArtifact,
    partialPrivateConfigTemplateArtifact: output.summary.partialPrivateConfigTemplateArtifact,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyPartialMetricRouteIds: output.summary.readyPartialMetricRouteIds,
    realAggregateStillMissing: output.summary.realAggregateStillMissing,
    requiredPrivateFieldRefFamilies: output.summary.requiredPrivateFieldRefFamilies,
    requiredPrivateTableRefs: output.summary.requiredPrivateTableRefs,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1140: output.summary.rowParsingPerformedByR1140,
    schemaVersion: output.schemaVersion,
    stageResults: output.partialReadinessChain.stageResults,
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
    process.stderr.write(`${safeCliErrorMessage(error, "R1140 ordinary consumer partial readiness chain runner failed.")}\n`);
    process.exitCode = 1;
  });
}
