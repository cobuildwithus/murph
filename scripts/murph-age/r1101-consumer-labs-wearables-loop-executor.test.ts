import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1101ConsumerLabsWearablesLoopExecutor } from "./r1101-consumer-labs-wearables-loop-executor.ts";

const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
];
const ORDINARY_TABLE_LAYOUTS = ["single_primary_table_fallback", "multi_table_or_explicit_refs"];

describe("R1101 consumer labs/wearables loop executor", () => {
  it("routes the active consumer loop to aggregate receipt collection when no receipt has landed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1101-"));
    const paths = await writeFixtures(tmp, "await_consumer_lab_wearable_aggregate_receipt");

    const { output } = await runR1101ConsumerLabsWearablesLoopExecutor({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "consumer_loop_ready_awaiting_aggregate_receipt",
      nextAction: "provide_r1125_private_runner_config_or_fill_r1124_template",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1101: false,
      firstWearableCandidate: "W1_activity_steps_minutes",
      firstPassAggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
      localPrivateFirstPassRunnerConclusion: "local_private_first_pass_runner_missing_config",
      missingFirstPassMetricCandidateIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ],
    });
    expect(output.loopState.consumerPriority).toBe("labs_vitals_body_wearables_for_roughly_16_50");
    expect(output.loopState.frozenLabCandidateFamily).toBe("tiny_glycemia_only");
    expect(output.loopState.firstWearableCandidate).toBe("W1_activity_steps_minutes");
    expect(output.loopState.firstPassAggregateMetricConclusion).toBe("consumer_first_pass_aggregate_metrics_missing");
    expect(output.loopState.firstPassAggregateMetricsTemplateArtifact).toBe("r1124-fillable-consumer-first-pass-aggregate-metrics.json");
    expect(output.loopState.firstPassMetricIntakeStatus).toBe("available");
    expect(output.loopState.localPrivateFirstPassRunnerConclusion).toBe("local_private_first_pass_runner_missing_config");
    expect(output.loopState.localPrivateFirstPassRunnerNextAction).toBe("provide_private_runner_config");
    expect(output.loopState.localPrivateFirstPassRunnerStatus).toBe("available");
    expect(output.loopState.nhanesShadowFirstPassAggregateMetricsArtifact).toBe(
      "r1126-nhanes-shadow-first-pass-aggregate-metrics.json",
    );
    expect(output.loopState.nhanesShadowFirstPassEvidenceRole).toBe(
      "historical_nhanes_shadow_not_consumer_16_50_validation",
    );
    expect(output.loopState.nhanesShadowFirstPassR1124FeedPolicy).toBe(
      "manual_shadow_only_do_not_replace_private_or_workbench_receipt",
    );
    expect(output.loopState.nhanesShadowFirstPassStatus).toBe("available");
    expect(output.loopState.ordinaryConsumerSubmissionHandoffConclusion).toBe(
      "ordinary_consumer_first_pass_submission_handoff_ready",
    );
    expect(output.loopState.ordinaryConsumerSubmissionHandoffPlanArtifact).toBe(
      "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
    );
    expect(output.loopState.ordinaryConsumerSourceFamilyIds).toEqual(ORDINARY_SOURCE_FAMILY_IDS);
    expect(output.loopState.ordinaryConsumerTableLayouts).toEqual(ORDINARY_TABLE_LAYOUTS);
    expect(output.loopState.ordinaryConsumerSubmissionHandoffStatus).toBe("available");
    expect(output.summary.ordinaryConsumerSubmissionHandoffPlanArtifact).toBe(
      "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
    );
    expect(output.summary.ordinaryConsumerSourceFamilyIds).toEqual(ORDINARY_SOURCE_FAMILY_IDS);
    expect(output.summary.ordinaryConsumerTableLayouts).toEqual(ORDINARY_TABLE_LAYOUTS);
    expect(output.loopState.firstPassCandidateIds).toEqual([
      "L1_tiny_glycemia_only",
      "L2_common_lab_core_shadow",
      "W1_activity_steps_minutes",
      "QC_missingness_coverage",
    ]);
    expect(output.loopState.wearableShadowArbitrationConclusion).toBe(
      "consumer_wearable_shadow_evidence_keep_w1_first_but_unvalidated",
    );
    expect(output.loopState.wearableShadowEvidenceStatus).toBe("available");
    expect(output.loopState.currentExecutableShadowFamilies).toContain("glycemia_hba1c_glucose");
    expect(output.loopState.trueWearableFamiliesBlocked).toContain("activity_steps_minutes");
    expect(output.nextLoop.actions.map((action) => action.actionId)).toContain("keep_wearables_blocked_until_outcome_linked_receipt");
    expect(output.nextLoop.actions.map((action) => action.actionId)).toContain("fill_r1124_first_pass_aggregate_metrics_template");
    expect(output.nextLoop.actions.map((action) => action.actionId)).toContain("provide_r1125_private_runner_config");
    expect(output.nextLoop.actions.map((action) => action.actionId)).toContain(
      "use_r1127_ordinary_consumer_submission_plan_for_r1125",
    );
    expect(output.nextLoop.actions.map((action) => action.actionId)).toContain(
      "keep_w1_activity_steps_minutes_as_first_wearable_candidate",
    );
    expect(output.nextLoop.actions.map((action) => action.actionId)).toContain(
      "carry_r1126_nhanes_shadow_first_pass_as_non_primary_context",
    );
    expect(output.nextLoop.commands.join(" ")).toContain("r1125-local-private-first-pass-aggregate-metric-runner");
    expect(output.nextLoop.commands.join(" ")).toContain("r1127-ordinary-consumer-first-pass-submission-handoff");
    expect(output.nextLoop.commands.join(" ")).toContain("r1124-consumer-first-pass-aggregate-metric-intake");
    expect(output.nextLoop.routeTargets.slice(0, 3)).toEqual([
      "all-of-us-fitbit-labs-ehr",
      "cardia-authorized-or-aggregate",
      "partner-aggregate-evaluator",
    ]);
  });

  it("routes a valid model delta to ReviewGPT without adding local approval gates", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1101-"));
    const paths = await writeFixtures(tmp, "send_consumer_lab_wearable_delta_to_reviewgpt");

    const { output } = await runR1101ConsumerLabsWearablesLoopExecutor({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "consumer_loop_ready_for_reviewgpt_delta",
      nextAction: "send_aggregate_only_consumer_lab_wearable_delta_to_reviewgpt",
      reviewGptRequiredNow: true,
    });
    expect(output.nextLoop.actions).toEqual([
      expect.objectContaining({
        actionId: "review_aggregate_delta",
        owner: "reviewgpt",
        status: "active_next",
      }),
    ]);
  });

  it("routes a valid R1124 first-pass receipt to ReviewGPT even before the older router refreshes", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1101-r1124-ready-"));
    const paths = await writeFixtures(
      tmp,
      "await_consumer_lab_wearable_aggregate_receipt",
      "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
    );

    const { output } = await runR1101ConsumerLabsWearablesLoopExecutor({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "consumer_loop_ready_for_reviewgpt_delta",
      nextAction: "send_aggregate_only_consumer_lab_wearable_delta_to_reviewgpt",
      reviewGptRequiredNow: true,
    });
    expect(output.loopState.firstPassAggregateMetricConclusion).toBe(
      "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
    );
    expect(output.nextLoop.actions).toEqual([
      expect.objectContaining({
        actionId: "review_aggregate_delta",
        owner: "reviewgpt",
        status: "active_next",
      }),
    ]);
  });

  it("records no-delta receipts as memory and continues source search", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1101-"));
    const paths = await writeFixtures(tmp, "hold_consumer_lab_wearable_receipt_no_model_change");

    const { output } = await runR1101ConsumerLabsWearablesLoopExecutor({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary.conclusion).toBe("consumer_loop_hold_no_delta_continue_source_search");
    expect(output.nextLoop.actions.map((action) => action.actionId)).toEqual([
      "append_no_delta_memory",
      "continue_source_search",
    ]);
  });

  it("rejects unsafe inputs before producing an executor state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1101-"));
    const paths = await writeFixtures(tmp, "await_consumer_lab_wearable_aggregate_receipt");
    await writeJson(paths.r1090Path, {
      packetId: "r1090-consumer-feature-registry-state",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1090-consumer-feature-registry-state.v1",
    });

    await expect(runR1101ConsumerLabsWearablesLoopExecutor({
      outputDir: path.join(tmp, "out"),
      ...paths,
    })).rejects.toThrow("R1101 rejected unsafe r1090 input");
  });
});

