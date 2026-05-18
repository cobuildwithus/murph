import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1125_LOCAL_PRIVATE_FIRST_PASS_AGGREGATE_METRIC_RUNNER_SCHEMA_VERSION,
  runR1125LocalPrivateFirstPassAggregateMetricRunner,
} from "./r1125-local-private-first-pass-aggregate-metric-runner.ts";

const PRIVATE_CONFIG_TEMPLATE_ARTIFACT = "r1121-fillable-local-private-consumer-receipt-runner-config.json";
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
const ACCEPTED_PRIVATE_TABLE_LAYOUTS = ["single_primary_table_fallback", "multi_table_or_explicit_refs"];
const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
];

describe("R1125 local private first-pass aggregate metric runner", () => {
  it("surfaces the private config checklist when no config is provided", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1125-missing-config-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      await writeJson(r1132Path, r1132Fixture());
      const { aggregateMetricsPath, output } = await runR1125LocalPrivateFirstPassAggregateMetricRunner({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(aggregateMetricsPath).toBeNull();
      expect(output.summary).toMatchObject({
        conclusion: "local_private_first_pass_runner_missing_config",
        nextAction: "provide_private_runner_config",
        reviewGptRequiredNow: false,
      });
      expect(output.privateExecution).toMatchObject({
        aggregateMetricsArtifact: null,
        configPathConfigured: false,
        localPrivateDataRead: false,
        ordinarySubmitterReadiness: {
          artifact: "r1132-ordinary-consumer-submission-readiness.latest.json",
          averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
          conclusion: "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
          missingSlotCount: 20,
          missingSlotTypes: [
            "first_pass_candidate",
            "semantic_ref_family",
            "submission_context_field",
            "table_ref",
          ],
          nextAction: "fill_average_submitter_private_config_slots",
          readyForPrivateRunner: false,
          realAggregateStillMissing: true,
        },
        privateValuesStored: false,
      });
      expect(output.privateExecution.privateConfigChecklist).toMatchObject({
        acceptedPrivateTableLayouts: ACCEPTED_PRIVATE_TABLE_LAYOUTS,
        minimumEventCount: "10_plus",
        minimumUsableRecordCount: "50_plus",
        privateConfigTemplateArtifact: PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
        requiredPrivateFieldRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
        requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
        singlePrimaryTableFallbackAccepted: true,
      });
      expect(output.privateExecution.privateConfigChecklist.configIntakeCommand).toContain(
        "r1122-local-private-consumer-receipt-runner-config-intake.ts",
      );
      expect(output.privateExecution.privateConfigChecklist.executionCommand).toContain(
        "r1125-local-private-first-pass-aggregate-metric-runner.ts",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("turns private lab and wearable rows into R1124 aggregate metrics without storing private refs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1125-ready-"));
    try {
      const paths = await writePrivateRunFixtures(tmp, { readyConfigIntake: true, rowCount: 240 });

      const { aggregateMetricsPath, output, outputPath } = await runR1125LocalPrivateFirstPassAggregateMetricRunner({
        configPath: paths.configPath,
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1113Path: paths.r1113Path,
        r1121Path: paths.r1121Path,
        r1122Path: paths.r1122Path,
        r1132Path: paths.r1132Path,
      });

      expect(path.basename(outputPath)).toBe("r1125-local-private-first-pass-aggregate-metric-runner.latest.json");
      expect(path.basename(aggregateMetricsPath ?? "")).toBe("r1125-consumer-first-pass-aggregate-metrics.json");
      expect(output.schemaVersion).toBe(R1125_LOCAL_PRIVATE_FIRST_PASS_AGGREGATE_METRIC_RUNNER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        productDisplayAuthorized: false,
        rowValuesStored: false,
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        topPriority: "l1_l2_w1_qc_first_pass",
      });
      expect([
        "local_private_first_pass_runner_ready_for_reviewgpt_delta",
        "local_private_first_pass_runner_valid_no_delta",
      ]).toContain(output.summary.conclusion);
      expect(output.privateExecution).toMatchObject({
        aggregateMetricsArtifact: "r1125-consumer-first-pass-aggregate-metrics.json",
        aggregateMetricsCandidateCountBand: "1-9",
        configPathConfigured: true,
        eventCountBand: "100_plus",
        localPrivateDataRead: true,
        ordinaryTableLayout: "multi_table_or_explicit_refs",
        privateConfigChecklist: {
          acceptedPrivateTableLayouts: ACCEPTED_PRIVATE_TABLE_LAYOUTS,
          privateConfigTemplateArtifact: PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
          requiredPrivateFieldRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
          requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
        },
        privateValuesStored: false,
        usableRecordCountBand: "100_plus",
      });
      expect(output.privateExecution.r1124Conclusion).toMatch(/^consumer_first_pass_aggregate_receipt_/u);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("src_person_id");
      expect(JSON.stringify(output)).not.toContain("src_glucose");
      expect(JSON.stringify(output)).not.toContain("private-person-");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const aggregateMetrics = JSON.parse(await readFile(aggregateMetricsPath ?? "", "utf8")) as {
        candidateResults: Array<{ candidateId: string }>;
        schemaVersion: string;
      };
      expect(aggregateMetrics.schemaVersion).toBe("murph-age-consumer-first-pass-aggregate-metrics.v1");
      expect(aggregateMetrics.candidateResults.map((candidate) => candidate.candidateId)).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ]);
      expect(findForbiddenAggregateEgress(aggregateMetrics)).toEqual([]);
      expect(JSON.stringify(aggregateMetrics)).not.toContain("src_");
      expect(JSON.stringify(aggregateMetrics)).not.toContain("private-person-");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("runs a single combined ordinary private table through the same aggregate path", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1125-single-table-ready-"));
    try {
      const paths = await writePrivateRunFixtures(tmp, {
        readyConfigIntake: true,
        rowCount: 240,
        singleTable: true,
      });

      const { aggregateMetricsPath, output } = await runR1125LocalPrivateFirstPassAggregateMetricRunner({
        configPath: paths.configPath,
        outputDir: path.join(tmp, "out"),
        r1113Path: paths.r1113Path,
        r1121Path: paths.r1121Path,
        r1122Path: paths.r1122Path,
        r1132Path: paths.r1132Path,
      });

      expect(path.basename(aggregateMetricsPath ?? "")).toBe("r1125-consumer-first-pass-aggregate-metrics.json");
      expect([
        "local_private_first_pass_runner_ready_for_reviewgpt_delta",
        "local_private_first_pass_runner_valid_no_delta",
      ]).toContain(output.summary.conclusion);
      expect(output.privateExecution).toMatchObject({
        aggregateMetricsArtifact: "r1125-consumer-first-pass-aggregate-metrics.json",
        localPrivateDataRead: true,
        ordinaryTableLayout: "single_primary_table_fallback",
        privateValuesStored: false,
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("src_person_id");
      expect(JSON.stringify(output)).not.toContain("private-person-");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when R1122 has not marked the private config ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1125-waiting-"));
    try {
      const paths = await writePrivateRunFixtures(tmp, { readyConfigIntake: false, rowCount: 240 });

      const { aggregateMetricsPath, output } = await runR1125LocalPrivateFirstPassAggregateMetricRunner({
        configPath: paths.configPath,
        outputDir: path.join(tmp, "out"),
        r1113Path: paths.r1113Path,
        r1121Path: paths.r1121Path,
        r1122Path: paths.r1122Path,
        r1132Path: paths.r1132Path,
      });

      expect(aggregateMetricsPath).toBeNull();
      expect(output.summary).toMatchObject({
        conclusion: "local_private_first_pass_runner_waiting_on_config_intake",
        nextAction: "refresh_r1122_config_intake",
        reviewGptRequiredNow: false,
      });
      expect(output.privateExecution.localPrivateDataRead).toBe(false);
      expect(output.privateExecution.configIntakeConclusion).toBe("local_private_runner_config_incomplete");
      expect(output.privateExecution.configIntakeMissingPieces).toEqual({
        firstPassCandidateIds: ["QC_missingness_coverage"],
        semanticRefFamilies: ["wearableActivity"],
        submissionContextFields: ["priorityInputFamilies"],
        tableRefs: ["wearableTableRef"],
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds without metrics when the private rows are under the minimum evidence floor", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1125-small-"));
    try {
      const paths = await writePrivateRunFixtures(tmp, { readyConfigIntake: true, rowCount: 24 });

      const { aggregateMetricsPath, output } = await runR1125LocalPrivateFirstPassAggregateMetricRunner({
        configPath: paths.configPath,
        outputDir: path.join(tmp, "out"),
        r1113Path: paths.r1113Path,
        r1121Path: paths.r1121Path,
        r1122Path: paths.r1122Path,
        r1132Path: paths.r1132Path,
      });

      expect(aggregateMetricsPath).toBeNull();
      expect(output.summary).toMatchObject({
        conclusion: "local_private_first_pass_runner_not_enough_usable_data",
        nextAction: "use_larger_or_better_covered_private_dataset",
      });
      expect(output.privateExecution).toMatchObject({
        aggregateMetricsArtifact: null,
        eventCountBand: "below_minimum",
        localPrivateDataRead: true,
        usableRecordCountBand: "below_minimum",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe config-intake artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1125-unsafe-"));
    try {
      const paths = await writePrivateRunFixtures(tmp, { readyConfigIntake: true, rowCount: 240 });
      await writeJson(paths.r1122Path, {
        artifactBoundary: {
          aggregateOnly: true,
          rowValuesStored: true,
        },
        packetId: "r1122-local-private-consumer-receipt-runner-config-intake",
        schemaVersion: "murph-age-r1122-local-private-consumer-receipt-runner-config-intake.v1",
      });

      await expect(runR1125LocalPrivateFirstPassAggregateMetricRunner({
        configPath: paths.configPath,
        outputDir: path.join(tmp, "out"),
        r1122Path: paths.r1122Path,
        r1132Path: paths.r1132Path,
      })).rejects.toThrow("R1125 rejected unsafe r1122 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1125-cli-"));
    try {
      const paths = await writePrivateRunFixtures(tmp, { readyConfigIntake: true, rowCount: 240 });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH: paths.configPath,
          MURPH_AGE_R1113_CONSUMER_SOURCE_EXECUTION_PACKET_PATH: paths.r1113Path,
          MURPH_AGE_R1121_LOCAL_PRIVATE_RUNNER_CONTRACT_PATH: paths.r1121Path,
          MURPH_AGE_R1122_LOCAL_PRIVATE_CONFIG_INTAKE_PATH: paths.r1122Path,
          MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH: paths.r1132Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        acceptedPrivateTableLayouts: string[];
        aggregateMetricsArtifact: string | null;
        localPrivateDataRead: boolean;
        ordinaryTableLayout: string | null;
        packetId: string;
        configIntakeMissingPieces: {
          firstPassCandidateIds: string[];
          semanticRefFamilies: string[];
          submissionContextFields: string[];
          tableRefs: string[];
        };
        ordinarySubmitterReadiness: {
          averageSubmitterFamilyIds: string[];
          missingSlotCount: number | null;
          nextAction: string | null;
          readyForPrivateRunner: boolean | null;
        };
        privateConfigTemplateArtifact: string;
        requiredPrivateFieldRefFamilies: string[];
        requiredPrivateTableRefs: string[];
        rowValuesStored: boolean;
        usableRecordCountBand: string;
      };
      expect(summary).toMatchObject({
        acceptedPrivateTableLayouts: ACCEPTED_PRIVATE_TABLE_LAYOUTS,
        aggregateMetricsArtifact: "r1125-consumer-first-pass-aggregate-metrics.json",
        configIntakeMissingPieces: {
          firstPassCandidateIds: [],
          semanticRefFamilies: [],
          submissionContextFields: [],
          tableRefs: [],
        },
        localPrivateDataRead: true,
        ordinarySubmitterReadiness: {
          averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
          missingSlotCount: 20,
          nextAction: "fill_average_submitter_private_config_slots",
          readyForPrivateRunner: false,
        },
        ordinaryTableLayout: "multi_table_or_explicit_refs",
        packetId: "r1125-local-private-first-pass-aggregate-metric-runner",
        privateConfigTemplateArtifact: PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
        requiredPrivateFieldRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
        requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
        rowValuesStored: false,
        usableRecordCountBand: "100_plus",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("src_person_id");
      expect(stdout).not.toContain("private-person-");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writePrivateRunFixtures(
  tmp: string,
  options: { readyConfigIntake: boolean; rowCount: number; singleTable?: boolean },
): Promise<{
  configPath: string;
  r1113Path: string;
  r1121Path: string;
  r1122Path: string;
  r1132Path: string;
}> {
  const paths = {
    combinedPath: path.join(tmp, "private-combined.csv"),
    configPath: path.join(tmp, "private-config.json"),
    labPath: path.join(tmp, "private-lab.csv"),
    outcomePath: path.join(tmp, "private-outcome.csv"),
    r1113Path: path.join(tmp, "r1113.json"),
    r1121Path: path.join(tmp, "r1121.json"),
    r1122Path: path.join(tmp, "r1122.json"),
    r1132Path: path.join(tmp, "r1132.json"),
    wearablePath: path.join(tmp, "private-wearable.csv"),
  };
  await Promise.all([
    writeJson(paths.r1113Path, r1113Fixture()),
    writeJson(paths.r1121Path, r1121Fixture()),
    writeJson(paths.r1122Path, r1122Fixture(options.readyConfigIntake)),
    writeJson(paths.r1132Path, r1132Fixture()),
    writeJson(paths.configPath, privateConfigFixture(paths, { singleTable: options.singleTable === true })),
    writePrivateTables(paths, options.rowCount, { singleTable: options.singleTable === true }),
  ]);
  return {
    configPath: paths.configPath,
    r1113Path: paths.r1113Path,
    r1121Path: paths.r1121Path,
    r1122Path: paths.r1122Path,
    r1132Path: paths.r1132Path,
  };
}

async function writePrivateTables(
  paths: { combinedPath: string; labPath: string; outcomePath: string; wearablePath: string },
  rowCount: number,
  options: { singleTable: boolean },
): Promise<void> {
  await mkdir(path.dirname(paths.labPath), { recursive: true });
  const labRows = [[
    "src_person_id",
    "src_glucose",
    "src_hba1c",
    "src_triglycerides",
    "src_sbp",
    "src_bmi",
  ].join(",")];
  const wearableRows = [["src_person_id", "src_steps", "src_active_minutes"].join(",")];
  const outcomeRows = [["src_person_id", "src_event"].join(",")];
  const combinedRows = [[
    "src_person_id",
    "src_event",
    "src_glucose",
    "src_hba1c",
    "src_triglycerides",
    "src_sbp",
    "src_bmi",
    "src_steps",
    "src_active_minutes",
  ].join(",")];
  for (let index = 0; index < rowCount; index += 1) {
    const event = index < Math.ceil(rowCount * 0.52) ? 1 : 0;
    const personId = `private-person-${index}`;
    const jitter = (index % 7) * 0.03;
    labRows.push([
      personId,
      (event ? 142 + jitter : 88 + jitter).toFixed(2),
      (event ? 6.7 + jitter : 5.1 + jitter).toFixed(2),
      (event ? 210 + jitter : 115 + jitter).toFixed(2),
      (event ? 138 + jitter : 112 + jitter).toFixed(2),
      (event ? 31 + jitter : 23 + jitter).toFixed(2),
    ].join(","));
    wearableRows.push([
      personId,
      (event ? 3200 - jitter : 8600 + jitter).toFixed(2),
      (event ? 22 - jitter : 68 + jitter).toFixed(2),
    ].join(","));
    outcomeRows.push([personId, String(event)].join(","));
    combinedRows.push([
      personId,
      String(event),
      (event ? 142 + jitter : 88 + jitter).toFixed(2),
      (event ? 6.7 + jitter : 5.1 + jitter).toFixed(2),
      (event ? 210 + jitter : 115 + jitter).toFixed(2),
      (event ? 138 + jitter : 112 + jitter).toFixed(2),
      (event ? 31 + jitter : 23 + jitter).toFixed(2),
      (event ? 3200 - jitter : 8600 + jitter).toFixed(2),
      (event ? 22 - jitter : 68 + jitter).toFixed(2),
    ].join(","));
  }
  if (options.singleTable) {
    await writeFile(paths.combinedPath, `${combinedRows.join("\n")}\n`);
    return;
  }
  await Promise.all([
    writeFile(paths.labPath, `${labRows.join("\n")}\n`),
    writeFile(paths.wearablePath, `${wearableRows.join("\n")}\n`),
    writeFile(paths.outcomePath, `${outcomeRows.join("\n")}\n`),
  ]);
}

function privateConfigFixture(paths: {
  combinedPath: string;
  labPath: string;
  outcomePath: string;
  wearablePath: string;
}, options: { singleTable: boolean }): Record<string, unknown> {
  return {
    aggregateReceiptTarget: {
      evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
      schemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1",
    },
    attestations: {
      localOnly: true,
      noCoefficientEgress: true,
      noHeaderNameEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      noSourceTextEgress: true,
    },
    candidateRunOrder: [
      { candidateId: "L1_tiny_glycemia_only" },
      { candidateId: "L2_common_lab_core_shadow" },
      { candidateId: "W1_activity_steps_minutes" },
      { candidateId: "QC_missingness_coverage" },
    ],
    privateFieldRefs: {
      commonLabCore: "src_triglycerides",
      dateOrTimeKey: "src_date",
      labGlycemia: "src_glucose|src_hba1c",
      outcomeEvent: "src_event",
      personJoinKey: "src_person_id",
      vitalsBody: "src_sbp|src_bmi",
      wearableActivity: "src_steps|src_active_minutes",
    },
    privateTableRefs: options.singleTable
      ? {
        labTableRef: "",
        outcomeTableRef: "",
        primaryTableRef: paths.combinedPath,
        wearableTableRef: "",
      }
      : {
        labTableRef: paths.labPath,
        outcomeTableRef: paths.outcomePath,
        primaryTableRef: paths.outcomePath,
        wearableTableRef: paths.wearablePath,
      },
    schemaVersion: "murph-age-local-private-consumer-receipt-runner-config.v1",
    submissionContext: {
      evidenceRole: "real_first_pass_evidence",
      ordinaryConsumerSubmission: true,
      outcomeLinked: true,
      priorityInputFamilies: [
        "bloodwork_labs",
        "vitals_body_context",
        "wearable_activity",
      ],
      targetAgeBand: "roughly_16_50",
    },
  };
}

function r1113Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
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
      rowParsingPerformedByR1113: false,
    },
  };
}

function r1121Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1121-local-private-consumer-receipt-runner-contract",
    schemaVersion: "murph-age-r1121-local-private-consumer-receipt-runner-contract.v1",
    summary: {
      conclusion: "local_private_consumer_receipt_runner_contract_ready_for_execution",
      firstPassCandidateIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ],
      productDisplayAuthorized: false,
      rowParsingPerformedByR1121: false,
    },
  };
}

function r1122Fixture(ready: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    configIntake: {
      missingFirstPassCandidateIds: ready ? [] : ["QC_missingness_coverage"],
      missingSemanticRefFamilies: ready ? [] : ["wearableActivity"],
      missingSubmissionContextFields: ready ? [] : ["priorityInputFamilies"],
      missingTableRefs: ready ? [] : ["wearableTableRef"],
    },
    packetId: "r1122-local-private-consumer-receipt-runner-config-intake",
    schemaVersion: "murph-age-r1122-local-private-consumer-receipt-runner-config-intake.v1",
    summary: {
      conclusion: ready
        ? "local_private_runner_config_ready_for_local_aggregate_receipt"
        : "local_private_runner_config_incomplete",
      firstPassCandidateIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ],
      productDisplayAuthorized: false,
      rowParsingPerformedByR1122: false,
    },
  };
}

function r1132Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1132-ordinary-consumer-submission-readiness",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1132-ordinary-consumer-submission-readiness.v1",
    status: "research-local-aggregate-only",
    summary: {
      averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      conclusion: "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
      missingSlotCount: 20,
      missingSlotTypes: [
        "first_pass_candidate",
        "semantic_ref_family",
        "submission_context_field",
        "table_ref",
      ],
      nextAction: "fill_average_submitter_private_config_slots",
      productDisplayAuthorized: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1132: false,
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
