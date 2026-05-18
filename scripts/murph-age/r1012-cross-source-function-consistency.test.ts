import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1012_CROSS_SOURCE_FUNCTION_CONSISTENCY_SCHEMA_VERSION,
  runR1012CrossSourceFunctionConsistency,
} from "./r1012-cross-source-function-consistency.ts";

describe("R1012 cross-source function consistency", () => {
  it("merges the latest aggregate function evidence into the current lead-sidecar state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1012-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1012CrossSourceFunctionConsistency({
        createdAt: "2026-05-13T11:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1012-cross-source-function-consistency.latest.json");
      expect(output.schemaVersion).toBe(R1012_CROSS_SOURCE_FUNCTION_CONSISTENCY_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "function_disability_lead_sidecar_supported_pending_fresh_nshap",
        nextLocalAction: "complete_nshap_source_confirmation_then_run_fresh_function_cognition",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1012: false,
      });
      expect(output.consistencyState).toMatchObject({
        currentLeadFamily: "function_disability",
        functionSidecarStatus: "lead_diagnostic_supported_pending_fresh_nshap",
        generalizationEvidence: {
          historicalNshapUsableForDirection: true,
          mhasCrossSourcePortableVerdict: true,
          mhasDomainAttributionSupportive: true,
          mhasPanelSupportive: true,
          reviewGptFunctionLeadConsensus: true,
        },
        productDisplayAuthorized: false,
        sourceSupportSummary: {
          negativeFunctionBrierDeltaCount: 5,
          positiveFunctionCDeltaCount: 5,
          sourceCount: 5,
          supportiveSourceCount: 5,
        },
      });
      expect(output.nextActions[0]).toMatchObject({
        actionId: "complete_nshap_source_confirmation_then_run_fresh_function_cognition",
        blockedBy: [
          "source_labels_incomplete",
          "aggregate_output_permission_inactive",
          "fresh_scoring_requires_separate_execution_after_labels",
        ],
        owner: "user_source_confirmation",
        priority: "p0",
        status: "blocked",
      });
      expect(output.nextActions[1]).toMatchObject({
        actionId: "keep_mhas_domain_attribution_as_research_explanation_layer",
        status: "runnable",
      });
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        coefficientsStored: false,
        localFileNamesStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productDisplayAuthorized: false,
        rowParsingPerformedByR1012: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".latest.json");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain(".rar");
      expect(persisted).not.toContain("field_names_private");
      expect(persisted).not.toContain("fit_params_private_only");
      expect(persisted).not.toContain("calibration_params_private_only");
      expect(persisted).not.toContain("model_artifact_manifest_private");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds when the latest MHAS panel result is not supportive", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1012-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { mhasPanelSupportive: false });
      const { output } = await runR1012CrossSourceFunctionConsistency({
        createdAt: "2026-05-13T11:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("function_disability_hold_pending_support");
      expect(output.consistencyState.functionSidecarStatus).toBe("hold_pending_support");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1012-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1012-cross-source-function-consistency.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R986_CROSS_SOURCE_FUNCTION_PATH: paths.r986Path,
          MURPH_AGE_R997_NSHAP_REPLAY_PATH: paths.r997Path,
          MURPH_AGE_R1009_MHAS_FUNCTION_PANEL_RESULT_PATH: paths.r1009Path,
          MURPH_AGE_R1010_MHAS_FUNCTION_PANEL_REVIEWGPT_REDUCTION_PATH: paths.r1010Path,
          MURPH_AGE_R1011_MHAS_FUNCTION_DOMAIN_ATTRIBUTION_PATH: paths.r1011Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "function_disability_lead_sidecar_supported_pending_fresh_nshap",
        currentLeadFamily: "function_disability",
        functionSidecarStatus: "lead_diagnostic_supported_pending_fresh_nshap",
        nextLocalAction: "complete_nshap_source_confirmation_then_run_fresh_function_cognition",
        packetId: "r1012-cross-source-function-consistency",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1012: false,
        schemaVersion: R1012_CROSS_SOURCE_FUNCTION_CONSISTENCY_SCHEMA_VERSION,
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
  options: { mhasPanelSupportive?: boolean } = {},
): Promise<{
  outputDir: string;
  r986Path: string;
  r997Path: string;
  r1009Path: string;
  r1010Path: string;
  r1011Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r986Path: path.join(fixtureDir, "r986.json"),
    r997Path: path.join(fixtureDir, "r997.json"),
    r1009Path: path.join(fixtureDir, "r1009.json"),
    r1010Path: path.join(fixtureDir, "r1010.json"),
    r1011Path: path.join(fixtureDir, "r1011.json"),
  };
  await Promise.all([
    writeJson(paths.r986Path, r986Fixture()),
    writeJson(paths.r997Path, r997Fixture()),
    writeJson(paths.r1009Path, r1009Fixture(options.mhasPanelSupportive !== false)),
    writeJson(paths.r1010Path, r1010Fixture()),
    writeJson(paths.r1011Path, r1011Fixture()),
  ]);
  return paths;
}

function r986Fixture(): Record<string, unknown> {
  return {
    arbitration: {
      sourceSupportSummary: {
        negativeFunctionBrierDeltaCount: 5,
        positiveFunctionCDeltaCount: 5,
        sourceCount: 5,
        supportiveSourceCount: 5,
      },
    },
    artifactBoundary: safeBoundary(),
    packetId: "r986-cross-source-function-arbitration",
    schemaVersion: "murph-age-r986-cross-source-function-arbitration.v1",
    status: "research-local-aggregate-only",
    summary: {
      currentLeadFamily: "function_disability",
      verdict: "function_disability_portable_diagnostic_sidecar_supported",
    },
  };
}

function r997Fixture(): Record<string, unknown> {
  return {
    activationFrame: {
      aggregateOutputsActive: false,
      labelsComplete: false,
    },
    artifactBoundary: safeBoundary(),
    packetId: "r997-strict-nshap-function-cognition-replay",
    schemaVersion: "murph-age-r997-strict-nshap-function-cognition-replay.v1",
    status: "research-local-aggregate-only",
    summary: {
      artifactVerdict: "historical_nshap_aggregate_signal_usable_research_direction_only",
    },
  };
}

function r1009Fixture(supportive: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1009-mhas-function-panel-extension-result",
    schemaVersion: "murph-age-r1009-mhas-function-panel-extension-result.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: supportive
        ? "mhas_function_panel_extension_supports_lead_sidecar"
        : "mhas_function_panel_extension_not_confirmed",
    },
  };
}

function r1010Fixture(): Record<string, unknown> {
  return {
    consensus: {
      function_sidecar_status: "lead_diagnostic",
    },
    counts: { trusted: 5 },
    schema_version: "murph-age-r1010-mhas-function-panel-result-direction-reduction.v1",
  };
}

function r1011Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1011-mhas-function-domain-attribution",
    schemaVersion: "murph-age-r1011-mhas-function-domain-attribution.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "mhas_function_domain_attribution_supportive",
    },
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookProseStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
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
