import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R997_STRICT_NSHAP_FUNCTION_COGNITION_REPLAY_SCHEMA_VERSION,
  runR997StrictNshapFunctionCognitionReplay,
} from "./r997-strict-nshap-function-cognition-replay.ts";

describe("R997 strict NSHAP function cognition replay", () => {
  it("keeps historical aggregate signal usable only for research direction and falsification", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r997-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { r770ValidationStatus: "passed", r773ValidationStatus: "passed" });
      const { output, outputPath } = await runR997StrictNshapFunctionCognitionReplay({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r997-strict-nshap-function-cognition-replay.latest.json");
      expect(output.schemaVersion).toBe(R997_STRICT_NSHAP_FUNCTION_COGNITION_REPLAY_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        codebookProseStored: false,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        modelScoringPerformed: false,
        outcomeScoringPerformed: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        recommendationClaimsIncluded: false,
        rowParsingPerformed: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        sourceCacheFileNamesStored: false,
        splitMembershipStored: false,
        variableLabelsStored: false,
        variableListsStored: false,
        variableNamesStored: false,
      });
      expect(output.historicalAggregateSupport).toMatchObject({
        allRequiredValidationsPassed: true,
        r993HistoricalSupportStatus: "historical_aggregate_support_exists",
        supportStatus: "all_supportive",
        validationPassedCountBand: "1-9",
      });
      expect(output.historicalAggregateSupport.aggregates).toEqual([
        {
          aggregateKey: "r770_function_cognition",
          resultStatus: "available",
          supportStatus: "supportive",
          validationIssueCountBand: "0",
          validationStatus: "passed",
        },
        {
          aggregateKey: "r773_single_domain",
          resultStatus: "available",
          supportStatus: "supportive",
          validationIssueCountBand: "0",
          validationStatus: "passed",
        },
      ]);
      expect(output.activationFrame).toMatchObject({
        activationFrameStatus: "current_activation_frame_incomplete_blocks_new_rows",
        aggregateOutputsActive: false,
        labelsComplete: false,
        productDisplayAuthorized: false,
        r992ScaffoldStatus: "blocked",
        r993HistoricalSupportExists: true,
        requiredHumanLabelCountBand: "1-9",
        rowExecutionAuthorized: false,
        scoringAuthorized: false,
      });
      expect(output.replayUse).toEqual({
        allowedUse: "research_direction_and_falsification_only",
        modelPromotionAuthorized: false,
        newRowExecutionAuthorized: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        scoringAuthorized: false,
      });
      expect(output.summary).toEqual({
        activationFrameStatus: "current_activation_frame_incomplete_blocks_new_rows",
        artifactVerdict: "historical_nshap_aggregate_signal_usable_research_direction_only",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowExecutionUnlocked: false,
        scoringUnlocked: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".json");
      assertOmitsUnsafePayloadNames(persisted);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds replay when a required historical validation is missing or failed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r997-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { r770ValidationStatus: "failed", r773ValidationStatus: "missing" });
      const { output } = await runR997StrictNshapFunctionCognitionReplay({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(output.historicalAggregateSupport.allRequiredValidationsPassed).toBe(false);
      expect(output.historicalAggregateSupport.validationPassedCountBand).toBe("0");
      expect(output.historicalAggregateSupport.aggregates.map((aggregate) => aggregate.validationStatus)).toEqual([
        "failed",
        "missing",
      ]);
      expect(output.replayUse.allowedUse).toBe("hold_for_missing_or_failed_aggregate_evidence");
      expect(output.summary).toMatchObject({
        artifactVerdict: "historical_nshap_aggregate_signal_hold",
        rowExecutionUnlocked: false,
        scoringUnlocked: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary without source cache filenames", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r997-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { r770ValidationStatus: "passed", r773ValidationStatus: "passed" });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r997-strict-nshap-function-cognition-replay.ts",
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
          MURPH_AGE_R993_NSHAP_EXISTING_RESULT_REDUCER_PATH: paths.r993ExistingResultReducerPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        activationFrameStatus: "current_activation_frame_incomplete_blocks_new_rows",
        artifactVerdict: "historical_nshap_aggregate_signal_usable_research_direction_only",
        packetId: "r997-strict-nshap-function-cognition-replay",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowExecutionUnlocked: false,
        schemaVersion: R997_STRICT_NSHAP_FUNCTION_COGNITION_REPLAY_SCHEMA_VERSION,
        scoringUnlocked: false,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain(".json");
      assertOmitsUnsafePayloadNames(stdout);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { r770ValidationStatus: "failed" | "passed"; r773ValidationStatus: "missing" | "passed" },
): Promise<{
  outputDir: string;
  r614ActivationLabelsPath: string;
  r770ResultPath: string;
  r770ValidationPath: string;
  r773ResultPath: string;
  r773ValidationPath?: string;
  r992ScaffoldPath: string;
  r993ExistingResultReducerPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r614ActivationLabelsPath: path.join(fixtureDir, "r614-fixture"),
    r770ResultPath: path.join(fixtureDir, "r770-result-fixture"),
    r770ValidationPath: path.join(fixtureDir, "r770-validation-fixture"),
    r773ResultPath: path.join(fixtureDir, "r773-result-fixture"),
    r773ValidationPath: path.join(fixtureDir, "r773-validation-fixture"),
    r992ScaffoldPath: path.join(fixtureDir, "r992-fixture"),
    r993ExistingResultReducerPath: path.join(fixtureDir, "r993-fixture"),
  };
  await Promise.all([
    writeJson(paths.r614ActivationLabelsPath, activationLabelsFixture()),
    writeJson(paths.r770ResultPath, existingResultFixture({
      supportClassification: "nshap_two_domain_additive_external_supportive_diagnostic_only",
    })),
    writeJson(paths.r770ValidationPath, validationFixture(options.r770ValidationStatus)),
    writeJson(paths.r773ResultPath, existingResultFixture({
      supportClassification: "nshap_both_single_domains_supportive",
    })),
    options.r773ValidationStatus === "passed"
      ? writeJson(paths.r773ValidationPath, validationFixture("passed"))
      : Promise.resolve(),
    writeJson(paths.r992ScaffoldPath, scaffoldFixture()),
    writeJson(paths.r993ExistingResultReducerPath, existingReducerFixture()),
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
    freshExecutionScaffold: {
      rowExecutionUnlocked: false,
      scoringUnlocked: false,
      status: "blocked",
    },
    packetId: "r992-nshap-function-cognition-scaffold",
    schemaVersion: "murph-age-r992-nshap-function-cognition-scaffold.v1",
    summary: {
      rowExecutionUnlocked: false,
      scoringUnlocked: false,
    },
  };
}

function existingReducerFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r993-nshap-existing-result-reducer",
    schemaVersion: "murph-age-r993-nshap-existing-result-reducer.v1",
    summary: {
      existingSupportStatus: "historical_aggregate_support_exists",
      rowExecutionUnlocked: false,
      scoringUnlocked: false,
    },
  };
}

function existingResultFixture(options: { supportClassification: string }): Record<string, unknown> {
  return {
    packetId: "historical-nshap-aggregate-fixture",
    schema_version: "murph.age.r997.fixture.aggregate.v0",
    support_classification: options.supportClassification,
  };
}

function validationFixture(status: "failed" | "passed"): Record<string, unknown> {
  return {
    issue_count: status === "passed" ? 0 : 1,
    packetId: "historical-nshap-validation-fixture",
    schema_version: "murph.age.r997.fixture.validation.v0",
    status,
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    archiveBasenamesStored: false,
    codebookProseStored: false,
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
    protocolClaimsIncluded: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformed: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceCacheFileNamesStored: false,
    sourceProseStored: false,
    splitIdentifiersStored: false,
    splitMembershipStored: false,
    variableLabelsStored: false,
    variableListsStored: false,
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
    "nshap-function-cognition-external-repeat",
    "nshap-single-domain-breakdown",
  ]) {
    expect(text).not.toContain(token);
  }
}
