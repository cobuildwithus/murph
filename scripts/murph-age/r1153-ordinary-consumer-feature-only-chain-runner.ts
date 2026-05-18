import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake,
  type R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOutput,
} from "./r1150-ordinary-consumer-safe-availability-confirmation-intake.ts";
import {
  runR1151OrdinaryConsumerFeatureOnlySubmissionMode,
  type R1151OrdinaryConsumerFeatureOnlySubmissionModeOutput,
} from "./r1151-ordinary-consumer-feature-only-submission-mode.ts";
import {
  runR1152OrdinaryConsumerFeatureOnlyCoverageContextIntake,
  type R1152OrdinaryConsumerFeatureOnlyCoverageContextIntakeOutput,
} from "./r1152-ordinary-consumer-feature-only-coverage-context-intake.ts";

export const R1153_ORDINARY_CONSUMER_FEATURE_ONLY_CHAIN_RUNNER_SCHEMA_VERSION =
  "murph-age-r1153-ordinary-consumer-feature-only-chain-runner.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1153-ordinary-consumer-feature-only-chain-runner.latest.json";
const DERIVED_FEATURE_ONLY_COVERAGE_CONTEXT_FILE_NAME =
  "r1153-derived-feature-only-coverage-context-from-safe-availability.json";
const FEATURE_ONLY_COVERAGE_CONTEXT_SCHEMA_VERSION =
  "murph-age-r1151-ordinary-consumer-feature-only-coverage-context.v1" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const EVIDENCE_ROLE = "feature_only_coverage_context_not_model_evidence" as const;
const MINIMUM_FEATURE_PAIR_REQUIRED = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const OPTIONAL_FEATURE_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const REQUIRED_ATTESTATION_KEYS = [
  "aggregateOnly",
  "localOnly",
  "noCoefficientEgress",
  "noHeaderNameEgress",
  "noParticipantEgress",
  "noPredictionEgress",
  "noPrivatePathEgress",
  "noPrivateRefValueEgress",
  "noRowEgress",
  "noSmallCellEgress",
  "noSourceTextEgress",
] as const;
const BLOCKED_CONTEXT_CONTENT = [
  "private_paths",
  "header_names",
  "private_ref_values",
  "source_variable_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "predictions",
  "coefficients",
  "source_text",
] as const;
const R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1150-ordinary-consumer-safe-availability-confirmation-intake.ts" as const;
const R1152_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_COMMAND =
  "MURPH_AGE_R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_PATH=<feature-only-coverage-context.json> pnpm exec tsx scripts/murph-age/r1152-ordinary-consumer-feature-only-coverage-context-intake.ts" as const;
const R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH=<r1150-intake.json> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=lab_plus_wearable_minimum_manifest pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts" as const;

type FeatureFamilyId = typeof MINIMUM_FEATURE_PAIR_REQUIRED[number];
type OptionalFeatureFamilyId = typeof OPTIONAL_FEATURE_FAMILY_IDS[number];
type AnyFeatureFamilyId = FeatureFamilyId | OptionalFeatureFamilyId;
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type BlockedContextContent = typeof BLOCKED_CONTEXT_CONTENT[number];
type ChainConclusion =
  | "ordinary_feature_only_chain_ready_research_only"
  | "ordinary_feature_only_chain_superseded_by_outcome_linked_evidence"
  | "ordinary_feature_only_chain_waiting_on_feature_only_context"
  | "ordinary_feature_only_chain_waiting_on_r1149_submitter_kit"
  | "ordinary_feature_only_chain_waiting_on_safe_availability_confirmation";
type ChainNextAction =
  | "fill_feature_only_coverage_context_template"
  | "fill_safe_availability_confirmation_from_template"
  | "refresh_r1149_submitter_kit"
  | "run_r1144_recipe_readiness_chain_with_confirmed_availability"
  | "use_feature_only_coverage_context_for_research_planning_only";

interface ArtifactSummary {
  artifact: string;
  packetId: string;
  schemaVersion: string;
  status: "available";
}

