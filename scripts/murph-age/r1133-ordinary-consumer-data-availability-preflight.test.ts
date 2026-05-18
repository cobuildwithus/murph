import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_SCHEMA_VERSION,
  runR1133OrdinaryConsumerDataAvailabilityPreflight,
} from "./r1133-ordinary-consumer-data-availability-preflight.ts";

const AVAILABILITY_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1133-ordinary-consumer-data-availability-manifest.v1";
const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
];
const REQUIRED_SAFE_MANIFEST_ATTESTATIONS = [
  "aggregateOnly",
  "noCoefficientEgress",
  "noHeaderNameEgress",
  "noParticipantEgress",
  "noPredictionEgress",
  "noRowEgress",
  "noSmallCellEgress",
  "noSourceTextEgress",
];

describe("R1133 ordinary consumer data availability preflight", () => {
  it("emits a safe fillable manifest when availability is not provided", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1133-missing-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      await writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`);

      const { fillableManifestPath, output, outputPath } = await runR1133OrdinaryConsumerDataAvailabilityPreflight({
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(path.basename(outputPath)).toBe("r1133-ordinary-consumer-data-availability-preflight.latest.json");
      expect(path.basename(fillableManifestPath)).toBe(
        "r1133-fillable-ordinary-consumer-data-availability-manifest.json",
      );
      expect(output.schemaVersion).toBe(R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_data_availability_preflight_waiting_on_manifest",
        manifestStatus: "not_provided",
        missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        nextAction: "fill_safe_ordinary_data_availability_manifest",
        productDisplayAuthorized: false,
        readyForPrivateConfigMapping: false,
        readyForPrivateRunner: false,
        realAggregateStillMissing: true,
        rowParsingPerformedByR1133: false,
        safeManifestAttestationsComplete: false,
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.ordinaryDataAvailabilityPreflight.blockers).toContain(
        "ordinary_data_availability_manifest_missing",
      );
      expect(output.ordinaryDataAvailabilityPreflight.sourceFamilies).toContainEqual({
        declaredAvailable: null,
        familyId: "wearable_activity_daily",
        inputKind: "daily_wearable_activity_export_or_spreadsheet",
        missingSlotCount: 3,
        missingSlotIds: [
          "W1_activity_steps_minutes",
          "wearableActivity",
          "wearableTableRef",
        ],
        privateDetailsStored: false,
        requiredForFirstPass: true,
        status: "not_declared",
      });
      expect(output.ordinaryDataAvailabilityPreflight.safeManifestAttestations).toMatchObject({
        complete: false,
        requiredAttestationIds: REQUIRED_SAFE_MANIFEST_ATTESTATIONS,
      });

      const fillableManifest = JSON.parse(await readFile(fillableManifestPath, "utf8")) as unknown;
      expect(fillableManifest).toMatchObject({
        aggregateReadinessFacts: {
          eventCountBand: "unknown",
          outcomeLinked: false,
          sameDenominator: false,
          targetAgeBand: "roughly_16_50",
          usableRecordCountBand: "unknown",
        },
        schemaVersion: AVAILABILITY_MANIFEST_SCHEMA_VERSION,
        selectedTableLayout: "",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(fillableManifest)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(fillableManifest)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks complete safe availability as ready for private config mapping", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1133-ready-mapping-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      await Promise.all([
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
        writeFile(manifestPath, `${JSON.stringify(completeAvailabilityManifest())}\n`),
      ]);

      const { output } = await runR1133OrdinaryConsumerDataAvailabilityPreflight({
        availabilityManifestPath: manifestPath,
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_data_availability_preflight_ready_for_private_config_mapping",
        manifestStatus: "provided",
        missingSourceFamilyIds: [],
        nextAction: "complete_private_config_for_available_labs_wearables",
        readyForPrivateConfigMapping: true,
        readyForPrivateRunner: false,
        safeManifestAttestationsComplete: true,
      });
      expect(output.ordinaryDataAvailabilityPreflight.aggregateReadinessFacts).toEqual({
        eventCountBand: "10_plus",
        meetsMinimumEventCount: true,
        meetsMinimumUsableRecordCount: true,
        outcomeLinked: true,
        sameDenominator: true,
        targetAgeBand: "roughly_16_50",
        usableRecordCountBand: "50_plus",
      });
      expect(output.ordinaryDataAvailabilityPreflight.safeManifestAttestations.checklist.every(
        (item) => item.currentStatus === "complete",
      )).toBe(true);
      expect(output.ordinaryDataAvailabilityPreflight.blockers).toEqual([
        "private_config_not_ready_for_r1125",
      ]);
      expect(output.ordinaryDataAvailabilityPreflight.sourceFamilies).toContainEqual({
        declaredAvailable: true,
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
        requiredForFirstPass: true,
        status: "declared_available",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks availability manifests that do not include safe aggregate attestations", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1133-unsafe-manifest-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      const manifestWithoutAttestations = completeAvailabilityManifest();
      delete manifestWithoutAttestations.attestations;
      await Promise.all([
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
        writeFile(manifestPath, `${JSON.stringify(manifestWithoutAttestations)}\n`),
      ]);

      const { output } = await runR1133OrdinaryConsumerDataAvailabilityPreflight({
        availabilityManifestPath: manifestPath,
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_data_availability_preflight_missing_required_availability",
        manifestStatus: "provided",
        missingSourceFamilyIds: [],
        nextAction: "collect_missing_outcome_linked_labs_wearable_sources",
        readyForPrivateConfigMapping: false,
        safeManifestAttestationsComplete: false,
      });
      expect(output.ordinaryDataAvailabilityPreflight.blockers).toContain(
        "safe_manifest_attestations_missing_or_incomplete",
      );
      expect(output.ordinaryDataAvailabilityPreflight.safeManifestAttestations.checklist).toContainEqual({
        attestationId: "noRowEgress",
        currentStatus: "missing_or_false",
        safeExpectedValue: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes to the private runner when availability and readiness are both complete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1133-ready-runner-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      await Promise.all([
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture({ readyForPrivateRunner: true }))}\n`),
        writeFile(manifestPath, `${JSON.stringify(completeAvailabilityManifest())}\n`),
      ]);

      const { output } = await runR1133OrdinaryConsumerDataAvailabilityPreflight({
        availabilityManifestPath: manifestPath,
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_data_availability_preflight_ready_for_private_runner",
        nextAction: "run_r1125_private_runner_then_r1124_real_metric_intake",
        readyForPrivateConfigMapping: true,
        readyForPrivateRunner: true,
        realAggregateStillMissing: false,
        safeManifestAttestationsComplete: true,
      });
      expect(output.ordinaryDataAvailabilityPreflight.blockers).toEqual([]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1133-cli-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      await Promise.all([
        mkdir(path.join(tmp, "out")),
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
        writeFile(manifestPath, `${JSON.stringify(completeAvailabilityManifest())}\n`),
      ]);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1133-ordinary-consumer-data-availability-preflight.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH: manifestPath,
          MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH: r1132Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        nextAction: string;
        productDisplayAuthorized: boolean;
        safeManifestAttestationsComplete: boolean;
        sourceFamilies: Array<{ familyId: string; status: string }>;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_data_availability_preflight_ready_for_private_config_mapping",
        nextAction: "complete_private_config_for_available_labs_wearables",
        productDisplayAuthorized: false,
        safeManifestAttestationsComplete: true,
      });
      expect(summary.sourceFamilies).toContainEqual({
        declaredAvailable: true,
        familyId: "wearable_activity_daily",
        status: "declared_available",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function completeAvailabilityManifest(): Record<string, unknown> {
  return {
    aggregateReadinessFacts: {
      eventCountBand: "10_plus",
      outcomeLinked: true,
      sameDenominator: true,
      targetAgeBand: "roughly_16_50",
      usableRecordCountBand: "50_plus",
    },
    attestations: {
      aggregateOnly: true,
      noCoefficientEgress: true,
      noHeaderNameEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      noSourceTextEgress: true,
    },
    schemaVersion: AVAILABILITY_MANIFEST_SCHEMA_VERSION,
    selectedTableLayout: "single_primary_table_fallback",
    sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
      available: true,
      familyId,
    })),
  };
}

