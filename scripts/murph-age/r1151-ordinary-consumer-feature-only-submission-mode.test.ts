import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1151OrdinaryConsumerFeatureOnlySubmissionMode } from "./r1151-ordinary-consumer-feature-only-submission-mode.ts";

const LAB_WEARABLE_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const EVIDENCE_LINKAGE_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
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

describe("runR1151OrdinaryConsumerFeatureOnlySubmissionMode", () => {
  it("waits on R1150 safe availability confirmation by default", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1151-missing-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      await writeFile(r1150Path, `${JSON.stringify(r1150Fixture("missing"))}\n`);

      const { featureOnlyCoverageContextTemplatePath, output, outputPath } =
        await runR1151OrdinaryConsumerFeatureOnlySubmissionMode({
          outputDir: path.join(tmp, "out"),
          r1150Path,
        });

      expect(outputPath.endsWith("r1151-ordinary-consumer-feature-only-submission-mode.latest.json")).toBe(true);
      expect(featureOnlyCoverageContextTemplatePath.endsWith(
        "r1151-fillable-ordinary-consumer-feature-only-coverage-context.json",
      )).toBe(true);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        featureOnlyCoverageContextAllowed: false,
        featureOnlyCoverageRequiresPreferredPair: true,
        featureOnlyPreferredPairReady: false,
        minimumFeaturePairRequired: LAB_WEARABLE_SOURCE_FAMILY_IDS,
        missingPrimaryFeatureFamilyIds: LAB_WEARABLE_SOURCE_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_safe_availability_confirmation_from_template",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        outcomeLinkedEvidenceReady: false,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        safeAvailabilityFeatureOnlyCoverageContextReady: false,
        safeAvailabilityFeatureOnlyReadinessPresent: true,
        rowLevelDataAcceptedByR1151: false,
      });
      expect(output.summary.missingAttestationKeys).toEqual(REQUIRED_ATTESTATION_KEYS);
      expect(output.summary.missingEvidenceSourceFamilyIds).toEqual(EVIDENCE_LINKAGE_SOURCE_FAMILY_IDS);

      const template: unknown = JSON.parse(await readFile(featureOnlyCoverageContextTemplatePath, "utf8"));
      const sourceFamilies = readArrayAt(template, ["sourceFamilies"]);
      const inputKinds = readArrayAt(template, ["ordinarySubmitterInputKinds"]);
      expect(readStringAt(template, ["evidenceRole"])).toBe("feature_only_coverage_context_not_model_evidence");
      expect(readBooleanAt(template, ["featureOnlyCoverageRequiresPreferredPair"])).toBe(true);
      expect(readArrayAt(template, ["minimumFeaturePairRequired"])).toEqual(LAB_WEARABLE_SOURCE_FAMILY_IDS);
      expect(readBooleanAt(template, ["modelEvidencePromotionAllowed"])).toBe(false);
      expect(readBooleanAt(template, ["outcomeLinkageRequiredForFeatureOnlyContext"])).toBe(false);
      expect(readBooleanAt(template, ["rowLevelDataAcceptedByR1151"])).toBe(false);
      expect(sourceFamilies.map((family) => readStringAt(family, ["familyId"]))).toEqual([
        "bloodwork_glycemia",
        "wearable_activity_daily",
        "common_bloodwork_core",
        "vitals_body_context",
      ]);
      expect(sourceFamilies.every((family) => readBooleanAt(family, ["privateDetailsStored"]) === false)).toBe(true);
      expect(inputKinds.map((kind) => readStringAt(kind, ["inputKindId"]))).toEqual([
        "lab_portal_export_or_spreadsheet",
        "phone_watch_or_wearable_activity_export",
        "optional_vitals_or_body_context",
      ]);
      expect(inputKinds.filter((kind) =>
        readBooleanAt(kind, ["requiredForFeatureOnlyPreferredPair"]) === true
      )).toHaveLength(2);
      expect(inputKinds.every((kind) => readBooleanAt(kind, ["privateDetailsStored"]) === false)).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(template)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("classifies lab plus wearable availability without outcome linkage as feature-only context", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1151-feature-only-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      await writeFile(r1150Path, `${JSON.stringify(r1150Fixture("feature-only"))}\n`);

      const { output } = await runR1151OrdinaryConsumerFeatureOnlySubmissionMode({
        outputDir: path.join(tmp, "out"),
        r1150Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_mode_available_not_model_evidence",
        featureOnlyCoverageContextAllowed: true,
        featureOnlyCoverageRequiresPreferredPair: true,
        featureOnlyPreferredPairReady: true,
        minimumFeaturePairRequired: LAB_WEARABLE_SOURCE_FAMILY_IDS,
        missingAttestationKeys: [],
        missingEvidenceSourceFamilyIds: EVIDENCE_LINKAGE_SOURCE_FAMILY_IDS,
        missingPrimaryFeatureFamilyIds: [],
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_feature_only_coverage_context_template_for_research_only_intake",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        outcomeLinkedEvidenceReady: false,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        safeAvailabilityFeatureOnlyCoverageContextReady: true,
        safeAvailabilityFeatureOnlyReadinessPresent: true,
        rowLevelDataAcceptedByR1151: false,
        supportedFeatureFamilyIds: LAB_WEARABLE_SOURCE_FAMILY_IDS,
      });
      expect(output.featureOnlySubmissionMode.minimumFeaturePairRequired).toEqual(LAB_WEARABLE_SOURCE_FAMILY_IDS);
      expect(output.featureOnlySubmissionMode.modelEvidencePromotionAllowed).toBe(false);
      expect(output.featureOnlySubmissionMode.blockedContextContent).toContain("row_values");
      expect(output.featureOnlySubmissionMode.commands.featureOnlyCoverageContextIntakeCommand).toContain(
        "r1152-ordinary-consumer-feature-only-coverage-context-intake.ts",
      );
      expect(output.featureOnlySubmissionMode.ordinarySubmitterInputKinds).toHaveLength(3);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps single-family lab availability below the lab-plus-wearable feature-only threshold", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1151-lab-only-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      await writeFile(r1150Path, `${JSON.stringify(r1150Fixture("lab-only"))}\n`);

      const { output } = await runR1151OrdinaryConsumerFeatureOnlySubmissionMode({
        outputDir: path.join(tmp, "out"),
        r1150Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_mode_unavailable_missing_lab_or_wearable_sources",
        featureOnlyCoverageContextAllowed: false,
        featureOnlyCoverageRequiresPreferredPair: true,
        featureOnlyPreferredPairReady: false,
        minimumFeaturePairRequired: LAB_WEARABLE_SOURCE_FAMILY_IDS,
        missingAttestationKeys: [],
        missingEvidenceSourceFamilyIds: EVIDENCE_LINKAGE_SOURCE_FAMILY_IDS,
        missingPrimaryFeatureFamilyIds: ["wearable_activity_daily"],
        modelEvidencePromotionAllowed: false,
        nextAction: "add_bloodwork_or_wearable_sources_before_feature_only_context",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        outcomeLinkedEvidenceReady: false,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        safeAvailabilityFeatureOnlyCoverageContextReady: false,
        safeAvailabilityFeatureOnlyReadinessPresent: true,
        rowLevelDataAcceptedByR1151: false,
        supportedFeatureFamilyIds: ["bloodwork_glycemia"],
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("defers to the outcome-linked recipe chain when R1150 is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1151-ready-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      await writeFile(r1150Path, `${JSON.stringify(r1150Fixture("ready"))}\n`);

      const { output } = await runR1151OrdinaryConsumerFeatureOnlySubmissionMode({
        outputDir: path.join(tmp, "out"),
        r1150Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence",
        featureOnlyCoverageContextAllowed: false,
        featureOnlyCoverageRequiresPreferredPair: true,
        featureOnlyPreferredPairReady: true,
        minimumFeaturePairRequired: LAB_WEARABLE_SOURCE_FAMILY_IDS,
        missingAttestationKeys: [],
        missingEvidenceSourceFamilyIds: [],
        missingPrimaryFeatureFamilyIds: [],
        modelEvidencePromotionAllowed: false,
        nextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        outcomeLinkedEvidenceReady: true,
        safeAvailabilityFeatureOnlyCoverageContextReady: true,
        safeAvailabilityFeatureOnlyReadinessPresent: true,
        rowLevelDataAcceptedByR1151: false,
        supportedFeatureFamilyIds: LAB_WEARABLE_SOURCE_FAMILY_IDS,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1150Fixture(mode: "feature-only" | "lab-only" | "missing" | "ready"): Record<string, unknown> {
  const ready = mode === "ready";
  const featureOnly = mode === "feature-only";
  const labOnly = mode === "lab-only";
  const missingRequiredSourceFamilyIds = ready
    ? []
    : featureOnly
      ? EVIDENCE_LINKAGE_SOURCE_FAMILY_IDS
      : labOnly
        ? [
            "outcome_linkage",
            "join_time_alignment",
            "wearable_activity_daily",
          ]
        : [
            "outcome_linkage",
            "join_time_alignment",
            "bloodwork_glycemia",
            "wearable_activity_daily",
          ];
  return {
    artifactBoundary: safeBoundary("R1150"),
    packetId: "r1150-ordinary-consumer-safe-availability-confirmation-intake",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "safe_availability_confirmation_ready_for_recipe_readiness_chain"
        : featureOnly
          ? "safe_availability_confirmation_feature_only_ready_research_only"
          : labOnly
            ? "safe_availability_confirmation_incomplete"
            : "safe_availability_confirmation_not_provided",
      confirmationPathConfigured: mode !== "missing",
      confirmationStatus: mode === "missing" ? "missing" : "available",
      expectedRouteIds: [
        "lab_glycemia_minimum_route",
        "wearable_activity_minimum_route",
      ],
      featureOnlyCoverageContextReady: mode !== "missing" && !labOnly,
      featureOnlyCoverageRequiresPreferredPair: true,
      minimumFeaturePairRequired: LAB_WEARABLE_SOURCE_FAMILY_IDS,
      missingAggregateReadinessFactIds: ready
        ? []
        : featureOnly || labOnly
          ? ["outcomeLinked", "sameDenominator"]
          : [
              "outcomeLinked",
              "sameDenominator",
              "targetAgeBand",
              "usableRecordCountBand",
              "eventCountBand",
            ],
      missingAttestationKeys: mode === "missing" ? REQUIRED_ATTESTATION_KEYS : [],
      missingFeatureOnlySourceFamilyIds: labOnly
        ? ["wearable_activity_daily"]
        : mode === "missing"
          ? LAB_WEARABLE_SOURCE_FAMILY_IDS
          : [],
      missingRequiredSourceFamilyIds,
      nextAction: ready
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : featureOnly || labOnly
          ? "complete_safe_availability_confirmation_template"
          : "fill_safe_availability_confirmation_from_template",
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      productDisplayAuthorized: false,
      readyForRecipeReadinessChain: ready,
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed: mode !== "missing",
      rowLevelDataAcceptedByR1150: false,
      rowParsingPerformedByR1150: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      templateArtifact: "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
    },
  };
}

function safeBoundary(stage: "R1150"): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    [`outcomeScoringPerformedBy${stage}`]: false,
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

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readArrayAt(value: unknown, pathParts: readonly string[]): unknown[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
