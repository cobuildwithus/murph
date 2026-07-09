import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { Cli } from "incur";
import { test } from "vitest";

import { initializeVault } from "@murphai/core";

import { registerHabitatCommands } from "../src/commands/habitat.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from "./cli-test-helpers.js";

interface HabitatListResult {
  items: Array<{
    aspect: string;
    knownIndicators: number;
  }>;
}

interface HabitatCoverageCounts {
  known: number;
  stale: number;
  declined: number;
  unknown: number;
  total: number;
}

interface HabitatCoverageResult {
  counts: HabitatCoverageCounts;
  domains: Array<{
    domain: string;
    counts: HabitatCoverageCounts;
  }>;
}

function createHabitatCli() {
  const cli = Cli.create("vault-cli", {
    description: "habitat command test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);
  registerHabitatCommands(cli);

  return cli;
}

function requireErrorMessage(result: Awaited<ReturnType<typeof runInProcessJsonCli>>): string {
  assert.equal(result.exitCode, 1);
  assert.equal(result.envelope.ok, false);

  return result.envelope.error.message ?? "";
}

test("habitat save validates indicator ids before sentinel handling", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-cli-habitat-");

  try {
    await initializeVault({ vaultRoot });
    const cli = createHabitatCli();
    const result = await runInProcessJsonCli(cli, [
      "habitat",
      "save",
      "sleep-environment",
      "--indicator",
      "standing_desk=null",
      "--vault",
      vaultRoot,
    ]);

    assert.match(
      requireErrorMessage(result),
      /Indicator "standing_desk" is not part of habitat aspect "sleep-environment"/u,
    );
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("habitat save reports catalog value errors before the core write boundary", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-cli-habitat-");

  try {
    await initializeVault({ vaultRoot });
    const cli = createHabitatCli();
    const enumResult = await runInProcessJsonCli(cli, [
      "habitat",
      "save",
      "sleep-environment",
      "--indicator",
      "darkness=pitch-black",
      "--vault",
      vaultRoot,
    ]);
    const numericResult = await runInProcessJsonCli(cli, [
      "habitat",
      "save",
      "sleep-environment",
      "--indicator",
      "night_temp_c=Infinity",
      "--vault",
      vaultRoot,
    ]);

    assert.match(requireErrorMessage(enumResult), /Expected one of: blackout, partial, bright/u);
    assert.match(requireErrorMessage(numericResult), /expects a number, got "Infinity"/u);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("habitat list counts declined indicators separately from known values", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-cli-habitat-");

  try {
    await initializeVault({ vaultRoot });
    const cli = createHabitatCli();
    const saved = await runInProcessJsonCli(cli, [
      "habitat",
      "save",
      "sleep-environment",
      "--indicator",
      "window_at_night=open",
      "--indicator",
      "co2_meter=declined",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);

    const list = await runInProcessJsonCli<HabitatListResult>(cli, [
      "habitat",
      "list",
      "--vault",
      vaultRoot,
    ]);
    const item = requireData(list.envelope).items.find(
      (record) => record.aspect === "sleep-environment",
    );

    assert.equal(item?.knownIndicators, 1);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("habitat coverage domain filter returns filtered counts", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-cli-habitat-");

  try {
    await initializeVault({ vaultRoot });
    const cli = createHabitatCli();
    const saved = await runInProcessJsonCli(cli, [
      "habitat",
      "save",
      "sleep-environment",
      "--indicator",
      "window_at_night=open",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(saved.exitCode, null);

    const coverage = await runInProcessJsonCli<HabitatCoverageResult>(cli, [
      "habitat",
      "coverage",
      "--domain",
      "workspace",
      "--vault",
      vaultRoot,
    ]);
    const data = requireData(coverage.envelope);

    assert.equal(data.domains.length, 1);
    assert.equal(data.domains[0]?.domain, "workspace");
    assert.deepEqual(data.counts, data.domains[0]?.counts);
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});
