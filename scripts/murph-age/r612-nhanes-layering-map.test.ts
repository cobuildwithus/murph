import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R612_NHANES_LAYERING_MAP_SCHEMA_VERSION,
  runR612NhanesLayeringMap,
} from "./r612-nhanes-layering-map.ts";

describe("R612 NHANES layering map", () => {
  it("builds a pathless aggregate-only map for lab and activity layering", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r612-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR612NhanesLayeringMap({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r612-nhanes-layering-map.latest.json");
      expect(output.schemaVersion).toBe(R612_NHANES_LAYERING_MAP_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        outcomeScoringPerformed: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        splitMembershipStored: false,
      });
      expect(output.summary).toEqual({
        conclusion: "nhanes_layers_mapped_without_product_promotion",
        modelDefaultAuthorized: false,
        objectiveActivityLayer: "shadow_only",
        scoreBearingResearchLayer: "lab_bp_body",
      });
      expect(output.inputArtifacts.map((artifact) => artifact.artifactId)).toEqual([
        "r846",
        "r849",
        "r850",
        "r852",
        "r871",
        "r176",
      ]);
      expect(output.inputArtifacts.every((artifact) => artifact.artifact === path.basename(artifact.artifact))).toBe(true);

      expect(output.layers.labBpBodyScoreBearingResearch).toMatchObject({
        evidenceLabel: "internal-same-family-nhanes-lab-vitals",
        modelLayerRole: "score_bearing_research_layer",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        r871PromotionStatus: "blocked_needs_external_fixed_horizon_validation",
        scoreBearingInProduct: false,
        scoreBearingInResearch: true,
        status: "research_score_candidate_not_product_default",
      });
      expect(output.layers.labBpBodyScoreBearingResearch.primaryComparison).toEqual({
        aucDelta: 0.07867626,
        brierDelta: -0.02038042,
        comparisonId: "lab9_hba1c_vs_bp_body",
        direction: "improved",
        logLossDelta: -0.06251083,
      });

      expect(output.layers.objectiveActivityShadow).toMatchObject({
        evidenceLabel: "same-family-objective-activity-shadow",
        modelLayerRole: "shadow_context_layer",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        r871PromotionStatus: "blocked_needs_external_and_consumer_wearable_validation",
        scoreBearingInProduct: false,
        scoreBearingInResearch: false,
        status: "shadow_only_until_hard_outcome_device_validation",
      });
      expect(output.layers.objectiveActivityShadow.activityComparisons).toEqual([
        {
          aucDelta: -0.02922885,
          brierDelta: -0.00028093,
          comparisonId: "objective_activity_increment",
          direction: "not_clearly_improved",
          logLossDelta: 0.00158731,
        },
        {
          aucDelta: 0.0091405,
          brierDelta: -0.00393194,
          comparisonId: "activity_increment_over_lab10_bp_body",
          direction: "improved",
          logLossDelta: -0.01207557,
        },
      ]);
      expect(output.layers.objectiveActivityShadow.stability).toMatchObject({
        aucDeltaCiCrossesZero: true,
        brierImprovedFraction: 0.954,
        logLossImprovedFraction: 0.9375,
        repsBand: "1000+",
      });

      expect(output.layers.historicalSameFamilyCaveat).toMatchObject({
        evidenceLabel: "same-family-sanity",
        modelLayerRole: "same_family_context_only",
        nhanesBench0Role: "historical_internal_lab_body_reference_only",
        nhanesIiiRole: "aggregate_only_same_family_historical_sanity",
        r176ReviewDecision: "approve_same_family_sanity_continue_external_sources",
        r176SafeToContinue: true,
        scoreBearingInProduct: false,
        scoreBearingInResearch: false,
      });
      expect(output.layers.overfitGuard).toMatchObject({
        evidenceLabel: "overfit-guard",
        modelLayerRole: "selection_pressure_guard",
        scoreBearingInProduct: false,
        scoreBearingInResearch: false,
        selectionPressureRule: "Already-inspected NHANES and NHANES III artifacts may only generate hypotheses for new locked benchmarks or partner aggregate validation.",
      });
      expect(output.layers.overfitGuard.blockedActions).toContain("tune_against_r846_r849_r850_r852_results");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("output-packages");
      expect(persisted).not.toContain(".runtime");
      expect(persisted).not.toContain("row_cache_root");
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"modelParameters\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"smallCells\":");
      expect(persisted).not.toContain("source body");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when an input artifact boundary exports row values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r612-boundary-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafeR850 = path.join(tmp, "unsafe-r850.json");
      await writeJson(unsafeR850, {
        ...r850Fixture(),
        artifact_boundary: {
          ...r850Fixture().artifact_boundary,
          row_values_exported: true,
        },
      });

      await expect(runR612NhanesLayeringMap({
        outputDir: path.join(tmp, "out"),
        ...paths,
        r850Path: unsafeR850,
      })).rejects.toThrow("r850 aggregate boundary flag row_values_exported must be false");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r612-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r612-nhanes-layering-map.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R176_NHANES_III_REVIEW_PATH: paths.r176Path,
          MURPH_AGE_R846_NHANES_ACTIVITY_PATH: paths.r846Path,
          MURPH_AGE_R849_NHANES_LAB_PATH: paths.r849Path,
          MURPH_AGE_R850_NHANES_HIP_ACTIVITY_PATH: paths.r850Path,
          MURPH_AGE_R852_ACTIVITY_STABILITY_PATH: paths.r852Path,
          MURPH_AGE_R871_MODEL_CARD_MANIFEST_PATH: paths.r871Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r612-nhanes-layering-map.latest.json",
        conclusion: "nhanes_layers_mapped_without_product_promotion",
        modelDefaultAuthorized: false,
        objectiveActivityLayer: "shadow_only",
        packetId: "r612-nhanes-layering-map",
        schemaVersion: R612_NHANES_LAYERING_MAP_SCHEMA_VERSION,
        scoreBearingResearchLayer: "lab_bp_body",
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("output-packages");
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  r176Path: string;
  r846Path: string;
  r849Path: string;
  r850Path: string;
  r852Path: string;
  r871Path: string;
}> {
  await mkdir(tmp, { recursive: true });
  const paths = {
    r176Path: path.join(tmp, "r176.json"),
    r846Path: path.join(tmp, "r846.json"),
    r849Path: path.join(tmp, "r849.json"),
    r850Path: path.join(tmp, "r850.json"),
    r852Path: path.join(tmp, "r852.json"),
    r871Path: path.join(tmp, "r871.json"),
  };
  await Promise.all([
    writeJson(paths.r176Path, r176Fixture()),
    writeJson(paths.r846Path, r846Fixture()),
    writeJson(paths.r849Path, r849Fixture()),
    writeJson(paths.r850Path, r850Fixture()),
    writeJson(paths.r852Path, r852Fixture()),
    writeJson(paths.r871Path, r871Fixture()),
  ]);
  return paths;
}

function r846Fixture() {
  return {
    artifact_boundary: safeArtifactBoundary(),
    comparisons: {
      objective_activity_increment: {
        auc_delta: -0.02922885,
        baseline: "lab9_vitals_reference",
        brier_delta: -0.00028093,
        candidate: "lab9_vitals_activity",
        direction: "not_clearly_improved",
        log_loss_delta: 0.00158731,
      },
    },
    evidence_class: "same_family_public_nhanes_objective_activity_research_only",
    run_id: "r846",
    schema_version: "murph-age-nhanes-objective-activity-lab-first-loop.v1",
    support_read: {
      objective_activity_increment: "not_clearly_improved",
      promotion_status: "research_only_no_product_promotion",
    },
  };
}

function r849Fixture() {
  return {
    artifact_boundary: safeArtifactBoundary(),
    comparisons: {
      lab9_hba1c_vs_bp_body: {
        auc_delta: 0.07867626,
        baseline: "bp_body_reference",
        brier_weighted_delta: -0.02038042,
        candidate: "lab9_hba1c_bp_body_primary",
        direction: "improved",
        log_loss_weighted_delta: -0.06251083,
      },
    },
    evidence_class: "internal_same_family_public_nhanes_lab_vitals_research_only",
    run_id: "r849",
    schema_version: "murph-age-nhanes-lab-first-product-shaped-loop.v1",
    support_read: {
      primary_lab9_over_bp_body: "improved",
      promotion_status: "research_only_no_product_promotion",
    },
  };
}

function r850Fixture() {
  return {
    artifact_boundary: {
      ...safeArtifactBoundary(),
      minute_values_exported: false,
    },
    comparisons: {
      activity_increment_over_lab10_bp_body: {
        auc_delta: 0.0091405,
        baseline: "lab10_bp_body_reference",
        brier_weighted_delta: -0.00393194,
        candidate: "lab10_bp_body_activity",
        direction: "improved",
        log_loss_weighted_delta: -0.01207557,
      },
    },
    evidence_class: "same_family_public_nhanes_hip_activity_research_only",
    run_id: "r850",
    schema_version: "murph-age-nhanes-2003-2006-hip-activity-loop.v1",
    support_read: {
      activity_increment_over_lab10_bp_body: "improved",
      promotion_status: "research_only_no_product_promotion",
    },
  };
}

function r852Fixture() {
  return {
    artifact_boundary: {
      coefficients_exported: false,
      model_parameters_exported: false,
      predictions_exported: false,
      product_claims: false,
      rows_exported: false,
    },
    comparisons: {
      activity_increment_over_lab10_bp_body: {
        bootstrap: {
          auc_delta_ci: { p025: -0.02707151, p50: 0.00897137, p975: 0.04002332 },
          bootstrap_reps: 2000,
          brier_weighted_delta_ci: { p025: -0.00893747, p50: -0.00371296, p975: 0.00044047 },
          fraction_brier_improved: 0.954,
          fraction_log_loss_improved: 0.9375,
          log_loss_weighted_delta_ci: { p025: -0.02729434, p50: -0.01189294, p975: 0.00307084 },
        },
      },
    },
    evidence_class: "same_family_public_nhanes_hip_activity_research_only",
    run_id: "r852",
    schema_version: "murph-age-r852-r850-activity-stability.v1",
  };
}

function r871Fixture() {
  return {
    artifact_boundary: {
      coefficients_exported: false,
      model_parameters_exported: false,
      predictions_exported: false,
      product_defaults_exported: false,
      rows_exported: false,
      split_memberships_exported: false,
    },
    cards: [
      {
        card_id: "lab9_bp_body_10y_acm_research",
        promotion_status: "blocked_needs_external_fixed_horizon_validation",
      },
      {
        card_id: "lab10_bp_body_objective_activity_10y_acm_research",
        promotion_status: "blocked_needs_external_and_consumer_wearable_validation",
      },
      {
        card_id: "wearable_context_no_risk",
        promotion_status: "sidecar_only_until_hard_outcome_consumer_validation",
      },
    ],
    run_id: "r871",
    schema_version: "murph-age-r871-research-model-card-manifest.v1",
    status: "research_only_no_product_default",
  };
}

function r176Fixture() {
  return {
    completed_decision_count: 3,
    counts_by_decision: {
      approve_same_family_sanity_continue_external_sources: 3,
    },
    safe_to_continue_after_review: true,
    schema_version: "murph-age-r176-nhanes-iii-aggregate-results-review-summary.v1",
    validation_issue_count: 0,
  };
}

function safeArtifactBoundary() {
  return {
    coefficients_exported: false,
    model_parameters_exported: false,
    participant_ids_exported: false,
    predictions_exported: false,
    product_claims_created: false,
    row_values_exported: false,
    source_bodies_exported: false,
    split_memberships_exported: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
