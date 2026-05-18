import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1165_SAFE_ASSERTION_RUNNER_COMMAND,
  runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner,
  type R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput,
} from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";
import {
  R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
  runR1172OrdinaryConsumerSafeAssertionMaterializer,
  type R1172OrdinaryConsumerSafeAssertionMaterializerOutput,
} from "./r1172-ordinary-consumer-safe-assertion-materializer.ts";

export const R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_SCHEMA_VERSION =
  "murph-age-r1175-r1172-to-r1165-safe-assertion-bridge-smoke.v1" as const;
export const R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1175-r1172-to-r1165-safe-assertion-bridge-smoke.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1175-r1172-to-r1165-safe-assertion-bridge-smoke.latest.json" as const;
const R1172_ARTIFACT =
  "r1172-ordinary-consumer-safe-assertion-materializer.latest.json" as const;
const R1165_ARTIFACT =
  "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json" as const;
const MATERIALIZED_ASSERTION_ARTIFACT =
  "r1172-row-owner-feature-only-safe-assertion.json" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
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
const SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
] as const;
const SAFE_ASSERTION_BLOCKED_CONTENT_IDS = [
  "private_paths",
  "header_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "private_ref_values",
  "source_variable_names",
  "predictions",
  "coefficients",
  "model_parameters",
  "source_text",
  "small_cells",
] as const;

type SafeAssertionAllowedValueKindId = typeof SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS[number];
type SafeAssertionBlockedContentId = typeof SAFE_ASSERTION_BLOCKED_CONTENT_IDS[number];
type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type SafeFieldEditPath = typeof SAFE_FIELD_EDIT_PATHS[number];
type BridgeConclusion =
  | "r1172_to_r1165_safe_assertion_bridge_smoke_failed_non_evidence"
  | "r1172_to_r1165_safe_assertion_bridge_smoke_passed_non_evidence"
  | "r1172_to_r1165_safe_assertion_bridge_smoke_waiting_on_r1172_prerequisite";
type BridgeNextAction =
  | "inspect_r1175_bridge_smoke_outputs"
  | "keep_live_chain_waiting_on_explicit_row_owner_r1172_confirmation"
  | R1172OrdinaryConsumerSafeAssertionMaterializerOutput["summary"]["nextAction"];

interface ScratchArtifactSummary {
  artifact: string | null;
  packetId: string | null;
  schemaVersion: string | null;
  status: "not_run" | "scratch_only";
}

export interface R1175R1172ToR1165SafeAssertionBridgeSmokeOptions {
  createdAt?: string;
  featureOnlyTemplatePath?: string;
  outputDir?: string;
  r1149Path?: string;
  r1160Path?: string;
  r1165Path?: string;
  r1165TemplatePath?: string;
  r1167Path?: string;
}

