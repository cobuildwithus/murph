import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";

import { loadVaultOverview } from "../src/lib/overview";
import {
  buildSuggestedCommand,
  buildExampleVaultPath,
  FIXTURE_VAULT_EXAMPLE,
  getConfiguredVaultRoot,
  HEALTHYBOB_VAULT_ENV,
  HEALTHYBOB_WEB_LAUNCH_CWD_ENV,
  rememberLaunchCwd,
} from "../src/lib/vault";
import { createWebFixtureVault, destroyWebFixtureVault } from "./web-fixture";

async function writeFixtureFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  await mkdir(path.dirname(path.join(vaultRoot, relativePath)), {
    recursive: true,
  });
  await writeFile(path.join(vaultRoot, relativePath), contents, "utf8");
}

test("getConfiguredVaultRoot resolves relative paths from the launch cwd when preserved", () => {
  const resolved = getConfiguredVaultRoot(
    {
      [HEALTHYBOB_VAULT_ENV]: "fixtures/demo-web-vault",
      [HEALTHYBOB_WEB_LAUNCH_CWD_ENV]: "/repo",
    },
    "/repo/packages/web",
  );

  assert.equal(resolved, "/repo/fixtures/demo-web-vault");
  assert.equal(buildExampleVaultPath({
    [HEALTHYBOB_WEB_LAUNCH_CWD_ENV]: "/repo",
  }, "/repo/packages/web"), "fixtures/demo-web-vault");
  assert.equal(
    buildSuggestedCommand(
      {
        [HEALTHYBOB_WEB_LAUNCH_CWD_ENV]: "/repo",
      },
      "/repo/packages/web",
    ),
    `${HEALTHYBOB_VAULT_ENV}=fixtures/demo-web-vault pnpm web:dev`,
  );
});

test("buildSuggestedCommand keeps the package-local example for direct package runs", () => {
  assert.equal(buildSuggestedCommand(), `${HEALTHYBOB_VAULT_ENV}=${FIXTURE_VAULT_EXAMPLE} pnpm dev`);
});

test("rememberLaunchCwd stores the first launch cwd only", () => {
  const env: Record<string, string | undefined> = {};

  rememberLaunchCwd(env, "/repo");
  rememberLaunchCwd(env, "/repo/packages/web");

  assert.equal(env[HEALTHYBOB_WEB_LAUNCH_CWD_ENV], "/repo");
});

test("rememberLaunchCwd prefers INIT_CWD for package-local pnpm runs", () => {
  const env: Record<string, string | undefined> = {
    HEALTHYBOB_VAULT: "../../fixtures/demo-web-vault",
    INIT_CWD: "/repo/packages/web",
  };

  rememberLaunchCwd(env, "/repo");

  assert.equal(env[HEALTHYBOB_WEB_LAUNCH_CWD_ENV], "/repo/packages/web");
  assert.equal(getConfiguredVaultRoot(env, "/repo/packages/web"), "/repo/fixtures/demo-web-vault");
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
    assert.equal(result.currentProfile?.topGoals[0]?.title, "Protect sleep consistency");
    assert.equal(result.currentProfile?.summary?.includes("#"), false);
    assert.equal(result.recentJournals[0]?.title, "March 12");
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

test("loadVaultOverview reuses shared tokenization while keeping overview search path-safe", async () => {
  const vaultRoot = await createWebFixtureVault();

  try {
    await writeFixtureFile(
      vaultRoot,
      "bank/experiments/post-run-unicode-probe.md",
      `---
schemaVersion: hv/experiment@v1
experimentId: exp_search_probe_01
slug: recovery-probe
title: Recovery Probe
status: active
startedOn: 2026-03-13
tags:
  - recovery
---
# Recovery Probe

Post-run 睡眠 felt steadier after stretching.
`,
    );
    await writeFixtureFile(
      vaultRoot,
      "bank/experiments/path-only-token-probe.md",
      `---
schemaVersion: hv/experiment@v1
experimentId: exp_path_probe_01
slug: quiet-probe
title: Quiet Probe
status: active
startedOn: 2026-03-13
---
# Quiet Probe

Ordinary notes without the filename token.
`,
    );

    const hyphenated = await loadVaultOverview({
      query: "post-run",
      vaultRoot,
    });
    assert.equal(hyphenated.status, "ready");
    assert.equal(hyphenated.search?.total, 1);
    assert.equal(hyphenated.search?.hits[0]?.title, "Recovery Probe");

    const unicode = await loadVaultOverview({
      query: "睡眠",
      vaultRoot,
    });
    assert.equal(unicode.status, "ready");
    assert.equal(unicode.search?.total, 1);
    assert.equal(unicode.search?.hits[0]?.title, "Recovery Probe");

    const oneCharacter = await loadVaultOverview({
      query: "a",
      vaultRoot,
    });
    assert.equal(oneCharacter.status, "ready");
    assert.equal(oneCharacter.search?.total, 0);

    const pathProbe = await loadVaultOverview({
      query: "path-only-token-probe",
      vaultRoot,
    });
    assert.equal(pathProbe.status, "ready");
    assert.equal(pathProbe.search?.total, 0);
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

test("loadVaultOverview returns an error when the vault root does not exist", async () => {
  const result = await loadVaultOverview({
    vaultRoot: "/definitely/not/a/vault",
  });

  assert.equal(result.status, "error");
  assert.equal(result.recoveryCommand.includes("/definitely/not/a/vault"), false);
});
