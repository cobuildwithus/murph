import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION,
} from "./r1105-consumer-aggregate-receipt-template.ts";
import {
  R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION,
} from "./r1124-consumer-first-pass-aggregate-metric-intake.ts";
import {
  R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_SCHEMA_VERSION,
} from "./r1130-ordinary-consumer-real-evidence-handoff.ts";
import {
  R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_SCHEMA_VERSION,
} from "./r1142-ordinary-consumer-partial-private-chain-runner.ts";
import {
  R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_SCHEMA_VERSION,
} from "./r1186-average-submitter-safe-submission-packet.ts";
import {
  R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_SCHEMA_VERSION,
  runR1187AverageSubmitterRouteMetricReadiness,
} from "./r1187-average-submitter-route-metric-readiness.ts";

const CREATED_AT = "2026-05-19T03:05:00.000Z";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first";
const TARGET_AGE_BAND = "roughly_16_50";
const MINIMUM_PAIR = ["bloodwork_glycemia", "wearable_activity_daily"] as const;
const INPUT_KINDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const FIRST_PASS_CANDIDATES = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "QC_missingness_coverage",
] as const;
const SAFE_CONFIRMATION_COMMAND =
  "MURPH_AGE_R1183_ROW_OWNER_SAFE_RESPONSE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts";
const R1130_CONFIG_INTAKE_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts";
const R1130_PRIVATE_RUNNER_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts";
const R1124_METRIC_INTAKE_COMMAND =
  "MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH=<aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts";
const R1104_RECEIPT_VALIDATION_COMMAND =
  "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts";
const R1142_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts";

