import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_SCHEMA_VERSION,
} from "./r1178-average-submitter-current-loop-surfacing.ts";
import {
  R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION,
  runR1179AverageSubmitterObjectiveGapAudit,
} from "./r1179-average-submitter-objective-gap-audit.ts";

const CREATED_AT = "2026-05-18T21:15:00.000Z";
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
const FIRST_PASS_SUBMISSION_PRIORITY_ORDER = [
  "glycemia_bloodwork_labs_first",
  "daily_activity_phone_watch_wearable_first",
  "routine_labs_optional_after_minimum_pair",
  "basic_vitals_context_optional_after_minimum_pair",
  "sleep_recovery_hrv_after_minimum_pair",
  "advanced_biomarkers_last",
] as const;
const SAFE_COMPLETION_CHECKLIST = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const REQUIRED_ASSERTION_CHECKLIST = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
] as const;
const BLOCKED_CONTENT_IDS = [
  "private_paths",
  "header_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "private_ref_values",
  "source_variable_names",
  "predictions",
  "coefficients",
  "model_parameters",
  "source_text",
  "small_cells",
] as const;
const ROW_OWNER_SAFE_CONFIRMATION_ASK_ID =
  "confirm_feature_only_lab_wearable_availability_without_private_values";
const ROW_OWNER_SAFE_CONFIRMATION_RESPONSE_KINDS = [
  "explicit_yes_all_required_assertions_confirmed",
  "not_confirmed_or_unsure",
] as const;
const BLOCKED_REQUIREMENTS = [
  "row_owner_availability_assertions_confirmed",
  "confirmed_recipe_route_requirements_available",
  "private_route_config_supplied",
  "real_lab_wearable_route_metrics_recorded",
] as const;
const R1173_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1173-ordinary-consumer-safe-assertion-answer-sheet.ts";
const R1176_COMMAND =
  "MURPH_AGE_R1176_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts";
const R1164_COMMAND =
  "MURPH_AGE_R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_PATH=<r1163-runner.json> pnpm exec tsx scripts/murph-age/r1164-ordinary-consumer-feature-only-research-handoff.ts";
