import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1128_ORDINARY_CONSUMER_PIPELINE_SMOKE_PROOF_SCHEMA_VERSION,
  runR1128OrdinaryConsumerPipelineSmokeProof,
} from "./r1128-ordinary-consumer-pipeline-smoke-proof.ts";

const FIRST_PASS_CANDIDATE_IDS = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "QC_missingness_coverage",
];
const ORDINARY_TABLE_LAYOUTS = ["single_primary_table_fallback", "multi_table_or_explicit_refs"];

describe("R1128 ordinary consumer pipeline smoke proof", () => {
  it("proves the ordinary submission handoff can execute with synthetic non-evidence data", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1128-ready-"));
    try {
      const paths = await writeInputs(tmp);

      const { output, outputPath } = await runR1128OrdinaryConsumerPipelineSmokeProof({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1128-ordinary-consumer-pipeline-smoke-proof.latest.json");
      expect(output.schemaVersion).toBe(R1128_ORDINARY_CONSUMER_PIPELINE_SMOKE_PROOF_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_pipeline_smoke_passed_non_evidence",
        nextAction: "use_r1127_handoff_with_real_private_or_workbench_data",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1128: false,
        syntheticEvidence: false,
      });
      expect(output.smokeProof).toMatchObject({
        aggregateMetricsArtifactFromSyntheticRun: "r1125-consumer-first-pass-aggregate-metrics.json",
        firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
        privateValuesStored: false,
        r1122Conclusion: "local_private_runner_config_ready_for_local_aggregate_receipt",
        submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
        syntheticEvidenceRole: "pipeline_smoke_only_not_model_evidence",
        syntheticRowsGeneratedByR1128: true,
        syntheticRowsPersisted: false,
      });
      expect([
        "local_private_first_pass_runner_ready_for_reviewgpt_delta",
        "local_private_first_pass_runner_valid_no_delta",
      ]).toContain(output.smokeProof.r1125Conclusion);
      expect(output.smokeProof.ordinaryTableLayoutsSmokePassed).toEqual(ORDINARY_TABLE_LAYOUTS);
      expect(output.smokeProof.ordinaryTableLayoutSmokeResults.map((result) => result.ordinaryTableLayout))
        .toEqual(ORDINARY_TABLE_LAYOUTS);
      for (const result of output.smokeProof.ordinaryTableLayoutSmokeResults) {
        expect(result).toMatchObject({
          aggregateMetricsArtifact: "r1125-consumer-first-pass-aggregate-metrics.json",
          r1122Conclusion: "local_private_runner_config_ready_for_local_aggregate_receipt",
        });
        expect([
          "local_private_first_pass_runner_ready_for_reviewgpt_delta",
          "local_private_first_pass_runner_valid_no_delta",
        ]).toContain(result.r1125Conclusion);
        expect(result.r1124Conclusion).toMatch(/^consumer_first_pass_aggregate_receipt_/u);
      }
      expect(output.smokeProof.r1124ConclusionFromSyntheticRun).toMatch(/^consumer_first_pass_aggregate_receipt_/u);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("synthetic-person");
      expect(JSON.stringify(output)).not.toContain("glucose_value");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the R1127 submission handoff is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1128-stale-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1127Path, {
        artifactBoundary: safeBoundary(),
        packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
        schemaVersion: "stale",
      });

      const { output } = await runR1128OrdinaryConsumerPipelineSmokeProof({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_pipeline_smoke_waiting_on_handoff_inputs",
        nextAction: "refresh_r1113_r1121_r1127_before_smoke_proof",
        reviewGptRequiredNow: false,
        syntheticEvidence: false,
      });
      expect(output.inputArtifacts.r1127).toMatchObject({
        packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
        schemaVersion: null,
        status: "available",
      });
      expect(output.smokeProof.syntheticRowsGeneratedByR1128).toBe(false);
      expect(output.smokeProof.ordinaryTableLayoutsSmokePassed).toEqual([]);
      expect(output.smokeProof.ordinaryTableLayoutSmokeResults).toEqual([]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1128-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1127Path, {
        ...r1127Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR1128OrdinaryConsumerPipelineSmokeProof({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1128 rejected unsafe r1127 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1128-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1128-ordinary-consumer-pipeline-smoke-proof.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1113_CONSUMER_SOURCE_EXECUTION_PACKET_PATH: paths.r1113Path,
          MURPH_AGE_R1121_LOCAL_PRIVATE_RUNNER_CONTRACT_PATH: paths.r1121Path,
          MURPH_AGE_R1127_ORDINARY_CONSUMER_SUBMISSION_HANDOFF_PATH: paths.r1127Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        ordinaryTableLayoutsSmokePassed: string[];
        productDisplayAuthorized: boolean;
        r1122Conclusion: string | null;
        reviewGptRequiredNow: boolean;
        rowParsingPerformedByR1128: boolean;
        syntheticEvidence: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_consumer_pipeline_smoke_passed_non_evidence",
        ordinaryTableLayoutsSmokePassed: ORDINARY_TABLE_LAYOUTS,
        productDisplayAuthorized: false,
        r1122Conclusion: "local_private_runner_config_ready_for_local_aggregate_receipt",
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1128: false,
        syntheticEvidence: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("synthetic-person");
      expect(stdout).not.toContain("glucose_value");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string): Promise<{
  r1113Path: string;
  r1121Path: string;
  r1127Path: string;
}> {
  const paths = {
    r1113Path: path.join(tmp, "r1113.json"),
    r1121Path: path.join(tmp, "r1121.json"),
    r1127Path: path.join(tmp, "r1127.json"),
  };
  await Promise.all([
    writeJson(paths.r1113Path, r1113Fixture()),
    writeJson(paths.r1121Path, r1121Fixture()),
    writeJson(paths.r1127Path, r1127Fixture()),
  ]);
  return paths;
}

function r1113Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1113-consumer-source-execution-packet",
    schemaVersion: "murph-age-r1113-consumer-source-execution-packet.v1",
    summary: {
      conclusion: "consumer_source_execution_packet_ready",
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
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
      conclusion: "local_private_consumer_receipt_runner_contract_ready_for_execution",
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      productDisplayAuthorized: false,
      rowParsingPerformedByR1121: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1127Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    ordinarySubmissionHandoff: {
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
    },
    packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1127-ordinary-consumer-first-pass-submission-handoff.v1",
    summary: {
      conclusion: "ordinary_consumer_first_pass_submission_handoff_ready",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1127: false,
      submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
    },
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    privateConfigPathStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
