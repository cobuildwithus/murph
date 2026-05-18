import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1131_CONSUMER_REAL_EVIDENCE_COMPLETION_AUDIT_SCHEMA_VERSION,
  runR1131ConsumerRealEvidenceCompletionAudit,
} from "./r1131-consumer-real-evidence-completion-audit.ts";

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
const ORDINARY_TABLE_LAYOUTS = ["single_primary_table_fallback", "multi_table_or_explicit_refs"];

describe("R1131 consumer real evidence completion audit", () => {
  it("keeps the active labs and wearables objective blocked until real aggregate evidence exists", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1131-blocked-"));
    try {
      const paths = await writeInputs(tmp);

      const { output, outputPath } = await runR1131ConsumerRealEvidenceCompletionAudit({
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1131-consumer-real-evidence-completion-audit.latest.json");
      expect(output.schemaVersion).toBe(R1131_CONSUMER_REAL_EVIDENCE_COMPLETION_AUDIT_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "consumer_real_evidence_completion_audit_blocked_on_real_aggregate",
        goalAchieved: false,
        nextAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
        productDisplayAuthorized: false,
        readyToMarkComplete: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1131: false,
        topMissingRequirement: "real_outcome_linked_labs_wearables_aggregate_exists",
      });
      expect(output.completionAudit).toMatchObject({
        goalAchieved: false,
        nextConcreteAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
        readyToMarkComplete: false,
        restatedObjective: "build_murph_age_model_prioritizing_ordinary_16_50_labs_wearables",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "real_outcome_linked_labs_wearables_aggregate_exists",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
        "private_config_not_ready_for_r1125",
        "r1125_real_aggregate_metrics_not_materialized",
      ]);
      expect(statusByRequirement(output.completionAudit.checklist)).toEqual({
        active_autoresearch_loop_has_concrete_next_action: "satisfied",
        ordinary_16_50_submission_path_available: "satisfied",
        privacy_and_product_gate_closed: "satisfied",
        real_outcome_linked_labs_wearables_aggregate_exists: "missing",
        wearable_and_bloodwork_priority_visible: "satisfied",
      });
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

  it("waits for refresh when a required audit input is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1131-stale-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1130Path, {
        artifactBoundary: safeBoundary("R1130"),
        packetId: "r1130-ordinary-consumer-real-evidence-handoff",
        productDisplayAuthorized: false,
        schemaVersion: "stale",
      });

      const { output } = await runR1131ConsumerRealEvidenceCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_real_evidence_completion_audit_waiting_on_refresh",
        goalAchieved: false,
        readyToMarkComplete: false,
      });
      expect(output.completionAudit.blockers).toEqual(["refresh_required_audit_inputs"]);
      expect(output.inputArtifacts.r1130).toMatchObject({
        packetId: "r1130-ordinary-consumer-real-evidence-handoff",
        schemaVersion: null,
        status: "available",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not let a runner artifact override unresolved real-evidence blockers", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1131-runner-artifact-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1125Path, r1125Fixture({
        aggregateMetricsArtifact: "r1125-consumer-first-pass-aggregate-metrics.json",
      }));

      const { output } = await runR1131ConsumerRealEvidenceCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_real_evidence_completion_audit_blocked_on_real_aggregate",
        goalAchieved: false,
        readyToMarkComplete: false,
        topMissingRequirement: "real_outcome_linked_labs_wearables_aggregate_exists",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "real_outcome_linked_labs_wearables_aggregate_exists",
      ]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1131-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1125Path, {
        ...r1125Fixture(),
        artifactBoundary: {
          ...safeBoundary("R1125"),
          rowValuesStored: true,
        },
      });

      await expect(runR1131ConsumerRealEvidenceCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1131 rejected unsafe r1125 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1131-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1131-consumer-real-evidence-completion-audit.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH: paths.r1076Path,
          MURPH_AGE_R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_PATH: paths.r1125Path,
          MURPH_AGE_R1129_CONSUMER_REAL_EVIDENCE_GATE_PATH: paths.r1129Path,
          MURPH_AGE_R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_PATH: paths.r1130Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        goalAchieved: boolean;
        missingRequirementIds: string[];
        nextAction: string;
        productDisplayAuthorized: boolean;
        readyToMarkComplete: boolean;
        topMissingRequirement: string;
      };
      expect(summary).toMatchObject({
        conclusion: "consumer_real_evidence_completion_audit_blocked_on_real_aggregate",
        goalAchieved: false,
        missingRequirementIds: ["real_outcome_linked_labs_wearables_aggregate_exists"],
        nextAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
        productDisplayAuthorized: false,
        readyToMarkComplete: false,
        topMissingRequirement: "real_outcome_linked_labs_wearables_aggregate_exists",
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
  r1076Path: string;
  r1125Path: string;
  r1129Path: string;
  r1130Path: string;
}> {
  const paths = {
    r1076Path: path.join(tmp, "r1076.json"),
    r1125Path: path.join(tmp, "r1125.json"),
    r1129Path: path.join(tmp, "r1129.json"),
    r1130Path: path.join(tmp, "r1130.json"),
  };
  await Promise.all([
    writeJson(paths.r1076Path, r1076Fixture()),
    writeJson(paths.r1125Path, r1125Fixture()),
    writeJson(paths.r1129Path, r1129Fixture()),
    writeJson(paths.r1130Path, r1130Fixture()),
  ]);
  return paths;
}

function r1076Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1076"),
    packetId: "r1076-current-autoresearch-loop-executor",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1076-current-autoresearch-loop-executor.v1",
    status: "research-local-aggregate-only",
    summary: {
      nextAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1076: false,
      routerNextAction: "continue_consumer_labs_wearables_first_pass",
    },
  };
}

function r1125Fixture(overrides: {
  aggregateMetricsArtifact?: string | null;
} = {}): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1125"),
    packetId: "r1125-local-private-first-pass-aggregate-metric-runner",
    privateExecution: {
      aggregateMetricsArtifact: overrides.aggregateMetricsArtifact ?? null,
      configIntakeConclusion: "local_private_runner_config_not_provided",
      configIntakeMissingPieces: {
        firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
        semanticRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
        submissionContextFields: [
          "evidenceRole",
          "ordinaryConsumerSubmission",
          "outcomeLinked",
          "priorityInputFamilies",
          "targetAgeBand",
        ],
        tableRefs: REQUIRED_PRIVATE_TABLE_REFS,
      },
      configPathConfigured: false,
      localPrivateDataRead: false,
      privateValuesStored: false,
    },
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

function r1129Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1129"),
    packetId: "r1129-consumer-real-evidence-gate",
    productDisplayAuthorized: false,
    realEvidenceGate: {
      acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
      blockers: [
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
      ],
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      priorityInputFamilies: ["bloodwork_labs", "vitals_body_context", "wearable_activity"],
      targetAgeBand: "roughly_16_50",
    },
    schemaVersion: "murph-age-r1129-consumer-real-evidence-gate.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "consumer_real_evidence_gate_waiting_on_real_labs_wearables_aggregate",
      nextAction: "collect_or_run_real_outcome_linked_labs_wearables_aggregate_metrics",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1129: false,
      topPriority: "real_outcome_linked_labs_wearables_for_average_16_50_user",
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
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      priorityInputFamilies: ["bloodwork_labs", "vitals_body_context", "wearable_activity"],
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

function statusByRequirement(
  checklist: Array<{ requirementId: string; status: string }>,
): Record<string, string> {
  return Object.fromEntries(checklist.map((item) => [item.requirementId, item.status]));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