const R1183_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts";
const R1185_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1185-average-submitter-safe-response-smoke-proof.ts";
const REQUIRED_SAFE_RESPONSE_FIELDS = [
  "confirm_target_age_band_roughly_16_50",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const SAFE_RESPONSE_EXECUTION_FEATURE_SLOTS = [
  "glycemia_lab_presence",
  "glycemia_measurement_date_presence",
  "daily_activity_presence",
  "daily_wear_coverage_presence",
] as const;

describe("R1179 average submitter objective gap audit", () => {
  it("audits the current ordinary 16-50 lab-plus-wearable gap without inferring row-owner evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-current-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      const { output, outputPath } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1179-average-submitter-objective-gap-audit.latest.json");
      expect(output.schemaVersion).toBe(R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        averageSubmitterSubmissionPriority: {
          averageSubmitterLikelySubmittable: true,
          deferredUntilMinimumPairConfirmedIds: [
            ...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED,
          ],
          firstPassOnly: true,
          firstPassSubmissionPriorityOrderIds: [
            ...FIRST_PASS_SUBMISSION_PRIORITY_ORDER,
          ],
          minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
          modelEvidencePromotionAllowed: false,
          optionalContextNotRequiredForFirstStep: [...OPTIONAL_CONTEXT],
          prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
          productDisplayAuthorized: false,
          rowLevelDataAcceptedByR1179: false,
          rowParsingPerformedByR1179: false,
          sourcePriority: "consumer_bloodwork_labs_wearables_16_50_first",
          targetAgeBand: "roughly_16_50",
        },
        blockedRequirementIds: [
          "row_owner_safe_assertion_confirmed",
          "feature_only_research_handoff_ready",
          "real_lab_wearable_route_metrics_recorded",
        ],
        conclusion: "average_submitter_objective_gap_audit_blocked_on_row_owner_safe_assertion",
        firstBlockedRequirementId: "row_owner_safe_assertion_confirmed",
        goalAchieved: false,
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        modelEvidencePromotionAllowed: false,
        nextAction:
          "review_r1173_safe_assertion_answer_sheet_then_rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
        nextActionCommand: R1173_COMMAND,
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
        productDisplayAuthorized: false,
        readyToMarkComplete: false,
        requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST],
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1179: false,
        rowOwnerActionRouteStatus: "waiting_on_row_owner_feature_only_assertion",
        rowOwnerConfirmationInferredByR1179: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1179: false,
        safeResponseSmokeProof: {
          artifact: "r1185-average-submitter-safe-response-smoke-proof.latest.json",
          command: R1185_COMMAND,
          conclusion: "average_submitter_safe_response_smoke_passed_non_evidence",
          liveArtifactsMutatedByR1185: false,
          liveR1184Conclusion:
            "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
          liveR1184ReadyForSyntheticSmoke: true,
          minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
          modelEvidencePromotionAllowed: false,
          nextRealAction:
            "obtain_real_row_owner_safe_confirmation_then_rerun_r1183",
          nextRealActionCommand: R1183_COMMAND,
          nextRealActionRequiresExplicitRowOwnerAssertion: true,
          prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
          productDisplayAuthorized: false,
          recognized: true,
          requiredResponseFieldIds: [...REQUIRED_SAFE_RESPONSE_FIELDS],
          reviewGptRequiredNow: false,
          rowLevelDataAcceptedByR1185: false,
          rowOwnerConfirmationInferredByR1185: false,
          rowOwnerPrivateValuesStored: false,
          rowParsingPerformedByR1185: false,
          safeExecutionFeatureSlotIds: [
            ...SAFE_RESPONSE_EXECUTION_FEATURE_SLOTS,
          ],
          sourcePriority: "consumer_bloodwork_labs_wearables_16_50_first",
          syntheticNonEvidence: true,
          syntheticPathAdvancedToFeatureOnlyResearchPlanning: true,
          syntheticSmokeRan: true,
          targetAgeBand: "roughly_16_50",
        },
        safeCurrentLoopCommandVisible: true,
        safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST],
        sourcePriority: "consumer_bloodwork_labs_wearables_16_50_first",
        targetAgeBand: "roughly_16_50",
      });
      expect(output.summary.rowOwnerSafeConfirmationAsk).toMatchObject({
        acceptableResponseKindIds: [...ROW_OWNER_SAFE_CONFIRMATION_RESPONSE_KINDS],
        allowedValueKindIds: ["booleans_only", "fixed_enumerated_ids_only"],
        askId: ROW_OWNER_SAFE_CONFIRMATION_ASK_ID,
        audience: "ordinary_submitter_roughly_16_50_row_owner",
        blockedContentIds: [...BLOCKED_CONTENT_IDS],
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        modelEvidencePromotionAllowed: false,
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
        privateDetailsStored: false,
        productDisplayAuthorized: false,
        requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST],
        rowLevelDataAcceptedByR1179: false,
        rowOwnerConfirmationInferredByR1179: false,
        rowOwnerOnly: true,
        rowOwnerPrivateValuesStored: false,
        rowOwnerProvidedValuesStored: false,
        rowParsingPerformedByR1179: false,
        safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST],
      });
      expect(output.summary.rowOwnerSafeConfirmationAsk.askText).toContain("glycemia bloodwork/lab export");
      expect(output.summary.rowOwnerSafeConfirmationAsk.askText).toContain("daily phone/watch/wearable activity export");
      expect(output.objectiveGapAudit.rowOwnerSafeConfirmationAsk).toEqual(
        output.summary.rowOwnerSafeConfirmationAsk,
      );
      expect(output.objectiveGapAudit.averageSubmitterSubmissionPriority).toEqual(
        output.summary.averageSubmitterSubmissionPriority,
      );
      expect(output.objectiveGapAudit.safeResponseSmokeProof).toEqual(
        output.summary.safeResponseSmokeProof,
      );
      expect(output.summary.currentEvidenceArtifactIds).toEqual([
        "r1178-average-submitter-current-loop-surfacing",
        "r1145-ordinary-consumer-current-chain-completion-audit",
        "r1173-ordinary-consumer-safe-assertion-answer-sheet",
        "r1174-ordinary-consumer-safe-next-step-packet",
        "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner",
      ]);
      expect(output.objectiveGapAudit.requirementStatuses).toMatchObject([
        { requirementId: "ordinary_16_50_priority_selected", status: "satisfied" },
        { requirementId: "minimum_lab_wearable_pair_visible", status: "satisfied" },
        { requirementId: "average_submitter_submission_priority_visible", status: "satisfied" },
        { requirementId: "safe_response_smoke_proof_visible", status: "satisfied" },
        { requirementId: "row_owner_action_route_visible", status: "satisfied" },
        { requirementId: "safe_current_loop_command_visible", status: "satisfied" },
        { requirementId: "safe_assertion_answer_sheet_available", status: "satisfied" },
        { requirementId: "safe_next_step_packet_available", status: "satisfied" },
        { requirementId: "r1176_live_chain_available", status: "satisfied" },
        { requirementId: "row_owner_safe_assertion_confirmed", status: "blocked" },
        { requirementId: "feature_only_research_handoff_ready", status: "blocked" },
        { requirementId: "real_lab_wearable_route_metrics_recorded", status: "blocked" },
        { requirementId: "product_display_blocked_until_validation", status: "satisfied" },
      ]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion auditing when R1178 points the waiting current loop at the auto-confirm runner", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-r1178-command-gate-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      const r1178 = await readJsonObject(paths.r1178Path);
      const summary = recordAt(r1178, "summary");
      const currentLoopSurfacing = recordAt(r1178, "currentLoopSurfacing");
      summary.currentLoopCommand = R1176_COMMAND;
      currentLoopSurfacing.currentLoopCommand = R1176_COMMAND;
      await writeFile(paths.r1178Path, `${JSON.stringify(r1178)}\n`);

      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockedRequirementIds: [
          "safe_current_loop_command_visible",
          "row_owner_safe_assertion_confirmed",
          "feature_only_research_handoff_ready",
          "real_lab_wearable_route_metrics_recorded",
        ],
        firstBlockedRequirementId: "safe_current_loop_command_visible",
        goalAchieved: false,
        nextAction: "refresh_r1178_current_loop_surfacing",
        readyToMarkComplete: false,
        rowOwnerActionRouteStatus: "waiting_on_row_owner_feature_only_assertion",
        safeCurrentLoopCommandVisible: false,
      });
      expect(output.objectiveGapAudit.requirementStatuses.find(
        (entry) => entry.requirementId === "safe_current_loop_command_visible",
      )).toMatchObject({
        evidenceArtifactIds: ["r1178-average-submitter-current-loop-surfacing"],
        nextAction: "refresh_r1178_current_loop_surfacing",
        status: "blocked",
      });
      expect(output.summary.nextActionCommand).toBe(
        "pnpm exec tsx scripts/murph-age/r1178-average-submitter-current-loop-surfacing.ts",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion auditing when R1178 current loop command fields disagree", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-r1178-command-mismatch-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      const r1178 = await readJsonObject(paths.r1178Path);
      const currentLoopSurfacing = recordAt(r1178, "currentLoopSurfacing");
      currentLoopSurfacing.currentLoopCommand = R1164_COMMAND;
      await writeFile(paths.r1178Path, `${JSON.stringify(r1178)}\n`);

      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        firstBlockedRequirementId: "safe_current_loop_command_visible",
        nextAction: "refresh_r1178_current_loop_surfacing",
        safeCurrentLoopCommandVisible: false,
      });
      expect(output.objectiveGapAudit.requirementStatuses.find(
        (entry) => entry.requirementId === "safe_current_loop_command_visible",
      )).toMatchObject({
        status: "blocked",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps completion blocked on real route metrics after the feature-only handoff is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-metrics-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: true, realMetrics: false });
      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockedRequirementIds: ["real_lab_wearable_route_metrics_recorded"],
        conclusion: "average_submitter_objective_gap_audit_blocked_on_real_route_metrics",
        firstBlockedRequirementId: "real_lab_wearable_route_metrics_recorded",
        goalAchieved: false,
        nextAction: "collect_real_lab_wearable_route_metrics",
        nextActionCommand: null,
        readyToMarkComplete: false,
        rowOwnerActionRouteStatus: "feature_only_research_handoff_ready",
        safeCurrentLoopCommandVisible: true,
      });
      expect(output.objectiveGapAudit.requirementStatuses.find(
        (entry) => entry.requirementId === "feature_only_research_handoff_ready",
      )).toMatchObject({ status: "satisfied" });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("can mark the objective complete only when row-owner confirmation and route metrics both clear", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-complete-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: true, realMetrics: true });
      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockedRequirementIds: [],
        conclusion: "average_submitter_objective_gap_audit_ready_to_mark_complete",
        firstBlockedRequirementId: null,
        goalAchieved: true,
        nextAction: "none",
        readyToMarkComplete: true,
      });
      expect(output.objectiveGapAudit.requirementStatuses.every((entry) => entry.status === "satisfied")).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not treat summary completion as route-metric proof without R1145 route evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-r1145-direct-proof-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: true, realMetrics: true });
      const r1145 = await readJsonObject(paths.r1145Path);
      const completionAudit = recordAt(r1145, "completionAudit");
      const routeEvidenceState = recordAt(completionAudit, "routeEvidenceState");
      routeEvidenceState.realLabWearableRouteMetricsRecorded = false;
      await writeFile(paths.r1145Path, `${JSON.stringify(r1145)}\n`);

      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockedRequirementIds: ["real_lab_wearable_route_metrics_recorded"],
        conclusion: "average_submitter_objective_gap_audit_blocked_on_real_route_metrics",
        firstBlockedRequirementId: "real_lab_wearable_route_metrics_recorded",
        goalAchieved: false,
        readyToMarkComplete: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not accept R1145 route metrics for a different age/input priority", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-r1145-target-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: true, realMetrics: true });
      const r1145 = await readJsonObject(paths.r1145Path);
      const summary = recordAt(r1145, "summary");
      const completionAudit = recordAt(r1145, "completionAudit");
      summary.targetAgeBand = "not_the_average_submitter_target";
      summary.targetInputPriority = "not_the_lab_wearable_priority";
      completionAudit.targetAgeBand = "not_the_average_submitter_target";
      completionAudit.targetInputPriority = "not_the_lab_wearable_priority";
      await writeFile(paths.r1145Path, `${JSON.stringify(r1145)}\n`);

      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockedRequirementIds: ["real_lab_wearable_route_metrics_recorded"],
        firstBlockedRequirementId: "real_lab_wearable_route_metrics_recorded",
        goalAchieved: false,
        nextAction: "refresh_r1145_completion_audit",
        readyToMarkComplete: false,
      });
      expect(output.objectiveGapAudit.requirementStatuses.find(
        (entry) => entry.requirementId === "real_lab_wearable_route_metrics_recorded",
      )).toMatchObject({
        evidenceArtifactIds: [],
        nextAction: "refresh_r1145_completion_audit",
        status: "blocked",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not accept R1145 route metrics when route evidence stored private details", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-r1145-private-details-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: true, realMetrics: true });
      const r1145 = await readJsonObject(paths.r1145Path);
      const completionAudit = recordAt(r1145, "completionAudit");
      const routeEvidenceState = recordAt(completionAudit, "routeEvidenceState");
      routeEvidenceState.privateDetailsStored = true;
      await writeFile(paths.r1145Path, `${JSON.stringify(r1145)}\n`);

      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockedRequirementIds: ["real_lab_wearable_route_metrics_recorded"],
        firstBlockedRequirementId: "real_lab_wearable_route_metrics_recorded",
        goalAchieved: false,
        nextAction: "refresh_r1145_completion_audit",
        readyToMarkComplete: false,
      });
      expect(output.objectiveGapAudit.requirementStatuses.find(
        (entry) => entry.requirementId === "real_lab_wearable_route_metrics_recorded",
      )).toMatchObject({
        evidenceArtifactIds: [],
        nextAction: "refresh_r1145_completion_audit",
        status: "blocked",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes missing R1178 to a current-loop surfacing refresh without losing the target pair", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-missing-r1178-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      await rm(paths.r1178Path, { force: true });
      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_objective_gap_audit_waiting_on_current_packets",
        firstBlockedRequirementId: "ordinary_16_50_priority_selected",
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        nextAction: "refresh_r1178_current_loop_surfacing",
        rowOwnerActionRouteStatus: null,
      });
      expect(output.summary.rowOwnerSafeConfirmationAsk).toMatchObject({
        askId: ROW_OWNER_SAFE_CONFIRMATION_ASK_ID,
        blockedContentIds: [...BLOCKED_CONTENT_IDS],
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
      });
      expect(output.inputArtifacts.r1178AverageSubmitterCurrentLoopSurfacing).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not copy stale private-looking upstream strings into the audit", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-stale-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      const r1178 = await readJsonObject(paths.r1178Path);
      r1178.packetId = "private_r1178_packet_id";
      const summary = recordAt(r1178, "summary");
      summary.conclusion = "private_current_loop_conclusion";
      summary.rowOwnerActionRoute = {
        rowOwnerActionRouteStatus: "private_row_owner_status",
      };
      await writeFile(paths.r1178Path, `${JSON.stringify(r1178)}\n`);

      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain("private_r1178_packet_id");
      expect(serialized).not.toContain("private_current_loop_conclusion");
      expect(serialized).not.toContain("private_row_owner_status");
      expect(output.summary).toMatchObject({
        firstBlockedRequirementId: "ordinary_16_50_priority_selected",
        nextAction: "refresh_r1178_current_loop_surfacing",
        rowOwnerActionRouteStatus: null,
      });
      expect(output.inputArtifacts.r1178AverageSubmitterCurrentLoopSurfacing).toMatchObject({
        packetId: null,
        schemaVersion: R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_SCHEMA_VERSION,
        status: "available",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not accept R1178 when its model-evidence gate is open", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-r1178-model-gate-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      const r1178 = await readJsonObject(paths.r1178Path);
      const summary = recordAt(r1178, "summary");
      summary.modelEvidencePromotionAllowed = true;
      await writeFile(paths.r1178Path, `${JSON.stringify(r1178)}\n`);

      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        firstBlockedRequirementId: "ordinary_16_50_priority_selected",
        nextAction: "refresh_r1178_current_loop_surfacing",
        rowOwnerActionRouteStatus: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks the objective when R1178 omits the explicit average-submitter submission priority", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-r1178-priority-missing-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      const r1178 = await readJsonObject(paths.r1178Path);
      const summary = recordAt(r1178, "summary");
      delete summary.averageSubmitterSubmissionPriority;
      await writeFile(paths.r1178Path, `${JSON.stringify(r1178)}\n`);

      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockedRequirementIds: [
          "average_submitter_submission_priority_visible",
          "row_owner_safe_assertion_confirmed",
          "feature_only_research_handoff_ready",
          "real_lab_wearable_route_metrics_recorded",
        ],
        firstBlockedRequirementId: "average_submitter_submission_priority_visible",
        nextAction: "refresh_r1178_current_loop_surfacing",
      });
      expect(output.objectiveGapAudit.requirementStatuses.find(
        (entry) => entry.requirementId === "average_submitter_submission_priority_visible",
      )).toMatchObject({
        evidenceArtifactIds: ["r1178-average-submitter-current-loop-surfacing"],
        nextAction: "refresh_r1178_current_loop_surfacing",
        status: "blocked",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks the objective when R1178 omits the safe-response smoke proof", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-r1178-r1185-missing-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      const r1178 = await readJsonObject(paths.r1178Path);
      const summary = recordAt(r1178, "summary");
      delete summary.safeResponseSmokeProof;
      await writeFile(paths.r1178Path, `${JSON.stringify(r1178)}\n`);

      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockedRequirementIds: [
          "safe_response_smoke_proof_visible",
          "row_owner_safe_assertion_confirmed",
          "feature_only_research_handoff_ready",
          "real_lab_wearable_route_metrics_recorded",
        ],
        firstBlockedRequirementId: "safe_response_smoke_proof_visible",
        nextAction: "refresh_r1178_current_loop_surfacing",
        safeResponseSmokeProof: {
          command: null,
          conclusion: null,
          nextRealAction: null,
          recognized: false,
          syntheticNonEvidence: false,
        },
      });
      expect(output.objectiveGapAudit.requirementStatuses.find(
        (entry) => entry.requirementId === "safe_response_smoke_proof_visible",
      )).toMatchObject({
        evidenceArtifactIds: ["r1178-average-submitter-current-loop-surfacing"],
        nextAction: "refresh_r1178_current_loop_surfacing",
        status: "blocked",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not publish the row-owner confirmation env flag when the R1176 live chain is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-missing-r1176-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      await rm(paths.r1176Path, { force: true });
      const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      const serialized = JSON.stringify(output);
      expect(output.summary).toMatchObject({
        firstBlockedRequirementId: "r1176_live_chain_available",
        nextAction: "refresh_r1176_row_owner_safe_assertion_chain",
        nextActionCommand: null,
      });
      expect(serialized).not.toContain("MURPH_AGE_R1176_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED=true");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a safe CLI summary without leaking input or output paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-cli-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      const outDir = path.join(tmp, "out");
      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1179-average-submitter-objective-gap-audit.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1145_COMPLETION_AUDIT_PATH: paths.r1145Path,
        MURPH_AGE_R1173_SAFE_ASSERTION_ANSWER_SHEET_PATH: paths.r1173Path,
        MURPH_AGE_R1174_SAFE_NEXT_STEP_PACKET_PATH: paths.r1174Path,
        MURPH_AGE_R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: paths.r1176Path,
        MURPH_AGE_R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_PATH: paths.r1178Path,
        MURPH_AGE_R1179_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1179_OUTPUT_DIR: outDir,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      const cli = JSON.parse(result.stdout) as {
        averageSubmitterSubmissionPriorityOrderIds?: unknown;
        conclusion?: unknown;
        deferredUntilMinimumPairConfirmedIds?: unknown;
        nextAction?: unknown;
        optionalContextNotRequiredForFirstStep?: unknown;
        packetId?: unknown;
        rowOwnerSafeConfirmationAsk?: unknown;
        rowOwnerSafeConfirmationAskText?: unknown;
        rowOwnerSafeConfirmationAskId?: unknown;
        rowOwnerSafeConfirmationAskVisible?: unknown;
        safeResponseSmokeProofConclusion?: unknown;
        safeResponseSmokeProofNextRealAction?: unknown;
        safeResponseSmokeProofNextRealActionCommand?: unknown;
        safeResponseSmokeProofRecognized?: unknown;
        safeResponseSmokeProofSyntheticNonEvidence?: unknown;
        safeCurrentLoopCommandVisible?: unknown;
        topBlockedRequirementId?: unknown;
      };
      expect(cli).toMatchObject({
        averageSubmitterSubmissionPriorityOrderIds: [
          ...FIRST_PASS_SUBMISSION_PRIORITY_ORDER,
        ],
        conclusion: "average_submitter_objective_gap_audit_blocked_on_row_owner_safe_assertion",
        deferredUntilMinimumPairConfirmedIds: [
          ...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED,
        ],
        nextAction:
          "review_r1173_safe_assertion_answer_sheet_then_rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
        optionalContextNotRequiredForFirstStep: [...OPTIONAL_CONTEXT],
        packetId: "r1179-average-submitter-objective-gap-audit",
        rowOwnerSafeConfirmationAskId: ROW_OWNER_SAFE_CONFIRMATION_ASK_ID,
        rowOwnerSafeConfirmationAskVisible: true,
        safeResponseSmokeProofConclusion:
          "average_submitter_safe_response_smoke_passed_non_evidence",
        safeResponseSmokeProofNextRealAction:
          "obtain_real_row_owner_safe_confirmation_then_rerun_r1183",
        safeResponseSmokeProofNextRealActionCommand: R1183_COMMAND,
        safeResponseSmokeProofRecognized: true,
        safeResponseSmokeProofSyntheticNonEvidence: true,
        safeCurrentLoopCommandVisible: true,
        topBlockedRequirementId: "row_owner_safe_assertion_confirmed",
      });
      expect(cli.rowOwnerSafeConfirmationAsk).toBeUndefined();
      expect(cli.rowOwnerSafeConfirmationAskText).toBeUndefined();
      expect(result.stdout).not.toContain("glycemia bloodwork/lab export");
      expect(result.stdout).not.toContain("daily phone/watch/wearable activity export");
      expect(result.stdout).not.toContain("blockedContentIds");
      await expect(stat(path.join(outDir, "r1179-average-submitter-objective-gap-audit.latest.json"))).resolves.toBeTruthy();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo local paths when CLI output setup fails", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-cli-fail-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      const outputDir = path.join(tmp, "not-a-directory");
      await writeFile(outputDir, "already a file\n");
      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1179-average-submitter-objective-gap-audit.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1145_COMPLETION_AUDIT_PATH: paths.r1145Path,
        MURPH_AGE_R1173_SAFE_ASSERTION_ANSWER_SHEET_PATH: paths.r1173Path,
        MURPH_AGE_R1174_SAFE_NEXT_STEP_PACKET_PATH: paths.r1174Path,
        MURPH_AGE_R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: paths.r1176Path,
        MURPH_AGE_R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_PATH: paths.r1178Path,
        MURPH_AGE_R1179_OUTPUT_DIR: outputDir,
      }, false);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("R1179 average submitter objective gap audit failed.");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stdout).toBe("");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo invalid createdAt values from CLI env", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-cli-created-at-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1179-average-submitter-objective-gap-audit.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1145_COMPLETION_AUDIT_PATH: paths.r1145Path,
        MURPH_AGE_R1173_SAFE_ASSERTION_ANSWER_SHEET_PATH: paths.r1173Path,
        MURPH_AGE_R1174_SAFE_NEXT_STEP_PACKET_PATH: paths.r1174Path,
        MURPH_AGE_R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: paths.r1176Path,
        MURPH_AGE_R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_PATH: paths.r1178Path,
        MURPH_AGE_R1179_CREATED_AT: `${tmp}/private-created-at`,
        MURPH_AGE_R1179_OUTPUT_DIR: path.join(tmp, "out"),
      }, false);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("R1179 rejected invalid createdAt timestamp.");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stderr).not.toContain("private-created-at");
      expect(result.stdout).toBe("");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo private text when CLI input JSON is malformed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1179-cli-json-fail-"));
    try {
      const paths = await writeInputs(tmp, { confirmed: false, realMetrics: false });
      await writeFile(paths.r1178Path, "{\"redacted_fixture\":\"non_echo_marker\",");
      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1179-average-submitter-objective-gap-audit.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1145_COMPLETION_AUDIT_PATH: paths.r1145Path,
        MURPH_AGE_R1173_SAFE_ASSERTION_ANSWER_SHEET_PATH: paths.r1173Path,
        MURPH_AGE_R1174_SAFE_NEXT_STEP_PACKET_PATH: paths.r1174Path,
        MURPH_AGE_R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: paths.r1176Path,
        MURPH_AGE_R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_PATH: paths.r1178Path,
        MURPH_AGE_R1179_OUTPUT_DIR: path.join(tmp, "out"),
      }, false);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("R1179 input JSON parse failed.");
      expect(result.stderr).not.toContain("non_echo_marker");
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
    confirmed: boolean;
    realMetrics: boolean;
  },
): Promise<{
  r1145Path: string;
  r1173Path: string;
  r1174Path: string;
  r1176Path: string;
  r1178Path: string;
}> {
  await mkdir(root, { recursive: true });
  const r1178Path = path.join(root, "r1178.json");
  const r1145Path = path.join(root, "r1145.json");
  const r1173Path = path.join(root, "r1173.json");
  const r1174Path = path.join(root, "r1174.json");
  const r1176Path = path.join(root, "r1176.json");
  await Promise.all([
    writeFile(r1178Path, `${JSON.stringify(r1178Fixture(options.confirmed))}\n`),
    writeFile(r1145Path, `${JSON.stringify(r1145Fixture(options.realMetrics))}\n`),
    writeFile(r1173Path, `${JSON.stringify(r1173Fixture())}\n`),
    writeFile(r1174Path, `${JSON.stringify(r1174Fixture())}\n`),
    writeFile(r1176Path, `${JSON.stringify(r1176Fixture(options.confirmed))}\n`),
  ]);
  return { r1145Path, r1173Path, r1174Path, r1176Path, r1178Path };
}

