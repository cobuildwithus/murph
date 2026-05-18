import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R993_NSHAP_EXISTING_RESULT_REDUCER_SCHEMA_VERSION,
  runR993NshapExistingResultReducer,
} from "./r993-nshap-existing-result-reducer.ts";

describe("R993 NSHAP existing result reducer", () => {
  it("reconciles passing historical aggregate support with blocked current activation labels", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r993-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { validationPassed: true });
      const { output, outputPath } = await runR993NshapExistingResultReducer({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r993-nshap-existing-result-reducer.latest.json");
      expect(output.schemaVersion).toBe(R993_NSHAP_EXISTING_RESULT_REDUCER_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        modelScoringPerformed: false,
        outcomeScoringPerformed: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowParsingPerformed: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        variableNamesStored: false,
      });
      expect(output.existingResultSupport.supportStatus).toBe("historical_aggregate_support_exists");
      expect(output.existingResultSupport.resultCountBand).toBe("1-9");
      expect(output.existingResultSupport.validationPassedCountBand).toBe("1-9");
      expect(output.existingResultSupport.supportClassifications).toEqual([
        "nshap_both_single_domains_supportive",
        "nshap_two_domain_additive_external_supportive_diagnostic_only",
      ]);
      expect(output.existingResultSupport.results).toHaveLength(2);
      for (const result of output.existingResultSupport.results) {
        expect(result.validationStatus).toBe("passed");
        expect(result.validationIssueCountBand).toBe("0");
        expect(result.priorExecution).toEqual({
          externalTransportScoringExecuted: true,
          modelPromotionAuthorized: false,
          modelRefitExecuted: false,
          modelTrainingExecuted: false,
          privateSourceCalibrationFitExecuted: true,
          productClaimsCreated: false,
          rowParseExecutedPrivateOnly: true,
        });
      }
      expect(output.activationLabelConflict).toMatchObject({
        activationArtifactStatus: "available",
        activationLabelsComplete: false,
        aggregateOutputsActive: false,
        conflictVerdict: "historical_results_do_not_unlock_current_activation",
        requiredHumanLabelCountBand: "1-9",
        rowExecutionReadinessStatus: "blocked_source_rights_or_output_permission_unconfirmed",
        scaffoldArtifactStatus: "available",
        scaffoldStatus: "blocked",
      });
      expect(output.activationLabelConflict.blockedReasonLabels).toEqual([
        "activation_labels_incomplete",
        "aggregate_output_permission_not_active",
        "missing_activation_label_aggregate_output_permission_clear",
        "missing_activation_label_mortality_or_followup_endpoint_available",
        "outcome_scoring_requires_separate_execution_gate",
        "source_rights_or_aggregate_output_permission_unconfirmed",
      ]);
      expect(output.currentState).toEqual({
        existingAggregatesReconcilable: true,
        futureRowExecutionAuthorized: false,
        futureScoringAuthorized: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        usePriorResultsForResearchDirectionOnly: true,
      });
      expect(output.nextAction).toEqual({
        actionId: "complete_current_activation_labels_before_any_new_nshap_rows",
        allowedEffect: "research_reconciliation_only",
        blockedUntil: [
          "aggregate_output_permission_active",
          "current_activation_labels_complete",
          "minimum_cell_suppression_policy_locked",
          "separate_future_execution_gate_approved",
        ],
        productDisplayAuthorized: false,
        rowExecutionAuthorized: false,
        scoringAuthorized: false,
      });
      expect(output.summary).toEqual({
        artifactVerdict: "historical_aggregate_support_current_activation_blocked",
        existingSupportStatus: "historical_aggregate_support_exists",
        productPromotionAuthorized: false,
        rowExecutionUnlocked: false,
        scoringUnlocked: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      assertOmitsUnsafePayloadNames(persisted);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks historical aggregate support incomplete when a validation file is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r993-missing-validation-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { validationPassed: false });
      const { output } = await runR993NshapExistingResultReducer({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(output.existingResultSupport.supportStatus).toBe("historical_aggregate_support_incomplete");
      expect(output.existingResultSupport.validationPassedCountBand).toBe("1-9");
      expect(output.currentState.existingAggregatesReconcilable).toBe(false);
      expect(output.currentState.usePriorResultsForResearchDirectionOnly).toBe(false);
      expect(output.summary.rowExecutionUnlocked).toBe(false);
      expect(output.summary.scoringUnlocked).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when current activation artifacts export unsafe boundary flags", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r993-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { validationPassed: true });
      const unsafeActivationPath = path.join(tmp, "unsafe-r614.json");
      await writeJson(unsafeActivationPath, {
        ...activationLabelsFixture(),
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR993NshapExistingResultReducer({
        ...paths,
        r614ActivationLabelsPath: unsafeActivationPath,
      })).rejects.toThrow("activationLabels boundary has unsafe boundary flag rowValuesStored");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r993-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { validationPassed: true });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r993-nshap-existing-result-reducer.ts",
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R614_NSHAP_LABELS_PATH: paths.r614ActivationLabelsPath,
          MURPH_AGE_R770_NSHAP_RESULT_PATH: paths.r770ResultPath,
          MURPH_AGE_R770_NSHAP_VALIDATION_PATH: paths.r770ValidationPath,
          MURPH_AGE_R773_NSHAP_RESULT_PATH: paths.r773ResultPath,
          MURPH_AGE_R773_NSHAP_VALIDATION_PATH: paths.r773ValidationPath,
          MURPH_AGE_R992_NSHAP_SCAFFOLD_PATH: paths.r992ScaffoldPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r993-nshap-existing-result-reducer.latest.json",
        artifactVerdict: "historical_aggregate_support_current_activation_blocked",
        existingSupportStatus: "historical_aggregate_support_exists",
        packetId: "r993-nshap-existing-result-reducer",
        productPromotionAuthorized: false,
        rowExecutionUnlocked: false,
        schemaVersion: R993_NSHAP_EXISTING_RESULT_REDUCER_SCHEMA_VERSION,
        scoringUnlocked: false,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      assertOmitsUnsafePayloadNames(stdout);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { validationPassed: boolean },
): Promise<{
  outputDir: string;
  r614ActivationLabelsPath: string;
  r770ResultPath: string;
  r770ValidationPath?: string;
  r773ResultPath: string;
  r773ValidationPath: string;
  r992ScaffoldPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r614ActivationLabelsPath: path.join(fixtureDir, "r614.json"),
    r770ResultPath: path.join(fixtureDir, "r770.json"),
    r770ValidationPath: path.join(fixtureDir, "r770-validation.json"),
    r773ResultPath: path.join(fixtureDir, "r773.json"),
    r773ValidationPath: path.join(fixtureDir, "r773-validation.json"),
    r992ScaffoldPath: path.join(fixtureDir, "r992.json"),
  };
  await Promise.all([
    writeJson(paths.r614ActivationLabelsPath, activationLabelsFixture()),
    writeJson(paths.r770ResultPath, existingResultFixture({
      allowedEffect: "diagnostic_only_no_model_change",
      artifactKind: "combined",
      supportClassification: "nshap_two_domain_additive_external_supportive_diagnostic_only",
    })),
    options.validationPassed ? writeJson(paths.r770ValidationPath, validationFixture()) : Promise.resolve(),
    writeJson(paths.r773ResultPath, existingResultFixture({
      allowedEffect: "diagnostic_only_no_model_change",
      artifactKind: "single_domain",
      supportClassification: "nshap_both_single_domains_supportive",
    })),
    writeJson(paths.r773ValidationPath, validationFixture()),
    writeJson(paths.r992ScaffoldPath, scaffoldFixture()),
  ]);
  return paths;
}

function activationLabelsFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r614-nshap-activation-labels",
    rowExecutionReadiness: {
      blockingReasons: [
        "outcome_scoring_requires_separate_execution_gate",
        "source_rights_or_aggregate_output_permission_unconfirmed",
      ],
      rowExecutionUnlocked: false,
      status: "blocked_source_rights_or_output_permission_unconfirmed",
    },
    schemaVersion: "murph-age-r614-nshap-activation-labels.v1",
    sourceRightsAndAggregateOutput: {
      aggregateOutputsActive: false,
      labelsComplete: false,
      requiredHumanLabels: [
        "aggregate_output_permission_clear",
        "mortality_or_followup_endpoint_available",
      ],
    },
  };
}

function scaffoldFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    blockedReason: [
      "activation_labels_incomplete",
      "aggregate_output_permission_not_active",
      "missing_activation_label_aggregate_output_permission_clear",
      "missing_activation_label_mortality_or_followup_endpoint_available",
      "outcome_scoring_requires_separate_execution_gate",
      "row_readiness_blocked_source_rights_or_output_permission_unconfirmed",
      "source_rights_or_aggregate_output_permission_unconfirmed",
    ].join(";"),
    freshExecutionScaffold: {
      rowExecutionUnlocked: false,
      scoringUnlocked: false,
      status: "blocked",
    },
    packetId: "r992-nshap-function-cognition-scaffold",
    schemaVersion: "murph-age-r992-nshap-function-cognition-scaffold.v1",
  };
}

