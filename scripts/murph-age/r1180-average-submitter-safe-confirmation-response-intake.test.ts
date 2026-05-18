import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION,
} from "./r1179-average-submitter-objective-gap-audit.ts";
import {
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION,
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
  runR1180AverageSubmitterSafeConfirmationResponseIntake,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";

const CREATED_AT = "2026-05-18T22:20:00.000Z";
const ASK_ID = "confirm_feature_only_lab_wearable_availability_without_private_values";
const MINIMUM_FEATURE_PAIR = ["bloodwork_glycemia", "wearable_activity_daily"] as const;
const REQUIRED_INPUT_KINDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const REQUIRED_RESPONSE_FIELDS = [
  "confirm_target_age_band_roughly_16_50",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;

describe("R1180 average submitter safe confirmation response intake", () => {
  it("emits a safe fillable response template while waiting on row-owner confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1180-missing-"));
    try {
      const r1179Path = path.join(tmp, "r1179.json");
      await writeFile(r1179Path, `${JSON.stringify(r1179Fixture())}\n`);

      const { output, outputPath } = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1179Path,
      });

      expect(path.basename(outputPath)).toBe("r1180-average-submitter-safe-confirmation-response-intake.latest.json");
      expect(output.schemaVersion).toBe(R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        askId: ASK_ID,
        conclusion: "safe_confirmation_response_intake_waiting_on_response",
        explicitRowOwnerSafeConfirmationProvided: false,
        featureOnlySafeConfirmationReady: false,
        invalidResponseReasonIds: [],
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        missingRequiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS],
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_safe_confirmation_response_template",
        nextActionCommand: null,
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
        productDisplayAuthorized: false,
        responseKind: null,
        responseStatus: "missing",
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1180: false,
        rowOwnerConfirmationInferredByR1180: false,
        rowOwnerPrivateValuesStored: false,
        rowOwnerProvidedPrivateValuesStored: false,
        rowOwnerProvidedSafeBooleansStored: false,
        rowParsingPerformedByR1180: false,
      });
      expect(output.safeConfirmationResponseIntake.responseTemplate).toMatchObject({
        askId: ASK_ID,
        confirmDailyWearableActivityExportAvailable: false,
        confirmGlycemiaBloodworkExportAvailable: false,
        confirmNoPrivateValuesIncluded: false,
        confirmTargetAgeBandRoughly16To50: false,
        responseKind: "explicit_yes_all_required_assertions_confirmed",
        schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
      });
      const filledTemplatePath = path.join(tmp, "filled-template.json");
      await writeFile(filledTemplatePath, `${JSON.stringify({
        ...output.safeConfirmationResponseIntake.responseTemplate,
        confirmDailyWearableActivityExportAvailable: true,
        confirmGlycemiaBloodworkExportAvailable: true,
        confirmNoPrivateValuesIncluded: true,
        confirmTargetAgeBandRoughly16To50: true,
      })}\n`);
      const filledTemplateResult = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "filled-out"),
        r1179Path,
        responsePath: filledTemplatePath,
      });
      expect(filledTemplateResult.output.summary).toMatchObject({
        featureOnlySafeConfirmationReady: true,
        responseStatus: "ready",
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks feature-only confirmation ready only for the exact all-true safe response", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1180-ready-"));
    try {
      const r1179Path = path.join(tmp, "r1179.json");
      const responsePath = path.join(tmp, "response.json");
      await writeFile(r1179Path, `${JSON.stringify(r1179Fixture())}\n`);
      await writeFile(responsePath, `${JSON.stringify(readyResponse())}\n`);

      const { output } = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1179Path,
        responsePath,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_confirmation_response_intake_ready_feature_only",
        explicitRowOwnerSafeConfirmationProvided: true,
        featureOnlySafeConfirmationReady: true,
        invalidResponseReasonIds: [],
        missingRequiredResponseFieldIds: [],
        modelEvidencePromotionAllowed: false,
        nextAction: "carry_safe_confirmation_to_feature_only_chain",
        productDisplayAuthorized: false,
        responseKind: "explicit_yes_all_required_assertions_confirmed",
        responseStatus: "ready",
        rowOwnerConfirmationInferredByR1180: false,
        rowOwnerPrivateValuesStored: false,
        rowOwnerProvidedPrivateValuesStored: false,
        rowOwnerProvidedSafeBooleansStored: false,
        rowParsingPerformedByR1180: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps a partial safe response incomplete without treating it as evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1180-incomplete-"));
    try {
      const r1179Path = path.join(tmp, "r1179.json");
      const responsePath = path.join(tmp, "response.json");
      await writeFile(r1179Path, `${JSON.stringify(r1179Fixture())}\n`);
      await writeFile(responsePath, `${JSON.stringify({
        ...readyResponse(),
        confirmDailyWearableActivityExportAvailable: false,
      })}\n`);

      const { output } = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1179Path,
        responsePath,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_confirmation_response_intake_waiting_on_response",
        explicitRowOwnerSafeConfirmationProvided: false,
        featureOnlySafeConfirmationReady: false,
        missingRequiredResponseFieldIds: ["confirm_daily_wearable_activity_export_available"],
        nextAction: "fill_safe_confirmation_response_template",
        responseStatus: "incomplete",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unexpected response keys without echoing private-looking content", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1180-private-extra-"));
    try {
      const r1179Path = path.join(tmp, "r1179.json");
      const responsePath = path.join(tmp, "response.json");
      await writeFile(r1179Path, `${JSON.stringify(r1179Fixture())}\n`);
      await writeFile(responsePath, `${JSON.stringify({
        ...readyResponse(),
        privatePath: `${tmp}/secret.csv`,
      })}\n`);

      const { output } = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1179Path,
        responsePath,
      });

      const serialized = JSON.stringify(output);
      expect(output.summary).toMatchObject({
        conclusion: "safe_confirmation_response_intake_rejected_response_shape",
        featureOnlySafeConfirmationReady: false,
        invalidResponseReasonIds: ["unexpected_keys"],
        nextAction: "rerun_safe_confirmation_response_with_valid_json_object",
        responseStatus: "invalid",
      });
      expect(serialized).not.toContain("privatePath");
      expect(serialized).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects malformed allowed response fields without echoing their private-looking values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1180-invalid-allowed-"));
    try {
      const r1179Path = path.join(tmp, "r1179.json");
      const responsePath = path.join(tmp, "response.json");
      await writeFile(r1179Path, `${JSON.stringify(r1179Fixture())}\n`);
      await writeFile(responsePath, `${JSON.stringify({
        ...readyResponse(),
        askId: "wrong-ask",
        confirmNoPrivateValuesIncluded: `${tmp}/rows.csv`,
        responseKind: "send_private_rows",
        schemaVersion: "wrong-schema",
      })}\n`);

      const { output } = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1179Path,
        responsePath,
      });

      const serialized = JSON.stringify(output);
      expect(output.summary).toMatchObject({
        conclusion: "safe_confirmation_response_intake_rejected_response_shape",
        featureOnlySafeConfirmationReady: false,
        invalidResponseReasonIds: [
          "schema_version_mismatch",
          "ask_id_mismatch",
          "unsupported_response_kind",
          "non_boolean_required_field",
        ],
        missingRequiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS],
        nextAction: "rerun_safe_confirmation_response_with_valid_json_object",
        responseKind: null,
        responseStatus: "invalid",
      });
      expect(output.inputArtifacts.safeConfirmationResponse).toMatchObject({
        schemaVersion: null,
        status: "available",
      });
      expect(serialized).not.toContain("rows.csv");
      expect(serialized).not.toContain(tmp);
      expect(serialized).not.toContain("send_private_rows");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes stale R1179 ask evidence to a safe refresh", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1180-stale-r1179-"));
    try {
      const r1179Path = path.join(tmp, "r1179.json");
      await writeFile(r1179Path, `${JSON.stringify({
        ...r1179Fixture(),
        schemaVersion: "stale-schema",
      })}\n`);

      const { output } = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1179Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_confirmation_response_intake_waiting_on_r1179_ask",
        featureOnlySafeConfirmationReady: false,
        nextAction: "refresh_r1179_safe_confirmation_ask",
        responseStatus: "missing",
      });
      expect(output.summary.nextActionCommand).toBe(
        "pnpm exec tsx scripts/murph-age/r1179-average-submitter-objective-gap-audit.ts",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a minimal safe CLI summary without leaking paths or the template", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1180-cli-"));
    try {
      const r1179Path = path.join(tmp, "r1179.json");
      const responsePath = path.join(tmp, "response.json");
      const outDir = path.join(tmp, "out");
      await writeFile(r1179Path, `${JSON.stringify(r1179Fixture())}\n`);
      await writeFile(responsePath, `${JSON.stringify(readyResponse())}\n`);

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1180-average-submitter-safe-confirmation-response-intake.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1179_OBJECTIVE_GAP_AUDIT_PATH: r1179Path,
        MURPH_AGE_R1180_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1180_OUTPUT_DIR: outDir,
        MURPH_AGE_R1180_SAFE_CONFIRMATION_RESPONSE_PATH: responsePath,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      expect(result.stdout).not.toContain("confirmDailyWearableActivityExportAvailable");
      const cli = JSON.parse(result.stdout) as {
        askId?: unknown;
        featureOnlySafeConfirmationReady?: unknown;
        packetId?: unknown;
        responseTemplate?: unknown;
        responseStatus?: unknown;
      };
      expect(cli).toMatchObject({
        askId: ASK_ID,
        featureOnlySafeConfirmationReady: true,
        packetId: "r1180-average-submitter-safe-confirmation-response-intake",
        responseStatus: "ready",
      });
      expect(cli.responseTemplate).toBeUndefined();
      await expect(stat(path.join(outDir, "r1180-average-submitter-safe-confirmation-response-intake.latest.json")))
        .resolves.toBeTruthy();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1179Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      productDisplayAuthorized: false,
    },
    packetId: "r1179-average-submitter-objective-gap-audit",
    productDisplayAuthorized: false,
    schemaVersion: R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      rowOwnerSafeConfirmationAsk: {
        askId: ASK_ID,
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        modelEvidencePromotionAllowed: false,
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
        productDisplayAuthorized: false,
        requiredAssertionChecklistIds: [
          "assert_target_age_band_roughly_16_50",
          "assert_glycemia_bloodwork_export_available",
          "assert_daily_wearable_activity_export_available",
          "assert_no_private_values_identifiers_paths_headers_or_rows",
        ],
        rowLevelDataAcceptedByR1179: false,
        rowOwnerConfirmationInferredByR1179: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1179: false,
      },
      sourcePriority: "consumer_bloodwork_labs_wearables_16_50_first",
      targetAgeBand: "roughly_16_50",
    },
  };
}

function readyResponse(): Record<string, unknown> {
  return {
    askId: ASK_ID,
    confirmDailyWearableActivityExportAvailable: true,
    confirmGlycemiaBloodworkExportAvailable: true,
    confirmNoPrivateValuesIncluded: true,
    confirmTargetAgeBandRoughly16To50: true,
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
      if (error) {
        reject(error);
        return;
      }
      resolve({ stderr, stdout });
    });
  });
}