type RouterConclusion =
  | "await_consumer_lab_wearable_aggregate_receipt"
  | "send_consumer_lab_wearable_delta_to_reviewgpt"
  | "hold_consumer_lab_wearable_receipt_no_model_change";

async function writeFixtures(
  tmp: string,
  routerConclusion: RouterConclusion,
  r1124Conclusion: R1124Conclusion = "consumer_first_pass_aggregate_metrics_missing",
): Promise<{
  r608Path: string;
  r1089Path: string;
  r1090Path: string;
  r1099Path: string;
  r1123Path: string;
  r1124Path: string;
  r1125Path: string;
  r1126Path: string;
  r1127Path: string;
}> {
  const paths = {
    r608Path: path.join(tmp, "r608.json"),
    r1089Path: path.join(tmp, "r1089.json"),
    r1090Path: path.join(tmp, "r1090.json"),
    r1099Path: path.join(tmp, "r1099.json"),
    r1123Path: path.join(tmp, "r1123.json"),
    r1124Path: path.join(tmp, "r1124.json"),
    r1125Path: path.join(tmp, "r1125.json"),
    r1126Path: path.join(tmp, "r1126.json"),
    r1127Path: path.join(tmp, "r1127.json"),
  };
  await Promise.all([
    writeJson(paths.r608Path, r608Fixture()),
    writeJson(paths.r1089Path, r1089Fixture()),
    writeJson(paths.r1090Path, r1090Fixture()),
    writeJson(paths.r1099Path, r1099Fixture(routerConclusion)),
    writeJson(paths.r1123Path, r1123Fixture()),
    writeJson(paths.r1124Path, r1124Fixture(r1124Conclusion)),
    writeJson(paths.r1125Path, r1125Fixture()),
    writeJson(paths.r1126Path, r1126Fixture()),
    writeJson(paths.r1127Path, r1127Fixture()),
  ]);
  return paths;
}

