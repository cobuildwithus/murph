import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION,
  realSubmissionContext,
  runR1124ConsumerFirstPassAggregateMetricIntake,
  syntheticSmokeSubmissionContext,
  type R1124ConsumerFirstPassAggregateMetricsInput,
} from "./r1124-consumer-first-pass-aggregate-metric-intake.ts";

describe("R1124 consumer first-pass aggregate metric intake", () => {
  it("waits for aggregate metrics while prerequisites are ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1124-missing-"));
    try {
      const paths = await writeInputs(tmp);

      const { aggregateMetricsTemplatePath, output, receiptPath } = await runR1124ConsumerFirstPassAggregateMetricIntake({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });
      const template = JSON.parse(await readFile(aggregateMetricsTemplatePath, "utf8")) as {
        candidateResults: Array<{ candidateId: string; aucDelta: number | null; logLossDelta: number | null }>;
        packetId: string;
        schemaVersion: string;
        submissionContext: { evidenceRole: string; targetAgeBand: string };
      };

      expect(receiptPath).toBeNull();
      expect(path.basename(aggregateMetricsTemplatePath)).toBe("r1124-fillable-consumer-first-pass-aggregate-metrics.json");
      expect(template.schemaVersion).toBe("murph-age-consumer-first-pass-aggregate-metrics.v1");
      expect(template.packetId).toBe("fill-this-consumer-first-pass-aggregate-metrics");
      expect(template.submissionContext).toMatchObject({
        evidenceRole: "real_first_pass_evidence",
        targetAgeBand: "roughly_16_50",
      });
      expect(template.candidateResults.map((candidate) => candidate.candidateId)).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ]);
      expect(template.candidateResults.every((candidate) => candidate.aucDelta === null && candidate.logLossDelta === null)).toBe(true);
      expect(output.schemaVersion).toBe(R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "consumer_first_pass_aggregate_metrics_missing",
        nextAction: "provide_l1_l2_w1_qc_aggregate_metrics_or_fill_private_config",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1124: false,
      });
      expect(output.metricIntake).toMatchObject({
        aggregateMetricsProvided: false,
        aggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
        candidateCountBand: "0",
        firstPassCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        missingRequiredCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        r1104Conclusion: null,
        receiptArtifact: null,
        submissionEvidenceRole: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(template)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fills and validates a first-pass receipt when aggregate metrics clear gates", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1124-ready-"));
    try {
      const paths = await writeInputs(tmp);

      const { output, receiptPath } = await runR1124ConsumerFirstPassAggregateMetricIntake({
        aggregateMetrics: aggregateMetricsFixture("ready"),
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(receiptPath ?? "")).toBe("r1124-consumer-first-pass-aggregate-receipt.json");
      const receipt = JSON.parse(await readFile(receiptPath ?? "", "utf8")) as {
        candidateResults: Array<{ candidateId: string }>;
        schemaVersion: string;
      };
      expect(receipt.schemaVersion).toBe("murph-age-consumer-lab-wearable-aggregate-receipt.v1");
      expect(receipt.candidateResults.map((candidate) => candidate.candidateId)).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ]);
      expect(output.summary).toMatchObject({
        conclusion: "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
        nextAction: "send_aggregate_only_consumer_first_pass_delta_to_reviewgpt",
        reviewGptRequiredNow: true,
      });
      expect(output.metricIntake).toMatchObject({
        aggregateMetricsProvided: true,
        candidateCountBand: "1-9",
        missingRequiredCandidateIds: [],
        r1104Conclusion: "aggregate_receipt_ready_for_reviewgpt",
        receiptArtifact: "r1124-consumer-first-pass-aggregate-receipt.json",
        submissionEvidenceRole: "real_first_pass_evidence",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(receipt)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds a complete receipt when aggregate metrics do not clear gates", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1124-hold-"));
    try {
      const paths = await writeInputs(tmp);

      const { output } = await runR1124ConsumerFirstPassAggregateMetricIntake({
        aggregateMetrics: aggregateMetricsFixture("hold"),
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_first_pass_aggregate_receipt_valid_but_no_delta",
        nextAction: "record_no_delta_and_continue_consumer_receipt_search",
        reviewGptRequiredNow: false,
      });
      expect(output.metricIntake.r1104Conclusion).toBe("aggregate_receipt_valid_but_no_delta");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps synthetic smoke metrics out of the ReviewGPT gate even when deltas clear", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1124-smoke-"));
    try {
      const paths = await writeInputs(tmp);
      const aggregateMetrics = {
        ...aggregateMetricsFixture("ready"),
        submissionContext: syntheticSmokeSubmissionContext(),
      };

      const { output, receiptPath } = await runR1124ConsumerFirstPassAggregateMetricIntake({
        aggregateMetrics,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(receiptPath ?? "")).toBe("r1124-consumer-first-pass-aggregate-receipt.json");
      expect(output.summary).toMatchObject({
        conclusion: "consumer_first_pass_aggregate_receipt_smoke_only_not_reviewgpt",
        nextAction: "replace_smoke_metrics_with_real_outcome_linked_aggregate",
        reviewGptRequiredNow: false,
      });
      expect(output.metricIntake).toMatchObject({
        r1104Conclusion: "aggregate_receipt_ready_for_reviewgpt",
        submissionEvidenceRole: "synthetic_pipeline_smoke",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks aggregate metrics incomplete when a required first-pass candidate is absent", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1124-incomplete-"));
    try {
      const paths = await writeInputs(tmp);
      const aggregateMetrics = aggregateMetricsFixture("ready");
      aggregateMetrics.candidateResults = aggregateMetrics.candidateResults.filter((candidate) =>
        candidate.candidateId !== "QC_missingness_coverage"
      );

      const { output, receiptPath } = await runR1124ConsumerFirstPassAggregateMetricIntake({
        aggregateMetrics,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(receiptPath).toBeNull();
      expect(output.summary).toMatchObject({
        conclusion: "consumer_first_pass_aggregate_metrics_incomplete",
        nextAction: "complete_first_pass_aggregate_metrics",
        reviewGptRequiredNow: false,
      });
      expect(output.metricIntake.missingRequiredCandidateIds).toEqual(["QC_missingness_coverage"]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the source packet prerequisite is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1124-stale-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1113Path, {
        artifactBoundary: safeBoundary(),
        packetId: "r1113-consumer-source-execution-packet",
        schemaVersion: "stale",
        summary: {
          conclusion: "consumer_source_execution_packet_ready",
          firstPassCandidateIds: [
            "L1_tiny_glycemia_only",
            "L2_common_lab_core_shadow",
            "W1_activity_steps_minutes",
            "QC_missingness_coverage",
          ],
        },
      });

      const { output } = await runR1124ConsumerFirstPassAggregateMetricIntake({
        aggregateMetrics: aggregateMetricsFixture("ready"),
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_first_pass_aggregate_metric_intake_waiting_on_prerequisites",
        nextAction: "refresh_r1113_r1121_before_metric_intake",
        reviewGptRequiredNow: false,
      });
      expect(output.inputArtifacts.r1113.schemaVersion).toBeNull();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate metric input with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1124-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      const aggregateMetrics = aggregateMetricsFixture("ready") as R1124ConsumerFirstPassAggregateMetricsInput & {
        rowValuesStored: boolean;
      };
      aggregateMetrics.rowValuesStored = true;

      await expect(runR1124ConsumerFirstPassAggregateMetricIntake({
        aggregateMetrics,
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1124 rejected unsafe aggregate metrics: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects aggregate metric input without ordinary consumer submission context", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1124-context-"));
    try {
      const paths = await writeInputs(tmp);
      const aggregateMetrics: Partial<R1124ConsumerFirstPassAggregateMetricsInput> = {
        ...aggregateMetricsFixture("ready"),
      };
      delete aggregateMetrics.submissionContext;

      await expect(runR1124ConsumerFirstPassAggregateMetricIntake({
        aggregateMetrics: aggregateMetrics as R1124ConsumerFirstPassAggregateMetricsInput,
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1124 aggregate metrics are missing required ordinary consumer submission context.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1124-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const aggregateMetricsPath = path.join(tmp, "aggregate-metrics.json");
      await writeJson(aggregateMetricsPath, aggregateMetricsFixture("hold"));

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH: aggregateMetricsPath,
          MURPH_AGE_R1113_CONSUMER_SOURCE_EXECUTION_PACKET_PATH: paths.r1113Path,
          MURPH_AGE_R1121_LOCAL_PRIVATE_RUNNER_CONTRACT_PATH: paths.r1121Path,
          MURPH_AGE_R1122_LOCAL_PRIVATE_CONFIG_INTAKE_PATH: paths.r1122Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        aggregateMetricsProvided: boolean;
        aggregateMetricsTemplateArtifact: string;
        conclusion: string;
        missingRequiredCandidateIds: string[];
        receiptArtifact: string | null;
        submissionEvidenceRole: string | null;
      };
      expect(summary).toMatchObject({
        aggregateMetricsProvided: true,
        aggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
        conclusion: "consumer_first_pass_aggregate_receipt_valid_but_no_delta",
        missingRequiredCandidateIds: [],
        receiptArtifact: "r1124-consumer-first-pass-aggregate-receipt.json",
        submissionEvidenceRole: "real_first_pass_evidence",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string): Promise<{
  r1113Path: string;
  r1121Path: string;
  r1122Path: string;
}> {
  const paths = {
    r1113Path: path.join(tmp, "r1113.json"),
    r1121Path: path.join(tmp, "r1121.json"),
    r1122Path: path.join(tmp, "r1122.json"),
  };
  await Promise.all([
    writeJson(paths.r1113Path, {
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
      },
    }),
    writeJson(paths.r1121Path, {
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
      },
    }),
    writeJson(paths.r1122Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1122-local-private-consumer-receipt-runner-config-intake",
      schemaVersion: "murph-age-r1122-local-private-consumer-receipt-runner-config-intake.v1",
      summary: {
        conclusion: "local_private_runner_config_not_provided",
      },
    }),
  ]);
  return paths;
}

function aggregateMetricsFixture(mode: "hold" | "ready"): R1124ConsumerFirstPassAggregateMetricsInput {
  const ready = mode === "ready";
  return {
    artifactBoundary: safeBoundary(),
    candidateResults: [
      {
        aucDelta: ready ? 0.006 : 0.002,
        brierDelta: ready ? -0.0006 : -0.0001,
        calibrationStatus: "non_worse",
        candidateId: "L1_tiny_glycemia_only",
        candidateKind: "lab",
        comparatorId: "frozen_recalibrated_r399",
        coverageStatus: "consumer_viable",
        evidenceSupport: "one_receipt_100_plus_events",
        logLossDelta: ready ? -0.0021 : -0.0005,
        missingnessOrCoverageControlStatus: "not_applicable",
      },
      {
        aucDelta: 0.002,
        brierDelta: -0.0001,
        calibrationStatus: "non_worse",
        candidateId: "L2_common_lab_core_shadow",
        candidateKind: "lab",
        comparatorId: "l1_tiny_glycemia_only",
        coverageStatus: "consumer_viable",
        evidenceSupport: "one_receipt_100_plus_events",
        logLossDelta: -0.0004,
        missingnessOrCoverageControlStatus: "not_applicable",
      },
      {
        aucDelta: ready ? 0.011 : 0.002,
        brierDelta: ready ? -0.0007 : 0.0001,
        calibrationStatus: ready ? "non_worse" : "worse",
        candidateId: "W1_activity_steps_minutes",
        candidateKind: "wearable",
        comparatorId: "frozen_recalibrated_r399",
        coverageStatus: "consumer_viable",
        evidenceSupport: "one_receipt_100_plus_events",
        logLossDelta: ready ? -0.0022 : 0.0002,
        missingnessOrCoverageControlStatus: ready ? "beaten" : "not_beaten",
      },
      {
        aucDelta: 0,
        brierDelta: 0.0001,
        calibrationStatus: "not_applicable",
        candidateId: "QC_missingness_coverage",
        candidateKind: "negative_control",
        comparatorId: "frozen_recalibrated_r399",
        coverageStatus: "consumer_viable",
        evidenceSupport: "one_receipt_100_plus_events",
        logLossDelta: 0.0002,
        missingnessOrCoverageControlStatus: "not_applicable",
      },
    ],
    evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
    packetId: "aggregate-metrics-fixture",
    receiptAttestations: {
      aggregateOnly: true,
      endpointFrozenBeforeScoring: true,
      evaluatorFrozenBeforeExecution: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      sameDenominatorComparisons: true,
    },
    schemaVersion: "murph-age-consumer-first-pass-aggregate-metrics.v1",
    submissionContext: realSubmissionContext(),
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
