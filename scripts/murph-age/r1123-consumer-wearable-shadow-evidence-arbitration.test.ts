import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1123_CONSUMER_WEARABLE_SHADOW_EVIDENCE_ARBITRATION_SCHEMA_VERSION,
  runR1123ConsumerWearableShadowEvidenceArbitration,
} from "./r1123-consumer-wearable-shadow-evidence-arbitration.ts";

describe("R1123 consumer wearable shadow evidence arbitration", () => {
  it("keeps W1 first but unvalidated when activity support exists and wrist robustness is unstable", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1123-mixed-"));
    try {
      const paths = await writeInputs(tmp, "mixed");

      const { output, outputPath } = await runR1123ConsumerWearableShadowEvidenceArbitration({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1123-consumer-wearable-shadow-evidence-arbitration.latest.json");
      expect(output.schemaVersion).toBe(R1123_CONSUMER_WEARABLE_SHADOW_EVIDENCE_ARBITRATION_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "consumer_wearable_shadow_evidence_keep_w1_first_but_unvalidated",
        firstWearableCandidate: "W1_activity_steps_minutes",
        nextAction: "collect_outcome_linked_w1_receipt_after_l1_l2",
        outcomeLinkedWearableReceiptRequired: true,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1123: false,
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        topLabCandidate: "L1_tiny_glycemia_only",
      });
      expect(output.arbitration.candidateDecision).toMatchObject({
        l1TinyGlycemia: "run_first_in_consumer_compatible_receipt",
        l2CommonLabVitals: "include_as_secondary_comparator_not_lead",
        w1ActivityStepsMinutes: "keep_first_wearable_candidate_after_l1_l2",
        w2SleepDurationRegularity: "keep_blocked_until_outcome_linked_receipt",
        w3RhrHrvRecovery: "keep_blocked_until_outcome_linked_receipt",
      });
      expect(output.arbitration.consumerPriority).toEqual({
        ageRangeFocus: "16_to_50",
        averageUserInputScope: [
          "common_bloodwork_labs",
          "basic_body_vitals",
          "wearable_activity_steps_minutes",
          "wearable_sleep",
          "wearable_recovery",
        ],
        firstExecutableFamily: "common_bloodwork_labs",
        firstWearableFamily: "wearable_activity_steps_minutes",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        wearableExecutionPolicy: "outcome_linked_receipt_required_before_scoring",
      });
      expect(output.arbitration.evidenceCounts).toMatchObject({
        missingShadowInputs: 0,
        outcomeLinkedWearableReceipts: 0,
        wearableShadowSupportSignals: 2,
      });
      expect(output.arbitration.evidenceCounts.wearableRobustnessBlockers).toBeGreaterThan(0);
      expect(output.arbitration.sourceSummaries.wristInitial).toMatchObject({
        negativeControlsBeaten: true,
        usableAsConsumerWearableValidation: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("strengthens W1 shadow evidence without authorizing product display when robustness clears", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1123-strong-"));
    try {
      const paths = await writeInputs(tmp, "strong");

      const { output } = await runR1123ConsumerWearableShadowEvidenceArbitration({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_wearable_shadow_evidence_strengthened_but_requires_external_receipt",
        firstWearableCandidate: "W1_activity_steps_minutes",
        nextAction: "collect_outcome_linked_w1_receipt_after_l1_l2",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
      });
      expect(output.arbitration.evidenceCounts).toMatchObject({
        missingShadowInputs: 0,
        outcomeLinkedWearableReceipts: 0,
        wearableRobustnessBlockers: 0,
        wearableShadowSupportSignals: 4,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when a required shadow artifact is missing or stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1123-stale-"));
    try {
      const paths = await writeInputs(tmp, "mixed");
      await writeJson(paths.r1066Path, {
        artifactBoundary: safeBoundary(),
        packetId: "r1066-nhanes-wrist-activity-robustness-loop",
        schemaVersion: "stale",
        summary: {
          conclusion: "wrist_activity_robustness_inconclusive_keep_shadow",
        },
      });

      const { output } = await runR1123ConsumerWearableShadowEvidenceArbitration({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_wearable_shadow_evidence_waiting_on_inputs",
        firstWearableCandidate: null,
        nextAction: "refresh_nhanes_activity_wrist_shadow_artifacts",
      });
      expect(output.inputArtifacts.r1066.schemaVersion).toBeNull();
      expect(output.arbitration.candidateDecision.w1ActivityStepsMinutes).toBe("hold_until_shadow_inputs_refresh");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1123-unsafe-"));
    try {
      const paths = await writeInputs(tmp, "mixed");
      await writeJson(paths.r1065Path, {
        artifactBoundary: {
          aggregateOnly: true,
          rowValuesStored: true,
        },
        packetId: "r1065-nhanes-wrist-activity-shadow-loop",
        schemaVersion: "murph-age-r1065-nhanes-wrist-activity-shadow-loop.v1",
      });

      await expect(runR1123ConsumerWearableShadowEvidenceArbitration({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1123 rejected unsafe r1065 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1123-cli-"));
    try {
      const paths = await writeInputs(tmp, "mixed");
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1123-consumer-wearable-shadow-evidence-arbitration.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1049_ACTIVITY_CONTROL_PATH: paths.r1049Path,
          MURPH_AGE_R1065_WRIST_SHADOW_PATH: paths.r1065Path,
          MURPH_AGE_R1066_WRIST_ROBUSTNESS_PATH: paths.r1066Path,
          MURPH_AGE_R1067_WRIST_STRESS_PATH: paths.r1067Path,
          MURPH_AGE_R1120_LAB_VITALS_ARBITRATION_PATH: paths.r1120Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        firstWearableCandidate: string;
        targetInputPriority: string;
        topLabCandidate: string;
      };
      expect(summary).toMatchObject({
        conclusion: "consumer_wearable_shadow_evidence_keep_w1_first_but_unvalidated",
        firstWearableCandidate: "W1_activity_steps_minutes",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        topLabCandidate: "L1_tiny_glycemia_only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant_id");
      expect(stdout).not.toContain("private_marker_");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

type FixtureMode = "mixed" | "strong";

async function writeInputs(tmp: string, mode: FixtureMode): Promise<{
  r1049Path: string;
  r1065Path: string;
  r1066Path: string;
  r1067Path: string;
  r1120Path: string;
}> {
  const r1049Path = path.join(tmp, "r1049.json");
  const r1065Path = path.join(tmp, "r1065.json");
  const r1066Path = path.join(tmp, "r1066.json");
  const r1067Path = path.join(tmp, "r1067.json");
  const r1120Path = path.join(tmp, "r1120.json");
  await Promise.all([
    writeJson(r1049Path, r1049Fixture()),
    writeJson(r1065Path, r1065Fixture()),
    writeJson(r1066Path, r1066Fixture(mode)),
    writeJson(r1067Path, r1067Fixture(mode)),
    writeJson(r1120Path, r1120Fixture()),
  ]);
  return { r1049Path, r1065Path, r1066Path, r1067Path, r1120Path };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1049Fixture(): Record<string, unknown> {
  return {
    activityIncrement: {
      properScoreStatusAcrossReceipts: "stable_improvement",
    },
    artifactBoundary: safeBoundary(),
    calibrationDiagnostic: {
      blocker: "global_e_over_o_underprediction",
    },
    decision: {
      conclusion: "nhanes_activity_signal_control_clean_global_calibration_limited",
    },
    negativeControlDiagnostic: {
      status: "beaten",
    },
    packetId: "r1049-nhanes-activity-control-diagnostic",
    schemaVersion: "murph-age-r1049-nhanes-activity-control-diagnostic.v1",
    shadowCarryForward: {
      activityCandidate: "C8_lab9_hba1c_bp_body_activity_primary",
    },
  };
}

function r1065Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1065-nhanes-wrist-activity-shadow-loop",
    schemaVersion: "murph-age-r1065-nhanes-wrist-activity-shadow-loop.v1",
    summary: {
      c4WristActivityVsLab9: {
        aucDelta: 0.00541653,
        brierDelta: -0.00046046,
        eOverO: 1.01882003,
        logLossDelta: -0.00112145,
        negativeControlsBeaten: true,
      },
      conclusion: "wrist_activity_signal_ready_for_r1034_review",
      usableAsConsumerWearableValidation: false,
    },
  };
}

function r1066Fixture(mode: FixtureMode): Record<string, unknown> {
  const strong = mode === "strong";
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1066-nhanes-wrist-activity-robustness-loop",
    schemaVersion: "murph-age-r1066-nhanes-wrist-activity-robustness-loop.v1",
    summary: {
      conclusion: strong
        ? "wrist_activity_robustness_supports_stronger_shadow_evidence"
        : "wrist_activity_robustness_inconclusive_keep_shadow",
      robustness: {
        activitySignalVerdict: strong
          ? "activity_increment_survives_coverage_controls"
          : "activity_increment_not_separated_from_coverage_or_unstable",
        uncertainty: {
          signStability: {
            brierImprovedFraction: strong ? 0.93 : 0.54,
            logLossImprovedFraction: strong ? 0.91 : 0.57,
          },
        },
      },
      usableAsConsumerWearableValidation: false,
    },
  };
}

function r1067Fixture(mode: FixtureMode): Record<string, unknown> {
  const strong = mode === "strong";
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1067-nhanes-wrist-final-stress-test",
    schemaVersion: "murph-age-r1067-nhanes-wrist-final-stress-test.v1",
    summary: {
      conclusion: strong
        ? "activity_wear_signal_persistent_but_non_specific_keep_shadow"
        : "activity_wear_signal_unstable_keep_shadow",
      earlyDeathStress: "stable",
      subgroupStress: strong ? "stable" : "unstable",
      transportStress: strong ? "stable" : "unstable",
      usableAsConsumerWearableValidation: false,
    },
  };
}

function r1120Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    arbitration: {
      consumerPriority: {
        firstExecutableFamily: "common_bloodwork_labs",
      },
    },
    packetId: "r1120-consumer-lab-vitals-shadow-arbitration",
    schemaVersion: "murph-age-r1120-consumer-lab-vitals-shadow-arbitration.v1",
    summary: {
      conclusion: "consumer_lab_vitals_shadow_arbitration_l1_first",
      topCandidate: "L1_tiny_glycemia_only",
    },
  };
}

function safeBoundary(): unknown {
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
