import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1153_ORDINARY_CONSUMER_FEATURE_ONLY_CHAIN_RUNNER_SCHEMA_VERSION,
  runR1153OrdinaryConsumerFeatureOnlyChainRunner,
} from "./r1153-ordinary-consumer-feature-only-chain-runner.ts";

const CONFIRMATION_SCHEMA_VERSION =
  "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1";
const CONTEXT_SCHEMA_VERSION =
  "murph-age-r1151-ordinary-consumer-feature-only-coverage-context.v1";
const REQUIRED_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const EXPECTED_ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
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
const R1151_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1151-ordinary-consumer-feature-only-submission-mode.ts";

describe("runR1153OrdinaryConsumerFeatureOnlyChainRunner", () => {
  it("waits on safe availability confirmation while keeping the chain pathless", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1153-missing-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      await writeJson(r1149Path, r1149Fixture());

      const { output, outputPath } = await runR1153OrdinaryConsumerFeatureOnlyChainRunner({
        createdAt: "2026-05-17T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });
      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;

      expect(path.basename(outputPath)).toBe("r1153-ordinary-consumer-feature-only-chain-runner.latest.json");
      expect(output.schemaVersion).toBe(R1153_ORDINARY_CONSUMER_FEATURE_ONLY_CHAIN_RUNNER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_chain_waiting_on_safe_availability_confirmation",
        contextPathConfigured: false,
        coverageContextReadyForResearchPlanning: false,
        derivedCoverageContextArtifact: null,
        derivedCoverageContextUsed: false,
        featureOnlyCoverageContextAllowed: false,
        featureOnlyCoverageContextIntakeConclusion: "feature_only_coverage_context_waiting_on_r1151_ready",
        featureOnlyModeConclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        missingCoverageContextPrimaryFeatureFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        missingFeatureOnlySourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_safe_availability_confirmation_from_template",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1153: false,
        rowParsingPerformedByR1153: false,
        safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_not_provided",
        safeAvailabilityConfirmationConfigured: false,
        safeAvailabilityConfirmationStatus: "missing",
        safeAvailabilityFeatureOnlyCoverageContextReady: false,
        safeAvailabilityReadyForRecipeReadinessChain: false,
        supportedFeatureFamilyIds: [],
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.inputArtifacts.r1150.artifact).toBe(
        "r1150-ordinary-consumer-safe-availability-confirmation-intake.latest.json",
      );
      expect(output.featureOnlyChainRunner.commands.safeAvailabilityConfirmationIntakeCommand).toContain(
        "r1150-ordinary-consumer-safe-availability-confirmation-intake.ts",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(persisted)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("derives the feature-only context from one safe lab and wearable confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1153-feature-only-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, confirmationFixture({
          eventCountBand: "not_confirmed",
          outcomeLinked: false,
          sameDenominator: false,
          unavailableSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
        })),
      ]);

      const { output } = await runR1153OrdinaryConsumerFeatureOnlyChainRunner({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });
      const derivedContextPath = path.join(
        tmp,
        "out",
        "r1153-derived-feature-only-coverage-context-from-safe-availability.json",
      );
      const derivedContext = JSON.parse(await readFile(derivedContextPath, "utf8")) as unknown;

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_chain_ready_research_only",
        contextPathConfigured: false,
        coverageContextReadyForResearchPlanning: true,
        derivedCoverageContextArtifact: "r1153-derived-feature-only-coverage-context-from-safe-availability.json",
        derivedCoverageContextUsed: true,
        featureOnlyCoverageContextAllowed: true,
        featureOnlyCoverageContextIntakeConclusion: "feature_only_coverage_context_ready_research_only",
        featureOnlyCoverageContextIntakeContextStatus: "available",
        featureOnlyModeConclusion: "ordinary_feature_only_mode_available_not_model_evidence",
        missingCoverageContextPrimaryFeatureFamilyIds: [],
        missingFeatureOnlySourceFamilyIds: [],
        modelEvidencePromotionAllowed: false,
        nextAction: "use_feature_only_coverage_context_for_research_planning_only",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        productDisplayAuthorized: false,
        safeAvailabilityFeatureOnlyCoverageContextReady: true,
        safeAvailabilityReadyForRecipeReadinessChain: false,
        supportedFeatureFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(derivedContext)).toEqual([]);
      expect(derivedContext).toMatchObject({
        derivedFromSafeAvailabilityConfirmation: true,
        evidenceRole: "feature_only_coverage_context_not_model_evidence",
        modelEvidencePromotionAllowed: false,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        rowLevelDataAcceptedByR1151: false,
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(derivedContext)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks ready lab plus wearable feature-only context as research-only planning coverage", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1153-ready-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "confirmation.json");
      const contextPath = path.join(tmp, "context.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, confirmationFixture({
          eventCountBand: "not_confirmed",
          outcomeLinked: false,
          sameDenominator: false,
          unavailableSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
        })),
        writeJson(contextPath, coverageContextFixture("ready")),
      ]);

      const { output } = await runR1153OrdinaryConsumerFeatureOnlyChainRunner({
        confirmationPath,
        contextPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_chain_ready_research_only",
        contextPathConfigured: true,
        coverageContextReadyForResearchPlanning: true,
        derivedCoverageContextArtifact: null,
        derivedCoverageContextUsed: false,
        featureOnlyCoverageContextAllowed: true,
        featureOnlyCoverageContextIntakeConclusion: "feature_only_coverage_context_ready_research_only",
        featureOnlyCoverageContextIntakeContextStatus: "available",
        featureOnlyModeConclusion: "ordinary_feature_only_mode_available_not_model_evidence",
        missingCoverageContextPrimaryFeatureFamilyIds: [],
        missingFeatureOnlySourceFamilyIds: [],
        modelEvidencePromotionAllowed: false,
        nextAction: "use_feature_only_coverage_context_for_research_planning_only",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1153: false,
        rowParsingPerformedByR1153: false,
        safeAvailabilityFeatureOnlyCoverageContextReady: true,
        safeAvailabilityReadyForRecipeReadinessChain: false,
        supportedFeatureFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      });
      expect(output.featureOnlyChainRunner).toMatchObject({
        coverageContextReadyForResearchPlanning: true,
        featureOnlyCoverageContextAllowed: true,
        modelEvidencePromotionAllowed: false,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        productDisplayAuthorized: false,
        rowLevelDataAcceptedByR1153: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("defers to outcome-linked recipe readiness when the confirmation is fully linked", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1153-outcome-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, confirmationFixture()),
      ]);

      const { output } = await runR1153OrdinaryConsumerFeatureOnlyChainRunner({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_chain_superseded_by_outcome_linked_evidence",
        coverageContextReadyForResearchPlanning: false,
        featureOnlyCoverageContextAllowed: false,
        featureOnlyModeConclusion: "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence",
        nextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
        safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_ready_for_recipe_readiness_chain",
        safeAvailabilityFeatureOnlyCoverageContextReady: true,
        safeAvailabilityReadyForRecipeReadinessChain: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes stale submitter kits back to the R1149 refresh before accepting confirmations", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1153-r1149-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture({ omitFeatureOnlyGuard: true })),
        writeJson(confirmationPath, confirmationFixture({
          eventCountBand: "not_confirmed",
          outcomeLinked: false,
          sameDenominator: false,
          unavailableSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
        })),
      ]);

      const { output } = await runR1153OrdinaryConsumerFeatureOnlyChainRunner({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_chain_waiting_on_r1149_submitter_kit",
        featureOnlyCoverageContextAllowed: false,
        nextAction: "refresh_r1149_submitter_kit",
        safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_waiting_on_r1149_submitter_kit",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1153-cli-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, confirmationFixture({
          eventCountBand: "not_confirmed",
          outcomeLinked: false,
          sameDenominator: false,
          unavailableSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
        })),
      ]);

      const stdout = execFileSync(
        "pnpm",
        ["exec", "tsx", "scripts/murph-age/r1153-ordinary-consumer-feature-only-chain-runner.ts"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH: r1149Path,
            MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH: confirmationPath,
            MURPH_AGE_R1153_OUTPUT_DIR: path.join(tmp, "cli-out"),
          },
        },
      );
      const summary = JSON.parse(stdout) as Record<string, unknown>;

      expect(summary).toMatchObject({
        conclusion: "ordinary_feature_only_chain_ready_research_only",
        derivedCoverageContextArtifact: "r1153-derived-feature-only-coverage-context-from-safe-availability.json",
        derivedCoverageContextUsed: true,
        featureOnlyCoverageContextAllowed: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "use_feature_only_coverage_context_for_research_planning_only",
        rowLevelDataAcceptedByR1153: false,
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints pathless CLI errors when filesystem failures include local paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1153-cli-error-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "confirmation.json");
      const blockedOutputDir = path.join(tmp, "blocked-output");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, confirmationFixture()),
        writeFile(blockedOutputDir, "not a directory\n"),
      ]);

      const result = spawnSync(
        "pnpm",
        ["exec", "tsx", "scripts/murph-age/r1153-ordinary-consumer-feature-only-chain-runner.ts"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH: r1149Path,
            MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH: confirmationPath,
            MURPH_AGE_R1153_OUTPUT_DIR: blockedOutputDir,
          },
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("R1153 ordinary feature-only chain runner failed.");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stderr).not.toContain(blockedOutputDir);
      expect(result.stderr).not.toContain("blocked-output");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1149Fixture(options: { omitFeatureOnlyGuard?: boolean } = {}): Record<string, unknown> {
  const featureOnlySubmissionMode = {
    conclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
    featureOnlyCoverageContextAllowed: false,
    modelEvidencePromotionAllowed: false,
    outcomeLinkedEvidenceReady: false,
    privateDetailsStored: false,
    supportedFeatureFamilyIds: [],
  };
  return {
    packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1",
    status: "research-local-aggregate-only",
    ...(options.omitFeatureOnlyGuard === true
      ? {}
      : {
        ordinaryConsumerSubmissionKit: {
          commands: {
            featureOnlySubmissionModeCommand: R1151_COMMAND,
          },
          featureOnlySubmissionMode,
        },
      }),
    summary: {
      expectedRouteIds: EXPECTED_ROUTE_IDS,
      ...(options.omitFeatureOnlyGuard === true
        ? {}
        : {
          featureOnlyModeConclusion: featureOnlySubmissionMode.conclusion,
          featureOnlyModeModelEvidencePromotionAllowed: featureOnlySubmissionMode.modelEvidencePromotionAllowed,
          featureOnlyModeOutcomeLinkedEvidenceReady: featureOnlySubmissionMode.outcomeLinkedEvidenceReady,
          featureOnlyModeSupportedFeatureFamilyIds: featureOnlySubmissionMode.supportedFeatureFamilyIds,
        }),
      nextAction: "confirm_lab_plus_wearable_recipe_availability_assertions",
      optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      readyForResearchReview: false,
      requiredSourceFamilyIds: REQUIRED_SOURCE_FAMILY_IDS,
      rowOwnerAssertionsConfirmed: false,
      rowParsingPerformedByR1149: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function confirmationFixture(options: {
  eventCountBand?: string;
  missingAttestationKeys?: string[];
  outcomeLinked?: boolean;
  sameDenominator?: boolean;
  unavailableSourceFamilyIds?: string[];
} = {}): Record<string, unknown> {
  const missingAttestationKeys = new Set(options.missingAttestationKeys ?? []);
  const unavailableSourceFamilyIds = new Set(options.unavailableSourceFamilyIds ?? []);
  return {
    aggregateReadinessFacts: {
      eventCountBand: options.eventCountBand ?? "10_plus",
      outcomeLinked: options.outcomeLinked ?? true,
      sameDenominator: options.sameDenominator ?? true,
      targetAgeBand: "roughly_16_50",
      usableRecordCountBand: "50_plus",
    },
    attestations: Object.fromEntries(
      REQUIRED_ATTESTATION_KEYS.map((key) => [key, !missingAttestationKeys.has(key)]),
    ),
    recipeId: "lab_plus_wearable_minimum_manifest",
    rowOwnerAssertionsConfirmed: true,
    schemaVersion: CONFIRMATION_SCHEMA_VERSION,
    sourceFamilies: [...REQUIRED_SOURCE_FAMILY_IDS, ...OPTIONAL_ADD_ON_FAMILY_IDS].map((familyId) => ({
      available: !unavailableSourceFamilyIds.has(familyId),
      familyId,
    })),
    targetAgeBand: "roughly_16_50",
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
  };
}

function coverageContextFixture(mode: "lab-only" | "promoted" | "ready"): Record<string, unknown> {
  const sourceFamilies = [
    {
      available: true,
      familyId: "bloodwork_glycemia",
      privateDetailsStored: false,
    },
    {
      available: mode !== "lab-only",
      familyId: "wearable_activity_daily",
      privateDetailsStored: false,
    },
    {
      available: false,
      familyId: "common_bloodwork_core",
      privateDetailsStored: false,
    },
    {
      available: false,
      familyId: "vitals_body_context",
      privateDetailsStored: false,
    },
  ];
  return {
    attestations: Object.fromEntries(REQUIRED_ATTESTATION_KEYS.map((key) => [key, true])),
    evidenceRole: "feature_only_coverage_context_not_model_evidence",
    featureOnlyCoverageRequiresPreferredPair: true,
    minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
    modelEvidencePromotionAllowed: mode === "promoted",
    ordinarySubmitterInputKinds: [
      {
        inputKindId: "lab_portal_export_or_spreadsheet",
        privateDetailsStored: false,
        requiredForFeatureOnlyPreferredPair: true,
      },
      {
        inputKindId: "phone_watch_or_wearable_activity_export",
        privateDetailsStored: false,
        requiredForFeatureOnlyPreferredPair: true,
      },
    ],
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    rowLevelDataAcceptedByR1151: false,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    sourceFamilies,
    targetAgeBand: "roughly_16_50",
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
  };
}
