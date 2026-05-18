import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1140OrdinaryConsumerPartialReadinessChainRunner } from "./r1140-ordinary-consumer-partial-readiness-chain-runner.ts";
import { runR1143OrdinaryConsumerAvailabilityManifestRecipeMaterializer } from "./r1143-ordinary-consumer-availability-manifest-recipe-materializer.ts";

export const R1144_ORDINARY_CONSUMER_RECIPE_READINESS_CHAIN_RUNNER_SCHEMA_VERSION =
  "murph-age-r1144-ordinary-consumer-recipe-readiness-chain-runner.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1144-ordinary-consumer-recipe-readiness-chain-runner.latest.json";
const R1143_MATERIALIZER_ARTIFACT =
  "r1143-ordinary-consumer-availability-manifest-recipe-materializer.latest.json";
const R1140_PARTIAL_READINESS_ARTIFACT =
  "r1140-ordinary-consumer-partial-readiness-chain-runner.latest.json";
const R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts" as const;

type RecipeReadinessConclusion =
  | "ordinary_recipe_readiness_chain_blocked_missing_route_inputs"
  | "ordinary_recipe_readiness_chain_full_route_ready_existing_runner_preferred"
  | "ordinary_recipe_readiness_chain_partial_metrics_recorded_research_only"
  | "ordinary_recipe_readiness_chain_ready_for_partial_route_inputs"
  | "ordinary_recipe_readiness_chain_recipe_not_found"
  | "ordinary_recipe_readiness_chain_waiting_on_r1135"
  | "ordinary_recipe_readiness_chain_waiting_on_row_owner_confirmation";
type RecipeReadinessNextAction =
  | "choose_supported_manifest_recipe_id"
  | "confirm_recipe_availability_assertions_before_running_chain"
  | "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner"
  | "fill_private_config_mapping_for_full_labs_wearable_route"
  | "refresh_r1135_manifest_packet"
  | "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence";

export interface R1144OrdinaryConsumerRecipeReadinessChainRunnerOptions {
  assertionsConfirmed?: boolean;
  createdAt?: string;
  outputDir?: string;
  r1076Path?: string;
  r1132Path?: string;
  r1135Path?: string;
  r1150Path?: string;
  recipeId?: string;
}