interface DerivedFeatureOnlyCoverageContext {
  attestations: Record<RequiredAttestationKey, true>;
  blockedContextContent: BlockedContextContent[];
  derivedFromSafeAvailabilityConfirmation: true;
  evidenceRole: typeof EVIDENCE_ROLE;
  featureOnlyCoverageRequiresPreferredPair: true;
  minimumFeaturePairRequired: FeatureFamilyId[];
  modelEvidencePromotionAllowed: false;
  outcomeLinkageRequiredForFeatureOnlyContext: false;
  rowLevelDataAcceptedByR1151: false;
  schemaVersion: typeof FEATURE_ONLY_COVERAGE_CONTEXT_SCHEMA_VERSION;
  sourceFamilies: Array<{
    available: boolean;
    familyId: AnyFeatureFamilyId;
    privateDetailsStored: false;
  }>;
  targetAgeBand: typeof TARGET_AGE_BAND;
  targetInputPriority: typeof TARGET_INPUT_PRIORITY;
}

export interface R1153OrdinaryConsumerFeatureOnlyChainRunnerOptions {
  confirmationPath?: string;
  contextPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1149Path?: string;
}

export interface R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    availabilityConfirmationPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
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
    rowLevelDataAcceptedByR1153: false;
    rowParsingPerformedByR1153: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  featureOnlyChainRunner: {
    commands: {
      featureOnlyCoverageContextIntakeCommand: typeof R1152_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_COMMAND;
      outcomeLinkedRecipeReadinessCommand: typeof R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND;
      safeAvailabilityConfirmationIntakeCommand: typeof R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND;
    };
    contextPathConfigured: boolean;
    coverageContextReadyForResearchPlanning: boolean;
    derivedCoverageContextArtifact: typeof DERIVED_FEATURE_ONLY_COVERAGE_CONTEXT_FILE_NAME | null;
    derivedCoverageContextUsed: boolean;
    featureOnlyCoverageContextAllowed: boolean;
    minimumFeaturePairRequired: FeatureFamilyId[];
    modelEvidencePromotionAllowed: false;
    outcomeLinkageRequiredForFeatureOnlyContext: false;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1153: false;
    rowParsingPerformedByR1153: false;
    safeAvailabilityConfirmationConfigured: boolean;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  inputArtifacts: {
    r1150: ArtifactSummary;
    r1151: ArtifactSummary;
    r1152: ArtifactSummary;
  };
  packetId: "r1153-ordinary-consumer-feature-only-chain-runner";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1153_ORDINARY_CONSUMER_FEATURE_ONLY_CHAIN_RUNNER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: ChainConclusion;
    contextPathConfigured: boolean;
    coverageContextReadyForResearchPlanning: boolean;
    derivedCoverageContextArtifact: typeof DERIVED_FEATURE_ONLY_COVERAGE_CONTEXT_FILE_NAME | null;
    derivedCoverageContextUsed: boolean;
    featureOnlyCoverageContextIntakeConclusion: R1152OrdinaryConsumerFeatureOnlyCoverageContextIntakeOutput["summary"]["conclusion"];
    featureOnlyCoverageContextIntakeContextStatus: R1152OrdinaryConsumerFeatureOnlyCoverageContextIntakeOutput["summary"]["contextStatus"];
    featureOnlyCoverageContextAllowed: boolean;
    featureOnlyModeConclusion: R1151OrdinaryConsumerFeatureOnlySubmissionModeOutput["summary"]["conclusion"];
    minimumFeaturePairRequired: FeatureFamilyId[];
    missingCoverageContextPrimaryFeatureFamilyIds: FeatureFamilyId[];
    missingFeatureOnlySourceFamilyIds: FeatureFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: ChainNextAction;
    outcomeLinkageRequiredForFeatureOnlyContext: false;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1153: false;
    rowParsingPerformedByR1153: false;
    safeAvailabilityConfirmationConclusion: R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOutput["summary"]["conclusion"];
    safeAvailabilityConfirmationConfigured: boolean;
    safeAvailabilityConfirmationStatus: R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOutput["summary"]["confirmationStatus"];
    safeAvailabilityFeatureOnlyCoverageContextReady: boolean;
    safeAvailabilityReadyForRecipeReadinessChain: boolean;
    supportedFeatureFamilyIds: FeatureFamilyId[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1153OrdinaryConsumerFeatureOnlyChainRunner(
  options: R1153OrdinaryConsumerFeatureOnlyChainRunnerOptions = {},
): Promise<{ output: R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1150Result = await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
    confirmationPath: options.confirmationPath,
    createdAt: options.createdAt,
    outputDir,
    r1149Path: options.r1149Path,
  });
  const r1151Result = await runR1151OrdinaryConsumerFeatureOnlySubmissionMode({
    createdAt: options.createdAt,
    outputDir,
    r1150Path: r1150Result.outputPath,
  });
  const explicitContextPath =
    options.contextPath !== undefined && options.contextPath.trim() !== ""
      ? options.contextPath
      : undefined;
  const derivedCoverageContext =
    explicitContextPath === undefined
      ? derivedContextFromSafeAvailability(r1150Result.output)
      : null;
  const derivedCoverageContextPath = derivedCoverageContext === null
    ? undefined
    : path.join(outputDir, DERIVED_FEATURE_ONLY_COVERAGE_CONTEXT_FILE_NAME);
  if (derivedCoverageContext !== null && derivedCoverageContextPath !== undefined) {
    const findings = findForbiddenAggregateEgress(derivedCoverageContext);
    if (findings.length > 0) {
      throw new Error(`R1153 derived feature-only coverage context failed aggregate-egress validation: ${formatFindingCount(findings)}`);
    }
    await mkdir(outputDir, { recursive: true });
    await writeFile(derivedCoverageContextPath, `${JSON.stringify(derivedCoverageContext, null, 2)}\n`);
  }
  const r1152Result = await runR1152OrdinaryConsumerFeatureOnlyCoverageContextIntake({
    contextPath: explicitContextPath ?? derivedCoverageContextPath,
    createdAt: options.createdAt,
    outputDir,
    r1151Path: r1151Result.outputPath,
  });

  const summaryFacts = summaryFactsFrom({
    r1150: r1150Result.output,
    r1151: r1151Result.output,
    r1152: r1152Result.output,
  });
  const output: R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    featureOnlyChainRunner: {
      commands: {
        featureOnlyCoverageContextIntakeCommand: R1152_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_COMMAND,
        outcomeLinkedRecipeReadinessCommand: R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND,
        safeAvailabilityConfirmationIntakeCommand: R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND,
      },
      contextPathConfigured: explicitContextPath !== undefined,
      coverageContextReadyForResearchPlanning: summaryFacts.coverageContextReadyForResearchPlanning,
      derivedCoverageContextArtifact:
        derivedCoverageContextPath === undefined ? null : DERIVED_FEATURE_ONLY_COVERAGE_CONTEXT_FILE_NAME,
      derivedCoverageContextUsed: derivedCoverageContextPath !== undefined,
      featureOnlyCoverageContextAllowed: summaryFacts.featureOnlyCoverageContextAllowed,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_REQUIRED],
      modelEvidencePromotionAllowed: false,
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1153: false,
      rowParsingPerformedByR1153: false,
      safeAvailabilityConfirmationConfigured:
        options.confirmationPath !== undefined && options.confirmationPath.trim() !== "",
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    inputArtifacts: {
      r1150: summarizeArtifact(r1150Result.output, "r1150-ordinary-consumer-safe-availability-confirmation-intake.latest.json"),
      r1151: summarizeArtifact(r1151Result.output, "r1151-ordinary-consumer-feature-only-submission-mode.latest.json"),
      r1152: summarizeArtifact(r1152Result.output, "r1152-ordinary-consumer-feature-only-coverage-context-intake.latest.json"),
    },
    packetId: "r1153-ordinary-consumer-feature-only-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: R1153_ORDINARY_CONSUMER_FEATURE_ONLY_CHAIN_RUNNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: summaryFacts.conclusion,
      contextPathConfigured: explicitContextPath !== undefined,
      coverageContextReadyForResearchPlanning: summaryFacts.coverageContextReadyForResearchPlanning,
      derivedCoverageContextArtifact:
        derivedCoverageContextPath === undefined ? null : DERIVED_FEATURE_ONLY_COVERAGE_CONTEXT_FILE_NAME,
      derivedCoverageContextUsed: derivedCoverageContextPath !== undefined,
      featureOnlyCoverageContextIntakeConclusion: r1152Result.output.summary.conclusion,
      featureOnlyCoverageContextIntakeContextStatus: r1152Result.output.summary.contextStatus,
      featureOnlyCoverageContextAllowed: summaryFacts.featureOnlyCoverageContextAllowed,
      featureOnlyModeConclusion: r1151Result.output.summary.conclusion,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_REQUIRED],
      missingCoverageContextPrimaryFeatureFamilyIds:
        typedFeatureFamilyIds(r1152Result.output.summary.missingPrimaryFeatureFamilyIds),
      missingFeatureOnlySourceFamilyIds:
        typedFeatureFamilyIds(r1150Result.output.summary.missingFeatureOnlySourceFamilyIds),
      modelEvidencePromotionAllowed: false,
      nextAction: summaryFacts.nextAction,
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1153: false,
      rowParsingPerformedByR1153: false,
      safeAvailabilityConfirmationConclusion: r1150Result.output.summary.conclusion,
      safeAvailabilityConfirmationConfigured:
        options.confirmationPath !== undefined && options.confirmationPath.trim() !== "",
      safeAvailabilityConfirmationStatus: r1150Result.output.summary.confirmationStatus,
      safeAvailabilityFeatureOnlyCoverageContextReady:
        r1150Result.output.summary.featureOnlyCoverageContextReady,
      safeAvailabilityReadyForRecipeReadinessChain:
        r1150Result.output.summary.readyForRecipeReadinessChain,
      supportedFeatureFamilyIds: typedFeatureFamilyIds(r1152Result.output.summary.supportedFeatureFamilyIds),
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1153 ordinary feature-only chain runner failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summaryFactsFrom(input: {
  r1150: R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOutput;
  r1151: R1151OrdinaryConsumerFeatureOnlySubmissionModeOutput;
  r1152: R1152OrdinaryConsumerFeatureOnlyCoverageContextIntakeOutput;
}): {
  conclusion: ChainConclusion;
  coverageContextReadyForResearchPlanning: boolean;
  featureOnlyCoverageContextAllowed: boolean;
  nextAction: ChainNextAction;
} {
  const r1149Ready = input.r1150.summary.r1149SubmitterKitReadyForSafeConfirmation;
  const featureOnlyCoverageContextAllowed = input.r1151.summary.featureOnlyCoverageContextAllowed;
  const coverageContextReadyForResearchPlanning =
    input.r1152.summary.coverageContextReadyForResearchPlanning;
  if (!r1149Ready) {
    return {
      conclusion: "ordinary_feature_only_chain_waiting_on_r1149_submitter_kit",
      coverageContextReadyForResearchPlanning,
      featureOnlyCoverageContextAllowed,
      nextAction: "refresh_r1149_submitter_kit",
    };
  }
  if (
    input.r1150.summary.readyForRecipeReadinessChain
    || input.r1151.summary.outcomeLinkedEvidenceReady
  ) {
    return {
      conclusion: "ordinary_feature_only_chain_superseded_by_outcome_linked_evidence",
      coverageContextReadyForResearchPlanning,
      featureOnlyCoverageContextAllowed,
      nextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
    };
  }
  if (!input.r1150.summary.featureOnlyCoverageContextReady || !featureOnlyCoverageContextAllowed) {
    return {
      conclusion: "ordinary_feature_only_chain_waiting_on_safe_availability_confirmation",
      coverageContextReadyForResearchPlanning,
      featureOnlyCoverageContextAllowed,
      nextAction: "fill_safe_availability_confirmation_from_template",
    };
  }
  if (!coverageContextReadyForResearchPlanning) {
    return {
      conclusion: "ordinary_feature_only_chain_waiting_on_feature_only_context",
      coverageContextReadyForResearchPlanning,
      featureOnlyCoverageContextAllowed,
      nextAction: "fill_feature_only_coverage_context_template",
    };
  }
  return {
    conclusion: "ordinary_feature_only_chain_ready_research_only",
    coverageContextReadyForResearchPlanning,
    featureOnlyCoverageContextAllowed,
    nextAction: "use_feature_only_coverage_context_for_research_planning_only",
  };
}

