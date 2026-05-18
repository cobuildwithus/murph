import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION,
} from "./r1145-ordinary-consumer-current-chain-completion-audit.ts";
import {
  R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
} from "./r1174-ordinary-consumer-safe-next-step-packet.ts";
import {
  R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
} from "./r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts";
import {
  R1177_ORDINARY_CONSUMER_AVERAGE_SUBMITTER_PRIORITY_PACKET_SCHEMA_VERSION,
  runR1177OrdinaryConsumerAverageSubmitterPriorityPacket,
} from "./r1177-ordinary-consumer-average-submitter-priority-packet.ts";

const CREATED_AT = "2026-05-18T15:20:00.000Z";
const MINIMUM_FEATURE_PAIR = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const REQUIRED_INPUT_KINDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const OPTIONAL_CONTEXT = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED = [
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_sleep",
  "wearable_recovery",
  "wearable_hrv",
  "advanced_biomarkers",
] as const;
const FIRST_SUBMITTER_ASKS = [
  "has_glycemia_bloodwork_export",
  "has_daily_wearable_activity_export",
  "can_confirm_without_private_values",
] as const;
const BLOCKED_REQUIREMENTS = [
  "row_owner_availability_assertions_confirmed",
  "confirmed_recipe_route_requirements_available",
  "private_route_config_supplied",
  "real_lab_wearable_route_metrics_recorded",
] as const;

