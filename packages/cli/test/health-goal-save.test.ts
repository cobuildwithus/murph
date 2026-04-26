import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { test } from "vitest";

import { initializeVault, parseFrontmatterDocument } from "@murphai/core";
import { createUnwiredVaultServices } from "@murphai/vault-usecases";

import { registerGoalCommands } from "../src/commands/health-goal-save.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from "./cli-test-helpers.js";

interface CommandSchemaEnvelope {
  args: {
    properties: Record<string, unknown>;
    required?: string[];
  };
  options: {
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface GoalSaveResult {
  vault: string;
  goalId: string;
  lookupId: string;
  path?: string;
  created: boolean;
}

function createGoalCli() {
  const cli = Cli.create("vault-cli", {
    description: "goal typed save test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);

  const services = createUnwiredVaultServices();
  registerGoalCommands(cli, services);

  return cli;
}

async function runRawInProcessCli(
  cli: Cli.Cli,
  args: string[],
): Promise<string> {
  const output: string[] = [];
  let exitCode: number | null = null;

  await cli.serve(args, {
    env: process.env,
    exit(code) {
      exitCode = code;
    },
    stdout(chunk) {
      output.push(chunk);
    },
  });

  assert.equal(exitCode, null);
  return output.join("").trim();
}

async function readCommandSchema(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<CommandSchemaEnvelope> {
  return JSON.parse(
    await runRawInProcessCli(cli, [...commandArgs, "--schema", "--format", "json"]),
  ) as CommandSchemaEnvelope;
}

function requireSavedPath(result: GoalSaveResult): string {
  if (!result.path) {
    throw new Error("Expected goal save result to include a relative path.");
  }

  return result.path;
}

test("goal save schema exposes typed fields while goal upsert remains the JSON fallback", async () => {
  const cli = createGoalCli();

  const goalSave = await readCommandSchema(cli, ["goal", "save"]);
  assert.deepEqual(goalSave.args.required, ["title"]);
  assert.equal("input" in goalSave.options.properties, false);
  assert.equal(goalSave.options.required?.includes("input") ?? false, false);

  for (const field of [
    "id",
    "slug",
    "status",
    "horizon",
    "priority",
    "startAt",
    "targetAt",
    "parentGoalId",
    "relatedGoalId",
    "relatedExperimentId",
    "domain",
  ]) {
    assert.equal(field in goalSave.options.properties, true, field);
  }

  const goalJsonFallback = await readCommandSchema(cli, ["goal", "upsert"]);
  assert.equal("input" in goalJsonFallback.options.properties, true);
  assert.equal(goalJsonFallback.options.required?.includes("input") ?? false, true);
  assert.deepEqual(goalJsonFallback.args.required ?? [], []);
});

test("goal save persists typed fields and repeated relationships", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-goal-save-",
  );

  try {
    const cli = createGoalCli();

    await initializeVault({ vaultRoot });

    const parentGoal = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Improve sleep quality",
      "--slug",
      "improve-sleep-quality",
      "--vault",
      vaultRoot,
    ]);
    const relatedGoal = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Lift consistently",
      "--slug",
      "lift-consistently",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(parentGoal.exitCode, null);
    assert.equal(relatedGoal.exitCode, null);

    const savedChild = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Recover better",
      "--slug",
      "recover-better",
      "--status",
      "active",
      "--horizon",
      "medium_term",
      "--priority",
      "3",
      "--start-at",
      "2026-04-01",
      "--target-at",
      "2026-06-01",
      "--parent-goal-id",
      requireData(parentGoal.envelope).goalId,
      "--related-goal-id",
      requireData(relatedGoal.envelope).goalId,
      "--related-experiment-id",
      "exp_01JNY0B2W4VG5C2A0G9S8M7R6S",
      "--domain",
      "sleep",
      "--domain",
      "recovery",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(savedChild.exitCode, null);

    const saved = requireData(savedChild.envelope);
    assert.equal(saved.created, true);
    assert.equal(saved.lookupId, saved.goalId);

    const markdown = await readFile(
      path.join(vaultRoot, requireSavedPath(saved)),
      "utf8",
    );
    const document = parseFrontmatterDocument(markdown);
    assert.equal(document.attributes.title, "Recover better");
    assert.equal(document.attributes.status, "active");
    assert.equal(document.attributes.horizon, "medium_term");
    assert.equal(document.attributes.priority, 3);
    assert.deepEqual(document.attributes.window, {
      startAt: "2026-04-01",
      targetAt: "2026-06-01",
    });
    assert.equal(
      document.attributes.parentGoalId,
      requireData(parentGoal.envelope).goalId,
    );
    assert.deepEqual(document.attributes.relatedGoalIds, [
      requireData(relatedGoal.envelope).goalId,
    ]);
    assert.deepEqual(document.attributes.relatedExperimentIds, [
      "exp_01JNY0B2W4VG5C2A0G9S8M7R6S",
    ]);
    assert.deepEqual(document.attributes.domains, ["recovery", "sleep"]);

    const updated = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Recover fully",
      "--id",
      saved.goalId,
      "--priority",
      "4",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(updated.exitCode, null);
    assert.equal(requireData(updated.envelope).created, false);

    const updatedMarkdown = await readFile(
      path.join(vaultRoot, requireSavedPath(requireData(updated.envelope))),
      "utf8",
    );
    const updatedDocument = parseFrontmatterDocument(updatedMarkdown);
    assert.equal(updatedDocument.attributes.title, "Recover fully");
    assert.equal(updatedDocument.attributes.priority, 4);
    assert.deepEqual(updatedDocument.attributes.domains, ["recovery", "sleep"]);
    assert.equal(
      updatedDocument.attributes.parentGoalId,
      requireData(parentGoal.envelope).goalId,
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("goal save rejects comma-delimited repeatable fields", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-goal-save-repeatable-",
  );

  try {
    const cli = createGoalCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<GoalSaveResult>(cli, [
      "goal",
      "save",
      "Sleep longer",
      "--domain",
      "sleep,recovery",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, "invalid_option");
      assert.match(result.envelope.error.message ?? "", /--domain/u);
    }
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});
