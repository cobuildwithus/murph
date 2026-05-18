import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1177_ORDINARY_CONSUMER_AVERAGE_SUBMITTER_PRIORITY_PACKET_SCHEMA_VERSION,
} from "./r1177-ordinary-consumer-average-submitter-priority-packet.ts";
import {
  R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_SCHEMA_VERSION,
  runR1178AverageSubmitterCurrentLoopSurfacing,
} from "./r1178-average-submitter-current-loop-surfacing.ts";

const CREATED_AT = "2026-05-18T18:45:00.000Z";
const MINIMUM_FEATURE_PAIR = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const REQUIRED_INPUT_KINDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const OPTIONAL_CONTEXT = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED = [
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_sleep",
  "wearable_recovery",
  "wearable_hrv",
  "advanced_biomarkers",
] as const;
const FIRST_SUBMITTER_ASKS = [
  "has_glycemia_bloodwork_export",
  "has_daily_wearable_activity_export",
  "can_confirm_without_private_values",
] as const;
const SAFE_COMPLETION_CHECKLIST = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const BLOCKED_REQUIREMENTS = [
  "row_owner_availability_assertions_confirmed",
  "confirmed_recipe_route_requirements_available",
  "private_route_config_supplied",
  "real_lab_wearable_route_metrics_recorded",
] as const;
const R1176_ROW_OWNER_COMMAND =
  "MURPH_AGE_R1176_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts";
const R1177_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1177-ordinary-consumer-average-submitter-priority-packet.ts";
const R1076_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts";
const R1173_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1173-ordinary-consumer-safe-assertion-answer-sheet.ts";
const R1174_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1174-ordinary-consumer-safe-next-step-packet.ts";
const R1164_COMMAND =
  "MURPH_AGE_R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_PATH=<r1163-runner.json> pnpm exec tsx scripts/murph-age/r1164-ordinary-consumer-feature-only-research-handoff.ts";
const REQUIRED_ASSERTION_CHECKLIST = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
] as const;

