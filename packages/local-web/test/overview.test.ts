import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test as baseTest, vi } from "vitest";

import { loadVaultOverview } from "../src/lib/overview";
import {
  buildSuggestedCommand,
  buildExampleVaultPath,
  FIXTURE_VAULT_EXAMPLE,
  getConfiguredVaultRoot,
  VAULT_ENV,
  WEB_LAUNCH_CWD_ENV,
  rememberLaunchCwd,
  resolveConfiguredVaultRoot,
} from "../src/lib/vault";
import { createWebFixtureVault, destroyWebFixtureVault } from "./web-fixture";

const test = baseTest.sequential;

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
      [VAULT_ENV]: "fixtures/demo-web-vault",
      [WEB_LAUNCH_CWD_ENV]: "/repo",
    },
    "/repo/packages/local-web",
  );

  assert.equal(resolved, "/repo/fixtures/demo-web-vault");
  assert.equal(buildExampleVaultPath({
    [WEB_LAUNCH_CWD_ENV]: "/repo",
  }, "/repo/packages/local-web"), "fixtures/demo-web-vault");
  assert.equal(
    buildSuggestedCommand(
      {
        [WEB_LAUNCH_CWD_ENV]: "/repo",
      },
      "/repo/packages/local-web",
    ),
    `${VAULT_ENV}=fixtures/demo-web-vault pnpm local-web:dev`,
  );
});

test("buildSuggestedCommand keeps the package-local example for direct package runs", () => {
  assert.equal(buildSuggestedCommand(), `${VAULT_ENV}=${FIXTURE_VAULT_EXAMPLE} pnpm dev`);
});

