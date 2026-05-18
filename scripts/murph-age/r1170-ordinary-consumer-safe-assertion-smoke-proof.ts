import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION,
  runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner,
  type R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput,
} from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";

export const R1170_ORDINARY_CONSUMER_SAFE_ASSERTION_SMOKE_PROOF_SCHEMA_VERSION =
  "murph-age-r1170-ordinary-consumer-safe-assertion-smoke-proof.v1" as const;
export const R1170_SAFE_ASSERTION_SMOKE_PROOF_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1170-ordinary-consumer-safe-assertion-smoke-proof.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1170-ordinary-consumer-safe-assertion-smoke-proof.latest.json";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
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
const SAFE_FIELD_EDIT_PATHS = [
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "sourceFamilies[common_bloodwork_core].available",
  "sourceFamilies[vitals_body_context].available",
  "rowOwnerAssertionsConfirmed",
  "privateContentExcluded",
  "attestations.aggregateOnly",
  "attestations.localOnly",
  "attestations.noCoefficientEgress",
  "attestations.noHeaderNameEgress",
  "attestations.noParticipantEgress",
  "attestations.noPredictionEgress",
  "attestations.noPrivatePathEgress",
  "attestations.noPrivateRefValueEgress",
  "attestations.noRowEgress",
  "attestations.noSmallCellEgress",
  "attestations.noSourceTextEgress",
] as const;
const R1160_SAFE_TRANSCRIPTION_STEP_COUNT = 15;

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type SafeFieldEditPath = typeof SAFE_FIELD_EDIT_PATHS[number];
type SmokeConclusion =
  | "ordinary_safe_assertion_smoke_failed_non_evidence"
  | "ordinary_safe_assertion_smoke_passed_non_evidence";
type SmokeNextAction =
  | "inspect_r1170_safe_assertion_smoke_outputs"
  | "keep_live_chain_waiting_on_real_r1165_row_owner_safe_assertion";

export interface R1170OrdinaryConsumerSafeAssertionSmokeProofOptions {
  createdAt?: string;
  outputDir?: string;
}

