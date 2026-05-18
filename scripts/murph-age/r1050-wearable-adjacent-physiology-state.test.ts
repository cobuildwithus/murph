import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1050_WEARABLE_ADJACENT_PHYSIOLOGY_STATE_SCHEMA_VERSION,
  runR1050WearableAdjacentPhysiologyState,
} from "./r1050-wearable-adjacent-physiology-state.ts";

describe("R1050 wearable-adjacent physiology state", () => {
  it("keeps pulse/RHR-style physiology as a mixed shadow candidate", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1050-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1050WearableAdjacentPhysiologyState({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1050-wearable-adjacent-physiology-state.latest.json");
      expect(output.schemaVersion).toBe(R1050_WEARABLE_ADJACENT_PHYSIOLOGY_STATE_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.pulsePhysiology.supportCounts).toEqual({
        cleanSupport: 2,
        controlLimited: 1,
        negativeOrMissing: 0,
      });
      expect(output.pulsePhysiology.sourceDiagnostics.haalsi_w1_to_w3?.status).toBe("clean_pulse_separation");
      expect(output.pulsePhysiology.sourceDiagnostics.nshap_w1_to_w3?.status).toBe("clean_pulse_separation");
      expect(output.pulsePhysiology.sourceDiagnostics.nshap_w2_to_w3?.status).toBe("pulse_signal_control_limited");
      expect(output.objectiveActivityContext.status).toBe("shadow_supported_calibration_limited");
      expect(output.summary.currentWearableAdjacentLead).toBe("objective_activity_plus_pulse_shadow");
      expect(output.decision).toEqual({
        conclusion: "pulse_rhr_shadow_signal_mixed_control_limited",
        nextAction: "build_partner_integrated_wearable_evaluator_before_any_score_bearing_pulse_use",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rationale: "Pulse/RHR-style physiology has aggregate support, but at least one source has competing controls and none are true consumer wearable validation.",
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"sourceText\"");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("emits a missing-input state without parsing rows", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1050-missing-"));
    try {
      const { output } = await runR1050WearableAdjacentPhysiologyState({
        outputDir: tmp,
        r1044Path: path.join(tmp, "missing-r1044.json"),
        r1046Path: path.join(tmp, "missing-r1046.json"),
        r1049Path: path.join(tmp, "missing-r1049.json"),
      });

      expect(output.inputArtifacts.r1044Haalsi.status).toBe("missing");
      expect(output.inputArtifacts.r1046Nshap.status).toBe("missing");
      expect(output.inputArtifacts.r1049NhanesActivity.status).toBe("missing");
      expect(output.decision.conclusion).toBe("pulse_rhr_inputs_missing");
      expect(output.artifactBoundary.rowValuesStored).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks unsafe aggregate input", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1050-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r1044Path, {
        ...haalsiFixture(),
        rowValues: [{ notAllowed: true }],
      });

      await expect(runR1050WearableAdjacentPhysiologyState(paths)).rejects.toThrow(
        "R1050 input r1044Haalsi failed aggregate boundary validation",
      );
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo unsafe packet IDs, schema strings, or candidate keys", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1050-keys-"));
    try {
      const baseHaalsi = haalsiFixture();
      const baseModels = baseHaalsi.models as Record<string, unknown>;
      const paths = await writeFixtureArtifacts(tmp, {
        haalsiPatch: {
          models: {
            ...baseModels,
            [`${tmp}/candidate-key`]: model("pulse_shadow", "beats_age_sex", -1, -1),
          },
          packetId: `${tmp}/packet`,
          schemaVersion: `${tmp}/schema`,
        },
        nshapPatch: {
          packetId: `${tmp}/packet`,
          schemaVersion: `${tmp}/schema`,
        },
      });
      const { output, outputPath } = await runR1050WearableAdjacentPhysiologyState(paths);
      const persisted = await readFile(outputPath, "utf8");

      expect(output.inputArtifacts.r1044Haalsi.packetId).toBeNull();
      expect(output.inputArtifacts.r1044Haalsi.schemaVersion).toBeNull();
      expect(output.inputArtifacts.r1046Nshap.packetId).toBeNull();
      expect(persisted).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1050-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1050-wearable-adjacent-physiology-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1044_HAALSI_PATH: paths.r1044Path,
          MURPH_AGE_R1046_NSHAP_PATH: paths.r1046Path,
          MURPH_AGE_R1049_ACTIVITY_PATH: paths.r1049Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r1050-wearable-adjacent-physiology-state.latest.json",
        conclusion: "pulse_rhr_shadow_signal_mixed_control_limited",
        currentWearableAdjacentLead: "objective_activity_plus_pulse_shadow",
        nextAction: "build_partner_integrated_wearable_evaluator_before_any_score_bearing_pulse_use",
        packetId: "r1050-wearable-adjacent-physiology-state",
        productDisplayAuthorized: false,
        reviewGptRequiredBeforeNextLocalRun: false,
        schemaVersion: R1050_WEARABLE_ADJACENT_PHYSIOLOGY_STATE_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        supportCounts: {
          cleanSupport: 2,
          controlLimited: 1,
          negativeOrMissing: 0,
        },
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  patches: {
    activityPatch?: Record<string, unknown>;
    haalsiPatch?: Record<string, unknown>;
    nshapPatch?: Record<string, unknown>;
  } = {},
): Promise<{
  outputDir: string;
  r1044Path: string;
  r1046Path: string;
  r1049Path: string;
}> {
  const outputDir = path.join(tmp, "out");
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r1044Path: path.join(tmp, "r1044.json"),
    r1046Path: path.join(tmp, "r1046.json"),
    r1049Path: path.join(tmp, "r1049.json"),
  };
  await writeJson(paths.r1044Path, {
    ...haalsiFixture(),
    ...patches.haalsiPatch,
  });
  await writeJson(paths.r1046Path, {
    ...nshapFixture(),
    ...patches.nshapPatch,
  });
  await writeJson(paths.r1049Path, {
    ...activityFixture(),
    ...patches.activityPatch,
  });
  return paths;
}

function haalsiFixture(): Record<string, unknown> {
  return {
    artifactBoundary: boundaryFixture(),
    models: {
      P1_pulse_only: model("pulse_shadow", "beats_age_sex", -0.0012, -0.0028),
      P2_glucose_pulse: model("pulse_shadow", "beats_age_sex", -0.0018, -0.0045),
      P3_glucose_body_pulse: model("pulse_shadow", "beats_age_sex", -0.0015, -0.0038),
      NC2_body_only_without_glucose: model("negative_control", "does_not_beat_age_sex", 0.0002, 0.0006),
      NC3_lipid_body_without_glucose: model("negative_control", "does_not_beat_age_sex", 0.0011, 0.0031),
      NC5_noise_feature: model("negative_control", "does_not_beat_age_sex", 0.0002, 0.0007),
    },
    packetId: "r1044-haalsi-external-biomarker-loop",
    schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
    status: "research-local-aggregate-only",
  };
}

function nshapFixture(): Record<string, unknown> {
  return {
    artifactBoundary: boundaryFixture(),
    packetId: "r1046-nshap-hba1c-replication-loop",
    schemaVersion: "murph-age-r1046-nshap-hba1c-replication-loop.v1",
    sources: {
      nshap_w1_to_w3: {
        models: {
          P1_pulse_only: model("pulse_shadow", "beats_age_sex", -0.0013, -0.005),
          P2_hba1c_pulse: model("pulse_shadow", "beats_age_sex", -0.0021, -0.0067),
          P3_hba1c_body_pulse: model("pulse_shadow", "beats_age_sex", -0.0016, -0.0046),
          NC2_body_only_without_hba1c: model("negative_control", "does_not_beat_age_sex", 0.0005, 0.0017),
          NC5_noise_feature: model("negative_control", "does_not_beat_age_sex", 0.00003, 0.0002),
        },
      },
      nshap_w2_to_w3: {
        models: {
          P1_pulse_only: model("pulse_shadow", "beats_age_sex", -0.0008, -0.0053),
          P2_hba1c_pulse: model("pulse_shadow", "beats_age_sex", -0.0011, -0.0066),
          P3_hba1c_body_pulse: model("pulse_shadow", "beats_age_sex", -0.0021, -0.0099),
          NC2_body_only_without_hba1c: model("negative_control", "beats_age_sex", -0.0006, -0.0021),
          NC5_noise_feature: model("negative_control", "beats_age_sex", -0.0002, -0.0002),
        },
      },
    },
    status: "research-local-aggregate-only",
  };
}

function activityFixture(): Record<string, unknown> {
  return {
    artifactBoundary: boundaryFixture(),
    decision: {
      conclusion: "nhanes_activity_signal_control_clean_global_calibration_limited",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
    },
    packetId: "r1049-nhanes-activity-control-diagnostic",
    schemaVersion: "murph-age-r1049-nhanes-activity-control-diagnostic.v1",
    shadowCarryForward: {
      activityCandidate: "C8_lab9_hba1c_bp_body_activity_primary",
    },
    status: "research-local-aggregate-only",
  };
}

function model(
  candidateRole: string,
  verdict: string,
  brierDelta: number,
  logLossDelta: number,
): Record<string, unknown> {
  return {
    candidateRole,
    deltasVsAgeSexReference: {
      brierDelta,
      logLossDelta,
    },
    verdict,
  };
}

function boundaryFixture(): Record<string, false | true> {
  return {
    aggregateOnly: true,
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
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
