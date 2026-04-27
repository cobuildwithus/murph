import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { test } from "vitest";

import { parseFrontmatterDocument } from "@murphai/core";
import { createIntegratedVaultServices } from "@murphai/vault-usecases";

import { registerProtocolCommands } from "../src/commands/protocol.js";
import { registerVaultCommands } from "../src/commands/vault.js";
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

interface SaveResult {
  vault: string;
  regimenId: string;
  lookupId: string;
  path?: string;
  created: boolean;
}

function createRegimenSaveCli() {
  const cli = Cli.create("vault-cli", {
    description: "regimen typed save parity test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);

  const services = createIntegratedVaultServices();
  registerVaultCommands(cli, services);
  registerProtocolCommands(cli, services);

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

function requireSavedPath(result: SaveResult): string {
  if (!result.path) {
    throw new Error("Expected save result to include a relative path.");
  }

  return result.path;
}

test("regimen save schema exposes typed product and primary ingredient fields", async () => {
  const cli = createRegimenSaveCli();

  const regimenSave = await readCommandSchema(cli, ["regimen", "save"]);
  assert.deepEqual(regimenSave.args.required, ["title"]);
  assert.equal("input" in regimenSave.options.properties, false);
  assert.equal(regimenSave.options.required?.includes("input") ?? false, false);
  assert.equal(regimenSave.options.required?.includes("kind") ?? false, true);

  for (const field of [
    "id",
    "slug",
    "kind",
    "status",
    "startedOn",
    "stoppedOn",
    "schedule",
    "substance",
    "dose",
    "unit",
    "brand",
    "manufacturer",
    "servingSize",
    "ingredientCompound",
    "ingredientLabel",
    "ingredientAmount",
    "ingredientUnit",
    "ingredientNote",
    "ingredientActive",
    "group",
    "relatedGoalId",
    "relatedConditionId",
    "relatedRegimenId",
  ]) {
    assert.equal(field in regimenSave.options.properties, true, field);
  }

  const regimenJsonFallback = await readCommandSchema(cli, ["regimen", "import-json"]);
  assert.equal("input" in regimenJsonFallback.options.properties, true);
  assert.equal(regimenJsonFallback.options.required?.includes("input") ?? false, true);
  assert.deepEqual(regimenJsonFallback.args.required ?? [], []);
});

test("regimen save persists typed product metadata and primary ingredient fields", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-regimen-save-parity-",
  );

  try {
    const cli = createRegimenSaveCli();

    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      "init",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(initResult.exitCode, null);
    assert.equal(requireData(initResult.envelope).created, true);

    const regimenResult = await runInProcessJsonCli<SaveResult>(cli, [
      "regimen",
      "save",
      "Liposomal Vitamin C",
      "--slug",
      "liposomal-vitamin-c",
      "--kind",
      "supplement",
      "--status",
      "active",
      "--started-on",
      "2026-03-01",
      "--schedule",
      "with breakfast",
      "--substance",
      "Liposomal vitamin C packet",
      "--dose",
      "1",
      "--unit",
      "packet",
      "--brand",
      "LivOn Labs",
      "--manufacturer",
      "LivOn Laboratories",
      "--serving-size",
      "1 packet",
      "--ingredient-compound",
      "Vitamin C",
      "--ingredient-label",
      "Ascorbic acid",
      "--ingredient-amount",
      "500",
      "--ingredient-unit",
      "mg",
      "--ingredient-note",
      "Use with breakfast.",
      "--no-ingredient-active",
      "--group",
      "supplement",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(regimenResult.exitCode, null);
    const savedRegimen = requireData(regimenResult.envelope);
    assert.equal(savedRegimen.created, true);
    assert.match(requireSavedPath(savedRegimen), /\/supplement\//u);

    const regimenMarkdown = await readFile(
      path.join(vaultRoot, requireSavedPath(savedRegimen)),
      "utf8",
    );
    const regimenDocument = parseFrontmatterDocument(regimenMarkdown);
    assert.equal(regimenDocument.attributes.title, "Liposomal Vitamin C");
    assert.equal(regimenDocument.attributes.kind, "supplement");
    assert.equal(regimenDocument.attributes.status, "active");
    assert.equal(regimenDocument.attributes.startedOn, "2026-03-01");
    assert.equal(regimenDocument.attributes.schedule, "with breakfast");
    assert.equal(regimenDocument.attributes.substance, "Liposomal vitamin C packet");
    assert.equal(regimenDocument.attributes.dose, 1);
    assert.equal(regimenDocument.attributes.unit, "packet");
    assert.equal(regimenDocument.attributes.brand, "LivOn Labs");
    assert.equal(regimenDocument.attributes.manufacturer, "LivOn Laboratories");
    assert.equal(regimenDocument.attributes.servingSize, "1 packet");
    assert.deepEqual(regimenDocument.attributes.ingredients, [
      {
        compound: "Vitamin C",
        label: "Ascorbic acid",
        amount: 500,
        unit: "mg",
        active: false,
        note: "Use with breakfast.",
      },
    ]);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});