export interface R1144OrdinaryConsumerRecipeReadinessChainRunnerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    availabilityManifestPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1144: false;
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
    rowParsingPerformedByR1144: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  packetId: "r1144-ordinary-consumer-recipe-readiness-chain-runner";
  productDisplayAuthorized: false;
  recipeReadinessChain: {
    commands: {
      recipeReadinessChainRunnerCommand: typeof R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND;
    };
    eligiblePartialRouteIds: string[];
    fullEvidenceGateCleared: false;
    fullSupportedRouteReady: boolean | null;
    generatedAvailabilityManifestArtifact: string | null;
    generatedManifestWritten: boolean;
    materializerArtifact: typeof R1143_MATERIALIZER_ARTIFACT;
    materializerConclusion: string;
    missingSourceFamilyIds: string[];
    partialAggregateMetricsTemplateArtifact: string | null;
    partialPrivateConfigTemplateArtifact: string | null;
    partialReadinessChainArtifact: typeof R1140_PARTIAL_READINESS_ARTIFACT | null;
    partialReadinessChainConclusion: string | null;
    privateDetailsStored: false;
    readyPartialMetricRouteIds: string[];
    recipeId: string;
    requiredPrivateFieldRefFamilies: string[];
    requiredPrivateTableRefs: string[];
    rowOwnerAssertionsConfirmed: boolean;
    safeAvailabilityConfirmationReadyForRecipeReadinessChain: boolean;
  };
  schemaVersion: typeof R1144_ORDINARY_CONSUMER_RECIPE_READINESS_CHAIN_RUNNER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: RecipeReadinessConclusion;
    eligiblePartialRouteIds: string[];
    fullEvidenceGateCleared: false;
    fullSupportedRouteReady: boolean | null;
    generatedAvailabilityManifestArtifact: string | null;
    generatedManifestWritten: boolean;
    missingSourceFamilyIds: string[];
    nextAction: RecipeReadinessNextAction;
    partialAggregateMetricsTemplateArtifact: string | null;
    partialPrivateConfigTemplateArtifact: string | null;
    productDisplayAuthorized: false;
    readyPartialMetricRouteIds: string[];
    recipeId: string;
    realAggregateStillMissing: true;
    requiredPrivateFieldRefFamilies: string[];
    requiredPrivateTableRefs: string[];
    reviewGptRequiredNow: false;
    rowOwnerAssertionsConfirmed: boolean;
    rowParsingPerformedByR1144: false;
    safeAvailabilityConfirmationReadyForRecipeReadinessChain: boolean;
    targetAgeBand: "roughly_16_50";
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1144OrdinaryConsumerRecipeReadinessChainRunner(
  options: R1144OrdinaryConsumerRecipeReadinessChainRunnerOptions = {},
): Promise<{ output: R1144OrdinaryConsumerRecipeReadinessChainRunnerOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const materializerRun = await runR1143OrdinaryConsumerAvailabilityManifestRecipeMaterializer({
    assertionsConfirmed: options.assertionsConfirmed,
    createdAt: options.createdAt,
    outputDir,
    r1135Path: options.r1135Path,
    r1150Path: options.r1150Path,
    recipeId: options.recipeId,
  });
  const partialReadinessRun = materializerRun.generatedManifestPath
    ? await runR1140OrdinaryConsumerPartialReadinessChainRunner({
      availabilityManifestPath: materializerRun.generatedManifestPath,
      createdAt: options.createdAt,
      outputDir,
      r1076Path: options.r1076Path,
      r1132Path: options.r1132Path,
    })
    : null;
  const conclusion = conclusionFor({
    materializerConclusion: materializerRun.output.summary.conclusion,
    partialReadinessConclusion: partialReadinessRun?.output.summary.conclusion ?? null,
  });
  const output: R1144OrdinaryConsumerRecipeReadinessChainRunnerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r1144-ordinary-consumer-recipe-readiness-chain-runner",
    productDisplayAuthorized: false,
    recipeReadinessChain: {
      commands: {
        recipeReadinessChainRunnerCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
      },
      eligiblePartialRouteIds: partialReadinessRun?.output.summary.eligiblePartialRouteIds ?? [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: partialReadinessRun?.output.summary.fullSupportedRouteReady ?? null,
      generatedAvailabilityManifestArtifact: materializerRun.output.summary.generatedAvailabilityManifestArtifact,
      generatedManifestWritten: materializerRun.output.summary.generatedManifestWritten,
      materializerArtifact: R1143_MATERIALIZER_ARTIFACT,
      materializerConclusion: materializerRun.output.summary.conclusion,
      missingSourceFamilyIds: partialReadinessRun?.output.summary.missingSourceFamilyIds
        ?? materializerRun.output.summary.sourceFamiliesDeclaredUnavailable,
      partialAggregateMetricsTemplateArtifact:
        partialReadinessRun?.output.summary.partialAggregateMetricsTemplateArtifact ?? null,
      partialPrivateConfigTemplateArtifact:
        partialReadinessRun?.output.summary.partialPrivateConfigTemplateArtifact ?? null,
      partialReadinessChainArtifact: partialReadinessRun ? R1140_PARTIAL_READINESS_ARTIFACT : null,
      partialReadinessChainConclusion: partialReadinessRun?.output.summary.conclusion ?? null,
      privateDetailsStored: false,
      readyPartialMetricRouteIds: partialReadinessRun?.output.summary.readyPartialMetricRouteIds ?? [],
      recipeId: materializerRun.output.summary.recipeId,
      requiredPrivateFieldRefFamilies: partialReadinessRun?.output.summary.requiredPrivateFieldRefFamilies ?? [],
      requiredPrivateTableRefs: partialReadinessRun?.output.summary.requiredPrivateTableRefs ?? [],
      rowOwnerAssertionsConfirmed: materializerRun.output.summary.rowOwnerAssertionsConfirmed,
      safeAvailabilityConfirmationReadyForRecipeReadinessChain:
        materializerRun.output.summary.safeAvailabilityConfirmationReadyForRecipeReadinessChain,
    },
    schemaVersion: R1144_ORDINARY_CONSUMER_RECIPE_READINESS_CHAIN_RUNNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      eligiblePartialRouteIds: partialReadinessRun?.output.summary.eligiblePartialRouteIds ?? [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: partialReadinessRun?.output.summary.fullSupportedRouteReady ?? null,
      generatedAvailabilityManifestArtifact: materializerRun.output.summary.generatedAvailabilityManifestArtifact,
      generatedManifestWritten: materializerRun.output.summary.generatedManifestWritten,
      missingSourceFamilyIds: partialReadinessRun?.output.summary.missingSourceFamilyIds
        ?? materializerRun.output.summary.sourceFamiliesDeclaredUnavailable,
      nextAction: nextActionFor(conclusion, partialReadinessRun?.output.summary.nextAction ?? null),
      partialAggregateMetricsTemplateArtifact:
        partialReadinessRun?.output.summary.partialAggregateMetricsTemplateArtifact ?? null,
      partialPrivateConfigTemplateArtifact:
        partialReadinessRun?.output.summary.partialPrivateConfigTemplateArtifact ?? null,
      productDisplayAuthorized: false,
      readyPartialMetricRouteIds: partialReadinessRun?.output.summary.readyPartialMetricRouteIds ?? [],
      recipeId: materializerRun.output.summary.recipeId,
      realAggregateStillMissing: true,
      requiredPrivateFieldRefFamilies: partialReadinessRun?.output.summary.requiredPrivateFieldRefFamilies ?? [],
      requiredPrivateTableRefs: partialReadinessRun?.output.summary.requiredPrivateTableRefs ?? [],
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed: materializerRun.output.summary.rowOwnerAssertionsConfirmed,
      rowParsingPerformedByR1144: false,
      safeAvailabilityConfirmationReadyForRecipeReadinessChain:
        materializerRun.output.summary.safeAvailabilityConfirmationReadyForRecipeReadinessChain,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1144 ordinary consumer recipe readiness chain failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  materializerConclusion: string;
  partialReadinessConclusion: string | null;
}): RecipeReadinessConclusion {
  if (input.materializerConclusion === "ordinary_manifest_recipe_materializer_waiting_on_r1135") {
    return "ordinary_recipe_readiness_chain_waiting_on_r1135";
  }
  if (input.materializerConclusion === "ordinary_manifest_recipe_materializer_recipe_not_found") {
    return "ordinary_recipe_readiness_chain_recipe_not_found";
  }
  if (input.materializerConclusion === "ordinary_manifest_recipe_materializer_waiting_on_row_owner_confirmation") {
    return "ordinary_recipe_readiness_chain_waiting_on_row_owner_confirmation";
  }
  if (input.partialReadinessConclusion === "ordinary_partial_readiness_chain_full_route_ready_existing_runner_preferred") {
    return "ordinary_recipe_readiness_chain_full_route_ready_existing_runner_preferred";
  }
  if (input.partialReadinessConclusion === "ordinary_partial_readiness_chain_partial_metrics_recorded_research_only") {
    return "ordinary_recipe_readiness_chain_partial_metrics_recorded_research_only";
  }
  if (input.partialReadinessConclusion === "ordinary_partial_readiness_chain_ready_for_partial_private_mapping") {
    return "ordinary_recipe_readiness_chain_ready_for_partial_route_inputs";
  }
  return "ordinary_recipe_readiness_chain_blocked_missing_route_inputs";
}

function nextActionFor(
  conclusion: RecipeReadinessConclusion,
  partialReadinessNextAction: string | null,
): RecipeReadinessNextAction {
  if (conclusion === "ordinary_recipe_readiness_chain_waiting_on_r1135") return "refresh_r1135_manifest_packet";
  if (conclusion === "ordinary_recipe_readiness_chain_recipe_not_found") return "choose_supported_manifest_recipe_id";
  if (conclusion === "ordinary_recipe_readiness_chain_waiting_on_row_owner_confirmation") {
    return "confirm_recipe_availability_assertions_before_running_chain";
  }
  if (conclusion === "ordinary_recipe_readiness_chain_full_route_ready_existing_runner_preferred") {
    return "fill_private_config_mapping_for_full_labs_wearable_route";
  }
  if (conclusion === "ordinary_recipe_readiness_chain_partial_metrics_recorded_research_only") {
    return "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence";
  }
  return partialReadinessNextAction === "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner"
    ? "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner"
    : "confirm_recipe_availability_assertions_before_running_chain";
}

function safeBoundary(): R1144OrdinaryConsumerRecipeReadinessChainRunnerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    availabilityManifestPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1144: false,
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
    rowParsingPerformedByR1144: false,
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

async function main(): Promise<void> {
  const { output } = await runR1144OrdinaryConsumerRecipeReadinessChainRunner({
    assertionsConfirmed: process.env.MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED === "true",
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1076Path: process.env.MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH,
    r1132Path: process.env.MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH,
    r1135Path: process.env.MURPH_AGE_R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_PATH,
    r1150Path: process.env.MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH,
    recipeId: process.env.MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    eligiblePartialRouteIds: output.summary.eligiblePartialRouteIds,
    generatedAvailabilityManifestArtifact: output.summary.generatedAvailabilityManifestArtifact,
    generatedManifestWritten: output.summary.generatedManifestWritten,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    partialAggregateMetricsTemplateArtifact: output.summary.partialAggregateMetricsTemplateArtifact,
    partialPrivateConfigTemplateArtifact: output.summary.partialPrivateConfigTemplateArtifact,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyPartialMetricRouteIds: output.summary.readyPartialMetricRouteIds,
    recipeId: output.summary.recipeId,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    requiredPrivateFieldRefFamilies: output.summary.requiredPrivateFieldRefFamilies,
    requiredPrivateTableRefs: output.summary.requiredPrivateTableRefs,
    rowOwnerAssertionsConfirmed: output.summary.rowOwnerAssertionsConfirmed,
    safeAvailabilityConfirmationReadyForRecipeReadinessChain:
      output.summary.safeAvailabilityConfirmationReadyForRecipeReadinessChain,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1144 recipe readiness chain failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