describe("R1178 average-submitter current-loop surfacing", () => {
  it("surfaces the R1177 lab-plus-wearable priority as the current-loop action", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-visible-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: false });
      const { output, outputPath } = await runR1178AverageSubmitterCurrentLoopSurfacing({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1076Path: paths.r1076Path,
        r1177Path: paths.r1177Path,
      });

      expect(path.basename(outputPath)).toBe("r1178-average-submitter-current-loop-surfacing.latest.json");
      expect(output.schemaVersion).toBe(R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_priority_visible_in_current_loop",
        currentLoopCommand: R1176_ROW_OWNER_COMMAND,
        currentLoopConclusionBeforePriorityPacket: "executor_waiting_on_consumer_safe_availability_confirmation",
        currentLoopNextActionBeforePriorityPacket:
          "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
        currentMissingRequirementIds: [...BLOCKED_REQUIREMENTS],
        currentSurfacingBlockerIds: [],
        deferredUntilMinimumPairConfirmedIds: [...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED],
        firstSubmitterAskIds: [...FIRST_SUBMITTER_ASKS],
        minimumFeaturePairConfirmed: false,
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        nextAction: "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
        optionalContextNotRequiredForFirstStep: [...OPTIONAL_CONTEXT],
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
        priorityVisibleInCurrentLoop: true,
        productDisplayAuthorized: false,
        r1076CurrentLoopRecognized: true,
        r1177PriorityPacketRecognized: true,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1178: false,
        rowOwnerConfirmationInferredByR1178: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1178: false,
        rowOwnerActionRoute: {
          audience: "ordinary_submitter_roughly_16_50_row_owner",
          firstRunnableActionId: "review_r1173_safe_assertion_answer_sheet",
          liveChainCommand: R1176_ROW_OWNER_COMMAND,
          minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
          nextAction: "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
          productDisplayAuthorized: false,
          requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST],
          requiredInputKindIds: [...REQUIRED_INPUT_KINDS],
          rowOwnerActionRouteStatus: "waiting_on_row_owner_feature_only_assertion",
          rowOwnerPrivateValuesStored: false,
          rowParsingPerformedByR1178: false,
          safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST],
          sourcePriority: "consumer_bloodwork_labs_wearables_16_50_first",
          targetAgeBand: "roughly_16_50",
        },
        safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST],
        sourcePriority: "consumer_bloodwork_labs_wearables_16_50_first",
        targetAgeBand: "roughly_16_50",
        topRequirementId: "row_owner_availability_assertions_confirmed",
        upstreamR1177Conclusion: "ordinary_average_submitter_priority_packet_waiting_on_minimum_pair_confirmation",
        upstreamR1177NextAction: "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
      });
      expect(output.currentLoopSurfacing).toMatchObject({
        averageSubmitterPriorityPacketCommand: R1177_COMMAND,
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
        priorityVisibleInCurrentLoop: true,
        rowOwnerActionRoute: {
          firstRunnableActionId: "review_r1173_safe_assertion_answer_sheet",
          rowOwnerActionRouteStatus: "waiting_on_row_owner_feature_only_assertion",
        },
      });
      expect(output.summary.rowOwnerActionRoute.rowOwnerOnlyActions).toEqual([
        {
          actionId: "review_r1173_safe_assertion_answer_sheet",
          command: R1173_COMMAND,
          rowOwnerOnly: true,
          storesPrivateDetailsInPacket: false,
        },
        {
          actionId: "review_r1174_safe_next_step_packet",
          command: R1174_COMMAND,
          rowOwnerOnly: true,
          storesPrivateDetailsInPacket: false,
        },
        {
          actionId: "explicitly_run_r1176_live_chain_if_all_safe_assertions_are_true",
          command: R1176_ROW_OWNER_COMMAND,
          rowOwnerOnly: true,
          storesPrivateDetailsInPacket: false,
        },
        {
          actionId: "run_r1164_feature_only_research_handoff_after_minimum_pair_confirmed",
          command: R1164_COMMAND,
          rowOwnerOnly: true,
          storesPrivateDetailsInPacket: false,
        },
      ]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a confirmed minimum pair to the feature-only research handoff command", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-ready-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: true });
      const { output } = await runR1178AverageSubmitterCurrentLoopSurfacing({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1076Path: paths.r1076Path,
        r1177Path: paths.r1177Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_priority_visible_in_current_loop",
        currentLoopCommand: R1164_COMMAND,
        currentMissingRequirementIds: [],
        minimumFeaturePairConfirmed: true,
        nextAction: "run_r1164_feature_only_research_handoff",
        rowOwnerActionRoute: {
          firstRunnableActionId: "run_r1164_feature_only_research_handoff_after_minimum_pair_confirmed",
          nextAction: "run_r1164_feature_only_research_handoff",
          rowOwnerActionRouteStatus: "feature_only_research_handoff_ready",
        },
        topRequirementId: null,
        upstreamR1177Conclusion: "ordinary_average_submitter_priority_packet_ready_for_feature_only_research_handoff",
      });
      expect(output.currentLoopSurfacing).toMatchObject({
        rowOwnerActionRoute: {
          firstRunnableActionId: "run_r1164_feature_only_research_handoff_after_minimum_pair_confirmed",
          nextAction: "run_r1164_feature_only_research_handoff",
          rowOwnerActionRouteStatus: "feature_only_research_handoff_ready",
        },
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes missing R1177 input to the priority packet refresh without losing the target pair", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-missing-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: false });
      await rm(paths.r1177Path, { force: true });

      const { output } = await runR1178AverageSubmitterCurrentLoopSurfacing({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1076Path: paths.r1076Path,
        r1177Path: paths.r1177Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_priority_waiting_on_r1177_priority_packet",
        currentLoopCommand: R1177_COMMAND,
        currentMissingRequirementIds: [],
        currentSurfacingBlockerIds: ["r1177_average_submitter_priority_packet_missing_or_stale"],
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        nextAction: "refresh_r1177_average_submitter_priority_packet",
        priorityVisibleInCurrentLoop: false,
        r1076CurrentLoopRecognized: true,
        r1177PriorityPacketRecognized: false,
        rowOwnerActionRoute: {
          firstRunnableActionId: null,
          nextAction: "refresh_r1177_average_submitter_priority_packet",
          rowOwnerActionRouteStatus: "waiting_on_current_loop_or_priority_packet",
        },
        topRequirementId: "r1177_average_submitter_priority_packet_missing_or_stale",
      });
      expect(output.currentLoopSurfacing).toMatchObject({
        rowOwnerActionRoute: {
          firstRunnableActionId: null,
          nextAction: "refresh_r1177_average_submitter_priority_packet",
          rowOwnerActionRouteStatus: "waiting_on_current_loop_or_priority_packet",
        },
      });
      expect(output.inputArtifacts.r1177AverageSubmitterPriorityPacket).toMatchObject({
        artifact: "r1177-ordinary-consumer-average-submitter-priority-packet.latest.json",
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prioritizes stale R1076 current-loop input without copying private-looking strings", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-stale-r1076-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: true });
      const r1076 = await readJsonObject(paths.r1076Path);
      r1076.packetId = "private_current_loop_packet";
      const summary = recordAt(r1076, "summary");
      summary.conclusion = "private_current_loop_conclusion";
      summary.nextAction = "private_current_loop_action";
      await writeFile(paths.r1076Path, `${JSON.stringify(r1076)}\n`);

      const { output } = await runR1178AverageSubmitterCurrentLoopSurfacing({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1076Path: paths.r1076Path,
        r1177Path: paths.r1177Path,
      });

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain("private_current_loop_packet");
      expect(serialized).not.toContain("private_current_loop_conclusion");
      expect(serialized).not.toContain("private_current_loop_action");
      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_priority_waiting_on_current_loop_packet",
        currentLoopCommand: R1076_COMMAND,
        currentLoopConclusionBeforePriorityPacket: null,
        currentLoopNextActionBeforePriorityPacket: null,
        currentMissingRequirementIds: [],
        currentSurfacingBlockerIds: ["r1076_current_loop_missing_or_stale"],
        minimumFeaturePairConfirmed: true,
        nextAction: "refresh_r1076_current_loop_executor",
        priorityVisibleInCurrentLoop: false,
        r1076CurrentLoopRecognized: false,
        r1177PriorityPacketRecognized: true,
        topRequirementId: "r1076_current_loop_missing_or_stale",
        upstreamR1177Conclusion: "ordinary_average_submitter_priority_packet_ready_for_feature_only_research_handoff",
        upstreamR1177NextAction: "run_r1164_feature_only_research_handoff",
      });
      expect(output.inputArtifacts.r1076CurrentLoopExecutor).toMatchObject({
        packetId: null,
        schemaVersion: "murph-age-r1076-current-autoresearch-loop-executor.v1",
        status: "available",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not copy stale upstream private-looking strings into summaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-contaminated-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: false });
      const r1177 = await readJsonObject(paths.r1177Path);
      r1177.packetId = "private_lab_packet_id";
      const summary = recordAt(r1177, "summary");
      summary.conclusion = "private_lab_conclusion";
      summary.nextAction = "private_lab_next_action";
      await writeFile(paths.r1177Path, `${JSON.stringify(r1177)}\n`);

      const { output } = await runR1178AverageSubmitterCurrentLoopSurfacing({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1076Path: paths.r1076Path,
        r1177Path: paths.r1177Path,
      });

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain("private_lab_packet_id");
      expect(serialized).not.toContain("private_lab_conclusion");
      expect(serialized).not.toContain("private_lab_next_action");
      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_priority_waiting_on_r1177_priority_packet",
        nextAction: "refresh_r1177_average_submitter_priority_packet",
        r1177PriorityPacketRecognized: false,
        upstreamR1177Conclusion: null,
        upstreamR1177NextAction: null,
      });
      expect(output.inputArtifacts.r1177AverageSubmitterPriorityPacket).toMatchObject({
        packetId: null,
        schemaVersion: R1177_ORDINARY_CONSUMER_AVERAGE_SUBMITTER_PRIORITY_PACKET_SCHEMA_VERSION,
        status: "available",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not surface malformed duplicate R1177 feature arrays", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-duplicate-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: false });
      const r1177 = await readJsonObject(paths.r1177Path);
      const summary = recordAt(r1177, "summary");
      summary.minimumFeaturePairRequired = ["bloodwork_glycemia", "bloodwork_glycemia"];
      await writeFile(paths.r1177Path, `${JSON.stringify(r1177)}\n`);

      const { output } = await runR1178AverageSubmitterCurrentLoopSurfacing({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1076Path: paths.r1076Path,
        r1177Path: paths.r1177Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_priority_waiting_on_r1177_priority_packet",
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        nextAction: "refresh_r1177_average_submitter_priority_packet",
        priorityVisibleInCurrentLoop: false,
        r1177PriorityPacketRecognized: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not surface an inconsistent R1177 research-handoff action", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-inconsistent-handoff-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: false });
      const r1177 = await readJsonObject(paths.r1177Path);
      const summary = recordAt(r1177, "summary");
      summary.nextAction = "run_r1164_feature_only_research_handoff";
      await writeFile(paths.r1177Path, `${JSON.stringify(r1177)}\n`);

      const { output } = await runR1178AverageSubmitterCurrentLoopSurfacing({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1076Path: paths.r1076Path,
        r1177Path: paths.r1177Path,
      });

      expect(output.summary).toMatchObject({
        currentLoopCommand: R1177_COMMAND,
        minimumFeaturePairConfirmed: false,
        nextAction: "refresh_r1177_average_submitter_priority_packet",
        priorityVisibleInCurrentLoop: false,
        r1177PriorityPacketRecognized: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not surface minimum-pair waiting state without a row-owner availability blocker", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-missing-blocker-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: false });
      const r1177 = await readJsonObject(paths.r1177Path);
      const summary = recordAt(r1177, "summary");
      summary.currentMissingRequirementIds = [];
      await writeFile(paths.r1177Path, `${JSON.stringify(r1177)}\n`);

      const { output } = await runR1178AverageSubmitterCurrentLoopSurfacing({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1076Path: paths.r1076Path,
        r1177Path: paths.r1177Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_priority_waiting_on_r1177_priority_packet",
        currentMissingRequirementIds: [],
        currentLoopCommand: R1177_COMMAND,
        nextAction: "refresh_r1177_average_submitter_priority_packet",
        priorityVisibleInCurrentLoop: false,
        r1177PriorityPacketRecognized: false,
        topRequirementId: "r1177_average_submitter_priority_packet_missing_or_stale",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not recognize upstream artifacts with unsafe true boundary flags", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-unsafe-boundary-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: false });
      const r1177 = await readJsonObject(paths.r1177Path);
      const artifactBoundary = recordAt(r1177, "artifactBoundary");
      artifactBoundary.headerValuesStored = true;
      await writeFile(paths.r1177Path, `${JSON.stringify(r1177)}\n`);

      const { output } = await runR1178AverageSubmitterCurrentLoopSurfacing({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1076Path: paths.r1076Path,
        r1177Path: paths.r1177Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_priority_waiting_on_r1177_priority_packet",
        nextAction: "refresh_r1177_average_submitter_priority_packet",
        priorityVisibleInCurrentLoop: false,
        r1177PriorityPacketRecognized: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a safe CLI summary without leaking input or output paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-cli-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: false });
      const outDir = path.join(tmp, "out");
      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1178-average-submitter-current-loop-surfacing.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH: paths.r1076Path,
        MURPH_AGE_R1177_AVERAGE_SUBMITTER_PRIORITY_PACKET_PATH: paths.r1177Path,
        MURPH_AGE_R1178_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1178_OUTPUT_DIR: outDir,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      const cli = JSON.parse(result.stdout) as {
        conclusion?: unknown;
        firstSubmitterAskIds?: unknown;
        packetId?: unknown;
        prioritizedInputKindIds?: unknown;
        rowOwnerActionRouteStatus?: unknown;
        rowOwnerFirstRunnableActionId?: unknown;
      };
      expect(cli).toMatchObject({
        conclusion: "average_submitter_priority_visible_in_current_loop",
        firstSubmitterAskIds: [...FIRST_SUBMITTER_ASKS],
        packetId: "r1178-average-submitter-current-loop-surfacing",
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
        rowOwnerActionRouteStatus: "waiting_on_row_owner_feature_only_assertion",
        rowOwnerFirstRunnableActionId: "review_r1173_safe_assertion_answer_sheet",
      });
      await expect(stat(path.join(outDir, "r1178-average-submitter-current-loop-surfacing.latest.json"))).resolves.toBeTruthy();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo local paths when CLI output setup fails", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-cli-fail-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: false });
      const outputDir = path.join(tmp, "not-a-directory");
      await writeFile(outputDir, "already a file\n");

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1178-average-submitter-current-loop-surfacing.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH: paths.r1076Path,
        MURPH_AGE_R1177_AVERAGE_SUBMITTER_PRIORITY_PACKET_PATH: paths.r1177Path,
        MURPH_AGE_R1178_OUTPUT_DIR: outputDir,
      }, false);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("R1178 average-submitter current-loop surfacing failed.");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stdout).toBe("");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo invalid createdAt values from CLI env", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-cli-created-at-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: false });
      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1178-average-submitter-current-loop-surfacing.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH: paths.r1076Path,
        MURPH_AGE_R1177_AVERAGE_SUBMITTER_PRIORITY_PACKET_PATH: paths.r1177Path,
        MURPH_AGE_R1178_CREATED_AT: `${tmp}/private-created-at`,
        MURPH_AGE_R1178_OUTPUT_DIR: path.join(tmp, "out"),
      }, false);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("R1178 rejected invalid createdAt timestamp.");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stderr).not.toContain("private-created-at");
      expect(result.stdout).toBe("");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo private text when CLI input JSON is malformed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1178-cli-json-fail-"));
    try {
      const paths = await writeInputs(tmp, { priorityReady: false });
      await writeFile(paths.r1177Path, "{\"private_row_value\":\"lab_value_123\",");

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1178-average-submitter-current-loop-surfacing.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH: paths.r1076Path,
        MURPH_AGE_R1177_AVERAGE_SUBMITTER_PRIORITY_PACKET_PATH: paths.r1177Path,
        MURPH_AGE_R1178_OUTPUT_DIR: path.join(tmp, "out"),
      }, false);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("R1178 average-submitter current-loop surfacing failed.");
      expect(result.stderr).not.toContain("lab_value_123");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stdout).toBe("");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(
  root: string,
  options: {
    priorityReady: boolean;
  },
): Promise<{ r1076Path: string; r1177Path: string }> {
  await mkdir(root, { recursive: true });
  const r1076Path = path.join(root, "r1076.json");
  const r1177Path = path.join(root, "r1177.json");
  await Promise.all([
    writeFile(r1076Path, `${JSON.stringify(r1076Fixture())}\n`),
    writeFile(r1177Path, `${JSON.stringify(r1177Fixture(options.priorityReady))}\n`),
  ]);
  return { r1076Path, r1177Path };
}

function r1076Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      productDisplayAuthorized: false,
      rowParsingPerformedByR1076: false,
    },
    packetId: "r1076-current-autoresearch-loop-executor",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1076-current-autoresearch-loop-executor.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "executor_waiting_on_consumer_safe_availability_confirmation",
      nextAction: "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1076: false,
    },
  };
}

