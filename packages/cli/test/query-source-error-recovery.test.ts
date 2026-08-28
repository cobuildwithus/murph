import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { VAULT_LAYOUT } from "@murphai/contracts";
import { initializeVault } from "@murphai/core";
import { createIntegratedVaultServices } from "@murphai/vault-usecases";
import { Cli } from "incur";
import { afterEach, test } from "vitest";

import { incurErrorBridge } from "../src/incur-error-bridge.js";
import { registerSearchCommands } from "../src/commands/search.js";
import { registerScheduledLogCommands } from "../src/commands/scheduled-log.js";
import { registerVaultCommands } from "../src/commands/vault.js";
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
  const malformedSource = "\nprivate-query-source-marker {not-json}\n";
  await writeFile(sourcePath, malformedSource, "utf8");

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
  assert.equal(await readFile(sourcePath, "utf8"), malformedSource);
});

test("service-backed Query failures preserve terminal unsupported-format recovery without writing", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-query-source-unsupported-service-",
  );
  cleanupPaths.push(parentRoot);
  await initializeVault({ vaultRoot });

  const metadataPath = path.join(vaultRoot, VAULT_LAYOUT.metadata);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
  metadata.formatVersion = 999_999;
  metadata.title = "private-unsupported-format-marker";
  const unsupportedSource = `${JSON.stringify(metadata, null, 2)}\n`;
  await writeFile(metadataPath, unsupportedSource, "utf8");

  const cli = Cli.create("vault-cli", {
    description: "query source recovery service test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);
  registerVaultCommands(cli, createIntegratedVaultServices());

  const result = await runInProcessJsonCli(cli, [
    "vault",
    "stats",
    "--vault",
    vaultRoot,
  ]);

  assert.equal(result.envelope.ok, false);
  if (result.envelope.ok) {
    throw new Error("Expected unsupported canonical vault format to fail.");
  }
  assert.deepEqual(result.envelope.error, {
    code: "unsupported_format",
    message: "Canonical vault source vault.json uses an unsupported format.",
    retryable: false,
    hint:
      "Use a compatible Murph runtime or a supported Murph migration path, then rerun the command. Do not edit vault.json manually.",
    stage: "query_source",
  });
  assert.doesNotMatch(JSON.stringify(result.envelope), /private-unsupported-format-marker/u);
  assert.doesNotMatch(
    JSON.stringify(result.envelope),
    new RegExp(parentRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
  );
  assert.equal(await readFile(metadataPath, "utf8"), unsupportedSource);
});

test("scheduled-log ownership preserves terminal stored-registry recovery without writing", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-query-source-markdown-direct-",
  );
  cleanupPaths.push(parentRoot);
  await initializeVault({ vaultRoot });

  const relativePath = path.posix.join(
    VAULT_LAYOUT.scheduledLogsDirectory,
    "invalid.md",
  );
  const sourcePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  const malformedSource = `---
title: Private title
private-markdown-source-marker
---

Private body.
`;
  await writeFile(sourcePath, malformedSource, "utf8");

  const cli = Cli.create("vault-cli", {
    description: "query source recovery direct test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);
  registerScheduledLogCommands(cli);

  const result = await runInProcessJsonCli(cli, [
    "scheduled-log",
    "list",
    "--vault",
    vaultRoot,
  ]);

  assert.equal(result.envelope.ok, false);
  if (result.envelope.ok) {
    throw new Error("Expected malformed canonical Markdown to fail.");
  }
  assert.deepEqual(result.envelope.error, {
    code: "invalid_registry",
    message:
      "Stored scheduled-log registry data is invalid. Stop without retrying or writing scheduled logs and report that operator repair is required.",
    retryable: false,
    hint:
      "Stop without retrying or writing scheduled logs and report that operator repair is required.",
    stage: "read",
  });
  assert.doesNotMatch(JSON.stringify(result.envelope), /private-markdown-source-marker|Private title|Private body/u);
  assert.doesNotMatch(
    JSON.stringify(result.envelope),
    new RegExp(parentRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
  );
  assert.equal(await readFile(sourcePath, "utf8"), malformedSource);
});
