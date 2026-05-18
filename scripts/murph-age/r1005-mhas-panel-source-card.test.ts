import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1005_MHAS_PANEL_SOURCE_CARD_SCHEMA_VERSION,
  runR1005MhasPanelSourceCard,
} from "./r1005-mhas-panel-source-card.ts";

describe("R1005 MHAS panel source card", () => {
  it("cards the MHAS panel lane as research-only when required aggregate evidence is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1005-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1005MhasPanelSourceCard({
        createdAt: "2026-05-13T05:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1005-mhas-panel-source-card.latest.json");
      expect(output.schemaVersion).toBe(R1005_MHAS_PANEL_SOURCE_CARD_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        conclusion: "mhas_panel_source_card_ready_research_only",
        nextLocalAction: "prepare_mhas_panel_extension_runner_manifest",
        productDisplayAuthorized: false,
        reviewGptNextUse: "aggregate_delta_interpretation_only",
        rowParsingPerformedByR1005: false,
      });
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        codebookProseStored: false,
        codebookTextStored: false,
        coefficientsStored: false,
        localFileNamesStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        modelPromotionAuthorized: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        rowParsingPerformedByR1005: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
      });
      expect(output.sourceCard).toMatchObject({
        sourceFamily: "MHAS/Gateway MHAS",
        benchmarkCard: {
          denominatorId: "mhas-function-disability-followup-v0",
          evidenceClass: "non_us_external_function_disability_diagnostic",
          minimumCellThreshold: 11,
          status: "ready_for_research_panel_extension",
        },
        modelScope: {
          candidateFeatureFamily: "function_limitation_disability_v1",
          frozenAnchorId: "r399_compact_age_nonlinear_l2_0p000",
          leadSidecarStatus: "hardened_research_lead_sidecar",
          referenceFeatureFamily: "age_sex_reference",
        },
        sourceActivation: {
          aggregateOutputLabel: "aggregate_only_with_suppression_confirmed",
          endpointJoinContractReady: true,
          expandedMhasCacheDetected: true,
          localFamilyStatus: "local_join_families_labeled",
          optionalPanelEvidenceBand: "50+",
          sourceRightsLabelsComplete: true,
        },
      });
      expect(output.sourceCard.aggregateResultSummary).toEqual({
        deepDiagnosticVerdict: "function_disability_survives_age_residualized_deep_diagnostic",
        functionAggregateConclusion: "mhas_function_disability_supportive_diagnostic_only",
        functionSupportClassification: "mhas_concordant_supportive_diagnostic_only",
        mhasAnchorIncrementVerdict: "mhas_function_adds_small_increment_over_frozen_anchor",
        rowParsePrivateOnlyAttested: true,
      });
      expect(output.nextLocalBatch.map((item) => item.actionId)).toEqual([
        "prepare_mhas_panel_extension_runner_manifest",
        "complete_nshap_source_unlock",
        "send_mhas_aggregate_delta_to_reviewgpt",
        "keep_glycemia_body_shadow_only",
      ]);
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

  it("holds the source card if ReviewGPT direction is not complete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1005-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { reviewGptExecuteCount: 3 });
      const { output } = await runR1005MhasPanelSourceCard({
        createdAt: "2026-05-13T05:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("mhas_panel_source_card_hold_pending_evidence");
      expect(output.sourceCard.benchmarkCard.status).toBe("hold_pending_required_evidence");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate input egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1005-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r980Path, {
        ...r980Fixture(),
        predictionById: { hidden: 1 },
      });

      await expect(runR1005MhasPanelSourceCard({
        ...paths,
      })).rejects.toThrow("R1005 input r980MhasFunctionDisabilityAggregateReducer failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1005-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1005-mhas-panel-source-card.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_MHAS_JOIN_PROBE_PATH: paths.mhasJoinProbePath,
          MURPH_AGE_MHAS_SOURCE_FEASIBILITY_PATH: paths.mhasSourceFeasibilityPath,
          MURPH_AGE_R614_MHAS_LABELS_PATH: paths.r614MhasPath,
          MURPH_AGE_R979_MHAS_ENDPOINT_JOIN_CONTRACT_PATH: paths.r979Path,
          MURPH_AGE_R980_MHAS_FUNCTION_REDUCER_PATH: paths.r980Path,
          MURPH_AGE_R988_MHAS_ANCHOR_INCREMENT_PATH: paths.r988Path,
          MURPH_AGE_R991_MHAS_DEEP_DIAGNOSTIC_PATH: paths.r991Path,
          MURPH_AGE_R1002_EXPANDED_DATA_RECEIPT_PATH: paths.r1002Path,
          MURPH_AGE_R1003_REVIEWGPT_REDUCTION_PATH: paths.r1003Path,
          MURPH_AGE_R1004_FUNCTION_HARDENING_PATH: paths.r1004Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "mhas_panel_source_card_ready_research_only",
        nextLocalAction: "prepare_mhas_panel_extension_runner_manifest",
        packetId: "r1005-mhas-panel-source-card",
        productDisplayAuthorized: false,
        reviewGptNextUse: "aggregate_delta_interpretation_only",
        rowParsingPerformedByR1005: false,
        schemaVersion: R1005_MHAS_PANEL_SOURCE_CARD_SCHEMA_VERSION,
        sourceFamily: "MHAS/Gateway MHAS",
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
  options: { reviewGptExecuteCount?: number } = {},
): Promise<{
  mhasJoinProbePath: string;
  mhasSourceFeasibilityPath: string;
  outputDir: string;
  r614MhasPath: string;
  r979Path: string;
  r980Path: string;
  r988Path: string;
  r991Path: string;
  r1002Path: string;
  r1003Path: string;
  r1004Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    mhasJoinProbePath: path.join(fixtureDir, "mhas-join-probe.json"),
    mhasSourceFeasibilityPath: path.join(fixtureDir, "mhas-source-feasibility.json"),
    outputDir,
    r614MhasPath: path.join(fixtureDir, "r614.json"),
    r979Path: path.join(fixtureDir, "r979.json"),
    r980Path: path.join(fixtureDir, "r980.json"),
    r988Path: path.join(fixtureDir, "r988.json"),
    r991Path: path.join(fixtureDir, "r991.json"),
    r1002Path: path.join(fixtureDir, "r1002.json"),
    r1003Path: path.join(fixtureDir, "r1003.json"),
    r1004Path: path.join(fixtureDir, "r1004.json"),
  };

  await Promise.all([
    writeJson(paths.mhasJoinProbePath, aggregateFixture("mhas-harmonized-eol-aggregate-join-probe", "murph-age-mhas-join-probe.v1")),
    writeJson(paths.mhasSourceFeasibilityPath, aggregateFixture("mhas-harmonized-eol-source-feasibility", "murph-age-mhas-source-feasibility.v1")),
    writeJson(paths.r614MhasPath, r614Fixture()),
    writeJson(paths.r979Path, r979Fixture()),
    writeJson(paths.r980Path, r980Fixture()),
    writeJson(paths.r988Path, {
      ...aggregateFixture("r988-mhas-anchor-function-increment-check", "murph-age-r988-mhas-anchor-function-increment-check.v1"),
      summary: {
        verdict: "mhas_function_adds_small_increment_over_frozen_anchor",
      },
    }),
    writeJson(paths.r991Path, {
      ...aggregateFixture("r991-mhas-deep-diagnostic-reducer", "murph-age-r991-mhas-deep-diagnostic-reducer.v1"),
      executionEvidence: {
        rowParseExecutedPrivateOnly: true,
      },
      summary: {
        verdict: "function_disability_survives_age_residualized_deep_diagnostic",
      },
    }),
    writeJson(paths.r1002Path, r1002Fixture()),
    writeJson(paths.r1003Path, r1003Fixture(options.reviewGptExecuteCount ?? 5)),
    writeJson(paths.r1004Path, r1004Fixture()),
  ]);
  return paths;
}

function r614Fixture() {
  return {
    ...aggregateFixture("r614-mhas-source-rights-activation-labels", "murph-age-r614-mhas-source-rights-activation-labels.v1"),
    joinFamilyActivation: {
      localFamilyStatus: "local_join_families_labeled",
    },
    sourceRightsActivationLabels: {
      aggregateOutputLabel: "aggregate_only_with_suppression_confirmed",
    },
    summary: {
      endpointJoinContractReady: true,
      sourceRightsLabelsComplete: true,
    },
  };
}

function r979Fixture() {
  return {
    ...aggregateFixture("r979-mhas-endpoint-join-contract", "murph-age-r979-mhas-endpoint-join-contract.v1"),
    benchmarkContract: {
      abstentionCriteria: ["missing_endpoint_status_role_family"],
      allowedMetricFamilies: ["auc", "brier", "log_loss"],
      evidenceClass: "non_us_external_function_disability_diagnostic",
      exposureLabel: "diagnostic-only",
      minimumCellThreshold: 11,
    },
    denominatorPolicy: {
      candidateComparisonPolicy: "same_denominator_age_sex_vs_function_disability",
      denominatorId: "mhas-function-disability-followup-v0",
    },
    featureContract: {
      blockedFamilies: ["activity_or_wearable_proxy", "biomarker_increment"],
      candidateFeatureFamily: "function_limitation_disability_v1",
      referenceFeatureFamily: "age_sex_reference",
    },
    splitCalibrationPolicy: {
      splitPolicy: "deterministic_hash_split_no_endpoint_or_score_input",
    },
    summary: {
      conclusion: "mhas_endpoint_join_contract_locked_next_reducer_ready",
    },
  };
}

function r980Fixture() {
  return {
    ...aggregateFixture(
      "r980-mhas-function-disability-aggregate-reducer",
      "murph-age-r980-mhas-function-disability-aggregate-reducer.v1",
    ),
    aggregateResult: {
      supportClassification: "mhas_concordant_supportive_diagnostic_only",
    },
    executionReceipt: {
      rowParseExecutedPrivateOnly: true,
    },
    summary: {
      conclusion: "mhas_function_disability_supportive_diagnostic_only",
    },
  };
}

function r1002Fixture() {
  return {
    ...aggregateFixture(
      "r1002-expanded-data-function-hardening-receipt",
      "murph-age-r1002-expanded-data-function-hardening-receipt.v1",
    ),
    expandedDataInventory: {
      sourceAvailability: [
        {
          family: "MHAS/Gateway MHAS",
          optionalPanelEvidenceBand: "50+",
        },
      ],
    },
    summary: {
      expandedMhasCacheDetected: true,
    },
  };
}

function r1003Fixture(executeCount: number) {
  return {
    aggregateCounts: {
      sourceDecisionCounts: {
        "MHAS/Gateway MHAS:execute_now": executeCount,
      },
    },
    schema_version: "murph-age-r1003-expanded-source-strategy-reduction.v1",
    status: "complete",
  };
}

function r1004Fixture() {
  return {
    ...aggregateFixture(
      "r1004-function-sidecar-hardening-receipt",
      "murph-age-r1004-function-sidecar-hardening-receipt.v1",
    ),
    functionSidecar: {
      status: "hardened_research_lead_sidecar",
    },
    summary: {
      currentLead: "r399_anchor_plus_function_disability_hardened_sidecar",
    },
  };
}

function aggregateFixture(packetId: string, schemaVersion: string): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId,
    schemaVersion,
    status: "research-local-aggregate-only",
  };
}

function safeBoundary() {
  return {
    aggregateOnly: true,
    codebookProseStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    joinKeyValuesStored: false,
    localFileNamesStored: false,
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
    recommendationClaimsIncluded: false,
    rowParsingPerformed: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    variableLabelsStored: false,
    variableNamesStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
