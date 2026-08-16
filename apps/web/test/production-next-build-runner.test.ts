import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionBuildScript = path.join(
  appRoot,
  "scripts",
  "run-production-next-build.sh",
);
const buildCacheEpoch = "webpack-next-16.3-v1";

async function createRunnerFixture(): Promise<{
  appDir: string;
  binDir: string;
  buildLog: string;
  cleanup: () => Promise<void>;
  removeLog: string;
  scriptPath: string;
}> {
  const testTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!testTempRoot) {
    throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  }

  const fixtureRoot = await mkdtemp(path.join(testTempRoot, "production-next-build-"));
  const appDir = path.join(fixtureRoot, "apps", "web");
  const binDir = path.join(fixtureRoot, "bin");
  const scriptPath = path.join(appDir, "scripts", "run-production-next-build.sh");
  const buildLog = path.join(fixtureRoot, "build.log");
  const removeLog = path.join(fixtureRoot, "remove.log");

  await mkdir(path.dirname(scriptPath), { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(scriptPath, await readFile(productionBuildScript));
  await chmod(scriptPath, 0o755);

  const fakeNodePath = path.join(binDir, "node");
  await writeFile(
    fakeNodePath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-p" ]]; then
  printf '%s\\n' "\$MURPH_FAKE_NEXT_BIN"
  exit 0
fi
if [[ "\${1:-}" == "../../scripts/rm-paths.mjs" ]]; then
  printf '%s\\n' "\${2:-}" >> "\$MURPH_FAKE_REMOVE_LOG"
  rm -rf "\${2:-}"
  exit 0
fi
printf 'NODE_OPTIONS=%s\\n' "\${NODE_OPTIONS:-}" > "\$MURPH_FAKE_BUILD_LOG"
printf '%s\\n' "\$@" >> "\$MURPH_FAKE_BUILD_LOG"
exit "\${MURPH_FAKE_BUILD_EXIT_CODE:-0}"
`,
  );
  await chmod(fakeNodePath, 0o755);

  return {
    appDir,
    binDir,
    buildLog,
    cleanup: () => rm(fixtureRoot, { force: true, recursive: true }),
    removeLog,
    scriptPath,
  };
}

function runProductionBuild(input: {
  appDir: string;
  binDir: string;
  buildExitCode?: number;
  buildLog: string;
  removeLog: string;
  scriptPath: string;
}) {
  return spawnSync("bash", [input.scriptPath], {
    cwd: input.appDir,
    encoding: "utf8",
    env: {
      ...process.env,
      MURPH_FAKE_BUILD_EXIT_CODE: String(input.buildExitCode ?? 0),
      MURPH_FAKE_BUILD_LOG: input.buildLog,
      MURPH_FAKE_NEXT_BIN: "/fixture/next",
      MURPH_FAKE_REMOVE_LOG: input.removeLog,
      NODE_OPTIONS: "--trace-warnings --max-old-space-size=99",
      PATH: `${input.binDir}:${process.env.PATH ?? ""}`,
    },
  });
}

test("production Next runner owns the Webpack cache epoch transition", async () => {
  const fixture = await createRunnerFixture();
  const cacheDir = path.join(fixture.appDir, ".next", "cache");
  const cacheStamp = path.join(cacheDir, "murph-production-build-epoch");
  const staleCacheEntry = path.join(cacheDir, "stale-cache-entry");
  const warmCacheEntry = path.join(cacheDir, "warm-cache-entry");

  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(staleCacheEntry, "stale\n");

    const coldBuild = runProductionBuild(fixture);
    expect(coldBuild.status, coldBuild.stderr).toBe(0);
    expect(coldBuild.stdout).toContain(
      `Resetting incompatible Next build cache for epoch=${buildCacheEpoch}`,
    );
    expect(coldBuild.stdout).toContain("compiler=webpack");
    await expect(readFile(staleCacheEntry, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(cacheStamp, "utf8")).resolves.toBe(`${buildCacheEpoch}\n`);
    await expect(readFile(fixture.removeLog, "utf8")).resolves.toBe(".next/cache\n");
    await expect(readFile(fixture.buildLog, "utf8")).resolves.toBe([
      "NODE_OPTIONS=--trace-warnings --max-old-space-size=3072",
      "--max-old-space-size=1024",
      "/fixture/next",
      "build",
      "--webpack",
      "",
    ].join("\n"));

    await writeFile(warmCacheEntry, "warm\n");
    await rm(fixture.removeLog, { force: true });
    const warmBuild = runProductionBuild(fixture);
    expect(warmBuild.status, warmBuild.stderr).toBe(0);
    expect(warmBuild.stdout).not.toContain("Resetting incompatible Next build cache");
    await expect(readFile(warmCacheEntry, "utf8")).resolves.toBe("warm\n");
    await expect(readFile(fixture.removeLog, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(cacheStamp, "turbopack-old-epoch\n");
    await writeFile(staleCacheEntry, "stale-again\n");
    const failedBuild = runProductionBuild({ ...fixture, buildExitCode: 23 });
    expect(failedBuild.status).toBe(23);
    expect(failedBuild.stdout).toContain("Resetting incompatible Next build cache");
    await expect(readFile(staleCacheEntry, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(cacheStamp, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const recoveredBuild = runProductionBuild(fixture);
    expect(recoveredBuild.status, recoveredBuild.stderr).toBe(0);
    expect(recoveredBuild.stdout).toContain("Resetting incompatible Next build cache");
    await expect(readFile(cacheStamp, "utf8")).resolves.toBe(`${buildCacheEpoch}\n`);
  } finally {
    await fixture.cleanup();
  }
});
