import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1164_ORDINARY_CONSUMER_FEATURE_ONLY_RESEARCH_HANDOFF_SCHEMA_VERSION,
  runR1164OrdinaryConsumerFeatureOnlyResearchHandoff,
} from "./r1164-ordinary-consumer-feature-only-research-handoff.ts";

const CREATED_AT = "2026-05-17T00:00:00.000Z";
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
];
const MINIMUM_FEATURE_PAIR_REQUIRED = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const REQUIRED_ASSERTION_ITEM_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_assertion_contains_no_private_values",
];

describe("R1164 ordinary consumer feature-only research handoff", () => {
  it("waits for a schema-current R1163 artifact without storing the input path", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1164-missing-"));
    try {
      const { output, outputPath } = await runR1164OrdinaryConsumerFeatureOnlyResearchHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1163Path: path.join(tmp, "missing-r1163.json"),
      });
      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;

      expect(path.basename(outputPath)).toBe(
        "r1164-ordinary-consumer-feature-only-research-handoff.latest.json",
      );
      expect(output.schemaVersion).toBe(R1164_ORDINARY_CONSUMER_FEATURE_ONLY_RESEARCH_HANDOFF_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_research_handoff_waiting_on_r1163",
        featureOnlyResearchPlanningReady: false,
        minimumFeaturePairRequired: MINIMUM_FEATURE_PAIR_REQUIRED,
        modelEvidencePromotionAllowed: false,
        nextAction: "refresh_r1163_feature_only_safe_confirmation_to_research_runner",
        outcomeLinkedModelEvidenceStillRequired: true,
        prioritizedInputKindIds: REQUIRED_INPUT_KIND_IDS,
        productDisplayAuthorized: false,
        r1163Available: false,
        r1163SchemaCurrent: false,
        researchPlanningAllowed: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1164: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1164: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        childOutputPathsStored: false,
        localPathsStored: false,
        modelEvidencePromotedByR1164: false,
        r1163InputPathStored: false,
        rowLevelDataAcceptedByR1164: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(persisted)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("turns the waiting R1163 state into a concise average-submitter assertion action", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1164-waiting-"));
    try {
      const r1163Path = path.join(tmp, "r1163.json");
      await writeJson(r1163Path, r1163Fixture("waiting"));

      const { output } = await runR1164OrdinaryConsumerFeatureOnlyResearchHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1163Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_research_handoff_waiting_on_row_owner_assertion",
        explicitRowOwnerConfirmationAssertionProvided: false,
        featureOnlyChainRan: false,
        featureOnlyResearchPlanningReady: false,
        nextAction: "complete_r1163_feature_only_availability_assertion_contract",
        r1163Available: true,
        r1163SchemaCurrent: true,
        researchPlanningAllowed: false,
        rowOwnerAssertionStillRequired: true,
      });
      expect(output.r1163State).toMatchObject({
        requiredAssertionContractReady: true,
        requiredAssertionItemIdsPresent: true,
        requiredInputKindIdsPresent: true,
        targetAgeBandMatches: true,
        targetInputPriorityMatches: true,
      });
      expect(output.featureOnlyResearchHandoff.prioritizedSubmitterInputKinds).toEqual([
        expect.objectContaining({
          inputKindId: "lab_portal_export_or_spreadsheet",
          mapsToFeatureFamilyIds: ["bloodwork_glycemia", "common_bloodwork_core"],
          privateDetailsStored: false,
          requiredForFeatureOnlyPlanning: true,
        }),
        expect.objectContaining({
          inputKindId: "phone_watch_or_wearable_activity_export",
          mapsToFeatureFamilyIds: ["wearable_activity_daily"],
          privateDetailsStored: false,
          requiredForFeatureOnlyPlanning: true,
        }),
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the lab plus wearable feature-only path ready for research planning only", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1164-ready-"));
    try {
      const r1163Path = path.join(tmp, "r1163.json");
      await writeJson(r1163Path, r1163Fixture("ready"));

      const { output, outputPath } = await runR1164OrdinaryConsumerFeatureOnlyResearchHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1163Path,
      });
      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_research_handoff_ready_research_only",
        explicitRowOwnerConfirmationAssertionProvided: true,
        featureOnlyChainRan: true,
        featureOnlyResearchPlanningReady: true,
        minimumFeaturePairRequired: MINIMUM_FEATURE_PAIR_REQUIRED,
        modelEvidencePromotionAllowed: false,
        nextAction: "use_feature_only_coverage_context_for_research_planning_only",
        outcomeLinkedModelEvidenceStillRequired: true,
        prioritizedInputKindIds: REQUIRED_INPUT_KIND_IDS,
        productDisplayAuthorized: false,
        r1163Available: true,
        r1163SchemaCurrent: true,
        researchPlanningAllowed: true,
        researchRole: "feature_only_coverage_context_not_model_evidence",
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1164: false,
        rowOwnerAssertionStillRequired: false,
        rowOwnerPrivateValuesStored: false,
      });
      expect(output.featureOnlyResearchHandoff).toMatchObject({
        evidenceUse: "research_planning_only_not_model_evidence",
        featureOnlyResearchPlanningReady: true,
        minimumFeaturePairRequired: MINIMUM_FEATURE_PAIR_REQUIRED,
        modelEvidencePromotionAllowed: false,
        outcomeLinkedModelEvidenceStillRequired: true,
        privateDetailsStored: false,
        requiredAssertionItemIds: REQUIRED_ASSERTION_ITEM_IDS,
        requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
        researchPlanningAllowed: true,
        rowLevelDataAcceptedByR1164: false,
        rowOwnerPrivateValuesStored: false,
      });
      expect(output.featureOnlyResearchHandoff.sourceFamilyPriority.map((item) => item.familyId)).toEqual([
        "bloodwork_glycemia",
        "wearable_activity_daily",
        "common_bloodwork_core",
        "vitals_body_context",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(persisted)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1164-cli-"));
    try {
      const r1163Path = path.join(tmp, "r1163.json");
      await writeJson(r1163Path, r1163Fixture("ready"));
      const stdout = await execFileStdout("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1164-ordinary-consumer-feature-only-research-handoff.ts"),
      ], {
        MURPH_AGE_R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_PATH: r1163Path,
        MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
      });
      const parsed = JSON.parse(stdout) as {
        conclusion: string;
        featureOnlyResearchPlanningReady: boolean;
        nextAction: string;
        packetId: string;
        prioritizedInputKindIds: string[];
        schemaVersion: string;
      };

      expect(parsed).toMatchObject({
        conclusion: "ordinary_feature_only_research_handoff_ready_research_only",
        featureOnlyResearchPlanningReady: true,
        nextAction: "use_feature_only_coverage_context_for_research_planning_only",
        packetId: "r1164-ordinary-consumer-feature-only-research-handoff",
        prioritizedInputKindIds: REQUIRED_INPUT_KIND_IDS,
        schemaVersion: R1164_ORDINARY_CONSUMER_FEATURE_ONLY_RESEARCH_HANDOFF_SCHEMA_VERSION,
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1163Fixture(state: "ready" | "waiting"): Record<string, unknown> {
  const ready = state === "ready";
  return {
    artifactBoundary: {
      aggregateOnly: true,
      childOutputPathsStored: false,
      confirmationArtifactLocalPathStored: false,
      confirmationValuesStoredByR1163: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowLevelDataAcceptedByR1163: false,
      rowOwnerAssertionInferredByR1163: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1163: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    packetId: "r1163-feature-only-safe-confirmation-to-research-runner",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1163-feature-only-safe-confirmation-to-research-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "feature_only_safe_confirmation_to_research_runner_ready_research_only"
        : "feature_only_safe_confirmation_to_research_runner_waiting_on_row_owner_assertion",
      explicitRowOwnerConfirmationAssertionProvided: ready,
      featureOnlyChainRan: ready,
      featureOnlyResearchPlanningReady: ready,
      minimumFeaturePairRequired: MINIMUM_FEATURE_PAIR_REQUIRED,
      modelEvidencePromotionAllowed: false,
      nextAction: ready
        ? "use_feature_only_coverage_context_for_research_planning_only"
        : "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner",
      optionalAddOnFamilyIds: [
        "common_bloodwork_core",
        "vitals_body_context",
      ],
      productDisplayAuthorized: false,
      requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowOwnerAssertionContractItemIds: REQUIRED_ASSERTION_ITEM_IDS,
      rowOwnerAssertionContractReady: true,
      rowLevelDataAcceptedByR1163: false,
      rowOwnerAssertionInferredByR1163: false,
      rowOwnerAssertionStillRequired: !ready,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1163: false,
      safeConfirmationArtifactWritten: ready,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function execFileStdout(
  file: string,
  args: string[],
  env: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      env: {
        ...process.env,
        ...env,
      },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Command failed: ${error.message}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}
