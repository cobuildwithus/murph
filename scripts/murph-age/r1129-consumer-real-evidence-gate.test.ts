import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1129_CONSUMER_REAL_EVIDENCE_GATE_SCHEMA_VERSION,
  runR1129ConsumerRealEvidenceGate,
} from "./r1129-consumer-real-evidence-gate.ts";

const FIRST_PASS_CANDIDATE_IDS = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "QC_missingness_coverage",
];
const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
];
const ORDINARY_TABLE_LAYOUTS = ["single_primary_table_fallback", "multi_table_or_explicit_refs"];

describe("R1129 consumer real evidence gate", () => {
  it("keeps synthetic smoke and shadow context out of the real evidence gate", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1129-waiting-"));
    try {
      const paths = await writeInputs(tmp);

      const { output, outputPath } = await runR1129ConsumerRealEvidenceGate({
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1129-consumer-real-evidence-gate.latest.json");
      expect(output.schemaVersion).toBe(R1129_CONSUMER_REAL_EVIDENCE_GATE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "consumer_real_evidence_gate_waiting_on_real_labs_wearables_aggregate",
        nextAction: "collect_or_run_real_outcome_linked_labs_wearables_aggregate_metrics",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1129: false,
        topPriority: "real_outcome_linked_labs_wearables_for_average_16_50_user",
      });
      expect(output.realEvidenceGate).toMatchObject({
        acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
        firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
        missingFirstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
        priorityInputFamilies: ["bloodwork_labs", "vitals_body_context", "wearable_activity"],
        reviewGptUse: "only_after_real_r1124_r1104_delta",
        smokePassedTableLayouts: ORDINARY_TABLE_LAYOUTS,
        sourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        targetAgeBand: "roughly_16_50",
      });
      expect(output.realEvidenceGate.blockers).toEqual([
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
      ]);
      expect(output.realEvidenceGate.rejectedAsModelEvidence).toEqual([
        {
          artifact: "r1126-nhanes-shadow-first-pass-metric-adapter.latest.json",
          evidenceRole: "historical_nhanes_shadow_not_consumer_16_50_validation",
          reason: "historical_shadow_context_not_consumer_16_50_outcome_linked_validation",
        },
        {
          artifact: "r1128-ordinary-consumer-pipeline-smoke-proof.latest.json",
          evidenceRole: "pipeline_smoke_only_not_model_evidence",
          reason: "synthetic_pipeline_smoke_proof_not_model_evidence",
        },
      ]);
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

  it("opens ReviewGPT only when R1124 has a real aggregate delta", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1129-delta-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1124Path, r1124Fixture({
        aggregateMetricsProvided: true,
        conclusion: "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
        missingRequiredCandidateIds: [],
        nextAction: "send_aggregate_only_consumer_first_pass_delta_to_reviewgpt",
        r1104Conclusion: "aggregate_receipt_ready_for_reviewgpt",
        receiptArtifact: "r1124-consumer-first-pass-aggregate-receipt.json",
        reviewGptRequiredNow: true,
        submissionEvidenceRole: "real_first_pass_evidence",
      }));

      const { output } = await runR1129ConsumerRealEvidenceGate({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_real_evidence_gate_ready_for_reviewgpt_delta",
        nextAction: "send_real_consumer_first_pass_delta_to_reviewgpt",
        reviewGptRequiredNow: true,
      });
      expect(output.realEvidenceGate.blockers).toEqual([]);
      expect(output.realEvidenceGate.currentEvidence).toMatchObject({
        aggregateMetricsProvidedToR1124: true,
        firstPassReceiptArtifact: "r1124-consumer-first-pass-aggregate-receipt.json",
        r1124Conclusion: "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("records no-delta real receipts without promoting product display", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1129-no-delta-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1124Path, r1124Fixture({
        aggregateMetricsProvided: true,
        conclusion: "consumer_first_pass_aggregate_receipt_valid_but_no_delta",
        missingRequiredCandidateIds: [],
        nextAction: "record_no_delta_and_continue_consumer_receipt_search",
        r1104Conclusion: "aggregate_receipt_valid_but_no_delta",
        receiptArtifact: "r1124-consumer-first-pass-aggregate-receipt.json",
        submissionEvidenceRole: "real_first_pass_evidence",
      }));

      const { output } = await runR1129ConsumerRealEvidenceGate({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_real_evidence_gate_valid_no_delta_continue_source_search",
        nextAction: "record_no_delta_and_continue_consumer_receipt_search",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
      });
      expect(output.realEvidenceGate.blockers).toEqual([
        "stronger_or_independent_real_consumer_receipt_needed",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps R1124 smoke-only aggregate metrics behind the real evidence blocker", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1129-smoke-only-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1124Path, r1124Fixture({
        aggregateMetricsProvided: true,
        conclusion: "consumer_first_pass_aggregate_receipt_smoke_only_not_reviewgpt",
        missingRequiredCandidateIds: [],
        nextAction: "replace_smoke_metrics_with_real_outcome_linked_aggregate",
        r1104Conclusion: "aggregate_receipt_ready_for_reviewgpt",
        receiptArtifact: "r1124-consumer-first-pass-aggregate-receipt.json",
        submissionEvidenceRole: "synthetic_pipeline_smoke",
      }));

      const { output } = await runR1129ConsumerRealEvidenceGate({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_real_evidence_gate_waiting_on_real_labs_wearables_aggregate",
        nextAction: "collect_or_run_real_outcome_linked_labs_wearables_aggregate_metrics",
        reviewGptRequiredNow: false,
      });
      expect(output.realEvidenceGate.blockers).toEqual([
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_aggregate_metrics_not_real_first_pass_evidence",
      ]);
      expect(output.realEvidenceGate.currentEvidence.r1124SubmissionEvidenceRole).toBe("synthetic_pipeline_smoke");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for refresh when a required pipeline artifact is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1129-stale-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1128Path, {
        artifactBoundary: safeBoundary("R1128"),
        packetId: "r1128-ordinary-consumer-pipeline-smoke-proof",
        schemaVersion: "stale",
      });

      const { output } = await runR1129ConsumerRealEvidenceGate({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_real_evidence_gate_waiting_on_pipeline_refresh",
        nextAction: "refresh_r1101_r1124_r1125_r1127_r1128",
        reviewGptRequiredNow: false,
      });
      expect(output.realEvidenceGate.blockers).toEqual([
        "refresh_required_pipeline_artifacts_before_real_evidence_gate",
      ]);
      expect(output.inputArtifacts.r1128).toMatchObject({
        packetId: "r1128-ordinary-consumer-pipeline-smoke-proof",
        schemaVersion: null,
        status: "available",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1129-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1124Path, {
        ...r1124Fixture(),
        artifactBoundary: {
          ...safeBoundary("R1124"),
          rowValuesStored: true,
        },
      });

      await expect(runR1129ConsumerRealEvidenceGate({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1129 rejected unsafe r1124 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1129-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1129-consumer-real-evidence-gate.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1101_CONSUMER_LOOP_EXECUTOR_PATH: paths.r1101Path,
          MURPH_AGE_R1124_CONSUMER_FIRST_PASS_METRIC_INTAKE_PATH: paths.r1124Path,
          MURPH_AGE_R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_PATH: paths.r1125Path,
          MURPH_AGE_R1126_NHANES_SHADOW_FIRST_PASS_ADAPTER_PATH: paths.r1126Path,
          MURPH_AGE_R1127_ORDINARY_CONSUMER_SUBMISSION_HANDOFF_PATH: paths.r1127Path,
          MURPH_AGE_R1128_ORDINARY_CONSUMER_PIPELINE_SMOKE_PROOF_PATH: paths.r1128Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        blockers: string[];
        conclusion: string;
        productDisplayAuthorized: boolean;
        rejectedAsModelEvidence: string[];
        reviewGptRequiredNow: boolean;
        smokePassedTableLayouts: string[];
      };
      expect(summary).toMatchObject({
        blockers: [
          "real_outcome_linked_labs_wearables_aggregate_missing",
          "r1124_first_pass_aggregate_metrics_not_provided",
          "l1_l2_w1_qc_first_pass_metrics_incomplete",
        ],
        conclusion: "consumer_real_evidence_gate_waiting_on_real_labs_wearables_aggregate",
        productDisplayAuthorized: false,
        rejectedAsModelEvidence: [
          "r1126-nhanes-shadow-first-pass-metric-adapter.latest.json",
          "r1128-ordinary-consumer-pipeline-smoke-proof.latest.json",
        ],
        reviewGptRequiredNow: false,
        smokePassedTableLayouts: ORDINARY_TABLE_LAYOUTS,
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
  r1101Path: string;
  r1124Path: string;
  r1125Path: string;
  r1126Path: string;
  r1127Path: string;
  r1128Path: string;
}> {
  const paths = {
    r1101Path: path.join(tmp, "r1101.json"),
    r1124Path: path.join(tmp, "r1124.json"),
    r1125Path: path.join(tmp, "r1125.json"),
    r1126Path: path.join(tmp, "r1126.json"),
    r1127Path: path.join(tmp, "r1127.json"),
    r1128Path: path.join(tmp, "r1128.json"),
  };
  await Promise.all([
    writeJson(paths.r1101Path, r1101Fixture()),
    writeJson(paths.r1124Path, r1124Fixture()),
    writeJson(paths.r1125Path, r1125Fixture()),
    writeJson(paths.r1126Path, r1126Fixture()),
    writeJson(paths.r1127Path, r1127Fixture()),
    writeJson(paths.r1128Path, r1128Fixture()),
  ]);
  return paths;
}

function r1101Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1101"),
    packetId: "r1101-consumer-labs-wearables-loop-executor",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "consumer_loop_ready_awaiting_aggregate_receipt",
      firstPassAggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
      localPrivateFirstPassRunnerConclusion: "local_private_first_pass_runner_missing_config",
      missingFirstPassMetricCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      nextAction: "provide_r1125_private_runner_config_or_fill_r1124_template",
      ordinaryConsumerSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      ordinaryConsumerTableLayouts: ORDINARY_TABLE_LAYOUTS,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1101: false,
    },
  };
}

function r1124Fixture(overrides: {
  aggregateMetricsProvided?: boolean;
  conclusion?: string;
  missingRequiredCandidateIds?: string[];
  nextAction?: string;
  r1104Conclusion?: string | null;
  receiptArtifact?: string | null;
  reviewGptRequiredNow?: boolean;
  submissionEvidenceRole?: string | null;
} = {}): Record<string, unknown> {
  const conclusion = overrides.conclusion ?? "consumer_first_pass_aggregate_metrics_missing";
  return {
    artifactBoundary: safeBoundary("R1124"),
    metricIntake: {
      aggregateMetricsProvided: overrides.aggregateMetricsProvided ?? false,
      aggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
      candidateCountBand: overrides.aggregateMetricsProvided ? "1-9" : "0",
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      localPrivateConfigConclusion: "local_private_runner_config_waiting_on_private_config",
      missingRequiredCandidateIds: overrides.missingRequiredCandidateIds ?? FIRST_PASS_CANDIDATE_IDS,
      r1104Conclusion: overrides.r1104Conclusion ?? null,
      receiptArtifact: overrides.receiptArtifact ?? null,
      reviewGptRequiredNow: overrides.reviewGptRequiredNow ?? false,
      submissionEvidenceRole: overrides.submissionEvidenceRole ?? null,
    },
    packetId: "r1124-consumer-first-pass-aggregate-metric-intake",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1124-consumer-first-pass-aggregate-metric-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextAction: overrides.nextAction ?? "provide_l1_l2_w1_qc_aggregate_metrics_or_fill_private_config",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: overrides.reviewGptRequiredNow ?? false,
      rowParsingPerformedByR1124: false,
      topPriority: "consumer_labs_wearables_l1_l2_w1_first_pass",
    },
  };
}

function r1125Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1125"),
    packetId: "r1125-local-private-first-pass-aggregate-metric-runner",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1125-local-private-first-pass-aggregate-metric-runner.v1",
    status: "research-local-private-inputs-aggregate-output",
    summary: {
      conclusion: "local_private_first_pass_runner_missing_config",
      nextAction: "provide_private_runner_config",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowValuesStored: false,
    },
  };
}

