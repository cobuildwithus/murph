import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { test } from "vitest";

import { initializeVault, parseFrontmatterDocument } from "@murphai/core";
import { createUnwiredVaultServices } from "@murphai/vault-usecases";

import { registerAllergyCommands } from "../src/commands/health-allergy-save.js";
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

interface AllergySaveResult {
  vault: string;
  allergyId: string;
  lookupId: string;
  path?: string;
  created: boolean;
}

function createAllergyCli() {
  const cli = Cli.create("vault-cli", {
    description: "allergy typed save test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);

  const services = createUnwiredVaultServices();
  registerAllergyCommands(cli, services);

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

function requireSavedPath(result: AllergySaveResult): string {
  if (!result.path) {
    throw new Error("Expected allergy save result to include a relative path.");
  }

  return result.path;
}

test("allergy save schema exposes typed allergy fields while allergy upsert remains the JSON fallback", async () => {
  const cli = createAllergyCli();

  const saveSchema = await readCommandSchema(cli, ["allergy", "save"]);
  assert.deepEqual(saveSchema.args.required, ["title"]);
  assert.equal("input" in saveSchema.options.properties, false);
  assert.equal(saveSchema.options.required?.includes("input") ?? false, false);
  assert.equal(saveSchema.options.required?.includes("substance") ?? false, true);

  for (const field of [
    "id",
    "slug",
    "substance",
    "status",
    "criticality",
    "reaction",
    "recordedOn",
    "relatedConditionId",
    "note",
  ]) {
    assert.equal(field in saveSchema.options.properties, true, field);
  }

  const upsertSchema = await readCommandSchema(cli, ["allergy", "upsert"]);
  assert.equal("input" in upsertSchema.options.properties, true);
  assert.equal(upsertSchema.options.required?.includes("input") ?? false, true);
  assert.deepEqual(upsertSchema.args.required ?? [], []);
});

test("allergy save persists typed fields and repeated condition relationships", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-allergy-save-",
  );

  try {
    const cli = createAllergyCli();
    await initializeVault({ vaultRoot });

    const saveResult = await runInProcessJsonCli<AllergySaveResult>(cli, [
      "allergy",
      "save",
      "Peanut allergy",
      "--slug",
      "peanut-allergy",
      "--substance",
      "Peanut",
      "--status",
      "active",
      "--criticality",
      "high",
      "--reaction",
      "Hives",
      "--recorded-on",
      "2026-03-12",
      "--related-condition-id",
      "cond_01JNY0B2W4VG5C2A0G9S8M7R6S",
      "--note",
      "Avoid peanuts and peanut oil.",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(saveResult.exitCode, null);
    const saved = requireData(saveResult.envelope);
    assert.equal(saved.created, true);
    assert.equal(saved.lookupId, saved.allergyId);

    const relativePath = requireSavedPath(saved);
    const createdMarkdown = await readFile(path.join(vaultRoot, relativePath), "utf8");
    const createdDocument = parseFrontmatterDocument(createdMarkdown);
    assert.equal(createdDocument.attributes.allergyId, saved.allergyId);
    assert.equal(createdDocument.attributes.slug, "peanut-allergy");
    assert.equal(createdDocument.attributes.title, "Peanut allergy");
    assert.equal(createdDocument.attributes.substance, "Peanut");
    assert.equal(createdDocument.attributes.status, "active");
    assert.equal(createdDocument.attributes.criticality, "high");
    assert.equal(createdDocument.attributes.reaction, "Hives");
    assert.equal(createdDocument.attributes.recordedOn, "2026-03-12");
    assert.deepEqual(createdDocument.attributes.relatedConditionIds, [
      "cond_01JNY0B2W4VG5C2A0G9S8M7R6S",
    ]);
    assert.equal(createdDocument.attributes.note, "Avoid peanuts and peanut oil.");

    const updateResult = await runInProcessJsonCli<AllergySaveResult>(cli, [
      "allergy",
      "save",
      "Peanut allergy",
      "--id",
      saved.allergyId,
      "--substance",
      "Peanut",
      "--reaction",
      "Hives and wheezing",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(updateResult.exitCode, null);
    const updated = requireData(updateResult.envelope);
    assert.equal(updated.created, false);
    assert.equal(updated.allergyId, saved.allergyId);

    const updatedMarkdown = await readFile(path.join(vaultRoot, relativePath), "utf8");
    const updatedDocument = parseFrontmatterDocument(updatedMarkdown);
    assert.equal(updatedDocument.attributes.substance, "Peanut");
    assert.equal(updatedDocument.attributes.reaction, "Hives and wheezing");
    assert.equal(updatedDocument.attributes.criticality, "high");
    assert.equal(updatedDocument.attributes.recordedOn, "2026-03-12");
    assert.deepEqual(updatedDocument.attributes.relatedConditionIds, [
      "cond_01JNY0B2W4VG5C2A0G9S8M7R6S",
    ]);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("allergy save rejects comma-delimited repeatable flags", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-allergy-save-repeatable-",
  );

  try {
    const cli = createAllergyCli();
    await initializeVault({ vaultRoot });

    const saveResult = await runInProcessJsonCli<AllergySaveResult>(cli, [
      "allergy",
      "save",
      "Peanut allergy",
      "--substance",
      "Peanut",
      "--related-condition-id",
      "cond_01JNY0B2W4VG5C2A0G9S8M7R6S,cond_01JNY0B2W4VG5C2A0G9S8M7R6T",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(saveResult.exitCode, 1);
    assert.equal(saveResult.envelope.ok, false);
    if (!saveResult.envelope.ok) {
      assert.equal(saveResult.envelope.error.code, "invalid_option");
      assert.match(saveResult.envelope.error.message ?? "", /--related-condition-id/u);
    }
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});
