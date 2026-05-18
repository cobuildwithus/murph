import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1000_CURRENT_ACCELERATION_STATE_SCHEMA_VERSION,
  runR1000CurrentAccelerationState,
} from "./r1000-current-acceleration-state.ts";

describe("R1000 current acceleration state", () => {
  it("summarizes the current lead model direction and next local batch", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1000-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1000CurrentAccelerationState({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1000-current-acceleration-state.latest.json");
      expect(output.schemaVersion).toBe(R1000_CURRENT_ACCELERATION_STATE_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        currentLead: "r399_anchor_plus_function_disability_sidecar",
        nextLocalAction: "harden_function_disability_sidecar",
        productDisplayAuthorized: false,
        whyNotBroadLabs: "transport_not_confirmed",
        whyNotWearables: "shadow_context_only",
      });
      expect(output.currentModel).toMatchObject({
        anchor: "frozen_nhis_r399_anchor",
        sidecar: "function_disability_lead_diagnostic",
        broadLabsPolicy: "kill_for_now",
        productDisplay: "blocked",
      });
      expect(output.evidence.functionDisability).toMatchObject({
        crossSourceVerdict: "function_disability_portable_diagnostic_sidecar_supported",
        mhasEndpointReady: true,
        mhasFastLoopReady: true,
        nshapFreshScoringUnlocked: false,
        nshapHistoricalReplayUsable: true,
        supportiveSourceCountBand: "5-9",
      });
      expect(output.evidence.biomarkerTransport).toMatchObject({
        crelesGlycemiaVerdict: "keep_tiny_glycemia_only_and_glycemia_body_for_future_external_validation",
        r399BiomarkerTransportConfirmed: false,
        transportReadiness: "transport_signal_not_confirmed",
      });
      expect(output.evidence.reviewGptDirection).toEqual({
        firstLoop: "cross_source_function_arbitration",
        pendingCount: 2,
        trustedCount: 1,
        useRole: "major_result_interpretation_only",
      });
      expect(output.nextAutoresearchBatch.map((item) => item.actionId)).toEqual([
        "harden_function_disability_sidecar",
        "complete_nshap_activation_or_keep_historical_replay_only",
        "keep_glycemia_body_shadow_falsification_small",
        "review_meaningful_result_deltas",
      ]);
      expect(output.nextAutoresearchBatch.every((item) => item.reviewGptRequiredBeforeRunning === false)).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("cache-entry-a");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"sourceBodies\": true");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps the CLI summary pathless", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1000-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1000-current-acceleration-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R399_LAYERING_READINESS_PATH: paths.r399Path,
          MURPH_AGE_R603_TRANSPORT_READINESS_PATH: paths.r603Path,
          MURPH_AGE_R614_MHAS_ACTIVATION_LABELS_PATH: paths.r614MhasPath,
          MURPH_AGE_R614_NSHAP_ACTIVATION_LABELS_PATH: paths.r614NshapPath,
          MURPH_AGE_R615_CROSS_SOURCE_MATRIX_PATH: paths.r615Path,
          MURPH_AGE_R978_FAST_LOOP_PRIORITY_PATH: paths.r978Path,
          MURPH_AGE_R986_FUNCTION_ARBITRATION_PATH: paths.r986Path,
          MURPH_AGE_R987_GLYCEMIA_RECEIPT_PATH: paths.r987Path,
          MURPH_AGE_R994_SOURCE_CACHE_READINESS_PATH: paths.r994Path,
          MURPH_AGE_R995_SIDECAR_ARBITRATION_PATH: paths.r995Path,
          MURPH_AGE_R997_STRICT_NSHAP_REPLAY_PATH: paths.r997Path,
          MURPH_AGE_R998_CURRENT_SOURCE_LOOP_PATH: paths.r998Path,
          MURPH_AGE_R999_REVIEWGPT_REDUCTION_PATH: paths.r999Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        currentLead: "r399_anchor_plus_function_disability_sidecar",
        nextLocalAction: "harden_function_disability_sidecar",
        packetId: "r1000-current-acceleration-state",
        productDisplayAuthorized: false,
        reviewGptTrustedCount: 1,
        schemaVersion: R1000_CURRENT_ACCELERATION_STATE_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        whyNotBroadLabs: "transport_not_confirmed",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("cache-entry-a");
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");

      const persisted = await readFile(path.join(paths.outputDir, "r1000-current-acceleration-state.latest.json"), "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("cache-entry-a");
      expect(findForbiddenAggregateEgress(JSON.parse(persisted))).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate input egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1000-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r987Path, {
        ...aggregateFixture("r987-creles-glycemia-receipt-reducer"),
        coefficients: [1, 2, 3],
      });

      await expect(runR1000CurrentAccelerationState({
        ...paths,
      })).rejects.toThrow("R1000 input r987CrelesGlycemia failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
): Promise<{
  outputDir: string;
  r399Path: string;
  r603Path: string;
  r614MhasPath: string;
  r614NshapPath: string;
  r615Path: string;
  r978Path: string;
  r986Path: string;
  r987Path: string;
  r994Path: string;
  r995Path: string;
  r997Path: string;
  r998Path: string;
  r999Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r399Path: path.join(fixtureDir, "r399.json"),
    r603Path: path.join(fixtureDir, "r603.json"),
    r614MhasPath: path.join(fixtureDir, "r614-mhas.json"),
    r614NshapPath: path.join(fixtureDir, "r614-nshap.json"),
    r615Path: path.join(fixtureDir, "r615.json"),
    r978Path: path.join(fixtureDir, "r978.json"),
    r986Path: path.join(fixtureDir, "r986.json"),
    r987Path: path.join(fixtureDir, "r987.json"),
    r994Path: path.join(fixtureDir, "r994.json"),
    r995Path: path.join(fixtureDir, "r995.json"),
    r997Path: path.join(fixtureDir, "r997.json"),
    r998Path: path.join(fixtureDir, "r998.json"),
    r999Path: path.join(fixtureDir, "r999.json"),
  };

  await Promise.all([
    writeJson(paths.r399Path, {
      ...aggregateFixture("r399-layering-readiness"),
      gates: {
        biomarkerTransportConfirmed: { status: "blocked" },
      },
    }),
    writeJson(paths.r603Path, {
      ...aggregateFixture("r603-creles-transport-readiness"),
      conclusion: "transport_signal_not_confirmed",
    }),
    writeJson(paths.r614MhasPath, {
      ...aggregateFixture("r614-mhas-source-rights-activation-labels"),
      summary: {
        endpointJoinContractReady: true,
        productPromotionAuthorized: false,
      },
    }),
    writeJson(paths.r614NshapPath, {
      ...aggregateFixture("r614-nshap-activation-labels"),
      rowExecutionReadiness: {
        rowExecutionUnlocked: false,
      },
      summary: {
        aggregateOutputsActive: false,
        productPromotionAuthorized: false,
      },
    }),
    writeJson(paths.r615Path, {
      ...aggregateFixture("r615-cross-source-activation-matrix"),
      summary: {
        nextPrimaryLocalAction: "draft_locked_mhas_endpoint_join_contract",
        productDisplayAuthorized: false,
      },
    }),
    writeJson(paths.r978Path, {
      ...aggregateFixture("r978-fast-loop-priority-reducer"),
      summary: {
        nextLoopId: "mhas-function-disability-fast-loop",
        productDisplayAuthorized: false,
      },
    }),
    writeJson(paths.r986Path, {
      ...aggregateFixture("r986-cross-source-function-arbitration"),
      arbitration: {
        functionDisabilityVerdict: "portable_diagnostic_sidecar_supported",
        sourceSupportSummary: {
          supportiveSourceCount: 5,
        },
      },
      summary: {
        productDisplayAuthorized: false,
        verdict: "function_disability_portable_diagnostic_sidecar_supported",
      },
    }),
    writeJson(paths.r987Path, {
      ...aggregateFixture("r987-creles-glycemia-receipt-reducer"),
      keyArtifactVerdict: "keep_tiny_glycemia_only_and_glycemia_body_for_future_external_validation",
    }),
    writeJson(paths.r994Path, {
      ...aggregateFixture("r994-expanded-source-cache-readiness"),
      fastestLaneNow: "MHAS/Gateway MHAS",
      scoreBearingComplete: ["MIDUS core/refresher", "CRELES waves"],
    }),
    writeJson(paths.r995Path, {
      ...aggregateFixture("r995-sidecar-evidence-arbitration"),
      summary: {
        nextLoop: "cached_nshap_function_cognition_falsification",
        productDisplayAuthorized: false,
      },
    }),
    writeJson(paths.r997Path, {
      ...aggregateFixture("r997-strict-nshap-function-cognition-replay"),
      artifactVerdict: "historical_nshap_aggregate_signal_usable_research_direction_only",
    }),
    writeJson(paths.r998Path, {
      ...aggregateFixture("r998-current-source-loop-decision"),
      summary: {
        nextLoop: "run_interpret_score_bearing_midus_creles_mhas_and_prepare_source_cards",
        productDisplayAuthorized: false,
      },
    }),
    writeJson(paths.r999Path, {
      schema_version: "murph-age-r999-new-data-acceleration-direction-reduction.v1",
      consensus: {
        firstLoop: "cross_source_function_arbitration",
      },
      counts: {
        pending: 2,
        trusted: 1,
      },
      storageAttestation: {
        participantIdsStored: false,
        predictionsOrCoefficientsStored: false,
        productClaimsAuthorized: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
      },
    }),
  ]);
  return paths;
}

function aggregateFixture(packetId: string): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId,
    schemaVersion: `test-${packetId}`,
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
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
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceProseStored: false,
    splitMembershipStored: false,
    variableLabelsStored: false,
    variableListsStored: false,
    variableNamesStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