describe("R1177 ordinary consumer average-submitter priority packet", () => {
  it("prioritizes the average submitter lab-plus-wearable pair while waiting on row-owner confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1177-blocked-"));
    try {
      const paths = await writeInputs(tmp, { chainReady: false, missingRequirements: [...BLOCKED_REQUIREMENTS] });
      const { output, outputPath } = await runR1177OrdinaryConsumerAverageSubmitterPriorityPacket({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1145Path: paths.r1145Path,
        r1174Path: paths.r1174Path,
        r1176Path: paths.r1176Path,
      });

      expect(path.basename(outputPath)).toBe(
        "r1177-ordinary-consumer-average-submitter-priority-packet.latest.json",
      );
      expect(output.schemaVersion).toBe(
        R1177_ORDINARY_CONSUMER_AVERAGE_SUBMITTER_PRIORITY_PACKET_SCHEMA_VERSION,
      );
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_average_submitter_priority_packet_waiting_on_minimum_pair_confirmation",
        currentMissingRequirementIds: [...BLOCKED_REQUIREMENTS],
        deferredUntilMinimumPairConfirmedIds: [...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED],
        firstSubmitterAskIds: [...FIRST_SUBMITTER_ASKS],
        minimumFeaturePairConfirmed: false,
        minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
        nextAction: "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
        optionalContextNotRequiredForFirstStep: [...OPTIONAL_CONTEXT],
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
        productDisplayAuthorized: false,
        rowLevelDataAcceptedByR1177: false,
        rowOwnerConfirmationInferredByR1177: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1177: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        topRequirementId: "row_owner_availability_assertions_confirmed",
      });
      expect(output.averageSubmitterPriorityPacket.firstSubmitterAsks.map((ask) => ask.askId)).toEqual([
        ...FIRST_SUBMITTER_ASKS,
      ]);
      expect(output.averageSubmitterPriorityPacket.prioritySteps.map((step) => step.stepId)).toEqual([
        "confirm_minimum_lab_wearable_pair_available",
        "confirm_lab_wearable_recipe_route_requirements",
        "provide_private_route_config_locally",
        "run_lab_wearable_route_metrics_locally",
      ]);
      expect(output.averageSubmitterPriorityPacket.prioritySteps.map((step) => step.status)).toEqual([
        "blocked",
        "blocked",
        "blocked",
        "blocked",
      ]);
      expect(output.averageSubmitterPriorityPacket.firstSubmitterAsks.every((ask) => ask.privateDetailsStored === false)).toBe(true);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the minimum pair confirmed only after the live R1176 chain is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1177-ready-"));
    try {
      const paths = await writeInputs(tmp, { chainReady: true, missingRequirements: [] });
      const { output } = await runR1177OrdinaryConsumerAverageSubmitterPriorityPacket({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1145Path: paths.r1145Path,
        r1174Path: paths.r1174Path,
        r1176Path: paths.r1176Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_average_submitter_priority_packet_ready_for_feature_only_research_handoff",
        currentMissingRequirementIds: [],
        minimumFeaturePairConfirmed: true,
        nextAction: "run_r1164_feature_only_research_handoff",
        topRequirementId: null,
      });
      expect(output.averageSubmitterPriorityPacket.prioritySteps.map((step) => step.status)).toEqual([
        "satisfied",
        "satisfied",
        "satisfied",
        "satisfied",
      ]);
      expect(output.averageSubmitterPriorityPacket.deferredUntilMinimumPairConfirmedIds).toEqual([
        ...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED,
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes stale or missing safe-next-step input to a refresh before row-owner work", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1177-missing-"));
    try {
      const paths = await writeInputs(tmp, { chainReady: false, missingRequirements: [...BLOCKED_REQUIREMENTS] });
      await rm(paths.r1174Path, { force: true });

      const { output } = await runR1177OrdinaryConsumerAverageSubmitterPriorityPacket({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1145Path: paths.r1145Path,
        r1174Path: paths.r1174Path,
        r1176Path: paths.r1176Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_average_submitter_priority_packet_waiting_on_safe_next_step_packet",
        nextAction: "refresh_r1174_safe_next_step_packet",
        minimumFeaturePairConfirmed: false,
      });
      expect(output.inputArtifacts.r1174SafeNextStepPacket).toMatchObject({
        artifact: "r1174-ordinary-consumer-safe-next-step-packet.latest.json",
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.averageSubmitterPriorityPacket.prioritySteps[0]?.status).toBe("blocked");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes stale or missing completion-audit input to a refresh before later packets", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1177-missing-audit-"));
    try {
      const paths = await writeInputs(tmp, { chainReady: true, missingRequirements: [] });
      await rm(paths.r1145Path, { force: true });

      const { output } = await runR1177OrdinaryConsumerAverageSubmitterPriorityPacket({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1145Path: paths.r1145Path,
        r1174Path: paths.r1174Path,
        r1176Path: paths.r1176Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_average_submitter_priority_packet_waiting_on_completion_audit",
        currentMissingRequirementIds: [...BLOCKED_REQUIREMENTS],
        minimumFeaturePairConfirmed: false,
        nextAction: "refresh_r1145_completion_audit",
        topRequirementId: "row_owner_availability_assertions_confirmed",
      });
      expect(output.inputArtifacts.r1145CompletionAudit).toMatchObject({
        artifact: "r1145-ordinary-consumer-current-chain-completion-audit.latest.json",
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.averageSubmitterPriorityPacket.prioritySteps.map((step) => step.status)).toEqual([
        "blocked",
        "blocked",
        "blocked",
        "blocked",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not copy contaminated upstream strings into persisted summaries or commands", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1177-contaminated-"));
    try {
      const paths = await writeInputs(tmp, { chainReady: false, missingRequirements: [...BLOCKED_REQUIREMENTS] });
      const r1145 = await readJsonObject(paths.r1145Path);
      const r1145Commands = recordAt(recordAt(r1145, "completionAudit"), "commands");
      r1145Commands.recipeReadinessChainRunnerCommand = `${tmp}/private-lab-route.json`;
      r1145Commands.postConfirmationPrivateConfigIntakeCommand = "private-lab-config.json";
      r1145Commands.partialPrivateChainRunnerCommand = "row-value-header-text";
      await writeFile(paths.r1145Path, `${JSON.stringify(r1145)}\n`);

      const r1174 = await readJsonObject(paths.r1174Path);
      r1174.packetId = `${tmp}/r1174-contaminated-id`;
      r1174.schemaVersion = "private-lab-schema-name";
      await writeFile(paths.r1174Path, `${JSON.stringify(r1174)}\n`);

      const { output } = await runR1177OrdinaryConsumerAverageSubmitterPriorityPacket({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1145Path: paths.r1145Path,
        r1174Path: paths.r1174Path,
        r1176Path: paths.r1176Path,
      });

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(tmp);
      expect(serialized).not.toContain("private-lab-route.json");
      expect(serialized).not.toContain("private-lab-config.json");
      expect(serialized).not.toContain("row-value-header-text");
      expect(serialized).not.toContain("private-lab-schema-name");
      expect(output.inputArtifacts.r1174SafeNextStepPacket).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "available",
      });
      expect(output.averageSubmitterPriorityPacket.prioritySteps.map((step) => step.command)).toEqual([
        "MURPH_AGE_R1176_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts",
        "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts",
        "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1148-ordinary-consumer-post-confirmation-private-config-intake.ts",
        "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not confirm the minimum pair from duplicate or malformed upstream arrays", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1177-duplicate-pair-"));
    try {
      const paths = await writeInputs(tmp, { chainReady: true, missingRequirements: [] });
      const r1176 = await readJsonObject(paths.r1176Path);
      const summary = recordAt(r1176, "summary");
      summary.minimumFeaturePairRequired = ["bloodwork_glycemia", "bloodwork_glycemia"];
      await writeFile(paths.r1176Path, `${JSON.stringify(r1176)}\n`);

      const { output } = await runR1177OrdinaryConsumerAverageSubmitterPriorityPacket({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1145Path: paths.r1145Path,
        r1174Path: paths.r1174Path,
        r1176Path: paths.r1176Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_average_submitter_priority_packet_waiting_on_live_chain_packet",
        minimumFeaturePairConfirmed: false,
        nextAction: "refresh_r1176_row_owner_safe_assertion_chain",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a safe CLI summary without leaking input or output paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1177-cli-"));
    try {
      const paths = await writeInputs(tmp, { chainReady: false, missingRequirements: [...BLOCKED_REQUIREMENTS] });
      const outDir = path.join(tmp, "out");
      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1177-ordinary-consumer-average-submitter-priority-packet.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH: paths.r1145Path,
        MURPH_AGE_R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_PATH: paths.r1174Path,
        MURPH_AGE_R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: paths.r1176Path,
        MURPH_AGE_R1177_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1177_OUTPUT_DIR: outDir,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(tmp);
      const cli = JSON.parse(result.stdout) as {
        conclusion?: unknown;
        firstSubmitterAskIds?: unknown;
        packetId?: unknown;
        prioritizedInputKindIds?: unknown;
      };
      expect(cli).toMatchObject({
        conclusion: "ordinary_average_submitter_priority_packet_waiting_on_minimum_pair_confirmation",
        firstSubmitterAskIds: [...FIRST_SUBMITTER_ASKS],
        packetId: "r1177-ordinary-consumer-average-submitter-priority-packet",
        prioritizedInputKindIds: [...REQUIRED_INPUT_KINDS],
      });
      await expect(stat(path.join(outDir, "r1177-ordinary-consumer-average-submitter-priority-packet.latest.json"))).resolves.toBeTruthy();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo local paths when CLI output setup fails", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1177-cli-fail-"));
    try {
      const paths = await writeInputs(tmp, { chainReady: false, missingRequirements: [...BLOCKED_REQUIREMENTS] });
      const outputDir = path.join(tmp, "not-a-directory");
      await writeFile(outputDir, "already a file\n");

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1177-ordinary-consumer-average-submitter-priority-packet.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH: paths.r1145Path,
        MURPH_AGE_R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_PATH: paths.r1174Path,
        MURPH_AGE_R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: paths.r1176Path,
        MURPH_AGE_R1177_OUTPUT_DIR: outputDir,
      }, false);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("R1177 average-submitter priority packet failed.");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stdout).toBe("");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo private text when CLI input JSON is malformed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1177-cli-json-fail-"));
    try {
      const paths = await writeInputs(tmp, { chainReady: false, missingRequirements: [...BLOCKED_REQUIREMENTS] });
      await writeFile(paths.r1145Path, "{\"private_row_value\":\"lab_value_123\",");

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1177-ordinary-consumer-average-submitter-priority-packet.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH: paths.r1145Path,
        MURPH_AGE_R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_PATH: paths.r1174Path,
        MURPH_AGE_R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: paths.r1176Path,
        MURPH_AGE_R1177_OUTPUT_DIR: path.join(tmp, "out"),
      }, false);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("R1177 average-submitter priority packet failed.");
      expect(result.stderr).not.toContain("lab_value_123");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stdout).toBe("");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo bare filenames when CLI output setup fails", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1177-cli-bare-fail-"));
    try {
      const paths = await writeInputs(tmp, { chainReady: false, missingRequirements: [...BLOCKED_REQUIREMENTS] });

      const result = await execFilePromise("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r1177-ordinary-consumer-average-submitter-priority-packet.ts",
      ], {
        ...process.env,
        MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH: paths.r1145Path,
        MURPH_AGE_R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_PATH: paths.r1174Path,
        MURPH_AGE_R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: paths.r1176Path,
        MURPH_AGE_R1177_OUTPUT_DIR: "package.json",
      }, false);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("R1177 average-submitter priority packet failed.");
      expect(result.stderr).not.toContain("package.json");
      expect(result.stdout).toBe("");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(
  root: string,
  options: {
    chainReady: boolean;
    missingRequirements: string[];
  },
): Promise<{ r1145Path: string; r1174Path: string; r1176Path: string }> {
  await mkdir(root, { recursive: true });
  const r1145Path = path.join(root, "r1145.json");
  const r1174Path = path.join(root, "r1174.json");
  const r1176Path = path.join(root, "r1176.json");
  await Promise.all([
    writeFile(r1145Path, `${JSON.stringify(r1145Fixture(options.missingRequirements))}\n`),
    writeFile(r1174Path, `${JSON.stringify(r1174Fixture())}\n`),
    writeFile(r1176Path, `${JSON.stringify(r1176Fixture(options.chainReady))}\n`),
  ]);
  return { r1145Path, r1174Path, r1176Path };
}

