import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";
import {
  R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION,
} from "./r1181-average-submitter-feature-only-execution-contract.ts";
import {
  R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
  runR1182AverageSubmitterSafeResponseHandoff,
} from "./r1182-average-submitter-safe-response-handoff.ts";

const CREATED_AT = "2026-05-18T23:55:00.000Z";
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
const SAFE_SLOT_IDS = [
  "glycemia_lab_presence",
  "glycemia_measurement_date_presence",
  "daily_activity_presence",
  "daily_wear_coverage_presence",
] as const;
const R1183_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts";

describe("R1182 average submitter safe response handoff", () => {
  it("emits the safe response template when R1181 is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1182-missing-"));
    try {
      const { output, outputPath } = await runR1182AverageSubmitterSafeResponseHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1181Path: path.join(tmp, "missing-r1181.json"),
      });

      expect(path.basename(outputPath)).toBe("r1182-average-submitter-safe-response-handoff.latest.json");
      expect(output.schemaVersion).toBe(R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION);
      expect(output.inputArtifacts.r1181FeatureOnlyExecutionContract).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_handoff_waiting_on_r1181_refresh",
        featureOnlyExecutionContractReady: false,
        handoffReadyForResearchPlanningOnly: false,
        minimumFeaturePairRequired: [...MINIMUM_PAIR],
        modelEvidencePromotionAllowed: false,
        nextAction: "refresh_r1181_feature_only_execution_contract",
        productDisplayAuthorized: false,
        requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS],
        responseTemplateSchemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1182: false,
        rowOwnerConfirmationInferredByR1182: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1182: false,
        sourcePriority: TARGET_INPUT_PRIORITY,
        targetAgeBand: TARGET_AGE_BAND,
      });
      expect(output.safeResponseHandoff.responseTemplate).toEqual({
        askId: "confirm_feature_only_lab_wearable_availability_without_private_values",
        confirmDailyWearableActivityExportAvailable: false,
        confirmGlycemiaBloodworkExportAvailable: false,
        confirmNoPrivateValuesIncluded: false,
        confirmTargetAgeBandRoughly16To50: false,
        responseKind: "explicit_yes_all_required_assertions_confirmed",
        schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
      });
      expect(output.safeResponseHandoff.prioritizedInputKindIds).toEqual([...INPUT_KINDS]);
      expect(output.r1181State).toMatchObject({
        r1181ModelEvidencePromotionAllowed: null,
        r1181RowOwnerPrivateValuesStored: null,
      });
      expect(JSON.stringify(output.r1181State)).not.toContain("\"modelEvidencePromotionAllowed\"");
      expect(JSON.stringify(output.r1181State)).not.toContain("\"rowOwnerPrivateValuesStored\"");
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a waiting R1181 contract to the row-owner safe confirmation response", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1182-waiting-"));
    try {
      const r1181Path = path.join(tmp, "r1181.json");
      await writeFile(r1181Path, `${JSON.stringify(r1181Fixture("waiting"))}\n`);

      const { output } = await runR1182AverageSubmitterSafeResponseHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1181Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_handoff_waiting_on_row_owner_confirmation",
        explicitRowOwnerSafeConfirmationProvided: false,
        featureOnlyExecutionContractReady: false,
        handoffReadyForResearchPlanningOnly: false,
        nextAction: "fill_r1180_safe_confirmation_response_template",
        nextActionCommand: R1183_COMMAND,
        safeExecutionFeatureSlotIds: null,
      });
      expect(output.r1181State).toMatchObject({
        contractConclusion: "average_submitter_feature_only_execution_contract_waiting_on_safe_confirmation",
        contractNextAction: "fill_r1180_safe_confirmation_response_template",
        featureOnlyExecutionContractReady: false,
        r1180ResponseStatus: "missing",
      });
      expect(output.safeResponseHandoff.requiredAssertionChecklistIds).toEqual([
        "assert_target_age_band_roughly_16_50",
        "assert_glycemia_bloodwork_export_available",
        "assert_daily_wearable_activity_export_available",
        "assert_no_private_values_identifiers_paths_headers_or_rows",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("opens only a research-planning handoff when R1181 is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1182-ready-"));
    try {
      const r1181Path = path.join(tmp, "r1181.json");
      await writeFile(r1181Path, `${JSON.stringify(r1181Fixture("ready"))}\n`);

      const { output } = await runR1182AverageSubmitterSafeResponseHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1181Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_handoff_ready_for_research_planning_only",
        explicitRowOwnerSafeConfirmationProvided: true,
        featureOnlyExecutionContractReady: true,
        handoffReadyForResearchPlanningOnly: true,
        nextAction: "use_r1181_feature_only_execution_contract_for_research_planning_only",
        nextActionCommand: null,
        productDisplayAuthorized: false,
        rowLevelDataAcceptedByR1182: false,
        rowOwnerConfirmationInferredByR1182: false,
        safeExecutionFeatureSlotIds: [...SAFE_SLOT_IDS],
      });
      expect(output.safeResponseHandoff.modelEvidencePromotionAllowed).toBe(false);
      expect(output.safeResponseHandoff.reviewGptRequiredNow).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes rejected R1181 evidence back through a valid R1180 response", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1182-rejected-"));
    try {
      const r1181Path = path.join(tmp, "r1181.json");
      await writeFile(r1181Path, `${JSON.stringify(r1181Fixture("rejected"))}\n`);

      const { output } = await runR1182AverageSubmitterSafeResponseHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1181Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_handoff_rejected_r1180_response_shape",
        featureOnlyExecutionContractReady: false,
        nextAction: "rerun_r1180_with_valid_safe_confirmation_response",
        nextActionCommand: "pnpm exec tsx scripts/murph-age/r1180-average-submitter-safe-confirmation-response-intake.ts",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo unrecognized R1181 response or slot strings", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1182-unrecognized-"));
    try {
      const r1181Path = path.join(tmp, "r1181.json");
      const unsafeValue = `unsafe-${path.basename(tmp)}`;
      await writeFile(r1181Path, `${JSON.stringify(r1181Fixture("ready", {
        responseStatus: unsafeValue,
        safeExecutionFeatureSlotIds: [...SAFE_SLOT_IDS, unsafeValue],
      }))}\n`);

      const { output } = await runR1182AverageSubmitterSafeResponseHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1181Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_handoff_waiting_on_r1181_refresh",
        featureOnlyExecutionContractReady: false,
        handoffReadyForResearchPlanningOnly: false,
        nextAction: "refresh_r1181_feature_only_execution_contract",
        safeExecutionFeatureSlotIds: null,
      });
      expect(output.r1181State).toMatchObject({
        r1180ResponseStatus: null,
        safeExecutionFeatureSlotIds: null,
      });
      expect(JSON.stringify(output)).not.toContain(unsafeValue);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not treat ReviewGPT-enabled R1181 output as execution-ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1182-reviewgpt-"));
    try {
      const r1181Path = path.join(tmp, "r1181.json");
      await writeFile(r1181Path, `${JSON.stringify(r1181Fixture("ready", { reviewGptRequiredNow: true }))}\n`);

      const { output } = await runR1182AverageSubmitterSafeResponseHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1181Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_handoff_waiting_on_r1181_refresh",
        featureOnlyExecutionContractReady: false,
        handoffReadyForResearchPlanningOnly: false,
        nextAction: "refresh_r1181_feature_only_execution_contract",
        safeExecutionFeatureSlotIds: null,
      });
      expect(output.r1181State.r1181ReviewGptRequiredNow).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe R1181 input without echoing a private-looking path", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1182-unsafe-"));
    try {
      const r1181Path = path.join(tmp, "r1181.json");
      await writeFile(r1181Path, `${JSON.stringify({
        ...r1181Fixture("waiting"),
        artifactBoundary: {
          aggregateOnly: true,
          rowValuesStored: true,
        },
      })}\n`);

      await expect(runR1182AverageSubmitterSafeResponseHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1181Path,
      })).rejects.toThrow("R1182 rejected unsafe r1181 feature-only execution contract: 1 finding");
      await expect(runR1182AverageSubmitterSafeResponseHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1181Path,
      })).rejects.not.toThrow(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact safe CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1182-cli-"));
    try {
      const r1181Path = path.join(tmp, "r1181.json");
      const outDir = path.join(tmp, "out");
      await mkdir(outDir, { recursive: true });
      await writeFile(r1181Path, `${JSON.stringify(r1181Fixture("ready"))}\n`);

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1182-average-submitter-safe-response-handoff.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1181_FEATURE_ONLY_EXECUTION_CONTRACT_PATH: r1181Path,
        MURPH_AGE_R1182_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1182_OUTPUT_DIR: outDir,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      expect(result.stdout).not.toContain("responseTemplate");
      const cli = JSON.parse(result.stdout) as {
        conclusion?: unknown;
        nextAction?: unknown;
        packetId?: unknown;
        schemaVersion?: unknown;
      };
      expect(cli).toMatchObject({
        conclusion: "average_submitter_safe_response_handoff_ready_for_research_planning_only",
        nextAction: "use_r1181_feature_only_execution_contract_for_research_planning_only",
        packetId: "r1182-average-submitter-safe-response-handoff",
        schemaVersion: R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
      });
      await expect(stat(path.join(outDir, "r1182-average-submitter-safe-response-handoff.latest.json")))
        .resolves.toBeTruthy();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1181Fixture(
  state: "ready" | "rejected" | "waiting",
  options: {
    responseStatus?: unknown;
    reviewGptRequiredNow?: boolean;
    safeExecutionFeatureSlotIds?: unknown[];
  } = {},
): Record<string, unknown> {
  const ready = state === "ready";
  const rejected = state === "rejected";
  const reviewGptRequiredNow = options.reviewGptRequiredNow ?? false;
  const conclusion = ready
    ? "average_submitter_feature_only_execution_contract_ready_research_only"
    : rejected
      ? "average_submitter_feature_only_execution_contract_rejected_r1180_response_shape"
      : "average_submitter_feature_only_execution_contract_waiting_on_safe_confirmation";
  const nextAction = ready
    ? "use_feature_only_execution_contract_for_research_planning_only"
    : rejected
      ? "rerun_r1180_with_valid_safe_confirmation_response"
      : "fill_r1180_safe_confirmation_response_template";
  const nextActionCommand = ready
    ? null
    : rejected
      ? "pnpm exec tsx scripts/murph-age/r1180-average-submitter-safe-confirmation-response-intake.ts"
      : R1183_COMMAND;

  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    featureOnlyExecutionContract: {
      blockedContentIds: [
        "private_paths",
        "header_names",
        "file_names",
        "row_values",
        "participant_identifiers",
        "private_ref_values",
        "source_variable_names",
        "predictions",
        "coefficients",
        "model_parameters",
        "source_text",
        "small_cells",
      ],
      executionFeatureSlots: SAFE_SLOT_IDS.map((safeSlotId) => ({ safeSlotId })),
      featureOnlyExecutionContractReady: ready,
      minimumFeaturePairRequired: [...MINIMUM_PAIR],
      modelEvidencePromotionAllowed: false,
      prioritizedInputKindIds: [...INPUT_KINDS],
      productDisplayAuthorized: false,
      researchPlanningAllowed: ready,
      reviewGptRequiredNow,
      rowLevelDataAcceptedByR1181: false,
      rowOwnerConfirmationInferredByR1181: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1181: false,
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
    inputArtifacts: {
      r1180SafeConfirmationResponseIntake: {
        artifact: "r1180-average-submitter-safe-confirmation-response-intake.latest.json",
        packetId: "r1180-average-submitter-safe-confirmation-response-intake",
        schemaVersion: "murph-age-r1180-average-submitter-safe-confirmation-response-intake.v1",
        status: "available",
      },
    },
    packetId: "r1181-average-submitter-feature-only-execution-contract",
    productDisplayAuthorized: false,
    r1180State: {
      responseStatus: options.responseStatus ?? (ready ? "ready" : rejected ? "invalid" : "missing"),
    },
    schemaVersion: R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      explicitRowOwnerSafeConfirmationProvided: ready,
      featureOnlyExecutionContractReady: ready,
      featureOnlySafeConfirmationReady: ready,
      minimumFeaturePairRequired: [...MINIMUM_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction,
      nextActionCommand,
      prioritizedInputKindIds: [...INPUT_KINDS],
      productDisplayAuthorized: false,
      researchPlanningAllowed: ready,
      reviewGptRequiredNow,
      rowLevelDataAcceptedByR1181: false,
      rowOwnerConfirmationInferredByR1181: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1181: false,
      safeExecutionFeatureSlotIds: options.safeExecutionFeatureSlotIds ?? [...SAFE_SLOT_IDS],
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };
}

async function execFilePromise(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error("command failed"));
        return;
      }
      resolve({ stderr, stdout });
    });
  });
}
