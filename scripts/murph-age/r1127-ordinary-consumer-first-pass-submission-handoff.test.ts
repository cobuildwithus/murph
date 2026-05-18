import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1127_ORDINARY_CONSUMER_FIRST_PASS_SUBMISSION_HANDOFF_SCHEMA_VERSION,
  runR1127OrdinaryConsumerFirstPassSubmissionHandoff,
} from "./r1127-ordinary-consumer-first-pass-submission-handoff.ts";

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

describe("R1127 ordinary consumer first-pass submission handoff", () => {
  it("emits a safe fillable handoff plan for ordinary labs and wearable activity", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1127-ready-"));
    try {
      const paths = await writeInputs(tmp);

      const { output, outputPath, submissionPlanPath } = await runR1127OrdinaryConsumerFirstPassSubmissionHandoff({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1127-ordinary-consumer-first-pass-submission-handoff.latest.json");
      expect(path.basename(submissionPlanPath ?? "")).toBe("r1127-fillable-ordinary-consumer-first-pass-submission-plan.json");
      expect(output.schemaVersion).toBe(R1127_ORDINARY_CONSUMER_FIRST_PASS_SUBMISSION_HANDOFF_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_first_pass_submission_handoff_ready",
        nextAction: "fill_private_config_with_ordinary_labs_wearable_refs_then_run_r1125",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1127: false,
        submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.ordinarySubmissionHandoff).toMatchObject({
        acceptedInputProfile: "consumer_bloodwork_labs_wearables_16_50_first",
        firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
        minimumEvidenceFloor: {
          eventCount: "10_plus",
          usableRecordCount: "50_plus",
        },
        privateConfigTemplateArtifact: "r1121-fillable-local-private-consumer-receipt-runner-config.json",
        privateValuesStored: false,
        ordinaryTableLayouts: ORDINARY_TABLE_LAYOUTS,
        requiredPrivateFieldRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
        requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
      });
      expect(output.ordinarySubmissionHandoff.commands.configIntakeCommand).toContain(
        "r1122-local-private-consumer-receipt-runner-config-intake.ts",
      );
      expect(output.ordinarySubmissionHandoff.commands.executionCommand).toContain(
        "r1125-local-private-first-pass-aggregate-metric-runner.ts",
      );
      expect(output.ordinarySubmissionHandoff.semanticFieldFamilies.map((field) => field.familyId)).toEqual(
        REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
      );
      expect(output.ordinarySubmissionHandoff.ordinarySourceFamilies.map((family) => family.familyId)).toEqual(
        ORDINARY_SOURCE_FAMILY_IDS,
      );
      expect(output.ordinarySubmissionHandoff.ordinarySourceFamilies).toContainEqual(expect.objectContaining({
        acceptableForAverageUser: true,
        familyId: "bloodwork_glycemia",
        inputKind: "bloodwork_table_or_lab_portal_export",
        privateDetailsStored: false,
        requiredPrivateFieldRefFamilies: ["labGlycemia"],
        requiredPrivateTableRefs: ["labTableRef"],
        role: "bloodwork_glycemia_signal",
      }));
      expect(output.ordinarySubmissionHandoff.ordinarySourceFamilies).toContainEqual(expect.objectContaining({
        acceptableForAverageUser: true,
        familyId: "wearable_activity_daily",
        inputKind: "daily_wearable_activity_export_or_spreadsheet",
        privateDetailsStored: false,
        requiredPrivateFieldRefFamilies: ["wearableActivity"],
        requiredPrivateTableRefs: ["wearableTableRef"],
        role: "wearable_activity_signal",
      }));
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const plan = JSON.parse(await readFile(submissionPlanPath ?? "", "utf8")) as {
        candidateRunOrder: string[];
        ordinarySourceFamilies: Array<{
          acceptableForAverageUser: boolean;
          familyId: string;
          privateDetailsStored: boolean;
        }>;
        ordinaryTableLayouts: string[];
        privateConfigSkeleton: {
          privateFieldRefs: Record<string, string>;
          privateTableRefs: Record<string, string>;
          schemaVersion: string;
          submissionContext: {
            evidenceRole: string;
            targetAgeBand: string;
          };
        };
        requiredPrivateFieldRefFamilies: string[];
        requiredPrivateTableRefs: string[];
        schemaVersion: string;
      };
      expect(plan.schemaVersion).toBe("murph-age-r1127-fillable-ordinary-consumer-first-pass-submission-plan.v1");
      expect(plan.candidateRunOrder).toEqual(FIRST_PASS_CANDIDATE_IDS);
      expect(plan.ordinarySourceFamilies.map((family) => family.familyId)).toEqual(ORDINARY_SOURCE_FAMILY_IDS);
      expect(plan.ordinarySourceFamilies.every((family) =>
        family.acceptableForAverageUser === true && family.privateDetailsStored === false
      )).toBe(true);
      expect(plan.ordinaryTableLayouts).toEqual(ORDINARY_TABLE_LAYOUTS);
      expect(plan.requiredPrivateFieldRefFamilies).toEqual(REQUIRED_PRIVATE_FIELD_REF_FAMILIES);
      expect(plan.requiredPrivateTableRefs).toEqual(REQUIRED_PRIVATE_TABLE_REFS);
      expect(plan.privateConfigSkeleton.schemaVersion).toBe("murph-age-local-private-consumer-receipt-runner-config.v1");
      expect(plan.privateConfigSkeleton.submissionContext).toMatchObject({
        evidenceRole: "real_first_pass_evidence",
        targetAgeBand: "roughly_16_50",
      });
      expect(Object.values(plan.privateConfigSkeleton.privateFieldRefs).every((value) => value === "")).toBe(true);
      expect(Object.values(plan.privateConfigSkeleton.privateTableRefs).every((value) => value === "")).toBe(true);
      expect(JSON.stringify(plan)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(plan)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the active consumer loop is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1127-stale-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1101Path, {
        artifactBoundary: safeBoundary(),
        packetId: "r1101-consumer-labs-wearables-loop-executor",
        schemaVersion: "stale",
      });

      const { output, submissionPlanPath } = await runR1127OrdinaryConsumerFirstPassSubmissionHandoff({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(submissionPlanPath).toBeNull();
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_first_pass_submission_handoff_waiting_on_loop_or_contract",
        nextAction: "refresh_r1101_r1121_r1125_before_submission_handoff",
        reviewGptRequiredNow: false,
        submissionPlanArtifact: null,
      });
      expect(output.inputArtifacts.r1101).toMatchObject({
        packetId: "r1101-consumer-labs-wearables-loop-executor",
        schemaVersion: null,
        status: "available",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1127-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1125Path, {
        ...r1125Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR1127OrdinaryConsumerFirstPassSubmissionHandoff({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1127 rejected unsafe r1125 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1127-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1127-ordinary-consumer-first-pass-submission-handoff.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1101_CONSUMER_LOOP_EXECUTOR_PATH: paths.r1101Path,
          MURPH_AGE_R1121_LOCAL_PRIVATE_RUNNER_CONTRACT_PATH: paths.r1121Path,
          MURPH_AGE_R1125_LOCAL_PRIVATE_FIRST_PASS_RUNNER_PATH: paths.r1125Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        productDisplayAuthorized: boolean;
        ordinarySourceFamilyIds: string[];
        ordinaryTableLayouts: string[];
        requiredPrivateFieldRefFamilies: string[];
        requiredPrivateTableRefs: string[];
        reviewGptRequiredNow: boolean;
        rowParsingPerformedByR1127: boolean;
        submissionPlanArtifact: string | null;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_consumer_first_pass_submission_handoff_ready",
        ordinarySourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        ordinaryTableLayouts: ORDINARY_TABLE_LAYOUTS,
        productDisplayAuthorized: false,
        requiredPrivateFieldRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
        requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1127: false,
        submissionPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string): Promise<{
  r1101Path: string;
  r1121Path: string;
  r1125Path: string;
}> {
  const paths = {
    r1101Path: path.join(tmp, "r1101.json"),
    r1121Path: path.join(tmp, "r1121.json"),
    r1125Path: path.join(tmp, "r1125.json"),
  };
  await Promise.all([
    writeJson(paths.r1101Path, r1101Fixture()),
    writeJson(paths.r1121Path, r1121Fixture()),
    writeJson(paths.r1125Path, r1125Fixture()),
  ]);
  return paths;
}

function r1101Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1101-consumer-labs-wearables-loop-executor",
    schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
    summary: {
      conclusion: "consumer_loop_ready_awaiting_aggregate_receipt",
      firstPassAggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
      firstWearableCandidate: "W1_activity_steps_minutes",
      localPrivateFirstPassRunnerConclusion: "local_private_first_pass_runner_missing_config",
      missingFirstPassMetricCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      nextAction: "provide_r1125_private_runner_config_or_fill_r1124_template",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1101: false,
    },
  };
}

function r1121Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    localPrivateRunner: {
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      localPrivateFirstPassRunnerCommand:
        "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts",
      privateConfigTemplateArtifact: "r1121-fillable-local-private-consumer-receipt-runner-config.json",
    },
    packetId: "r1121-local-private-consumer-receipt-runner-contract",
    schemaVersion: "murph-age-r1121-local-private-consumer-receipt-runner-contract.v1",
    summary: {
      conclusion: "local_private_consumer_receipt_runner_contract_ready_awaiting_mapping",
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      nextAction: "fill_private_mapping_and_runner_config_for_l1_l2_w1",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1121: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      topCandidate: "L1_tiny_glycemia_only",
    },
  };
}

function r1125Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1125-local-private-first-pass-aggregate-metric-runner",
    privateExecution: {
      aggregateMetricsArtifact: null,
      configPathConfigured: false,
      firstPassCandidateIds: FIRST_PASS_CANDIDATE_IDS,
      privateConfigChecklist: {
        configIntakeCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts",
        executionCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts",
        minimumEventCount: "10_plus",
        minimumUsableRecordCount: "50_plus",
        privateConfigTemplateArtifact: "r1121-fillable-local-private-consumer-receipt-runner-config.json",
        requiredPrivateFieldRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
        requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
      },
      privateValuesStored: false,
    },
    schemaVersion: "murph-age-r1125-local-private-first-pass-aggregate-metric-runner.v1",
    summary: {
      conclusion: "local_private_first_pass_runner_missing_config",
      nextAction: "provide_private_runner_config",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowValuesStored: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      topPriority: "l1_l2_w1_qc_first_pass",
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