function r1178Fixture(confirmed: boolean): Record<string, unknown> {
  const currentLoopCommand = confirmed ? R1164_COMMAND : R1173_COMMAND;
  return {
    artifactBoundary: {
      aggregateOnly: true,
      productDisplayAuthorized: false,
    },
    currentLoopSurfacing: {
      currentLoopCommand,
    },
    packetId: "r1178-average-submitter-current-loop-surfacing",
    productDisplayAuthorized: false,
    schemaVersion: R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      averageSubmitterSubmissionPriority: {
        averageSubmitterLikelySubmittable: true,
        deferredUntilMinimumPairConfirmedIds: [
          ...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED,
        ],
        firstPassOnly: true,
        firstPassSubmissionPriorityOrderIds: [
          ...FIRST_PASS_SUBMISSION_PRIORITY_ORDER,
        ],
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        modelEvidencePromotionAllowed: false,
        optionalContextNotRequiredForFirstStep: [...OPTIONAL_CONTEXT],
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
        productDisplayAuthorized: false,
        rowLevelDataAcceptedByR1178: false,
        rowParsingPerformedByR1178: false,
        sourcePriority: "consumer_bloodwork_labs_wearables_16_50_first",
        targetAgeBand: "roughly_16_50",
      },
      currentLoopCommand,
      currentMissingRequirementIds: confirmed ? [] : [...BLOCKED_REQUIREMENTS],
      minimumFeaturePairConfirmed: confirmed,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction: confirmed
        ? "run_r1164_feature_only_research_handoff"
        : "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
      prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
      priorityVisibleInCurrentLoop: true,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1178: false,
      rowOwnerActionRoute: {
        requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST],
        requiredInputKindIds: [...REQUIRED_INPUT_KINDS],
        rowOwnerActionRouteStatus: confirmed
          ? "feature_only_research_handoff_ready"
          : "waiting_on_row_owner_feature_only_assertion",
      },
      rowOwnerConfirmationInferredByR1178: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1178: false,
      safeResponseSmokeProof: {
        artifact: "r1185-average-submitter-safe-response-smoke-proof.latest.json",
        command: R1185_COMMAND,
        conclusion: "average_submitter_safe_response_smoke_passed_non_evidence",
        liveArtifactsMutatedByR1185: false,
        liveR1184Conclusion:
          "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
        liveR1184ReadyForSyntheticSmoke: true,
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        modelEvidencePromotionAllowed: false,
        nextRealAction:
          "obtain_real_row_owner_safe_confirmation_then_rerun_r1183",
        nextRealActionCommand: R1183_COMMAND,
        nextRealActionRequiresExplicitRowOwnerAssertion: true,
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
        productDisplayAuthorized: false,
        recognized: true,
        requiredResponseFieldIds: [...REQUIRED_SAFE_RESPONSE_FIELDS],
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1185: false,
        rowOwnerConfirmationInferredByR1185: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1185: false,
        safeExecutionFeatureSlotIds: [
          ...SAFE_RESPONSE_EXECUTION_FEATURE_SLOTS,
        ],
        sourcePriority: "consumer_bloodwork_labs_wearables_16_50_first",
        syntheticNonEvidence: true,
        syntheticPathAdvancedToFeatureOnlyResearchPlanning: true,
        syntheticSmokeRan: true,
        targetAgeBand: "roughly_16_50",
      },
      safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST],
      sourcePriority: "consumer_bloodwork_labs_wearables_16_50_first",
      targetAgeBand: "roughly_16_50",
    },
  };
}

