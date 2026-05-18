import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  R1026_FUNCTION_TRANSPORT_AGGREGATE_PACKET_VALIDATOR_SCHEMA_VERSION,
  runR1026FunctionTransportAggregatePacketValidator,
} from "./r1026-function-transport-aggregate-packet-validator.ts";

describe("R1026 function transport aggregate packet validator", () => {
  it("allows a missing fresh aggregate packet as the current blocked state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1026-missing-"));
    try {
      const outputDir = path.join(tmp, "out");
      await mkdir(outputDir, { recursive: true });
      const { output, outputPath } = await runR1026FunctionTransportAggregatePacketValidator({
        aggregatePacketPath: path.join(tmp, "missing-aggregate.json"),
        createdAt: "2026-05-14T02:00:00.000Z",
        outputDir,
      });

      expect(path.basename(outputPath)).toBe("r1026-function-transport-aggregate-packet-validator.latest.json");
      expect(output.schemaVersion).toBe(R1026_FUNCTION_TRANSPORT_AGGREGATE_PACKET_VALIDATOR_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "fresh_function_transport_packet_missing",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1026: false,
      });
      expect(output.packetValidation).toEqual({
        aggregatePacketStatus: "missing",
        checkedSections: [],
        issueCountBand: "0",
        issues: [],
        validationStatus: "missing",
      });

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".latest.json");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain("ICPSR_");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("validates a strict aggregate-only function transport packet", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1026-valid-"));
    try {
      const paths = await writeAggregatePacket(tmp, aggregatePacketFixture());
      const { output } = await runR1026FunctionTransportAggregatePacketValidator({
        aggregatePacketPath: paths.aggregatePacketPath,
        createdAt: "2026-05-14T02:00:00.000Z",
        outputDir: paths.outputDir,
      });

      expect(output.summary.conclusion).toBe("fresh_function_transport_packet_valid");
      expect(output.packetValidation).toEqual({
        aggregatePacketStatus: "available",
        checkedSections: [
          "artifact_boundary",
          "benchmark_lock",
          "decision_inputs",
          "denominator_bands",
          "metric_deltas",
          "no_forbidden_values",
        ],
        issueCountBand: "0",
        issues: [],
        validationStatus: "passed",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe boundary flags", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1026-boundary-"));
    try {
      const paths = await writeAggregatePacket(tmp, {
        ...aggregatePacketFixture(),
        artifactBoundary: {
          ...safeBoundary(),
          predictionsStored: true,
        },
      });

      await expect(runR1026FunctionTransportAggregatePacketValidator({
        aggregatePacketPath: paths.aggregatePacketPath,
        outputDir: paths.outputDir,
      })).rejects.toThrow("R1026 function-transport aggregate packet failed validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects missing benchmark, denominator, decision, or metric sections", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1026-shape-"));
    try {
      const packet = aggregatePacketFixture();
      delete packet.benchmark_lock;
      delete packet.metric_deltas;
      const paths = await writeAggregatePacket(tmp, {
        ...packet,
        decision_inputs: {
          aggregate_verdict: "not_allowed",
        },
        denominator_bands: {
          event_count_band: "gte_50",
        },
      });

      await expect(runR1026FunctionTransportAggregatePacketValidator({
        aggregatePacketPath: paths.aggregatePacketPath,
        outputDir: paths.outputDir,
      })).rejects.toThrow("benchmark_lock_missing");
      await expect(runR1026FunctionTransportAggregatePacketValidator({
        aggregatePacketPath: paths.aggregatePacketPath,
        outputDir: paths.outputDir,
      })).rejects.toThrow("metric_deltas_missing");
      await expect(runR1026FunctionTransportAggregatePacketValidator({
        aggregatePacketPath: paths.aggregatePacketPath,
        outputDir: paths.outputDir,
      })).rejects.toThrow("decision_inputs_same_denominator_valid_must_be_boolean");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects forbidden local/source values inside otherwise aggregate packets", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1026-values-"));
    try {
      const paths = await writeAggregatePacket(tmp, {
        ...aggregatePacketFixture(),
        notes: ["source archive ICPSR_00000.zip should not leave the private adapter"],
      });

      await expect(runR1026FunctionTransportAggregatePacketValidator({
        aggregatePacketPath: paths.aggregatePacketPath,
        outputDir: paths.outputDir,
      })).rejects.toThrow("source_archive_name");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1026-cli-"));
    try {
      const outputDir = path.join(tmp, "out");
      await mkdir(outputDir, { recursive: true });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1026-function-transport-aggregate-packet-validator.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1025_FUNCTION_TRANSPORT_AGGREGATE_PACKET_PATH: path.join(tmp, "missing.json"),
          MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "fresh_function_transport_packet_missing",
        packetId: "r1026-function-transport-aggregate-packet-validator",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1026: false,
        schemaVersion: R1026_FUNCTION_TRANSPORT_AGGREGATE_PACKET_VALIDATOR_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        validationStatus: "missing",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain(".latest.json");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeAggregatePacket(
  tmp: string,
  value: Record<string, unknown>,
): Promise<{ aggregatePacketPath: string; outputDir: string }> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const aggregatePacketPath = path.join(fixtureDir, "aggregate.json");
  await writeFile(aggregatePacketPath, `${JSON.stringify(value, null, 2)}\n`);
  return { aggregatePacketPath, outputDir };
}

function safeBoundary(): Record<string, unknown> {
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
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function aggregatePacketFixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary(),
      rowParsingPerformedByPrivateAdapter: true,
    },
    benchmark_lock: {
      candidate_families: [
        "anchor_same_denominator_reference",
        "function_disability_lead",
        "cognition_shadow_after_function",
      ],
      endpoint_family: "mortality_or_followup",
      evidence_label: "fresh_external_falsification",
      minimum_cell_threshold: "suppressed_under_10",
      product_display_authorized: false,
      same_denominator_required: true,
      source: "NSHAP",
      split_policy: "predeclared_source_split",
      survey_weight_policy: "predeclared_or_unweighted_diagnostic",
      time_horizon: "source_native_followup",
    },
    decision_inputs: {
      abstention_acceptable: true,
      aggregate_verdict: "directional_only",
      calibration_non_worse: true,
      cognition_dominates_function: false,
      contradicts_prior_function_evidence: false,
      function_beats_missingness_control: true,
      function_beats_shuffled_control: true,
      meaningful_aggregate_delta: false,
      proper_scores_improve: true,
      same_denominator_valid: true,
      suppression_passed: true,
    },
    denominator_bands: {
      abstention_count_band: "gte_50",
      anchor_complete_count_band: "gte_1000",
      event_count_band: "gte_50",
      function_complete_count_band: "gte_1000",
      non_event_count_band: "gte_1000",
      primary_intersection_count_band: "gte_1000",
    },
    metric_deltas: {
      anchor_plus_function_sidecar_vs_frozen_anchor: {
        auc_delta: 0.01,
        brier_delta: -0.002,
        log_loss_delta: -0.003,
      },
      function_sidecar_vs_missingness_only_reference: {
        auc_delta: 0.02,
        brier_delta: -0.004,
        log_loss_delta: -0.005,
      },
      function_sidecar_vs_shuffled_function_control: {
        auc_delta: 0.03,
        brier_delta: -0.006,
        log_loss_delta: -0.007,
      },
    },
    packetId: "r1025-function-transport-aggregate-packet",
    schemaVersion: "murph-age-r1025-function-transport-aggregate-packet.v0",
    status: "research-local-aggregate-only",
  };
}
