import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  assertR1032Safe,
  R1032_LABS_WEARABLES_PIVOT_SCAFFOLD_SCHEMA_VERSION,
  runR1032LabsWearablesPivotScaffold,
} from "./r1032-labs-wearables-pivot-scaffold.ts";

describe("R1032 labs/wearables pivot scaffold", () => {
  it("persists the ReviewGPT-approved labs/wearables main-lane scaffold without product display", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1032-"));
    try {
      const { output, outputPath } = await runR1032LabsWearablesPivotScaffold({
        createdAt: "2026-05-13T22:00:00.000Z",
        outputDir: path.join(tmp, "out"),
      });

      expect(path.basename(outputPath)).toBe("r1032-labs-wearables-pivot-scaffold.latest.json");
      expect(output.schemaVersion).toBe(R1032_LABS_WEARABLES_PIVOT_SCAFFOLD_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-scaffold-no-row-parsing");
      expect(output.summary).toEqual({
        conclusion: "labs_wearables_main_lane_scaffolded_no_product_display",
        firstLoop: "nhanes_lab_activity_mortality_v1",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1032: false,
      });
      expect(output.pivotDecision).toMatchObject({
        functionDisabilityStatus: "parallel_sidecar_not_main_lane",
        mainLane: "labs_activity_sleep_autonomic_outcome_risk",
        productDisplayAuthorized: false,
        wearableScoreBearingStatus: "shadow_until_integrated_outcome_validation",
      });
      expect(output.reviewGptEvidence).toMatchObject({
        finalConfirmation: "APPROVE_WITH_CHANGES",
        requiredModel: "GPT-5.5 Extended Pro",
      });
      expect(output.sourcePriority.immediatePublicLocal[0]).toMatchObject({
        rank: 1,
        source: "nhanes_labs_body_bp_objective_activity_linked_mortality",
      });
      expect(output.sourcePriority.controlledPartnerWorkbench[0]).toMatchObject({
        rank: 1,
        source: "partner_aggregate_evaluator",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".runtime");
      expect(persisted).not.toContain("output-packages");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"modelParameters\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"smallCells\":");
      expect(persisted).not.toContain("ICPSR_");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("encodes the Extended Pro corrections as blocking scaffold rules", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1032-rules-"));
    try {
      const { output } = await runR1032LabsWearablesPivotScaffold({
        outputDir: path.join(tmp, "out"),
      });
      const policies = [
        ...output.modelArchitecture.modelingPolicy,
        output.modelArchitecture.anchorPolicy.crosswalkRule,
        ...output.modelArchitecture.missingnessPolicy.defaultUse,
        ...output.modelArchitecture.fairnessAndTransportPolicy,
      ].join("\n");

      expect(policies).toContain("censoring");
      expect(policies).toContain("directly observed");
      expect(policies).toContain("uncertainty widening");
      expect(policies).toContain("Promotion fails");
      expect(output.modelArchitecture.endpointHierarchy).toEqual([
        "all_cause_mortality",
        "major_cardiovascular_event",
        "hospitalization_or_emergency_utilization",
        "incident_cardiometabolic_disease",
        "frailty_disability_or_functional_decline_auxiliary_head",
      ]);

      const nhanes = output.benchmarkCards.find((card) => card.benchmarkCardId === "nhanes_lab_activity_mortality_v1");
      expect(nhanes).toBeDefined();
      expect(nhanes?.surveyWeightPolicy).toContain("weighted and unweighted metrics");
      expect(nhanes?.metricPlan).toEqual(expect.arrayContaining([
        "weighted_brier_when_feasible",
        "unweighted_brier",
        "weighted_log_loss_when_feasible",
        "unweighted_log_loss",
      ]));
      expect(nhanes?.promotionGates).toContain("integrated_validation_required_before_consumer_wearable_claim");
      expect(nhanes?.candidateFamilies.filter((candidate) => candidate.role === "score_bearing_research_candidate").map((candidate) => candidate.candidateId)).toEqual([
        "A0_age_sex",
        "A1_anchor_projection_or_age_sex_body_bp",
        "A2_lab5_bp_body",
        "A3_lab9_bp_body",
        "A4_lab9_bp_body_plus_activity_volume",
        "A5_lab9_bp_body_plus_activity_volume_plus_sedentary",
        "A6_lab9_bp_body_plus_activity_quality_controls",
      ]);

      const labTransport = output.benchmarkCards.find((card) => card.benchmarkCardId === "external_lab_transport_v1");
      expect(labTransport?.featureFamilies).toContain("medication_and_sampling_context");

      const partner = output.benchmarkCards.find((card) => card.benchmarkCardId === "partner_integrated_wearable_lab_evaluator_v1");
      expect(partner?.promotionGates).toContain("integrated_same_denominator_validation_before_combined_score");
      expect(partner?.negativeControls).toContain("device_provider_only");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed if a scaffold mutates into product display or unsafe output", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1032-unsafe-"));
    try {
      const { output } = await runR1032LabsWearablesPivotScaffold({
        outputDir: path.join(tmp, "out"),
      });
      const unsafe = {
        ...output,
        pivotDecision: {
          ...output.pivotDecision,
          productDisplayAuthorized: true,
        },
      };

      expect(() => assertR1032Safe(unsafe as never)).toThrow("R1032 labs/wearables pivot scaffold failed safety validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1032-cli-"));
    try {
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1032-labs-wearables-pivot-scaffold.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        benchmarkCardCount: 3,
        conclusion: "labs_wearables_main_lane_scaffolded_no_product_display",
        firstLoop: "nhanes_lab_activity_mortality_v1",
        packetId: "r1032-labs-wearables-pivot-scaffold",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1032: false,
        schemaVersion: R1032_LABS_WEARABLES_PIVOT_SCAFFOLD_SCHEMA_VERSION,
        status: "research-local-scaffold-no-row-parsing",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});
