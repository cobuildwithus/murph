import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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

test("habitat save validates calendar dates at the option owner without writing or echoing input", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-cli-habitat-");

  try {
    await initializeVault({ vaultRoot });
    const cli = createHabitatCli();
    const invalid = await runInProcessJsonCli(cli, [
      "habitat",
      "save",
      "sleep-environment",
      "--indicator",
      "window_at_night=open",
      "--recorded-at",
      "2026-02-30",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(invalid.envelope.ok, false);
    if (invalid.envelope.ok) {
      assert.fail("expected the invalid calendar date to fail");
    }
    assert.equal(invalid.envelope.error.code, "contract_invalid");
    assert.equal(invalid.envelope.error.stage, "validation");
    assert.equal(invalid.envelope.error.retryable, false);
    assert.equal(invalid.envelope.error.fieldErrors?.[0]?.path, "recordedAt");
    assert.equal(invalid.envelope.error.hint, undefined);
    assert.equal(JSON.stringify(invalid.envelope).includes("2026-02-30"), false);
    assert.equal(JSON.stringify(invalid.envelope).includes(vaultRoot), false);
    await assert.rejects(
      () => readFile(path.join(vaultRoot, "bank", "habitat", "sleep-environment.md")),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "ENOENT",
    );

    const validLeapDate = await runInProcessJsonCli(cli, [
      "habitat",
      "save",
      "sleep-environment",
      "--indicator",
      "window_at_night=open",
      "--recorded-at",
      "2024-02-29",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(validLeapDate.envelope.ok, true);

    const invalidNonLeapDate = await runInProcessJsonCli(cli, [
      "habitat",
      "save",
      "home-location",
      "--indicator",
      "location=Boston",
      "--recorded-at",
      "2026-02-29",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(invalidNonLeapDate.envelope.ok, false);
    if (invalidNonLeapDate.envelope.ok) {
      assert.fail("expected the non-leap date to fail");
    }
    assert.equal(invalidNonLeapDate.envelope.error.stage, "validation");
    assert.equal(invalidNonLeapDate.envelope.error.fieldErrors?.[0]?.path, "recordedAt");
    assert.equal(JSON.stringify(invalidNonLeapDate.envelope).includes("2026-02-29"), false);
    await assert.rejects(
      () => readFile(path.join(vaultRoot, "bank", "habitat", "home-location.md")),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "ENOENT",
    );
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("habitat commands map unknown and missing aspects to bounded recovery fields", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-cli-habitat-");
  const privateAspect = "private-unknown-aspect";
  const privateLookup = "private-missing-lookup";

  try {
    await initializeVault({ vaultRoot });
    const cli = createHabitatCli();
    const unknown = await runInProcessJsonCli(cli, [
      "habitat",
      "save",
      privateAspect,
      "--vault",
      vaultRoot,
    ]);
    const missing = await runInProcessJsonCli(cli, [
      "habitat",
      "show",
      privateLookup,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(unknown.envelope.ok, false);
    assert.equal(missing.envelope.ok, false);
    if (unknown.envelope.ok || missing.envelope.ok) {
      assert.fail("expected unknown and missing habitat aspects to fail");
    }
    assert.equal(unknown.envelope.error.code, "contract_invalid");
    assert.equal(unknown.envelope.error.stage, "validation");
    assert.equal(unknown.envelope.error.fieldErrors?.[0]?.path, "aspect");
    assert.equal(unknown.envelope.error.hint, undefined);
    assert.equal(unknown.envelope.error.retryable, false);
    assert.equal(missing.envelope.error.code, "not_found");
    assert.equal(missing.envelope.error.stage, "read");
    assert.equal(missing.envelope.error.fieldErrors?.[0]?.path, "lookup");
    assert.equal(missing.envelope.error.hint, undefined);
    assert.equal(missing.envelope.error.retryable, false);

    const encoded = JSON.stringify([unknown.envelope, missing.envelope]);
    for (const forbidden of [privateAspect, privateLookup, vaultRoot]) {
      assert.equal(encoded.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("habitat save rejects precise submitted locations without a write or value echo", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-cli-habitat-");
  const privateLocation = "4187 Example Street, unit 93, Exampleville 00000";

  try {
    await initializeVault({ vaultRoot });
    const cli = createHabitatCli();
    const result = await runInProcessJsonCli(cli, [
      "habitat",
      "save",
      "home-location",
      "--indicator",
      `location=${privateLocation}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.envelope.ok, false);
    if (result.envelope.ok) {
      assert.fail("expected the precise submitted location to fail");
    }
    assert.equal(result.envelope.error.code, "contract_invalid");
    assert.equal(result.envelope.error.stage, "validation");
    assert.equal(result.envelope.error.retryable, false);
    assert.equal(result.envelope.error.fieldErrors?.[0]?.path, "indicator");
    assert.equal(result.envelope.error.hint, undefined);
    assert.match(result.envelope.error.message ?? "", /Submitted habitat input/u);
    assert.doesNotMatch(result.envelope.error.message ?? "", /saved habitat record/u);
    await assert.rejects(
      () => readFile(path.join(vaultRoot, "bank", "habitat", "home-location.md")),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "ENOENT",
    );
    const encoded = JSON.stringify(result.envelope);
    for (const forbidden of [privateLocation, vaultRoot]) {
      assert.equal(encoded.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("habitat save reports stored corruption before repairing already-valid input", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-habitat-",
  );
  const privateMarker = "private-existing-habitat-marker";
  const submittedLocation = "Boston";

  try {
    await initializeVault({ vaultRoot });
    const habitatRoot = path.join(vaultRoot, "bank", "habitat");
    await mkdir(habitatRoot, { recursive: true });
    await writeFile(
      path.join(habitatRoot, "sleep-environment.md"),
      [
        "---",
        "schemaVersion: murph.frontmatter.habitat.v1",
        "docType: habitat",
        `privateMarker: ${privateMarker}`,
        "---",
        "",
      ].join("\n"),
    );

    const result = await runInProcessJsonCli(createHabitatCli(), [
      "habitat",
      "save",
      "home-location",
      "--indicator",
      `location=${submittedLocation}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.envelope.ok, false);
    if (result.envelope.ok) {
      assert.fail("expected existing habitat corruption to block the valid save");
    }
    assert.equal(result.envelope.error.code, "contract_invalid");
    assert.equal(result.envelope.error.retryable, false);
    assert.equal(result.envelope.error.fieldErrors?.[0]?.path, "$");
    assert.equal(result.envelope.error.hint, undefined);
    assert.match(result.envelope.error.message ?? "", /saved habitat record/u);
    assert.doesNotMatch(result.envelope.error.message ?? "", /submitted habitat input/u);
    await assert.rejects(
      () => readFile(path.join(habitatRoot, "home-location.md")),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "ENOENT",
    );
    const encoded = JSON.stringify(result.envelope);
    for (const forbidden of [
      privateMarker,
      submittedLocation,
      "sleep-environment.md",
      vaultRoot,
    ]) {
      assert.equal(encoded.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(parentRoot, { force: true, recursive: true });
  }
});

test("habitat reads classify invalid saved frontmatter as terminal without exposing record data", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext("murph-cli-habitat-");
  const privateMarker = "private-habitat-frontmatter-marker";

  try {
    await initializeVault({ vaultRoot });
    const habitatRoot = path.join(vaultRoot, "bank", "habitat");
    await mkdir(habitatRoot, { recursive: true });
    await writeFile(
      path.join(habitatRoot, "sleep-environment.md"),
      [
        "---",
        "schemaVersion: murph.frontmatter.habitat.v1",
        "docType: habitat",
        `privateMarker: ${privateMarker}`,
        "---",
        "",
      ].join("\n"),
    );

    const cli = createHabitatCli();
    for (const args of [
      ["habitat", "list", "--vault", vaultRoot],
      ["habitat", "show", "sleep-environment", "--vault", vaultRoot],
    ]) {
      const result = await runInProcessJsonCli(cli, args);

      assert.equal(result.envelope.ok, false);
      if (result.envelope.ok) {
        assert.fail("expected malformed habitat record to fail");
      }
      assert.equal(result.envelope.error.code, "contract_invalid");
      assert.equal(result.envelope.error.stage, "read");
      assert.equal(result.envelope.error.retryable, false);
      assert.equal(result.envelope.error.fieldErrors?.[0]?.path, "$");
      assert.equal(result.envelope.error.hint, undefined);
      assert.match(result.envelope.error.message ?? "", /saved habitat record/u);
      const encoded = JSON.stringify(result.envelope);
      for (const forbidden of [privateMarker, "sleep-environment.md", vaultRoot]) {
        assert.equal(encoded.includes(forbidden), false, forbidden);
      }
    }
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
