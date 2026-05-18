import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake } from "./r1150-ordinary-consumer-safe-availability-confirmation-intake.ts";
import { runR1153OrdinaryConsumerFeatureOnlyChainRunner } from "./r1153-ordinary-consumer-feature-only-chain-runner.ts";
import { runR1154OrdinaryConsumerSafeAvailabilityActionPacket } from "./r1154-ordinary-consumer-safe-availability-action-packet.ts";
import { runR1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProof } from "./r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.ts";
import { runR1156OrdinaryConsumerSafeConfirmationHandoff } from "./r1156-ordinary-consumer-safe-confirmation-handoff.ts";

export const R1157_ORDINARY_CONSUMER_SAFE_CONFIRMATION_CHAIN_RUNNER_SCHEMA_VERSION =
  "murph-age-r1157-ordinary-consumer-safe-confirmation-chain-runner.v1" as const;
export const R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1157-ordinary-consumer-safe-confirmation-chain-runner.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1157-ordinary-consumer-safe-confirmation-chain-runner.latest.json";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;

type ChainConclusion =
  | "ordinary_safe_confirmation_chain_feature_only_ready_non_evidence"
  | "ordinary_safe_confirmation_chain_ready_for_recipe_readiness_non_evidence"
  | "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation"
  | "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation_completion"
  | "ordinary_safe_confirmation_chain_waiting_on_valid_safe_confirmation";
type ChainNextAction =
  | "complete_safe_availability_confirmation_template"
  | "fill_safe_availability_confirmation_from_template"
  | "rerun_safe_availability_confirmation_with_valid_json_object"
  | "run_r1144_recipe_readiness_chain_with_confirmed_availability"
  | "use_r1153_feature_only_chain_output_for_research_planning";

interface ArtifactSummary {
  artifact: string;
  packetId: string;
  schemaVersion: string;
  status: string;
}

export interface R1157OrdinaryConsumerSafeConfirmationChainRunnerOptions {
  confirmationPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1149Path?: string;
}