describe("R1187 average submitter route metric readiness", () => {
  it("keeps the live average 16-50 lab plus wearable route blocked on safe confirmation first", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1187-current-"));
    try {
      const files = await writeFixtures(tmp, {
        r1105: r1105ReadyFixture(),
        r1124: r1124MissingMetricsFixture(),
        r1130: r1130WaitingOnConfigFixture(),
        r1142: r1142WaitingOnSafeManifestFixture(),
        r1186: r1186WaitingOnSafeConfirmationFixture(),
      });

      const { output, outputPath } = await runR1187AverageSubmitterRouteMetricReadiness({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(path.basename(outputPath)).toBe("r1187-average-submitter-route-metric-readiness.latest.json");
      expect(output.schemaVersion).toBe(R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        aggregateMetricsStillMissing: true,
        conclusion: "average_submitter_route_metric_readiness_waiting_on_safe_submission_confirmation",
        featureOnlyResearchPlanningReady: false,
        nextAction: "complete_r1186_boolean_only_safe_confirmation_first",
        nextActionCommand: SAFE_CONFIRMATION_COMMAND,
        privateConfigStillRequired: false,
        realAggregateStillMissing: true,
        reviewGptRequiredNow: false,
        rowOwnerPrivateConfigStillRequired: false,
        rowOwnerSafeConfirmationStillRequired: true,
        safeConfirmationStillRequired: true,
      });
      expect(output.routeMetricReadiness).toMatchObject({
        firstPassCandidateIds: [...FIRST_PASS_CANDIDATES],
        minimumFeaturePairRequired: [...MINIMUM_PAIR],
        prioritizedInputKindIds: [...INPUT_KINDS],
        rowLevelDataAcceptedByR1187: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1187: false,
      });
      expect(output.routeMetricReadiness.commands).toMatchObject({
        aggregateMetricIntakeCommand: R1124_METRIC_INTAKE_COMMAND,
        aggregateReceiptValidationCommand: R1104_RECEIPT_VALIDATION_COMMAND,
        partialPrivateChainCommand: R1142_CHAIN_RUNNER_COMMAND,
        privateConfigIntakeCommand: R1130_CONFIG_INTAKE_COMMAND,
        privateRunnerCommand: R1130_PRIVATE_RUNNER_COMMAND,
        safeConfirmationCommand: SAFE_CONFIRMATION_COMMAND,
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes post-confirmation feature-only readiness to the row-owner private config step", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1187-private-config-"));
    try {
      const files = await writeFixtures(tmp, {
        r1105: r1105ReadyFixture(),
        r1124: r1124MissingMetricsFixture(),
        r1130: r1130WaitingOnConfigFixture(),
        r1142: r1142WaitingOnSafeManifestFixture(),
        r1186: r1186FeatureOnlyReadyFixture(),
      });

      const { output } = await runR1187AverageSubmitterRouteMetricReadiness({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(output.summary).toMatchObject({
        aggregateMetricsStillMissing: true,
        conclusion: "average_submitter_route_metric_readiness_waiting_on_row_owner_private_config",
        featureOnlyResearchPlanningReady: true,
        nextAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
        nextActionCommand: R1130_CONFIG_INTAKE_COMMAND,
        privateConfigStillRequired: true,
        reviewGptRequiredNow: false,
        rowOwnerPrivateConfigStillRequired: true,
        rowOwnerSafeConfirmationStillRequired: false,
        safeConfirmationStillRequired: false,
      });
      expect(output.routeMetricReadiness.commands.safeConfirmationCommand).toBeNull();
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("opens ReviewGPT only for real aggregate deltas and keeps commands null", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1187-reviewgpt-"));
    try {
      const files = await writeFixtures(tmp, {
        r1105: r1105ReadyFixture(),
        r1124: r1124ReviewGptDeltaFixture(),
        r1130: r1130ReviewGptDeltaFixture(),
        r1142: r1142WaitingOnSafeManifestFixture(),
        r1186: r1186FeatureOnlyReadyFixture(),
      });

      const { output } = await runR1187AverageSubmitterRouteMetricReadiness({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(output.summary).toMatchObject({
        aggregateMetricsStillMissing: false,
        conclusion: "average_submitter_route_metric_readiness_ready_for_reviewgpt_real_delta",
        nextAction: "send_real_consumer_first_pass_delta_to_reviewgpt",
        nextActionCommand: null,
        realAggregateStillMissing: false,
        realLabWearableRouteMetricsRecorded: true,
        reviewGptRequiredNow: true,
      });
      expect(output.routeMetricReadiness.reviewGptPolicy).toBe("only_after_real_aggregate_delta_from_r1124_or_r1130");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo malformed upstream command strings", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1187-command-redaction-"));
    try {
      const unsafeCommand = `unsafe-${path.basename(tmp)}`;
      const files = await writeFixtures(tmp, {
        r1105: r1105ReadyFixture(),
        r1124: r1124MissingMetricsFixture(),
        r1130: r1130WaitingOnConfigFixture({ configIntakeCommand: unsafeCommand }),
        r1142: r1142WaitingOnSafeManifestFixture(),
        r1186: r1186FeatureOnlyReadyFixture(),
      });

      const { output } = await runR1187AverageSubmitterRouteMetricReadiness({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(output.r1130State.configIntakeCommandRecognized).toBe(false);
      expect(output.routeMetricReadiness.commands.privateConfigIntakeCommand).toBeNull();
      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_route_metric_readiness_waiting_on_route_metric_input_refresh",
        nextAction: "refresh_route_metric_readiness_inputs",
      });
      expect(JSON.stringify(output)).not.toContain(unsafeCommand);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects upstream model promotion or private-value flags before route readiness output", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1187-unsafe-upstream-"));
    try {
      const unsafeR1186 = withSummaryOverrides(r1186FeatureOnlyReadyFixture(), {
        modelEvidencePromotionAllowed: true,
        rowOwnerPrivateValuesStored: true,
      });
      const files = await writeFixtures(tmp, {
        r1105: r1105ReadyFixture(),
        r1124: r1124MissingMetricsFixture(),
        r1130: r1130WaitingOnConfigFixture(),
        r1142: r1142WaitingOnSafeManifestFixture(),
        r1186: unsafeR1186,
      });

      await expect(runR1187AverageSubmitterRouteMetricReadiness({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      })).rejects.toThrow(/^R1187 rejected unsafe r1186 safe submission packet: 2 findings$/u);
      await expect(stat(path.join(tmp, "out", "r1187-average-submitter-route-metric-readiness.latest.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("refreshes a stale ready R1186 packet that still requires explicit row-owner confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1187-stale-r1186-"));
    try {
      const staleR1186 = r1186Fixture({
        conclusion: "average_submitter_safe_submission_packet_ready_for_feature_only_research_planning",
        featureOnlyResearchPlanningReady: true,
        nextAction: "use_r1181_feature_only_execution_contract_for_research_planning_only",
        nextActionCommand: SAFE_CONFIRMATION_COMMAND,
        nextActionRequiresExplicitRowOwnerAssertion: true,
      });
      const files = await writeFixtures(tmp, {
        r1105: r1105ReadyFixture(),
        r1124: r1124MissingMetricsFixture(),
        r1130: r1130WaitingOnConfigFixture(),
        r1142: r1142WaitingOnSafeManifestFixture(),
        r1186: staleR1186,
      });

      const { output } = await runR1187AverageSubmitterRouteMetricReadiness({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_route_metric_readiness_waiting_on_safe_submission_packet_refresh",
        nextAction: "refresh_r1186_safe_submission_packet",
        rowOwnerPrivateConfigStillRequired: false,
        safeConfirmationStillRequired: false,
        safeSubmissionPacketRefreshRequired: true,
      });
      expect(output.routeMetricReadiness.commands.safeConfirmationCommand).toBe(SAFE_CONFIRMATION_COMMAND);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1187-cli-"));
    try {
      const files = await writeFixtures(tmp, {
        r1105: r1105ReadyFixture(),
        r1124: r1124MissingMetricsFixture(),
        r1130: r1130WaitingOnConfigFixture(),
        r1142: r1142WaitingOnSafeManifestFixture(),
        r1186: r1186WaitingOnSafeConfirmationFixture(),
      });
      const outDir = path.join(tmp, "out");

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1187-average-submitter-route-metric-readiness.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_PATH: files.r1105Path,
        MURPH_AGE_R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_PATH: files.r1124Path,
        MURPH_AGE_R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_PATH: files.r1130Path,
        MURPH_AGE_R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_PATH: files.r1142Path,
        MURPH_AGE_R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_PATH: files.r1186Path,
        MURPH_AGE_R1187_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1187_OUTPUT_DIR: outDir,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      const parsed: unknown = JSON.parse(result.stdout);
      expect(parsed).toMatchObject({
        conclusion: "average_submitter_route_metric_readiness_waiting_on_safe_submission_confirmation",
        nextAction: "complete_r1186_boolean_only_safe_confirmation_first",
        packetId: "r1187-average-submitter-route-metric-readiness",
        reviewGptRequiredNow: false,
        schemaVersion: R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_SCHEMA_VERSION,
      });
      await expect(stat(path.join(outDir, "r1187-average-submitter-route-metric-readiness.latest.json")))
        .resolves.toBeTruthy();
      const output = JSON.parse(
        await readFile(path.join(outDir, "r1187-average-submitter-route-metric-readiness.latest.json"), "utf8"),
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
    r1105: Record<string, unknown>;
    r1124: Record<string, unknown>;
    r1130: Record<string, unknown>;
    r1142: Record<string, unknown>;
    r1186: Record<string, unknown>;
  },
): Promise<{
  r1105Path: string;
  r1124Path: string;
  r1130Path: string;
  r1142Path: string;
  r1186Path: string;
}> {
  const r1105Path = path.join(dir, "r1105.json");
  const r1124Path = path.join(dir, "r1124.json");
  const r1130Path = path.join(dir, "r1130.json");
  const r1142Path = path.join(dir, "r1142.json");
  const r1186Path = path.join(dir, "r1186.json");
  await Promise.all([
    writeFile(r1105Path, `${JSON.stringify(fixtures.r1105)}\n`),
    writeFile(r1124Path, `${JSON.stringify(fixtures.r1124)}\n`),
    writeFile(r1130Path, `${JSON.stringify(fixtures.r1130)}\n`),
    writeFile(r1142Path, `${JSON.stringify(fixtures.r1142)}\n`),
    writeFile(r1186Path, `${JSON.stringify(fixtures.r1186)}\n`),
  ]);
  return { r1105Path, r1124Path, r1130Path, r1142Path, r1186Path };
}

function r1186WaitingOnSafeConfirmationFixture(): Record<string, unknown> {
  return r1186Fixture({
    conclusion: "average_submitter_safe_submission_packet_waiting_on_row_owner_confirmation",
    featureOnlyResearchPlanningReady: false,
    nextAction: "collect_boolean_only_row_owner_confirmation_then_rerun_r1183",
    nextActionCommand: SAFE_CONFIRMATION_COMMAND,
    nextActionRequiresExplicitRowOwnerAssertion: true,
  });
}

function r1186FeatureOnlyReadyFixture(): Record<string, unknown> {
  return r1186Fixture({
    conclusion: "average_submitter_safe_submission_packet_ready_for_feature_only_research_planning",
    featureOnlyResearchPlanningReady: true,
    nextAction: "use_r1181_feature_only_execution_contract_for_research_planning_only",
    nextActionCommand: null,
    nextActionRequiresExplicitRowOwnerAssertion: false,
  });
}

function r1186Fixture(state: {
  conclusion: string;
  featureOnlyResearchPlanningReady: boolean;
  nextAction: string;
  nextActionCommand: string | null;
  nextActionRequiresExplicitRowOwnerAssertion: boolean;
}): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    inputArtifacts: {},
    packetId: "r1186-average-submitter-safe-submission-packet",
    productDisplayAuthorized: false,
    schemaVersion: R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: state.conclusion,
      featureOnlyResearchPlanningReady: state.featureOnlyResearchPlanningReady,
      minimumFeaturePairRequired: [...MINIMUM_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction: state.nextAction,
      nextActionCommand: state.nextActionCommand,
      nextActionRequiresExplicitRowOwnerAssertion: state.nextActionRequiresExplicitRowOwnerAssertion,
      prioritizedInputKindIds: [...INPUT_KINDS],
      productDisplayAuthorized: false,
      realLabWearableRouteMetricsRecorded: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1186: false,
      rowOwnerConfirmationInferredByR1186: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeConfirmationValuesStoredInR1186Packet: false,
      rowParsingPerformedByR1186: false,
      safeSubmissionPacketReady: true,
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };
}

function withSummaryOverrides(
  fixture: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const summary = fixture.summary;
  if (!isRecord(summary)) {
    throw new Error("test fixture summary is missing");
  }
  return {
    ...fixture,
    summary: {
      ...summary,
      ...overrides,
    },
  };
}

function r1130WaitingOnConfigFixture(
  overrides: { configIntakeCommand?: string } = {},
): Record<string, unknown> {
  return r1130Fixture({
    conclusion: "ordinary_consumer_real_evidence_handoff_ready_for_row_owner_config",
    configReadiness: "private_config_needs_completion",
    nextAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
    reviewGptRequiredNow: false,
    rowOwnerWorkType: "complete_private_config",
    ...overrides,
  });
}

function r1130ReviewGptDeltaFixture(): Record<string, unknown> {
  return r1130Fixture({
    conclusion: "ordinary_consumer_real_evidence_handoff_ready_for_reviewgpt_delta",
    configReadiness: "private_config_ready_for_r1125",
    nextAction: "send_real_consumer_first_pass_delta_to_reviewgpt",
    reviewGptRequiredNow: true,
    rowOwnerWorkType: "review_real_delta",
  });
}

function r1130Fixture(state: {
  conclusion: string;
  configIntakeCommand?: string;
  configReadiness: string;
  nextAction: string;
  reviewGptRequiredNow: boolean;
  rowOwnerWorkType: string;
}): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    packetId: "r1130-ordinary-consumer-real-evidence-handoff",
    productDisplayAuthorized: false,
    realEvidenceHandoff: {
      commands: {
        configIntakeCommand: state.configIntakeCommand ?? R1130_CONFIG_INTAKE_COMMAND,
        metricIntakeCommand: R1124_METRIC_INTAKE_COMMAND,
        privateRunnerCommand: R1130_PRIVATE_RUNNER_COMMAND,
      },
      currentPrivateConfig: {
        readiness: state.configReadiness,
      },
      rowOwnerWorkType: state.rowOwnerWorkType,
    },
    schemaVersion: R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: state.conclusion,
      nextAction: state.nextAction,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: state.reviewGptRequiredNow,
      rowOwnerWorkType: state.rowOwnerWorkType,
      rowParsingPerformedByR1130: false,
    },
  };
}

function r1124MissingMetricsFixture(): Record<string, unknown> {
  return r1124Fixture({
    aggregateMetricsProvided: false,
    conclusion: "consumer_first_pass_aggregate_metrics_missing",
    nextAction: "provide_l1_l2_w1_qc_aggregate_metrics_or_fill_private_config",
    receiptArtifact: null,
    reviewGptRequiredNow: false,
    submissionEvidenceRole: null,
  });
}

function r1124ReviewGptDeltaFixture(): Record<string, unknown> {
  return r1124Fixture({
    aggregateMetricsProvided: true,
    conclusion: "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
    nextAction: "send_aggregate_only_consumer_first_pass_delta_to_reviewgpt",
    receiptArtifact: "r1124-consumer-first-pass-aggregate-receipt.json",
    reviewGptRequiredNow: true,
    submissionEvidenceRole: "real_first_pass_evidence",
  });
}

function r1124Fixture(state: {
  aggregateMetricsProvided: boolean;
  conclusion: string;
  nextAction: string;
  receiptArtifact: string | null;
  reviewGptRequiredNow: boolean;
  submissionEvidenceRole: string | null;
}): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    metricIntake: {
      aggregateMetricsProvided: state.aggregateMetricsProvided,
      aggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
      receiptArtifact: state.receiptArtifact,
      submissionEvidenceRole: state.submissionEvidenceRole,
    },
    packetId: "r1124-consumer-first-pass-aggregate-metric-intake",
    productDisplayAuthorized: false,
    schemaVersion: R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: state.conclusion,
      nextAction: state.nextAction,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: state.reviewGptRequiredNow,
      rowParsingPerformedByR1124: false,
    },
  };
}

function r1105ReadyFixture(): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    packetId: "r1105-consumer-aggregate-receipt-template",
    productDisplayAuthorized: false,
    schemaVersion: R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      candidateResultCount: 7,
      nextValidationCommand: R1104_RECEIPT_VALIDATION_COMMAND,
      productDisplayAuthorized: false,
      templateReadyForDataFill: true,
    },
  };
}

function r1142WaitingOnSafeManifestFixture(): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    packetId: "r1142-ordinary-consumer-partial-private-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_SCHEMA_VERSION,
    status: "research-local-private-inputs-aggregate-output",
    summary: {
      conclusion: "ordinary_partial_private_chain_waiting_on_safe_manifest",
      fullSupportedRouteReady: false,
      nextAction: "fill_safe_availability_manifest_then_run_r1142_partial_private_chain",
      productDisplayAuthorized: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      routeMetricsReadyForR1138: false,
      rowParsingPerformedByR1142: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