function r1145Fixture(realMetrics: boolean): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      productDisplayAuthorized: false,
    },
    packetId: "r1145-ordinary-consumer-current-chain-completion-audit",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1145-ordinary-consumer-current-chain-completion-audit.v1",
    status: "research-local-aggregate-only",
    summary: {
      completionUnblockerBlockedRequirementIds: realMetrics ? [] : [...BLOCKED_REQUIREMENTS],
      goalAchieved: realMetrics,
      productDisplayAuthorized: false,
      readyToMarkComplete: realMetrics,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1145: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
    completionAudit: {
      prioritizedSubmitterInputFamilyIds: [...MINIMUM_FEATURE_PAIR],
      routeEvidenceState: {
        privateDetailsStored: false,
        realLabWearableRouteMetricsRecorded: realMetrics,
      },
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1173Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      productDisplayAuthorized: false,
    },
    packetId: "r1173-ordinary-consumer-safe-assertion-answer-sheet",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1173-ordinary-consumer-safe-assertion-answer-sheet.v1",
    status: "research-local-aggregate-only",
    summary: {
      answerSheetReadyForRowOwner: true,
      materializerExplicitConfirmationRequired: true,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
      modelEvidencePromotionAllowed: false,
      productDisplayAuthorized: false,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST],
      requiredInputKindIds: [...REQUIRED_INPUT_KINDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1173: false,
      rowOwnerAssertionInferredByR1173: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1173: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1174Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      productDisplayAuthorized: false,
    },
    packetId: "r1174-ordinary-consumer-safe-next-step-packet",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1174-ordinary-consumer-safe-next-step-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      answerSheetReadyForRowOwner: true,
      explicitRowOwnerAssertionProvided: false,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
      modelEvidencePromotionAllowed: false,
      productDisplayAuthorized: false,
      r1176LiveChainCommand: R1176_COMMAND,
      readyForRowOwnerR1176LiveChainConfirmation: true,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST],
      requiredInputKindIds: [...REQUIRED_INPUT_KINDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1174: false,
      rowOwnerConfirmationInferredByR1174: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1174: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1176Fixture(confirmed: boolean): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      productDisplayAuthorized: false,
    },
    packetId: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      chainReady: confirmed,
      explicitRowOwnerAssertionProvided: confirmed,
      featureOnlyResearchPlanningReady: confirmed,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
      modelEvidencePromotionAllowed: false,
      ordinarySubmitterSafeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST],
      productDisplayAuthorized: false,
      requiredInputKindIds: [...REQUIRED_INPUT_KINDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1176: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1176: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

function recordAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const found = value[key];
  if (typeof found === "object" && found !== null && !Array.isArray(found)) {
    return found as Record<string, unknown>;
  }
  const replacement: Record<string, unknown> = {};
  value[key] = replacement;
  return replacement;
}

function execFilePromise(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  expectSuccess = true,
): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env }, (error, stdout, stderr) => {
      if (error !== null && expectSuccess) {
        reject(error);
        return;
      }
      resolve({
        exitCode: error && "code" in error && typeof error.code === "number" ? error.code : 0,
        stderr,
        stdout,
      });
    });
  });
}