function r1177Fixture(priorityReady: boolean): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      productDisplayAuthorized: false,
      rowLevelDataAcceptedByR1177: false,
      rowOwnerConfirmationInferredByR1177: false,
      rowParsingPerformedByR1177: false,
    },
    averageSubmitterPriorityPacket: {
      minimumFeaturePairConfirmed: priorityReady,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
      prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
      productDisplayAuthorized: false,
      rowLevelDataAcceptedByR1177: false,
      rowOwnerConfirmationInferredByR1177: false,
      rowOwnerOnlyCommand: R1176_ROW_OWNER_COMMAND,
      rowOwnerPrivateValuesStored: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
    packetId: "r1177-ordinary-consumer-average-submitter-priority-packet",
    productDisplayAuthorized: false,
    schemaVersion: R1177_ORDINARY_CONSUMER_AVERAGE_SUBMITTER_PRIORITY_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: priorityReady
        ? "ordinary_average_submitter_priority_packet_ready_for_feature_only_research_handoff"
        : "ordinary_average_submitter_priority_packet_waiting_on_minimum_pair_confirmation",
      currentMissingRequirementIds: priorityReady ? [] : [...BLOCKED_REQUIREMENTS],
      deferredUntilMinimumPairConfirmedIds: [...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED],
      firstSubmitterAskIds: [...FIRST_SUBMITTER_ASKS],
      minimumFeaturePairConfirmed: priorityReady,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction: priorityReady
        ? "run_r1164_feature_only_research_handoff"
        : "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
      optionalContextNotRequiredForFirstStep: [...OPTIONAL_CONTEXT],
      prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1177: false,
      rowOwnerConfirmationInferredByR1177: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1177: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected JSON object fixture.");
  }
  return value as Record<string, unknown>;
}

function recordAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = value[key];
  if (typeof child !== "object" || child === null || Array.isArray(child)) {
    throw new Error(`Expected object fixture field: ${key}`);
  }
  return child as Record<string, unknown>;
}

function execFilePromise(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  expectSuccess = true,
): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env }, (error, stdout, stderr) => {
      const exitCode = typeof error === "object"
        && error !== null
        && "code" in error
        && typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        : null;
      if (expectSuccess && error) {
        reject(error);
        return;
      }
      resolve({ exitCode, stderr, stdout });
    });
  });
}
