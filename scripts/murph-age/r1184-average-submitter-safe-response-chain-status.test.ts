import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND,
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION,
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";
import {
  R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION,
} from "./r1181-average-submitter-feature-only-execution-contract.ts";
import {
  R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
} from "./r1182-average-submitter-safe-response-handoff.ts";
import {
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
} from "./r1183-average-submitter-safe-response-materializer.ts";
import {
  R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION,
  runR1184AverageSubmitterSafeResponseChainStatus,
} from "./r1184-average-submitter-safe-response-chain-status.ts";

const CREATED_AT = "2026-05-19T01:15:00.000Z";
const ASK_ID = "confirm_feature_only_lab_wearable_availability_without_private_values";
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

describe("R1184 average submitter safe response chain status", () => {
  it("surfaces the current row-owner assertion blocker without private paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1184-current-"));
    try {
      const files = await writeChainFixtures(tmp, {
        r1180: r1180WaitingFixture(),
        r1181: r1181WaitingFixture(),
        r1182: r1182WaitingFixture(),
        r1183: r1183ReadyForExplicitFixture(),
        fillable: safeResponseFixture(false),
      });

      const { output, outputPath } = await runR1184AverageSubmitterSafeResponseChainStatus({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(path.basename(outputPath)).toBe("r1184-average-submitter-safe-response-chain-status.latest.json");
      expect(output.schemaVersion).toBe(R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
        confirmedResponseArtifactPresent: false,
        confirmedResponseArtifactReadyForR1180: false,
        fillableResponseArtifact: "r1183-fillable-average-submitter-safe-confirmation-response.json",
        fillableResponseArtifactPresent: true,
        nextAction: "rerun_r1183_with_row_owner_safe_response_assertion",
        nextActionCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
        nextActionInputArtifact: null,
        nextActionRequiresExplicitRowOwnerAssertion: true,
        rowLevelDataAcceptedByR1184: false,
        rowOwnerConfirmationInferredByR1184: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1184: false,
        staleConfirmedResponseArtifactDetected: false,
      });
      expect(output.summary.minimumFeaturePairRequired).toEqual([...MINIMUM_PAIR]);
      expect(output.summary.prioritizedInputKindIds).toEqual([...INPUT_KINDS]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a confirmed R1183 response artifact into R1180 intake", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1184-confirmed-"));
    try {
      const files = await writeChainFixtures(tmp, {
        r1180: r1180WaitingFixture(),
        r1181: r1181WaitingFixture(),
        r1182: r1182WaitingFixture(),
        r1183: r1183ConfirmedFixture(),
        fillable: safeResponseFixture(false),
        confirmed: safeResponseFixture(true),
      });

      const { output } = await runR1184AverageSubmitterSafeResponseChainStatus({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_chain_waiting_on_r1180_confirmed_response_intake",
        confirmedResponseArtifact: "r1183-confirmed-average-submitter-safe-confirmation-response.json",
        confirmedResponseArtifactPresent: true,
        confirmedResponseArtifactReadyForR1180: true,
        nextAction: "run_r1180_with_r1183_confirmed_safe_response_artifact",
        nextActionCommand:
          "MURPH_AGE_R1180_SAFE_CONFIRMATION_RESPONSE_PATH=<r1183-confirmed-average-submitter-safe-confirmation-response.json> pnpm exec tsx scripts/murph-age/r1180-average-submitter-safe-confirmation-response-intake.ts",
        nextActionInputArtifact: "r1183-confirmed-average-submitter-safe-confirmation-response.json",
        nextActionRequiresExplicitRowOwnerAssertion: false,
        staleConfirmedResponseArtifactDetected: false,
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when a confirmed response artifact is stale relative to R1183", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1184-stale-"));
    try {
      const files = await writeChainFixtures(tmp, {
        r1180: r1180WaitingFixture(),
        r1181: r1181WaitingFixture(),
        r1182: r1182WaitingFixture(),
        r1183: r1183ReadyForExplicitFixture(),
        fillable: safeResponseFixture(false),
        confirmed: safeResponseFixture(true),
      });

      const { output } = await runR1184AverageSubmitterSafeResponseChainStatus({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_chain_waiting_on_r1183_refresh",
        confirmedResponseArtifactPresent: true,
        confirmedResponseArtifactReadyForR1180: false,
        nextAction: "refresh_r1183_safe_response_materializer",
        nextActionCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
        nextActionInputArtifact: null,
        staleConfirmedResponseArtifactDetected: true,
      });
      expect(output.responseArtifactState).toMatchObject({
        confirmedResponseArtifactPresent: true,
        confirmedResponseArtifactReadyForR1180: false,
        staleConfirmedResponseArtifactDetected: true,
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not mark a confirmed response with extra keys ready for R1180", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1184-extra-key-"));
    try {
      const files = await writeChainFixtures(tmp, {
        r1180: r1180WaitingFixture(),
        r1181: r1181WaitingFixture(),
        r1182: r1182WaitingFixture(),
        r1183: r1183ConfirmedFixture(),
        fillable: safeResponseFixture(false),
        confirmed: {
          ...safeResponseFixture(true),
          nonPrivateButUnexpected: true,
        },
      });

      const { output } = await runR1184AverageSubmitterSafeResponseChainStatus({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_chain_waiting_on_r1183_refresh",
        confirmedResponseArtifactPresent: true,
        confirmedResponseArtifactReadyForR1180: false,
        nextAction: "refresh_r1183_safe_response_materializer",
        staleConfirmedResponseArtifactDetected: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("reports feature-only research planning readiness once R1180 through R1182 are ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1184-ready-"));
    try {
      const files = await writeChainFixtures(tmp, {
        r1180: r1180ReadyFixture(),
        r1181: r1181ReadyFixture(),
        r1182: r1182ReadyFixture(),
      });

      const { output } = await runR1184AverageSubmitterSafeResponseChainStatus({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_chain_ready_for_feature_only_research_planning",
        explicitRowOwnerSafeConfirmationProvided: true,
        featureOnlyExecutionContractReady: true,
        featureOnlySafeConfirmationReady: true,
        handoffReadyForResearchPlanningOnly: true,
        nextAction: "use_r1181_feature_only_execution_contract_for_research_planning_only",
        nextActionCommand: null,
        safeExecutionFeatureSlotIds: [...SAFE_EXECUTION_FEATURE_SLOTS],
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream artifact boundaries without echoing local paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1184-unsafe-"));
    try {
      const files = await writeChainFixtures(tmp, {
        r1180: r1180WaitingFixture(),
        r1181: r1181WaitingFixture(),
        r1182: {
          ...r1182WaitingFixture(),
          artifactBoundary: {
            aggregateOnly: true,
            rowValuesStored: true,
          },
        },
        r1183: r1183ReadyForExplicitFixture(),
        fillable: safeResponseFixture(false),
      });

      await expect(runR1184AverageSubmitterSafeResponseChainStatus({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      })).rejects.toThrow("R1184 rejected unsafe r1182 safe response handoff: 1 finding");
      await expect(runR1184AverageSubmitterSafeResponseChainStatus({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      })).rejects.not.toThrow(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream privacy gates even when artifact boundary is clean", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1184-gate-"));
    try {
      const unsafeR1180 = r1180WaitingFixture();
      const summary = unsafeR1180.summary as Record<string, unknown>;
      summary.rowOwnerConfirmationInferredByR1180 = true;
      const files = await writeChainFixtures(tmp, {
        r1180: unsafeR1180,
        r1181: r1181WaitingFixture(),
        r1182: r1182WaitingFixture(),
        r1183: r1183ReadyForExplicitFixture(),
        fillable: safeResponseFixture(false),
      });

      await expect(runR1184AverageSubmitterSafeResponseChainStatus({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      })).rejects.toThrow("R1184 rejected unsafe r1180 safe confirmation response intake: 1 finding");
      await expect(runR1184AverageSubmitterSafeResponseChainStatus({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        ...files,
      })).rejects.not.toThrow(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("covers fallback routing when later safe-response stages are absent or stale", async () => {
    const cases: Array<{
      expectedConclusion: string;
      expectedNextAction: string;
      fixtures: Parameters<typeof writeChainFixtures>[1];
      name: string;
    }> = [
      {
        expectedConclusion: "average_submitter_safe_response_chain_waiting_on_r1181_feature_contract",
        expectedNextAction: "run_r1181_feature_only_execution_contract",
        fixtures: { r1180: r1180ReadyFixture() },
        name: "r1180 ready and r1181 missing",
      },
      {
        expectedConclusion: "average_submitter_safe_response_chain_waiting_on_r1183_refresh",
        expectedNextAction: "refresh_r1183_safe_response_materializer",
        fixtures: {
          r1180: r1180WaitingFixture(),
          r1181: r1181WaitingFixture(),
          r1182: r1182WaitingFixture(),
        },
        name: "r1182 waiting and r1183 missing",
      },
      {
        expectedConclusion: "average_submitter_safe_response_chain_waiting_on_r1182_handoff",
        expectedNextAction: "refresh_r1182_safe_response_handoff",
        fixtures: {
          r1180: r1180WaitingFixture(),
          r1181: r1181WaitingFixture(),
          r1182: r1182RefreshFixture(),
        },
        name: "r1182 present but not ready or waiting",
      },
      {
        expectedConclusion: "average_submitter_safe_response_chain_waiting_on_r1182_handoff",
        expectedNextAction: "refresh_r1182_safe_response_handoff",
        fixtures: {
          r1180: r1180WaitingFixture(),
          r1181: r1181WaitingFixture(),
        },
        name: "r1181 only",
      },
      {
        expectedConclusion: "average_submitter_safe_response_chain_waiting_on_r1181_feature_contract",
        expectedNextAction: "refresh_r1181_feature_only_execution_contract",
        fixtures: { r1180: r1180WaitingFixture() },
        name: "r1180 only",
      },
      {
        expectedConclusion: "average_submitter_safe_response_chain_waiting_on_r1180_response",
        expectedNextAction: "fill_r1180_safe_confirmation_response_template",
        fixtures: {},
        name: "no chain artifacts",
      },
    ];

    for (const item of cases) {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1184-fallback-"));
      try {
        const files = await writeChainFixtures(tmp, item.fixtures);
        const { output } = await runR1184AverageSubmitterSafeResponseChainStatus({
          createdAt: CREATED_AT,
          outputDir: path.join(tmp, "out"),
          ...files,
        });

        expect(output.summary, item.name).toMatchObject({
          conclusion: item.expectedConclusion,
          nextAction: item.expectedNextAction,
        });
        expect(JSON.stringify(output)).not.toContain(tmp);
        expect(findForbiddenAggregateEgress(output)).toEqual([]);
      } finally {
        await rm(tmp, { force: true, recursive: true });
      }
    }
  });

  it("prints a compact safe CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1184-cli-"));
    try {
      const files = await writeChainFixtures(tmp, {
        r1180: r1180WaitingFixture(),
        r1181: r1181WaitingFixture(),
        r1182: r1182WaitingFixture(),
        r1183: r1183ReadyForExplicitFixture(),
        fillable: safeResponseFixture(false),
      });
      const outDir = path.join(tmp, "out");

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1184-average-submitter-safe-response-chain-status.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1180_SAFE_CONFIRMATION_RESPONSE_INTAKE_PATH: files.r1180Path,
        MURPH_AGE_R1181_FEATURE_ONLY_EXECUTION_CONTRACT_PATH: files.r1181Path,
        MURPH_AGE_R1182_SAFE_RESPONSE_HANDOFF_PATH: files.r1182Path,
        MURPH_AGE_R1183_FILLABLE_SAFE_RESPONSE_PATH: files.fillableResponsePath,
        MURPH_AGE_R1183_SAFE_RESPONSE_MATERIALIZER_PATH: files.r1183Path,
        MURPH_AGE_R1184_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1184_OUTPUT_DIR: outDir,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      expect(result.stdout).not.toContain("confirmGlycemiaBloodworkExportAvailable");
      const parsed: unknown = JSON.parse(result.stdout);
      expect(parsed).toMatchObject({
        conclusion: "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
        fillableResponseArtifactPresent: true,
        nextAction: "rerun_r1183_with_row_owner_safe_response_assertion",
        packetId: "r1184-average-submitter-safe-response-chain-status",
        schemaVersion: R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION,
      });
      await expect(stat(path.join(outDir, "r1184-average-submitter-safe-response-chain-status.latest.json")))
        .resolves.toBeTruthy();
      const output = JSON.parse(
        await readFile(path.join(outDir, "r1184-average-submitter-safe-response-chain-status.latest.json"), "utf8"),
      ) as unknown;
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeChainFixtures(
  dir: string,
  fixtures: {
    confirmed?: Record<string, unknown>;
    fillable?: Record<string, unknown>;
    r1180?: Record<string, unknown>;
    r1181?: Record<string, unknown>;
    r1182?: Record<string, unknown>;
    r1183?: Record<string, unknown>;
  },
): Promise<{
  confirmedResponsePath: string;
  fillableResponsePath: string;
  r1180Path: string;
  r1181Path: string;
  r1182Path: string;
  r1183Path: string;
}> {
  const r1180Path = path.join(dir, "r1180.json");
  const r1181Path = path.join(dir, "r1181.json");
  const r1182Path = path.join(dir, "r1182.json");
  const r1183Path = path.join(dir, "r1183.json");
  const fillableResponsePath = path.join(dir, "r1183-fillable.json");
  const confirmedResponsePath = path.join(dir, "r1183-confirmed.json");
  await Promise.all([
    writeFixtureIfPresent(r1180Path, fixtures.r1180),
    writeFixtureIfPresent(r1181Path, fixtures.r1181),
    writeFixtureIfPresent(r1182Path, fixtures.r1182),
    writeFixtureIfPresent(r1183Path, fixtures.r1183),
    writeFixtureIfPresent(fillableResponsePath, fixtures.fillable),
    writeFixtureIfPresent(confirmedResponsePath, fixtures.confirmed),
  ]);
  return {
    confirmedResponsePath,
    fillableResponsePath,
    r1180Path,
    r1181Path,
    r1182Path,
    r1183Path,
  };
}

async function writeFixtureIfPresent(filePath: string, value: Record<string, unknown> | undefined): Promise<void> {
  if (value === undefined) return;
  await writeFile(filePath, `${JSON.stringify(value)}\n`);
}

function r1180WaitingFixture(): Record<string, unknown> {
  return r1180Fixture({
    conclusion: "safe_confirmation_response_intake_waiting_on_response",
    explicitRowOwnerSafeConfirmationProvided: false,
    featureOnlySafeConfirmationReady: false,
    nextAction: "fill_safe_confirmation_response_template",
    responseStatus: "missing",
  });
}

function r1180ReadyFixture(): Record<string, unknown> {
  return r1180Fixture({
    conclusion: "safe_confirmation_response_intake_ready_feature_only",
    explicitRowOwnerSafeConfirmationProvided: true,
    featureOnlySafeConfirmationReady: true,
    nextAction: "carry_safe_confirmation_to_feature_only_chain",
    responseStatus: "ready",
  });
}

function r1180Fixture(state: {
  conclusion: string;
  explicitRowOwnerSafeConfirmationProvided: boolean;
  featureOnlySafeConfirmationReady: boolean;
  nextAction: string;
  responseStatus: string;
}): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    inputArtifacts: {},
    packetId: "r1180-average-submitter-safe-confirmation-response-intake",
    productDisplayAuthorized: false,
    safeConfirmationResponseIntake: {},
    schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: ["booleans_only", "fixed_enumerated_ids_only"],
      askId: ASK_ID,
      blockedContentIds: [],
      conclusion: state.conclusion,
      explicitRowOwnerSafeConfirmationProvided: state.explicitRowOwnerSafeConfirmationProvided,
      featureOnlySafeConfirmationReady: state.featureOnlySafeConfirmationReady,
      invalidResponseReasonIds: [],
      minimumFeaturePairRequired: [...MINIMUM_PAIR],
      missingRequiredResponseFieldIds: state.responseStatus === "ready" ? [] : [...REQUIRED_RESPONSE_FIELDS],
      modelEvidencePromotionAllowed: false,
      nextAction: state.nextAction,
      nextActionCommand: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND,
      prioritizedInputKindIds: [...INPUT_KINDS],
      productDisplayAuthorized: false,
      requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS],
      requiredAssertionChecklistIds: [],
      responseKind: state.responseStatus === "ready" ? "explicit_yes_all_required_assertions_confirmed" : null,
      responseStatus: state.responseStatus,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1180: false,
      rowOwnerConfirmationInferredByR1180: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedPrivateValuesStored: false,
      rowOwnerProvidedSafeBooleansStored: false,
      rowParsingPerformedByR1180: false,
      safeCompletionChecklistItemIds: [],
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };
}

function r1181WaitingFixture(): Record<string, unknown> {
  return r1181Fixture({
    conclusion: "average_submitter_feature_only_execution_contract_waiting_on_safe_confirmation",
    explicitRowOwnerSafeConfirmationProvided: false,
    featureOnlyExecutionContractReady: false,
    featureOnlySafeConfirmationReady: false,
    nextAction: "fill_r1180_safe_confirmation_response_template",
    researchPlanningAllowed: false,
    safeExecutionFeatureSlotIds: null,
  });
}

function r1181ReadyFixture(): Record<string, unknown> {
  return r1181Fixture({
    conclusion: "average_submitter_feature_only_execution_contract_ready_research_only",
    explicitRowOwnerSafeConfirmationProvided: true,
    featureOnlyExecutionContractReady: true,
    featureOnlySafeConfirmationReady: true,
    nextAction: "use_feature_only_execution_contract_for_research_planning_only",
    researchPlanningAllowed: true,
    safeExecutionFeatureSlotIds: [...SAFE_EXECUTION_FEATURE_SLOTS],
  });
}

function r1181Fixture(state: {
  conclusion: string;
  explicitRowOwnerSafeConfirmationProvided: boolean;
  featureOnlyExecutionContractReady: boolean;
  featureOnlySafeConfirmationReady: boolean;
  nextAction: string;
  researchPlanningAllowed: boolean;
  safeExecutionFeatureSlotIds: string[] | null;
}): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    inputArtifacts: {},
    packetId: "r1181-average-submitter-feature-only-execution-contract",
    productDisplayAuthorized: false,
    schemaVersion: R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: state.conclusion,
      explicitRowOwnerSafeConfirmationProvided: state.explicitRowOwnerSafeConfirmationProvided,
      featureOnlyExecutionContractReady: state.featureOnlyExecutionContractReady,
      featureOnlySafeConfirmationReady: state.featureOnlySafeConfirmationReady,
      minimumFeaturePairRequired: [...MINIMUM_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction: state.nextAction,
      nextActionCommand: null,
      optionalContextFamilyIds: ["common_bloodwork_core", "vitals_body_context"],
      prioritizedInputKindIds: [...INPUT_KINDS],
      productDisplayAuthorized: false,
      researchPlanningAllowed: state.researchPlanningAllowed,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1181: false,
      rowOwnerConfirmationInferredByR1181: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1181: false,
      safeExecutionFeatureSlotIds: state.safeExecutionFeatureSlotIds,
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };
}

function r1182WaitingFixture(): Record<string, unknown> {
  return r1182Fixture({
    conclusion: "average_submitter_safe_response_handoff_waiting_on_row_owner_confirmation",
    explicitRowOwnerSafeConfirmationProvided: false,
    featureOnlyExecutionContractReady: false,
    handoffReadyForResearchPlanningOnly: false,
    nextAction: "fill_r1180_safe_confirmation_response_template",
    safeExecutionFeatureSlotIds: null,
  });
}

function r1182ReadyFixture(): Record<string, unknown> {
  return r1182Fixture({
    conclusion: "average_submitter_safe_response_handoff_ready_for_research_planning_only",
    explicitRowOwnerSafeConfirmationProvided: true,
    featureOnlyExecutionContractReady: true,
    handoffReadyForResearchPlanningOnly: true,
    nextAction: "use_r1181_feature_only_execution_contract_for_research_planning_only",
    safeExecutionFeatureSlotIds: [...SAFE_EXECUTION_FEATURE_SLOTS],
  });
}

function r1182RefreshFixture(): Record<string, unknown> {
  return r1182Fixture({
    conclusion: "average_submitter_safe_response_handoff_waiting_on_r1181_refresh",
    explicitRowOwnerSafeConfirmationProvided: false,
    featureOnlyExecutionContractReady: false,
    handoffReadyForResearchPlanningOnly: false,
    nextAction: "refresh_r1181_feature_only_execution_contract",
    safeExecutionFeatureSlotIds: null,
  });
}

function r1182Fixture(state: {
  conclusion: string;
  explicitRowOwnerSafeConfirmationProvided: boolean;
  featureOnlyExecutionContractReady: boolean;
  handoffReadyForResearchPlanningOnly: boolean;
  nextAction: string;
  safeExecutionFeatureSlotIds: string[] | null;
}): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    inputArtifacts: {},
    packetId: "r1182-average-submitter-safe-response-handoff",
    productDisplayAuthorized: false,
    schemaVersion: R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: state.conclusion,
      explicitRowOwnerSafeConfirmationProvided: state.explicitRowOwnerSafeConfirmationProvided,
      featureOnlyExecutionContractReady: state.featureOnlyExecutionContractReady,
      handoffReadyForResearchPlanningOnly: state.handoffReadyForResearchPlanningOnly,
      minimumFeaturePairRequired: [...MINIMUM_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction: state.nextAction,
      nextActionCommand: null,
      productDisplayAuthorized: false,
      requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS],
      responseTemplateSchemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1182: false,
      rowOwnerConfirmationInferredByR1182: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1182: false,
      safeExecutionFeatureSlotIds: state.safeExecutionFeatureSlotIds,
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
    materializer: {},
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
      responseSchemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
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

function safeResponseFixture(confirmed: boolean): Record<string, unknown> {
  return {
    askId: ASK_ID,
    confirmDailyWearableActivityExportAvailable: confirmed,
    confirmGlycemiaBloodworkExportAvailable: confirmed,
    confirmNoPrivateValuesIncluded: confirmed,
    confirmTargetAgeBandRoughly16To50: confirmed,
    responseKind: "explicit_yes_all_required_assertions_confirmed",
    schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
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