type R1124Conclusion =
  | "consumer_first_pass_aggregate_metrics_missing"
  | "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt"
  | "consumer_first_pass_aggregate_receipt_valid_but_no_delta";

function r608Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    candidateFamily: {
      familyId: "tiny_glycemia_only",
    },
    packetId: "r608-freeze-glycemia-candidate",
    schemaVersion: "murph-age-r608-freeze-glycemia-candidate.v1",
  };
}

function r1089Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1089-labs-wearables-candidate-batch-manifest",
    schemaVersion: "murph-age-r1089-labs-wearables-candidate-batch-manifest.v1",
    summary: {
      conclusion: "labs_wearables_batch_ready",
    },
  };
}

function r1090Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1090-consumer-feature-registry-state",
    schemaVersion: "murph-age-r1090-consumer-feature-registry-state.v1",
    summary: {
      currentExecutableShadowFamilies: [
        "glycemia_hba1c_glucose",
        "lipids_triglycerides_cholesterol",
        "blood_pressure_vitals",
        "body_composition",
      ],
      trueWearableFamiliesBlocked: [
        "activity_steps_minutes",
        "sleep_duration_regularity",
        "resting_hr_recovery",
        "wearable_hrv_quality_gated",
      ],
    },
  };
}

function r1099Fixture(routerConclusion: RouterConclusion): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    nextLoop: {
      routeTargets: [
        "all-of-us-fitbit-labs-ehr",
        "partner-aggregate-evaluator",
        "midus-biomarker-mortality",
      ],
    },
    packetId: "r1099-consumer-lab-wearable-receipt-action-router",
    schemaVersion: "murph-age-r1099-consumer-lab-wearable-receipt-action-router.v1",
    summary: {
      conclusion: routerConclusion,
      productDisplayAuthorized: false,
      rowParsingPerformedByR1099: false,
    },
  };
}

