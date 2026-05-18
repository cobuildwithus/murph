import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1011_MHAS_FUNCTION_DOMAIN_ATTRIBUTION_SCHEMA_VERSION,
  runR1011MhasFunctionDomainAttribution,
} from "./r1011-mhas-function-domain-attribution.ts";

describe("R1011 MHAS function domain attribution", () => {
  it("creates a research-only function/mobility attribution receipt", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1011-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1011MhasFunctionDomainAttribution({
        createdAt: "2026-05-13T10:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1011-mhas-function-domain-attribution.latest.json");
      expect(output.schemaVersion).toBe(R1011_MHAS_FUNCTION_DOMAIN_ATTRIBUTION_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "mhas_function_domain_attribution_supportive",
        nextLocalAction: "use_as_mhas_domain_attribution_receipt_then_unlock_nshap_if_user_confirms_source_labels",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1011: false,
      });
      expect(output.domainAttribution).toMatchObject({
        attributionUse: "research_explanation_only_not_user_facing",
        domainFamily: "function_mobility",
        supportiveBaseCount: 2,
        verdict: "function_mobility_domain_supports_research_sidecar",
      });
      expect(output.domainAttribution.rows).toHaveLength(2);
      expect(output.domainAttribution.rows[0]).toMatchObject({
        baseLabel: "activity_candidate",
        verdict: "function_domain_supportive_on_same_denominator",
      });
      expect(output.domainAttribution.rows[0]?.functionMinusIntercept.brier).toBeCloseTo(-0.0007700511688751577);
      expect(output.domainAttribution.rows[0]?.functionMinusIntercept.cStatistic).toBeCloseTo(0.0022625305317865996);
      expect(output.domainAttribution.rows[0]?.functionMinusIntercept.logLoss).toBeCloseTo(-0.0019587838382489897);
      expect(output.domainAttribution.rows[0]?.functionMinusShuffle.brier).toBeCloseTo(-0.0008170330470562148);
      expect(output.domainAttribution.rows[0]?.functionMinusShuffle.cStatistic).toBeCloseTo(0.0030869345781695534);
      expect(output.domainAttribution.rows[0]?.functionMinusShuffle.logLoss).toBeCloseTo(-0.0021022517906016946);
      expect(output.domainAttribution.rows[0]).toMatchObject({
        functionMinusIntercept: {
          observedExpectedAbsDistance: -0.0033718772595436874,
        },
      });
      expect(output.consensusContext).toEqual({
        r1010Decision: "run_nshap_function_cognition_activation",
        r1010FirstLoop: "nshap_function_cognition_activation",
        r1010TrustedReviewerCount: 5,
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
        rowParsingPerformedByR1011: false,
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

  it("holds when the panel result was not supportive", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1011-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { panelSupportive: false });
      const { output } = await runR1011MhasFunctionDomainAttribution({
        createdAt: "2026-05-13T10:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("mhas_function_domain_attribution_not_confirmed");
      expect(output.domainAttribution.verdict).toBe("function_mobility_domain_attribution_hold");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1011-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1011-mhas-function-domain-attribution.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1009_MHAS_FUNCTION_PANEL_RESULT_PATH: paths.r1009Path,
          MURPH_AGE_R1010_MHAS_FUNCTION_PANEL_REVIEWGPT_REDUCTION_PATH: paths.r1010Path,
          MURPH_AGE_R731_MHAS_FUNCTION_PANEL_REPORT_PATH: paths.r731ReportPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "mhas_function_domain_attribution_supportive",
        domainFamily: "function_mobility",
        nextLocalAction: "use_as_mhas_domain_attribution_receipt_then_unlock_nshap_if_user_confirms_source_labels",
        packetId: "r1011-mhas-function-domain-attribution",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1011: false,
        schemaVersion: R1011_MHAS_FUNCTION_DOMAIN_ATTRIBUTION_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        supportiveBaseCount: 2,
        verdict: "function_mobility_domain_supports_research_sidecar",
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
  options: { panelSupportive?: boolean } = {},
): Promise<{
  outputDir: string;
  r1009Path: string;
  r1010Path: string;
  r731ReportPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r1009Path: path.join(fixtureDir, "r1009.json"),
    r1010Path: path.join(fixtureDir, "r1010.json"),
    r731ReportPath: path.join(fixtureDir, "r731-report.json"),
  };
  await Promise.all([
    writeJson(paths.r1009Path, r1009Fixture(options.panelSupportive !== false)),
    writeJson(paths.r1010Path, r1010Fixture()),
    writeJson(paths.r731ReportPath, r731ReportFixture()),
  ]);
  return paths;
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
      decision: "run_nshap_function_cognition_activation",
      first_loop: "nshap_function_cognition_activation",
    },
    counts: { trusted: 5 },
    schema_version: "murph-age-r1010-mhas-function-panel-result-direction-reduction.v1",
  };
}

function r731ReportFixture(): Record<string, unknown> {
  return {
    holdout_results: [
      holdout("activity_candidate", "function_mobility_additive_diagnostic", 0.1434356654036126, 0.4533289773239182, 0.762181081098406, 1.0175289743618834),
      holdout("activity_candidate", "source_intercept_only_same_denominator", 0.14420571657248776, 0.4552877611621672, 0.7599185505666194, 1.020900851621427),
      holdout("activity_candidate", "shuffled_function_negative_control", 0.14425269845066882, 0.4554312291145199, 0.7590941465202364, 1.0205312955074577),
      holdout("current_adapter_activity_missing", "function_mobility_additive_diagnostic", 0.14317578992686214, 0.4530871775409239, 0.7625742772836295, 1.0169821191278734),
      holdout("current_adapter_activity_missing", "source_intercept_only_same_denominator", 0.1442693357021567, 0.4557827442106379, 0.7595273123581185, 1.0217600053527431),
      holdout("current_adapter_activity_missing", "shuffled_function_negative_control", 0.14432123589636742, 0.4558943562405802, 0.7588296016379271, 1.021381602408594),
    ],
    rankings: {
      method_deltas_vs_intercept: [
        {
          base_id: "activity_candidate",
          method_id: "function_mobility_additive_diagnostic",
          observed_expected_abs_distance_delta_vs_intercept: -0.0033718772595436874,
        },
        {
          base_id: "current_adapter_activity_missing",
          method_id: "function_mobility_additive_diagnostic",
          observed_expected_abs_distance_delta_vs_intercept: -0.004777886224869743,
        },
      ],
    },
    run_id: "session_murph_age_r731_mhas_function_mobility_transport_diagnostic",
    schema_version: "murph.age.autoresearch.mhas-function-mobility-transport-diagnostic.r731.v0",
  };
}

function holdout(
  baseId: string,
  methodId: string,
  brier: number,
  logLoss: number,
  cStatistic: number,
  observedExpectedRatio: number,
): Record<string, unknown> {
  return {
    base_id: baseId,
    method_id: methodId,
    weighted_holdout_metrics: {
      brier_score: brier,
      c_statistic: cStatistic,
      log_loss: logLoss,
      observed_expected_ratio: observedExpectedRatio,
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
