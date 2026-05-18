import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1075_CURRENT_AUTORESEARCH_ACTION_ROUTER_SCHEMA_VERSION,
  runR1075CurrentAutoresearchActionRouter,
} from "./r1075-current-autoresearch-action-router.ts";

const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
];
const ORDINARY_TABLE_LAYOUTS = ["single_primary_table_fallback", "multi_table_or_explicit_refs"];

describe("R1075 current autoresearch action router", () => {
  it("routes the current loop to true-wearable data acquisition when shadow evidence is ready but data is blocked", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1075-data-"));
    try {
      const paths = await writeInputs(tmp, {
        r1057NextAction: "prepare_true_wearable_or_partner_validation_loop",
        r1057Review: false,
        r1074NextAction: "download_nsrr_derived_files_or_secure_workbench_access",
        r1074Review: false,
      });
      const { output, outputPath } = await runR1075CurrentAutoresearchActionRouter({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1075-current-autoresearch-action-router.latest.json");
      expect(output.schemaVersion).toBe(R1075_CURRENT_AUTORESEARCH_ACTION_ROUTER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "current_loop_blocked_on_true_wearable_data",
        nextAction: "download_nsrr_or_secure_workbench_access",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1075: false,
      });
      expect(output.nextLoop.commands.join("\n")).toContain("after human NSRR terms/access activation");
      expect(output.nextLoop.commands.join("\n")).toContain("nsrr download shhs/datasets");
      expect(output.nextLoop.commands).toContain("pnpm exec tsx scripts/murph-age/r1074-true-wearable-post-download-refresh.ts");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes ready NSRR cohort state to aggregate receipt fill without ReviewGPT", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1075-receipt-"));
    try {
      const paths = await writeInputs(tmp, {
        r1057NextAction: "prepare_true_wearable_or_partner_validation_loop",
        r1057Review: false,
        r1074NextAction: "fill_nsrr_aggregate_receipt",
        r1074Review: false,
      });
      const { output } = await runR1075CurrentAutoresearchActionRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "current_loop_ready_for_nsrr_aggregate_receipt",
        nextAction: "fill_nsrr_aggregate_receipt_or_run_local_evaluator",
        reviewGptRequiredNow: false,
      });
      expect(output.nextLoop.commands[0]).toContain("r1081-nsrr-source-table-candidate-scanner.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("r1080-nsrr-standardizer-manifest-scaffold.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("r1082-nsrr-standardizer-manifest-readiness.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("r1079-nsrr-sleep-autonomic-standardizer.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("r1078-nsrr-sleep-autonomic-local-loop.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prioritizes consumer labs and wearable first-pass aggregate metrics over stale NSRR routing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1075-consumer-first-pass-"));
    try {
      const paths = await writeInputs(tmp, {
        consumerLoopConclusion: "consumer_loop_ready_awaiting_aggregate_receipt",
        consumerLoopNextAction: "fill_r1124_first_pass_aggregate_metrics_template",
        r1057NextAction: "prepare_true_wearable_or_partner_validation_loop",
        r1057Review: false,
        r1074NextAction: "download_nsrr_derived_files_or_secure_workbench_access",
        r1074Review: false,
      });
      const { output } = await runR1075CurrentAutoresearchActionRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "current_loop_ready_for_consumer_first_pass_aggregate_metrics",
        consumerFirstPassAggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
        consumerFirstWearableCandidate: "W1_activity_steps_minutes",
        nextAction: "fill_consumer_first_pass_aggregate_metrics_template",
        reviewGptRequiredNow: false,
      });
      expect(output.summary.consumerMissingFirstPassMetricCandidateIds).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ]);
      expect(output.summary.consumerNhanesShadowFirstPassAggregateMetricsArtifact).toBe(
        "r1126-nhanes-shadow-first-pass-aggregate-metrics.json",
      );
      expect(output.summary.consumerNhanesShadowFirstPassEvidenceRole).toBe(
        "historical_nhanes_shadow_not_consumer_16_50_validation",
      );
      expect(output.summary.consumerOrdinarySubmissionHandoffPlanArtifact).toBe(
        "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
      );
      expect(output.summary.consumerOrdinarySourceFamilyIds).toEqual(ORDINARY_SOURCE_FAMILY_IDS);
      expect(output.summary.consumerOrdinaryTableLayouts).toEqual(ORDINARY_TABLE_LAYOUTS);
      expect(output.nextLoop.commands.join("\n")).toContain("r1124-fillable consumer first-pass aggregate metrics template");
      expect(output.nextLoop.commands.join("\n")).toContain("MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH");
      expect(output.nextLoop.commands.join("\n")).not.toContain("nsrr download");
      expect(output.currentState.consumerPriority).toBe("labs_vitals_body_wearables_for_roughly_16_50");
      expect(output.currentState.consumerNhanesShadowFirstPassEvidenceRole).toBe(
        "historical_nhanes_shadow_not_consumer_16_50_validation",
      );
      expect(output.currentState.consumerOrdinarySubmissionHandoffPlanArtifact).toBe(
        "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
      );
      expect(output.currentState.consumerOrdinarySourceFamilyIds).toEqual(ORDINARY_SOURCE_FAMILY_IDS);
      expect(output.currentState.consumerOrdinaryTableLayouts).toEqual(ORDINARY_TABLE_LAYOUTS);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes the current function sidecar into local missingness/calibration adjudication", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1075-function-adjudication-"));
    try {
      const paths = await writeInputs(tmp, {
        r1057NextAction: "prepare_true_wearable_or_partner_validation_loop",
        r1057Review: false,
        r1074NextAction: "download_nsrr_derived_files_or_secure_workbench_access",
        r1074Review: false,
        r1083NextAction: "run_ordered_function_missingness_calibration_loop",
      });
      const { output } = await runR1075CurrentAutoresearchActionRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "current_loop_ready_for_function_adjudication",
        nextAction: "run_function_missingness_calibration_adjudication",
        reviewGptRequiredNow: false,
      });
      expect(output.currentState.r1083NextLocalAction).toBe("run_ordered_function_missingness_calibration_loop");
      expect(output.nextLoop.commands[0]).toContain("r1083-function-missingness-calibration-adjudication.ts");
      expect(output.nextLoop.reviewGptUse).toBe("only_for_real_aggregate_delta_or_major_architecture_fork");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("moves past function adjudication once HAALSI adjudication is supportive", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1075-haalsi-support-"));
    try {
      const paths = await writeInputs(tmp, {
        r1057NextAction: "prepare_true_wearable_or_partner_validation_loop",
        r1057Review: false,
        r1074NextAction: "download_nsrr_derived_files_or_secure_workbench_access",
        r1074Review: false,
        r1083NextAction: "run_ordered_function_missingness_calibration_loop",
        r1084NextAction: "keep_function_lead_seek_fresh_function_source_or_true_wearable",
      });
      const { output } = await runR1075CurrentAutoresearchActionRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "current_loop_blocked_on_true_wearable_data",
        nextAction: "download_nsrr_or_secure_workbench_access",
        reviewGptRequiredNow: false,
      });
      expect(output.currentState.r1084NextLocalAction).toBe("keep_function_lead_seek_fresh_function_source_or_true_wearable");
      expect(output.nextLoop.commands.join("\n")).toContain("nsrr download shhs/datasets");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes true wearable or partner aggregate deltas to ReviewGPT", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1075-review-"));
    try {
      const paths = await writeInputs(tmp, {
        r1057NextAction: "prepare_true_wearable_or_partner_validation_loop",
        r1057Review: false,
        r1074NextAction: "send_nsrr_delta_to_reviewgpt",
        r1074Review: true,
      });
      const { output } = await runR1075CurrentAutoresearchActionRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "current_loop_ready_for_reviewgpt_scientific_delta",
        nextAction: "send_real_aggregate_delta_to_reviewgpt",
        reviewGptRequiredNow: true,
      });
      expect(output.nextLoop.commands.join("\n")).toContain("aggregate-only delta packet");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when the direction chain is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1075-repair-"));
    try {
      const paths = await writeInputs(tmp, {
        r1057NextAction: "repair_candidate_batch_inputs",
        r1057Review: false,
        r1074NextAction: "download_nsrr_derived_files_or_secure_workbench_access",
        r1074Review: false,
      });
      const { output } = await runR1075CurrentAutoresearchActionRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "current_loop_repair_direction_inputs",
        nextAction: "repair_r1055_r1056_r1057_direction_chain",
        reviewGptRequiredNow: false,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1075-cli-"));
    try {
      const paths = await writeInputs(tmp, {
        r1057NextAction: "prepare_true_wearable_or_partner_validation_loop",
        r1057Review: false,
        r1074NextAction: "download_nsrr_derived_files_or_secure_workbench_access",
        r1074Review: false,
      });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1075-current-autoresearch-action-router.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1057_FUNCTION_ACTIVITY_BATCH_RESULT_PATH: paths.r1057Path,
          MURPH_AGE_R1074_TRUE_WEARABLE_REFRESH_PATH: paths.r1074Path,
          MURPH_AGE_R1083_FUNCTION_ADJUDICATION_PATH: paths.r1083Path,
          MURPH_AGE_R1084_HAALSI_FUNCTION_ADJUDICATION_PATH: paths.r1084Path,
          MURPH_AGE_R1101_CONSUMER_LOOP_EXECUTOR_PATH: paths.r1101Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toMatchObject({
        conclusion: "current_loop_blocked_on_true_wearable_data",
        nextAction: "download_nsrr_or_secure_workbench_access",
        packetId: "r1075-current-autoresearch-action-router",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(
  tmp: string,
  options: {
    consumerLoopConclusion?:
      | "consumer_loop_ready_awaiting_aggregate_receipt"
      | "consumer_loop_ready_for_reviewgpt_delta"
      | "consumer_loop_hold_no_delta_continue_source_search"
      | "consumer_loop_repair_inputs";
    consumerLoopNextAction?:
      | "fill_r1124_first_pass_aggregate_metrics_template"
      | "collect_or_run_consumer_lab_wearable_aggregate_receipt"
      | "send_aggregate_only_consumer_lab_wearable_delta_to_reviewgpt"
      | "record_no_delta_memory_and_continue_consumer_source_search"
      | "repair_consumer_lab_wearable_chain";
    r1057NextAction:
      | "prepare_true_wearable_or_partner_validation_loop"
      | "repair_candidate_batch_inputs";
    r1057Review: boolean;
    r1074NextAction:
      | "download_nsrr_derived_files_or_secure_workbench_access"
      | "fill_nsrr_aggregate_receipt"
      | "send_nsrr_delta_to_reviewgpt";
    r1074Review: boolean;
    r1083NextAction?:
      | "await_valid_function_transport_aggregate"
      | "hold_function_family_and_redirect_next_source"
      | "run_ordered_function_missingness_calibration_loop"
      | "seek_fresh_function_source_or_true_wearable_validation";
    r1084NextAction?:
      | "await_haalsi_aggregate"
      | "hold_function_content_and_redirect_candidate_generation"
      | "keep_function_lead_seek_fresh_function_source_or_true_wearable";
  },
): Promise<{ r1057Path: string; r1074Path: string; r1083Path: string; r1084Path: string; r1101Path: string }> {
  const r1057Path = path.join(tmp, "r1057.json");
  const r1074Path = path.join(tmp, "r1074.json");
  const r1083Path = path.join(tmp, "r1083.json");
  const r1084Path = path.join(tmp, "r1084.json");
  const r1101Path = path.join(tmp, "r1101.json");
  await Promise.all([
    writeFile(r1057Path, `${JSON.stringify(r1057Fixture(options.r1057NextAction, options.r1057Review))}\n`),
    writeFile(r1074Path, `${JSON.stringify(r1074Fixture(options.r1074NextAction, options.r1074Review))}\n`),
    writeFile(r1083Path, `${JSON.stringify(r1083Fixture(
      options.r1083NextAction ?? "seek_fresh_function_source_or_true_wearable_validation",
    ))}\n`),
    writeFile(r1084Path, `${JSON.stringify(r1084Fixture(
      options.r1084NextAction ?? "await_haalsi_aggregate",
    ))}\n`),
    writeFile(r1101Path, `${JSON.stringify(r1101Fixture(
      options.consumerLoopConclusion ?? "consumer_loop_repair_inputs",
      options.consumerLoopNextAction ?? "repair_consumer_lab_wearable_chain",
    ))}\n`),
  ]);
  return { r1057Path, r1074Path, r1083Path, r1084Path, r1101Path };
}

function r1057Fixture(nextAction: string, reviewRequired: boolean) {
  return {
    artifactBoundary: safeBoundary("R1057"),
    batchResult: {
      nextLocalAction: nextAction,
      reviewGptRequiredBeforeNextLocalRun: reviewRequired,
    },
    packetId: "r1057-function-activity-pulse-candidate-batch-result",
    schemaVersion: "murph-age-r1057-function-activity-pulse-candidate-batch-result.v1",
    status: "research-local-aggregate-only",
    summary: {
      currentLead: "function_activity_mobility_shadow",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1057: false,
    },
  };
}

function r1074Fixture(nextAction: string, reviewRequired: boolean) {
  return {
    artifactBoundary: safeBoundary("R1074"),
    finalHandoff: {
      dataAsk: nextAction === "download_nsrr_derived_files_or_secure_workbench_access"
        ? "Download NSRR derived sleep-cohort tables or secure All of Us/UKB workbench access for aggregate evaluation."
        : "No more download needed for this branch.",
      nextAction,
      reviewGptRequiredNow: reviewRequired,
    },
    packetId: "r1074-true-wearable-post-download-refresh",
    schemaVersion: "murph-age-r1074-true-wearable-post-download-refresh.v1",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      rowParsingPerformedByR1074: false,
    },
  };
}

function r1083Fixture(nextAction: string) {
  return {
    artifactBoundary: safeBoundary("R1083"),
    decision: {
      nextLocalAction: nextAction,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
    },
    packetId: "r1083-function-missingness-calibration-adjudication",
    schemaVersion: "murph-age-r1083-function-missingness-calibration-adjudication.v1",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      rowParsingPerformedByR1083: false,
    },
  };
}

function r1084Fixture(nextAction: string) {
  return {
    artifactBoundary: safeBoundary("R1084"),
    nextLocalAction: nextAction,
    packetId: "r1084-haalsi-function-missingness-calibration-adjudication",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1084-haalsi-function-missingness-calibration-adjudication.v1",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      rowParsingPerformedByR1084: false,
    },
  };
}

function r1101Fixture(conclusion: string, nextAction: string) {
  return {
    artifactBoundary: safeBoundary("R1101"),
    loopState: {
      consumerPriority: "labs_vitals_body_wearables_for_roughly_16_50",
    },
    packetId: "r1101-consumer-labs-wearables-loop-executor",
    schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      firstPassAggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
      firstWearableCandidate: "W1_activity_steps_minutes",
      missingFirstPassMetricCandidateIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ],
      nextAction,
      nhanesShadowFirstPassAggregateMetricsArtifact: "r1126-nhanes-shadow-first-pass-aggregate-metrics.json",
      nhanesShadowFirstPassEvidenceRole: "historical_nhanes_shadow_not_consumer_16_50_validation",
      ordinaryConsumerSubmissionHandoffPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
      ordinaryConsumerSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      ordinaryConsumerTableLayouts: ORDINARY_TABLE_LAYOUTS,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: conclusion === "consumer_loop_ready_for_reviewgpt_delta",
      rowParsingPerformedByR1101: false,
    },
  };
}

function safeBoundary(stage: "R1057" | "R1074" | "R1083" | "R1084" | "R1101") {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    [`outcomeScoringPerformedBy${stage}`]: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    [`rowParsingPerformedBy${stage}`]: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}