export interface R1170OrdinaryConsumerSafeAssertionSmokeProofOutput {
  artifactBoundary: {
    aggregateOnly: true;
    assertionFilePathStored: false;
    assertionValuesStoredByR1170: false;
    childOutputPathsStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelEvidencePromotedByR1170: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateDetailsStored: false;
    privateFieldRefValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefValuesStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowLevelDataAcceptedByR1170: false;
    rowOwnerAssertionInferredByR1170: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1170: false;
    rowValuesStored: false;
    scratchArtifactsPersisted: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
    syntheticAssertionPersistedInArtifact: false;
  };
  createdAt: string;
  packetId: "r1170-ordinary-consumer-safe-assertion-smoke-proof";
  productDisplayAuthorized: false;
  safeAssertionSmokeProof: {
    commands: {
      assertionToResearchRunnerCommand: string;
      featureOnlyResearchHandoffCommand: string;
      safeAssertionRunnerCommand: string;
      smokeProofCommand: typeof R1170_SAFE_ASSERTION_SMOKE_PROOF_COMMAND;
    };
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotedByR1170: false;
    productDisplayAuthorized: false;
    realEvidenceProduced: false;
    requiredInputKindIds: RequiredInputKindId[];
    r1163Conclusion: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput["r1163State"]["conclusion"];
    r1163FeatureOnlyResearchPlanningReady: boolean | null;
    r1165AssertionAccepted: boolean;
    r1165ChildR1163Ran: boolean;
    r1165Conclusion: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput["summary"]["conclusion"];
    r1165FeatureOnlyResearchPlanningReady: boolean;
    r1165NextAction: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput["summary"]["nextAction"];
    r1165ValidationReasonCount: number;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1170: false;
    rowOwnerAssertionStillRequiredForLiveChain: true;
    rowOwnerPrivateValuesStored: false;
    safeFieldEditCount: number;
    safeFieldEditPaths: SafeFieldEditPath[];
    scratchArtifactsPersisted: false;
    smokeEvidence: false;
    syntheticAssertionUsedForSmoke: true;
    syntheticAssertionValuesPersistedInArtifact: false;
  };
  schemaVersion: typeof R1170_ORDINARY_CONSUMER_SAFE_ASSERTION_SMOKE_PROOF_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: SmokeConclusion;
    liveChainGateStillRequired: true;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: SmokeNextAction;
    productDisplayAuthorized: false;
    realEvidenceProduced: false;
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1170: false;
    rowOwnerAssertionStillRequiredForLiveChain: true;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1170: false;
    r1163FeatureOnlyResearchPlanningReady: boolean | null;
    r1165AssertionAccepted: boolean;
    r1165ChildR1163Ran: boolean;
    r1165FeatureOnlyResearchPlanningReady: boolean;
    safeFieldEditCount: number;
    safeFieldEditPaths: SafeFieldEditPath[];
    smokeEvidence: false;
    smokeProofPassed: boolean;
    syntheticSmokeProof: true;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1170OrdinaryConsumerSafeAssertionSmokeProof(
  options: R1170OrdinaryConsumerSafeAssertionSmokeProofOptions = {},
): Promise<{ output: R1170OrdinaryConsumerSafeAssertionSmokeProofOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const scratchRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1170-"));
  try {
    const r1165 = await runSyntheticR1165Smoke({
      createdAt: options.createdAt,
      scratchRoot,
    });
    validateAggregateSafe("r1165 smoke output", r1165.output);

    const smokeProofPassed = smokePassed(r1165.output);
    const conclusion: SmokeConclusion = smokeProofPassed
      ? "ordinary_safe_assertion_smoke_passed_non_evidence"
      : "ordinary_safe_assertion_smoke_failed_non_evidence";
    const nextAction: SmokeNextAction = smokeProofPassed
      ? "keep_live_chain_waiting_on_real_r1165_row_owner_safe_assertion"
      : "inspect_r1170_safe_assertion_smoke_outputs";
    const output: R1170OrdinaryConsumerSafeAssertionSmokeProofOutput = {
      artifactBoundary: safeBoundary(),
      createdAt: options.createdAt ?? new Date().toISOString(),
      packetId: "r1170-ordinary-consumer-safe-assertion-smoke-proof",
      productDisplayAuthorized: false,
      safeAssertionSmokeProof: {
        commands: {
          assertionToResearchRunnerCommand: r1165.output.assertionRunner.commands.assertionToResearchRunnerCommand,
          featureOnlyResearchHandoffCommand: r1165.output.assertionRunner.commands.featureOnlyResearchHandoffCommand,
          safeAssertionRunnerCommand: r1165.output.assertionRunner.commands.safeAssertionRunnerCommand,
          smokeProofCommand: R1170_SAFE_ASSERTION_SMOKE_PROOF_COMMAND,
        },
        minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
        modelEvidencePromotedByR1170: false,
        productDisplayAuthorized: false,
        realEvidenceProduced: false,
        requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
        r1163Conclusion: r1165.output.r1163State.conclusion,
        r1163FeatureOnlyResearchPlanningReady: r1165.output.r1163State.featureOnlyResearchPlanningReady,
        r1165AssertionAccepted: r1165.output.summary.assertionAccepted,
        r1165ChildR1163Ran: r1165.output.summary.childR1163Ran,
        r1165Conclusion: r1165.output.summary.conclusion,
        r1165FeatureOnlyResearchPlanningReady: r1165.output.summary.featureOnlyResearchPlanningReady,
        r1165NextAction: r1165.output.summary.nextAction,
        r1165ValidationReasonCount: r1165.output.summary.validationReasonIds.length,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1170: false,
        rowOwnerAssertionStillRequiredForLiveChain: true,
        rowOwnerPrivateValuesStored: false,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
        scratchArtifactsPersisted: false,
        smokeEvidence: false,
        syntheticAssertionUsedForSmoke: true,
        syntheticAssertionValuesPersistedInArtifact: false,
      },
      schemaVersion: R1170_ORDINARY_CONSUMER_SAFE_ASSERTION_SMOKE_PROOF_SCHEMA_VERSION,
      status: "research-local-aggregate-only",
      summary: {
        conclusion,
        liveChainGateStillRequired: true,
        minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
        modelEvidencePromotionAllowed: false,
        nextAction,
        productDisplayAuthorized: false,
        realEvidenceProduced: false,
        requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1170: false,
        rowOwnerAssertionStillRequiredForLiveChain: true,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1170: false,
        r1163FeatureOnlyResearchPlanningReady: r1165.output.r1163State.featureOnlyResearchPlanningReady,
        r1165AssertionAccepted: r1165.output.summary.assertionAccepted,
        r1165ChildR1163Ran: r1165.output.summary.childR1163Ran,
        r1165FeatureOnlyResearchPlanningReady: r1165.output.summary.featureOnlyResearchPlanningReady,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
        smokeEvidence: false,
        smokeProofPassed,
        syntheticSmokeProof: true,
        targetAgeBand: TARGET_AGE_BAND,
        targetInputPriority: TARGET_INPUT_PRIORITY,
      },
    };

    validateAggregateSafe("r1170 smoke output", output);
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
    await writeJson(outputPath, output);
    return { output, outputPath };
  } finally {
    await rm(scratchRoot, { force: true, recursive: true });
  }
}

async function runSyntheticR1165Smoke(input: {
  createdAt?: string;
  scratchRoot: string;
}): Promise<{ output: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput; outputPath: string }> {
  const inputDir = path.join(input.scratchRoot, "inputs");
  const r1165OutputDir = path.join(input.scratchRoot, "r1165-output");
  await mkdir(inputDir, { recursive: true });
  const assertionPath = path.join(inputDir, "safe-assertion.synthetic.json");
  const featureOnlyTemplatePath = path.join(inputDir, "feature-only-template.json");
  const r1149Path = path.join(inputDir, "r1149.json");
  const r1160Path = path.join(inputDir, "r1160.json");
  await writeJson(assertionPath, syntheticSafeAssertion());
  await writeJson(featureOnlyTemplatePath, featureOnlyTemplateFixture());
  await writeJson(r1149Path, r1149Fixture());
  await writeJson(r1160Path, r1160Fixture());
  return runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
    assertionPath,
    createdAt: input.createdAt,
    featureOnlyTemplatePath,
    outputDir: r1165OutputDir,
    r1149Path,
    r1160Path,
  });
}