function r1123Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1123-consumer-wearable-shadow-evidence-arbitration",
    schemaVersion: "murph-age-r1123-consumer-wearable-shadow-evidence-arbitration.v1",
    summary: {
      conclusion: "consumer_wearable_shadow_evidence_keep_w1_first_but_unvalidated",
      firstWearableCandidate: "W1_activity_steps_minutes",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1123: false,
      topLabCandidate: "L1_tiny_glycemia_only",
    },
  };
}

function r1124Fixture(conclusion: R1124Conclusion): Record<string, unknown> {
  const metricsMissing = conclusion === "consumer_first_pass_aggregate_metrics_missing";
  return {
    artifactBoundary: safeBoundary(),
    metricIntake: {
      aggregateMetricsProvided: !metricsMissing,
      aggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
      candidateCountBand: metricsMissing ? "0" : "1-9",
      firstPassCandidateIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ],
      missingRequiredCandidateIds: metricsMissing
        ? [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ]
        : [],
      r1104Conclusion: metricsMissing
        ? null
        : conclusion === "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt"
          ? "aggregate_receipt_ready_for_reviewgpt"
          : "aggregate_receipt_valid_but_no_delta",
      receiptArtifact: metricsMissing ? null : "r1124-consumer-first-pass-aggregate-receipt.json",
      reviewGptRequiredNow: conclusion === "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
    },
    packetId: "r1124-consumer-first-pass-aggregate-metric-intake",
    schemaVersion: "murph-age-r1124-consumer-first-pass-aggregate-metric-intake.v1",
    summary: {
      conclusion,
      nextAction: metricsMissing
        ? "provide_l1_l2_w1_qc_aggregate_metrics_or_fill_private_config"
        : conclusion === "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt"
          ? "send_aggregate_only_consumer_first_pass_delta_to_reviewgpt"
          : "record_no_delta_and_continue_consumer_receipt_search",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: conclusion === "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
      rowParsingPerformedByR1124: false,
    },
  };
}

function r1125Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1125-local-private-first-pass-aggregate-metric-runner",
    privateExecution: {
      aggregateMetricsArtifact: null,
    },
    schemaVersion: "murph-age-r1125-local-private-first-pass-aggregate-metric-runner.v1",
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
    artifactBoundary: safeBoundary(),
    packetId: "r1126-nhanes-shadow-first-pass-metric-adapter",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1126-nhanes-shadow-first-pass-metric-adapter.v1",
    shadowAdapter: {
      aggregateMetricsArtifact: "r1126-nhanes-shadow-first-pass-aggregate-metrics.json",
      evidenceRole: "historical_nhanes_shadow_not_consumer_16_50_validation",
      r1124FeedPolicy: "manual_shadow_only_do_not_replace_private_or_workbench_receipt",
      reviewGptRequiredNow: false,
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "nhanes_shadow_first_pass_metrics_ready_not_primary_consumer_validation",
      nextAction: "keep_r1125_private_or_workbench_receipt_as_primary",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1126: false,
    },
  };
}

function r1127Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    ordinarySubmissionHandoff: {
      ordinaryTableLayouts: ORDINARY_TABLE_LAYOUTS,
      submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
    },
    packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1127-ordinary-consumer-first-pass-submission-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_consumer_first_pass_submission_handoff_ready",
      nextAction: "fill_private_config_with_ordinary_labs_wearable_refs_then_run_r1125",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1127: false,
      ordinarySourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
