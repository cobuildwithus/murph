import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1133OrdinaryConsumerDataAvailabilityPreflight } from "./r1133-ordinary-consumer-data-availability-preflight.ts";
import { runR1134OrdinaryConsumerAvailabilityConfigBridge } from "./r1134-ordinary-consumer-availability-config-bridge.ts";
import { runR1135OrdinaryConsumerAvailabilityManifestPacket } from "./r1135-ordinary-consumer-availability-manifest-packet.ts";

export const R1136_ORDINARY_CONSUMER_AVAILABILITY_CHAIN_RUNNER_SCHEMA_VERSION =
  "murph-age-r1136-ordinary-consumer-availability-chain-runner.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1136-ordinary-consumer-availability-chain-runner.latest.json";
const R1136_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> pnpm exec tsx scripts/murph-age/r1136-ordinary-consumer-availability-chain-runner.ts" as const;
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
  | "ordinary_availability_chain_blocked_missing_required_availability"
  | "ordinary_availability_chain_ready_for_private_config_mapping"
  | "ordinary_availability_chain_ready_for_private_runner"
  | "ordinary_availability_chain_waiting_on_safe_manifest"
  | "ordinary_availability_chain_waiting_on_refresh";
type ChainNextAction =
  | "collect_outcome_linked_wearable_and_lab_availability_then_run_r1136_chain"
  | "fill_private_config_mapping_for_available_wearables_labs"
  | "fill_safe_availability_manifest_then_run_r1136_chain"
  | "refresh_inputs_then_run_r1136_chain"
  | "run_r1125_private_runner_then_r1124_real_metric_intake";

interface StageResult {
  artifact: string;
  conclusion: string | null;
  packetId: string;
  schemaVersion: string;
}

export interface R1136OrdinaryConsumerAvailabilityChainRunnerOptions {
  availabilityManifestPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1076Path?: string;
  r1132Path?: string;
}

