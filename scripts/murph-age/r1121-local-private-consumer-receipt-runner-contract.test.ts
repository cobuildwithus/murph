import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1121_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONTRACT_SCHEMA_VERSION,
  runR1121LocalPrivateConsumerReceiptRunnerContract,
} from "./r1121-local-private-consumer-receipt-runner-contract.ts";

const R1125_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts";
const ACCEPTED_PRIVATE_TABLE_LAYOUTS = ["single_primary_table_fallback", "multi_table_or_explicit_refs"];

describe("R1121 local private consumer receipt runner contract", () => {
  it("creates a consumer-first private runner contract while awaiting private mapping", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1121-awaiting-"));
    try {
      const paths = await writeInputs(tmp, { mappingReady: false });

      const { output, privateRunnerConfigTemplatePath } = await runR1121LocalPrivateConsumerReceiptRunnerContract({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });
      const template = JSON.parse(await readFile(privateRunnerConfigTemplatePath, "utf8")) as {
        acceptedPrivateTableLayouts: string[];
        aggregateReceiptTarget: {
          localPrivateFirstPassRunnerCommand: string;
          validationCommand: string;
        };
        candidateRunOrder: Array<{ candidateId: string; runPhase: string; runPolicy: string }>;
        deferredCandidateIds: string[];
        firstPassCandidateIds: string[];
        privateFieldRefs: Record<string, string>;
        privateTableRefs: Record<string, string>;
        schemaVersion: string;
        singlePrimaryTableFallback: {
          accepted: boolean;
          minimumTableRef: string;
        };
        submissionContext: {
          evidenceRole: string;
          targetAgeBand: string;
        };
      };

      expect(output.schemaVersion).toBe(R1121_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONTRACT_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "local_private_consumer_receipt_runner_contract_ready_awaiting_mapping",
        nextAction: "fill_private_mapping_and_runner_config_for_l1_l2_w1",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1121: false,
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        topCandidate: "L1_tiny_glycemia_only",
      });
      expect(output.localPrivateRunner.candidateRunOrder.map((candidate) => candidate.candidateId)).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
        "W2_sleep_duration_regularity",
        "W3_rhr_hrv_recovery",
        "I1_integrated_lab_wearable_small_panel",
      ]);
      expect(output.localPrivateRunner.firstPassCandidateIds).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ]);
      expect(output.localPrivateRunner.acceptedPrivateTableLayouts).toEqual(ACCEPTED_PRIVATE_TABLE_LAYOUTS);
      expect(output.localPrivateRunner.localPrivateFirstPassRunnerCommand).toBe(R1125_COMMAND);
      expect(output.localPrivateRunner.validationCommand).toBe(R1125_COMMAND);
      expect(output.localPrivateRunner.deferredCandidateIds).toEqual([
        "W2_sleep_duration_regularity",
        "W3_rhr_hrv_recovery",
        "I1_integrated_lab_wearable_small_panel",
      ]);
      expect(output.localPrivateRunner.candidateRunOrder.map((candidate) => candidate.runPhase)).toEqual([
        "first_pass",
        "first_pass",
        "first_pass",
        "first_pass",
        "deferred_until_first_pass_receipt",
        "deferred_until_first_pass_receipt",
        "deferred_until_components_pass",
      ]);
      expect(template.schemaVersion).toBe("murph-age-local-private-consumer-receipt-runner-config.v1");
      expect(template.acceptedPrivateTableLayouts).toEqual(ACCEPTED_PRIVATE_TABLE_LAYOUTS);
      expect(template.singlePrimaryTableFallback).toEqual({
        accepted: true,
        minimumTableRef: "primaryTableRef",
      });
      expect(template.firstPassCandidateIds).toEqual(output.localPrivateRunner.firstPassCandidateIds);
      expect(template.deferredCandidateIds).toEqual(output.localPrivateRunner.deferredCandidateIds);
      expect(template.candidateRunOrder[0]).toMatchObject({
        candidateId: "L1_tiny_glycemia_only",
        runPolicy: "first_score_bearing_if_outcome_linked",
        runPhase: "first_pass",
      });
      expect(template.aggregateReceiptTarget.localPrivateFirstPassRunnerCommand).toBe(R1125_COMMAND);
      expect(template.aggregateReceiptTarget.validationCommand).toBe(
        "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts",
      );
      expect(template.submissionContext).toMatchObject({
        evidenceRole: "real_first_pass_evidence",
        targetAgeBand: "roughly_16_50",
      });
      expect(Object.values(template.privateFieldRefs).every((value) => value === "")).toBe(true);
      expect(Object.values(template.privateTableRefs).every((value) => value === "")).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(template)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the contract executable when private semantic mapping is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1121-ready-"));
    try {
      const paths = await writeInputs(tmp, { mappingReady: true });

      const { output } = await runR1121LocalPrivateConsumerReceiptRunnerContract({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_consumer_receipt_runner_contract_ready_for_execution",
        nextAction: "run_local_private_l1_l2_wearable_first_pass_to_aggregate_receipt",
        reviewGptRequiredNow: false,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the lab/vitals arbitration is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1121-stale-"));
    try {
      const paths = await writeInputs(tmp, { mappingReady: false });
      await writeJson(paths.r1120Path, {
        artifactBoundary: safeBoundary(),
        packetId: "r1120-consumer-lab-vitals-shadow-arbitration",
        schemaVersion: "stale",
        summary: {
          conclusion: "consumer_lab_vitals_shadow_arbitration_l1_first",
        },
      });

      const { output } = await runR1121LocalPrivateConsumerReceiptRunnerContract({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_consumer_receipt_runner_contract_waiting_on_inputs",
        nextAction: "refresh_consumer_manifest_handoff_mapping_and_arbitration",
      });
      expect(output.inputArtifacts.r1120.schemaVersion).toBeNull();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the first-pass source packet is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1121-stale-source-packet-"));
    try {
      const paths = await writeInputs(tmp, { mappingReady: false });
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

      const { output } = await runR1121LocalPrivateConsumerReceiptRunnerContract({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_consumer_receipt_runner_contract_waiting_on_inputs",
        nextAction: "refresh_consumer_manifest_handoff_mapping_and_arbitration",
      });
      expect(output.inputArtifacts.r1113.schemaVersion).toBeNull();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1121-unsafe-"));
    try {
      const paths = await writeInputs(tmp, { mappingReady: false });
      await writeJson(paths.r1106Path, {
        artifactBoundary: {
          aggregateOnly: true,
          rowValuesStored: true,
        },
        packetId: "r1106-consumer-aggregate-handoff-bundle",
        schemaVersion: "murph-age-r1106-consumer-aggregate-handoff-bundle.v1",
      });

      await expect(runR1121LocalPrivateConsumerReceiptRunnerContract({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1121 rejected unsafe r1106 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1121-cli-"));
    try {
      const paths = await writeInputs(tmp, { mappingReady: false });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1121-local-private-consumer-receipt-runner-contract.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1103_CONSUMER_CANDIDATE_MANIFEST_PATH: paths.r1103Path,
          MURPH_AGE_R1106_CONSUMER_HANDOFF_BUNDLE_PATH: paths.r1106Path,
          MURPH_AGE_R1115_PRIVATE_HEADER_MAPPING_INTAKE_PATH: paths.r1115Path,
          MURPH_AGE_R1116_PRIVATE_HEADER_MAPPING_TEMPLATE_PATH: paths.r1116Path,
          MURPH_AGE_R1113_CONSUMER_SOURCE_EXECUTION_PACKET_PATH: paths.r1113Path,
          MURPH_AGE_R1120_LAB_VITALS_ARBITRATION_PATH: paths.r1120Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        firstPassCandidateIds: string[];
        targetInputPriority: string;
        topCandidate: string;
      };
      expect(summary).toMatchObject({
        conclusion: "local_private_consumer_receipt_runner_contract_ready_awaiting_mapping",
        firstPassCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        topCandidate: "L1_tiny_glycemia_only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant_id");
      expect(stdout).not.toContain("W1C_");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(
  tmp: string,
  options: { mappingReady: boolean },
): Promise<{
  r1103Path: string;
  r1106Path: string;
  r1115Path: string;
  r1116Path: string;
  r1113Path: string;
  r1120Path: string;
}> {
  const paths = {
    r1103Path: path.join(tmp, "r1103.json"),
    r1106Path: path.join(tmp, "r1106.json"),
    r1115Path: path.join(tmp, "r1115.json"),
    r1116Path: path.join(tmp, "r1116.json"),
    r1113Path: path.join(tmp, "r1113.json"),
    r1120Path: path.join(tmp, "r1120.json"),
  };
  await Promise.all([
    writeJson(paths.r1103Path, packetFixture(
      "r1103-consumer-candidate-family-manifest",
      "murph-age-r1103-consumer-candidate-family-manifest.v1",
      { conclusion: "consumer_candidate_family_manifest_ready" },
    )),
    writeJson(paths.r1106Path, packetFixture(
      "r1106-consumer-aggregate-handoff-bundle",
      "murph-age-r1106-consumer-aggregate-handoff-bundle.v1",
      { conclusion: "consumer_aggregate_handoff_ready" },
    )),
    writeJson(paths.r1115Path, packetFixture(
      "r1115-local-private-header-mapping-intake",
      "murph-age-r1115-local-private-header-mapping-intake.v1",
      {
        conclusion: options.mappingReady
          ? "local_private_header_mapping_ready_for_local_aggregate_receipt"
          : "local_private_header_mapping_not_provided",
      },
    )),
    writeJson(paths.r1116Path, packetFixture(
      "r1116-local-private-header-mapping-template",
      "murph-age-r1116-local-private-header-mapping-template.v1",
      { conclusion: "local_private_header_mapping_template_ready" },
    )),
    writeJson(paths.r1113Path, {
      artifactBoundary: safeBoundary(),
      executionPacket: {
        sourceTargets: [
          {
            minimumAggregateReceipt: {
              deferredCandidateIds: [
                "W2_sleep_duration_regularity",
                "W3_rhr_hrv_recovery",
                "I1_integrated_lab_wearable_small_panel",
              ],
            },
          },
        ],
      },
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
      },
    }),
    writeJson(paths.r1120Path, packetFixture(
      "r1120-consumer-lab-vitals-shadow-arbitration",
      "murph-age-r1120-consumer-lab-vitals-shadow-arbitration.v1",
      { conclusion: "consumer_lab_vitals_shadow_arbitration_l1_first" },
    )),
  ]);
  return paths;
}

function packetFixture(packetId: string, schemaVersion: string, summary: Record<string, unknown>): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId,
    schemaVersion,
    summary: {
      productDisplayAuthorized: false,
      ...summary,
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
