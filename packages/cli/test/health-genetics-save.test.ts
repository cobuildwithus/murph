import assert from "node:assert/strict";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { test } from "vitest";

import { initializeVault, parseFrontmatterDocument } from "@murphai/core";
import { createUnwiredVaultServices } from "@murphai/vault-usecases";

import { registerGeneticsCommands } from "../src/commands/health-genetics-save.js";
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

interface GeneticsSaveResult {
  vault: string;
  variantId: string;
  lookupId: string;
  path?: string;
  created: boolean;
}

function createGeneticsCli() {
  const cli = Cli.create("vault-cli", {
    description: "genetics typed save test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);

  const services = createUnwiredVaultServices();
  registerGeneticsCommands(cli, services);

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

function requireSavedPath(result: GeneticsSaveResult): string {
  if (!result.path) {
    throw new Error("Expected genetics save result to include a relative path.");
  }

  return result.path;
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

test("genetics save schema exposes typed variant fields while upsert remains the JSON fallback", async () => {
  const cli = createGeneticsCli();

  const geneticsSave = await readCommandSchema(cli, ["genetics", "save"]);
  assert.deepEqual(geneticsSave.args.required, ["title"]);
  assert.equal("input" in geneticsSave.options.properties, false);
  assert.equal(geneticsSave.options.required?.includes("input") ?? false, false);
  assert.equal(geneticsSave.options.required?.includes("gene") ?? false, true);

  for (const field of [
    "id",
    "slug",
    "gene",
    "zygosity",
    "significance",
    "inheritance",
    "sourceFamilyMemberId",
    "note",
  ]) {
    assert.equal(field in geneticsSave.options.properties, true, field);
  }

  const geneticsJsonFallback = await readCommandSchema(cli, ["genetics", "upsert"]);
  assert.equal("input" in geneticsJsonFallback.options.properties, true);
  assert.equal(geneticsJsonFallback.options.required?.includes("input") ?? false, true);
  assert.deepEqual(geneticsJsonFallback.args.required ?? [], []);
});

test("genetics save persists typed fields and repeated source family members", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-genetics-save-",
  );

  try {
    const cli = createGeneticsCli();
    await initializeVault({ vaultRoot });

    const saveResult = await runInProcessJsonCli<GeneticsSaveResult>(cli, [
      "genetics",
      "save",
      "APOE e4 allele",
      "--slug",
      "apoe-e4-allele",
      "--gene",
      "APOE",
      "--zygosity",
      "heterozygous",
      "--significance",
      "risk_factor",
      "--inheritance",
      "familial risk marker",
      "--source-family-member-id",
      "fam_01JNY0B2W4VG5C2A0G9S8M7R6P",
      "--source-family-member-id",
      "fam_01JNY0B2W4VG5C2A0G9S8M7R6Q",
      "--note",
      "Typed genetics save note.",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(saveResult.exitCode, null);
    const saved = requireData(saveResult.envelope);
    assert.equal(saved.created, true);
    assert.equal(saved.lookupId, saved.variantId);
    assert.equal(saved.vault, vaultRoot);

    const relativePath = requireSavedPath(saved);
    const createdMarkdown = await readFile(path.join(vaultRoot, relativePath), "utf8");
    const createdDocument = parseFrontmatterDocument(createdMarkdown);
    assert.equal(createdDocument.attributes.variantId, saved.variantId);
    assert.equal(createdDocument.attributes.slug, "apoe-e4-allele");
    assert.equal(createdDocument.attributes.title, "APOE e4 allele");
    assert.equal(createdDocument.attributes.gene, "APOE");
    assert.equal(createdDocument.attributes.zygosity, "heterozygous");
    assert.equal(createdDocument.attributes.significance, "risk_factor");
    assert.equal(createdDocument.attributes.inheritance, "familial risk marker");
    assert.deepEqual(createdDocument.attributes.sourceFamilyMemberIds, [
      "fam_01JNY0B2W4VG5C2A0G9S8M7R6P",
      "fam_01JNY0B2W4VG5C2A0G9S8M7R6Q",
    ]);
    assert.equal(createdDocument.attributes.note, "Typed genetics save note.");

    const updateResult = await runInProcessJsonCli<GeneticsSaveResult>(cli, [
      "genetics",
      "save",
      "APOE e4 allele updated",
      "--id",
      saved.variantId,
      "--gene",
      "APOE",
      "--significance",
      "unknown",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(updateResult.exitCode, null);
    const updated = requireData(updateResult.envelope);
    assert.equal(updated.created, false);
    assert.equal(updated.variantId, saved.variantId);
    assert.equal(updated.vault, vaultRoot);

    const updatedMarkdown = await readFile(path.join(vaultRoot, relativePath), "utf8");
    const updatedDocument = parseFrontmatterDocument(updatedMarkdown);
    assert.equal(updatedDocument.attributes.title, "APOE e4 allele updated");
    assert.equal(updatedDocument.attributes.gene, "APOE");
    assert.equal(updatedDocument.attributes.significance, "unknown");
    assert.equal(updatedDocument.attributes.zygosity, "heterozygous");
    assert.deepEqual(updatedDocument.attributes.sourceFamilyMemberIds, [
      "fam_01JNY0B2W4VG5C2A0G9S8M7R6P",
      "fam_01JNY0B2W4VG5C2A0G9S8M7R6Q",
    ]);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("genetics save rejects invalid source family member ids before writing", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-genetics-save-invalid-",
  );

  try {
    const cli = createGeneticsCli();
    await initializeVault({ vaultRoot });

    const saveResult = await runInProcessJsonCli<GeneticsSaveResult>(cli, [
      "genetics",
      "save",
      "APOE e4 allele",
      "--gene",
      "APOE",
      "--source-family-member-id",
      "family member named parent",
      "--vault",
      vaultRoot,
    ]);

    assert.notEqual(saveResult.exitCode, null);
    assert.equal(saveResult.envelope.ok, false);
    if (!saveResult.envelope.ok) {
      assert.match(
        saveResult.envelope.error.message ?? "",
        /family member id matching fam_<ULID>/u,
      );
    }
    assert.deepEqual(
      await listMarkdownFiles(path.join(vaultRoot, "bank/genetics")),
      [],
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("genetics save rejects invalid variant ids before writing", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-genetics-save-invalid-id-",
  );

  try {
    const cli = createGeneticsCli();
    await initializeVault({ vaultRoot });

    const saveResult = await runInProcessJsonCli<GeneticsSaveResult>(cli, [
      "genetics",
      "save",
      "APOE e4 allele",
      "--gene",
      "APOE",
      "--id",
      "not-a-variant-id",
      "--vault",
      vaultRoot,
    ]);

    assert.notEqual(saveResult.exitCode, null);
    assert.equal(saveResult.envelope.ok, false);
    if (!saveResult.envelope.ok) {
      assert.equal(saveResult.envelope.error.code, "VALIDATION_ERROR");
      assert.match(
        saveResult.envelope.error.message ?? "",
        /genetic variant id matching var_<ULID>/u,
      );
    }
    assert.deepEqual(
      await listMarkdownFiles(path.join(vaultRoot, "bank/genetics")),
      [],
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});
