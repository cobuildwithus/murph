import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import {
  restoreHostedExecutionContext,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";

import {
  prepareHostedCodexRuntimeEnvironment,
} from "../src/hosted-runtime/codex-config.ts";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      })
    ),
  );
});

test("hosted Codex cannot permanently brick later wakes by corrupting its writable home", async () => {
  const firstWorkspaceRoot = await createTemporaryDirectory("hosted-codex-self-brick-first-");
  const firstVaultRoot = path.join(firstWorkspaceRoot, "vault");
  const firstOperatorHomeRoot = path.join(firstWorkspaceRoot, "operator-home");
  await mkdir(path.join(firstOperatorHomeRoot, ".murph"), { recursive: true });
  await mkdir(firstVaultRoot, { recursive: true });
  await writeFile(
    path.join(firstOperatorHomeRoot, ".murph", "config.json"),
    "{\"schema\":\"murph.operator.v1\"}\n",
    "utf8",
  );
  await writeFile(path.join(firstVaultRoot, "memory.md"), "first wake state\n", "utf8");

  const firstCodex = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot: firstOperatorHomeRoot,
    runtimeEnv: createHostedCodexRuntimeEnv(),
  });

  assert.ok(firstCodex.codexHome);
  assert.ok(firstCodex.codexConfigPath);
  await writeFile(firstCodex.codexConfigPath, "not valid hosted codex config\n", "utf8");
  await writeFile(path.join(firstCodex.codexHome, "poisoned-self-brick-marker"), "bad edit\n", "utf8");

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot: firstOperatorHomeRoot,
    vaultRoot: firstVaultRoot,
  });
  const restoredWorkspaceRoot = await createTemporaryDirectory("hosted-codex-self-brick-restored-");
  const restored = await restoreHostedExecutionContext({
    bundle: snapshot.bundle,
    workspaceRoot: restoredWorkspaceRoot,
  });

  await assert.rejects(
    () => access(path.join(restored.operatorHomeRoot, ".codex-hosted", "poisoned-self-brick-marker")),
    { code: "ENOENT" },
  );
  assert.equal(
    await readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "config.toml"), "utf8"),
    "not valid hosted codex config\n",
  );

  const nextCodex = await prepareHostedCodexRuntimeEnvironment({
    operatorHomeRoot: restored.operatorHomeRoot,
    runtimeEnv: createHostedCodexRuntimeEnv(),
  });
  const nextConfig = await readFile(nextCodex.codexConfigPath, "utf8");

  assert.match(nextConfig, /model_provider = "vercel-ai-gateway"/u);
  assert.match(nextConfig, /wire_api = "responses"/u);
  assert.doesNotMatch(nextConfig, /not valid hosted codex config/u);
  assert.equal(
    await readFile(path.join(restored.operatorHomeRoot, ".murph", "config.json"), "utf8"),
    "{\"schema\":\"murph.operator.v1\"}\n",
  );
  assert.equal(await readFile(path.join(restored.vaultRoot, "memory.md"), "utf8"), "first wake state\n");
});

function createHostedCodexRuntimeEnv(): Record<string, string> {
  return {
    HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
    VERCEL_AI_API_KEY: "test-vercel-key",
  };
}

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}