export interface R1175R1172ToR1165SafeAssertionBridgeSmokeOutput {
  artifactBoundary: {
    aggregateOnly: true;
    assertionFilePathStored: false;
    assertionValuesStoredByR1175: false;
    childOutputPathsStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    materializedAssertionPathStored: false;
    modelEvidencePromotedByR1175: false;
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
    rowLevelDataAcceptedByR1175: false;
    rowOwnerAssertionInferredByR1175: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1175: false;
    rowValuesStored: false;
    scratchArtifactsPersisted: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
    syntheticConfirmationValuesPersistedInArtifact: false;
  };
  bridgeSmoke: {
    allowedValueKindIds: SafeAssertionAllowedValueKindId[];
    blockedContentIds: SafeAssertionBlockedContentId[];
    bridgeSmokeCommand: typeof R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND;
    explicitRowOwnerConfirmationSuppliedToScratchR1172: true;
    liveChainGateStillRequired: true;
    liveNextAction: "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation";
    materializedAssertionArtifact: typeof MATERIALIZED_ASSERTION_ARTIFACT | null;
    materializedAssertionPathStored: false;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    productDisplayAuthorized: false;
    realEvidenceProduced: false;
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1175: false;
    rowOwnerAssertionStillRequiredForLiveChain: true;
    rowOwnerPrivateValuesStored: false;
    r1163Conclusion: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput["r1163State"]["conclusion"] | null;
    r1163FeatureOnlyResearchPlanningReady: boolean | null;
    r1165AssertionAccepted: boolean | null;
    r1165ChildR1163Ran: boolean | null;
    r1165Conclusion: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput["summary"]["conclusion"] | null;
    r1165FeatureOnlyResearchPlanningReady: boolean | null;
    r1165NextAction: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput["summary"]["nextAction"] | null;
    r1165RunnerCommand: typeof R1165_SAFE_ASSERTION_RUNNER_COMMAND;
    r1172Conclusion: R1172OrdinaryConsumerSafeAssertionMaterializerOutput["summary"]["conclusion"];
    r1172MaterializerCommand: typeof R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND;
    r1172NextAction: R1172OrdinaryConsumerSafeAssertionMaterializerOutput["summary"]["nextAction"];
    r1172SafeAssertionArtifactWritten: boolean;
    r1172WouldBeAcceptedByR1165: boolean;
    safeFieldEditCount: number;
    safeFieldEditPaths: SafeFieldEditPath[];
    scratchArtifactsPersisted: false;
    smokeEvidence: false;
    syntheticRowOwnerConfirmationUsed: true;
    syntheticSmokeProof: true;
  };
  childArtifacts: {
    r1165: ScratchArtifactSummary;
    r1172: ScratchArtifactSummary;
  };
  createdAt: string;
  packetId: "r1175-r1172-to-r1165-safe-assertion-bridge-smoke";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    allowedValueKindIds: SafeAssertionAllowedValueKindId[];
    blockedContentIds: SafeAssertionBlockedContentId[];
    bridgeSmokePassed: boolean;
    conclusion: BridgeConclusion;
    liveChainGateStillRequired: true;
    materializedAssertionArtifact: typeof MATERIALIZED_ASSERTION_ARTIFACT | null;
    materializedAssertionPathStored: false;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    nextAction: BridgeNextAction;
    productDisplayAuthorized: false;
    realEvidenceProduced: false;
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1175: false;
    rowOwnerAssertionStillRequiredForLiveChain: true;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1175: false;
    r1163FeatureOnlyResearchPlanningReady: boolean | null;
    r1165AssertionAccepted: boolean | null;
    r1165ChildR1163Ran: boolean | null;
    r1165FeatureOnlyResearchPlanningReady: boolean | null;
    r1172MaterializedAssertionWritten: boolean;
    r1172WouldBeAcceptedByR1165: boolean;
    safeFieldEditCount: number;
    safeFieldEditPaths: SafeFieldEditPath[];
    smokeEvidence: false;
    syntheticSmokeProof: true;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1175R1172ToR1165SafeAssertionBridgeSmoke(
  options: R1175R1172ToR1165SafeAssertionBridgeSmokeOptions = {},
): Promise<{ output: R1175R1172ToR1165SafeAssertionBridgeSmokeOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const scratchRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1175-"));
  try {
    const r1172 = await runR1172OrdinaryConsumerSafeAssertionMaterializer({
      createdAt: options.createdAt,
      outputDir: path.join(scratchRoot, "r1172"),
      r1165Path: options.r1165Path,
      r1165TemplatePath: options.r1165TemplatePath,
      r1167Path: options.r1167Path,
      rowOwnerAssertionsConfirmed: true,
    });
    validateAggregateSafe("r1172 bridge output", r1172.output);

    const r1165 = r1172.materializedAssertionPath === null
      ? null
      : await runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
        assertionPath: r1172.materializedAssertionPath,
        createdAt: options.createdAt,
        featureOnlyTemplatePath: options.featureOnlyTemplatePath,
        outputDir: path.join(scratchRoot, "r1165"),
        r1149Path: options.r1149Path,
        r1160Path: options.r1160Path,
      });
    if (r1165 !== null) validateAggregateSafe("r1165 bridge output", r1165.output);

