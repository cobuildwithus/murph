import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const repoToolsConfigPath = path.join(repoRoot, "scripts", "repo-tools.config.sh");
const hostedDevArtifactFixturePath = path.join(
  repoRoot,
  "apps/web/.next-dev/__package-audit-test__/artifact.txt",
);
const hostedSmokeArtifactFixturePath = path.join(
  repoRoot,
  "apps/web/.next-smoke/__package-audit-test__/artifact.txt",
);
const cleanupPaths = [hostedDevArtifactFixturePath, hostedSmokeArtifactFixturePath];

afterEach(async () => {
  for (const cleanupPath of cleanupPaths) {
    await rm(path.dirname(cleanupPath), { force: true, recursive: true });
  }
});

test("audit packaging includes root deploy artifacts and config helpers while pruning hosted Next dev artifacts", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "murph-audit-test-"));

  await mkdir(path.dirname(hostedDevArtifactFixturePath), { recursive: true });
  await mkdir(path.dirname(hostedSmokeArtifactFixturePath), { recursive: true });
  await writeFile(hostedDevArtifactFixturePath, "ignored dev artifact\n", "utf8");
  await writeFile(hostedSmokeArtifactFixturePath, "ignored smoke artifact\n", "utf8");

  try {
    const output = execFileSync(
      "bash",
      [
        "-lc",
        [
          `source ${JSON.stringify(repoToolsConfigPath)}`,
          '"$(cobuild_repo_tool_bin cobuild-package-audit-context)" --zip --out-dir "$1" --name audit-test',
        ].join("\n"),
        "bash",
        outputRoot,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: withoutNodeV8Coverage(),
      },
    );

    assert.match(output, /Audit package created\./u);
    const zipPath = output.match(/^ZIP: ([^ ]+) \(/mu)?.[1];
    assert.ok(zipPath);

    const entries = execFileSync("unzip", ["-Z1", zipPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: withoutNodeV8Coverage(),
    })
      .trim()
      .split("\n")
      .filter((entry) => entry.length > 0);

    assert.ok(
      entries.some(
        (entry) =>
          entry === "config/workspace-source-resolution.ts" ||
          entry.endsWith("/config/workspace-source-resolution.ts"),
      ),
      "expected audit bundle to include config/workspace-source-resolution.ts",
    );
    assert.ok(
      entries.some(
        (entry) =>
          entry === "Dockerfile.cloudflare-hosted-runner" ||
          entry.endsWith("/Dockerfile.cloudflare-hosted-runner"),
      ),
      "expected audit bundle to include Dockerfile.cloudflare-hosted-runner",
    );
    assert.ok(
      entries.some(
        (entry) => entry === ".dockerignore" || entry.endsWith("/.dockerignore"),
      ),
      "expected audit bundle to include .dockerignore",
    );
    assert.ok(
      entries.some(
        (entry) =>
          entry === "apps/cloudflare/wrangler.jsonc" ||
          entry.endsWith("/apps/cloudflare/wrangler.jsonc"),
      ),
      "expected audit bundle to include apps/cloudflare/wrangler.jsonc",
    );
    assert.ok(
      entries.includes("vitest.config.ts"),
      "expected audit bundle to include the root vitest.config.ts",
    );
    assert.ok(
      entries.includes("tsconfig.test-runtime.json"),
      "expected audit bundle to include tsconfig.test-runtime.json",
    );
    assert.equal(
      entries.some((entry) => /(^|\/)apps\/web\/\.next-dev\//u.test(entry)),
      false,
      "expected audit bundle to exclude apps/web/.next-dev artifacts",
    );
    assert.equal(
      entries.some((entry) => /(^|\/)apps\/web\/\.next-smoke\//u.test(entry)),
      false,
      "expected audit bundle to exclude apps/web/.next-smoke artifacts",
    );
  } finally {
    await rm(outputRoot, { force: true, recursive: true });
  }
});

function withoutNodeV8Coverage(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const nextEnv = { ...env };
  delete nextEnv.NODE_V8_COVERAGE;
  return nextEnv;
}
