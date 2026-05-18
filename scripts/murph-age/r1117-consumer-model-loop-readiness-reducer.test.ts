import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1117_CONSUMER_MODEL_LOOP_READINESS_REDUCER_SCHEMA_VERSION,
  runR1117ConsumerModelLoopReadinessReducer,
} from "./r1117-consumer-model-loop-readiness-reducer.ts";

describe("R1117 consumer model loop readiness reducer", () => {
  it("queues labs/vitals first and holds wearables when the consumer receipt is still missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1117-ready-"));
    try {
      const paths = await writeInputs(tmp, {
        mappingReady: false,
        receiptReadyForScienceReview: false,
        staleManifest: false,
      });

      const { output, outputPath } = await runR1117ConsumerModelLoopReadinessReducer({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1117-consumer-model-loop-readiness-reducer.latest.json");
      expect(output.schemaVersion).toBe(R1117_CONSUMER_MODEL_LOOP_READINESS_REDUCER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "consumer_model_loop_ready_for_external_or_private_mapping_receipt",
        nextAction: "fill_private_mapping_template_or_run_all_of_us_cardia_receipt",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1117: false,
      });
      expect(output.loopReadiness).toMatchObject({
        bloodworkLeadStatus: "glucose_hba1c_shadow_mixed_transport",
        currentBlocker: "consumer_outcome_linked_aggregate_receipt_missing",
        localPrivateMapping: {
          status: "mapping_not_provided_template_ready",
          templateArtifact: "r1116-fillable-private-header-mapping-template.json",
        },
        wearableStatus: "blocked_until_outcome_linked_receipt",
      });
      expect(output.loopReadiness.candidateQueue.map((item) => item.candidateId)).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "W2_sleep_duration_regularity",
        "W3_rhr_hrv_recovery",
        "I1_integrated_lab_wearable_small_panel",
      ]);
      expect(output.loopReadiness.candidateQueue[0]).toMatchObject({
        executionStatus: "external_or_private_aggregate_receipt_next",
        priority: 1,
        userSubmitFit: "high",
      });
      expect(output.loopReadiness.candidateQueue[2]).toMatchObject({
        executionStatus: "blocked_until_outcome_linked_wearable_receipt",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes to local receipt build when private mapping is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1117-mapping-ready-"));
    try {
      const paths = await writeInputs(tmp, {
        mappingReady: true,
        receiptReadyForScienceReview: false,
        staleManifest: false,
      });

      const { output } = await runR1117ConsumerModelLoopReadinessReducer({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_mapping_ready_for_receipt_build",
        nextAction: "build_local_aggregate_receipt_from_private_mapping_then_run_r1104",
        reviewGptRequiredNow: false,
      });
      expect(output.loopReadiness.currentBlocker).toBe("local_private_mapping_ready_but_receipt_not_built");
      expect(output.loopReadiness.candidateQueue[0]?.executionStatus).toBe("ready_after_private_mapping_receipt_builder");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("uses ReviewGPT only after an aggregate receipt is ready for science review", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1117-review-"));
    try {
      const paths = await writeInputs(tmp, {
        mappingReady: false,
        receiptReadyForScienceReview: true,
        staleManifest: false,
      });

      const { output } = await runR1117ConsumerModelLoopReadinessReducer({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_model_loop_ready_for_r1104_validated_science_review",
        nextAction: "send_r1104_valid_delta_to_reviewgpt",
        reviewGptRequiredNow: true,
      });
      expect(output.loopReadiness.currentBlocker).toBe("validated_science_delta_ready");
      expect(output.loopReadiness.reviewGptUse).toBe("only_after_r1104_valid_science_delta_or_high_level_direction_conflict");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when prerequisite artifacts are stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1117-stale-"));
    try {
      const paths = await writeInputs(tmp, {
        mappingReady: false,
        receiptReadyForScienceReview: false,
        staleManifest: true,
      });

      const { output } = await runR1117ConsumerModelLoopReadinessReducer({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_model_loop_waiting_on_consumer_artifact_refresh",
        nextAction: "refresh_r1047_r1086_r1103_r1112_r1115_r1116",
        reviewGptRequiredNow: false,
      });
      expect(output.loopReadiness.currentBlocker).toBe("consumer_prerequisites_missing_or_stale");
      expect(output.inputArtifacts.r1103).toMatchObject({
        packetId: "r1103-consumer-candidate-family-manifest",
        schemaVersion: null,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream inputs with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1117-unsafe-"));
    try {
      const paths = await writeInputs(tmp, {
        mappingReady: false,
        receiptReadyForScienceReview: false,
        staleManifest: false,
      });
      await writeJson(paths.r1115Path, {
        artifactBoundary: {
          aggregateOnly: true,
          rowValuesStored: true,
        },
        packetId: "r1115-local-private-header-mapping-intake",
        schemaVersion: "murph-age-r1115-local-private-header-mapping-intake.v1",
      });

      await expect(runR1117ConsumerModelLoopReadinessReducer({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1117 rejected unsafe r1115 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1117-cli-"));
    try {
      const paths = await writeInputs(tmp, {
        mappingReady: false,
        receiptReadyForScienceReview: false,
        staleManifest: false,
      });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1117-consumer-model-loop-readiness-reducer.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1047_BIOMARKER_EVIDENCE_PATH: paths.r1047Path,
          MURPH_AGE_R1086_MODEL_EVIDENCE_PATH: paths.r1086Path,
          MURPH_AGE_R1103_CONSUMER_CANDIDATE_PATH: paths.r1103Path,
          MURPH_AGE_R1112_CONSUMER_DATA_PRIORITY_PATH: paths.r1112Path,
          MURPH_AGE_R1115_LOCAL_PRIVATE_MAPPING_INTAKE_PATH: paths.r1115Path,
          MURPH_AGE_R1116_LOCAL_PRIVATE_MAPPING_TEMPLATE_PATH: paths.r1116Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        nextAction: string;
        topCandidate: string;
      };
      expect(summary).toMatchObject({
        conclusion: "consumer_model_loop_ready_for_external_or_private_mapping_receipt",
        nextAction: "fill_private_mapping_template_or_run_all_of_us_cardia_receipt",
        topCandidate: "L1_tiny_glycemia_only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant_id");
      expect(stdout).not.toContain("steps");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string, options: {
  mappingReady: boolean;
  receiptReadyForScienceReview: boolean;
  staleManifest: boolean;
}): Promise<{
  r1047Path: string;
  r1086Path: string;
  r1103Path: string;
  r1112Path: string;
  r1115Path: string;
  r1116Path: string;
}> {
  const r1047Path = path.join(tmp, "r1047.json");
  const r1086Path = path.join(tmp, "r1086.json");
  const r1103Path = path.join(tmp, "r1103.json");
  const r1112Path = path.join(tmp, "r1112.json");
  const r1115Path = path.join(tmp, "r1115.json");
  const r1116Path = path.join(tmp, "r1116.json");
  await Promise.all([
    writeJson(r1047Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1047-biomarker-evidence-state",
      schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
      summary: {
        currentBloodworkLead: "glucose_hba1c_research_candidate",
      },
    }),
    writeJson(r1086Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1086-current-model-evidence-state",
      schemaVersion: "murph-age-r1086-current-model-evidence-state.v1",
      summary: {
        glycemiaStatus: "shadow_mixed_transport",
      },
    }),
    writeJson(r1103Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1103-consumer-candidate-family-manifest",
      schemaVersion: options.staleManifest ? "stale" : "murph-age-r1103-consumer-candidate-family-manifest.v1",
      summary: {
        conclusion: "consumer_candidate_family_manifest_ready",
      },
    }),
    writeJson(r1112Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1112-consumer-data-priority-router",
      schemaVersion: "murph-age-r1112-consumer-data-priority-router.v1",
      summary: {
        conclusion: options.receiptReadyForScienceReview
          ? "consumer_aggregate_receipt_ready_for_science_review"
          : "consumer_lab_wearable_loop_blocked_on_outcome_linked_aggregate_receipt",
      },
    }),
    writeJson(r1115Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1115-local-private-header-mapping-intake",
      schemaVersion: "murph-age-r1115-local-private-header-mapping-intake.v1",
      summary: {
        conclusion: options.mappingReady
          ? "local_private_header_mapping_ready_for_local_aggregate_receipt"
          : "local_private_header_mapping_not_provided",
      },
    }),
    writeJson(r1116Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1116-local-private-header-mapping-template",
      schemaVersion: "murph-age-r1116-local-private-header-mapping-template.v1",
      summary: {
        conclusion: "local_private_header_mapping_template_ready",
      },
    }),
  ]);
  return { r1047Path, r1086Path, r1103Path, r1112Path, r1115Path, r1116Path };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
