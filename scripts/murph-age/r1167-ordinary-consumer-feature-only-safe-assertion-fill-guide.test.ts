import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner } from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";
import {
  R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION,
  R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
  runR1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuide,
} from "./r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts";

const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
];
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
];
const SAFE_FIELD_EDIT_PATHS = [
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "sourceFamilies[common_bloodwork_core].available",
  "sourceFamilies[vitals_body_context].available",
  "rowOwnerAssertionsConfirmed",
  "privateContentExcluded",
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

describe("R1167 ordinary consumer feature-only safe assertion fill guide", () => {
  it("writes a pathless R1165 assertion fill guide from the current runner and template", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1167-ready-"));
    try {
      const outDir = path.join(tmp, "out");
      await runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
        createdAt: "2026-05-18T01:00:00.000Z",
        outputDir: outDir,
      });

      const { output, outputPath } = await runR1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuide({
        createdAt: "2026-05-18T01:05:00.000Z",
        outputDir: outDir,
        r1165Path: path.join(outDir, "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json"),
        r1165TemplatePath: path.join(outDir, "r1165-row-owner-feature-only-safe-assertion.template.json"),
      });

      expect(path.basename(outputPath)).toBe("r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.latest.json");
      expect(output.schemaVersion).toBe(R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        allowedValueKinds: ["booleans_only", "fixed_enumerated_ids_only"],
        conclusion: "ordinary_feature_only_safe_assertion_fill_guide_ready",
        guideReadyForRowOwnerFill: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_r1165_row_owner_feature_only_safe_assertion_template",
        optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
        productDisplayAuthorized: false,
        requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
        rowLevelDataAcceptedByR1167: false,
        rowOwnerAssertionInferredByR1167: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1167: false,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        safeFieldEditPaths: SAFE_FIELD_EDIT_PATHS,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.fillGuide.commands.fillGuideCommand).toBe(R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND);
      expect(output.fillGuide.safeFieldEdits).toHaveLength(SAFE_FIELD_EDIT_PATHS.length);
      expect(output.fillGuide.submitterInputKinds).toEqual([
        {
          inputKindId: "lab_portal_export_or_spreadsheet",
          mapsToSourceFamilyIds: ["bloodwork_glycemia"],
          privateDetailsStored: false,
          requiredForFeatureOnlyPreferredPair: true,
          safeAvailabilityQuestion:
            "Can the row owner access a local glycemia bloodwork export without entering values here?",
        },
        {
          inputKindId: "phone_watch_or_wearable_activity_export",
          mapsToSourceFamilyIds: ["wearable_activity_daily"],
          privateDetailsStored: false,
          requiredForFeatureOnlyPreferredPair: true,
          safeAvailabilityQuestion: "Can the row owner access a local daily activity export without entering values here?",
        },
        {
          inputKindId: "optional_common_bloodwork_or_vitals_context",
          mapsToSourceFamilyIds: ["common_bloodwork_core", "vitals_body_context"],
          privateDetailsStored: false,
          requiredForFeatureOnlyPreferredPair: false,
          safeAvailabilityQuestion:
            "Optional source-family slots for common bloodwork and vitals/body context can stay false unless the row owner already has those local exports.",
        },
      ]);
      expect(output.inputArtifacts.r1165Runner.status).toBe("available");
      expect(output.inputArtifacts.r1165Template.status).toBe("available");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits on R1165 when the runner packet is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1167-missing-runner-"));
    try {
      const outDir = path.join(tmp, "out");
      await mkdir(outDir);

      const { output } = await runR1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuide({
        outputDir: outDir,
        r1165Path: path.join(tmp, "missing-r1165.json"),
        r1165TemplatePath: path.join(tmp, "missing-template.json"),
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_safe_assertion_fill_guide_waiting_on_r1165_runner",
        guideReadyForRowOwnerFill: false,
        nextAction: "refresh_r1165_safe_assertion_runner",
      });
      expect(output.inputArtifacts.r1165Runner.status).toBe("missing");
      expect(output.inputArtifacts.r1165Template.status).toBe("missing");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits on the R1165 assertion template when the runner is current but the template is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1167-missing-template-"));
    try {
      const outDir = path.join(tmp, "out");
      await runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
        outputDir: outDir,
      });

      const { output } = await runR1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuide({
        outputDir: outDir,
        r1165Path: path.join(outDir, "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json"),
        r1165TemplatePath: path.join(tmp, "missing-template.json"),
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_feature_only_safe_assertion_fill_guide_waiting_on_r1165_template",
        guideReadyForRowOwnerFill: false,
        nextAction: "refresh_r1165_safe_assertion_runner",
      });
      expect(output.inputArtifacts.r1165Runner.status).toBe("available");
      expect(output.inputArtifacts.r1165Template.status).toBe("missing");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input packets with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1167-unsafe-"));
    try {
      const outDir = path.join(tmp, "out");
      await mkdir(outDir);
      const unsafePath = path.join(tmp, "unsafe-r1165.json");
      await writeFile(unsafePath, `${JSON.stringify({
        artifactBoundary: {
          localPathsStored: true,
        },
      })}\n`);

      await expect(runR1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuide({
        outputDir: outDir,
        r1165Path: unsafePath,
        r1165TemplatePath: path.join(tmp, "missing-template.json"),
      })).rejects.toThrow("R1167 rejected unsafe r1165Runner input: 1 finding");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1167-cli-"));
    try {
      const outDir = path.join(tmp, "out");
      await runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
        outputDir: outDir,
      });
      const stdout = execFileSync(
        process.execPath,
        [
          "node_modules/tsx/dist/cli.mjs",
          path.join(process.cwd(), "scripts/murph-age/r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts"),
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            MURPH_AGE_R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_PATH:
              path.join(outDir, "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json"),
            MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_TEMPLATE_PATH:
              path.join(outDir, "r1165-row-owner-feature-only-safe-assertion.template.json"),
            MURPH_AGE_R1167_OUTPUT_DIR: path.join(tmp, "cli-out"),
          },
        },
      );

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        nextAction: string;
        packetId: string;
        rowOwnerPrivateValuesStored: boolean;
        safeFieldEditCount: number;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_feature_only_safe_assertion_fill_guide_ready",
        nextAction: "fill_r1165_row_owner_feature_only_safe_assertion_template",
        packetId: "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide",
        rowOwnerPrivateValuesStored: false,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a sanitized CLI error when a local path appears in the failure", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1167-cli-error-"));
    try {
      const blockedOutputDir = path.join(tmp, "blocked-output");
      await writeFile(blockedOutputDir, "not a directory\n");

      const stderr = captureCliFailureStderr(
        process.execPath,
        [
          "node_modules/tsx/dist/cli.mjs",
          path.join(process.cwd(), "scripts/murph-age/r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts"),
        ],
        {
          ...process.env,
          MURPH_AGE_R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_PATH:
            path.join(tmp, "missing-r1165.json"),
          MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_TEMPLATE_PATH:
            path.join(tmp, "missing-template.json"),
          MURPH_AGE_R1167_OUTPUT_DIR: blockedOutputDir,
        },
      );

      expect(stderr).toBe("R1167 safe assertion fill guide failed.\n");
      expect(stderr).not.toContain(tmp);
      expect(stderr).not.toContain(process.cwd());
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function captureCliFailureStderr(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
): string {
  try {
    execFileSync(command, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    const stderr = stderrFromThrownError(error);
    if (stderr !== null) return stderr;
    throw error;
  }
  throw new Error("Expected CLI command to fail.");
}

function stderrFromThrownError(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("stderr" in error)) return null;
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string") return stderr;
  if (Buffer.isBuffer(stderr)) return stderr.toString("utf8");
  return null;
}