function derivedContextFromSafeAvailability(
  r1150: R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOutput,
): DerivedFeatureOnlyCoverageContext | null {
  if (
    r1150.summary.featureOnlyCoverageContextReady !== true
    || r1150.summary.readyForRecipeReadinessChain === true
  ) {
    return null;
  }
  return {
    attestations: Object.fromEntries(REQUIRED_ATTESTATION_KEYS.map((key) => [key, true])) as Record<
      RequiredAttestationKey,
      true
    >,
    blockedContextContent: [...BLOCKED_CONTEXT_CONTENT],
    derivedFromSafeAvailabilityConfirmation: true,
    evidenceRole: EVIDENCE_ROLE,
    featureOnlyCoverageRequiresPreferredPair: true,
    minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_REQUIRED],
    modelEvidencePromotionAllowed: false,
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    rowLevelDataAcceptedByR1151: false,
    schemaVersion: FEATURE_ONLY_COVERAGE_CONTEXT_SCHEMA_VERSION,
    sourceFamilies: [
      ...MINIMUM_FEATURE_PAIR_REQUIRED.map((familyId) => ({
        available: true,
        familyId,
        privateDetailsStored: false as const,
      })),
      ...OPTIONAL_FEATURE_FAMILY_IDS.map((familyId) => ({
        available: false,
        familyId,
        privateDetailsStored: false as const,
      })),
    ],
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function summarizeArtifact(
  output: { packetId: string; schemaVersion: string },
  artifact: string,
): ArtifactSummary {
  return {
    artifact,
    packetId: output.packetId,
    schemaVersion: output.schemaVersion,
    status: "available",
  };
}

function typedFeatureFamilyIds(values: readonly string[]): FeatureFamilyId[] {
  return MINIMUM_FEATURE_PAIR_REQUIRED.filter((value): value is FeatureFamilyId => values.includes(value));
}

function safeBoundary(): R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    availabilityConfirmationPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
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
    rowLevelDataAcceptedByR1153: false,
    rowParsingPerformedByR1153: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function cliSummary(output: R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput): Record<string, unknown> {
  return {
    conclusion: output.summary.conclusion,
    coverageContextReadyForResearchPlanning: output.summary.coverageContextReadyForResearchPlanning,
    derivedCoverageContextArtifact: output.summary.derivedCoverageContextArtifact,
    derivedCoverageContextUsed: output.summary.derivedCoverageContextUsed,
    featureOnlyCoverageContextAllowed: output.summary.featureOnlyCoverageContextAllowed,
    featureOnlyCoverageContextIntakeConclusion: output.summary.featureOnlyCoverageContextIntakeConclusion,
    featureOnlyCoverageContextIntakeContextStatus: output.summary.featureOnlyCoverageContextIntakeContextStatus,
    featureOnlyModeConclusion: output.summary.featureOnlyModeConclusion,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    missingCoverageContextPrimaryFeatureFamilyIds: output.summary.missingCoverageContextPrimaryFeatureFamilyIds,
    missingFeatureOnlySourceFamilyIds: output.summary.missingFeatureOnlySourceFamilyIds,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    outcomeLinkageRequiredForFeatureOnlyContext: output.summary.outcomeLinkageRequiredForFeatureOnlyContext,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1153: output.summary.rowLevelDataAcceptedByR1153,
    rowParsingPerformedByR1153: output.summary.rowParsingPerformedByR1153,
    safeAvailabilityConfirmationConclusion: output.summary.safeAvailabilityConfirmationConclusion,
    safeAvailabilityConfirmationStatus: output.summary.safeAvailabilityConfirmationStatus,
    safeAvailabilityFeatureOnlyCoverageContextReady: output.summary.safeAvailabilityFeatureOnlyCoverageContextReady,
    safeAvailabilityReadyForRecipeReadinessChain: output.summary.safeAvailabilityReadyForRecipeReadinessChain,
    supportedFeatureFamilyIds: output.summary.supportedFeatureFamilyIds,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1153OrdinaryConsumerFeatureOnlyChainRunner({
    confirmationPath: process.env.MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH,
    contextPath: process.env.MURPH_AGE_R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_PATH,
    outputDir: process.env.MURPH_AGE_R1153_OUTPUT_DIR,
    r1149Path: process.env.MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH,
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1153 ordinary feature-only chain runner failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