function r1145Fixture(missingRequirementIds: string[]): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      productDisplayAuthorized: false,
    },
    completionAudit: {
      commands: {
        partialPrivateChainRunnerCommand:
          "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts",
        postConfirmationPrivateConfigIntakeCommand:
          "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1148-ordinary-consumer-post-confirmation-private-config-intake.ts",
        recipeReadinessChainRunnerCommand:
          "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts",
      },
      missingRequirementIds,
      prioritizedSubmitterInputFamilyIds: [...MINIMUM_FEATURE_PAIR],
      restatedObjective: "prioritize_ordinary_16_50_wearable_data_and_bloodwork_labs_for_murph_age_model",
    },
    packetId: "r1145-ordinary-consumer-current-chain-completion-audit",
    productDisplayAuthorized: false,
    schemaVersion: R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
  };
}

function r1174Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
    },
    packetId: "r1174-ordinary-consumer-safe-next-step-packet",
    schemaVersion: R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
      productDisplayAuthorized: false,
      requiredInputKindIds: [...REQUIRED_INPUT_KINDS],
      rowLevelDataAcceptedByR1174: false,
      rowOwnerConfirmationInferredByR1174: false,
    },
  };
}

function r1176Fixture(chainReady: boolean): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
    },
    packetId: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner",
    schemaVersion: R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      chainReady,
      conclusion: chainReady
        ? "row_owner_safe_assertion_chain_ready_research_only"
        : "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation",
      explicitRowOwnerAssertionProvided: chainReady,
      featureOnlyResearchPlanningReady: chainReady,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR],
      modelEvidencePromotionAllowed: false,
      nextAction: chainReady
        ? "run_r1164_feature_only_research_handoff"
        : "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: [...REQUIRED_INPUT_KINDS],
      rowLevelDataAcceptedByR1176: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1176: false,
    },
  };
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected JSON object fixture.");
  }
  return value as Record<string, unknown>;
}

function recordAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = value[key];
  if (typeof child !== "object" || child === null || Array.isArray(child)) {
    throw new Error(`Expected object fixture field: ${key}`);
  }
  return child as Record<string, unknown>;
}

function execFilePromise(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  expectSuccess = true,
): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env }, (error, stdout, stderr) => {
      const exitCode = typeof error === "object"
        && error !== null
        && "code" in error
        && typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        : null;
      if (expectSuccess && error) {
        reject(error);
        return;
      }
      resolve({ exitCode, stderr, stdout });
    });
  });
}