function smokePassed(output: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput): boolean {
  return output.summary.assertionAccepted === true
    && output.summary.childR1163Ran === true
    && output.summary.conclusion === "ordinary_feature_only_safe_assertion_runner_ready_research_only"
    && output.summary.featureOnlyResearchPlanningReady === true
    && output.summary.nextAction === "run_r1164_feature_only_research_handoff"
    && output.summary.validationReasonIds.length === 0
    && output.r1163State.conclusion === "feature_only_safe_confirmation_to_research_runner_ready_research_only"
    && output.r1163State.featureOnlyResearchPlanningReady === true
    && output.r1163State.rowOwnerAssertionStillRequired === false;
}

function syntheticSafeAssertion(): Record<string, unknown> {
  return {
    attestations: Object.fromEntries(REQUIRED_ATTESTATION_KEYS.map((key) => [key, true])),
    privateContentExcluded: true,
    requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
    rowOwnerAssertionsConfirmed: true,
    schemaVersion: R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION,
    sourceFamilies: [
      {
        available: true,
        familyId: "bloodwork_glycemia",
        inputKindId: "lab_portal_export_or_spreadsheet",
      },
      {
        available: true,
        familyId: "wearable_activity_daily",
        inputKindId: "phone_watch_or_wearable_activity_export",
      },
    ],
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function featureOnlyTemplateFixture(): Record<string, unknown> {
  return {
    aggregateReadinessFacts: {
      eventCountBand: "not_confirmed",
      outcomeLinked: false,
      sameDenominator: false,
      targetAgeBand: TARGET_AGE_BAND,
      usableRecordCountBand: "not_confirmed",
    },
    featureOnlyCoverageRequiresPreferredPair: true,
    minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    recipeId: "lab_plus_wearable_minimum_manifest",
    rowLevelDataAcceptedByR1150: false,
    rowOwnerAssertionsConfirmed: false,
    schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1",
    sourceFamilies: [
      {
        available: false,
        familyId: "bloodwork_glycemia",
      },
      {
        available: false,
        familyId: "wearable_activity_daily",
      },
    ],
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function r1149Fixture(): Record<string, unknown> {
  return {
    ordinaryConsumerSubmissionKit: {
      commands: {
        featureOnlySubmissionModeCommand:
          "pnpm exec tsx scripts/murph-age/r1151-ordinary-consumer-feature-only-submission-mode.ts",
      },
      featureOnlySubmissionMode: {
        featureOnlyCoverageContextAllowed: true,
        modelEvidencePromotionAllowed: false,
        outcomeLinkedEvidenceReady: false,
        privateDetailsStored: false,
      },
    },
    packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
    schemaVersion: "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1",
    status: "research-local-aggregate-only",
    summary: {
      featureOnlyModeConclusion: "ordinary_consumer_feature_only_submission_mode_ready_research_only",
      featureOnlyModeModelEvidencePromotionAllowed: false,
      featureOnlyModeOutcomeLinkedEvidenceReady: false,
    },
  };
}

function r1160Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      confirmationValuesStoredByR1160: false,
      rowLevelDataAcceptedByR1160: false,
      rowOwnerProvidedValuesStored: false,
      transcribedConfirmationPersisted: false,
    },
    packetId: "r1160-r1159-feature-only-safe-confirmation-transcription-proof",
    schemaVersion: "murph-age-r1160-r1159-feature-only-safe-confirmation-transcription-proof.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
      exactSafeTranscriptionStepCount: R1160_SAFE_TRANSCRIPTION_STEP_COUNT,
      hypotheticalTranscriptionWouldBeFeatureOnlyReady: true,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowOwnerConfirmationStillRequired: true,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      transcriptionProofReadyForRowOwnerConfirmation: true,
    },
  };
}

