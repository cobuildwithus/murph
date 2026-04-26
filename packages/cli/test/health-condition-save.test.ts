import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { test } from "vitest";

import { initializeVault, parseFrontmatterDocument } from "@murphai/core";
import { createUnwiredVaultServices } from "@murphai/vault-usecases";

import { registerConditionCommands } from "../src/commands/health-condition-save.js";
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

interface ConditionSaveResult {
  vault: string;
  conditionId: string;
  lookupId: string;
  path?: string;
  created: boolean;
}

function createConditionCli() {
  const cli = Cli.create("vault-cli", {
    description: "condition typed save test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);

  const services = createUnwiredVaultServices();
  registerConditionCommands(cli, services);

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

function requireSavedPath(result: ConditionSaveResult): string {
  if (!result.path) {
    throw new Error("Expected condition save result to include a relative path.");
  }

  return result.path;
}

function hasCommandMap(value: unknown): value is { commands: Map<string, unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "commands" in value &&
    value.commands instanceof Map
  );
}

function requireConditionCommandNames(cli: Cli.Cli): string[] {
  const commands = Cli.toCommands.get(cli);
  const condition = commands?.get("condition");

  if (!hasCommandMap(condition)) {
    throw new Error("Expected condition command group to be registered.");
  }

  return [...condition.commands.keys()].map((name) => `condition ${name}`);
}

test("condition save schema exposes typed fields while condition import-json is the JSON fallback", async () => {
  const cli = createConditionCli();

  const conditionCommandNames = requireConditionCommandNames(cli);
  assert.equal(conditionCommandNames.includes("condition save"), true);
  assert.equal(conditionCommandNames.includes("condition import-json"), true);
  assert.equal(conditionCommandNames.includes("condition upsert"), false);

  const schema = await readCommandSchema(cli, ["condition", "save"]);

  assert.deepEqual(schema.args.required, ["title"]);
  assert.equal("input" in schema.options.properties, false);
  assert.equal(schema.options.required?.includes("input") ?? false, false);

  for (const field of [
    "id",
    "slug",
    "clinicalStatus",
    "verificationStatus",
    "assertedOn",
    "resolvedOn",
    "severity",
    "bodySite",
    "relatedGoalId",
    "relatedRegimenId",
    "note",
  ]) {
    assert.equal(field in schema.options.properties, true, field);
  }

  const jsonFallback = await readCommandSchema(cli, ["condition", "import-json"]);
  assert.equal("input" in jsonFallback.options.properties, true);
  assert.equal(jsonFallback.options.required?.includes("input") ?? false, true);
  assert.deepEqual(jsonFallback.args.required ?? [], []);
});

test("condition save persists typed fields and preserves omitted fields on update", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-condition-save-",
  );

  try {
    const cli = createConditionCli();
    await initializeVault({ vaultRoot });

    const saveResult = await runInProcessJsonCli<ConditionSaveResult>(cli, [
      "condition",
      "save",
      "Seasonal allergies",
      "--slug",
      "seasonal-allergies",
      "--clinical-status",
      "active",
      "--verification-status",
      "confirmed",
      "--asserted-on",
      "2026-03-12",
      "--severity",
      "moderate",
      "--body-site",
      "nose",
      "--body-site",
      "eyes",
      "--related-goal-id",
      "goal_01JNY0B2W4VG5C2A0G9S8M7R6S",
      "--related-regimen-id",
      "reg_01JNY0B2W4VG5C2A0G9S8M7R6S",
      "--note",
      "Worse during spring.",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(saveResult.exitCode, null);
    const saved = requireData(saveResult.envelope);
    assert.equal(saved.created, true);
    assert.equal(saved.lookupId, saved.conditionId);

    const relativePath = requireSavedPath(saved);
    const createdMarkdown = await readFile(path.join(vaultRoot, relativePath), "utf8");
    const createdDocument = parseFrontmatterDocument(createdMarkdown);
    assert.equal(createdDocument.attributes.conditionId, saved.conditionId);
    assert.equal(createdDocument.attributes.slug, "seasonal-allergies");
    assert.equal(createdDocument.attributes.title, "Seasonal allergies");
    assert.equal(createdDocument.attributes.clinicalStatus, "active");
    assert.equal(createdDocument.attributes.verificationStatus, "confirmed");
    assert.equal(createdDocument.attributes.assertedOn, "2026-03-12");
    assert.equal(createdDocument.attributes.severity, "moderate");
    assert.deepEqual(createdDocument.attributes.bodySites, ["eyes", "nose"]);
    assert.deepEqual(createdDocument.attributes.relatedGoalIds, [
      "goal_01JNY0B2W4VG5C2A0G9S8M7R6S",
    ]);
    assert.deepEqual(createdDocument.attributes.relatedRegimenIds, [
      "reg_01JNY0B2W4VG5C2A0G9S8M7R6S",
    ]);
    assert.equal(createdDocument.attributes.note, "Worse during spring.");

    const updateResult = await runInProcessJsonCli<ConditionSaveResult>(cli, [
      "condition",
      "save",
      "Seasonal allergy pattern",
      "--id",
      saved.conditionId,
      "--clinical-status",
      "resolved",
      "--resolved-on",
      "2026-05-01",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(updateResult.exitCode, null);
    const updated = requireData(updateResult.envelope);
    assert.equal(updated.created, false);
    assert.equal(updated.conditionId, saved.conditionId);

    const updatedMarkdown = await readFile(path.join(vaultRoot, relativePath), "utf8");
    const updatedDocument = parseFrontmatterDocument(updatedMarkdown);
    assert.equal(updatedDocument.attributes.title, "Seasonal allergy pattern");
    assert.equal(updatedDocument.attributes.clinicalStatus, "resolved");
    assert.equal(updatedDocument.attributes.resolvedOn, "2026-05-01");
    assert.equal(updatedDocument.attributes.verificationStatus, "confirmed");
    assert.deepEqual(updatedDocument.attributes.bodySites, ["eyes", "nose"]);
    assert.deepEqual(updatedDocument.attributes.relatedGoalIds, [
      "goal_01JNY0B2W4VG5C2A0G9S8M7R6S",
    ]);
    assert.deepEqual(updatedDocument.attributes.relatedRegimenIds, [
      "reg_01JNY0B2W4VG5C2A0G9S8M7R6S",
    ]);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("condition save rejects comma-delimited repeatable flags", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-condition-save-repeatable-",
  );

  try {
    const cli = createConditionCli();
    await initializeVault({ vaultRoot });

    const saveResult = await runInProcessJsonCli<ConditionSaveResult>(cli, [
      "condition",
      "save",
      "Seasonal allergies",
      "--body-site",
      "nose,eyes",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(saveResult.exitCode, 1);
    assert.equal(saveResult.envelope.ok, false);
    if (!saveResult.envelope.ok) {
      assert.equal(saveResult.envelope.error.code, "invalid_option");
      assert.match(saveResult.envelope.error.message ?? "", /--body-site/u);
    }
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});
