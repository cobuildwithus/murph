import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION,
} from "./r1179-average-submitter-objective-gap-audit.ts";
import {
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_EXPLICIT_CONFIRMATION_COMMAND,
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
} from "./r1183-average-submitter-safe-response-materializer.ts";
import {
  R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION,
} from "./r1184-average-submitter-safe-response-chain-status.ts";
import {
  R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_SCHEMA_VERSION,
  runR1186AverageSubmitterSafeSubmissionPacket,
} from "./r1186-average-submitter-safe-submission-packet.ts";

const CREATED_AT = "2026-05-19T02:10:00.000Z";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first";
const TARGET_AGE_BAND = "roughly_16_50";
const MINIMUM_PAIR = ["bloodwork_glycemia", "wearable_activity_daily"] as const;
const INPUT_KINDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const REQUIRED_RESPONSE_FIELDS = [
  "confirm_target_age_band_roughly_16_50",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const SAFE_EXECUTION_FEATURE_SLOTS = [
  "glycemia_lab_presence",
  "glycemia_measurement_date_presence",
  "daily_activity_presence",
  "daily_wear_coverage_presence",
] as const;
const CURRENT_BLOCKED_REQUIREMENTS = [
  "row_owner_safe_assertion_confirmed",
  "feature_only_research_handoff_ready",
  "real_lab_wearable_route_metrics_recorded",
] as const;

describe("R1186 average submitter safe submission packet", () => {
  it("packages the current average 16-50 lab plus wearable row-owner blocker without private values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1186-current-"));
    try {
      const files = await writeFixtures(tmp, {
        r1179: r1179Fixture([...CURRENT_BLOCKED_REQUIREMENTS]),
        r1183: r1183ReadyForExplicitFixture(),
        r1184: r1184WaitingOnRowOwnerFixture(),
      });

      const { output, outputPath } = await runR1186AverageSubmitterSafeSubmissionPacket({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(path.basename(outputPath)).toBe("r1186-average-submitter-safe-submission-packet.latest.json");
      expect(output.schemaVersion).toBe(R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        blockedRequirementIds: [...CURRENT_BLOCKED_REQUIREMENTS],
        conclusion: "average_submitter_safe_submission_packet_waiting_on_row_owner_confirmation",
        featureOnlyResearchPlanningReady: false,
        fillableResponseArtifactPresent: true,
        nextAction: "collect_boolean_only_row_owner_confirmation_then_rerun_r1183",
        nextActionCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_EXPLICIT_CONFIRMATION_COMMAND,
        nextActionRequiresExplicitRowOwnerAssertion: true,
        realLabWearableRouteMetricsRecorded: false,
        rowOwnerActionRouteStatus: "waiting_on_boolean_only_safe_confirmation",
        rowOwnerSafeConfirmationValuesStoredInR1186Packet: false,
        safeSubmissionPacketReady: true,
      });
      expect(output.safeSubmissionPacket).toMatchObject({
        averageSubmitterLikelySubmittable: true,
        minimumFeaturePairRequired: [...MINIMUM_PAIR],
        prioritizedInputKindIds: [...INPUT_KINDS],
        requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS],
        responseTemplateArtifact: "r1183-fillable-average-submitter-safe-confirmation-response.json",
        rowLevelDataAcceptedByR1186: false,
        rowOwnerOnly: true,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1186: false,
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("reports feature-only research planning readiness without promoting model evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1186-ready-"));
    try {
      const files = await writeFixtures(tmp, {
        r1179: r1179Fixture(["real_lab_wearable_route_metrics_recorded"]),
        r1183: r1183ConfirmedFixture(),
        r1184: r1184ReadyFixture(),
      });

      const { output } = await runR1186AverageSubmitterSafeSubmissionPacket({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_submission_packet_ready_for_feature_only_research_planning",
        featureOnlyResearchHandoffReady: true,
        featureOnlyResearchPlanningReady: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "use_r1181_feature_only_execution_contract_for_research_planning_only",
        nextActionCommand: null,
        productDisplayAuthorized: false,
        realLabWearableRouteMetricsRecorded: false,
        rowOwnerActionRouteStatus: "feature_only_research_planning_ready",
      });
      expect(output.r1184State.safeExecutionFeatureSlotIds).toEqual([...SAFE_EXECUTION_FEATURE_SLOTS]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream gates without echoing local paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1186-unsafe-"));
    try {
      const files = await writeFixtures(tmp, {
        r1179: r1179Fixture([...CURRENT_BLOCKED_REQUIREMENTS]),
        r1183: r1183ReadyForExplicitFixture(),
        r1184: withArtifactBoundary(r1184WaitingOnRowOwnerFixture(), {
          aggregateOnly: true,
          rowValuesStored: true,
        }),
      });

      await expect(runR1186AverageSubmitterSafeSubmissionPacket({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      })).rejects.toThrow("R1186 rejected unsafe r1184 safe response chain status: 1 finding");
      await expect(runR1186AverageSubmitterSafeSubmissionPacket({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      })).rejects.not.toThrow(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not persist an unrecognized R1179 next action string", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1186-unrecognized-r1179-"));
    try {
      const unsafeNextAction = `unsafe-${path.basename(tmp)}`;
      const files = await writeFixtures(tmp, {
        r1179: r1179Fixture([...CURRENT_BLOCKED_REQUIREMENTS], {
          nextAction: unsafeNextAction,
        }),
        r1183: r1183ReadyForExplicitFixture(),
        r1184: r1184WaitingOnRowOwnerFixture(),
      });

      const { output } = await runR1186AverageSubmitterSafeSubmissionPacket({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_submission_packet_waiting_on_row_owner_confirmation",
        nextAction: "collect_boolean_only_row_owner_confirmation_then_rerun_r1183",
      });
      expect(output.r1179State.nextAction).toBeNull();
      expect(JSON.stringify(output)).not.toContain(unsafeNextAction);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1186-cli-"));
    try {
      const files = await writeFixtures(tmp, {
        r1179: r1179Fixture([...CURRENT_BLOCKED_REQUIREMENTS]),
        r1183: r1183ReadyForExplicitFixture(),
        r1184: r1184WaitingOnRowOwnerFixture(),
      });
      const outDir = path.join(tmp, "out");

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1186-average-submitter-safe-submission-packet.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_PATH: files.r1179Path,
        MURPH_AGE_R1183_SAFE_RESPONSE_MATERIALIZER_PATH: files.r1183Path,
        MURPH_AGE_R1184_SAFE_RESPONSE_CHAIN_STATUS_PATH: files.r1184Path,
        MURPH_AGE_R1186_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1186_OUTPUT_DIR: outDir,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      expect(result.stdout).not.toContain("confirmGlycemiaBloodworkExportAvailable");
      const parsed: unknown = JSON.parse(result.stdout);
      expect(parsed).toMatchObject({
        conclusion: "average_submitter_safe_submission_packet_waiting_on_row_owner_confirmation",
        nextAction: "collect_boolean_only_row_owner_confirmation_then_rerun_r1183",
        packetId: "r1186-average-submitter-safe-submission-packet",
        safeSubmissionPacketReady: true,
        schemaVersion: R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_SCHEMA_VERSION,
      });
      await expect(stat(path.join(outDir, "r1186-average-submitter-safe-submission-packet.latest.json")))
        .resolves.toBeTruthy();
      const output = JSON.parse(
        await readFile(path.join(outDir, "r1186-average-submitter-safe-submission-packet.latest.json"), "utf8"),
      ) as unknown;
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtures(
  dir: string,
  fixtures: {
    r1179: Record<string, unknown>;
    r1183: Record<string, unknown>;
    r1184: Record<string, unknown>;
  },
): Promise<{ r1179Path: string; r1183Path: string; r1184Path: string }> {
  const r1179Path = path.join(dir, "r1179.json");
  const r1183Path = path.join(dir, "r1183.json");
  const r1184Path = path.join(dir, "r1184.json");
  await Promise.all([
    writeFile(r1179Path, `${JSON.stringify(fixtures.r1179)}\n`),
    writeFile(r1183Path, `${JSON.stringify(fixtures.r1183)}\n`),
    writeFile(r1184Path, `${JSON.stringify(fixtures.r1184)}\n`),
  ]);
  return { r1179Path, r1183Path, r1184Path };
}

function r1179Fixture(
  blockedRequirementIds: readonly string[],
  overrides: { nextAction?: string } = {},
): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    inputArtifacts: {},
    packetId: "r1179-average-submitter-objective-gap-audit",
    productDisplayAuthorized: false,
    schemaVersion: R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      averageSubmitterSubmissionPriority: {
        averageSubmitterLikelySubmittable: true,
      },
      blockedRequirementIds: [...blockedRequirementIds],
      goalAchieved: false,
      minimumFeaturePairRequired: [...MINIMUM_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction: overrides.nextAction ?? "fill_r1180_safe_confirmation_response_template",
      prioritizedInputKindIds: [...INPUT_KINDS],
      productDisplayAuthorized: false,
      readyToMarkComplete: false,
      rowLevelDataAcceptedByR1179: false,
      rowOwnerConfirmationInferredByR1179: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1179: false,
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };
}

function r1183ReadyForExplicitFixture(): Record<string, unknown> {
  return r1183Fixture({
    confirmedResponseArtifact: null,
    confirmedResponseArtifactWritten: false,
    conclusion: "average_submitter_safe_response_materializer_ready_for_explicit_confirmation",
    explicitRowOwnerSafeResponseAssertionProvided: false,
    nextAction: "rerun_r1183_with_row_owner_safe_response_assertion",
    rowOwnerSafeResponseAssertionStillRequired: true,
  });
}

function r1183ConfirmedFixture(): Record<string, unknown> {
  return r1183Fixture({
    confirmedResponseArtifact: "r1183-confirmed-average-submitter-safe-confirmation-response.json",
    confirmedResponseArtifactWritten: true,
    conclusion: "average_submitter_safe_response_materializer_confirmed_response_written",
    explicitRowOwnerSafeResponseAssertionProvided: true,
    nextAction: "run_r1180_with_confirmed_average_submitter_safe_response",
    rowOwnerSafeResponseAssertionStillRequired: false,
  });
}

function r1183Fixture(state: {
  confirmedResponseArtifact: string | null;
  confirmedResponseArtifactWritten: boolean;
  conclusion: string;
  explicitRowOwnerSafeResponseAssertionProvided: boolean;
  nextAction: string;
  rowOwnerSafeResponseAssertionStillRequired: boolean;
}): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    inputArtifacts: {},
    packetId: "r1183-average-submitter-safe-response-materializer",
    productDisplayAuthorized: false,
    schemaVersion: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      confirmedResponseArtifact: state.confirmedResponseArtifact,
      confirmedResponseArtifactWritten: state.confirmedResponseArtifactWritten,
      conclusion: state.conclusion,
      explicitRowOwnerSafeResponseAssertionProvided: state.explicitRowOwnerSafeResponseAssertionProvided,
      fillableResponseArtifact: "r1183-fillable-average-submitter-safe-confirmation-response.json",
      fillableResponseArtifactWritten: true,
      materializerReadyForRowOwnerConfirmation: true,
      minimumFeaturePairRequired: [...MINIMUM_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction: state.nextAction,
      productDisplayAuthorized: false,
      requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1183: false,
      rowOwnerConfirmationInferredByR1183: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeResponseAssertionStillRequired: state.rowOwnerSafeResponseAssertionStillRequired,
      rowOwnerSafeResponseValuesStoredInR1183Packet: false,
      rowParsingPerformedByR1183: false,
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };
}

function r1184WaitingOnRowOwnerFixture(): Record<string, unknown> {
  return r1184Fixture({
    conclusion: "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
    confirmedResponseArtifactReadyForR1180: false,
    explicitRowOwnerSafeConfirmationProvided: false,
    featureOnlyExecutionContractReady: false,
    featureOnlySafeConfirmationReady: false,
    handoffReadyForResearchPlanningOnly: false,
    materializerReadyForRowOwnerConfirmation: true,
    nextAction: "rerun_r1183_with_row_owner_safe_response_assertion",
    nextActionRequiresExplicitRowOwnerAssertion: true,
    rowOwnerSafeResponseAssertionStillRequired: true,
    safeExecutionFeatureSlotIds: null,
  });
}

function r1184ReadyFixture(): Record<string, unknown> {
  return r1184Fixture({
    conclusion: "average_submitter_safe_response_chain_ready_for_feature_only_research_planning",
    confirmedResponseArtifactReadyForR1180: false,
    explicitRowOwnerSafeConfirmationProvided: true,
    featureOnlyExecutionContractReady: true,
    featureOnlySafeConfirmationReady: true,
    handoffReadyForResearchPlanningOnly: true,
    materializerReadyForRowOwnerConfirmation: true,
    nextAction: "use_r1181_feature_only_execution_contract_for_research_planning_only",
    nextActionRequiresExplicitRowOwnerAssertion: false,
    rowOwnerSafeResponseAssertionStillRequired: false,
    safeExecutionFeatureSlotIds: [...SAFE_EXECUTION_FEATURE_SLOTS],
  });
}

function r1184Fixture(state: {
  conclusion: string;
  confirmedResponseArtifactReadyForR1180: boolean;
  explicitRowOwnerSafeConfirmationProvided: boolean;
  featureOnlyExecutionContractReady: boolean;
  featureOnlySafeConfirmationReady: boolean;
  handoffReadyForResearchPlanningOnly: boolean;
  materializerReadyForRowOwnerConfirmation: boolean;
  nextAction: string;
  nextActionRequiresExplicitRowOwnerAssertion: boolean;
  rowOwnerSafeResponseAssertionStillRequired: boolean;
  safeExecutionFeatureSlotIds: readonly string[] | null;
}): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    chainStatus: {},
    createdAt: CREATED_AT,
    inputArtifacts: {},
    packetId: "r1184-average-submitter-safe-response-chain-status",
    productDisplayAuthorized: false,
    schemaVersion: R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: state.conclusion,
      confirmedResponseArtifactReadyForR1180: state.confirmedResponseArtifactReadyForR1180,
      explicitRowOwnerSafeConfirmationProvided: state.explicitRowOwnerSafeConfirmationProvided,
      featureOnlyExecutionContractReady: state.featureOnlyExecutionContractReady,
      featureOnlySafeConfirmationReady: state.featureOnlySafeConfirmationReady,
      fillableResponseArtifactPresent: true,
      handoffReadyForResearchPlanningOnly: state.handoffReadyForResearchPlanningOnly,
      materializerReadyForRowOwnerConfirmation: state.materializerReadyForRowOwnerConfirmation,
      minimumFeaturePairRequired: [...MINIMUM_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction: state.nextAction,
      nextActionRequiresExplicitRowOwnerAssertion: state.nextActionRequiresExplicitRowOwnerAssertion,
      prioritizedInputKindIds: [...INPUT_KINDS],
      productDisplayAuthorized: false,
      requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1184: false,
      rowOwnerConfirmationInferredByR1184: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeResponseAssertionStillRequired: state.rowOwnerSafeResponseAssertionStillRequired,
      rowOwnerSafeResponseValuesStoredInR1184Packet: false,
      rowParsingPerformedByR1184: false,
      safeExecutionFeatureSlotIds: state.safeExecutionFeatureSlotIds === null
        ? null
        : [...state.safeExecutionFeatureSlotIds],
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };
}

function withArtifactBoundary(
  value: Record<string, unknown>,
  artifactBoundary: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...value,
    artifactBoundary,
  };
}

function execFilePromise(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve({ stderr, stdout });
    });
  });
}
