import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  runR1124ConsumerFirstPassAggregateMetricIntake,
  type R1124ConsumerFirstPassAggregateMetricsInput,
} from "./r1124-consumer-first-pass-aggregate-metric-intake.ts";
import {
  R1126_NHANES_SHADOW_FIRST_PASS_METRIC_ADAPTER_SCHEMA_VERSION,
  runR1126NhanesShadowFirstPassMetricAdapter,
} from "./r1126-nhanes-shadow-first-pass-metric-adapter.ts";

describe("R1126 NHANES shadow first-pass metric adapter", () => {
  it("adapts historical lab and activity aggregate signals into held first-pass metrics", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1126-ready-"));
    try {
      const paths = await writeInputs(tmp);

      const { metricsPath, output, outputPath } = await runR1126NhanesShadowFirstPassMetricAdapter({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1126-nhanes-shadow-first-pass-metric-adapter.latest.json");
      expect(path.basename(metricsPath ?? "")).toBe("r1126-nhanes-shadow-first-pass-aggregate-metrics.json");
      expect(output.schemaVersion).toBe(R1126_NHANES_SHADOW_FIRST_PASS_METRIC_ADAPTER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "nhanes_shadow_first_pass_metrics_ready_not_primary_consumer_validation",
        nextAction: "keep_r1125_private_or_workbench_receipt_as_primary",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1126: false,
        topPriority: "consumer_labs_wearables_l1_l2_w1_first_pass",
      });
      expect(output.shadowAdapter).toMatchObject({
        aggregateMetricsArtifact: "r1126-nhanes-shadow-first-pass-aggregate-metrics.json",
        evidenceRole: "historical_nhanes_shadow_not_consumer_16_50_validation",
        r1124FeedPolicy: "manual_shadow_only_do_not_replace_private_or_workbench_receipt",
        reviewGptRequiredNow: false,
      });
      expect(output.shadowAdapter.candidateIds).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const metrics = JSON.parse(await readFile(metricsPath ?? "", "utf8")) as R1124ConsumerFirstPassAggregateMetricsInput;
      expect(metrics.submissionContext).toMatchObject({
        evidenceRole: "historical_shadow_context",
        targetAgeBand: "roughly_16_50",
      });
      expect(metrics.candidateResults.map((candidate) => candidate.candidateId)).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ]);
      expect(metrics.candidateResults.filter((candidate) => candidate.candidateKind !== "negative_control").map((candidate) => candidate.coverageStatus)).toEqual([
        "sparse_or_biased",
        "sparse_or_biased",
        "sparse_or_biased",
      ]);
      expect(metrics.candidateResults.find((candidate) => candidate.candidateId === "QC_missingness_coverage")).toMatchObject({
        calibrationStatus: "not_applicable",
        coverageStatus: "consumer_viable",
      });
      expect(JSON.stringify(metrics)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(metrics)).toEqual([]);

      const r1124 = await runR1124ConsumerFirstPassAggregateMetricIntake({
        aggregateMetrics: metrics,
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "r1124-out"),
        r1113Path: paths.r1113Path,
        r1121Path: paths.r1121Path,
        r1122Path: paths.r1122Path,
      });
      expect(r1124.output.summary).toMatchObject({
        conclusion: "consumer_first_pass_aggregate_receipt_valid_but_no_delta",
        nextAction: "record_no_delta_and_continue_consumer_receipt_search",
        reviewGptRequiredNow: false,
      });
      expect(r1124.output.metricIntake).toMatchObject({
        aggregateMetricsProvided: true,
        missingRequiredCandidateIds: [],
        r1104Conclusion: "aggregate_receipt_valid_but_no_delta",
        receiptArtifact: "r1124-consumer-first-pass-aggregate-receipt.json",
      });
      expect(findForbiddenAggregateEgress(r1124.output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when a shadow input is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1126-stale-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1038Path, {
        artifactBoundary: safeBoundary(),
        packetId: "r1038-nhanes-modern-lab-activity-calibrated-receipt",
        schemaVersion: "stale",
      });

      const { metricsPath, output } = await runR1126NhanesShadowFirstPassMetricAdapter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(metricsPath).toBeNull();
      expect(output.summary).toMatchObject({
        conclusion: "nhanes_shadow_first_pass_metrics_waiting_on_inputs",
        nextAction: "refresh_r1038_r1049_r1113_shadow_inputs",
        reviewGptRequiredNow: false,
      });
      expect(output.inputArtifacts.r1038).toMatchObject({
        packetId: "r1038-nhanes-modern-lab-activity-calibrated-receipt",
        schemaVersion: null,
        status: "available",
      });
      expect(output.shadowAdapter.aggregateMetricsArtifact).toBeNull();
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1126-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1049Path, {
        ...r1049Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR1126NhanesShadowFirstPassMetricAdapter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1126 rejected unsafe r1049 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1126-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1126-nhanes-shadow-first-pass-metric-adapter.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1038_CALIBRATED_AGGREGATE_RECEIPT_PATH: paths.r1038Path,
          MURPH_AGE_R1049_ACTIVITY_CONTROL_DIAGNOSTIC_PATH: paths.r1049Path,
          MURPH_AGE_R1113_CONSUMER_SOURCE_EXECUTION_PACKET_PATH: paths.r1113Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        aggregateMetricsArtifact: string | null;
        conclusion: string;
        evidenceRole: string;
        productDisplayAuthorized: boolean;
        reviewGptRequiredNow: boolean;
        rowParsingPerformedByR1126: boolean;
      };
      expect(summary).toMatchObject({
        aggregateMetricsArtifact: "r1126-nhanes-shadow-first-pass-aggregate-metrics.json",
        conclusion: "nhanes_shadow_first_pass_metrics_ready_not_primary_consumer_validation",
        evidenceRole: "historical_nhanes_shadow_not_consumer_16_50_validation",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1126: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string): Promise<{
  r1038Path: string;
  r1049Path: string;
  r1113Path: string;
  r1121Path: string;
  r1122Path: string;
}> {
  const paths = {
    r1038Path: path.join(tmp, "r1038.json"),
    r1049Path: path.join(tmp, "r1049.json"),
    r1113Path: path.join(tmp, "r1113.json"),
    r1121Path: path.join(tmp, "r1121.json"),
    r1122Path: path.join(tmp, "r1122.json"),
  };
  await Promise.all([
    writeJson(paths.r1038Path, r1038Fixture()),
    writeJson(paths.r1049Path, r1049Fixture()),
    writeJson(paths.r1113Path, r1113Fixture()),
    writeJson(paths.r1121Path, r1121Fixture()),
    writeJson(paths.r1122Path, r1122Fixture()),
  ]);
  return paths;
}

function r1038Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    candidateMetrics: [
      {
        aucDelta: 0.02810949,
        brierDelta: -0.00444187,
        calibrationSlope: 1.02615702,
        candidateId: "C2_lab5_glucose_bp_body",
        logLossDelta: -0.02378393,
      },
      {
        aucDelta: 0.05061674,
        brierDelta: -0.00640219,
        calibrationSlope: 1.02834428,
        candidateId: "C3_lab9_hba1c_bp_body_primary",
        logLossDelta: -0.03131288,
      },
      {
        aucDelta: 0.0339083,
        brierDelta: -0.00777916,
        calibrationSlope: 0.92364382,
        candidateId: "C6_age_sex_activity_primitives",
        logLossDelta: -0.02717857,
      },
    ],
    packetId: "r1038-nhanes-modern-lab-activity-calibrated-receipt",
    schemaVersion: "murph-age-r1038-r1034-compatible-calibrated-aggregate-receipt.v1",
  };
}

function r1049Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    decision: {
      conclusion: "nhanes_activity_signal_control_clean_global_calibration_limited",
    },
    negativeControlDiagnostic: {
      controls: {
        coverageOnly: {
          aucDelta: -0.00054057,
          brierDelta: 0.00001553,
          logLossDelta: 0.00010849,
        },
      },
    },
    packetId: "r1049-nhanes-activity-control-diagnostic",
    schemaVersion: "murph-age-r1049-nhanes-activity-control-diagnostic.v1",
  };
}

function r1113Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1113-consumer-source-execution-packet",
    schemaVersion: "murph-age-r1113-consumer-source-execution-packet.v1",
    summary: {
      conclusion: "consumer_source_execution_packet_ready",
      firstPassCandidateIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ],
      productDisplayAuthorized: false,
      rowParsingPerformedByR1113: false,
    },
  };
}

function r1121Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1121-local-private-consumer-receipt-runner-contract",
    schemaVersion: "murph-age-r1121-local-private-consumer-receipt-runner-contract.v1",
    summary: {
      conclusion: "local_private_consumer_receipt_runner_contract_ready_awaiting_mapping",
      firstPassCandidateIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ],
      productDisplayAuthorized: false,
      rowParsingPerformedByR1121: false,
    },
  };
}

function r1122Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1122-local-private-consumer-receipt-runner-config-intake",
    schemaVersion: "murph-age-r1122-local-private-consumer-receipt-runner-config-intake.v1",
    summary: {
      conclusion: "local_private_runner_config_not_provided",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1122: false,
    },
  };
}

function safeBoundary(): R1124ConsumerFirstPassAggregateMetricsInput["artifactBoundary"] {
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
