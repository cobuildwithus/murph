import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1006_MHAS_PANEL_EXTENSION_RUNNER_MANIFEST_SCHEMA_VERSION,
  runR1006MhasPanelExtensionRunnerManifest,
} from "./r1006-mhas-panel-extension-runner-manifest.ts";

describe("R1006 MHAS panel extension runner manifest", () => {
  it("creates a ready local-private runner manifest from the MHAS source card and function family definition", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1006-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1006MhasPanelExtensionRunnerManifest({
        createdAt: "2026-05-13T06:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1006-mhas-panel-extension-runner-manifest.latest.json");
      expect(output.schemaVersion).toBe(R1006_MHAS_PANEL_EXTENSION_RUNNER_MANIFEST_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "mhas_panel_extension_runner_manifest_ready",
        nextLocalAction: "implement_mhas_panel_extension_local_private_runner",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1006: false,
      });
      expect(output.runnerManifest).toMatchObject({
        candidate: {
          candidateFeatureFamily: "function_limitation_disability_v1",
          familyDefinitionStatus: "proposal_only_tightened_after_r748_reviewgpt_reduction",
          sourceSpecificTuningAllowedAfterScoring: false,
          trainingTarget: "outcome_risk_not_chronological_age",
        },
        comparator: {
          referenceFeatureFamily: "age_sex_reference",
          sameDenominatorPolicy: "same_denominator_age_sex_vs_function_disability",
        },
        endpointAndSplit: {
          denominatorId: "mhas-function-disability-followup-v0",
          minimumCellThreshold: 11,
          splitPolicy: "deterministic_hash_split_no_endpoint_or_score_input",
        },
        metrics: {
          negativeControlRequired: true,
        },
        runnerId: "mhas-panel-extension-runner-r1006",
        runnerStatus: "ready_to_implement_local_private_runner",
        sourceFamily: "MHAS/Gateway MHAS",
      });
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productDisplayAuthorized: false,
        rowParsingPerformedByR1006: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain(".latest.json");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds when the source card is not ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1006-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { sourceCardReady: false });
      const { output } = await runR1006MhasPanelExtensionRunnerManifest({
        createdAt: "2026-05-13T06:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("mhas_panel_extension_runner_manifest_hold");
      expect(output.runnerManifest.runnerStatus).toBe("hold_pending_source_card_or_family_definition");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate input egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1006-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r1005Path, {
        ...r1005Fixture(true),
        rawRows: [],
      });

      await expect(runR1006MhasPanelExtensionRunnerManifest({
        ...paths,
      })).rejects.toThrow("R1006 input r1005MhasPanelSourceCard failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1006-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1006-mhas-panel-extension-runner-manifest.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_FUNCTION_FAMILY_DEFINITION_PATH: paths.functionFamilyPath,
          MURPH_AGE_R1005_MHAS_PANEL_SOURCE_CARD_PATH: paths.r1005Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "mhas_panel_extension_runner_manifest_ready",
        nextLocalAction: "implement_mhas_panel_extension_local_private_runner",
        packetId: "r1006-mhas-panel-extension-runner-manifest",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1006: false,
        runnerStatus: "ready_to_implement_local_private_runner",
        schemaVersion: R1006_MHAS_PANEL_EXTENSION_RUNNER_MANIFEST_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain(".latest.json");
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { sourceCardReady?: boolean } = {},
): Promise<{
  functionFamilyPath: string;
  outputDir: string;
  r1005Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    functionFamilyPath: path.join(fixtureDir, "function-family.json"),
    outputDir,
    r1005Path: path.join(fixtureDir, "r1005.json"),
  };
  await Promise.all([
    writeJson(paths.functionFamilyPath, functionFamilyFixture()),
    writeJson(paths.r1005Path, r1005Fixture(options.sourceCardReady !== false)),
  ]);
  return paths;
}

function r1005Fixture(ready: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1005-mhas-panel-source-card",
    schemaVersion: "murph-age-r1005-mhas-panel-source-card.v1",
    sourceCard: {
      benchmarkCard: {
        allowedMetricFamilies: ["auc", "brier", "log_loss", "calibration_summary"],
        denominatorId: "mhas-function-disability-followup-v0",
        evidenceClass: "non_us_external_function_disability_diagnostic",
        minimumCellThreshold: 11,
        sameDenominatorPolicy: "same_denominator_age_sex_vs_function_disability",
        splitPolicy: "deterministic_hash_split_no_endpoint_or_score_input",
        status: ready ? "ready_for_research_panel_extension" : "hold_pending_required_evidence",
      },
      modelScope: {
        candidateFeatureFamily: "function_limitation_disability_v1",
        referenceFeatureFamily: "age_sex_reference",
      },
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready ? "mhas_panel_source_card_ready_research_only" : "mhas_panel_source_card_hold_pending_evidence",
    },
  };
}

function functionFamilyFixture(): Record<string, unknown> {
  return {
    family_id: "function_limitation_disability_v1",
    schema_version: "murph.age.feature_family.function_frailty.r751.v0",
    status: "proposal_only_tightened_after_r748_reviewgpt_reduction",
    storage_attestation: {
      codebook_prose_exported: false,
      coefficients_exported: false,
      participant_identifiers_exported: false,
      product_claims_created: false,
      row_level_predictions_exported: false,
      row_values_exported: false,
      source_field_names_exported: false,
      source_text_exported: false,
    },
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookProseStored: false,
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
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