function r1126Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1126"),
    packetId: "r1126-nhanes-shadow-first-pass-metric-adapter",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1126-nhanes-shadow-first-pass-metric-adapter.v1",
    shadowAdapter: {
      aggregateMetricsArtifact: "r1126-nhanes-shadow-first-pass-aggregate-metrics.json",
      evidenceRole: "historical_nhanes_shadow_not_consumer_16_50_validation",
      r1124FeedPolicy: "manual_shadow_only_do_not_replace_private_or_workbench_receipt",
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "nhanes_shadow_first_pass_metrics_ready_for_manual_context",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1126: false,
    },
  };
}

function r1127Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1127"),
    ordinarySubmissionHandoff: {
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      ordinaryTableLayouts: ORDINARY_TABLE_LAYOUTS,
      submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
    },
    packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1127-ordinary-consumer-first-pass-submission-handoff.v1",
    summary: {
      conclusion: "ordinary_consumer_first_pass_submission_handoff_ready",
      ordinarySourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1127: false,
      submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
    },
  };
}

function r1128Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1128"),
    packetId: "r1128-ordinary-consumer-pipeline-smoke-proof",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1128-ordinary-consumer-pipeline-smoke-proof.v1",
    smokeProof: {
      ordinaryTableLayoutsSmokePassed: ORDINARY_TABLE_LAYOUTS,
      r1122Conclusion: "local_private_runner_config_ready_for_local_aggregate_receipt",
      r1124ConclusionFromSyntheticRun: "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
      r1125Conclusion: "local_private_first_pass_runner_ready_for_reviewgpt_delta",
      syntheticEvidenceRole: "pipeline_smoke_only_not_model_evidence",
      syntheticRowsPersisted: false,
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_consumer_pipeline_smoke_passed_non_evidence",
      nextAction: "use_r1127_handoff_with_real_private_or_workbench_data",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1128: false,
      syntheticEvidence: false,
    },
  };
}

function safeBoundary(stage: "R1101" | "R1124" | "R1125" | "R1126" | "R1127" | "R1128"): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    [`outcomeScoringPerformedBy${stage}`]: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    [`rowParsingPerformedBy${stage}`]: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
    syntheticRowsPersisted: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