    const bridgeSmokePassed = smokePassed({ r1165: r1165?.output ?? null, r1172: r1172.output });
    const waitingOnR1172Prerequisite = r1172.output.summary.safeAssertionArtifactWritten !== true;
    const conclusion: BridgeConclusion = waitingOnR1172Prerequisite
      ? "r1172_to_r1165_safe_assertion_bridge_smoke_waiting_on_r1172_prerequisite"
      : bridgeSmokePassed
      ? "r1172_to_r1165_safe_assertion_bridge_smoke_passed_non_evidence"
      : "r1172_to_r1165_safe_assertion_bridge_smoke_failed_non_evidence";
    const nextAction: BridgeNextAction = conclusion
        === "r1172_to_r1165_safe_assertion_bridge_smoke_waiting_on_r1172_prerequisite"
      ? r1172.output.summary.nextAction
      : bridgeSmokePassed
      ? "keep_live_chain_waiting_on_explicit_row_owner_r1172_confirmation"
      : "inspect_r1175_bridge_smoke_outputs";
    const output: R1175R1172ToR1165SafeAssertionBridgeSmokeOutput = {
      artifactBoundary: safeBoundary(),
      bridgeSmoke: {
        allowedValueKindIds: [...SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS],
        blockedContentIds: [...SAFE_ASSERTION_BLOCKED_CONTENT_IDS],
        bridgeSmokeCommand: R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND,
        explicitRowOwnerConfirmationSuppliedToScratchR1172: true,
        liveChainGateStillRequired: true,
        liveNextAction: "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation",
        materializedAssertionArtifact: r1172.output.summary.materializedAssertionArtifact,
        materializedAssertionPathStored: false,
        minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
        modelEvidencePromotionAllowed: false,
        optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
        productDisplayAuthorized: false,
        realEvidenceProduced: false,
        requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1175: false,
        rowOwnerAssertionStillRequiredForLiveChain: true,
        rowOwnerPrivateValuesStored: false,
        r1163Conclusion: r1165?.output.r1163State.conclusion ?? null,
        r1163FeatureOnlyResearchPlanningReady:
          r1165?.output.r1163State.featureOnlyResearchPlanningReady ?? null,
        r1165AssertionAccepted: r1165?.output.summary.assertionAccepted ?? null,
        r1165ChildR1163Ran: r1165?.output.summary.childR1163Ran ?? null,
        r1165Conclusion: r1165?.output.summary.conclusion ?? null,
        r1165FeatureOnlyResearchPlanningReady:
          r1165?.output.summary.featureOnlyResearchPlanningReady ?? null,
        r1165NextAction: r1165?.output.summary.nextAction ?? null,
        r1165RunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
        r1172Conclusion: r1172.output.summary.conclusion,
        r1172MaterializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
        r1172NextAction: r1172.output.summary.nextAction,
        r1172SafeAssertionArtifactWritten: r1172.output.summary.safeAssertionArtifactWritten,
        r1172WouldBeAcceptedByR1165: r1172.output.summary.materializedAssertionWouldBeAcceptedByR1165,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
        scratchArtifactsPersisted: false,
        smokeEvidence: false,
        syntheticRowOwnerConfirmationUsed: true,
        syntheticSmokeProof: true,
      },
      childArtifacts: {
        r1165: summarizeR1165(r1165?.output ?? null),
        r1172: summarizeR1172(r1172.output),
      },
      createdAt: options.createdAt ?? new Date().toISOString(),
      packetId: "r1175-r1172-to-r1165-safe-assertion-bridge-smoke",
      productDisplayAuthorized: false,
      schemaVersion: R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_SCHEMA_VERSION,
      status: "research-local-aggregate-only",
      summary: {
        allowedValueKindIds: [...SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS],
        blockedContentIds: [...SAFE_ASSERTION_BLOCKED_CONTENT_IDS],
        bridgeSmokePassed,
        conclusion,
        liveChainGateStillRequired: true,
        materializedAssertionArtifact: r1172.output.summary.materializedAssertionArtifact,
        materializedAssertionPathStored: false,
        minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
        modelEvidencePromotionAllowed: false,
        optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
        nextAction,
        productDisplayAuthorized: false,
        realEvidenceProduced: false,
        requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1175: false,
        rowOwnerAssertionStillRequiredForLiveChain: true,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1175: false,
        r1163FeatureOnlyResearchPlanningReady:
          r1165?.output.r1163State.featureOnlyResearchPlanningReady ?? null,
        r1165AssertionAccepted: r1165?.output.summary.assertionAccepted ?? null,
        r1165ChildR1163Ran: r1165?.output.summary.childR1163Ran ?? null,
        r1165FeatureOnlyResearchPlanningReady:
          r1165?.output.summary.featureOnlyResearchPlanningReady ?? null,
        r1172MaterializedAssertionWritten: r1172.output.summary.safeAssertionArtifactWritten,
        r1172WouldBeAcceptedByR1165: r1172.output.summary.materializedAssertionWouldBeAcceptedByR1165,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
        smokeEvidence: false,
        syntheticSmokeProof: true,
        targetAgeBand: TARGET_AGE_BAND,
        targetInputPriority: TARGET_INPUT_PRIORITY,
      },
    };

    ensureNoScratchPathInOutput(output, scratchRoot);
    validateAggregateSafe("r1175 bridge smoke output", output);
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
    await writeJson(outputPath, output);
    return { output, outputPath };
  } finally {
    await rm(scratchRoot, { force: true, recursive: true });
  }
}

