import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1092ConsumerBloodworkControlHardening } from "./r1092-consumer-bloodwork-control-hardening.ts";

describe("R1092 consumer bloodwork control hardening", () => {
  it("keeps glycemia as a shadow lead while blocking promotion behind controls", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1092-"));
    const paths = await writeFixtures(tmp);

    const { output } = await runR1092ConsumerBloodworkControlHardening({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "bloodwork_shadow_loop_control_limited_keep_glycemia_lead",
      nextLocalAction: "run_next_lab_candidate_as_shadow_with_missingness_controls",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1092: false,
    });
    expect(output.bloodworkControlHardening.cohortEvidence.map((item) => item.status)).toEqual([
      "clean_support",
      "control_limited",
      "control_limited",
      "control_limited",
    ]);
    expect(output.bloodworkControlHardening.familyDecisions.find((item) =>
      item.featureFamilyId === "glycemia_hba1c_glucose"
    )).toMatchObject({
      decision: "shadow_candidate_supported_one_source",
      modelUse: "next_shadow_candidate",
    });
    expect(output.bloodworkControlHardening.familyDecisions.find((item) =>
      item.featureFamilyId === "body_composition"
    )).toMatchObject({
      decision: "negative_control_or_context_only",
      modelUse: "control_hardening_only",
    });
  });

  it("stays blocked when the consumer loop state is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1092-"));

    const { output } = await runR1092ConsumerBloodworkControlHardening({
      outputDir: path.join(tmp, "out"),
      r1091Path: path.join(tmp, "missing-r1091.json"),
    });

    expect(output.summary).toMatchObject({
      conclusion: "bloodwork_shadow_loop_missing_consumer_state",
      nextLocalAction: "repair_consumer_input_loop_state",
    });
    expect(output.bloodworkControlHardening.familyDecisions.every((item) =>
      item.decision === "blocked_or_missing_consumer_loop"
    )).toBe(true);
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1092-"));
    const r1044Path = path.join(tmp, "unsafe.json");
    await writeJson(r1044Path, {
      packetId: "r1044-haalsi-external-biomarker-loop",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
    });

    await expect(runR1092ConsumerBloodworkControlHardening({
      outputDir: path.join(tmp, "out"),
      r1044Path,
    })).rejects.toThrow("R1092 rejected unsafe r1044 input");
  });
});

async function writeFixtures(tmp: string): Promise<{
  r1041Path: string;
  r1043Path: string;
  r1044Path: string;
  r1048Path: string;
  r1091Path: string;
}> {
  const paths = {
    r1041Path: path.join(tmp, "r1041.json"),
    r1043Path: path.join(tmp, "r1043.json"),
    r1044Path: path.join(tmp, "r1044.json"),
    r1048Path: path.join(tmp, "r1048.json"),
    r1091Path: path.join(tmp, "r1091.json"),
  };

  await Promise.all([
    writeJson(paths.r1041Path, {
      artifactBoundary: safeBoundary(),
      decision: {
        controlVerdict: "negative_controls_compete_with_glycemia",
      },
      packetId: "r1041-minimal-glycemia-transport-loop",
      schemaVersion: "murph-age-r1041-minimal-glycemia-transport-loop.v1",
    }),
    writeJson(paths.r1043Path, {
      artifactBoundary: safeBoundary(),
      decision: {
        controlVerdict: "negative_controls_compete_with_glycemia",
      },
      packetId: "r1043-midus-family-glycemia-stability-loop",
      schemaVersion: "murph-age-r1043-midus-family-glycemia-stability-loop.v1",
    }),
    writeJson(paths.r1044Path, {
      artifactBoundary: safeBoundary(),
      decision: {
        conclusion: "haalsi_glucose_biomarker_signal_supported",
        controlVerdict: "negative_controls_clean",
      },
      packetId: "r1044-haalsi-external-biomarker-loop",
      schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
    }),
    writeJson(paths.r1048Path, {
      artifactBoundary: safeBoundary(),
      decision: {
        conclusion: "nshap_hba1c_signal_partial_control_limited",
      },
      packetId: "r1048-nshap-hba1c-control-diagnostic",
      schemaVersion: "murph-age-r1048-nshap-hba1c-control-diagnostic.v1",
    }),
    writeJson(paths.r1091Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1091-consumer-input-loop-state",
      schemaVersion: "murph-age-r1091-consumer-input-loop-state.v1",
      summary: {
        conclusion: "consumer_input_loop_ready_for_bloodwork_control_hardening_wearables_blocked",
      },
    }),
  ]);

  return paths;
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
