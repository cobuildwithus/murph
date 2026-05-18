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
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
  runR1180AverageSubmitterSafeConfirmationResponseIntake,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";
import {
  R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
} from "./r1182-average-submitter-safe-response-handoff.ts";
import {
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
  runR1183AverageSubmitterSafeResponseMaterializer,
} from "./r1183-average-submitter-safe-response-materializer.ts";

const CREATED_AT = "2026-05-19T00:40:00.000Z";
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
const REQUIRED_ASSERTIONS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
] as const;
const SAFE_COMPLETION_ITEMS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;

describe("R1183 average submitter safe response materializer", () => {
  it("writes a fillable response template while waiting on explicit row-owner assertion", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1183-fillable-"));
    try {
      const r1182Path = path.join(tmp, "r1182.json");
      await writeFile(r1182Path, `${JSON.stringify(r1182Fixture())}\n`);

      const { confirmedResponsePath, fillableResponsePath, output, outputPath } =
        await runR1183AverageSubmitterSafeResponseMaterializer({
          createdAt: CREATED_AT,
          outputDir: path.join(tmp, "out"),
          r1182Path,
        });

      expect(path.basename(outputPath)).toBe("r1183-average-submitter-safe-response-materializer.latest.json");
      expect(output.schemaVersion).toBe(R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION);
      expect(confirmedResponsePath).toBeNull();
      expect(fillableResponsePath).not.toBeNull();
      await expect(stat(fillableResponsePath ?? "")).resolves.toBeTruthy();
      const fillable = await readJsonObject(fillableResponsePath ?? "");
      expect(fillable).toEqual({
        askId: ASK_ID,
        confirmDailyWearableActivityExportAvailable: false,
        confirmGlycemiaBloodworkExportAvailable: false,
        confirmNoPrivateValuesIncluded: false,
        confirmTargetAgeBandRoughly16To50: false,
        responseKind: "explicit_yes_all_required_assertions_confirmed",
        schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
      });
      expect(output.summary).toMatchObject({
        confirmedResponseArtifact: null,
        confirmedResponseArtifactWritten: false,
        conclusion: "average_submitter_safe_response_materializer_ready_for_explicit_confirmation",
        explicitRowOwnerSafeResponseAssertionProvided: false,
        fillableResponseArtifact: "r1183-fillable-average-submitter-safe-confirmation-response.json",
        fillableResponseArtifactWritten: true,
        materializerReadyForRowOwnerConfirmation: true,
        minimumFeaturePairRequired: [...MINIMUM_PAIR],
        nextAction: "rerun_r1183_with_row_owner_safe_response_assertion",
        requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS],
        rowOwnerSafeResponseAssertionStillRequired: true,
      });
      expect(output.materializer).toMatchObject({
        modelEvidencePromotionAllowed: false,
        productDisplayAuthorized: false,
        responseSchemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
        rowLevelDataAcceptedByR1183: false,
        rowOwnerConfirmationInferredByR1183: false,
        rowOwnerPrivateValuesStored: false,
        rowOwnerSafeResponseValuesStoredInR1183Packet: false,
        rowParsingPerformedByR1183: false,
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(fillable)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("writes a confirmed response only after explicit row-owner assertion and R1180 accepts it", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1183-confirmed-"));
    try {
      const r1179Path = path.join(tmp, "r1179.json");
      const r1182Path = path.join(tmp, "r1182.json");
      await writeFile(r1179Path, `${JSON.stringify(r1179Fixture())}\n`);
      await writeFile(r1182Path, `${JSON.stringify(r1182Fixture())}\n`);

      const { confirmedResponsePath, fillableResponsePath, output } =
        await runR1183AverageSubmitterSafeResponseMaterializer({
          createdAt: CREATED_AT,
          outputDir: path.join(tmp, "out"),
          r1182Path,
          rowOwnerSafeResponseAssertionsConfirmed: true,
        });

      expect(fillableResponsePath).not.toBeNull();
      expect(confirmedResponsePath).not.toBeNull();
      const confirmed = await readJsonObject(confirmedResponsePath ?? "");
      expect(confirmed).toEqual({
        askId: ASK_ID,
        confirmDailyWearableActivityExportAvailable: true,
        confirmGlycemiaBloodworkExportAvailable: true,
        confirmNoPrivateValuesIncluded: true,
        confirmTargetAgeBandRoughly16To50: true,
        responseKind: "explicit_yes_all_required_assertions_confirmed",
        schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
      });
      expect(output.summary).toMatchObject({
        confirmedResponseArtifact: "r1183-confirmed-average-submitter-safe-confirmation-response.json",
        confirmedResponseArtifactWritten: true,
        conclusion: "average_submitter_safe_response_materializer_confirmed_response_written",
        explicitRowOwnerSafeResponseAssertionProvided: true,
        nextAction: "run_r1180_with_confirmed_average_submitter_safe_response",
        rowOwnerSafeResponseAssertionStillRequired: false,
      });

      const r1180 = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "r1180-out"),
        r1179Path,
        responsePath: confirmedResponsePath ?? "",
      });
      expect(r1180.output.summary).toMatchObject({
        conclusion: "safe_confirmation_response_intake_ready_feature_only",
        explicitRowOwnerSafeConfirmationProvided: true,
        featureOnlySafeConfirmationReady: true,
        responseStatus: "ready",
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(confirmed)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits on R1182 when the handoff is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1183-missing-"));
    try {
      const { confirmedResponsePath, fillableResponsePath, output } =
        await runR1183AverageSubmitterSafeResponseMaterializer({
          createdAt: CREATED_AT,
          outputDir: path.join(tmp, "out"),
          r1182Path: path.join(tmp, "missing-r1182.json"),
        });

      expect(confirmedResponsePath).toBeNull();
      expect(fillableResponsePath).toBeNull();
      expect(output.inputArtifacts.r1182SafeResponseHandoff).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_materializer_waiting_on_r1182_handoff",
        fillableResponseArtifactWritten: false,
        materializerReadyForRowOwnerConfirmation: false,
        nextAction: "refresh_r1182_safe_response_handoff",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo unrecognized upstream strings", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1183-unrecognized-"));
    try {
      const r1182Path = path.join(tmp, "r1182.json");
      const unsafeValue = `unsafe-${path.basename(tmp)}`;
      await writeFile(r1182Path, `${JSON.stringify(r1182Fixture({
        conclusion: unsafeValue,
        nextAction: unsafeValue,
        requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS, unsafeValue],
      }))}\n`);

      const { output } = await runR1183AverageSubmitterSafeResponseMaterializer({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1182Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_materializer_waiting_on_r1182_handoff",
        fillableResponseArtifactWritten: false,
        nextAction: "refresh_r1182_safe_response_handoff",
      });
      expect(output.r1182State).toMatchObject({
        handoffConclusion: null,
        handoffNextAction: null,
        requiredResponseFieldsMatch: false,
      });
      expect(JSON.stringify(output)).not.toContain(unsafeValue);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe R1182 input without echoing a private-looking path", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1183-unsafe-"));
    try {
      const r1182Path = path.join(tmp, "r1182.json");
      await writeFile(r1182Path, `${JSON.stringify({
        ...r1182Fixture(),
        artifactBoundary: {
          aggregateOnly: true,
          rowValuesStored: true,
        },
      })}\n`);

      await expect(runR1183AverageSubmitterSafeResponseMaterializer({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1182Path,
      })).rejects.toThrow("R1183 rejected unsafe r1182 safe response handoff: 1 finding");
      await expect(runR1183AverageSubmitterSafeResponseMaterializer({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1182Path,
      })).rejects.not.toThrow(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact safe CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1183-cli-"));
    try {
      const r1182Path = path.join(tmp, "r1182.json");
      const outDir = path.join(tmp, "out");
      await writeFile(r1182Path, `${JSON.stringify(r1182Fixture())}\n`);

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1182_SAFE_RESPONSE_HANDOFF_PATH: r1182Path,
        MURPH_AGE_R1183_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1183_OUTPUT_DIR: outDir,
        MURPH_AGE_R1183_ROW_OWNER_SAFE_RESPONSE_ASSERTIONS_CONFIRMED: "true",
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      expect(result.stdout).not.toContain("confirmGlycemiaBloodworkExportAvailable");
      const cli = JSON.parse(result.stdout) as {
        confirmedResponseArtifact?: unknown;
        confirmedResponseArtifactWritten?: unknown;
        conclusion?: unknown;
        fillableResponseArtifact?: unknown;
        packetId?: unknown;
        schemaVersion?: unknown;
      };
      expect(cli).toMatchObject({
        confirmedResponseArtifact: "r1183-confirmed-average-submitter-safe-confirmation-response.json",
        confirmedResponseArtifactWritten: true,
        conclusion: "average_submitter_safe_response_materializer_confirmed_response_written",
        fillableResponseArtifact: "r1183-fillable-average-submitter-safe-confirmation-response.json",
        packetId: "r1183-average-submitter-safe-response-materializer",
        schemaVersion: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
      });
      await expect(stat(path.join(outDir, "r1183-average-submitter-safe-response-materializer.latest.json")))
        .resolves.toBeTruthy();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not write a confirmed response during the default CLI run", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1183-cli-default-"));
    try {
      const r1182Path = path.join(tmp, "r1182.json");
      const outDir = path.join(tmp, "out");
      await writeFile(r1182Path, `${JSON.stringify(r1182Fixture())}\n`);

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1182_SAFE_RESPONSE_HANDOFF_PATH: r1182Path,
        MURPH_AGE_R1183_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1183_OUTPUT_DIR: outDir,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      const cli = JSON.parse(result.stdout) as {
        confirmedResponseArtifact?: unknown;
        confirmedResponseArtifactWritten?: unknown;
        conclusion?: unknown;
        explicitRowOwnerSafeResponseAssertionProvided?: unknown;
        fillableResponseArtifact?: unknown;
        fillableResponseArtifactWritten?: unknown;
        nextAction?: unknown;
      };
      expect(cli).toMatchObject({
        confirmedResponseArtifact: null,
        confirmedResponseArtifactWritten: false,
        conclusion: "average_submitter_safe_response_materializer_ready_for_explicit_confirmation",
        explicitRowOwnerSafeResponseAssertionProvided: false,
        fillableResponseArtifact: "r1183-fillable-average-submitter-safe-confirmation-response.json",
        fillableResponseArtifactWritten: true,
        nextAction: "rerun_r1183_with_row_owner_safe_response_assertion",
      });
      await expect(stat(path.join(outDir, "r1183-fillable-average-submitter-safe-confirmation-response.json")))
        .resolves.toBeTruthy();
      await expect(stat(path.join(outDir, "r1183-confirmed-average-submitter-safe-confirmation-response.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("removes a stale confirmed response on a later non-explicit run", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1183-stale-confirmed-"));
    try {
      const r1182Path = path.join(tmp, "r1182.json");
      const outDir = path.join(tmp, "out");
      await writeFile(r1182Path, `${JSON.stringify(r1182Fixture())}\n`);

      await runR1183AverageSubmitterSafeResponseMaterializer({
        createdAt: CREATED_AT,
        outputDir: outDir,
        r1182Path,
        rowOwnerSafeResponseAssertionsConfirmed: true,
      });
      const confirmedPath = path.join(outDir, "r1183-confirmed-average-submitter-safe-confirmation-response.json");
      await expect(stat(confirmedPath)).resolves.toBeTruthy();

      const { output } = await runR1183AverageSubmitterSafeResponseMaterializer({
        createdAt: CREATED_AT,
        outputDir: outDir,
        r1182Path,
      });

      expect(output.summary).toMatchObject({
        confirmedResponseArtifact: null,
        confirmedResponseArtifactWritten: false,
        conclusion: "average_submitter_safe_response_materializer_ready_for_explicit_confirmation",
        fillableResponseArtifactWritten: true,
      });
      await expect(stat(path.join(outDir, "r1183-fillable-average-submitter-safe-confirmation-response.json")))
        .resolves.toBeTruthy();
      await expect(stat(confirmedPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1182Fixture(overrides: {
  conclusion?: unknown;
  nextAction?: unknown;
  requiredResponseFieldIds?: unknown[];
} = {}): Record<string, unknown> {
  return {
    artifactBoundary: { aggregateOnly: true },
    createdAt: CREATED_AT,
    inputArtifacts: {
      r1181FeatureOnlyExecutionContract: {
        artifact: "r1181-average-submitter-feature-only-execution-contract.latest.json",
        packetId: "r1181-average-submitter-feature-only-execution-contract",
        schemaVersion: "murph-age-r1181-average-submitter-feature-only-execution-contract.v1",
        status: "available",
      },
    },
    packetId: "r1182-average-submitter-safe-response-handoff",
    productDisplayAuthorized: false,
    r1181State: {},
    safeResponseHandoff: {
      allowedValueKindIds: [
        "booleans_only",
        "fixed_enumerated_ids_only",
      ],
      askId: ASK_ID,
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
      minimumFeaturePairRequired: [...MINIMUM_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction: overrides.nextAction ?? "fill_r1180_safe_confirmation_response_template",
      nextActionCommand: "pnpm exec tsx scripts/murph-age/r1180-average-submitter-safe-confirmation-response-intake.ts",
      prioritizedInputKindIds: [...INPUT_KINDS],
      productDisplayAuthorized: false,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTIONS],
      requiredResponseFieldIds: overrides.requiredResponseFieldIds ?? [...REQUIRED_RESPONSE_FIELDS],
      responseKindIds: [
        "explicit_yes_all_required_assertions_confirmed",
        "not_confirmed_or_unsure",
      ],
      responseTemplate: {
        askId: ASK_ID,
        confirmDailyWearableActivityExportAvailable: false,
        confirmGlycemiaBloodworkExportAvailable: false,
        confirmNoPrivateValuesIncluded: false,
        confirmTargetAgeBandRoughly16To50: false,
        responseKind: "explicit_yes_all_required_assertions_confirmed",
        schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
      },
      responseTemplateKeyOrder: [
        "askId",
        "confirmDailyWearableActivityExportAvailable",
        "confirmGlycemiaBloodworkExportAvailable",
        "confirmNoPrivateValuesIncluded",
        "confirmTargetAgeBandRoughly16To50",
        "responseKind",
        "schemaVersion",
      ],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1182: false,
      rowOwnerConfirmationInferredByR1182: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1182: false,
      safeCompletionChecklistItemIds: [...SAFE_COMPLETION_ITEMS],
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
    schemaVersion: R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: overrides.conclusion ?? "average_submitter_safe_response_handoff_waiting_on_row_owner_confirmation",
      explicitRowOwnerSafeConfirmationProvided: false,
      featureOnlyExecutionContractReady: false,
      handoffReadyForResearchPlanningOnly: false,
      minimumFeaturePairRequired: [...MINIMUM_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction: overrides.nextAction ?? "fill_r1180_safe_confirmation_response_template",
      nextActionCommand: "pnpm exec tsx scripts/murph-age/r1180-average-submitter-safe-confirmation-response-intake.ts",
      productDisplayAuthorized: false,
      requiredResponseFieldIds: overrides.requiredResponseFieldIds ?? [...REQUIRED_RESPONSE_FIELDS],
      responseTemplateSchemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1182: false,
      rowOwnerConfirmationInferredByR1182: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1182: false,
      safeExecutionFeatureSlotIds: null,
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };
}

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
        minimumFeaturePairRequired: [...MINIMUM_PAIR],
        modelEvidencePromotionAllowed: false,
        prioritizedInputKindIds: [...INPUT_KINDS],
        productDisplayAuthorized: false,
        requiredAssertionChecklistIds: [...REQUIRED_ASSERTIONS],
        rowLevelDataAcceptedByR1179: false,
        rowOwnerConfirmationInferredByR1179: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1179: false,
      },
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

function execFilePromise(
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
