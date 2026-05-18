import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1153OrdinaryConsumerFeatureOnlyChainRunner } from "./r1153-ordinary-consumer-feature-only-chain-runner.ts";

export const R1155_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FEATURE_ONLY_SMOKE_PROOF_SCHEMA_VERSION =
  "murph-age-r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.latest.json";
const CONFIRMATION_SCHEMA_VERSION =
  "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const PREFERRED_RECIPE_ID = "lab_plus_wearable_minimum_manifest" as const;
const R1149_EXPECTED = {
  artifact: "r1149-ordinary-consumer-lab-wearable-submission-kit.latest.json",
  packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
  schemaVersion: "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1",
} as const;
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
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
const BLOCKED_CONFIRMATION_CONTENT = [
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

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];

type SmokeConclusion =
  | "ordinary_safe_confirmation_feature_only_smoke_incomplete"
  | "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence"
  | "ordinary_safe_confirmation_feature_only_smoke_waiting_on_r1149_submitter_kit";

type SmokeNextAction =
  | "inspect_r1155_feature_only_smoke_stage_outputs"
  | "refresh_r1149_submitter_kit"
  | "use_r1150_r1153_path_with_real_safe_availability_confirmation";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProofOptions {
  createdAt?: string;
  outputDir?: string;
  r1149Path?: string;
}

export interface R1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProofOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    confirmationPathStored: false;
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
    rowLevelDataAcceptedByR1155: false;
    rowParsingPerformedByR1155: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
    temporaryConfirmationPersisted: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1149: ArtifactSummary;
  };
  packetId: "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof";
  productDisplayAuthorized: false;
  safeConfirmationFeatureOnlySmokeProof: {
    compactConfirmationSourceFamilyIds: FeatureOnlySourceFamilyId[];
    derivedCoverageContextUsed: boolean | null;
    featureOnlyChainConclusion: string | null;
    featureOnlyChainNextAction: string | null;
    featureOnlyCoverageContextIntakeConclusion: string | null;
    featureOnlyCoverageContextReadyForResearchPlanning: boolean | null;
    featureOnlyModeConclusion: string | null;
    modelEvidencePromotionAllowed: false;
    outcomeLinkedEvidenceIncludedInSmoke: false;
    productDisplayAuthorized: false;
    readyForRecipeReadinessChain: boolean | null;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1155: false;
    rowParsingPerformedByR1155: false;
    safeAvailabilityConfirmationConclusion: string | null;
    smokeEvidenceRole: "feature_only_safe_confirmation_smoke_only_not_model_evidence";
    temporaryConfirmationWrittenByR1155: boolean;
    temporaryConfirmationValuesPersistedInArtifact: false;
  };
  schemaVersion: typeof R1155_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FEATURE_ONLY_SMOKE_PROOF_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: SmokeConclusion;
    featureOnlyChainConclusion: string | null;
    featureOnlyCoverageContextReadyForResearchPlanning: boolean | null;
    modelEvidencePromotionAllowed: false;
    nextAction: SmokeNextAction;
    productDisplayAuthorized: false;
    readyForRecipeReadinessChain: boolean | null;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1155: false;
    rowParsingPerformedByR1155: false;
    safeAvailabilityConfirmationConclusion: string | null;
    smokeEvidence: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProof(
  options: R1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProofOptions = {},
): Promise<{ output: R1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProofOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1149Path = options.r1149Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1149_EXPECTED.artifact);
  const r1149 = await readJsonIfPresent(r1149Path);
  validateInputBoundary("r1149", r1149);
  const chain = await runTemporaryFeatureOnlySmoke({
    createdAt: options.createdAt,
    r1149Path,
  });
  const conclusion = smokeConclusionFor(chain.output.summary.conclusion);
  const output: R1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProofOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1149: summarizeR1149(r1149),
    },
    packetId: "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof",
    productDisplayAuthorized: false,
    safeConfirmationFeatureOnlySmokeProof: {
      compactConfirmationSourceFamilyIds: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      derivedCoverageContextUsed: chain.output.summary.derivedCoverageContextUsed,
      featureOnlyChainConclusion: chain.output.summary.conclusion,
      featureOnlyChainNextAction: chain.output.summary.nextAction,
      featureOnlyCoverageContextIntakeConclusion:
        chain.output.summary.featureOnlyCoverageContextIntakeConclusion,
      featureOnlyCoverageContextReadyForResearchPlanning:
        chain.output.summary.coverageContextReadyForResearchPlanning,
      featureOnlyModeConclusion: chain.output.summary.featureOnlyModeConclusion,
      modelEvidencePromotionAllowed: false,
      outcomeLinkedEvidenceIncludedInSmoke: false,
      productDisplayAuthorized: false,
      readyForRecipeReadinessChain: chain.output.summary.safeAvailabilityReadyForRecipeReadinessChain,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1155: false,
      rowParsingPerformedByR1155: false,
      safeAvailabilityConfirmationConclusion: chain.output.summary.safeAvailabilityConfirmationConclusion,
      smokeEvidenceRole: "feature_only_safe_confirmation_smoke_only_not_model_evidence",
      temporaryConfirmationWrittenByR1155: true,
      temporaryConfirmationValuesPersistedInArtifact: false,
    },
    schemaVersion: R1155_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FEATURE_ONLY_SMOKE_PROOF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      featureOnlyChainConclusion: chain.output.summary.conclusion,
      featureOnlyCoverageContextReadyForResearchPlanning:
        chain.output.summary.coverageContextReadyForResearchPlanning,
      modelEvidencePromotionAllowed: false,
      nextAction: smokeNextActionFor(conclusion),
      productDisplayAuthorized: false,
      readyForRecipeReadinessChain: chain.output.summary.safeAvailabilityReadyForRecipeReadinessChain,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1155: false,
      rowParsingPerformedByR1155: false,
      safeAvailabilityConfirmationConclusion: chain.output.summary.safeAvailabilityConfirmationConclusion,
      smokeEvidence: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1155 safe confirmation feature-only smoke proof failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function runTemporaryFeatureOnlySmoke(input: {
  createdAt?: string;
  r1149Path: string;
}): Promise<Awaited<ReturnType<typeof runR1153OrdinaryConsumerFeatureOnlyChainRunner>>> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "r1155-safe-confirmation-smoke-"));
  try {
    const confirmationPath = path.join(tmp, "feature-only-safe-confirmation.json");
    const nestedOutputDir = path.join(tmp, "out");
    await writeFile(
      confirmationPath,
      `${JSON.stringify(compactFeatureOnlyConfirmation(), null, 2)}\n`,
    );
    return await runR1153OrdinaryConsumerFeatureOnlyChainRunner({
      confirmationPath,
      createdAt: input.createdAt,
      outputDir: nestedOutputDir,
      r1149Path: input.r1149Path,
    });
  } finally {
    await rm(tmp, { force: true, recursive: true });
  }
}

