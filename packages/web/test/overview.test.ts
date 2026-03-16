import assert from "node:assert/strict";
import path from "node:path";

import { test } from "vitest";

import { loadVaultOverview } from "../src/lib/overview";
import {
  buildSuggestedCommand,
  FIXTURE_VAULT_EXAMPLE,
  getConfiguredVaultRoot,
  HEALTHYBOB_VAULT_ENV,
} from "../src/lib/vault";
import { createWebFixtureVault, destroyWebFixtureVault } from "./web-fixture";

test("getConfiguredVaultRoot resolves relative paths from the web package cwd", () => {
  const resolved = getConfiguredVaultRoot(
    {
      [HEALTHYBOB_VAULT_ENV]: "../../fixtures/minimal-vault",
    },
    "/repo/packages/web",
  );

  assert.equal(resolved, "/repo/fixtures/minimal-vault");
  assert.equal(buildSuggestedCommand(), `${HEALTHYBOB_VAULT_ENV}=${FIXTURE_VAULT_EXAMPLE} pnpm dev`);
});

test("loadVaultOverview reports missing config when no vault root is set", async () => {
  const result = await loadVaultOverview();

  assert.equal(result.status, "missing-config");
  assert.equal(result.envVar, HEALTHYBOB_VAULT_ENV);
  assert.match(result.suggestedCommand, /pnpm dev/);
});

test("loadVaultOverview summarizes a readable vault without leaking source paths", async () => {
  const vaultRoot = await createWebFixtureVault();

  try {
    const result = await loadVaultOverview({
      query: "sleep",
      sampleLimit: 3,
      timelineLimit: 4,
      vaultRoot,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.metrics.find((metric) => metric.label === "records")?.value, 10);
    assert.equal(result.currentProfile?.topGoalIds[0], "goal_sleep_01");
    assert.equal(result.sampleSummaries[0]?.stream, "glucose");
    assert.equal(result.search?.query, "sleep");
    assert.ok((result.search?.total ?? 0) >= 1);
    assert.equal(result.timeline.length, 4);

    const uniquePathToken = path.basename(vaultRoot).split("-").at(-1) ?? path.basename(vaultRoot);
    const pathProbe = await loadVaultOverview({
      query: uniquePathToken,
      vaultRoot,
    });

    assert.equal(pathProbe.status, "ready");
    assert.equal(pathProbe.search?.total, 0);

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(vaultRoot), false);
    assert.equal(serialized.includes("ledger/events/2026/2026-03.jsonl"), false);
  } finally {
    await destroyWebFixtureVault(vaultRoot);
  }
});

test("loadVaultOverview returns a safe error payload when the vault root is unreadable", async () => {
  const vaultRoot = await createWebFixtureVault();

  try {
    const unreadableVaultRoot = path.join(vaultRoot, "vault.json");
    const result = await loadVaultOverview({
      query: "sleep",
      vaultRoot: unreadableVaultRoot,
    });

    assert.equal(result.status, "error");
    assert.equal(result.message, "The configured vault could not be read.");
    assert.equal(result.recoveryCommand.includes(unreadableVaultRoot), false);
    assert.equal(JSON.stringify(result).includes(unreadableVaultRoot), false);
  } finally {
    await destroyWebFixtureVault(vaultRoot);
  }
});