test("resolveConfiguredVaultRoot falls back to the saved default vault when env is unset", async () => {
  const operatorHome = await mkdtemp(path.join(os.tmpdir(), "murph-web-home-"));

  try {
    const savedVaultRoot = path.join(operatorHome, "vault");
    await mkdir(path.join(operatorHome, ".murph"), { recursive: true });
    await writeFile(
      path.join(operatorHome, ".murph", "config.json"),
      `${JSON.stringify({
        schema: "murph.operator-config.v1",
        defaultVault: "~/vault",
        assistant: null,
        updatedAt: "2026-03-23T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    assert.equal(
      await resolveConfiguredVaultRoot({
        HOME: operatorHome,
      }, "/repo/packages/local-web"),
      savedVaultRoot,
    );
  } finally {
    await rm(operatorHome, { force: true, recursive: true });
  }
});

test("resolveConfiguredVaultRoot keeps explicit env precedence over the saved default vault", async () => {
  const operatorHome = await mkdtemp(path.join(os.tmpdir(), "murph-web-home-"));

  try {
    await mkdir(path.join(operatorHome, ".murph"), { recursive: true });
    await writeFile(
      path.join(operatorHome, ".murph", "config.json"),
      `${JSON.stringify({
        schema: "murph.operator-config.v1",
        defaultVault: "~/vault",
        assistant: null,
        updatedAt: "2026-03-23T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    assert.equal(
      await resolveConfiguredVaultRoot(
        {
          VAULT: "fixtures/demo-web-vault",
          [WEB_LAUNCH_CWD_ENV]: "/repo",
          HOME: operatorHome,
        },
        "/repo/packages/local-web",
      ),
      "/repo/fixtures/demo-web-vault",
    );
  } finally {
    await rm(operatorHome, { force: true, recursive: true });
  }
});

test("resolveConfiguredVaultRoot ignores invalid saved operator config", async () => {
  const operatorHome = await mkdtemp(path.join(os.tmpdir(), "murph-web-home-"));

  try {
    await mkdir(path.join(operatorHome, ".murph"), { recursive: true });
    await writeFile(path.join(operatorHome, ".murph", "config.json"), "{", "utf8");

    assert.equal(
      await resolveConfiguredVaultRoot({
        HOME: operatorHome,
      }, "/repo/packages/local-web"),
      null,
    );
  } finally {
    await rm(operatorHome, { force: true, recursive: true });
  }
});

test("rememberLaunchCwd stores the first launch cwd only", () => {
  const env: Record<string, string | undefined> = {};

  rememberLaunchCwd(env, "/repo");
  rememberLaunchCwd(env, "/repo/packages/local-web");

  assert.equal(env[WEB_LAUNCH_CWD_ENV], "/repo");
});

test("rememberLaunchCwd prefers INIT_CWD for package-local pnpm runs", () => {
  const env: Record<string, string | undefined> = {
    VAULT: "../../fixtures/demo-web-vault",
    INIT_CWD: "/repo/packages/local-web",
  };

  rememberLaunchCwd(env, "/repo");

  assert.equal(env[WEB_LAUNCH_CWD_ENV], "/repo/packages/local-web");
  assert.equal(getConfiguredVaultRoot(env, "/repo/packages/local-web"), "/repo/fixtures/demo-web-vault");
});

test("loadVaultOverview reports missing config when no vault root is set", async () => {
  const result = await loadVaultOverview();

  assert.equal(result.status, "missing-config");
  assert.equal(result.envVar, VAULT_ENV);
  assert.match(result.suggestedCommand, /pnpm dev/);
});

test("loadVaultOverview returns null search for empty or whitespace-only query", async () => {
  const vaultRoot = await createWebFixtureVault();

  try {
    const empty = await loadVaultOverview({
      query: "",
      vaultRoot,
    });
    const whitespace = await loadVaultOverview({
      query: "   ",
      vaultRoot,
    });

    assert.equal(empty.status, "ready");
    assert.equal(empty.search, null);
    assert.equal(whitespace.status, "ready");
    assert.equal(whitespace.search, null);
  } finally {
    await destroyWebFixtureVault(vaultRoot);
  }
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
    assert.equal(result.timeZone, "Australia/Melbourne");
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

test("loadVaultOverview keeps older active experiments in the summarized investigation list", async () => {
  const vaultRoot = await createWebFixtureVault();

  try {
    await writeFixtureFile(
      vaultRoot,
      "bank/experiments/older-active-anchor.md",
      `---
schemaVersion: hv/experiment@v1
experimentId: exp_active_anchor_01
slug: active-anchor
title: Active Anchor
status: active
startedOn: 2026-03-01
---
# Active Anchor

Keep the long-running active investigation visible.
`,
    );

    for (let index = 0; index < 6; index += 1) {
      const day = String(20 + index).padStart(2, "0");
      await writeFixtureFile(
        vaultRoot,
        `bank/experiments/completed-${index + 1}.md`,
        `---
schemaVersion: hv/experiment@v1
experimentId: exp_completed_${index + 1}
slug: completed-${index + 1}
title: Completed ${index + 1}
status: completed
startedOn: 2026-03-${day}
---
# Completed ${index + 1}

Finished experiment ${index + 1}.
`,
      );
    }

    const result = await loadVaultOverview({
      vaultRoot,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.experiments.length, 6);
    assert.ok(result.experiments.some((experiment) => experiment.title === "Active Anchor"));
    assert.ok(
      result.experiments.some(
        (experiment) => experiment.title === "Completed 6",
      ),
    );
    assert.equal(
      result.experiments.some((experiment) => experiment.title === "Completed 1"),
      false,
    );
  } finally {
    await destroyWebFixtureVault(vaultRoot);
  }
});

test("loadVaultOverview keeps weekly stats separated by unit for the same stream", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-24T12:00:00.000Z"));

  const vaultRoot = await createWebFixtureVault();

  try {
    await writeFixtureFile(
      vaultRoot,
      "ledger/samples/sleep/2026/2026-03.jsonl",
      [
        {
          schemaVersion: "murph.sample.v1",
          id: "smp_sleep_hours_current",
          stream: "sleep",
          occurredAt: "2026-03-24T07:00:00Z",
          recordedAt: "2026-03-24T07:00:00Z",
          value: 7.5,
          unit: "hrs",
          source: "manual",
        },
        {
          schemaVersion: "murph.sample.v1",
          id: "smp_sleep_minutes_current",
          stream: "sleep",
          occurredAt: "2026-03-24T08:00:00Z",
          recordedAt: "2026-03-24T08:00:00Z",
          value: 450,
          unit: "min",
          source: "manual",
        },
        {
          schemaVersion: "murph.sample.v1",
          id: "smp_sleep_hours_previous",
          stream: "sleep",
          occurredAt: "2026-03-17T07:00:00Z",
          recordedAt: "2026-03-17T07:00:00Z",
          value: 7,
          unit: "hrs",
          source: "manual",
        },
        {
          schemaVersion: "murph.sample.v1",
          id: "smp_sleep_minutes_previous",
          stream: "sleep",
          occurredAt: "2026-03-17T08:00:00Z",
          recordedAt: "2026-03-17T08:00:00Z",
          value: 420,
          unit: "min",
          source: "manual",
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
    );

    const result = await loadVaultOverview({
      vaultRoot,
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(
      result.weeklyStats
        .filter((entry) => entry.stream === "sleep")
        .map((entry) => ({
          currentWeekAvg: entry.currentWeekAvg,
          previousWeekAvg: entry.previousWeekAvg,
          unit: entry.unit,
        })),
      [
        {
          currentWeekAvg: 7.5,
          previousWeekAvg: 7,
          unit: "hrs",
        },
        {
          currentWeekAvg: 450,
          previousWeekAvg: 420,
          unit: "min",
        },
      ],
    );
  } finally {
    vi.useRealTimers();
    await destroyWebFixtureVault(vaultRoot);
  }
});

test("loadVaultOverview uses the vault timezone for week windows at UTC day boundaries", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-23T23:30:00.000Z"));

  const vaultRoot = await createWebFixtureVault();

  try {
    await writeFixtureFile(
      vaultRoot,
      "ledger/samples/sleep/2026/2026-03.jsonl",
      [
        {
          schemaVersion: "murph.sample.v1",
          id: "smp_sleep_boundary_current",
          stream: "sleep",
          recordedAt: "2026-03-23T21:00:00.000Z",
          dayKey: "2026-03-24",
          value: 8,
          unit: "hrs",
          source: "manual",
        },
        {
          schemaVersion: "murph.sample.v1",
          id: "smp_sleep_boundary_previous",
          stream: "sleep",
          recordedAt: "2026-03-16T21:00:00.000Z",
          dayKey: "2026-03-17",
          value: 7,
          unit: "hrs",
          source: "manual",
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
    );

    const result = await loadVaultOverview({
      vaultRoot,
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(
      result.weeklyStats.find((entry) => entry.stream === "sleep" && entry.unit === "hrs"),
      {
        currentWeekAvg: 8,
        deltaPercent: ((8 - 7) / 7) * 100,
        previousWeekAvg: 7,
        stream: "sleep",
        unit: "hrs",
      },
    );
  } finally {
    vi.useRealTimers();
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