function safeBoundary(): R1170OrdinaryConsumerSafeAssertionSmokeProofOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    assertionFilePathStored: false,
    assertionValuesStoredByR1170: false,
    childOutputPathsStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1170: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateDetailsStored: false,
    privateFieldRefValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefValuesStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowLevelDataAcceptedByR1170: false,
    rowOwnerAssertionInferredByR1170: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1170: false,
    rowValuesStored: false,
    scratchArtifactsPersisted: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
    syntheticAssertionPersistedInArtifact: false,
  };
}

function validateAggregateSafe(label: string, value: unknown): void {
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1170 rejected unsafe ${label}: ${formatFindingCount(findings)}`);
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cliSummary(output: R1170OrdinaryConsumerSafeAssertionSmokeProofOutput): Record<string, unknown> {
  return {
    conclusion: output.summary.conclusion,
    liveChainGateStillRequired: output.summary.liveChainGateStillRequired,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    realEvidenceProduced: output.summary.realEvidenceProduced,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1170: output.summary.rowLevelDataAcceptedByR1170,
    rowOwnerAssertionStillRequiredForLiveChain: output.summary.rowOwnerAssertionStillRequiredForLiveChain,
    rowOwnerPrivateValuesStored: output.summary.rowOwnerPrivateValuesStored,
    r1163FeatureOnlyResearchPlanningReady: output.summary.r1163FeatureOnlyResearchPlanningReady,
    r1165AssertionAccepted: output.summary.r1165AssertionAccepted,
    r1165ChildR1163Ran: output.summary.r1165ChildR1163Ran,
    r1165FeatureOnlyResearchPlanningReady: output.summary.r1165FeatureOnlyResearchPlanningReady,
    safeFieldEditCount: output.summary.safeFieldEditCount,
    schemaVersion: output.schemaVersion,
    smokeEvidence: output.summary.smokeEvidence,
    smokeProofPassed: output.summary.smokeProofPassed,
    status: output.status,
    syntheticSmokeProof: output.summary.syntheticSmokeProof,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1170OrdinaryConsumerSafeAssertionSmokeProof({
    createdAt: process.env.MURPH_AGE_R1170_CREATED_AT,
    outputDir: process.env.MURPH_AGE_R1170_OUTPUT_DIR ?? process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1170 safe assertion smoke proof failed.")}\n`);
    process.exitCode = 1;
  });
}

function formatFindingCount(findings: string[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
