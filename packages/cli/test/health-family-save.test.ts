import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Cli } from "incur";

import { initializeVault, parseFrontmatterDocument } from "@murphai/core";
import { createUnwiredVaultServices } from "@murphai/vault-usecases";

import { registerFamilyCommands } from "../src/commands/health-family-save.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import { requireData, runInProcessJsonCli } from "./cli-test-helpers.js";
import { localParallelCliTest as test } from "./local-parallel-test.js";

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

interface RawCliResult {
  exitCode: number | null;
  output: string;
}

function createFamilyCli() {
  const cli = Cli.create("vault-cli", {
    description: "family typed save test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);

  const services = createUnwiredVaultServices();
  registerFamilyCommands(cli, services);

  return cli;
}

async function runRawInProcessCli(
  cli: Cli.Cli,
  args: string[],
): Promise<RawCliResult> {
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

  return {
    exitCode,
    output: output.join("").trim(),
  };
}

async function readCommandSchema(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<CommandSchemaEnvelope> {
  const result = await runRawInProcessCli(cli, [
    ...commandArgs,
    "--schema",
    "--format",
    "json",
  ]);
  assert.equal(result.exitCode, null);

  return JSON.parse(result.output) as CommandSchemaEnvelope;
}

async function assertCommandSchemaMissing(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<void> {
  const result = await runRawInProcessCli(cli, [
    ...commandArgs,
    "--schema",
    "--format",
    "json",
  ]);

  assert.equal(result.exitCode, 1);
}

async function readCommandHelp(cli: Cli.Cli, commandArgs: string[]): Promise<string> {
  const result = await runRawInProcessCli(cli, [...commandArgs, "--help"]);
  assert.equal(result.exitCode, null);

  return result.output;
}

async function listMarkdownFiles(directory: string): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(directory, {
      withFileTypes: true,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }

  const markdownFiles: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      markdownFiles.push(...(await listMarkdownFiles(entryPath)));
    } else if (entry.name.endsWith(".md")) {
      markdownFiles.push(entryPath);
    }
  }

  return markdownFiles;
}

test("family save schema exposes typed fields while family import-json is the JSON fallback", async () => {
  const cli = createFamilyCli();

  const saveSchema = await readCommandSchema(cli, ["family", "save"]);
  assert.deepEqual(saveSchema.args.required, ["title"]);
  assert.equal("input" in saveSchema.options.properties, false);
  assert.equal(saveSchema.options.required?.includes("input") ?? false, false);

  const saveHelp = await readCommandHelp(cli, ["family", "save"]);
  assert.match(saveHelp, /family import-json/u);
  assert.doesNotMatch(saveHelp, /family upsert/u);

  for (const field of [
    "id",
    "slug",
    "relationship",
    "condition",
    "deceased",
    "relatedVariantId",
    "note",
  ]) {
    assert.equal(field in saveSchema.options.properties, true, field);
  }

  const jsonFallback = await readCommandSchema(cli, ["family", "import-json"]);
  assert.equal("input" in jsonFallback.options.properties, true);
  assert.equal(jsonFallback.options.required?.includes("input") ?? false, true);
  assert.deepEqual(jsonFallback.args.required ?? [], []);

  await assertCommandSchemaMissing(cli, ["family", "upsert"]);
});

test("family save creates and updates family members from typed flags", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-family-save-"));
  const cli = createFamilyCli();

  try {
    await initializeVault({ vaultRoot });

    const created = await runInProcessJsonCli<{
      vault: string;
      familyMemberId: string;
      lookupId: string;
      path?: string;
      created: boolean;
    }>(cli, [
      "family",
      "save",
      "Mother",
      "--relationship",
      "mother",
      "--condition",
      "hypertension",
      "--condition",
      "migraine",
      "--deceased",
      "--related-variant-id",
      "var_01JNY0B2W4VG5C2A0G9S8M7R6Q",
      "--note",
      "Maternal family history.",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(created.envelope.ok, true);
    const createdData = requireData(created.envelope);
    assert.equal(createdData.vault, vaultRoot);
    assert.equal(createdData.lookupId, createdData.familyMemberId);
    assert.equal(createdData.path, "bank/family/mother.md");
    assert.equal(createdData.created, true);
    const savedPath = createdData.path;
    if (!savedPath) {
      throw new Error("Expected family save result to include a relative path.");
    }

    const updated = await runInProcessJsonCli<{
      familyMemberId: string;
      lookupId: string;
      path?: string;
      created: boolean;
    }>(cli, [
      "family",
      "save",
      "Mother",
      "--id",
      createdData.familyMemberId,
      "--relationship",
      "mother",
      "--condition",
      "hypertension",
      "--note",
      "Updated typed note.",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(updated.envelope.ok, true);
    const updatedData = requireData(updated.envelope);
    assert.equal(updatedData.familyMemberId, createdData.familyMemberId);
    assert.equal(updatedData.lookupId, createdData.familyMemberId);
    assert.equal(updatedData.created, false);

    const updatedMarkdown = await readFile(
      path.join(vaultRoot, savedPath),
      "utf8",
    );
    const updatedDocument = parseFrontmatterDocument(updatedMarkdown);
    assert.equal(updatedDocument.attributes.familyMemberId, createdData.familyMemberId);
    assert.equal(updatedDocument.attributes.title, "Mother");
    assert.equal(updatedDocument.attributes.relationship, "mother");
    assert.deepEqual(updatedDocument.attributes.conditions, ["hypertension"]);
    assert.equal(updatedDocument.attributes.deceased, true);
    assert.deepEqual(updatedDocument.attributes.relatedVariantIds, [
      "var_01JNY0B2W4VG5C2A0G9S8M7R6Q",
    ]);
    assert.equal(updatedDocument.attributes.note, "Updated typed note.");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("family save requires a typed relationship field", async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-cli-family-save-required-"),
  );
  const cli = createFamilyCli();

  try {
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<unknown>(cli, [
      "family",
      "save",
      "Sibling",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.match(result.envelope.error.message ?? "", /relationship/u);
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("family save rejects invalid related variant ids before writing", async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-cli-family-save-invalid-variant-"),
  );
  const cli = createFamilyCli();

  try {
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<unknown>(cli, [
      "family",
      "save",
      "Parent",
      "--relationship",
      "parent",
      "--related-variant-id",
      "variant named APOE",
      "--vault",
      vaultRoot,
    ]);

    assert.notEqual(result.exitCode, null);
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.match(
        result.envelope.error.message ?? "",
        /genetic variant id matching var_<ULID>/u,
      );
    }
    assert.deepEqual(await listMarkdownFiles(path.join(vaultRoot, "bank/family")), []);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
