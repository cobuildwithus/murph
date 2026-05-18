import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_SCHEMA_VERSION,
  runR1132OrdinaryConsumerSubmissionReadiness,
} from "./r1132-ordinary-consumer-submission-readiness.ts";

const FIRST_PASS_CANDIDATE_IDS = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "QC_missingness_coverage",
];
const REQUIRED_PRIVATE_FIELD_REF_FAMILIES = [
  "personJoinKey",
  "dateOrTimeKey",
  "outcomeEvent",
  "labGlycemia",
  "commonLabCore",
  "vitalsBody",
  "wearableActivity",
];
const REQUIRED_PRIVATE_TABLE_REFS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
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
const MISSING_SLOT_TYPES = [
  "first_pass_candidate",
  "semantic_ref_family",
  "submission_context_field",
  "table_ref",
];

describe("R1132 ordinary consumer submission readiness", () => {
  it("turns the handoff and completion audit into an average submitter readiness packet", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1132-ready-"));
    try {
      const paths = await writeInputs(tmp);

      const { output, outputPath } = await runR1132OrdinaryConsumerSubmissionReadiness({
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1132-ordinary-consumer-submission-readiness.latest.json");
      expect(output.schemaVersion).toBe(R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        conclusion: "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
        missingSlotCount: 20,
        missingSlotTypes: MISSING_SLOT_TYPES,
        nextAction: "fill_average_submitter_private_config_slots",
        productDisplayAuthorized: false,
        readyForPrivateRunner: false,
        realAggregateStillMissing: true,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1132: false,
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.ordinaryConsumerReadiness.minimalSubmissionBundle).toMatchObject({
        acceptedInputProfile: "consumer_bloodwork_labs_wearables_16_50_first",
        acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
        firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
        minimumEvidenceFloor: {
          eventCount: "10_plus",
          usableRecordCount: "50_plus",
        },
        priorityInputFamilies: ["bloodwork_labs", "vitals_body_context", "wearable_activity"],
        requiresOutcomeLinkage: true,
        targetAgeBand: "roughly_16_50",
      });
      expect(output.ordinaryConsumerReadiness.missingSlotSummary).toEqual({
        bySlotType: {
          first_pass_candidate: 4,
          semantic_ref_family: 7,
          submission_context_field: 5,
          table_ref: 4,
        },
        missingSlotIds: [
          ...FIRST_PASS_CANDIDATE_IDS,
          ...REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
          "evidenceRole",
          "ordinaryConsumerSubmission",
          "outcomeLinked",
          "priorityInputFamilies",
          "targetAgeBand",
          ...REQUIRED_PRIVATE_TABLE_REFS,
        ],
        total: 20,
      });
      expect(output.ordinaryConsumerReadiness.sourceFamilies).toHaveLength(6);
      expect(output.ordinaryConsumerReadiness.sourceFamilies).toContainEqual({
        acceptableForAverageUser: true,
        familyId: "bloodwork_glycemia",
        inputKind: "bloodwork_table_or_lab_portal_export",
        missingSlotCount: 4,
        missingSlotIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "labGlycemia",
          "labTableRef",
        ],
        privateDetailsStored: false,
        requiredForCandidateIds: ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"],
        requiredForFirstPass: true,
        requiredPrivateFieldRefFamilies: ["labGlycemia"],
        requiredPrivateTableRefs: ["labTableRef"],
        status: "needs_private_config",
      });
      expect(output.ordinaryConsumerReadiness.sourceFamilies).toContainEqual({
        acceptableForAverageUser: true,
        familyId: "wearable_activity_daily",
        inputKind: "daily_wearable_activity_export_or_spreadsheet",
        missingSlotCount: 3,
        missingSlotIds: [
          "W1_activity_steps_minutes",
          "wearableActivity",
          "wearableTableRef",
        ],
        privateDetailsStored: false,
        requiredForCandidateIds: ["W1_activity_steps_minutes"],
        requiredForFirstPass: true,
        requiredPrivateFieldRefFamilies: ["wearableActivity"],
        requiredPrivateTableRefs: ["wearableTableRef"],
        status: "needs_private_config",
      });
      expect(output.ordinaryConsumerReadiness.completionAudit).toEqual({
        goalAchieved: false,
        readyToMarkComplete: false,
        topMissingRequirement: "real_outcome_linked_labs_wearables_aggregate_exists",
      });
      expect(output.ordinaryConsumerReadiness.blockers).toEqual([
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
        "private_config_not_ready_for_r1125",
        "r1125_real_aggregate_metrics_not_materialized",
      ]);
      expect(output.ordinaryConsumerReadiness.commands.configIntakeCommand).toContain(
        "r1122-local-private-consumer-receipt-runner-config-intake.ts",
      );
      expect(output.ordinaryConsumerReadiness.commands.privateRunnerCommand).toContain(
        "r1125-local-private-first-pass-aggregate-metric-runner.ts",
      );
      expect(output.ordinaryConsumerReadiness.commands.metricIntakeCommand).toContain(
        "r1124-consumer-first-pass-aggregate-metric-intake.ts",
      );
      expect(output.ordinaryConsumerReadiness.commands.completionAuditCommand).toContain(
        "r1131-consumer-real-evidence-completion-audit.ts",
      );
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("glucose_value");
      expect(JSON.stringify(output)).not.toContain("synthetic-person");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for refresh when a required input is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1132-stale-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1131Path, {
        artifactBoundary: safeBoundary("R1131"),
        packetId: "r1131-consumer-real-evidence-completion-audit",
        productDisplayAuthorized: false,
        schemaVersion: "stale",
      });

      const { output } = await runR1132OrdinaryConsumerSubmissionReadiness({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_submission_readiness_waiting_on_refresh",
        nextAction: "refresh_r1127_r1130_r1131_before_submitter_readiness",
        readyForPrivateRunner: false,
      });
      expect(output.ordinaryConsumerReadiness.blockers).toEqual([
        "refresh_required_submitter_readiness_inputs",
      ]);
      expect(output.inputArtifacts.r1131).toMatchObject({
        packetId: "r1131-consumer-real-evidence-completion-audit",
        schemaVersion: null,
        status: "available",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1132-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1130Path, {
        ...r1130Fixture(),
        artifactBoundary: {
          ...safeBoundary("R1130"),
          rowValuesStored: true,
        },
      });

      await expect(runR1132OrdinaryConsumerSubmissionReadiness({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1132 rejected unsafe r1130 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1132-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1132-ordinary-consumer-submission-readiness.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1127_ORDINARY_CONSUMER_SUBMISSION_HANDOFF_PATH: paths.r1127Path,
          MURPH_AGE_R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_PATH: paths.r1130Path,
          MURPH_AGE_R1131_CONSUMER_REAL_EVIDENCE_COMPLETION_AUDIT_PATH: paths.r1131Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        averageSubmitterFamilyIds: string[];
        conclusion: string;
        missingSlotCount: number;
        nextAction: string;
        productDisplayAuthorized: boolean;
        realAggregateStillMissing: boolean;
        sourceFamilyMissingSlotRollup: Array<{
          familyId: string;
          missingSlotCount: number;
          missingSlotIds: string[];
          status: string;
        }>;
      };
      expect(summary).toMatchObject({
        averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        conclusion: "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
        missingSlotCount: 20,
        nextAction: "fill_average_submitter_private_config_slots",
        productDisplayAuthorized: false,
        realAggregateStillMissing: true,
      });
      expect(summary.sourceFamilyMissingSlotRollup).toContainEqual({
        familyId: "bloodwork_glycemia",
        missingSlotCount: 4,
        missingSlotIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "labGlycemia",
          "labTableRef",
        ],
        status: "needs_private_config",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("glucose_value");
      expect(stdout).not.toContain("synthetic-person");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string): Promise<{
  r1127Path: string;
  r1130Path: string;
  r1131Path: string;
}> {
  const paths = {
    r1127Path: path.join(tmp, "r1127.json"),
    r1130Path: path.join(tmp, "r1130.json"),
    r1131Path: path.join(tmp, "r1131.json"),
  };
  await Promise.all([
    writeJson(paths.r1127Path, r1127Fixture()),
    writeJson(paths.r1130Path, r1130Fixture()),
    writeJson(paths.r1131Path, r1131Fixture()),
  ]);
  return paths;
}

function r1127Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1127"),
    ordinarySubmissionHandoff: {
      acceptedInputProfile: "consumer_bloodwork_labs_wearables_16_50_first",
      commands: {
        configIntakeCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts",
        executionCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts",
      },
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      minimumEvidenceFloor: {
        eventCount: "10_plus",
        usableRecordCount: "50_plus",
      },
      ordinarySourceFamilies: ordinarySourceFamilies(),
      ordinaryTableLayouts: ORDINARY_TABLE_LAYOUTS,
      privateValuesStored: false,
      requiredPrivateFieldRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
      requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
      submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
    },
    packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1127-ordinary-consumer-first-pass-submission-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_consumer_first_pass_submission_handoff_ready",
      nextAction: "fill_private_config_with_ordinary_labs_wearable_refs_then_run_r1125",
      ordinarySourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1127: false,
      submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1130Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1130"),
    packetId: "r1130-ordinary-consumer-real-evidence-handoff",
    productDisplayAuthorized: false,
    realEvidenceHandoff: {
      acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
      blockers: [
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
        "private_config_not_ready_for_r1125",
      ],
      commands: {
        configIntakeCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts",
        metricIntakeCommand:
          "MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH=<aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts",
        privateRunnerCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts",
      },
      currentPrivateConfig: {
        missingFirstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
        missingSemanticRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
        missingSubmissionContextFields: [
          "evidenceRole",
          "ordinaryConsumerSubmission",
          "outcomeLinked",
          "priorityInputFamilies",
          "targetAgeBand",
        ],
        missingTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
        readiness: "private_config_needs_completion",
      },
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      minimumEvidenceFloor: {
        eventCount: "10_plus",
        usableRecordCount: "50_plus",
      },
      missingConfigChecklist: missingConfigChecklist(),
      ordinarySubmitterGuidance: {
        acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
        averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        missingSlotCount: 20,
        missingSlotTypes: MISSING_SLOT_TYPES,
        privateDetailsStored: false,
        readyForR1125: false,
        realAggregateStillMissing: true,
        sourceFamilyMissingSlotRollup: sourceFamilyMissingSlotRollup(),
      },
      priorityInputFamilies: ["bloodwork_labs", "vitals_body_context", "wearable_activity"],
      privateValuesStored: false,
      requiredPrivateFieldRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
      requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
      rowOwnerWorkType: "complete_private_config",
      targetAgeBand: "roughly_16_50",
    },
    schemaVersion: "murph-age-r1130-ordinary-consumer-real-evidence-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_consumer_real_evidence_handoff_ready_for_row_owner_config",
      nextAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowOwnerWorkType: "complete_private_config",
      rowParsingPerformedByR1130: false,
      topPriority: "real_outcome_linked_labs_wearables_for_average_16_50_user",
    },
  };
}

function r1131Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1131"),
    completionAudit: {
      blockers: [
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
        "private_config_not_ready_for_r1125",
        "r1125_real_aggregate_metrics_not_materialized",
      ],
      goalAchieved: false,
      missingRequirementIds: ["real_outcome_linked_labs_wearables_aggregate_exists"],
      readyToMarkComplete: false,
    },
    packetId: "r1131-consumer-real-evidence-completion-audit",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1131-consumer-real-evidence-completion-audit.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "consumer_real_evidence_completion_audit_blocked_on_real_aggregate",
      goalAchieved: false,
      nextAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
      productDisplayAuthorized: false,
      readyToMarkComplete: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1131: false,
      topMissingRequirement: "real_outcome_linked_labs_wearables_aggregate_exists",
    },
  };
}

function ordinarySourceFamilies(): Array<Record<string, unknown>> {
  return [
    {
      acceptableForAverageUser: true,
      familyId: "join_time_alignment",
      inputKind: "stable_join_key_and_date_fields",
      privateDetailsStored: false,
      requiredForCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      requiredPrivateFieldRefFamilies: ["personJoinKey", "dateOrTimeKey"],
      requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
      role: "join_and_time_alignment",
    },
    {
      acceptableForAverageUser: true,
      familyId: "outcome_linkage",
      inputKind: "outcome_or_followup_table",
      privateDetailsStored: false,
      requiredForCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      requiredPrivateFieldRefFamilies: ["outcomeEvent"],
      requiredPrivateTableRefs: ["outcomeTableRef"],
      role: "outcome_linkage",
    },
    {
      acceptableForAverageUser: true,
      familyId: "bloodwork_glycemia",
      inputKind: "bloodwork_table_or_lab_portal_export",
      privateDetailsStored: false,
      requiredForCandidateIds: ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"],
      requiredPrivateFieldRefFamilies: ["labGlycemia"],
      requiredPrivateTableRefs: ["labTableRef"],
      role: "bloodwork_glycemia_signal",
    },
    {
      acceptableForAverageUser: true,
      familyId: "common_bloodwork_core",
      inputKind: "bloodwork_table_or_lab_portal_export",
      privateDetailsStored: false,
      requiredForCandidateIds: ["L2_common_lab_core_shadow"],
      requiredPrivateFieldRefFamilies: ["commonLabCore"],
      requiredPrivateTableRefs: ["labTableRef"],
      role: "common_bloodwork_shadow_signal",
    },
    {
      acceptableForAverageUser: true,
      familyId: "vitals_body_context",
      inputKind: "body_or_vitals_table",
      privateDetailsStored: false,
      requiredForCandidateIds: ["L2_common_lab_core_shadow"],
      requiredPrivateFieldRefFamilies: ["vitalsBody"],
      requiredPrivateTableRefs: ["labTableRef", "primaryTableRef"],
      role: "vitals_body_context",
    },
    {
      acceptableForAverageUser: true,
      familyId: "wearable_activity_daily",
      inputKind: "daily_wearable_activity_export_or_spreadsheet",
      privateDetailsStored: false,
      requiredForCandidateIds: ["W1_activity_steps_minutes"],
      requiredPrivateFieldRefFamilies: ["wearableActivity"],
      requiredPrivateTableRefs: ["wearableTableRef"],
      role: "wearable_activity_signal",
    },
  ];
}

function missingConfigChecklist(): Array<Record<string, unknown>> {
  return [
    ...FIRST_PASS_CANDIDATE_IDS.map((slotId) => ({
      acceptedTableLayouts: [],
      detail: "first_pass_candidate_required",
      requiredForCandidateIds: [slotId],
      slotId,
      slotType: "first_pass_candidate",
    })),
    ...REQUIRED_PRIVATE_FIELD_REF_FAMILIES.map((slotId) => ({
      acceptedTableLayouts: [],
      detail: "semantic_ref_family_required",
      requiredForCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      slotId,
      slotType: "semantic_ref_family",
    })),
    ...[
      "evidenceRole",
      "ordinaryConsumerSubmission",
      "outcomeLinked",
      "priorityInputFamilies",
      "targetAgeBand",
    ].map((slotId) => ({
      acceptedTableLayouts: [],
      detail: "submission_context_required",
      requiredForCandidateIds: [],
      slotId,
      slotType: "submission_context_field",
    })),
    ...REQUIRED_PRIVATE_TABLE_REFS.map((slotId) => ({
      acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
      detail: "table_ref_required",
      requiredForCandidateIds: [],
      slotId,
      slotType: "table_ref",
    })),
  ];
}

function sourceFamilyMissingSlotRollup(): Array<Record<string, unknown>> {
  return [
    {
      acceptableForAverageUser: true,
      familyId: "join_time_alignment",
      inputKind: "stable_join_key_and_date_fields",
      missingSlotCount: 10,
      missingSlotIds: [
        ...FIRST_PASS_CANDIDATE_IDS,
        "personJoinKey",
        "dateOrTimeKey",
        ...REQUIRED_PRIVATE_TABLE_REFS,
      ],
      privateDetailsStored: false,
      requiredForCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      requiredSemanticRefFamilies: ["personJoinKey", "dateOrTimeKey"],
      requiredTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
      status: "needs_private_config",
    },
    {
      acceptableForAverageUser: true,
      familyId: "outcome_linkage",
      inputKind: "outcome_or_followup_table",
      missingSlotCount: 6,
      missingSlotIds: [...FIRST_PASS_CANDIDATE_IDS, "outcomeEvent", "outcomeTableRef"],
      privateDetailsStored: false,
      requiredForCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      requiredSemanticRefFamilies: ["outcomeEvent"],
      requiredTableRefs: ["outcomeTableRef"],
      status: "needs_private_config",
    },
    {
      acceptableForAverageUser: true,
      familyId: "bloodwork_glycemia",
      inputKind: "bloodwork_table_or_lab_portal_export",
      missingSlotCount: 4,
      missingSlotIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "labGlycemia",
        "labTableRef",
      ],
      privateDetailsStored: false,
      requiredForCandidateIds: ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"],
      requiredSemanticRefFamilies: ["labGlycemia"],
      requiredTableRefs: ["labTableRef"],
      status: "needs_private_config",
    },
    {
      acceptableForAverageUser: true,
      familyId: "common_bloodwork_core",
      inputKind: "bloodwork_table_or_lab_portal_export",
      missingSlotCount: 3,
      missingSlotIds: ["L2_common_lab_core_shadow", "commonLabCore", "labTableRef"],
      privateDetailsStored: false,
      requiredForCandidateIds: ["L2_common_lab_core_shadow"],
      requiredSemanticRefFamilies: ["commonLabCore"],
      requiredTableRefs: ["labTableRef"],
      status: "needs_private_config",
    },
    {
      acceptableForAverageUser: true,
      familyId: "vitals_body_context",
      inputKind: "body_or_vitals_table",
      missingSlotCount: 4,
      missingSlotIds: ["L2_common_lab_core_shadow", "vitalsBody", "labTableRef", "primaryTableRef"],
      privateDetailsStored: false,
      requiredForCandidateIds: ["L2_common_lab_core_shadow"],
      requiredSemanticRefFamilies: ["vitalsBody"],
      requiredTableRefs: ["labTableRef", "primaryTableRef"],
      status: "needs_private_config",
    },
    {
      acceptableForAverageUser: true,
      familyId: "wearable_activity_daily",
      inputKind: "daily_wearable_activity_export_or_spreadsheet",
      missingSlotCount: 3,
      missingSlotIds: ["W1_activity_steps_minutes", "wearableActivity", "wearableTableRef"],
      privateDetailsStored: false,
      requiredForCandidateIds: ["W1_activity_steps_minutes"],
      requiredSemanticRefFamilies: ["wearableActivity"],
      requiredTableRefs: ["wearableTableRef"],
      status: "needs_private_config",
    },
  ];
}

function safeBoundary(stage: string): Record<string, unknown> {
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
    privateConfigValuesStored: false,
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