function existingResultFixture(options: {
  allowedEffect: string;
  artifactKind: string;
  supportClassification: string;
}): Record<string, unknown> {
  return {
    evidence_class: "true_external_transport_stress_interval_mortality_status_not_10y_not_promoted",
    execution_contract: {
      allowed_effect: options.allowedEffect,
    },
    next_action: {
      action_id: `feed_${options.artifactKind}_into_research_direction`,
      allowed_effect: "research_direction_only",
    },
    schema_version: `murph.age.r993.fixture.${options.artifactKind}.v0`,
    source_id: "nshap_public_round2_to_round3",
    status_snapshot: {
      external_transport_scoring_executed: true,
      model_promotion_authorized: false,
      model_refit_executed: false,
      model_training_executed: false,
      private_source_calibration_fit_executed: true,
      product_claims_created: false,
      row_parse_executed_private_only: true,
    },
    support_classification: options.supportClassification,
  };
}

function validationFixture(): Record<string, unknown> {
  return {
    issue_count: 0,
    schema_version: "murph.age.r993.fixture.validation.v0",
    status: "passed",
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    archiveBasenamesStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    modelScoringPerformed: false,
    outcomeScoringPerformed: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowParsingPerformed: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    variableLabelsStored: false,
    variableNamesStored: false,
    variableNameSamplesStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assertOmitsUnsafePayloadNames(text: string): void {
  for (const token of [
    "CASE" + "ID",
    "participant" + "Ids",
    "prediction" + "ById",
    "\"coef" + "ficients\":",
    "\"model" + "Parameters\":",
    "\"row" + "Values\":",
    "\"small" + "Cells\":",
    "source " + "body",
  ]) {
    expect(text).not.toContain(token);
  }
}
