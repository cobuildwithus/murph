import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION,
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";
import {
  R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION,
  runR1181AverageSubmitterFeatureOnlyExecutionContract,
} from "./r1181-average-submitter-feature-only-execution-contract.ts";

const CREATED_AT = "2026-05-18T23:40:00.000Z";
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

describe("R1181 average submitter feature-only execution contract", () => {
  it("waits on R1180 when the safe response intake is still missing confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-waiting-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      await writeFile(r1180Path, `${JSON.stringify(r1180Fixture({ responseStatus: "missing" }))}\n`);

      const { output, outputPath } = await runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      });

      expect(path.basename(outputPath)).toBe("r1181-average-submitter-feature-only-execution-contract.latest.json");
      expect(output.schemaVersion).toBe(R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_feature_only_execution_contract_waiting_on_safe_confirmation",
        featureOnlyExecutionContractReady: false,
        featureOnlySafeConfirmationReady: false,
        minimumFeaturePairRequired: [...MINIMUM_PAIR],
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_r1180_safe_confirmation_response_template",
        prioritizedInputKindIds: [...INPUT_KINDS],
        productDisplayAuthorized: false,
        researchPlanningAllowed: false,
        rowLevelDataAcceptedByR1181: false,
        rowOwnerConfirmationInferredByR1181: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1181: false,
        sourcePriority: TARGET_INPUT_PRIORITY,
        targetAgeBand: TARGET_AGE_BAND,
      });
      expect(output.featureOnlyExecutionContract).toMatchObject({
        evidenceUse: "research_planning_only_not_model_evidence",
        executionRole: "feature_only_research_planning_not_model_evidence",
        featureOnlyExecutionContractReady: false,
        outcomeLinkedModelEvidenceStillRequired: true,
        requiredR1180SafeResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS],
      });
      expect(output.featureOnlyExecutionContract.executionFeatureSlots).toHaveLength(4);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("opens the research-only feature contract only when R1180 has exact explicit safe confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-ready-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      await writeFile(r1180Path, `${JSON.stringify(r1180Fixture({ responseStatus: "ready" }))}\n`);

      const { output } = await runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_feature_only_execution_contract_ready_research_only",
        explicitRowOwnerSafeConfirmationProvided: true,
        featureOnlyExecutionContractReady: true,
        featureOnlySafeConfirmationReady: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "use_feature_only_execution_contract_for_research_planning_only",
        nextActionCommand: null,
        productDisplayAuthorized: false,
        researchPlanningAllowed: true,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1181: false,
        rowOwnerConfirmationInferredByR1181: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1181: false,
        safeExecutionFeatureSlotIds: [
          "glycemia_lab_presence",
          "glycemia_measurement_date_presence",
          "daily_activity_presence",
          "daily_wear_coverage_presence",
        ],
      });
      expect(output.r1180State).toMatchObject({
        artifactBoundaryAggregateOnly: true,
        artifactBoundaryUnsafeTrueFlagFound: false,
        modelEvidencePromotionAllowed: false,
        packetId: "r1180-average-submitter-safe-confirmation-response-intake",
        productDisplayAuthorized: false,
        r1180Conclusion: "safe_confirmation_response_intake_ready_feature_only",
        r1180Status: "research-local-aggregate-only",
        responseArtifactStatus: "available",
        responseKind: "explicit_yes_all_required_assertions_confirmed",
        responseSchemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
        responseStatus: "ready",
        rowLevelDataAcceptedByR1180: false,
        rowOwnerConfirmationInferredByR1180: false,
        rowOwnerPrivateValuesStored: false,
        rowOwnerProvidedPrivateValuesStored: false,
        rowOwnerProvidedSafeBooleansStored: false,
        rowParsingPerformedByR1180: false,
        safeMinimumPairMatches: true,
        safeResponseFieldsSatisfied: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not open the contract for invalid R1180 response shape", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-invalid-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      await writeFile(r1180Path, `${JSON.stringify(r1180Fixture({ responseStatus: "invalid" }))}\n`);

      const { output } = await runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_feature_only_execution_contract_rejected_r1180_response_shape",
        featureOnlyExecutionContractReady: false,
        nextAction: "rerun_r1180_with_valid_safe_confirmation_response",
        researchPlanningAllowed: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects R1180 artifacts when safety gates drift open", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-open-gate-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      await writeFile(r1180Path, `${JSON.stringify(withR1180SharedPatch(
        r1180Fixture({ responseStatus: "ready" }),
        { rowOwnerProvidedSafeBooleansStored: true },
      ))}\n`);

      await expect(runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      })).rejects.toThrow("R1181 rejected unexpected r1180 safe confirmation response intake shape.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it.each([
    {
      field: "sourcePriority",
      expectedState: { sourcePriorityMatches: false, targetAgeBandMatches: true },
      value: "other_priority",
    },
    {
      field: "targetAgeBand",
      expectedState: { sourcePriorityMatches: true, targetAgeBandMatches: false },
      value: "other_age_band",
    },
  ] as const)("does not infer readiness when R1180 $field drifts", async ({ expectedState, field, value }) => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-drift-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      await writeFile(r1180Path, `${JSON.stringify(withR1180SharedPatch(
        r1180Fixture({ responseStatus: "ready" }),
        { [field]: value },
      ))}\n`);

      const { output } = await runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_feature_only_execution_contract_waiting_on_r1180",
        featureOnlyExecutionContractReady: false,
        nextAction: "refresh_r1180_safe_confirmation_response_intake",
        researchPlanningAllowed: false,
        rowOwnerConfirmationInferredByR1181: false,
      });
      expect(output.r1180State).toMatchObject(expectedState);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it.each([
    {
      expectedState: { packetId: null },
      patch: { packetId: "lookalike-r1180" },
      reason: "packet id",
    },
    {
      expectedState: { r1180Status: null },
      patch: { status: "draft" },
      reason: "status",
    },
    {
      expectedState: { artifactBoundaryAggregateOnly: false },
      patch: { artifactBoundary: { ...r1180SafeBoundaryFixture(), aggregateOnly: false } },
      reason: "aggregate boundary",
    },
  ] as const)("routes R1180 $reason drift to a safe refresh", async ({ expectedState, patch }) => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-identity-drift-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      await writeFile(r1180Path, `${JSON.stringify({
        ...r1180Fixture({ responseStatus: "ready" }),
        ...patch,
      })}\n`);

      const { output } = await runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_feature_only_execution_contract_waiting_on_r1180",
        featureOnlyExecutionContractReady: false,
        nextAction: "refresh_r1180_safe_confirmation_response_intake",
        researchPlanningAllowed: false,
      });
      expect(output.r1180State).toMatchObject(expectedState);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects R1180 unsafe artifact-boundary flags before emitting a contract", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-unsafe-boundary-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      await writeFile(r1180Path, `${JSON.stringify({
        ...r1180Fixture({ responseStatus: "ready" }),
        artifactBoundary: {
          ...r1180SafeBoundaryFixture(),
          productDisplayAuthorized: true,
        },
      })}\n`);

      await expect(runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      })).rejects.toThrow("R1181 rejected unsafe r1180 safe confirmation response intake: 1 finding");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes stale R1180 evidence to a safe refresh", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-stale-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      await writeFile(r1180Path, `${JSON.stringify({
        ...r1180Fixture({ responseStatus: "ready" }),
        schemaVersion: "stale-schema",
      })}\n`);

      const { output } = await runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_feature_only_execution_contract_waiting_on_r1180",
        featureOnlyExecutionContractReady: false,
        nextAction: "refresh_r1180_safe_confirmation_response_intake",
        researchPlanningAllowed: false,
      });
      expect(output.summary.nextActionCommand).toBe(
        "pnpm exec tsx scripts/murph-age/r1180-average-submitter-safe-confirmation-response-intake.ts",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe R1180 input without echoing a private-looking path", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-unsafe-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      await writeFile(r1180Path, `${JSON.stringify({
        ...r1180Fixture({ responseStatus: "ready" }),
        rawRows: [`${tmp}/rows.csv`],
      })}\n`);

      await expect(runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      })).rejects.toThrow("R1181 rejected unsafe r1180 safe confirmation response intake: 1 finding");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it.each([
    { key: "headers", value: ["hba1c"] },
    { key: "headerNames", value: ["hba1c"] },
    { key: "fileNames", value: ["labs.csv"] },
    { key: "rows", value: [["private-row"]] },
  ])("rejects ready-looking R1180 artifacts with unexpected $key fields", async ({ key, value }) => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-unexpected-field-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      await writeFile(r1180Path, `${JSON.stringify({
        ...r1180Fixture({ responseStatus: "ready" }),
        [key]: value,
      })}\n`);

      await expect(runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      })).rejects.toThrow("R1181 rejected unexpected r1180 safe confirmation response intake shape.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it.each([
    {
      expectedState: { r1180Conclusion: "safe_confirmation_response_intake_waiting_on_response" },
      patch: { conclusion: "safe_confirmation_response_intake_waiting_on_response" },
      reason: "waiting conclusion",
    },
    {
      expectedState: { nextAction: "fill_safe_confirmation_response_template" },
      patch: { nextAction: "fill_safe_confirmation_response_template" },
      reason: "non-ready next action",
    },
    {
      expectedState: {
        nextAction: "carry_safe_confirmation_to_feature_only_chain",
        nextActionCommand: "pnpm exec tsx scripts/murph-age/r1179-average-submitter-objective-gap-audit.ts",
      },
      patch: { nextActionCommand: "pnpm exec tsx scripts/murph-age/r1179-average-submitter-objective-gap-audit.ts" },
      reason: "non-null next action command",
    },
    {
      expectedState: { invalidResponseReasonsEmpty: false },
      patch: { invalidResponseReasonIds: ["unexpected_keys"] },
      reason: "non-empty invalid response reasons",
    },
    {
      expectedState: { responseArtifactStatus: "missing" },
      patchInputArtifacts: {
        safeConfirmationResponse: {
          schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
          status: "missing",
        },
      },
      reason: "missing response artifact status",
    },
  ] as const)("does not open for exact-key R1180 ready-state contradiction: $reason", async ({
    expectedState,
    patch,
    patchInputArtifacts,
  }) => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-ready-contradiction-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      let fixture = r1180Fixture({ responseStatus: "ready" });
      if (patch) {
        fixture = withR1180SharedPatch(fixture, patch);
      }
      if (patchInputArtifacts) {
        const inputArtifacts = fixture.inputArtifacts;
        if (!isRecord(inputArtifacts)) throw new Error("test fixture inputArtifacts must be a record");
        fixture = {
          ...fixture,
          inputArtifacts: {
            ...inputArtifacts,
            ...patchInputArtifacts,
          },
        };
      }
      await writeFile(r1180Path, `${JSON.stringify(fixture)}\n`);

      const { output } = await runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_feature_only_execution_contract_waiting_on_safe_confirmation",
        featureOnlyExecutionContractReady: false,
        nextAction: "fill_r1180_safe_confirmation_response_template",
        researchPlanningAllowed: false,
      });
      expect(output.r1180State).toMatchObject(expectedState);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it.each([
    {
      buildFixture: () => withR1180SharedPatch(r1180Fixture({ responseStatus: "ready" }), {
        askId: "different_safe_confirmation_ask",
      }),
      reason: "shared ask id",
    },
    {
      buildFixture: () => withR1180TemplatePatch(r1180Fixture({ responseStatus: "ready" }), {
        askId: "different_safe_confirmation_ask",
      }),
      reason: "template ask id",
    },
    {
      buildFixture: () => withR1180TemplatePatch(r1180Fixture({ responseStatus: "ready" }), {
        schemaVersion: "stale-safe-confirmation-response-schema",
      }),
      reason: "template schema",
    },
    {
      buildFixture: () => withR1180TemplatePatch(r1180Fixture({ responseStatus: "ready" }), {
        responseKind: "not_confirmed_or_unsure",
      }),
      reason: "template response kind",
    },
  ])("rejects R1180 safe-confirmation identity/template drift: $reason", async ({ buildFixture }) => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-template-drift-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      await writeFile(r1180Path, `${JSON.stringify(buildFixture())}\n`);

      await expect(runR1181AverageSubmitterFeatureOnlyExecutionContract({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1180Path,
      })).rejects.toThrow("R1181 rejected unexpected r1180 safe confirmation response intake shape.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a minimal safe CLI summary without leaking paths or full contract details", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1181-cli-"));
    try {
      const r1180Path = path.join(tmp, "r1180.json");
      const outDir = path.join(tmp, "out");
      await mkdir(outDir, { recursive: true });
      await writeFile(r1180Path, `${JSON.stringify(r1180Fixture({ responseStatus: "ready" }))}\n`);

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1181-average-submitter-feature-only-execution-contract.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1180_SAFE_CONFIRMATION_RESPONSE_INTAKE_PATH: r1180Path,
        MURPH_AGE_R1181_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1181_OUTPUT_DIR: outDir,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      expect(result.stdout).not.toContain("executionFeatureSlots");
      const cli = JSON.parse(result.stdout) as {
        featureOnlyExecutionContractReady?: unknown;
        packetId?: unknown;
        productDisplayAuthorized?: unknown;
        researchPlanningAllowed?: unknown;
      };
      expect(cli).toMatchObject({
        featureOnlyExecutionContractReady: true,
        packetId: "r1181-average-submitter-feature-only-execution-contract",
        productDisplayAuthorized: false,
        researchPlanningAllowed: true,
      });
      await expect(stat(path.join(outDir, "r1181-average-submitter-feature-only-execution-contract.latest.json")))
        .resolves.toBeTruthy();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1180Fixture(options: { responseStatus: "invalid" | "missing" | "ready" }): Record<string, unknown> {
  const ready = options.responseStatus === "ready";
  const invalid = options.responseStatus === "invalid";
  const shared = {
    allowedValueKindIds: ["booleans_only", "fixed_enumerated_ids_only"],
    askId: "confirm_feature_only_lab_wearable_availability_without_private_values",
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
    conclusion: ready
      ? "safe_confirmation_response_intake_ready_feature_only"
      : invalid
        ? "safe_confirmation_response_intake_rejected_response_shape"
        : "safe_confirmation_response_intake_waiting_on_response",
    explicitRowOwnerSafeConfirmationProvided: ready,
    featureOnlySafeConfirmationReady: ready,
    invalidResponseReasonIds: invalid ? ["unexpected_keys"] : [],
    minimumFeaturePairRequired: [...MINIMUM_PAIR],
    missingRequiredResponseFieldIds: ready ? [] : [...REQUIRED_RESPONSE_FIELDS],
    modelEvidencePromotionAllowed: false,
    nextAction: ready
      ? "carry_safe_confirmation_to_feature_only_chain"
      : invalid
        ? "rerun_safe_confirmation_response_with_valid_json_object"
        : "fill_safe_confirmation_response_template",
    nextActionCommand: null,
    prioritizedInputKindIds: [...INPUT_KINDS],
    productDisplayAuthorized: false,
    requiredAssertionChecklistIds: [
      "assert_target_age_band_roughly_16_50",
      "assert_glycemia_bloodwork_export_available",
      "assert_daily_wearable_activity_export_available",
      "assert_no_private_values_identifiers_paths_headers_or_rows",
    ],
    requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELDS],
    responseKind: ready ? "explicit_yes_all_required_assertions_confirmed" : null,
    responseStatus: options.responseStatus,
    reviewGptRequiredNow: false,
    rowLevelDataAcceptedByR1180: false,
    rowOwnerConfirmationInferredByR1180: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerProvidedPrivateValuesStored: false,
    rowOwnerProvidedSafeBooleansStored: false,
    rowParsingPerformedByR1180: false,
    safeCompletionChecklistItemIds: [
      "confirm_target_age_band_without_identifiers",
      "confirm_glycemia_bloodwork_export_available",
      "confirm_daily_wearable_activity_export_available",
      "confirm_no_private_values_in_confirmation",
    ],
    sourcePriority: TARGET_INPUT_PRIORITY,
    targetAgeBand: TARGET_AGE_BAND,
  };
  return {
    artifactBoundary: r1180SafeBoundaryFixture(),
    createdAt: CREATED_AT,
    inputArtifacts: {
      r1179ObjectiveGapAudit: {
        artifact: "r1179-average-submitter-objective-gap-audit.latest.json",
        packetId: "r1179-average-submitter-objective-gap-audit",
        schemaVersion: "murph-age-r1179-average-submitter-objective-gap-audit.v1",
        status: "available",
      },
      safeConfirmationResponse: {
        schemaVersion: ready || invalid
          ? R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
          : null,
        status: options.responseStatus === "missing" ? "missing" : "available",
      },
    },
    packetId: "r1180-average-submitter-safe-confirmation-response-intake",
    productDisplayAuthorized: false,
    safeConfirmationResponseIntake: {
      ...shared,
      responseTemplate: {
        askId: "confirm_feature_only_lab_wearable_availability_without_private_values",
        confirmDailyWearableActivityExportAvailable: false,
        confirmGlycemiaBloodworkExportAvailable: false,
        confirmNoPrivateValuesIncluded: false,
        confirmTargetAgeBandRoughly16To50: false,
        responseKind: "explicit_yes_all_required_assertions_confirmed",
        schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
      },
    },
    schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: shared,
  };
}

function r1180SafeBoundaryFixture(): Record<string, boolean> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1180: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateDetailsStored: false,
    privateFieldRefValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefValuesStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowLevelDataAcceptedByR1180: false,
    rowOwnerConfirmationInferredByR1180: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerProvidedPrivateValuesStored: false,
    rowOwnerProvidedSafeBooleansStored: false,
    rowParsingPerformedByR1180: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function withR1180SharedPatch(
  fixture: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const intake = fixture.safeConfirmationResponseIntake;
  const summary = fixture.summary;
  if (!isRecord(intake) || !isRecord(summary)) {
    throw new Error("test fixture must include R1180 shared sections");
  }
  return {
    ...fixture,
    safeConfirmationResponseIntake: {
      ...intake,
      ...patch,
    },
    summary: {
      ...summary,
      ...patch,
    },
  };
}

function withR1180TemplatePatch(
  fixture: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const intake = fixture.safeConfirmationResponseIntake;
  if (!isRecord(intake) || !isRecord(intake.responseTemplate)) {
    throw new Error("test fixture must include R1180 response template");
  }
  return {
    ...fixture,
    safeConfirmationResponseIntake: {
      ...intake,
      responseTemplate: {
        ...intake.responseTemplate,
        ...patch,
      },
    },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