function compactFeatureOnlyConfirmation(): Record<string, unknown> {
  return {
    aggregateReadinessFacts: {
      eventCountBand: "not_confirmed",
      outcomeLinked: false,
      sameDenominator: false,
      targetAgeBand: TARGET_AGE_BAND,
      usableRecordCountBand: "not_confirmed",
    },
    attestations: Object.fromEntries(REQUIRED_ATTESTATION_KEYS.map((key) => [key, true])) as Record<
      RequiredAttestationKey,
      true
    >,
    blockedConfirmationContent: [...BLOCKED_CONFIRMATION_CONTENT],
    featureOnlyCoverageRequiresPreferredPair: true,
    minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    recipeId: PREFERRED_RECIPE_ID,
    rowOwnerAssertionsConfirmed: true,
    rowLevelDataAcceptedByR1150: false,
    schemaVersion: CONFIRMATION_SCHEMA_VERSION,
    sourceFamilies: FEATURE_ONLY_SOURCE_FAMILY_IDS.map((familyId) => ({
      available: true,
      familyId,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForRecommendedRecipe: true,
      safeConfirmationMeaning: safeConfirmationMeaningFor(familyId),
    })),
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function safeConfirmationMeaningFor(familyId: FeatureOnlySourceFamilyId): string {
  if (familyId === "bloodwork_glycemia") {
    return "The row owner has ordinary glycemia bloodwork fields such as glucose or HbA1c in an export or spreadsheet.";
  }
  return "The row owner has daily activity data from a watch, phone, or wearable export.";
}

function smokeConclusionFor(chainConclusion: string | null): SmokeConclusion {
  if (chainConclusion === "ordinary_feature_only_chain_ready_research_only") {
    return "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence";
  }
  if (chainConclusion === "ordinary_feature_only_chain_waiting_on_r1149_submitter_kit") {
    return "ordinary_safe_confirmation_feature_only_smoke_waiting_on_r1149_submitter_kit";
  }
  return "ordinary_safe_confirmation_feature_only_smoke_incomplete";
}

function smokeNextActionFor(conclusion: SmokeConclusion): SmokeNextAction {
  if (conclusion === "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence") {
    return "use_r1150_r1153_path_with_real_safe_availability_confirmation";
  }
  if (conclusion === "ordinary_safe_confirmation_feature_only_smoke_waiting_on_r1149_submitter_kit") {
    return "refresh_r1149_submitter_kit";
  }
  return "inspect_r1155_feature_only_smoke_stage_outputs";
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function summarizeR1149(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1149_EXPECTED.artifact,
    packetId: readStringAt(value, ["packetId"]) === R1149_EXPECTED.packetId
      ? R1149_EXPECTED.packetId
      : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === R1149_EXPECTED.schemaVersion
      ? R1149_EXPECTED.schemaVersion
      : null,
    status: value ? "available" : "missing",
  };
}

function validateInputBoundary(label: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1155 rejected unsafe ${label} input: ${formatFindingCount(findings)}`);
  }
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProofOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationPathStored: false,
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
    rowLevelDataAcceptedByR1155: false,
    rowParsingPerformedByR1155: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
    temporaryConfirmationPersisted: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProof({
    createdAt: process.env.MURPH_AGE_RESEARCH_CREATED_AT,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1149Path: process.env.MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    featureOnlyChainConclusion: output.summary.featureOnlyChainConclusion,
    featureOnlyCoverageContextReadyForResearchPlanning:
      output.summary.featureOnlyCoverageContextReadyForResearchPlanning,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyForRecipeReadinessChain: output.summary.readyForRecipeReadinessChain,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1155: output.summary.rowLevelDataAcceptedByR1155,
    rowParsingPerformedByR1155: output.summary.rowParsingPerformedByR1155,
    safeAvailabilityConfirmationConclusion: output.summary.safeAvailabilityConfirmationConclusion,
    schemaVersion: output.schemaVersion,
    smokeEvidence: output.summary.smokeEvidence,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1155 safe confirmation feature-only smoke proof failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
