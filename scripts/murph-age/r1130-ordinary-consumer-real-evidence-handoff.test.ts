import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_SCHEMA_VERSION,
  runR1130OrdinaryConsumerRealEvidenceHandoff,
} from "./r1130-ordinary-consumer-real-evidence-handoff.ts";

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

describe("R1130 ordinary consumer real evidence handoff", () => {
  it("collapses the real evidence blocker into a row-owner config handoff", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1130-config-"));
    try {
      const paths = await writeInputs(tmp);

      const { output, outputPath } = await runR1130OrdinaryConsumerRealEvidenceHandoff({
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1130-ordinary-consumer-real-evidence-handoff.latest.json");
      expect(output.schemaVersion).toBe(R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_real_evidence_handoff_ready_for_row_owner_config",
        nextAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowOwnerWorkType: "complete_private_config",
        rowParsingPerformedByR1130: false,
        topPriority: "real_outcome_linked_labs_wearables_for_average_16_50_user",
      });
      expect(output.realEvidenceHandoff).toMatchObject({
        acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
        currentPrivateConfig: {
          candidateRunCountBand: "0",
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
          ordinaryTableLayout: "not_provided",
          readiness: "private_config_needs_completion",
          requiredTableRefsStatus: "not_provided",
          semanticRefCountBand: "0",
          submissionContextStatus: "not_provided",
        },
        firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
        minimumEvidenceFloor: {
          eventCount: "10_plus",
          usableRecordCount: "50_plus",
        },
        missingConfigChecklist: expect.any(Array),
        ordinarySubmitterGuidance: {
          acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
          averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
          missingSlotCount: 20,
          missingSlotTypes: MISSING_SLOT_TYPES,
          privateDetailsStored: false,
          readyForR1125: false,
          realAggregateStillMissing: true,
          sourceFamilyMissingSlotRollup: expect.any(Array),
        },
        priorityInputFamilies: ["bloodwork_labs", "vitals_body_context", "wearable_activity"],
        privateConfigTemplateArtifact: "r1121-fillable-local-private-consumer-receipt-runner-config.json",
        privateValuesStored: false,
        requiredPrivateFieldRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
        requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
        rowOwnerWorkType: "complete_private_config",
        sourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
        targetAgeBand: "roughly_16_50",
      });
      expect(output.realEvidenceHandoff.blockers).toEqual([
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
        "private_config_not_ready_for_r1125",
      ]);
      expect(output.realEvidenceHandoff.missingConfigChecklist).toHaveLength(20);
      expect(output.realEvidenceHandoff.missingConfigChecklist).toContainEqual({
        acceptedTableLayouts: [],
        detail: "lab_glycemia_first_pass",
        requiredForCandidateIds: ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"],
        slotId: "labGlycemia",
        slotType: "semantic_ref_family",
      });
      expect(output.realEvidenceHandoff.missingConfigChecklist).toContainEqual({
        acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
        detail: "provide_table_ref_slot_or_use_single_primary_table_fallback",
        requiredForCandidateIds: [],
        slotId: "wearableTableRef",
        slotType: "table_ref",
      });
      expect(output.realEvidenceHandoff.missingConfigChecklist).toContainEqual({
        acceptedTableLayouts: [],
        detail: "include_bloodwork_labs_vitals_body_context_and_wearable_activity",
        requiredForCandidateIds: [],
        slotId: "priorityInputFamilies",
        slotType: "submission_context_field",
      });
      expect(output.realEvidenceHandoff.ordinarySubmitterGuidance.sourceFamilyMissingSlotRollup).toContainEqual({
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
      });
      expect(output.realEvidenceHandoff.ordinarySubmitterGuidance.sourceFamilyMissingSlotRollup).toContainEqual({
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
        requiredSemanticRefFamilies: ["wearableActivity"],
        requiredTableRefs: ["wearableTableRef"],
        status: "needs_private_config",
      });
      expect(output.realEvidenceHandoff.nonEvidenceExcluded.map((item) => item.artifact)).toEqual([
        "r1126-nhanes-shadow-first-pass-metric-adapter.latest.json",
        "r1128-ordinary-consumer-pipeline-smoke-proof.latest.json",
      ]);
      expect(output.realEvidenceHandoff.commands.configIntakeCommand).toContain(
        "r1122-local-private-consumer-receipt-runner-config-intake.ts",
      );
      expect(output.realEvidenceHandoff.commands.privateRunnerCommand).toContain(
        "r1125-local-private-first-pass-aggregate-metric-runner.ts",
      );
      expect(output.realEvidenceHandoff.commands.metricIntakeCommand).toContain(
        "r1124-consumer-first-pass-aggregate-metric-intake.ts",
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

  it("moves to private-runner execution once the real private config is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1130-runner-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1122Path, r1122Fixture({
        candidateRunCountBand: "10-99",
        conclusion: "local_private_runner_config_ready_for_local_aggregate_receipt",
        missingFirstPassCandidateIds: [],
        missingSemanticRefFamilies: [],
        missingSubmissionContextFields: [],
        missingTableRefs: [],
        ordinaryTableLayout: "single_primary_table_fallback",
        requiredTableRefsStatus: "complete",
        semanticRefCountBand: "10-99",
        submissionContextStatus: "complete_real_evidence",
      }));

      const { output } = await runR1130OrdinaryConsumerRealEvidenceHandoff({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_real_evidence_handoff_ready_for_private_runner",
        nextAction: "run_r1125_private_runner_then_r1124_real_metric_intake",
        rowOwnerWorkType: "run_private_runner",
      });
      expect(output.realEvidenceHandoff.currentPrivateConfig.readiness).toBe("private_config_ready_for_r1125");
      expect(output.realEvidenceHandoff.missingConfigChecklist).toEqual([]);
      expect(output.realEvidenceHandoff.ordinarySubmitterGuidance).toMatchObject({
        missingSlotCount: 0,
        missingSlotTypes: [],
        readyForR1125: true,
      });
      expect(output.realEvidenceHandoff.ordinarySubmitterGuidance.sourceFamilyMissingSlotRollup.every((family) =>
        family.missingSlotCount === 0 && family.status === "ready_for_private_runner"
      )).toBe(true);
      expect(output.realEvidenceHandoff.blockers).toEqual([
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
      ]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("opens ReviewGPT only when the real evidence gate is already ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1130-delta-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1129Path, r1129Fixture({
        blockers: [],
        conclusion: "consumer_real_evidence_gate_ready_for_reviewgpt_delta",
        nextAction: "send_real_consumer_first_pass_delta_to_reviewgpt",
        reviewGptRequiredNow: true,
      }));

      const { output } = await runR1130OrdinaryConsumerRealEvidenceHandoff({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_real_evidence_handoff_ready_for_reviewgpt_delta",
        nextAction: "send_real_consumer_first_pass_delta_to_reviewgpt",
        reviewGptRequiredNow: true,
        rowOwnerWorkType: "review_real_delta",
      });
      expect(output.realEvidenceHandoff.blockers).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("preserves no-delta receipts as source-search memory", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1130-nodelta-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1129Path, r1129Fixture({
        blockers: ["stronger_or_independent_real_consumer_receipt_needed"],
        conclusion: "consumer_real_evidence_gate_valid_no_delta_continue_source_search",
        nextAction: "record_no_delta_and_continue_consumer_receipt_search",
      }));

      const { output } = await runR1130OrdinaryConsumerRealEvidenceHandoff({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_real_evidence_handoff_no_delta_continue_search",
        nextAction: "continue_consumer_source_search_after_real_no_delta",
        rowOwnerWorkType: "continue_source_search",
      });
      expect(output.realEvidenceHandoff.blockers).toEqual([
        "stronger_or_independent_real_consumer_receipt_needed",
      ]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when required handoff inputs are stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1130-stale-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1127Path, {
        artifactBoundary: safeBoundary("R1127"),
        packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
        schemaVersion: "stale",
      });

      const { output } = await runR1130OrdinaryConsumerRealEvidenceHandoff({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_real_evidence_handoff_waiting_on_refresh",
        nextAction: "refresh_r1122_r1127_r1129_before_handoff",
        rowOwnerWorkType: "refresh_handoff_inputs",
      });
      expect(output.realEvidenceHandoff.blockers).toEqual([
        "refresh_r1127_r1129_before_real_evidence_handoff",
      ]);
      expect(output.inputArtifacts.r1127).toMatchObject({
        packetId: "r1127-ordinary-consumer-first-pass-submission-handoff",
        schemaVersion: null,
        status: "available",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1130-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1129Path, {
        ...r1129Fixture(),
        artifactBoundary: {
          ...safeBoundary("R1129"),
          rowValuesStored: true,
        },
      });

      await expect(runR1130OrdinaryConsumerRealEvidenceHandoff({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1130 rejected unsafe r1129 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1130-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1130-ordinary-consumer-real-evidence-handoff.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1122_LOCAL_PRIVATE_CONFIG_INTAKE_PATH: paths.r1122Path,
          MURPH_AGE_R1127_ORDINARY_CONSUMER_SUBMISSION_HANDOFF_PATH: paths.r1127Path,
          MURPH_AGE_R1129_CONSUMER_REAL_EVIDENCE_GATE_PATH: paths.r1129Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        blockers: string[];
        conclusion: string;
        ordinarySubmitterMissingSlotCount: number;
        ordinarySubmitterMissingSlotTypes: string[];
        ordinarySubmitterReadyForR1125: boolean;
        privateConfigReadiness: string;
        productDisplayAuthorized: boolean;
        reviewGptRequiredNow: boolean;
        rowOwnerWorkType: string;
        sourceFamilyIds: string[];
        sourceFamilyMissingSlotRollup: Array<{
          familyId: string;
          missingSlotCount: number;
          missingSlotIds: string[];
          status: string;
        }>;
      };
      expect(summary).toMatchObject({
        blockers: [
          "real_outcome_linked_labs_wearables_aggregate_missing",
          "r1124_first_pass_aggregate_metrics_not_provided",
          "l1_l2_w1_qc_first_pass_metrics_incomplete",
          "private_config_not_ready_for_r1125",
        ],
        conclusion: "ordinary_consumer_real_evidence_handoff_ready_for_row_owner_config",
        ordinarySubmitterMissingSlotCount: 20,
        ordinarySubmitterMissingSlotTypes: MISSING_SLOT_TYPES,
        ordinarySubmitterReadyForR1125: false,
        privateConfigReadiness: "private_config_needs_completion",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowOwnerWorkType: "complete_private_config",
        sourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      });
      expect(summary.sourceFamilyMissingSlotRollup).toContainEqual({
        familyId: "wearable_activity_daily",
        missingSlotCount: 3,
        missingSlotIds: ["W1_activity_steps_minutes", "wearableActivity", "wearableTableRef"],
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
  r1122Path: string;
  r1127Path: string;
  r1129Path: string;
}> {
  const paths = {
    r1122Path: path.join(tmp, "r1122.json"),
    r1127Path: path.join(tmp, "r1127.json"),
    r1129Path: path.join(tmp, "r1129.json"),
  };
  await Promise.all([
    writeJson(paths.r1122Path, r1122Fixture()),
    writeJson(paths.r1127Path, r1127Fixture()),
    writeJson(paths.r1129Path, r1129Fixture()),
  ]);
  return paths;
}

function r1122Fixture(overrides: {
  candidateRunCountBand?: string;
  conclusion?: string;
  missingFirstPassCandidateIds?: string[];
  missingSemanticRefFamilies?: string[];
  missingSubmissionContextFields?: string[];
  missingTableRefs?: string[];
  ordinaryTableLayout?: string;
  requiredTableRefsStatus?: string;
  semanticRefCountBand?: string;
  submissionContextStatus?: string;
} = {}): Record<string, unknown> {
  const missingFirstPassCandidateIds = overrides.missingFirstPassCandidateIds ?? FIRST_PASS_CANDIDATE_IDS;
  const missingSemanticRefFamilies = overrides.missingSemanticRefFamilies ?? REQUIRED_PRIVATE_FIELD_REF_FAMILIES;
  const missingSubmissionContextFields = overrides.missingSubmissionContextFields ?? [
    "evidenceRole",
    "ordinaryConsumerSubmission",
    "outcomeLinked",
    "priorityInputFamilies",
    "targetAgeBand",
  ];
  const missingTableRefs = overrides.missingTableRefs ?? REQUIRED_PRIVATE_TABLE_REFS;
  const readyForR1125 = overrides.conclusion === "local_private_runner_config_ready_for_local_aggregate_receipt"
    && overrides.submissionContextStatus === "complete_real_evidence";
  return {
    artifactBoundary: safeBoundary("R1122"),
    configIntake: {
      candidateRunCountBand: overrides.candidateRunCountBand ?? "0",
      missingFirstPassCandidateIds,
      missingSemanticRefFamilies,
      missingSubmissionContextFields,
      missingTableRefs,
      ordinarySubmitterGuidance: ordinarySubmitterGuidanceFixture({
        missingFirstPassCandidateIds,
        missingSemanticRefFamilies,
        missingSubmissionContextFields,
        missingTableRefs,
        readyForR1125,
        submissionContextStatus: overrides.submissionContextStatus ?? "not_provided",
      }),
      ordinaryTableLayout: overrides.ordinaryTableLayout ?? "not_provided",
      requiredTableRefsStatus: overrides.requiredTableRefsStatus ?? "not_provided",
      semanticRefCountBand: overrides.semanticRefCountBand ?? "0",
      submissionContextStatus: overrides.submissionContextStatus ?? "not_provided",
    },
    packetId: "r1122-local-private-consumer-receipt-runner-config-intake",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1122-local-private-consumer-receipt-runner-config-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: overrides.conclusion ?? "local_private_runner_config_not_provided",
      nextAction: "fill_private_runner_config_before_local_receipt",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1122: false,
    },
  };
}

function ordinarySubmitterGuidanceFixture(input: {
  missingFirstPassCandidateIds: string[];
  missingSemanticRefFamilies: string[];
  missingSubmissionContextFields: string[];
  missingTableRefs: string[];
  readyForR1125: boolean;
  submissionContextStatus: string;
}): Record<string, unknown> {
  return {
    acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
    averageSubmitterAgeBand: "roughly_16_50",
    averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
    minimumEvidenceFloor: {
      eventCount: "10_plus",
      usableRecordCount: "50_plus",
    },
    missingSlotCount: input.missingFirstPassCandidateIds.length
      + input.missingSemanticRefFamilies.length
      + input.missingSubmissionContextFields.length
      + input.missingTableRefs.length,
    missingSlotTypes: missingSlotTypesFor(input),
    privateDetailsStored: false,
    readyForR1125: input.readyForR1125,
    realAggregateStillMissing: true,
    sourceFamilies: ordinarySubmitterSourceFamilies(input),
    submissionContext: {
      missingFields: input.missingSubmissionContextFields,
      requiredFields: [
        "evidenceRole",
        "ordinaryConsumerSubmission",
        "outcomeLinked",
        "priorityInputFamilies",
        "targetAgeBand",
      ],
      status: input.submissionContextStatus,
    },
  };
}

function ordinarySubmitterSourceFamilies(input: {
  missingFirstPassCandidateIds: string[];
  missingSemanticRefFamilies: string[];
  missingTableRefs: string[];
  readyForR1125: boolean;
}): Array<Record<string, unknown>> {
  return ordinarySubmitterSourceFamilyDefinitions().map((family) => {
    const requiredForCandidateIds = readStringArray(family.requiredForCandidateIds);
    const requiredSemanticRefFamilies = readStringArray(family.requiredSemanticRefFamilies);
    const requiredTableRefs = readStringArray(family.requiredTableRefs);
    const missingSlotIds = [
      ...requiredForCandidateIds.filter((slotId) => input.missingFirstPassCandidateIds.includes(slotId)),
      ...requiredSemanticRefFamilies.filter((slotId) => input.missingSemanticRefFamilies.includes(slotId)),
      ...requiredTableRefs.filter((slotId) => input.missingTableRefs.includes(slotId)),
    ];
    return {
      ...family,
      missingSlotIds,
      status: input.readyForR1125
        ? "ready_for_private_runner"
        : missingSlotIds.length > 0
          ? "needs_private_config"
          : "mapped_or_not_blocking",
    };
  });
}

function ordinarySubmitterSourceFamilyDefinitions(): Array<Record<string, unknown>> {
  return [
    {
      acceptableForAverageUser: true,
      familyId: "join_time_alignment",
      inputKind: "stable_join_key_and_date_fields",
      privateDetailsStored: false,
      requiredForCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      requiredSemanticRefFamilies: ["personJoinKey", "dateOrTimeKey"],
      requiredTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
      role: "join_and_time_alignment",
    },
    {
      acceptableForAverageUser: true,
      familyId: "outcome_linkage",
      inputKind: "outcome_or_followup_table",
      privateDetailsStored: false,
      requiredForCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      requiredSemanticRefFamilies: ["outcomeEvent"],
      requiredTableRefs: ["outcomeTableRef"],
      role: "outcome_linkage",
    },
    {
      acceptableForAverageUser: true,
      familyId: "bloodwork_glycemia",
      inputKind: "bloodwork_table_or_lab_portal_export",
      privateDetailsStored: false,
      requiredForCandidateIds: ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"],
      requiredSemanticRefFamilies: ["labGlycemia"],
      requiredTableRefs: ["labTableRef"],
      role: "bloodwork_glycemia_signal",
    },
    {
      acceptableForAverageUser: true,
      familyId: "common_bloodwork_core",
      inputKind: "bloodwork_table_or_lab_portal_export",
      privateDetailsStored: false,
      requiredForCandidateIds: ["L2_common_lab_core_shadow"],
      requiredSemanticRefFamilies: ["commonLabCore"],
      requiredTableRefs: ["labTableRef"],
      role: "common_bloodwork_shadow_signal",
    },
    {
      acceptableForAverageUser: true,
      familyId: "vitals_body_context",
      inputKind: "body_or_vitals_table",
      privateDetailsStored: false,
      requiredForCandidateIds: ["L2_common_lab_core_shadow"],
      requiredSemanticRefFamilies: ["vitalsBody"],
      requiredTableRefs: ["labTableRef", "primaryTableRef"],
      role: "vitals_body_context",
    },
    {
      acceptableForAverageUser: true,
      familyId: "wearable_activity_daily",
      inputKind: "daily_wearable_activity_export_or_spreadsheet",
      privateDetailsStored: false,
      requiredForCandidateIds: ["W1_activity_steps_minutes"],
      requiredSemanticRefFamilies: ["wearableActivity"],
      requiredTableRefs: ["wearableTableRef"],
      role: "wearable_activity_signal",
    },
  ];
}

function missingSlotTypesFor(input: {
  missingFirstPassCandidateIds: string[];
  missingSemanticRefFamilies: string[];
  missingSubmissionContextFields: string[];
  missingTableRefs: string[];
}): string[] {
  const types: string[] = [];
  if (input.missingFirstPassCandidateIds.length > 0) types.push("first_pass_candidate");
  if (input.missingSemanticRefFamilies.length > 0) types.push("semantic_ref_family");
  if (input.missingSubmissionContextFields.length > 0) types.push("submission_context_field");
  if (input.missingTableRefs.length > 0) types.push("table_ref");
  return types;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
      semanticFieldFamilies: [
        {
          familyId: "personJoinKey",
          requiredForCandidateIds: FIRST_PASS_CANDIDATE_IDS,
          role: "join_records_without_egress",
        },
        {
          familyId: "dateOrTimeKey",
          requiredForCandidateIds: FIRST_PASS_CANDIDATE_IDS,
          role: "time_alignment_only",
        },
        {
          familyId: "outcomeEvent",
          requiredForCandidateIds: FIRST_PASS_CANDIDATE_IDS,
          role: "outcome_linkage_only",
        },
        {
          familyId: "labGlycemia",
          requiredForCandidateIds: ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"],
          role: "lab_glycemia_first_pass",
        },
        {
          familyId: "commonLabCore",
          requiredForCandidateIds: ["L2_common_lab_core_shadow"],
          role: "common_lab_core_shadow",
        },
        {
          familyId: "vitalsBody",
          requiredForCandidateIds: ["L2_common_lab_core_shadow"],
          role: "vitals_body_context_shadow",
        },
        {
          familyId: "wearableActivity",
          requiredForCandidateIds: ["W1_activity_steps_minutes"],
          role: "wearable_activity_first_pass",
        },
      ],
      ordinaryTableLayouts: ORDINARY_TABLE_LAYOUTS,
      privateConfigTemplateArtifact: "r1121-fillable-local-private-consumer-receipt-runner-config.json",
      privateValuesStored: false,
      requiredPrivateFieldRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
      requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
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
    },
  };
}

function r1129Fixture(overrides: {
  blockers?: string[];
  conclusion?: string;
  nextAction?: string;
  reviewGptRequiredNow?: boolean;
} = {}): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1129"),
    packetId: "r1129-consumer-real-evidence-gate",
    productDisplayAuthorized: false,
    realEvidenceGate: {
      acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
      blockers: overrides.blockers ?? [
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
      ],
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      priorityInputFamilies: ["bloodwork_labs", "vitals_body_context", "wearable_activity"],
      rejectedAsModelEvidence: [
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
      ],
      sourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      targetAgeBand: "roughly_16_50",
    },
    schemaVersion: "murph-age-r1129-consumer-real-evidence-gate.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: overrides.conclusion ?? "consumer_real_evidence_gate_waiting_on_real_labs_wearables_aggregate",
      nextAction: overrides.nextAction ?? "collect_or_run_real_outcome_linked_labs_wearables_aggregate_metrics",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: overrides.reviewGptRequiredNow ?? false,
      rowParsingPerformedByR1129: false,
      topPriority: "real_outcome_linked_labs_wearables_for_average_16_50_user",
    },
  };
}

function safeBoundary(stage: "R1122" | "R1127" | "R1129"): Record<string, unknown> {
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
