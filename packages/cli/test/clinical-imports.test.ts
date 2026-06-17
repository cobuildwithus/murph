import assert from "node:assert/strict";

import { Cli } from "incur";
import { test } from "vitest";

import { registerAssertionCommands } from "../src/commands/clinical-imports.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import type { CliEnvelope } from "./cli-test-helpers.js";
import { requireData } from "./cli-test-helpers.js";

function createSliceCli() {
  const cli = Cli.create("vault-cli", {
    description: "clinical import slice test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);
  registerAssertionCommands(cli);

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
      rawRefs?: string[];
    };
  }>(["assertion", "scaffold", "--vault", "/tmp/murph-clinical-imports"]);

  assert.equal(scaffoldResult.ok, true, JSON.stringify(scaffoldResult));
  assert.equal(requireData(scaffoldResult).noun, "assertion");
  assert.equal(requireData(scaffoldResult).payload.assertion, "no_known_drug_allergies");
  assert.deepEqual(requireData(scaffoldResult).payload.rawRefs, [
    "raw/documents/2026/06/synthetic-clinical-summary.pdf",
  ]);
});
