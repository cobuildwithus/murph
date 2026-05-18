import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1148_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_INTAKE_SCHEMA_VERSION,
  runR1148OrdinaryConsumerPostConfirmationPrivateConfigIntake,
} from "./r1148-ordinary-consumer-post-confirmation-private-config-intake.ts";

const ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
];
const MINIMUM_LAB_WEARABLE_PAIR = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT = "r1154-feature-only-safe-confirmation-quickstart.json";
const R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS = [
  "aggregateReadinessFacts.targetAgeBand",
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "rowOwnerAssertionsConfirmed",
  "attestations.aggregateOnly",
  "attestations.localOnly",
  "attestations.noCoefficientEgress",
  "attestations.noHeaderNameEgress",
  "attestations.noParticipantEgress",
  "attestations.noPredictionEgress",
  "attestations.noPrivatePathEgress",
  "attestations.noPrivateRefValueEgress",
  "attestations.noRowEgress",
  "attestations.noSmallCellEgress",
  "attestations.noSourceTextEgress",
];
const RUNNER_FIELD_REF_KEYS = [
  "personJoinKey",
  "outcomeEvent",
  "labGlycemia",
  "wearableActivity",
];
const RUNNER_TABLE_REF_KEYS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
];
const ATTESTATION_KEYS = [
  "localOnly",
  "noCoefficientEgress",
  "noHeaderNameEgress",
  "noParticipantEgress",
  "noPredictionEgress",
  "noPrivatePathEgress",
  "noPrivateRefValueEgress",
  "noRowEgress",
  "noSmallCellEgress",
  "noSourceTextEgress",
];
const RUNNER_CONFIG_SCHEMA_VERSION = "murph-age-ordinary-consumer-partial-private-runner-config.v1";
const AGGREGATE_METRICS_SCHEMA_VERSION = "murph-age-ordinary-consumer-partial-aggregate-metrics.v1";
const AGGREGATE_METRICS_EVALUATOR_ID = "ordinary_consumer_partial_route_aggregate_evaluator_v1";

