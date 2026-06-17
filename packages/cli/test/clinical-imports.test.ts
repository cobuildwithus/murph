import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import { Cli } from "incur";
import { afterEach, test } from "vitest";

import {
  registerAssertionCommands,
  registerSocialHistoryCommands,
} from "../src/commands/clinical-imports.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import type { CliEnvelope } from "./cli-test-helpers.js";
import { requireData } from "./cli-test-helpers.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((targetPath) => rm(targetPath, { recursive: true, force: true })),
  );
});

function createSliceCli() {
  const cli = Cli.create("vault-cli", {
    description: "clinical import slice test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);
  registerAssertionCommands(cli);
  registerSocialHistoryCommands(cli);

  return cli;
}

async function runSliceCli<TData>(args: string[]): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli();
  const output: string[] = [];

  await cli.serve([...args, "--full-output", "--format", "json"], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk);
    },
  });

  return JSON.parse(output.join("").trim()) as CliEnvelope<TData>;
}

function requireRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);

  return value as Record<string, unknown>;
}

function requireUnionBranches(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    assert.fail("Expected JSON Schema union branches.");
  }

  return value;
}

function schemaBranchRequires(branch: unknown, property: string): boolean {
  const required = requireRecord(branch).required;

  return Array.isArray(required) && required.includes(property);
}

type ClinicalImportCliResult = {
  vault: string;
  eventIds: string[];
  lookupId?: string;
  ledgerFiles: string[];
  auditPaths: string[];
};

test("clinical import payload-schema command emits the writable JSON contract", async () => {
  const schemaResult = await runSliceCli<{
    command: string;
    mediaType: string;
    schemaName: string;
    schema: {
      type?: string;
      properties?: Record<string, unknown>;
    };
  }>(["assertion", "payload-schema"]);

  assert.equal(schemaResult.ok, true, JSON.stringify(schemaResult));
  const schemaData = requireData(schemaResult);
  assert.equal(schemaData.command, "assertion import-json");
  assert.equal(schemaData.mediaType, "application/json");
  assert.equal(schemaData.schemaName, "assertion-import-payload");
  assert.equal(schemaData.schema.type, "object");
  assert.equal("assertion" in (schemaData.schema.properties ?? {}), true);
  assert.equal("externalRef" in (schemaData.schema.properties ?? {}), true);
  assert.equal("eventId" in (schemaData.schema.properties ?? {}), false);
  assert.equal(
    (requireRecord(schemaData.schema).required as unknown[] | undefined)?.includes("externalRef"),
    true,
  );

  const evidenceProperty = requireRecord(requireRecord(schemaData.schema.properties).evidence);
  const evidenceItems = requireRecord(evidenceProperty.items);
  const evidenceBranches = requireUnionBranches(evidenceItems.anyOf ?? evidenceItems.oneOf);
  assert.equal(
    evidenceBranches.some((branch) => schemaBranchRequires(branch, "sourceDocumentId")),
    true,
  );
  assert.equal(
    evidenceBranches.some((branch) => schemaBranchRequires(branch, "rawRef")),
    true,
  );

  const scaffoldResult = await runSliceCli<{
    vault: string;
    noun: string;
    payload: {
      assertion: string;
      externalRef?: unknown;
      rawRefs?: string[];
    };
  }>(["assertion", "scaffold", "--vault", "/tmp/murph-clinical-imports"]);

  assert.equal(scaffoldResult.ok, true, JSON.stringify(scaffoldResult));
  assert.equal(requireData(scaffoldResult).noun, "assertion");
  assert.equal(requireData(scaffoldResult).payload.assertion, "no_known_drug_allergies");
  assert.notEqual(requireData(scaffoldResult).payload.externalRef, undefined);
  assert.deepEqual(requireData(scaffoldResult).payload.rawRefs, [
    "raw/documents/2026/06/synthetic-clinical-summary.pdf",
  ]);
});

test("social-history import-json retries return a schema-valid no-op result", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-cli-social-history-"));
  cleanupPaths.push(vaultRoot);
  await initializeVault({
    vaultRoot,
    createdAt: "2026-06-17T12:00:00.000Z",
    timezone: "America/New_York",
  });

  const inputFile = path.join(vaultRoot, "social-history.json");
  const inputArg = `@${inputFile}`;
  await writeFile(inputFile, `${JSON.stringify({
    occurredAt: "2026-06-17T17:00:00.000Z",
    source: "import",
    entries: [{
      category: "tobacco",
      status: "former",
      statement: "Synthetic former tobacco statement.",
      externalRef: {
        system: "synthetic-pdf",
        resourceType: "social-history-entry",
        resourceId: "synthetic-clinical-summary",
        facet: "tobacco",
      },
      substance: "tobacco",
    }],
  })}\n`, "utf8");

  const firstImport = await runSliceCli<ClinicalImportCliResult>([
    "social-history",
    "import-json",
    "--vault",
    vaultRoot,
    "--input",
    inputArg,
  ]);
  assert.equal(firstImport.ok, true, JSON.stringify(firstImport));
  assert.equal(requireData(firstImport).eventIds.length, 1);
  assert.equal(typeof requireData(firstImport).lookupId, "string");

  const retryImport = await runSliceCli<ClinicalImportCliResult>([
    "social-history",
    "import-json",
    "--vault",
    vaultRoot,
    "--input",
    inputArg,
  ]);
  assert.equal(retryImport.ok, true, JSON.stringify(retryImport));
  assert.deepEqual(requireData(retryImport).eventIds, []);
  assert.equal("lookupId" in requireData(retryImport), false);
});