export interface R1157OrdinaryConsumerSafeConfirmationChainRunnerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    availabilityConfirmationPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    confirmationValuesStored: false;
    contextPathStored: false;
    featureValuesStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateFieldRefValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefValuesStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowLevelDataAcceptedByR1157: false;
    rowParsingPerformedByR1157: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
    temporaryConfirmationPersistedByR1157: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1150: ArtifactSummary;
    r1153: ArtifactSummary;
    r1154: ArtifactSummary;
    r1155: ArtifactSummary;
    r1156: ArtifactSummary;
  };
  packetId: "r1157-ordinary-consumer-safe-confirmation-chain-runner";
  productDisplayAuthorized: false;
  safeConfirmationChainRunner: {
    commands: {
      featureOnlyChainRunnerCommand: string | null;
      safeAvailabilityActionPacketCommand: string | null;
      safeAvailabilityConfirmationIntakeCommand: string | null;
      safeConfirmationChainRunnerCommand: typeof R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND;
      safeConfirmationHandoffCommand: string | null;
    };
    confirmationPathConfigured: boolean;
    featureOnlyCoverageContextReady: boolean;
    featureOnlyResearchPlanningReady: boolean;
    handoffNextAction: string | null;
    handoffReadyForRowOwner: boolean;
    modelEvidencePromotionAllowed: false;
    nextActionAfterChain: ChainNextAction;
    productDisplayAuthorized: false;
    readyForModelEvidence: false;
    readyForRecipeReadinessChain: boolean;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1157: false;
    rowParsingPerformedByR1157: false;
    safeConfirmationStillRequired: boolean;
    stageConclusions: {
      r1150: string;
      r1153: string;
      r1154: string;
      r1155: string;
      r1156: string;
    };
    stageNextActions: {
      r1150: string;
      r1153: string;
      r1154: string;
      r1155: string;
      r1156: string;
    };
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  schemaVersion: typeof R1157_ORDINARY_CONSUMER_SAFE_CONFIRMATION_CHAIN_RUNNER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: ChainConclusion;
    confirmationPathConfigured: boolean;
    featureOnlyCoverageContextReady: boolean;
    featureOnlyResearchPlanningReady: boolean;
    handoffReadyForRowOwner: boolean;
    modelEvidencePromotionAllowed: false;
    nextAction: ChainNextAction;
    productDisplayAuthorized: false;
    readyForModelEvidence: false;
    readyForRecipeReadinessChain: boolean;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1157: false;
    rowParsingPerformedByR1157: false;
    safeAvailabilityActionPacketConclusion: string;
    safeAvailabilityConfirmationConclusion: string;
    safeConfirmationChainRunnerCommand: typeof R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND;
    safeConfirmationHandoffConclusion: string;
    safeConfirmationStillRequired: boolean;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1157OrdinaryConsumerSafeConfirmationChainRunner(
  options: R1157OrdinaryConsumerSafeConfirmationChainRunnerOptions = {},
): Promise<{ output: R1157OrdinaryConsumerSafeConfirmationChainRunnerOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const confirmationPath = nonEmpty(options.confirmationPath);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const r1150Result = await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
    confirmationPath,
    createdAt,
    outputDir,
    r1149Path: options.r1149Path,
  });
  const r1153Result = await runR1153OrdinaryConsumerFeatureOnlyChainRunner({
    confirmationPath,
    createdAt,
    outputDir,
    r1149Path: options.r1149Path,
  });
  const r1154Result = await runR1154OrdinaryConsumerSafeAvailabilityActionPacket({
    createdAt,
    outputDir,
    r1150Path: r1150Result.outputPath,
  });
  const r1155Result = await runR1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProof({
    createdAt,
    outputDir,
    r1149Path: options.r1149Path,
  });
  const r1156Result = await runR1156OrdinaryConsumerSafeConfirmationHandoff({
    createdAt,
    outputDir,
    r1150Path: r1150Result.outputPath,
    r1154Path: r1154Result.outputPath,
    r1155Path: r1155Result.outputPath,
  });

  const featureOnlyCoverageContextReady =
    r1150Result.output.summary.featureOnlyCoverageContextReady
    && r1153Result.output.summary.coverageContextReadyForResearchPlanning;
  const readyForRecipeReadinessChain =
    r1150Result.output.summary.readyForRecipeReadinessChain
    && r1154Result.output.summary.readyForOutcomeLinkedRecipeReadinessChain;
  const safeConfirmationStillRequired = r1156Result.output.summary.safeConfirmationStillRequired;
  const conclusion = conclusionFor({
    confirmationPathConfigured: confirmationPath !== undefined,
    confirmationStatus: r1150Result.output.summary.confirmationStatus,
    featureOnlyCoverageContextReady,
    readyForRecipeReadinessChain,
  });
  const nextAction = nextActionFor(conclusion);
  const output: R1157OrdinaryConsumerSafeConfirmationChainRunnerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt,
    inputArtifacts: {
      r1150: summarizeArtifact(r1150Result.output, "r1150-ordinary-consumer-safe-availability-confirmation-intake.latest.json"),
      r1153: summarizeArtifact(r1153Result.output, "r1153-ordinary-consumer-feature-only-chain-runner.latest.json"),
      r1154: summarizeArtifact(r1154Result.output, "r1154-ordinary-consumer-safe-availability-action-packet.latest.json"),
      r1155: summarizeArtifact(r1155Result.output, "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.latest.json"),
      r1156: summarizeArtifact(r1156Result.output, "r1156-ordinary-consumer-safe-confirmation-handoff.latest.json"),
    },
    packetId: "r1157-ordinary-consumer-safe-confirmation-chain-runner",
    productDisplayAuthorized: false,
    safeConfirmationChainRunner: {
      commands: {
        featureOnlyChainRunnerCommand:
          r1150Result.output.safeAvailabilityConfirmationIntake.commands.featureOnlyChainRunnerCommand,
        safeAvailabilityActionPacketCommand:
          r1154Result.output.safeAvailabilityActionPacket.commands.safeAvailabilityActionPacketCommand,
        safeAvailabilityConfirmationIntakeCommand:
          r1150Result.output.safeAvailabilityConfirmationIntake.commands.safeAvailabilityConfirmationIntakeCommand,
        safeConfirmationChainRunnerCommand: R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
        safeConfirmationHandoffCommand:
          r1156Result.output.safeConfirmationHandoff.commands.safeConfirmationHandoffCommand,
      },
      confirmationPathConfigured: confirmationPath !== undefined,
      featureOnlyCoverageContextReady,
      featureOnlyResearchPlanningReady: conclusion === "ordinary_safe_confirmation_chain_feature_only_ready_non_evidence",
      handoffNextAction: r1156Result.output.summary.nextAction,
      handoffReadyForRowOwner: r1156Result.output.summary.handoffReadyForRowOwner,
      modelEvidencePromotionAllowed: false,
      nextActionAfterChain: nextAction,
      productDisplayAuthorized: false,
      readyForModelEvidence: false,
      readyForRecipeReadinessChain,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1157: false,
      rowParsingPerformedByR1157: false,
      safeConfirmationStillRequired,
      stageConclusions: {
        r1150: r1150Result.output.summary.conclusion,
        r1153: r1153Result.output.summary.conclusion,
        r1154: r1154Result.output.summary.conclusion,
        r1155: r1155Result.output.summary.conclusion,
        r1156: r1156Result.output.summary.conclusion,
      },
      stageNextActions: {
        r1150: r1150Result.output.summary.nextAction,
        r1153: r1153Result.output.summary.nextAction,
        r1154: r1154Result.output.summary.nextAction,
        r1155: r1155Result.output.summary.nextAction,
        r1156: r1156Result.output.summary.nextAction,
      },
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    schemaVersion: R1157_ORDINARY_CONSUMER_SAFE_CONFIRMATION_CHAIN_RUNNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      confirmationPathConfigured: confirmationPath !== undefined,
      featureOnlyCoverageContextReady,
      featureOnlyResearchPlanningReady: conclusion === "ordinary_safe_confirmation_chain_feature_only_ready_non_evidence",
      handoffReadyForRowOwner: r1156Result.output.summary.handoffReadyForRowOwner,
      modelEvidencePromotionAllowed: false,
      nextAction,
      productDisplayAuthorized: false,
      readyForModelEvidence: false,
      readyForRecipeReadinessChain,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1157: false,
      rowParsingPerformedByR1157: false,
      safeAvailabilityActionPacketConclusion: r1154Result.output.summary.conclusion,
      safeAvailabilityConfirmationConclusion: r1150Result.output.summary.conclusion,
      safeConfirmationChainRunnerCommand: R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
      safeConfirmationHandoffConclusion: r1156Result.output.summary.conclusion,
      safeConfirmationStillRequired,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1157 safe confirmation chain runner failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  confirmationPathConfigured: boolean;
  confirmationStatus: string;
  featureOnlyCoverageContextReady: boolean;
  readyForRecipeReadinessChain: boolean;
}): ChainConclusion {
  if (!input.confirmationPathConfigured || input.confirmationStatus === "missing") {
    return "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation";
  }
  if (input.confirmationStatus === "unexpected_keys" || input.confirmationStatus === "private_scalar_content") {
    return "ordinary_safe_confirmation_chain_waiting_on_valid_safe_confirmation";
  }
  if (input.readyForRecipeReadinessChain) {
    return "ordinary_safe_confirmation_chain_ready_for_recipe_readiness_non_evidence";
  }
  if (input.featureOnlyCoverageContextReady) {
    return "ordinary_safe_confirmation_chain_feature_only_ready_non_evidence";
  }
  return "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation_completion";
}

