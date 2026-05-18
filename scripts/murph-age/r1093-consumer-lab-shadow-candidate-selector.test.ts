import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1093ConsumerLabShadowCandidateSelector } from "./r1093-consumer-lab-shadow-candidate-selector.ts";

describe("R1093 consumer lab shadow candidate selector", () => {
  it("selects a common lab core shadow candidate when lab and quality gates agree", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1093-"));
    const paths = await writeFixtures(tmp);

    const { output } = await runR1093ConsumerLabShadowCandidateSelector({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "common_lab_shadow_candidate_selected_not_promoted",
      nextLocalAction: "keep_lab_candidate_shadow_and_seek_external_replication",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1093: false,
    });
    expect(output.selection).toMatchObject({
      candidateId: "common_lab_core_shadow",
      selectedForNextShadowRun: true,
    });
    expect(output.selection.evidence.nhanesLab5VsBpBody).toMatchObject({
      brierDelta: -0.02,
      logLossDelta: -0.03,
      verdict: "improves_both_proper_scores",
    });
    expect(output.selection.evidence.nhanesCoverageQualityVsLab9.verdict).toBe("not_clean");
    expect(output.selection.featureFamilyEmphasis).toEqual([
      "glycemia_hba1c_glucose",
      "blood_pressure_vitals",
      "body_composition",
      "cbc_or_basic_chemistry_context",
      "lipids_secondary_controlled",
    ]);
  });

  it("does not select when hardening state is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1093-"));
    const paths = await writeFixtures(tmp, { hardeningReady: false });

    const { output } = await runR1093ConsumerLabShadowCandidateSelector({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "lab_shadow_candidate_blocked_missing_or_unclean",
      nextLocalAction: "repair_lab_control_hardening_inputs",
    });
    expect(output.selection.selectedForNextShadowRun).toBe(false);
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1093-"));
    const r1038Path = path.join(tmp, "unsafe.json");
    await writeJson(r1038Path, {
      packetId: "r1038-nhanes-modern-lab-activity-loop",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1038-nhanes-modern-lab-activity-loop.v1",
    });

    await expect(runR1093ConsumerLabShadowCandidateSelector({
      outputDir: path.join(tmp, "out"),
      r1038Path,
    })).rejects.toThrow("R1093 rejected unsafe r1038 input");
  });
});

async function writeFixtures(
  tmp: string,
  options: { hardeningReady?: boolean } = {},
): Promise<{
  r1038Path: string;
  r1044Path: string;
  r1092Path: string;
}> {
  const paths = {
    r1038Path: path.join(tmp, "r1038.json"),
    r1044Path: path.join(tmp, "r1044.json"),
    r1092Path: path.join(tmp, "r1092.json"),
  };
  const hardeningReady = options.hardeningReady ?? true;

  await Promise.all([
    writeJson(paths.r1038Path, {
      artifactBoundary: safeBoundary(),
      candidateRuns: [
        run("R1_age_sex_bp_body_reference", null, 0.1, 0.2, 0.7),
        run("C1_lab5_hba1c_bp_body", "R1_age_sex_bp_body_reference", 0.08, 0.17, 0.74),
        run("C3_lab9_hba1c_bp_body_primary", "R1_age_sex_bp_body_reference", 0.075, 0.16, 0.76),
        run("N1_coverage_quality_only_negative_control", "C3_lab9_hba1c_bp_body_primary", 0.076, 0.161, 0.759),
      ],
      packetId: "r1038-nhanes-modern-lab-activity-loop",
      schemaVersion: "murph-age-r1038-nhanes-modern-lab-activity-loop.v1",
    }),
    writeJson(paths.r1044Path, {
      artifactBoundary: safeBoundary(),
      models: {
        A3_glucose_body_hemoglobin: {
          deltasVsAgeSexReference: { brierDelta: -0.002, logLossDelta: -0.006 },
        },
        B1_glucose_lipid_body_no_crp: {
          deltasVsAgeSexReference: { brierDelta: 0.001, logLossDelta: -0.001 },
        },
        NC6_missingness_quality_only: {
          deltasVsAgeSexReference: { brierDelta: -0.0002, logLossDelta: -0.0002 },
        },
      },
      packetId: "r1044-haalsi-external-biomarker-loop",
      schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
    }),
    writeJson(paths.r1092Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1092-consumer-bloodwork-control-hardening",
      schemaVersion: "murph-age-r1092-consumer-bloodwork-control-hardening.v1",
      summary: {
        conclusion: hardeningReady
          ? "bloodwork_shadow_loop_control_limited_keep_glycemia_lead"
          : "bloodwork_shadow_loop_missing_consumer_state",
      },
    }),
  ]);

  return paths;
}

function run(candidateId: string, comparatorId: string | null, brier: number, logLoss: number, auc: number): Record<string, unknown> {
  return {
    candidateId,
    comparatorId,
    splitMetrics: {
      test: {
        auc,
        brier,
        eventCountBand: "10-99",
        logLoss,
        nBand: "100-999",
      },
    },
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
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
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
