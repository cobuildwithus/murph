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
  runR1181AverageSubmitterFeatureOnlyExecutionContract,
} from "./r1181-average-submitter-feature-only-execution-contract.ts";
import {
  runR1182AverageSubmitterSafeResponseHandoff,
} from "./r1182-average-submitter-safe-response-handoff.ts";
import {
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
  runR1183AverageSubmitterSafeResponseMaterializer,
} from "./r1183-average-submitter-safe-response-materializer.ts";
import {
  runR1184AverageSubmitterSafeResponseChainStatus,
} from "./r1184-average-submitter-safe-response-chain-status.ts";
import {
  R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION,
  runR1185AverageSubmitterSafeResponseSmokeProof,
} from "./r1185-average-submitter-safe-response-smoke-proof.ts";

const CREATED_AT = "2026-05-19T02:30:00.000Z";
const ASK_ID = "confirm_feature_only_lab_wearable_availability_without_private_values";
const MINIMUM_PAIR = ["bloodwork_glycemia", "wearable_activity_daily"] as const;
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
const CONFIRMED_RESPONSE_FILE_NAME =
  "r1183-confirmed-average-submitter-safe-confirmation-response.json" as const;

describe("R1185 average submitter safe response smoke proof", () => {
  it("runs an isolated synthetic proof without mutating the live row-owner blocker chain", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1185-smoke-"));
    try {
      const chain = await buildLiveRowOwnerBlockerChain(tmp);
      const reference = await buildSyntheticFeatureOnlyContractReference({
        dir: path.join(tmp, "reference"),
        r1179Path: chain.r1179Path,
        r1182Path: chain.r1182Path,
      });
      const beforeLiveR1184 = await readFile(chain.r1184Path, "utf8");

      const { output, outputPath } = await runR1185AverageSubmitterSafeResponseSmokeProof({
        createdAt: CREATED_AT,
        liveR1184Path: chain.r1184Path,
        outputDir: path.join(tmp, "r1185-out"),
        r1179Path: chain.r1179Path,
        r1182Path: chain.r1182Path,
        scratchRootDir: path.join(tmp, "scratch"),
      });

      expect(path.basename(outputPath)).toBe("r1185-average-submitter-safe-response-smoke-proof.latest.json");
      expect(output.schemaVersion).toBe(R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_smoke_passed_non_evidence",
        liveR1184Conclusion: "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
        liveR1184ReadyForSyntheticSmoke: true,
        nextRealAction: "obtain_real_row_owner_safe_confirmation_then_rerun_r1183",
        nextRealActionCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
        nextRealActionRequiresExplicitRowOwnerAssertion: true,
        productDisplayAuthorized: false,
        syntheticPathAdvancedToFeatureOnlyResearchPlanning: true,
        syntheticSmokeRan: true,
      });
      expect(output.smokeProof).toMatchObject({
        evidenceClass: "synthetic_non_evidence_smoke_proof",
        liveArtifactsMutatedByR1185: false,
        liveRowOwnerConfirmationProvided: false,
        modelEvidencePromotionAllowed: false,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1185: false,
        rowOwnerConfirmationInferredByR1185: false,
        rowOwnerPrivateValuesStored: false,
        rowOwnerSafeResponseValuesStoredInR1185Packet: false,
        rowParsingPerformedByR1185: false,
        syntheticPathAdvancedToFeatureOnlyResearchPlanning: true,
        syntheticSafeConfirmationUsed: true,
      });
      expect(output.smokeProof.stageConclusions.map((stage) => stage.conclusion)).toEqual([
        "average_submitter_safe_response_materializer_confirmed_response_written",
        "safe_confirmation_response_intake_ready_feature_only",
        "average_submitter_feature_only_execution_contract_ready_research_only",
        "average_submitter_safe_response_handoff_ready_for_research_planning_only",
        "average_submitter_safe_response_chain_ready_for_feature_only_research_planning",
      ]);
      expect(output.smokeProof.stageConclusions.every((stage) => stage.syntheticNonEvidence)).toBe(true);
      expect(output.smokeProof.minimumFeaturePairRequired).toEqual([...MINIMUM_PAIR]);
      expect(output.smokeProof.prioritizedInputKindIds).toEqual([...REQUIRED_INPUT_KINDS]);
      expect(output.smokeProof.requiredResponseFieldIds).toEqual([...REQUIRED_RESPONSE_FIELDS]);
      expect(output.smokeProof.minimumFeaturePairRequired).toEqual(
        reference.r1180.output.summary.minimumFeaturePairRequired,
      );
      expect(output.smokeProof.prioritizedInputKindIds).toEqual(reference.r1180.output.summary.prioritizedInputKindIds);
      expect(output.smokeProof.requiredResponseFieldIds).toEqual(reference.r1180.output.summary.requiredResponseFieldIds);
      expect(output.smokeProof.safeExecutionFeatureSlotIds).toEqual(
        reference.r1181.output.summary.safeExecutionFeatureSlotIds,
      );
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      await expect(pathExists(path.join(chain.liveDir, CONFIRMED_RESPONSE_FILE_NAME))).resolves.toBe(false);
      await expect(readFile(chain.r1184Path, "utf8")).resolves.toBe(beforeLiveR1184);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe live R1184 privacy gates without echoing paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1185-unsafe-"));
    try {
      const chain = await buildLiveRowOwnerBlockerChain(tmp);
      const unsafeR1184 = await readJsonFile(chain.r1184Path);
      const summary = requiredRecordAt(unsafeR1184, ["summary"]);
      const chainStatus = requiredRecordAt(unsafeR1184, ["chainStatus"]);
      summary.rowOwnerConfirmationInferredByR1184 = true;
      chainStatus.rowOwnerConfirmationInferredByR1184 = true;
      const unsafeR1184Path = path.join(tmp, "unsafe-r1184.json");
      await writeFile(unsafeR1184Path, `${JSON.stringify(unsafeR1184)}\n`);

      let caught: unknown;
      try {
        await runR1185AverageSubmitterSafeResponseSmokeProof({
          createdAt: CREATED_AT,
          liveR1184Path: unsafeR1184Path,
          outputDir: path.join(tmp, "out"),
          r1179Path: chain.r1179Path,
          r1182Path: chain.r1182Path,
          scratchRootDir: path.join(tmp, "scratch"),
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = caught instanceof Error ? caught.message : "";
      expect(message).toBe("R1185 rejected unsafe live r1184 safe response chain status: 1 finding");
      expect(message).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unexpected live R1184 shape before synthetic promotion", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1185-shape-"));
    try {
      const chain = await buildLiveRowOwnerBlockerChain(tmp);
      const contaminatedR1184 = await readJsonFile(chain.r1184Path);
      const summary = requiredRecordAt(contaminatedR1184, ["summary"]);
      summary.unexpectedHeaderName = "non_sensitive_fixture_label";
      const contaminatedR1184Path = path.join(tmp, "contaminated-r1184.json");
      await writeFile(contaminatedR1184Path, `${JSON.stringify(contaminatedR1184)}\n`);

      let caught: unknown;
      try {
        await runR1185AverageSubmitterSafeResponseSmokeProof({
          createdAt: CREATED_AT,
          liveR1184Path: contaminatedR1184Path,
          outputDir: path.join(tmp, "out"),
          r1179Path: chain.r1179Path,
          r1182Path: chain.r1182Path,
          scratchRootDir: path.join(tmp, "scratch"),
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = caught instanceof Error ? caught.message : "";
      expect(message).toBe("R1185 rejected unexpected live r1184 safe response chain status shape.");
      expect(message).not.toContain(tmp);
      expect(message).not.toContain("unexpectedHeaderName");
      expect(message).not.toContain("non_sensitive_fixture_label");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("stays blocked when the live R1184 blocker artifact is unavailable", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1185-missing-"));
    try {
      const { output } = await runR1185AverageSubmitterSafeResponseSmokeProof({
        createdAt: CREATED_AT,
        liveR1184Path: path.join(tmp, "missing-r1184.json"),
        outputDir: path.join(tmp, "out"),
        scratchRootDir: path.join(tmp, "scratch"),
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_smoke_waiting_on_live_r1184_row_owner_blocker",
        liveR1184Conclusion: null,
        liveR1184ReadyForSyntheticSmoke: false,
        nextRealAction: "refresh_r1184_safe_response_chain_status",
        syntheticPathAdvancedToFeatureOnlyResearchPlanning: false,
        syntheticSmokeRan: false,
      });
      expect(output.smokeProof.stageConclusions).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("stays blocked when live R1184 is present but not at the row-owner blocker gate", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1185-live-blocked-"));
    try {
      const chain = await buildLiveFeatureContractBlockedChain(tmp);
      const beforeLiveR1184 = await readFile(chain.r1184Path, "utf8");
      const scratchRoot = path.join(tmp, "scratch");

      const { output } = await runR1185AverageSubmitterSafeResponseSmokeProof({
        createdAt: CREATED_AT,
        liveR1184Path: chain.r1184Path,
        outputDir: path.join(tmp, "out"),
        scratchRootDir: scratchRoot,
      });

      expect(output.summary).toMatchObject({
        conclusion: "average_submitter_safe_response_smoke_waiting_on_live_r1184_row_owner_blocker",
        liveR1184Conclusion: "average_submitter_safe_response_chain_waiting_on_r1181_feature_contract",
        liveR1184ReadyForSyntheticSmoke: false,
        nextRealAction: "refresh_r1184_safe_response_chain_status",
        syntheticPathAdvancedToFeatureOnlyResearchPlanning: false,
        syntheticSmokeRan: false,
      });
      expect(output.smokeProof).toMatchObject({
        liveArtifactsMutatedByR1185: false,
        rowLevelDataAcceptedByR1185: false,
        rowOwnerConfirmationInferredByR1185: false,
        rowOwnerSafeResponseValuesStoredInR1185Packet: false,
        rowParsingPerformedByR1185: false,
        syntheticPathAdvancedToFeatureOnlyResearchPlanning: false,
        syntheticSafeConfirmationUsed: false,
      });
      expect(output.smokeProof.stageConclusions).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      await expect(pathExists(scratchRoot)).resolves.toBe(false);
      await expect(readFile(chain.r1184Path, "utf8")).resolves.toBe(beforeLiveR1184);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact safe CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1185-cli-"));
    try {
      const chain = await buildLiveRowOwnerBlockerChain(tmp);
      const outDir = path.join(tmp, "out");

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1185-average-submitter-safe-response-smoke-proof.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1185_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1185_LIVE_R1184_PATH: chain.r1184Path,
        MURPH_AGE_R1185_OUTPUT_DIR: outDir,
        MURPH_AGE_R1185_R1179_OBJECTIVE_GAP_AUDIT_PATH: chain.r1179Path,
        MURPH_AGE_R1185_R1182_SAFE_RESPONSE_HANDOFF_PATH: chain.r1182Path,
        MURPH_AGE_R1185_SCRATCH_ROOT_DIR: path.join(tmp, "scratch"),
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      expect(result.stdout).not.toContain("confirmGlycemiaBloodworkExportAvailable");
      const parsed: unknown = JSON.parse(result.stdout);
      expect(parsed).toMatchObject({
        conclusion: "average_submitter_safe_response_smoke_passed_non_evidence",
        liveR1184ReadyForSyntheticSmoke: true,
        nextRealActionCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
        packetId: "r1185-average-submitter-safe-response-smoke-proof",
        schemaVersion: R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION,
        syntheticPathAdvancedToFeatureOnlyResearchPlanning: true,
        syntheticSmokeRan: true,
      });
      await expect(stat(path.join(outDir, "r1185-average-submitter-safe-response-smoke-proof.latest.json")))
        .resolves.toBeTruthy();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function buildLiveRowOwnerBlockerChain(dir: string): Promise<{
  liveDir: string;
  r1179Path: string;
  r1182Path: string;
  r1184Path: string;
}> {
  const liveDir = path.join(dir, "live");
  const r1179Path = path.join(dir, "r1179.json");
  await writeFile(r1179Path, `${JSON.stringify(r1179Fixture())}\n`);
  const r1180 = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
    createdAt: CREATED_AT,
    outputDir: liveDir,
    r1179Path,
  });
  const r1181 = await runR1181AverageSubmitterFeatureOnlyExecutionContract({
    createdAt: CREATED_AT,
    outputDir: liveDir,
    r1180Path: r1180.outputPath,
  });
  const r1182 = await runR1182AverageSubmitterSafeResponseHandoff({
    createdAt: CREATED_AT,
    outputDir: liveDir,
    r1181Path: r1181.outputPath,
  });
  const r1183 = await runR1183AverageSubmitterSafeResponseMaterializer({
    createdAt: CREATED_AT,
    outputDir: liveDir,
    r1182Path: r1182.outputPath,
  });
  if (r1183.fillableResponsePath === null) {
    throw new Error("Test fixture failed to produce a fillable safe response.");
  }
  const r1184 = await runR1184AverageSubmitterSafeResponseChainStatus({
    createdAt: CREATED_AT,
    fillableResponsePath: r1183.fillableResponsePath,
    outputDir: liveDir,
    r1180Path: r1180.outputPath,
    r1181Path: r1181.outputPath,
    r1182Path: r1182.outputPath,
    r1183Path: r1183.outputPath,
  });
  expect(r1184.output.summary.conclusion).toBe(
    "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
  );
  return {
    liveDir,
    r1179Path,
    r1182Path: r1182.outputPath,
    r1184Path: r1184.outputPath,
  };
}

async function buildSyntheticFeatureOnlyContractReference(state: {
  dir: string;
  r1179Path: string;
  r1182Path: string;
}) {
  const r1183 = await runR1183AverageSubmitterSafeResponseMaterializer({
    createdAt: CREATED_AT,
    outputDir: state.dir,
    r1182Path: state.r1182Path,
    rowOwnerSafeResponseAssertionsConfirmed: true,
  });
  if (r1183.confirmedResponsePath === null) {
    throw new Error("Test fixture failed to produce a confirmed safe response.");
  }
  const r1180 = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
    createdAt: CREATED_AT,
    outputDir: state.dir,
    r1179Path: state.r1179Path,
    responsePath: r1183.confirmedResponsePath,
  });
  const r1181 = await runR1181AverageSubmitterFeatureOnlyExecutionContract({
    createdAt: CREATED_AT,
    outputDir: state.dir,
    r1180Path: r1180.outputPath,
  });
  expect(r1180.output.summary.conclusion).toBe("safe_confirmation_response_intake_ready_feature_only");
  expect(r1181.output.summary.conclusion).toBe(
    "average_submitter_feature_only_execution_contract_ready_research_only",
  );
  return { r1180, r1181 };
}

async function buildLiveFeatureContractBlockedChain(dir: string): Promise<{
  r1184Path: string;
}> {
  const liveDir = path.join(dir, "live");
  const r1179Path = path.join(dir, "r1179.json");
  const responsePath = path.join(dir, "safe-confirmation-response.json");
  await writeFile(r1179Path, `${JSON.stringify(r1179Fixture())}\n`);
  await writeFile(responsePath, `${JSON.stringify(safeConfirmationResponseFixture())}\n`);
  const r1180 = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
    createdAt: CREATED_AT,
    outputDir: liveDir,
    r1179Path,
    responsePath,
  });
  const r1184 = await runR1184AverageSubmitterSafeResponseChainStatus({
    createdAt: CREATED_AT,
    outputDir: liveDir,
    r1180Path: r1180.outputPath,
  });
  expect(r1180.output.summary.conclusion).toBe("safe_confirmation_response_intake_ready_feature_only");
  expect(r1184.output.summary.conclusion).toBe(
    "average_submitter_safe_response_chain_waiting_on_r1181_feature_contract",
  );
  return {
    r1184Path: r1184.outputPath,
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

function safeConfirmationResponseFixture(): Record<string, unknown> {
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

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected test fixture JSON object.");
  }
  return parsed;
}

function requiredRecordAt(value: unknown, pathParts: readonly string[]): Record<string, unknown> {
  let current = value;
  for (const part of pathParts) {
    if (!isPlainRecord(current)) {
      throw new Error("Expected nested test fixture object.");
    }
    current = current[part];
  }
  if (!isPlainRecord(current)) {
    throw new Error("Expected nested test fixture object.");
  }
  return current;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isPlainRecord(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
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
