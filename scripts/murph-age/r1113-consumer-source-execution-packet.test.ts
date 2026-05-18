import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1113_CONSUMER_SOURCE_EXECUTION_PACKET_SCHEMA_VERSION,
  runR1113ConsumerSourceExecutionPacket,
} from "./r1113-consumer-source-execution-packet.ts";

describe("R1113 consumer source execution packet", () => {
  it("packages the next All of Us/CARDIA aggregate execution packet", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1113-"));
    try {
      const paths = await writeInputs(tmp, {
        receiptReady: false,
        stalePriority: false,
      });

      const { output, outputPath } = await runR1113ConsumerSourceExecutionPacket({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1113-consumer-source-execution-packet.latest.json");
      expect(output.schemaVersion).toBe(R1113_CONSUMER_SOURCE_EXECUTION_PACKET_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "consumer_source_execution_packet_ready",
        firstPassCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        firstWearableCandidate: "W1_activity_steps_minutes",
        nextAction: "run_source_environment_and_fill_r1105_receipt",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1113: false,
      });
      expect(output.executionPacket.sourceTargets.map((target) => target.sourceRoute)).toEqual([
        "all_of_us_workbench_aggregate",
        "cardia_authorized_or_aggregate",
      ]);
      expect(output.executionPacket.sourceTargets[0]).toMatchObject({
        deferredInputFamilies: [
          "wearable_sleep",
          "wearable_recovery",
        ],
        evidenceRole: "primary_score_bearing",
        runEnvironment: "authorized_source_workbench_or_local_row_owner",
        targetInputFamilies: [
          "bloodwork_common_labs",
          "vitals_body_composition",
          "wearable_activity",
        ],
      });
      expect(output.executionPacket.sourceTargets[0]?.minimumAggregateReceipt.candidateIds).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ]);
      expect(output.executionPacket.sourceTargets[0]?.minimumAggregateReceipt.deferredCandidateIds).toEqual([
        "W2_sleep_duration_regularity",
        "W3_rhr_hrv_recovery",
        "I1_integrated_lab_wearable_small_panel",
      ]);
      expect(output.executionPacket.blockedExternalOutput).toContain("source_variable_names");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes to science review when the receipt validator already has a valid delta", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1113-receipt-"));
    try {
      const paths = await writeInputs(tmp, {
        receiptReady: true,
        stalePriority: false,
      });

      const { output } = await runR1113ConsumerSourceExecutionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_receipt_already_ready_for_science_review",
        nextAction: "validate_existing_receipt_then_review_science_delta",
        reviewGptRequiredNow: true,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the data-priority router identity is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1113-stale-"));
    try {
      const paths = await writeInputs(tmp, {
        receiptReady: false,
        stalePriority: true,
      });

      const { output } = await runR1113ConsumerSourceExecutionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_source_execution_packet_waiting_on_prerequisites",
        nextAction: "regenerate_consumer_execution_prerequisites",
        reviewGptRequiredNow: false,
      });
      expect(output.inputArtifacts.r1112).toMatchObject({
        packetId: "r1112-consumer-data-priority-router",
        schemaVersion: null,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the wearable first-pass arbitration is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1113-stale-wearable-"));
    try {
      const paths = await writeInputs(tmp, {
        receiptReady: false,
        stalePriority: false,
        staleWearable: true,
      });

      const { output } = await runR1113ConsumerSourceExecutionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_source_execution_packet_waiting_on_prerequisites",
        firstPassCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "QC_missingness_coverage",
        ],
        firstWearableCandidate: null,
        nextAction: "regenerate_consumer_execution_prerequisites",
        reviewGptRequiredNow: false,
      });
      expect(output.inputArtifacts.r1123).toMatchObject({
        packetId: "r1123-consumer-wearable-shadow-evidence-arbitration",
        schemaVersion: null,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes an unvalidated existing receipt to R1104 before ReviewGPT", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1113-unvalidated-receipt-"));
    try {
      const paths = await writeInputs(tmp, {
        receiptReady: false,
        stalePriority: false,
      });
      await writeJson(paths.r1112Path, {
        artifactBoundary: safeBoundary(),
        packetId: "r1112-consumer-data-priority-router",
        schemaVersion: "murph-age-r1112-consumer-data-priority-router.v1",
        summary: {
          conclusion: "consumer_aggregate_receipt_ready_for_science_review",
        },
      });

      const { output } = await runR1113ConsumerSourceExecutionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_receipt_needs_r1104_validation",
        nextAction: "run_r1104_on_existing_receipt_before_review",
        reviewGptRequiredNow: false,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1113-unsafe-"));
    try {
      const paths = await writeInputs(tmp, {
        receiptReady: false,
        stalePriority: false,
      });
      await writeJson(paths.r1112Path, {
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
        packetId: "r1112-consumer-data-priority-router",
        schemaVersion: "murph-age-r1112-consumer-data-priority-router.v1",
      });

      await expect(runR1113ConsumerSourceExecutionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1113 rejected unsafe r1112 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1113-cli-"));
    try {
      const paths = await writeInputs(tmp, {
        receiptReady: false,
        stalePriority: false,
      });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1113-consumer-source-execution-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1104_RECEIPT_VALIDATOR_PATH: paths.r1104Path,
          MURPH_AGE_R1105_CONSUMER_RECEIPT_TEMPLATE_PATH: paths.r1105Path,
          MURPH_AGE_R1111_CONSUMER_RUNBOOK_PATH: paths.r1111Path,
          MURPH_AGE_R1112_CONSUMER_DATA_PRIORITY_PATH: paths.r1112Path,
          MURPH_AGE_R1123_WEARABLE_SHADOW_ARBITRATION_PATH: paths.r1123Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        firstPassCandidateIds: string[];
        firstWearableCandidate: string | null;
        nextAction: string;
        productDisplayAuthorized: boolean;
        sourceTargets: string[];
      };
      expect(summary).toMatchObject({
        conclusion: "consumer_source_execution_packet_ready",
        firstPassCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        firstWearableCandidate: "W1_activity_steps_minutes",
        nextAction: "run_source_environment_and_fill_r1105_receipt",
        productDisplayAuthorized: false,
        sourceTargets: [
          "all_of_us_workbench_aggregate",
          "cardia_authorized_or_aggregate",
        ],
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string, options: {
  receiptReady: boolean;
  stalePriority: boolean;
  staleWearable?: boolean;
}): Promise<{
  r1104Path: string;
  r1105Path: string;
  r1111Path: string;
  r1112Path: string;
  r1123Path: string;
}> {
  const paths = {
    r1104Path: path.join(tmp, "r1104.json"),
    r1105Path: path.join(tmp, "r1105.json"),
    r1111Path: path.join(tmp, "r1111.json"),
    r1112Path: path.join(tmp, "r1112.json"),
    r1123Path: path.join(tmp, "r1123.json"),
  };
  await Promise.all([
    writeJson(paths.r1104Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1104-consumer-aggregate-receipt-validator",
      schemaVersion: "murph-age-r1104-consumer-aggregate-receipt-validator.v1",
      summary: {
        conclusion: options.receiptReady
          ? "aggregate_receipt_ready_for_reviewgpt"
          : "aggregate_receipt_missing",
      },
    }),
    writeJson(paths.r1105Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1105-consumer-aggregate-receipt-template",
      receiptTemplateArtifact: "r1105-fillable-consumer-aggregate-receipt-template.json",
      schemaVersion: "murph-age-r1105-consumer-aggregate-receipt-template.v1",
      summary: {
        templateReadyForDataFill: true,
      },
    }),
    writeJson(paths.r1111Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1111-consumer-aggregate-receipt-runbook",
      schemaVersion: "murph-age-r1111-consumer-aggregate-receipt-runbook.v1",
      summary: {
        conclusion: "consumer_aggregate_receipt_runbook_ready",
      },
    }),
    writeJson(paths.r1112Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1112-consumer-data-priority-router",
      schemaVersion: options.stalePriority
        ? "murph-age-r1112-consumer-data-priority-router.future"
        : "murph-age-r1112-consumer-data-priority-router.v1",
      summary: {
        conclusion: "consumer_lab_wearable_loop_blocked_on_outcome_linked_aggregate_receipt",
      },
    }),
    writeJson(paths.r1123Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1123-consumer-wearable-shadow-evidence-arbitration",
      schemaVersion: options.staleWearable
        ? "murph-age-r1123-consumer-wearable-shadow-evidence-arbitration.future"
        : "murph-age-r1123-consumer-wearable-shadow-evidence-arbitration.v1",
      summary: {
        conclusion: "consumer_wearable_shadow_evidence_keep_w1_first_but_unvalidated",
        firstWearableCandidate: "W1_activity_steps_minutes",
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
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
