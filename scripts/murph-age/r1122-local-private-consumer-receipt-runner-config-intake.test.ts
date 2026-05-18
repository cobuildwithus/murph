import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1122_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_INTAKE_SCHEMA_VERSION,
  runR1122LocalPrivateConsumerReceiptRunnerConfigIntake,
} from "./r1122-local-private-consumer-receipt-runner-config-intake.ts";

const R1125_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts";
const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
];
const MISSING_SLOT_TYPES = [
  "first_pass_candidate",
  "semantic_ref_family",
  "submission_context_field",
  "table_ref",
];

describe("R1122 local private consumer receipt runner config intake", () => {
  it("waits for a private runner config without storing private refs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1122-missing-"));
    try {
      const r1121Path = path.join(tmp, "r1121.json");
      await writeJson(r1121Path, r1121Fixture("local_private_consumer_receipt_runner_contract_ready_awaiting_mapping"));

      const { output } = await runR1122LocalPrivateConsumerReceiptRunnerConfigIntake({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1121Path,
      });

      expect(output.schemaVersion).toBe(R1122_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_INTAKE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "local_private_runner_config_not_provided",
        nextAction: "fill_private_runner_config_before_local_receipt",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1122: false,
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        topCandidate: "L1_tiny_glycemia_only",
      });
      expect(output.configIntake).toMatchObject({
        configPathConfigured: false,
        firstPassCandidateStatus: "not_provided",
        missingFirstPassCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        missingSemanticRefFamilies: [
          "personJoinKey",
          "dateOrTimeKey",
          "outcomeEvent",
          "labGlycemia",
          "commonLabCore",
          "vitalsBody",
          "wearableActivity",
        ],
        missingSubmissionContextFields: [
          "evidenceRole",
          "ordinaryConsumerSubmission",
          "outcomeLinked",
          "priorityInputFamilies",
          "targetAgeBand",
        ],
        missingTableRefs: [
          "primaryTableRef",
          "outcomeTableRef",
          "labTableRef",
          "wearableTableRef",
        ],
        privateConfigStatus: "missing",
        r1125LocalPrivateFirstPassRunnerCommand: R1125_COMMAND,
        privateConfigValuesStored: false,
        semanticRefCountBand: "0",
        submissionContextStatus: "not_provided",
      });
      expect(output.configIntake.ordinarySubmitterGuidance).toMatchObject({
        acceptedTableLayouts: [
          "single_primary_table_fallback",
          "multi_table_or_explicit_refs",
        ],
        averageSubmitterAgeBand: "roughly_16_50",
        averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        minimumEvidenceFloor: {
          eventCount: "10_plus",
          usableRecordCount: "50_plus",
        },
        missingSlotCount: 20,
        missingSlotTypes: MISSING_SLOT_TYPES,
        privateDetailsStored: false,
        readyForR1125: false,
        realAggregateStillMissing: true,
        submissionContext: {
          missingFields: [
            "evidenceRole",
            "ordinaryConsumerSubmission",
            "outcomeLinked",
            "priorityInputFamilies",
            "targetAgeBand",
          ],
          requiredFields: [
            "evidenceRole",
            "ordinaryConsumerSubmission",
            "outcomeLinked",
            "priorityInputFamilies",
            "targetAgeBand",
          ],
          status: "not_provided",
        },
      });
      expect(output.configIntake.ordinarySubmitterGuidance.sourceFamilies).toContainEqual(expect.objectContaining({
        acceptableForAverageUser: true,
        familyId: "bloodwork_glycemia",
        inputKind: "bloodwork_table_or_lab_portal_export",
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
      }));
      expect(output.configIntake.ordinarySubmitterGuidance.sourceFamilies).toContainEqual(expect.objectContaining({
        acceptableForAverageUser: true,
        familyId: "wearable_activity_daily",
        inputKind: "daily_wearable_activity_export_or_spreadsheet",
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
      }));
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks a complete private config ready for a local aggregate receipt", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1122-ready-"));
    try {
      const r1121Path = path.join(tmp, "r1121.json");
      const configPath = path.join(tmp, "private-config.json");
      await Promise.all([
        writeJson(r1121Path, r1121Fixture("local_private_consumer_receipt_runner_contract_ready_for_execution")),
        writeJson(configPath, privateConfigFixture({
          labReady: true,
          wearableReady: true,
        })),
      ]);

      const { output } = await runR1122LocalPrivateConsumerReceiptRunnerConfigIntake({
        configPath,
        outputDir: path.join(tmp, "out"),
        r1121Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_runner_config_ready_for_local_aggregate_receipt",
        nextAction: "run_r1125_local_private_first_pass_runner_then_r1124",
        reviewGptRequiredNow: false,
      });
      expect(output.configIntake).toMatchObject({
        aggregateReceiptTargetStatus: "complete",
        attestationStatus: "complete",
        configPathConfigured: true,
        firstPassCandidateStatus: "complete",
        missingFirstPassCandidateIds: [],
        missingSemanticRefFamilies: [],
        missingSubmissionContextFields: [],
        missingTableRefs: [],
        ordinaryTableLayout: "multi_table_or_explicit_refs",
        privateConfigValuesStored: false,
        requiredTableRefsStatus: "complete",
        semanticRefCountBand: "2-9",
        submissionContextStatus: "complete_real_evidence",
      });
      expect(output.configIntake.semanticRefCoverage).toMatchObject({
        commonLabCore: true,
        labGlycemia: true,
        outcomeEvent: true,
        personJoinKey: true,
        vitalsBody: true,
        wearableActivity: true,
      });
      expect(output.configIntake.ordinarySubmitterGuidance).toMatchObject({
        averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        missingSlotCount: 0,
        missingSlotTypes: [],
        readyForR1125: true,
        realAggregateStillMissing: true,
      });
      expect(output.configIntake.ordinarySubmitterGuidance.sourceFamilies.every((family) =>
        family.status === "ready_for_private_runner" && family.missingSlotIds.length === 0
      )).toBe(true);
      expect(JSON.stringify(output)).not.toContain("private_marker_");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks a single primary-table ordinary config ready for local aggregate execution", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1122-single-table-ready-"));
    try {
      const r1121Path = path.join(tmp, "r1121.json");
      const configPath = path.join(tmp, "private-config.json");
      await Promise.all([
        writeJson(r1121Path, r1121Fixture("local_private_consumer_receipt_runner_contract_ready_for_execution")),
        writeJson(configPath, privateConfigFixture({
          labReady: true,
          singlePrimaryTable: true,
          wearableReady: true,
        })),
      ]);

      const { output } = await runR1122LocalPrivateConsumerReceiptRunnerConfigIntake({
        configPath,
        outputDir: path.join(tmp, "out"),
        r1121Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_runner_config_ready_for_local_aggregate_receipt",
        nextAction: "run_r1125_local_private_first_pass_runner_then_r1124",
        reviewGptRequiredNow: false,
      });
      expect(output.configIntake).toMatchObject({
        ordinaryTableLayout: "single_primary_table_fallback",
        requiredTableRefsStatus: "complete",
        submissionContextStatus: "complete_real_evidence",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("allows a lab-only config but marks missing required fields incomplete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1122-incomplete-"));
    try {
      const r1121Path = path.join(tmp, "r1121.json");
      const configPath = path.join(tmp, "private-config.json");
      await Promise.all([
        writeJson(r1121Path, r1121Fixture("local_private_consumer_receipt_runner_contract_ready_awaiting_mapping")),
        writeJson(configPath, privateConfigFixture({
          labReady: false,
          wearableReady: false,
        })),
      ]);

      const { output } = await runR1122LocalPrivateConsumerReceiptRunnerConfigIntake({
        configPath,
        outputDir: path.join(tmp, "out"),
        r1121Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_runner_config_incomplete",
        nextAction: "complete_private_runner_config_for_l1_l2_w1",
      });
      expect(output.configIntake.ordinaryTableLayout).toBe("single_primary_table_fallback");
      expect(output.configIntake.missingSemanticRefFamilies).toEqual([
        "labGlycemia",
        "commonLabCore",
        "vitalsBody",
        "wearableActivity",
      ]);
      expect(output.configIntake.missingTableRefs).toEqual([]);
      expect(output.configIntake.semanticRefCoverage).toMatchObject({
        labGlycemia: false,
        outcomeEvent: true,
        personJoinKey: true,
      });
      expect(output.configIntake.firstPassCandidateStatus).toBe("complete");
      expect(output.configIntake.submissionContextStatus).toBe("complete_real_evidence");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps a config incomplete when submission context is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1122-missing-context-"));
    try {
      const r1121Path = path.join(tmp, "r1121.json");
      const configPath = path.join(tmp, "private-config.json");
      await Promise.all([
        writeJson(r1121Path, r1121Fixture("local_private_consumer_receipt_runner_contract_ready_for_execution")),
        writeJson(configPath, privateConfigFixture({
          includeSubmissionContext: false,
          labReady: true,
          wearableReady: true,
        })),
      ]);

      const { output } = await runR1122LocalPrivateConsumerReceiptRunnerConfigIntake({
        configPath,
        outputDir: path.join(tmp, "out"),
        r1121Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_runner_config_incomplete",
        nextAction: "complete_private_runner_config_for_l1_l2_w1",
      });
      expect(output.configIntake).toMatchObject({
        firstPassCandidateStatus: "complete",
        missingSubmissionContextFields: [
          "evidenceRole",
          "ordinaryConsumerSubmission",
          "outcomeLinked",
          "priorityInputFamilies",
          "targetAgeBand",
        ],
        requiredTableRefsStatus: "complete",
        submissionContextStatus: "missing_or_invalid",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps a config incomplete when the required QC first-pass candidate is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1122-missing-qc-"));
    try {
      const r1121Path = path.join(tmp, "r1121.json");
      const configPath = path.join(tmp, "private-config.json");
      await Promise.all([
        writeJson(r1121Path, r1121Fixture("local_private_consumer_receipt_runner_contract_ready_for_execution")),
        writeJson(configPath, privateConfigFixture({
          includeQc: false,
          labReady: true,
          wearableReady: true,
        })),
      ]);

      const { output } = await runR1122LocalPrivateConsumerReceiptRunnerConfigIntake({
        configPath,
        outputDir: path.join(tmp, "out"),
        r1121Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_runner_config_incomplete",
        nextAction: "complete_private_runner_config_for_l1_l2_w1",
      });
      expect(output.configIntake).toMatchObject({
        firstPassCandidateStatus: "missing_or_invalid",
        missingFirstPassCandidateIds: ["QC_missingness_coverage"],
        requiredTableRefsStatus: "complete",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the R1121 contract is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1122-stale-"));
    try {
      const r1121Path = path.join(tmp, "r1121.json");
      const configPath = path.join(tmp, "private-config.json");
      await Promise.all([
        writeJson(r1121Path, {
          artifactBoundary: safeBoundary(),
          packetId: "r1121-local-private-consumer-receipt-runner-contract",
          schemaVersion: "stale",
          summary: {
            conclusion: "local_private_consumer_receipt_runner_contract_ready_awaiting_mapping",
          },
        }),
        writeJson(configPath, privateConfigFixture({
          labReady: true,
          wearableReady: true,
        })),
      ]);

      const { output } = await runR1122LocalPrivateConsumerReceiptRunnerConfigIntake({
        configPath,
        outputDir: path.join(tmp, "out"),
        r1121Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_runner_config_waiting_on_contract",
        nextAction: "refresh_r1121_contract_before_config_intake",
      });
      expect(output.inputArtifacts.r1121.schemaVersion).toBeNull();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream contract artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1122-unsafe-"));
    try {
      const r1121Path = path.join(tmp, "r1121.json");
      await writeJson(r1121Path, {
        artifactBoundary: {
          aggregateOnly: true,
          rowValuesStored: true,
        },
        packetId: "r1121-local-private-consumer-receipt-runner-contract",
        schemaVersion: "murph-age-r1121-local-private-consumer-receipt-runner-contract.v1",
      });

      await expect(runR1122LocalPrivateConsumerReceiptRunnerConfigIntake({
        outputDir: path.join(tmp, "out"),
        r1121Path,
      })).rejects.toThrow("R1122 rejected unsafe r1121 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1122-cli-"));
    try {
      const r1121Path = path.join(tmp, "r1121.json");
      const configPath = path.join(tmp, "private-config.json");
      await Promise.all([
        writeJson(r1121Path, r1121Fixture("local_private_consumer_receipt_runner_contract_ready_for_execution")),
        writeJson(configPath, privateConfigFixture({
          labReady: true,
          wearableReady: true,
        })),
      ]);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH: configPath,
          MURPH_AGE_R1121_LOCAL_PRIVATE_RUNNER_CONTRACT_PATH: r1121Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        configPathConfigured: boolean;
        firstPassCandidateIds: string[];
        firstPassCandidateStatus: string;
        missingFirstPassCandidateIds: string[];
        missingSemanticRefFamilies: string[];
        missingSubmissionContextFields: string[];
        missingTableRefs: string[];
        nextAction: string;
        ordinarySubmitterGuidance: {
          averageSubmitterFamilyIds: string[];
          missingSlotCount: number;
          missingSlotTypes: string[];
          readyForR1125: boolean;
          sourceFamilies: Array<{
            familyId: string;
            missingSlotIds: string[];
            status: string;
          }>;
        };
        ordinaryTableLayout: string;
        r1125LocalPrivateFirstPassRunnerCommand: string;
        submissionContextStatus: string;
        targetInputPriority: string;
      };
      expect(summary).toMatchObject({
        conclusion: "local_private_runner_config_ready_for_local_aggregate_receipt",
        configPathConfigured: true,
        firstPassCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        firstPassCandidateStatus: "complete",
        missingFirstPassCandidateIds: [],
        missingSemanticRefFamilies: [],
        missingSubmissionContextFields: [],
        missingTableRefs: [],
        nextAction: "run_r1125_local_private_first_pass_runner_then_r1124",
        ordinarySubmitterGuidance: {
          averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
          missingSlotCount: 0,
          missingSlotTypes: [],
          readyForR1125: true,
        },
        ordinaryTableLayout: "multi_table_or_explicit_refs",
        r1125LocalPrivateFirstPassRunnerCommand: R1125_COMMAND,
        submissionContextStatus: "complete_real_evidence",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant_id");
      expect(stdout).not.toContain("private_marker_");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1121Fixture(conclusion: string): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1121-local-private-consumer-receipt-runner-contract",
    schemaVersion: "murph-age-r1121-local-private-consumer-receipt-runner-contract.v1",
    summary: {
      conclusion,
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

function privateConfigFixture(options: {
  includeQc?: boolean;
  includeSubmissionContext?: boolean;
  labReady: boolean;
  singlePrimaryTable?: boolean;
  wearableReady: boolean;
}): Record<string, unknown> {
  const candidateRunOrder = [
    { candidateId: "L1_tiny_glycemia_only" },
    { candidateId: "L2_common_lab_core_shadow" },
    { candidateId: "W1_activity_steps_minutes" },
  ];
  if (options.includeQc !== false) {
    candidateRunOrder.push({ candidateId: "QC_missingness_coverage" });
  }
  const config: Record<string, unknown> = {
    aggregateReceiptTarget: {
      evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
      schemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1",
      validationCommand:
        "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts",
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
    candidateRunOrder,
    privateFieldRefs: {
      commonLabCore: options.labReady ? "private_marker_common_labs" : "",
      dateOrTimeKey: "private_marker_date",
      labGlycemia: options.labReady ? "private_marker_glycemia" : "",
      outcomeEvent: "private_marker_outcome",
      personJoinKey: "private_marker_person",
      vitalsBody: options.labReady ? "private_marker_vitals" : "",
      wearableActivity: options.wearableReady ? "private_marker_activity" : "",
      wearableRecovery: "",
      wearableSleep: "",
    },
    privateTableRefs: options.singlePrimaryTable
      ? {
        labTableRef: "",
        outcomeTableRef: "",
        primaryTableRef: "private_marker_primary_table",
        wearableTableRef: "",
      }
      : {
        labTableRef: options.labReady ? "private_marker_lab_table" : "",
        outcomeTableRef: "private_marker_outcome_table",
        primaryTableRef: "private_marker_primary_table",
        wearableTableRef: options.wearableReady ? "private_marker_wearable_table" : "",
    },
    schemaVersion: "murph-age-local-private-consumer-receipt-runner-config.v1",
  };
  if (options.includeSubmissionContext !== false) {
    config.submissionContext = {
      evidenceRole: "real_first_pass_evidence",
      ordinaryConsumerSubmission: true,
      outcomeLinked: true,
      priorityInputFamilies: [
        "bloodwork_labs",
        "vitals_body_context",
        "wearable_activity",
      ],
      targetAgeBand: "roughly_16_50",
    };
  }
  return config;
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
