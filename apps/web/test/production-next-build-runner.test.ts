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
const buildCacheEpoch = "webpack-next-16.3-v2-cold-webpack";

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
  if [[ -n "\${MURPH_FAKE_REMOVE_FAIL_AFTER_BUILD:-}" && -f "\$MURPH_FAKE_BUILD_LOG" ]]; then
    exit 31
  fi
  rm -rf "\${2:-}"
  exit 0
fi
printf 'NODE_OPTIONS=%s\\n' "\${NODE_OPTIONS:-}" > "\$MURPH_FAKE_BUILD_LOG"
printf '%s\\n' "\$@" >> "\$MURPH_FAKE_BUILD_LOG"
mkdir -p .next/cache/webpack
printf 'generated\\n' > .next/cache/webpack/generated-cache-entry
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
  removeFailAfterBuild?: boolean;
  removeLog: string;
  scriptPath: string;
}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MURPH_FAKE_BUILD_EXIT_CODE: String(input.buildExitCode ?? 0),
    MURPH_FAKE_BUILD_LOG: input.buildLog,
    MURPH_FAKE_NEXT_BIN: "/fixture/next",
    MURPH_FAKE_REMOVE_LOG: input.removeLog,
    NODE_OPTIONS: "--trace-warnings --max-old-space-size=99",
    PATH: `${input.binDir}:${process.env.PATH ?? ""}`,
  };
  if (input.removeFailAfterBuild) {
    env.MURPH_FAKE_REMOVE_FAIL_AFTER_BUILD = "1";
  }
  return spawnSync("bash", [input.scriptPath], {
    cwd: input.appDir,
    encoding: "utf8",
    env,
  });
}

test("production Next runner owns the cold Webpack cache and fail-closed epoch", async () => {
  const fixture = await createRunnerFixture();
  const cacheDir = path.join(fixture.appDir, ".next", "cache");
  const cacheStamp = path.join(cacheDir, "murph-production-build-epoch");
  const staleCacheEntry = path.join(cacheDir, "stale-cache-entry");
  const restoredWebpackEntry = path.join(cacheDir, "webpack", "restored-cache-entry");
  const generatedWebpackEntry = path.join(cacheDir, "webpack", "generated-cache-entry");
  const retainedSwcEntry = path.join(cacheDir, "swc", "retained-cache-entry");

  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(staleCacheEntry, "stale\n");

    const coldBuild = runProductionBuild(fixture);
    expect(coldBuild.status, coldBuild.stderr).toBe(0);
    expect(coldBuild.stdout).toContain(
      `Resetting incompatible Next build cache for epoch=${buildCacheEpoch}`,
    );
    expect(coldBuild.stdout).toContain(
      "compiler=webpack parent_old_space_mb=1024 next_child_old_space_mb=3072 webpack_cache=cold",
    );
    expect(coldBuild.stdout).toContain(
      "Discarding Webpack cache after successful production compile",
    );
    await expect(readFile(staleCacheEntry, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(generatedWebpackEntry, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(cacheStamp, "utf8")).resolves.toBe(`${buildCacheEpoch}\n`);
    await expect(readFile(fixture.removeLog, "utf8")).resolves.toBe(
      ".next/cache\n.next/cache/webpack\n",
    );
    await expect(readFile(fixture.buildLog, "utf8")).resolves.toBe([
      "NODE_OPTIONS=--trace-warnings --max-old-space-size=3072",
      "--max-old-space-size=1024",
      "/fixture/next",
      "build",
      "--webpack",
      "",
    ].join("\n"));

    await mkdir(path.dirname(restoredWebpackEntry), { recursive: true });
    await writeFile(restoredWebpackEntry, "restored\n");
    await mkdir(path.dirname(retainedSwcEntry), { recursive: true });
    await writeFile(retainedSwcEntry, "retained\n");
    await rm(fixture.removeLog, { force: true });
    const warmBuild = runProductionBuild(fixture);
    expect(warmBuild.status, warmBuild.stderr).toBe(0);
    expect(warmBuild.stdout).not.toContain("Resetting incompatible Next build cache");
    expect(warmBuild.stdout).toContain(
      "Resetting restored Webpack cache before production compile",
    );
    await expect(readFile(restoredWebpackEntry, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(generatedWebpackEntry, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(retainedSwcEntry, "utf8")).resolves.toBe("retained\n");
    await expect(readFile(cacheStamp, "utf8")).resolves.toBe(`${buildCacheEpoch}\n`);
    await expect(readFile(fixture.removeLog, "utf8")).resolves.toBe(
      ".next/cache/webpack\n.next/cache/webpack\n",
    );

    await writeFile(cacheStamp, "turbopack-old-epoch\n");
    await writeFile(staleCacheEntry, "stale-again\n");
    await rm(fixture.removeLog, { force: true });
    const failedBuild = runProductionBuild({ ...fixture, buildExitCode: 23 });
    expect(failedBuild.status).toBe(23);
    expect(failedBuild.stdout).toContain("Resetting incompatible Next build cache");
    await expect(readFile(staleCacheEntry, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(cacheStamp, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(fixture.removeLog, "utf8")).resolves.toBe(".next/cache\n");

    const recoveredBuild = runProductionBuild(fixture);
    expect(recoveredBuild.status, recoveredBuild.stderr).toBe(0);
    expect(recoveredBuild.stdout).toContain("Resetting incompatible Next build cache");
    await expect(readFile(generatedWebpackEntry, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(cacheStamp, "utf8")).resolves.toBe(`${buildCacheEpoch}\n`);

    await writeFile(cacheStamp, "turbopack-old-epoch\n");
    await rm(fixture.removeLog, { force: true });
    await rm(fixture.buildLog, { force: true });
    const discardFailedBuild = runProductionBuild({ ...fixture, removeFailAfterBuild: true });
    expect(discardFailedBuild.status).toBe(31);
    await expect(readFile(cacheStamp, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(fixture.removeLog, "utf8")).resolves.toBe(
      ".next/cache\n.next/cache/webpack\n",
    );

    const recoveredAfterDiscardFailure = runProductionBuild(fixture);
    expect(recoveredAfterDiscardFailure.status, recoveredAfterDiscardFailure.stderr).toBe(0);
    expect(recoveredAfterDiscardFailure.stdout).toContain(
      "Resetting incompatible Next build cache",
    );
    await expect(readFile(cacheStamp, "utf8")).resolves.toBe(`${buildCacheEpoch}\n`);
  } finally {
    await fixture.cleanup();
  }
});
