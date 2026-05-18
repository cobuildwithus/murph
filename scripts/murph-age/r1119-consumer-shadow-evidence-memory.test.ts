import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1119_CONSUMER_SHADOW_EVIDENCE_MEMORY_SCHEMA_VERSION,
  runR1119ConsumerShadowEvidenceMemory,
} from "./r1119-consumer-shadow-evidence-memory.ts";

describe("R1119 consumer shadow evidence memory", () => {
  it("records historical lab shadow evidence without promoting a model", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1119-ready-"));
    try {
      const paths = await writeInputs(tmp, { staleR1118: false });

      const { output, outputPath } = await runR1119ConsumerShadowEvidenceMemory({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1119-consumer-shadow-evidence-memory.latest.json");
      expect(output.schemaVersion).toBe(R1119_CONSUMER_SHADOW_EVIDENCE_MEMORY_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "shadow_lab_evidence_recorded_continue_consumer_receipt_search",
        nextAction: "run_consumer_compatible_l1_l2_receipt_or_fill_private_mapping",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1119: false,
        topCandidate: "L1_tiny_glycemia_only",
      });
      expect(output.shadowMemory.historicalLabSignal).toMatchObject({
        evidenceRole: "historical_external_biomarker_shadow_not_consumer_16_50_validation",
        l1ProperScoreSignal: "improved_but_not_consumer_viable",
        l2ExpansionSignal: "not_supported_over_l1_in_shadow_receipt",
        r1104Conclusion: "aggregate_receipt_valid_but_no_delta",
        reviewGptRequired: false,
      });
      expect(output.shadowMemory.candidateMemory.map((item) => item.candidateId)).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "W2_sleep_duration_regularity",
        "W3_rhr_hrv_recovery",
        "I1_integrated_lab_wearable_small_panel",
      ]);
      expect(output.shadowMemory.candidateMemory[0]).toMatchObject({
        memoryStatus: "carry_forward_first_lab_candidate",
        priority: 1,
      });
      expect(output.shadowMemory.candidateMemory[2]).toMatchObject({
        memoryStatus: "blocked_until_outcome_linked_wearable_receipt",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the shadow receipt adapter is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1119-stale-"));
    try {
      const paths = await writeInputs(tmp, { staleR1118: true });

      const { output } = await runR1119ConsumerShadowEvidenceMemory({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "shadow_lab_evidence_waiting_on_inputs",
        nextAction: "refresh_r1104_r1117_r1118_before_shadow_memory",
        reviewGptRequiredNow: false,
      });
      expect(output.inputArtifacts.r1118).toMatchObject({
        packetId: "r1118-historical-lab-shadow-receipt-adapter",
        schemaVersion: null,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream state with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1119-unsafe-"));
    try {
      const paths = await writeInputs(tmp, { staleR1118: false });
      await writeJson(paths.r1104Path, {
        artifactBoundary: {
          aggregateOnly: true,
          rowValuesStored: true,
        },
        packetId: "r1104-consumer-aggregate-receipt-validator",
        schemaVersion: "murph-age-r1104-consumer-aggregate-receipt-validator.v1",
      });

      await expect(runR1119ConsumerShadowEvidenceMemory({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1119 rejected unsafe r1104 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1119-cli-"));
    try {
      const paths = await writeInputs(tmp, { staleR1118: false });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1119-consumer-shadow-evidence-memory.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1104_RECEIPT_VALIDATOR_PATH: paths.r1104Path,
          MURPH_AGE_R1117_CONSUMER_MODEL_LOOP_PATH: paths.r1117Path,
          MURPH_AGE_R1118_SHADOW_RECEIPT_ADAPTER_PATH: paths.r1118Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        nextAction: string;
        topCandidate: string;
      };
      expect(summary).toMatchObject({
        conclusion: "shadow_lab_evidence_recorded_continue_consumer_receipt_search",
        nextAction: "run_consumer_compatible_l1_l2_receipt_or_fill_private_mapping",
        topCandidate: "L1_tiny_glycemia_only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant_id");
      expect(stdout).not.toContain("glucose");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string, options: { staleR1118: boolean }): Promise<{
  r1104Path: string;
  r1117Path: string;
  r1118Path: string;
}> {
  const r1104Path = path.join(tmp, "r1104.json");
  const r1117Path = path.join(tmp, "r1117.json");
  const r1118Path = path.join(tmp, "r1118.json");
  await Promise.all([
    writeJson(r1104Path, r1104Fixture()),
    writeJson(r1117Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1117-consumer-model-loop-readiness-reducer",
      schemaVersion: "murph-age-r1117-consumer-model-loop-readiness-reducer.v1",
      summary: {
        conclusion: "consumer_model_loop_ready_for_external_or_private_mapping_receipt",
      },
    }),
    writeJson(r1118Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1118-historical-lab-shadow-receipt-adapter",
      schemaVersion: options.staleR1118 ? "stale" : "murph-age-r1118-historical-lab-shadow-receipt-adapter.v1",
      summary: {
        conclusion: "historical_lab_shadow_receipt_ready_no_reviewgpt",
      },
    }),
  ]);
  return { r1104Path, r1117Path, r1118Path };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1104Fixture(): unknown {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1104-consumer-aggregate-receipt-validator",
    reduction: {
      candidateDecisions: [
        {
          candidateId: "L1_tiny_glycemia_only",
          decision: "hold_or_reject",
        },
        {
          candidateId: "L2_common_lab_core_shadow",
          decision: "hold_or_reject",
        },
      ],
    },
    schemaVersion: "murph-age-r1104-consumer-aggregate-receipt-validator.v1",
    summary: {
      conclusion: "aggregate_receipt_valid_but_no_delta",
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
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}