function nextActionFor(conclusion: ChainConclusion): ChainNextAction {
  if (conclusion === "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation") {
    return "fill_safe_availability_confirmation_from_template";
  }
  if (conclusion === "ordinary_safe_confirmation_chain_waiting_on_valid_safe_confirmation") {
    return "rerun_safe_availability_confirmation_with_valid_json_object";
  }
  if (conclusion === "ordinary_safe_confirmation_chain_ready_for_recipe_readiness_non_evidence") {
    return "run_r1144_recipe_readiness_chain_with_confirmed_availability";
  }
  if (conclusion === "ordinary_safe_confirmation_chain_feature_only_ready_non_evidence") {
    return "use_r1153_feature_only_chain_output_for_research_planning";
  }
  return "complete_safe_availability_confirmation_template";
}

function summarizeArtifact(value: { packetId: string; schemaVersion: string; status: string }, artifact: string): ArtifactSummary {
  return {
    artifact,
    packetId: value.packetId,
    schemaVersion: value.schemaVersion,
    status: value.status,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1157OrdinaryConsumerSafeConfirmationChainRunnerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    availabilityConfirmationPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationValuesStored: false,
    contextPathStored: false,
    featureValuesStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateFieldRefValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefValuesStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowLevelDataAcceptedByR1157: false,
    rowParsingPerformedByR1157: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
    temporaryConfirmationPersistedByR1157: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1157OrdinaryConsumerSafeConfirmationChainRunner({
    confirmationPath: process.env.MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH,
    createdAt: process.env.MURPH_AGE_RESEARCH_CREATED_AT,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1149Path: process.env.MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    confirmationPathConfigured: output.summary.confirmationPathConfigured,
    featureOnlyCoverageContextReady: output.summary.featureOnlyCoverageContextReady,
    featureOnlyResearchPlanningReady: output.summary.featureOnlyResearchPlanningReady,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyForModelEvidence: output.summary.readyForModelEvidence,
    readyForRecipeReadinessChain: output.summary.readyForRecipeReadinessChain,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1157: output.summary.rowLevelDataAcceptedByR1157,
    rowParsingPerformedByR1157: output.summary.rowParsingPerformedByR1157,
    safeAvailabilityConfirmationConclusion: output.summary.safeAvailabilityConfirmationConclusion,
    safeConfirmationChainRunnerCommand: output.summary.safeConfirmationChainRunnerCommand,
    safeConfirmationHandoffConclusion: output.summary.safeConfirmationHandoffConclusion,
    safeConfirmationStillRequired: output.summary.safeConfirmationStillRequired,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1157 safe confirmation chain runner failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
