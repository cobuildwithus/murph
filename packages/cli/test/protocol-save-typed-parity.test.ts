import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { test } from "vitest";

import { parseFrontmatterDocument } from "@murphai/core";
import {
  createIntegratedVaultServices,
  type VaultServices,
} from "@murphai/vault-usecases";

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
  output?: {
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface SavedEntitySnapshot {
  id: string;
  kind: string;
  title: string | null;
  occurredAt: string | null;
  path: string | null;
  data: Record<string, unknown>;
  links: Array<Record<string, unknown>>;
  markdown?: never;
}

interface SaveResult {
  vault: string;
  regimenId: string;
  lookupId: string;
  path?: string;
  created: boolean;
  entity: SavedEntitySnapshot;
}

interface ImportJsonResult {
  vault: string;
  regimenId: string;
  lookupId: string;
  path?: string;
  created: boolean;
  entity?: never;
}

function assertCompactSavedEntity(entity: SavedEntitySnapshot) {
  assert.equal("markdown" in entity, false);
  for (const field of ["body", "markdown", "path", "relativePath"]) {
    assert.equal(field in entity.data, false, field);
  }
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

function createProtocolListCli(services: VaultServices) {
  const cli = Cli.create("vault-cli", {
    description: "protocol list test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);
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
  assert.equal(regimenSave.output?.required?.includes("entity") ?? false, true);
  assert.equal(regimenSave.output ? "entity" in regimenSave.output.properties : false, true);

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
  assert.equal(regimenJsonFallback.output?.required?.includes("entity") ?? false, false);
  assert.equal(
    regimenJsonFallback.output ? "entity" in regimenJsonFallback.output.properties : false,
    false,
  );
  assert.deepEqual(regimenJsonFallback.args.required ?? [], []);
});

test("protocol list forwards commons-protocol filtering to the query service before limiting", async () => {
  const calls: Array<{ commonsProtocol?: string; limit?: number }> = [];
  const cli = createProtocolListCli({
    query: {
      async listPrivateProtocols(
        input: Parameters<VaultServices["query"]["listPrivateProtocols"]>[0],
      ) {
        calls.push({
          commonsProtocol: input.commonsProtocol,
          limit: input.limit,
        });
        return {
          vault: input.vault,
          filters: {
            commonsProtocol: input.commonsProtocol,
            limit: input.limit ?? 50,
          },
          protocols: [],
          count: 0,
          nextCursor: null,
        };
      },
    },
  } as unknown as VaultServices);

  const result = await runInProcessJsonCli(cli, [
    "protocol",
    "list",
    "--commons-protocol",
    "hc:protocol/demo",
    "--limit",
    "25",
    "--vault",
    "/tmp/vault",
  ]);

  assert.equal(result.exitCode, null);
  assert.deepEqual(calls, [
    {
      commonsProtocol: "hc:protocol/demo",
      limit: 25,
    },
  ]);
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
    assert.equal(savedRegimen.vault, vaultRoot);
    assert.equal(savedRegimen.created, true);
    assert.equal(savedRegimen.lookupId, savedRegimen.regimenId);
    const relativePath = requireSavedPath(savedRegimen);
    assert.match(relativePath, /\/supplement\//u);
    assert.equal(savedRegimen.entity.id, savedRegimen.regimenId);
    assert.equal(savedRegimen.entity.kind, "regimen");
    assert.equal(savedRegimen.entity.title, "Liposomal Vitamin C");
    assert.equal(savedRegimen.entity.occurredAt, null);
    assert.equal(savedRegimen.entity.path, relativePath);
    assertCompactSavedEntity(savedRegimen.entity);
    assert.equal(savedRegimen.entity.data.kind, "supplement");
    assert.equal(savedRegimen.entity.data.brand, "LivOn Labs");
    assert.equal(savedRegimen.entity.data.manufacturer, "LivOn Laboratories");
    assert.equal(savedRegimen.entity.data.servingSize, "1 packet");
    assert.equal(savedRegimen.entity.data.schedule, "with breakfast");
    assert.equal(savedRegimen.entity.data.dose, 1);
    assert.equal(savedRegimen.entity.data.unit, "packet");
    assert.deepEqual(savedRegimen.entity.data.ingredients, [
      {
        compound: "Vitamin C",
        label: "Ascorbic acid",
        amount: 500,
        unit: "mg",
        active: false,
        note: "Use with breakfast.",
      },
    ]);

    const regimenMarkdown = await readFile(
      path.join(vaultRoot, relativePath),
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

test("regimen import-json runtime output stays sparse without entity snapshots", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-regimen-import-sparse-",
  );
  const regimenPayloadPath = path.join(parentRoot, "regimen.json");

  try {
    const cli = createRegimenSaveCli();

    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      "init",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(initResult.exitCode, null);
    assert.equal(requireData(initResult.envelope).created, true);

    await writeFile(
      regimenPayloadPath,
      JSON.stringify(
        {
          title: "Morning light walk",
          kind: "habit",
          status: "active",
          schedule: "10 minutes after waking",
        },
        null,
        2,
      ),
      "utf8",
    );

    const importResult = await runInProcessJsonCli<ImportJsonResult>(cli, [
      "regimen",
      "import-json",
      "--input",
      `@${regimenPayloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(importResult.exitCode, null);
    const imported = requireData(importResult.envelope);
    assert.equal(imported.vault, vaultRoot);
    assert.equal(imported.created, true);
    assert.equal(imported.lookupId, imported.regimenId);
    assert.equal(typeof imported.path, "string");
    assert.equal("entity" in imported, false);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});