export interface R1136OrdinaryConsumerAvailabilityChainRunnerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    availabilityManifestPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1136: false;
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
    rowParsingPerformedByR1136: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  availabilityChain: {
    blockers: string[];
    commands: {
      availabilityChainRunnerCommand: typeof R1136_CHAIN_RUNNER_COMMAND;
      availabilityConfigBridgeCommand: string | null;
      availabilityManifestPacketCommand: string | null;
      availabilityPreflightCommand: string | null;
      configIntakeCommand: string | null;
      currentLoopCommand: string;
      metricIntakeCommand: string | null;
      privateRunnerCommand: string | null;
    };
    manifestSuppliedToRunner: boolean;
    missingSourceFamilyIds: string[];
    primarySubmitterInputFamilyIds: typeof PRIMARY_SUBMITTER_INPUT_FAMILY_IDS[number][];
    privateDetailsStored: false;
    readyForPrivateConfigMapping: boolean;
    readyForPrivateRunner: boolean;
    requiredLinkageFamilyIds: typeof REQUIRED_LINKAGE_FAMILY_IDS[number][];
    stageOrder: ["r1133_availability_preflight", "r1134_availability_config_bridge", "r1135_availability_manifest_packet"];
    stageResults: StageResult[];
  };
  createdAt: string;
  packetId: "r1136-ordinary-consumer-availability-chain-runner";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1136_ORDINARY_CONSUMER_AVAILABILITY_CHAIN_RUNNER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: ChainConclusion;
    manifestSuppliedToRunner: boolean;
    missingSourceFamilyIds: string[];
    nextAction: ChainNextAction;
    primarySubmitterInputFamilyIds: typeof PRIMARY_SUBMITTER_INPUT_FAMILY_IDS[number][];
    productDisplayAuthorized: false;
    readyForPrivateConfigMapping: boolean;
    readyForPrivateRunner: boolean;
    realAggregateStillMissing: boolean;
    requiredLinkageFamilyIds: typeof REQUIRED_LINKAGE_FAMILY_IDS[number][];
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1136: false;
    targetAgeBand: "roughly_16_50";
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1136OrdinaryConsumerAvailabilityChainRunner(
  options: R1136OrdinaryConsumerAvailabilityChainRunnerOptions = {},
): Promise<{ output: R1136OrdinaryConsumerAvailabilityChainRunnerOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const availabilityManifestPath = options.availabilityManifestPath
    ?? process.env.MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH;
  const r1133Run = await runR1133OrdinaryConsumerDataAvailabilityPreflight({
    availabilityManifestPath,
    createdAt: options.createdAt,
    outputDir,
    r1132Path: options.r1132Path,
  });
  const r1134Run = await runR1134OrdinaryConsumerAvailabilityConfigBridge({
    createdAt: options.createdAt,
    outputDir,
    r1132Path: options.r1132Path,
    r1133Path: r1133Run.outputPath,
  });
  const r1135Run = await runR1135OrdinaryConsumerAvailabilityManifestPacket({
    createdAt: options.createdAt,
    outputDir,
    r1076Path: options.r1076Path,
    r1133Path: r1133Run.outputPath,
    r1134Path: r1134Run.outputPath,
  });

  const readyForPrivateConfigMapping = r1135Run.output.summary.readyForPrivateConfigMapping;
  const readyForPrivateRunner = r1135Run.output.summary.readyForPrivateRunner;
  const conclusion = conclusionFor({
    manifestSuppliedToRunner: Boolean(availabilityManifestPath?.trim()),
    r1135Conclusion: r1135Run.output.summary.conclusion,
    readyForPrivateConfigMapping,
    readyForPrivateRunner,
  });
  const output: R1136OrdinaryConsumerAvailabilityChainRunnerOutput = {
    artifactBoundary: safeBoundary(),
    availabilityChain: {
      blockers: [
        ...r1133Run.output.ordinaryDataAvailabilityPreflight.blockers,
        ...r1134Run.output.availabilityConfigBridge.blockers,
        ...r1135Run.output.availabilityManifestPacket.blockers,
      ].filter((blocker, index, all) => all.indexOf(blocker) === index),
      commands: {
        availabilityChainRunnerCommand: R1136_CHAIN_RUNNER_COMMAND,
        availabilityConfigBridgeCommand:
          r1134Run.output.availabilityConfigBridge.commands.availabilityConfigBridgeCommand,
        availabilityManifestPacketCommand:
          r1135Run.output.availabilityManifestPacket.commands.availabilityManifestPacketCommand,
        availabilityPreflightCommand:
          r1133Run.output.ordinaryDataAvailabilityPreflight.commands.availabilityPreflightCommand,
        configIntakeCommand: r1134Run.output.availabilityConfigBridge.commands.configIntakeCommand,
        currentLoopCommand: "pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts",
        metricIntakeCommand: r1134Run.output.availabilityConfigBridge.commands.metricIntakeCommand,
        privateRunnerCommand: r1134Run.output.availabilityConfigBridge.commands.privateRunnerCommand,
      },
      manifestSuppliedToRunner: Boolean(availabilityManifestPath?.trim()),
      missingSourceFamilyIds: r1135Run.output.summary.missingSourceFamilyIds,
      primarySubmitterInputFamilyIds: [...PRIMARY_SUBMITTER_INPUT_FAMILY_IDS],
      privateDetailsStored: false,
      readyForPrivateConfigMapping,
      readyForPrivateRunner,
      requiredLinkageFamilyIds: [...REQUIRED_LINKAGE_FAMILY_IDS],
      stageOrder: [
        "r1133_availability_preflight",
        "r1134_availability_config_bridge",
        "r1135_availability_manifest_packet",
      ],
      stageResults: [
        {
          artifact: "r1133-ordinary-consumer-data-availability-preflight.latest.json",
          conclusion: r1133Run.output.summary.conclusion,
          packetId: r1133Run.output.packetId,
          schemaVersion: r1133Run.output.schemaVersion,
        },
        {
          artifact: "r1134-ordinary-consumer-availability-config-bridge.latest.json",
          conclusion: r1134Run.output.summary.conclusion,
          packetId: r1134Run.output.packetId,
          schemaVersion: r1134Run.output.schemaVersion,
        },
        {
          artifact: "r1135-ordinary-consumer-availability-manifest-packet.latest.json",
          conclusion: r1135Run.output.summary.conclusion,
          packetId: r1135Run.output.packetId,
          schemaVersion: r1135Run.output.schemaVersion,
        },
      ],
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r1136-ordinary-consumer-availability-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: R1136_ORDINARY_CONSUMER_AVAILABILITY_CHAIN_RUNNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      manifestSuppliedToRunner: Boolean(availabilityManifestPath?.trim()),
      missingSourceFamilyIds: r1135Run.output.summary.missingSourceFamilyIds,
      nextAction: nextActionFor(conclusion),
      primarySubmitterInputFamilyIds: [...PRIMARY_SUBMITTER_INPUT_FAMILY_IDS],
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping,
      readyForPrivateRunner,
      realAggregateStillMissing: !readyForPrivateRunner,
      requiredLinkageFamilyIds: [...REQUIRED_LINKAGE_FAMILY_IDS],
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1136: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1136 ordinary consumer availability chain runner failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  manifestSuppliedToRunner: boolean;
  r1135Conclusion: string;
  readyForPrivateConfigMapping: boolean;
  readyForPrivateRunner: boolean;
}): ChainConclusion {
  if (input.readyForPrivateRunner) return "ordinary_availability_chain_ready_for_private_runner";
  if (input.readyForPrivateConfigMapping) return "ordinary_availability_chain_ready_for_private_config_mapping";
  if (!input.manifestSuppliedToRunner) return "ordinary_availability_chain_waiting_on_safe_manifest";
  if (input.r1135Conclusion === "ordinary_availability_manifest_packet_waiting_on_refresh") {
    return "ordinary_availability_chain_waiting_on_refresh";
  }
  return "ordinary_availability_chain_blocked_missing_required_availability";
}

function nextActionFor(conclusion: ChainConclusion): ChainNextAction {
  if (conclusion === "ordinary_availability_chain_waiting_on_safe_manifest") {
    return "fill_safe_availability_manifest_then_run_r1136_chain";
  }
  if (conclusion === "ordinary_availability_chain_waiting_on_refresh") {
    return "refresh_inputs_then_run_r1136_chain";
  }
  if (conclusion === "ordinary_availability_chain_blocked_missing_required_availability") {
    return "collect_outcome_linked_wearable_and_lab_availability_then_run_r1136_chain";
  }
  if (conclusion === "ordinary_availability_chain_ready_for_private_runner") {
    return "run_r1125_private_runner_then_r1124_real_metric_intake";
  }
  return "fill_private_config_mapping_for_available_wearables_labs";
}

function safeBoundary(): R1136OrdinaryConsumerAvailabilityChainRunnerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    availabilityManifestPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1136: false,
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
    rowParsingPerformedByR1136: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1136OrdinaryConsumerAvailabilityChainRunner({
    availabilityManifestPath: process.env.MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1076Path: process.env.MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH,
    r1132Path: process.env.MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    manifestSuppliedToRunner: output.summary.manifestSuppliedToRunner,
    missingSourceFamilyIds: output.summary.missingSourceFamilyIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    primarySubmitterInputFamilyIds: output.summary.primarySubmitterInputFamilyIds,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyForPrivateConfigMapping: output.summary.readyForPrivateConfigMapping,
    readyForPrivateRunner: output.summary.readyForPrivateRunner,
    requiredLinkageFamilyIds: output.summary.requiredLinkageFamilyIds,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1136: output.summary.rowParsingPerformedByR1136,
    schemaVersion: output.schemaVersion,
    stageResults: output.availabilityChain.stageResults,
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
    process.stderr.write(`${safeCliErrorMessage(error, "R1136 ordinary consumer availability chain runner failed.")}\n`);
    process.exitCode = 1;
  });
}