function r1132Fixture(input: { readyForPrivateRunner?: boolean } = {}): Record<string, unknown> {
  const readyForPrivateRunner = input.readyForPrivateRunner === true;
  return {
    artifactBoundary: safeBoundary("R1132"),
    ordinaryConsumerReadiness: {
      blockers: readyForPrivateRunner ? [] : [
        "private_config_not_ready_for_r1125",
      ],
      commands: {
        completionAuditCommand: "pnpm exec tsx scripts/murph-age/r1131-consumer-real-evidence-completion-audit.ts",
        configIntakeCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts",
        metricIntakeCommand:
          "MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH=<aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts",
        privateRunnerCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts",
      },
      minimalSubmissionBundle: {
        acceptedInputProfile: "consumer_bloodwork_labs_wearables_16_50_first",
        acceptedTableLayouts: [
          "single_primary_table_fallback",
          "multi_table_or_explicit_refs",
        ],
        firstPassCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        minimumEvidenceFloor: {
          eventCount: "10_plus",
          usableRecordCount: "50_plus",
        },
        priorityInputFamilies: [
          "bloodwork_labs",
          "vitals_body_context",
          "wearable_activity",
        ],
        requiresOutcomeLinkage: true,
        targetAgeBand: "roughly_16_50",
      },
      readyForPrivateRunner,
      sourceFamilies: sourceFamilies(readyForPrivateRunner),
    },
    packetId: "r1132-ordinary-consumer-submission-readiness",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1132-ordinary-consumer-submission-readiness.v1",
    status: "research-local-aggregate-only",
    summary: {
      averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      conclusion: readyForPrivateRunner
        ? "ordinary_consumer_submission_readiness_ready_for_private_runner"
        : "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
      missingSlotCount: readyForPrivateRunner ? 0 : 20,
      missingSlotTypes: readyForPrivateRunner ? [] : [
        "first_pass_candidate",
        "semantic_ref_family",
        "submission_context_field",
        "table_ref",
      ],
      nextAction: readyForPrivateRunner
        ? "run_r1125_private_runner_then_r1124_real_metric_intake"
        : "fill_average_submitter_private_config_slots",
      productDisplayAuthorized: false,
      readyForPrivateRunner,
      realAggregateStillMissing: !readyForPrivateRunner,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1132: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function sourceFamilies(readyForPrivateRunner: boolean): Record<string, unknown>[] {
  const status = readyForPrivateRunner ? "ready_for_private_runner" : "needs_private_config";
  const missing = readyForPrivateRunner ? [] : sourceFamilyMissingSlotRollup();
  return ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => {
    const missingFamily = missing.find((family) => family.familyId === familyId);
    return {
      acceptableForAverageUser: true,
      familyId,
      inputKind: inputKindFor(familyId),
      missingSlotCount: missingFamily?.missingSlotCount ?? 0,
      missingSlotIds: missingFamily?.missingSlotIds ?? [],
      privateDetailsStored: false,
      requiredForFirstPass: true,
      status,
    };
  });
}

function sourceFamilyMissingSlotRollup(): Array<{
  familyId: string;
  missingSlotCount: number;
  missingSlotIds: string[];
}> {
  return [
    {
      familyId: "join_time_alignment",
      missingSlotCount: 10,
      missingSlotIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
        "personJoinKey",
        "dateOrTimeKey",
        "primaryTableRef",
        "outcomeTableRef",
        "labTableRef",
        "wearableTableRef",
      ],
    },
    {
      familyId: "outcome_linkage",
      missingSlotCount: 6,
      missingSlotIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
        "outcomeEvent",
        "outcomeTableRef",
      ],
    },
    {
      familyId: "bloodwork_glycemia",
      missingSlotCount: 4,
      missingSlotIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "labGlycemia",
        "labTableRef",
      ],
    },
    {
      familyId: "common_bloodwork_core",
      missingSlotCount: 3,
      missingSlotIds: [
        "L2_common_lab_core_shadow",
        "commonLabCore",
        "labTableRef",
      ],
    },
    {
      familyId: "vitals_body_context",
      missingSlotCount: 4,
      missingSlotIds: [
        "L2_common_lab_core_shadow",
        "vitalsBody",
        "labTableRef",
        "primaryTableRef",
      ],
    },
    {
      familyId: "wearable_activity_daily",
      missingSlotCount: 3,
      missingSlotIds: [
        "W1_activity_steps_minutes",
        "wearableActivity",
        "wearableTableRef",
      ],
    },
  ];
}

function inputKindFor(familyId: string): string {
  if (familyId === "bloodwork_glycemia" || familyId === "common_bloodwork_core") {
    return "bloodwork_table_or_lab_portal_export";
  }
  if (familyId === "vitals_body_context") return "body_or_vitals_table";
  if (familyId === "wearable_activity_daily") return "daily_wearable_activity_export_or_spreadsheet";
  if (familyId === "outcome_linkage") return "outcome_or_followup_table";
  return "stable_join_key_and_date_fields";
}

function safeBoundary(stage: "R1132") {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
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