function smokePassed(input: {
  r1165: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput | null;
  r1172: R1172OrdinaryConsumerSafeAssertionMaterializerOutput;
}): boolean {
  return input.r1172.summary.conclusion === "ordinary_consumer_safe_assertion_materialized"
    && input.r1172.summary.explicitRowOwnerAssertionProvided === true
    && input.r1172.summary.safeAssertionArtifactWritten === true
    && input.r1172.summary.materializedAssertionWouldBeAcceptedByR1165 === true
    && exactStringSet(
      input.r1172.materializer.allowedValueKindIds,
      SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      input.r1172.materializer.blockedContentIds,
      SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(
      input.r1172.summary.allowedValueKindIds,
      SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      input.r1172.summary.blockedContentIds,
      SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && input.r1165?.summary.assertionAccepted === true
    && input.r1165.summary.childR1163Ran === true
    && input.r1165.summary.conclusion === "ordinary_feature_only_safe_assertion_runner_ready_research_only"
    && input.r1165.summary.featureOnlyResearchPlanningReady === true
    && input.r1165.summary.validationReasonIds.length === 0
    && input.r1165.r1163State.conclusion === "feature_only_safe_confirmation_to_research_runner_ready_research_only"
    && input.r1165.r1163State.featureOnlyResearchPlanningReady === true;
}

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return expected.every((value) => actualSet.has(value));
}

function summarizeR1172(output: R1172OrdinaryConsumerSafeAssertionMaterializerOutput): ScratchArtifactSummary {
  return {
    artifact: R1172_ARTIFACT,
    packetId: output.packetId,
    schemaVersion: output.schemaVersion,
    status: "scratch_only",
  };
}

function summarizeR1165(output: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput | null): ScratchArtifactSummary {
  return {
    artifact: output === null ? null : R1165_ARTIFACT,
    packetId: output?.packetId ?? null,
    schemaVersion: output?.schemaVersion ?? null,
    status: output === null ? "not_run" : "scratch_only",
  };
}

function safeBoundary(): R1175R1172ToR1165SafeAssertionBridgeSmokeOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    assertionFilePathStored: false,
    assertionValuesStoredByR1175: false,
    childOutputPathsStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    materializedAssertionPathStored: false,
    modelEvidencePromotedByR1175: false,
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
    rowLevelDataAcceptedByR1175: false,
    rowOwnerAssertionInferredByR1175: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1175: false,
    rowValuesStored: false,
    scratchArtifactsPersisted: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
    syntheticConfirmationValuesPersistedInArtifact: false,
  };
}

function validateAggregateSafe(label: string, value: unknown): void {
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1175 rejected unsafe ${label}: ${formatFindingCount(findings)}`);
  }
}

function ensureNoScratchPathInOutput(
  output: R1175R1172ToR1165SafeAssertionBridgeSmokeOutput,
  scratchRoot: string,
): void {
  if (JSON.stringify(output).includes(scratchRoot)) {
    throw new Error("R1175 rejected bridge output with scratch path leakage.");
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cliSummary(output: R1175R1172ToR1165SafeAssertionBridgeSmokeOutput): Record<string, unknown> {
  return {
    allowedValueKindIds: output.summary.allowedValueKindIds,
    bridgeSmokePassed: output.summary.bridgeSmokePassed,
    blockedContentIds: output.summary.blockedContentIds,
    conclusion: output.summary.conclusion,
    liveChainGateStillRequired: output.summary.liveChainGateStillRequired,
    materializedAssertionArtifact: output.summary.materializedAssertionArtifact,
    materializedAssertionPathStored: output.summary.materializedAssertionPathStored,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    optionalAddOnFamilyIds: output.summary.optionalAddOnFamilyIds,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    realEvidenceProduced: output.summary.realEvidenceProduced,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1175: output.summary.rowLevelDataAcceptedByR1175,
    rowOwnerAssertionStillRequiredForLiveChain: output.summary.rowOwnerAssertionStillRequiredForLiveChain,
    rowOwnerPrivateValuesStored: output.summary.rowOwnerPrivateValuesStored,
    r1163FeatureOnlyResearchPlanningReady: output.summary.r1163FeatureOnlyResearchPlanningReady,
    r1165AssertionAccepted: output.summary.r1165AssertionAccepted,
    r1165ChildR1163Ran: output.summary.r1165ChildR1163Ran,
    r1165FeatureOnlyResearchPlanningReady: output.summary.r1165FeatureOnlyResearchPlanningReady,
    r1172MaterializedAssertionWritten: output.summary.r1172MaterializedAssertionWritten,
    r1172WouldBeAcceptedByR1165: output.summary.r1172WouldBeAcceptedByR1165,
    safeFieldEditCount: output.summary.safeFieldEditCount,
    schemaVersion: output.schemaVersion,
    smokeEvidence: output.summary.smokeEvidence,
    status: output.status,
    syntheticSmokeProof: output.summary.syntheticSmokeProof,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1175R1172ToR1165SafeAssertionBridgeSmoke({
    createdAt: process.env.MURPH_AGE_R1175_CREATED_AT,
    featureOnlyTemplatePath: process.env.MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH,
    outputDir: process.env.MURPH_AGE_R1175_OUTPUT_DIR ?? process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1149Path: process.env.MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH,
    r1160Path: process.env.MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH,
    r1165Path: process.env.MURPH_AGE_R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_PATH,
    r1165TemplatePath: process.env.MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_TEMPLATE_PATH,
    r1167Path: process.env.MURPH_AGE_R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_PATH,
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1175 bridge smoke failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

function formatFindingCount(findings: readonly unknown[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}
