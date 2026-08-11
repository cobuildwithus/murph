import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Cli } from "incur";
import { afterEach, test, vi } from "vitest";

import { createTempVaultContext, runInProcessJsonCli } from "./cli-test-helpers.js";

const hostedImageState = vi.hoisted(() => ({ enabled: false }));
const hostedImageSentinelPath = "/app/.murph-hosted-runner-image";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (filePath: Parameters<typeof actual.existsSync>[0]) =>
      filePath === hostedImageSentinelPath
        ? hostedImageState.enabled
        : actual.existsSync(filePath),
  };
});

const {
  HOSTED_RUNNER_IMAGE_SENTINEL_PATH,
  assertAutomationCliMutationAllowed,
  registerAutomationCommands,
} = await import("../src/commands/automation.js");

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

afterEach(() => {
  hostedImageState.enabled = false;
});

test("hosted automation CLI mutations fail closed while reads stay available", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-automation-hosted-root-tool-",
  );

  try {
    const cli = Cli.create("vault-cli", {
      description: "automation test cli",
      version: "0.0.0-test",
    });
    registerAutomationCommands(cli);

    const seeded = await runInProcessJsonCli(cli, [
      "automation",
      "save",
      "Existing reminder",
      "--slug",
      "existing-reminder",
      "--status",
      "paused",
      "--instructions",
      "Send the reminder.",
      "--schedule-kind",
      "dailyLocal",
      "--schedule-local-time",
      "08:30",
      "--channel",
      "telegram",
      "--delivery-target",
      "telegram_thread_real",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(seeded.envelope.ok, true);

    hostedImageState.enabled = true;
    const mutations = [
      [
        "automation",
        "save",
        "Blocked reminder",
        "--instructions",
        "Send the reminder.",
        "--vault",
        vaultRoot,
      ],
      [
        "automation",
        "edit",
        "existing-reminder",
        "--summary",
        "Blocked edit",
        "--vault",
        vaultRoot,
      ],
      [
        "automation",
        "set-status",
        "existing-reminder",
        "--status",
        "active",
        "--vault",
        vaultRoot,
      ],
      [
        "automation",
        "reconcile-support-series",
        "habit:blocked",
        "--vault",
        vaultRoot,
      ],
      [
        "automation",
        "import-json",
        "--input",
        `@${path.join(parentRoot, "not-read.json")}`,
        "--vault",
        vaultRoot,
      ],
    ] as const;

    for (const args of mutations) {
      const result = await runInProcessJsonCli(cli, [...args]);
      assert.equal(result.exitCode, 1);
      assert.equal(result.envelope.ok, false);
      if (!result.envelope.ok) {
        assert.match(result.envelope.error.message ?? "", /root hosted automation tool/u);
      }
    }

    const shown = await runInProcessJsonCli(cli, [
      "automation",
      "show",
      "existing-reminder",
      "--vault",
      vaultRoot,
    ]);
    const listed = await runInProcessJsonCli(cli, [
      "automation",
      "list",
      "--vault",
      vaultRoot,
    ]);
    assert.equal(shown.envelope.ok, true);
    assert.equal(listed.envelope.ok, true);
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("automation CLI mutation authority follows the immutable image role only", async () => {
  assert.equal(HOSTED_RUNNER_IMAGE_SENTINEL_PATH, hostedImageSentinelPath);
  assert.doesNotThrow(() => assertAutomationCliMutationAllowed());
  hostedImageState.enabled = true;
  assert.throws(
    () => assertAutomationCliMutationAllowed(),
    /root hosted automation tool/u,
  );

  const dockerfile = await readFile(
    path.join(repoRoot, "Dockerfile.cloudflare-hosted-runner"),
    "utf8",
  );
  const bundleCopy = dockerfile.indexOf("COPY --from=runner-app-permissions");
  const sentinelInstall = dockerfile.indexOf(
    `install -m 0444 /dev/null ${HOSTED_RUNNER_IMAGE_SENTINEL_PATH}`,
  );
  const unprivilegedUser = dockerfile.indexOf("USER runner", sentinelInstall);
  assert.ok(bundleCopy >= 0);
  assert.ok(sentinelInstall > bundleCopy);
  assert.ok(unprivilegedUser > sentinelInstall);
});
