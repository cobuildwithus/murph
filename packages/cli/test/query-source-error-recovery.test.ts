import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { VAULT_LAYOUT } from "@murphai/contracts";
import { Cli } from "incur";
import { afterEach, test } from "vitest";

import { incurErrorBridge } from "../src/incur-error-bridge.js";
import { registerSearchCommands } from "../src/commands/search.js";
import {
  createTempVaultContext,
  runInProcessJsonCli,
} from "./cli-test-helpers.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, { force: true, recursive: true })
  ));
});

test("query source failures identify a safe vault-relative line without echoing content", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-query-source-invalid-",
  );
  cleanupPaths.push(parentRoot);
  const relativePath = path.posix.join(
    VAULT_LAYOUT.auditDirectory,
    "2026",
    "invalid.jsonl",
  );
  const sourcePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(
    sourcePath,
    "\nprivate-query-source-marker {not-json}\n",
    "utf8",
  );

  const cli = Cli.create("vault-cli", {
    description: "query source recovery test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);
  registerSearchCommands(cli);

  const result = await runInProcessJsonCli(cli, [
    "timeline",
    "--vault",
    vaultRoot,
  ]);

  assert.equal(result.envelope.ok, false);
  if (result.envelope.ok) {
    throw new Error("Expected malformed canonical query source to fail.");
  }
  assert.equal(result.envelope.error.code, "query_source_invalid");
  assert.equal(result.envelope.error.retryable, false);
  assert.equal(result.envelope.error.stage, "query_source");
  assert.match(result.envelope.error.message ?? "", /invalid\.jsonl:2/u);
  assert.match(result.envelope.error.hint ?? "", /Repair .*invalid\.jsonl:2/u);
  assert.doesNotMatch(JSON.stringify(result.envelope), /private-query-source-marker/u);
  assert.doesNotMatch(
    JSON.stringify(result.envelope),
    new RegExp(parentRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
  );
});