describe("R1148 ordinary consumer post-confirmation private config intake", () => {
  it("routes pre-confirmation config intake through the safe availability confirmation action", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1148-waiting-"));
    try {
      const r1147Path = path.join(tmp, "r1147.json");
      await writeFile(r1147Path, `${JSON.stringify(r1147Fixture({ confirmed: false }))}\n`);

      const { output, outputPath } = await runR1148OrdinaryConsumerPostConfirmationPrivateConfigIntake({
        createdAt: "2026-05-16T23:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1147Path,
      });

      expect(path.basename(outputPath)).toBe(
        "r1148-ordinary-consumer-post-confirmation-private-config-intake.latest.json",
      );
      expect(output.schemaVersion).toBe(
        R1148_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_INTAKE_SCHEMA_VERSION,
      );
      expect(output.summary).toMatchObject({
        conclusion: "post_confirmation_private_config_waiting_on_safe_availability_confirmation",
        expectedRouteIds: ROUTE_IDS,
        nextAction: "fill_safe_availability_confirmation_from_template",
        packetReadyForConfigIntake: false,
        privateConfigStatus: "missing",
        productDisplayAuthorized: false,
        r1147Conclusion: "ordinary_post_confirmation_private_config_packet_waiting_on_safe_availability_confirmation",
        r1147NextAction: "fill_safe_availability_confirmation_from_template",
        readyForR1142: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1148: false,
        safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        safeAvailabilityActionPacketFeatureOnlyCoverageContextReady: false,
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: MINIMUM_LAB_WEARABLE_PAIR,
        safeAvailabilityActionPacketMissingRequiredSourceFamilyIds: [
          "person_join_time",
          "outcome_event",
          ...MINIMUM_LAB_WEARABLE_PAIR,
        ],
        safeAvailabilityActionPacketNextAction: "fill_safe_availability_confirmation_from_template",
        safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: false,
        safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: false,
      });
      expect(output.postConfirmationPrivateConfigIntake).toMatchObject({
        r1147Conclusion: "ordinary_post_confirmation_private_config_packet_waiting_on_safe_availability_confirmation",
        r1147NextAction: "fill_safe_availability_confirmation_from_template",
        safeAvailabilityActionPacketNextAction: "fill_safe_availability_confirmation_from_template",
      });
      expect(output.summary.missingRunnerFieldRefKeys).toEqual(RUNNER_FIELD_REF_KEYS);
      expect(output.summary.missingRunnerTableRefKeys).toEqual(RUNNER_TABLE_REF_KEYS);
      expect(output.summary.missingRouteIds).toEqual(ROUTE_IDS);
      expect(output.summary.missingAttestationKeys).toEqual(ATTESTATION_KEYS);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("refreshes R1147 when the post-confirmation packet is missing or stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1148-missing-packet-"));
    try {
      const { output } = await runR1148OrdinaryConsumerPostConfirmationPrivateConfigIntake({
        outputDir: path.join(tmp, "out"),
        r1147Path: path.join(tmp, "missing-r1147.json"),
      });

      expect(output.summary).toMatchObject({
        conclusion: "post_confirmation_private_config_waiting_on_packet",
        nextAction: "refresh_r1147_post_confirmation_private_config_packet",
        packetReadyForConfigIntake: false,
        r1147Conclusion: null,
        r1147NextAction: null,
        safeAvailabilityActionPacketConclusion: null,
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: null,
        safeAvailabilityActionPacketNextAction: null,
      });
      expect(output.summary.safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds).toEqual([]);
      expect(output.summary.safeAvailabilityActionPacketMissingRequiredSourceFamilyIds).toEqual([]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("reports a missing filled private config after R1147 is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1148-missing-"));
    try {
      const r1147Path = path.join(tmp, "r1147.json");
      await writeFile(r1147Path, `${JSON.stringify(r1147Fixture({ confirmed: true }))}\n`);

      const { output } = await runR1148OrdinaryConsumerPostConfirmationPrivateConfigIntake({
        outputDir: path.join(tmp, "out"),
        r1147Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "post_confirmation_private_config_not_provided",
        nextAction: "provide_post_confirmation_private_runner_config",
        packetReadyForConfigIntake: true,
        privateConfigStatus: "missing",
        privateConfigSuppliedToIntake: false,
        readyForR1142: false,
      });
      expect(output.postConfirmationPrivateConfigIntake).toMatchObject({
        aggregateMetricsTargetStatus: "not_provided",
        attestationStatus: "not_provided",
        evidenceRoleStatus: "not_provided",
        ordinaryTableLayout: "not_provided",
        routeRunOrderStatus: "not_provided",
        runnerConfigSchemaStatus: "not_provided",
        runnerFieldRefsStatus: "not_provided",
        runnerTableRefsStatus: "not_provided",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("accepts a complete real lab-plus-wearable runner config without leaking private values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1148-ready-"));
    try {
      const r1147Path = path.join(tmp, "r1147.json");
      const configPath = path.join(tmp, "filled-private-config.json");
      await writeFile(r1147Path, `${JSON.stringify(r1147Fixture({ confirmed: true }))}\n`);
      await writeFile(configPath, `${JSON.stringify(completePrivateConfig(tmp))}\n`);

      const { output } = await runR1148OrdinaryConsumerPostConfirmationPrivateConfigIntake({
        configPath,
        outputDir: path.join(tmp, "out"),
        r1147Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "post_confirmation_private_config_ready_for_r1142",
        evidenceRoleStatus: "complete_real_evidence",
        missingAttestationKeys: [],
        missingRouteIds: [],
        missingRunnerFieldRefKeys: [],
        missingRunnerTableRefKeys: [],
        nextAction: "run_r1142_for_real_lab_wearable_route_metrics",
        ordinaryTableLayout: "single_primary_table_fallback",
        packetReadyForConfigIntake: true,
        privateConfigStatus: "available",
        privateConfigSuppliedToIntake: true,
        readyForR1142: true,
        requestedRouteIds: ROUTE_IDS,
      });
      expect(output.postConfirmationPrivateConfigIntake).toMatchObject({
        aggregateMetricsTargetStatus: "complete",
        attestationStatus: "complete",
        privateDetailsStored: false,
        routeRunOrderStatus: "complete",
        runnerConfigSchemaStatus: "complete",
        runnerFieldRefsStatus: "complete",
        runnerTableRefsStatus: "complete",
      });
      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(tmp);
      expect(serialized).not.toContain("private_person_id");
      expect(serialized).not.toContain("glucose_private_column");
      expect(serialized).not.toContain("wearable_private_column");
      expect(serialized).not.toContain("ordinary-private-route.csv");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps incomplete config feedback to safe slot names", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1148-incomplete-"));
    try {
      const r1147Path = path.join(tmp, "r1147.json");
      const configPath = path.join(tmp, "partial-private-config.json");
      await writeFile(r1147Path, `${JSON.stringify(r1147Fixture({ confirmed: true }))}\n`);
      await writeFile(configPath, `${JSON.stringify({
        ...completePrivateConfig(tmp),
        attestations: {
          ...attestations(),
          noPrivatePathEgress: false,
        },
        privateFieldRefs: {
          personJoinKey: "private_person_id",
          outcomeEvent: "private_outcome_flag",
        },
        privateTableRefs: {
          outcomeTableRef: path.join(tmp, "private-outcome.csv"),
        },
        routeRunOrder: [
          { routeId: "lab_glycemia_minimum_route" },
        ],
      })}\n`);

      const { output } = await runR1148OrdinaryConsumerPostConfirmationPrivateConfigIntake({
        configPath,
        outputDir: path.join(tmp, "out"),
        r1147Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "post_confirmation_private_config_incomplete",
        missingAttestationKeys: ["noPrivatePathEgress"],
        missingRouteIds: ["wearable_activity_minimum_route"],
        missingRunnerFieldRefKeys: ["labGlycemia", "wearableActivity"],
        missingRunnerTableRefKeys: ["labTableRef", "wearableTableRef"],
        nextAction: "complete_post_confirmation_private_runner_config_slots",
        ordinaryTableLayout: "incomplete",
        readyForR1142: false,
      });
      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(tmp);
      expect(serialized).not.toContain("private_person_id");
      expect(serialized).not.toContain("private-outcome.csv");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("separates synthetic smoke configs from real evidence readiness", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1148-synthetic-"));
    try {
      const r1147Path = path.join(tmp, "r1147.json");
      const configPath = path.join(tmp, "synthetic-private-config.json");
      await writeFile(r1147Path, `${JSON.stringify(r1147Fixture({ confirmed: true }))}\n`);
      await writeFile(configPath, `${JSON.stringify({
        ...completePrivateConfig(tmp),
        submissionContext: {
          evidenceRole: "synthetic_pipeline_smoke",
        },
      })}\n`);

      const { output } = await runR1148OrdinaryConsumerPostConfirmationPrivateConfigIntake({
        configPath,
        outputDir: path.join(tmp, "out"),
        r1147Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "post_confirmation_private_config_non_evidence_only",
        evidenceRoleStatus: "complete_non_evidence",
        nextAction: "use_synthetic_config_only_for_smoke_not_evidence",
        readyForR1142: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1148-cli-"));
    try {
      const r1147Path = path.join(tmp, "r1147.json");
      const configPath = path.join(tmp, "filled-private-config.json");
      await writeFile(r1147Path, `${JSON.stringify(r1147Fixture({ confirmed: true }))}\n`);
      await writeFile(configPath, `${JSON.stringify(completePrivateConfig(tmp))}\n`);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1148-ordinary-consumer-post-confirmation-private-config-intake.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH: configPath,
          MURPH_AGE_R1147_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_PACKET_PATH: r1147Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        missingRunnerFieldRefKeys: string[];
        nextAction: string;
        packetId: string;
        privateConfigStatus: string;
        readyForR1142: boolean;
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
      };
      expect(summary).toMatchObject({
        conclusion: "post_confirmation_private_config_ready_for_r1142",
        missingRunnerFieldRefKeys: [],
        nextAction: "run_r1142_for_real_lab_wearable_route_metrics",
        packetId: "r1148-ordinary-consumer-post-confirmation-private-config-intake",
        privateConfigStatus: "available",
        readyForR1142: true,
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("private_person_id");
      expect(stdout).not.toContain("ordinary-private-route.csv");

      const output = JSON.parse(
        await readFile(
          path.join(tmp, "out", "r1148-ordinary-consumer-post-confirmation-private-config-intake.latest.json"),
          "utf8",
        ),
      ) as unknown;
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function completePrivateConfig(tmp: string): Record<string, unknown> {
  return {
    aggregateMetricsTarget: {
      evaluatorId: AGGREGATE_METRICS_EVALUATOR_ID,
      schemaVersion: AGGREGATE_METRICS_SCHEMA_VERSION,
    },
    attestations: attestations(),
    privateFieldRefs: {
      labGlycemia: "glucose_private_column",
      outcomeEvent: "private_outcome_flag",
      personJoinKey: "private_person_id",
      wearableActivity: "wearable_private_column",
    },
    privateTableRefs: {
      primaryTableRef: path.join(tmp, "ordinary-private-route.csv"),
    },
    routeRunOrder: ROUTE_IDS.map((routeId) => ({ routeId })),
    schemaVersion: RUNNER_CONFIG_SCHEMA_VERSION,
    submissionContext: {
      evidenceRole: "real_partial_route_evidence",
    },
  };
}

function attestations(): Record<string, true> {
  return Object.fromEntries(ATTESTATION_KEYS.map((key) => [key, true])) as Record<string, true>;
}

function r1147Fixture(options: { confirmed: boolean }): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1147-ordinary-consumer-post-confirmation-private-config-packet",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1147-ordinary-consumer-post-confirmation-private-config-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      blockers: options.confirmed
        ? [
            "private_route_config_not_supplied",
            "real_lab_wearable_route_metrics_missing",
          ]
        : [
            "safe_availability_confirmation_missing",
            "private_route_config_not_supplied",
            "real_lab_wearable_route_metrics_missing",
          ],
      conclusion: options.confirmed
        ? "ordinary_post_confirmation_private_config_packet_waiting_on_private_route_config"
        : "ordinary_post_confirmation_private_config_packet_waiting_on_safe_availability_confirmation",
      expectedRouteIds: ROUTE_IDS,
      nextAction: options.confirmed
        ? "fill_post_confirmation_private_config_and_run_r1142"
        : "fill_safe_availability_confirmation_from_template",
      privateConfigTemplateArtifact: "r1147-fillable-ordinary-consumer-lab-wearable-private-route-config.json",
      privateConfigTemplateReadyForFill: options.confirmed,
      productDisplayAuthorized: false,
      readyToMarkComplete: false,
      requiredPrivateFieldRefFamilies: [
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
        "wearableActivity",
      ],
      requiredPrivateTableRefs: RUNNER_TABLE_REF_KEYS,
      reviewGptRequiredNow: false,
      runnerConfigPrivateFieldRefKeys: RUNNER_FIELD_REF_KEYS,
      runnerConfigPrivateTableRefKeys: RUNNER_TABLE_REF_KEYS,
      runnerConfigRouteRunOrder: ROUTE_IDS,
      runnerConfigSchemaVersion: RUNNER_CONFIG_SCHEMA_VERSION,
      runnerConfigTopLevelKeys: [
        "schemaVersion",
        "attestations",
        "aggregateMetricsTarget",
        "routeRunOrder",
        "privateTableRefs",
        "privateFieldRefs",
        "submissionContext",
      ],
      rowOwnerAssertionsConfirmed: options.confirmed,
      rowParsingPerformedByR1147: false,
      safeAvailabilityActionPacketConclusion: options.confirmed
        ? "safe_availability_action_packet_ready_for_recipe_or_feature_only_coverage"
        : "safe_availability_action_packet_waiting_on_safe_confirmation",
      safeAvailabilityActionPacketFeatureOnlyCoverageContextReady: options.confirmed,
      safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
        R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
        R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
      safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: options.confirmed
        ? []
        : MINIMUM_LAB_WEARABLE_PAIR,
      safeAvailabilityActionPacketMissingRequiredSourceFamilyIds: options.confirmed
        ? []
        : [
            "person_join_time",
            "outcome_event",
            ...MINIMUM_LAB_WEARABLE_PAIR,
          ],
      safeAvailabilityActionPacketNextAction: options.confirmed
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : "fill_safe_availability_confirmation_from_template",
      safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: options.confirmed,
      safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: false,
      selectedRecommendedRecipeId: "lab_plus_wearable_minimum_manifest",
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function safeBoundary(): Record<string, false | true> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
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
    rowParsingPerformedByR1147: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}
