import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1152OrdinaryConsumerFeatureOnlyCoverageContextIntake } from "./r1152-ordinary-consumer-feature-only-coverage-context-intake.ts";

const LAB_WEARABLE_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
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
];

describe("runR1152OrdinaryConsumerFeatureOnlyCoverageContextIntake", () => {
  it("waits until R1151 allows feature-only coverage context", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1152-waiting-"));
    try {
      const r1151Path = path.join(tmp, "r1151.json");
      await writeFile(r1151Path, `${JSON.stringify(r1151Fixture({ allowed: false }))}\n`);

      const { output, outputPath } = await runR1152OrdinaryConsumerFeatureOnlyCoverageContextIntake({
        outputDir: path.join(tmp, "out"),
        r1151Path,
      });

      expect(outputPath.endsWith(
        "r1152-ordinary-consumer-feature-only-coverage-context-intake.latest.json",
      )).toBe(true);
      expect(output.summary).toMatchObject({
        conclusion: "feature_only_coverage_context_waiting_on_r1151_ready",
        contextPathConfigured: false,
        contextStatus: "missing",
        coverageContextReadyForResearchPlanning: false,
        featureOnlyCoverageRequiresPreferredPair: true,
        minimumFeaturePairRequired: LAB_WEARABLE_SOURCE_FAMILY_IDS,
        missingAttestationKeys: REQUIRED_ATTESTATION_KEYS,
        missingPrimaryFeatureFamilyIds: LAB_WEARABLE_SOURCE_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        nextAction: "refresh_r1151_feature_only_submission_mode",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        productDisplayAuthorized: false,
        r1151FeatureOnlyCoverageContextAllowed: false,
        r1151FeatureOnlyModeReadyForIntake: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1152: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("validates lab plus wearable feature-only context as research-only coverage", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1152-ready-"));
    try {
      const r1151Path = path.join(tmp, "r1151.json");
      const contextPath = path.join(tmp, "context.json");
      await Promise.all([
        writeFile(r1151Path, `${JSON.stringify(r1151Fixture({ allowed: true }))}\n`),
        writeFile(contextPath, `${JSON.stringify(coverageContextFixture("ready"))}\n`),
      ]);

      const { output, outputPath } = await runR1152OrdinaryConsumerFeatureOnlyCoverageContextIntake({
        contextPath,
        outputDir: path.join(tmp, "out"),
        r1151Path,
      });
      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;

      expect(output.summary).toMatchObject({
        conclusion: "feature_only_coverage_context_ready_research_only",
        contextPathConfigured: true,
        contextStatus: "available",
        coverageContextReadyForResearchPlanning: true,
        featureOnlyCoverageRequiresPreferredPair: true,
        minimumFeaturePairRequired: LAB_WEARABLE_SOURCE_FAMILY_IDS,
        missingAttestationKeys: [],
        missingPrimaryFeatureFamilyIds: [],
        modelEvidencePromotionAllowed: false,
        nextAction: "use_feature_only_coverage_context_for_research_planning_only",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        productDisplayAuthorized: false,
        r1151FeatureOnlyCoverageContextAllowed: true,
        r1151FeatureOnlyModeReadyForIntake: true,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1152: false,
        supportedFeatureFamilyIds: LAB_WEARABLE_SOURCE_FAMILY_IDS,
      });
      expect(output.featureOnlyCoverageContextIntake.attestationStatus).toBe("complete");
      expect(output.featureOnlyCoverageContextIntake.guardStatus).toBe("complete");
      expect(output.featureOnlyCoverageContextIntake.ordinarySubmitterInputKinds.map((kind) => kind.inputKindId)).toEqual([
        "lab_portal_export_or_spreadsheet",
        "phone_watch_or_wearable_activity_export",
        "optional_vitals_or_body_context",
      ]);
      expect(output.featureOnlyCoverageContextIntake.ordinarySubmitterInputKinds.filter((kind) =>
        kind.requiredForFeatureOnlyPreferredPair
      )).toHaveLength(2);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(persisted)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps lab-only context incomplete until wearable activity is also confirmed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1152-lab-only-"));
    try {
      const r1151Path = path.join(tmp, "r1151.json");
      const contextPath = path.join(tmp, "context.json");
      await Promise.all([
        writeFile(r1151Path, `${JSON.stringify(r1151Fixture({ allowed: true }))}\n`),
        writeFile(contextPath, `${JSON.stringify(coverageContextFixture("lab-only"))}\n`),
      ]);

      const { output } = await runR1152OrdinaryConsumerFeatureOnlyCoverageContextIntake({
        contextPath,
        outputDir: path.join(tmp, "out"),
        r1151Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "feature_only_coverage_context_incomplete",
        coverageContextReadyForResearchPlanning: false,
        missingAttestationKeys: [],
        missingPrimaryFeatureFamilyIds: ["wearable_activity_daily"],
        nextAction: "complete_feature_only_coverage_context_template",
        supportedFeatureFamilyIds: ["bloodwork_glycemia"],
      });
      expect(output.featureOnlyCoverageContextIntake.sourceFamilyStatus).toBe("missing_or_false");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects contexts that try to promote feature-only coverage into model evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1152-guard-"));
    try {
      const r1151Path = path.join(tmp, "r1151.json");
      const contextPath = path.join(tmp, "context.json");
      await Promise.all([
        writeFile(r1151Path, `${JSON.stringify(r1151Fixture({ allowed: true }))}\n`),
        writeFile(contextPath, `${JSON.stringify(coverageContextFixture("promoted"))}\n`),
      ]);

      const { output } = await runR1152OrdinaryConsumerFeatureOnlyCoverageContextIntake({
        contextPath,
        outputDir: path.join(tmp, "out"),
        r1151Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "feature_only_coverage_context_invalid",
        coverageContextReadyForResearchPlanning: false,
        missingPrimaryFeatureFamilyIds: [],
        modelEvidencePromotionAllowed: false,
        nextAction: "complete_feature_only_coverage_context_template",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        productDisplayAuthorized: false,
        rowLevelDataAcceptedByR1152: false,
        supportedFeatureFamilyIds: LAB_WEARABLE_SOURCE_FAMILY_IDS,
      });
      expect(output.featureOnlyCoverageContextIntake.guardStatus).toBe("missing_or_mismatch");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1151Fixture(options: { allowed: boolean }): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1151"),
    packetId: "r1151-ordinary-consumer-feature-only-submission-mode",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1151-ordinary-consumer-feature-only-submission-mode.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: options.allowed
        ? "ordinary_feature_only_mode_available_not_model_evidence"
        : "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
      featureOnlyCoverageContextAllowed: options.allowed,
      featureOnlyCoverageRequiresPreferredPair: true,
      featureOnlyPreferredPairReady: options.allowed,
      minimumFeaturePairRequired: LAB_WEARABLE_SOURCE_FAMILY_IDS,
      missingAttestationKeys: options.allowed ? [] : REQUIRED_ATTESTATION_KEYS,
      missingEvidenceSourceFamilyIds: [
        "outcome_linkage",
        "join_time_alignment",
      ],
      missingPrimaryFeatureFamilyIds: options.allowed ? [] : LAB_WEARABLE_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: options.allowed
        ? "fill_feature_only_coverage_context_template_for_research_only_intake"
        : "fill_safe_availability_confirmation_from_template",
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      outcomeLinkedEvidenceReady: false,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1151: false,
      rowParsingPerformedByR1151: false,
      safeAvailabilityFeatureOnlyCoverageContextReady: options.allowed,
      safeAvailabilityFeatureOnlyReadinessPresent: true,
      supportedFeatureFamilyIds: options.allowed ? LAB_WEARABLE_SOURCE_FAMILY_IDS : [],
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
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
    minimumFeaturePairRequired: LAB_WEARABLE_SOURCE_FAMILY_IDS,
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
    schemaVersion: "murph-age-r1151-ordinary-consumer-feature-only-coverage-context.v1",
    sourceFamilies,
    targetAgeBand: "roughly_16_50",
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
  };
}

function safeBoundary(stage: "R1151"): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    [`rowParsingPerformedBy${stage}`]: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}
