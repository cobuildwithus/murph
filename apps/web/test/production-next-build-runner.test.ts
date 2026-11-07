import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionBuildScript = path.join(
  appRoot,
  "scripts",
  "run-production-next-build.sh",
);
const buildCacheEpoch = "webpack-next-16.3-v6-isolated-worker-no-webpack-cache";

async function createRunnerFixture(): Promise<{
  appDir: string;
  binDir: string;
  buildLog: string;
  cleanup: () => Promise<void>;
  removeLog: string;
  scriptPath: string;
  typecheckLog: string;
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
  const typecheckLog = path.join(fixtureRoot, "typecheck.log");

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
  if [[ -n "\${MURPH_FAKE_REMOVE_FAIL:-}" ]]; then
    exit 31
  fi
  rm -rf "\${2:-}"
  exit 0
fi
if [[ "\${2:-}" == "../../scripts/run-typescript.mjs" ]]; then
  printf 'NODE_OPTIONS=%s\\n' "\${NODE_OPTIONS:-}" > "\$MURPH_FAKE_TYPECHECK_LOG"
  printf 'GOMEMLIMIT=%s\\n' "\${GOMEMLIMIT:-}" >> "\$MURPH_FAKE_TYPECHECK_LOG"
  printf 'TYPECHECK_GATE=%s\\n' "\${MURPH_HOSTED_WEB_PREPARED_TYPECHECK:-}" >> "\$MURPH_FAKE_TYPECHECK_LOG"
  printf '%s\\n' "\$@" >> "\$MURPH_FAKE_TYPECHECK_LOG"
  exit "\${MURPH_FAKE_TYPECHECK_EXIT_CODE:-0}"
fi
printf 'NODE_OPTIONS=%s\\n' "\${NODE_OPTIONS:-}" >> "\$MURPH_FAKE_BUILD_LOG"
printf 'GOMEMLIMIT=%s\\n' "\${GOMEMLIMIT:-}" >> "\$MURPH_FAKE_BUILD_LOG"
printf 'TYPECHECK_GATE=%s\\n' "\${MURPH_HOSTED_WEB_PREPARED_TYPECHECK:-}" >> "\$MURPH_FAKE_BUILD_LOG"
printf '%s\\n' "\$@" >> "\$MURPH_FAKE_BUILD_LOG"
if [[ "\${3:-}" == "build" ]]; then
  exit "\${MURPH_FAKE_BUILD_EXIT_CODE:-0}"
fi
exit 0
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
    typecheckLog,
  };
}

function runProductionBuild(input: {
  appDir: string;
  binDir: string;
  buildExitCode?: number;
  buildLog: string;
  removeFail?: boolean;
  removeLog: string;
  scriptPath: string;
  typecheckExitCode?: number;
  typecheckLog: string;
}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MURPH_FAKE_BUILD_EXIT_CODE: String(input.buildExitCode ?? 0),
    MURPH_FAKE_BUILD_LOG: input.buildLog,
    MURPH_FAKE_NEXT_BIN: "/fixture/next",
    MURPH_FAKE_REMOVE_LOG: input.removeLog,
    MURPH_FAKE_TYPECHECK_EXIT_CODE: String(input.typecheckExitCode ?? 0),
    MURPH_FAKE_TYPECHECK_LOG: input.typecheckLog,
    MURPH_HOSTED_WEB_PREPARED_TYPECHECK: "forged",
    GOMEMLIMIT: "8GiB",
    NODE_OPTIONS: "--trace-warnings --max-old-space-size=99",
    PATH: `${input.binDir}:${process.env.PATH ?? ""}`,
  };
  if (input.removeFail) {
    env.MURPH_FAKE_REMOVE_FAIL = "1";
  }
  return spawnSync("bash", [input.scriptPath], {
    cwd: input.appDir,
    encoding: "utf8",
    env,
  });
}

test("production Next runner owns the cache transition and fail-closed epoch", async () => {
  const fixture = await createRunnerFixture();
  const cacheDir = path.join(fixture.appDir, ".next", "cache");
  const cacheStamp = path.join(cacheDir, "murph-production-build-epoch");
  const staleCacheEntry = path.join(cacheDir, "stale-cache-entry");
  const restoredWebpackEntry = path.join(cacheDir, "webpack", "restored-cache-entry");
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
      "compiler=webpack parent_old_space_mb=1024 build_worker_old_space_mb=3072 webpack_cache=disabled webpack_build_worker=on",
    );
    await expect(readFile(staleCacheEntry, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(cacheStamp, "utf8")).resolves.toBe(`${buildCacheEpoch}\n`);
    await expect(readFile(fixture.removeLog, "utf8")).resolves.toBe(".next/cache\n");
    await expect(readFile(fixture.buildLog, "utf8")).resolves.toBe([
      "NODE_OPTIONS=--trace-warnings --max-old-space-size=3072",
      "GOMEMLIMIT=8GiB",
      "TYPECHECK_GATE=",
      "--max-old-space-size=1024",
      "/fixture/next",
      "typegen",
      "NODE_OPTIONS=--trace-warnings --max-old-space-size=3072",
      "GOMEMLIMIT=1GiB",
      "TYPECHECK_GATE=complete",
      "--max-old-space-size=1024",
      "/fixture/next",
      "build",
      "--webpack",
      "",
    ].join("\n"));
    await expect(readFile(fixture.typecheckLog, "utf8")).resolves.toBe([
      "NODE_OPTIONS=--trace-warnings --max-old-space-size=1024",
      "GOMEMLIMIT=8GiB",
      "TYPECHECK_GATE=",
      "--max-old-space-size=1024",
      "../../scripts/run-typescript.mjs",
      "web",
      "-p",
      "tsconfig.next.json",
      "--pretty",
      "false",
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
    expect(warmBuild.stdout).not.toContain("Resetting restored Webpack cache");
    await expect(readFile(restoredWebpackEntry, "utf8")).resolves.toBe("restored\n");
    await expect(readFile(retainedSwcEntry, "utf8")).resolves.toBe("retained\n");
    await expect(readFile(cacheStamp, "utf8")).resolves.toBe(`${buildCacheEpoch}\n`);
    await expect(readFile(fixture.removeLog, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

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
    await expect(readFile(cacheStamp, "utf8")).resolves.toBe(`${buildCacheEpoch}\n`);

    // A failed epoch transition must abort before Next runs rather than trust
    // cache state produced by a different compiler policy.
    await writeFile(cacheStamp, "webpack-next-16.3-v5-isolated-worker-cold-webpack\n");
    await rm(fixture.removeLog, { force: true });
    await rm(fixture.buildLog, { force: true });
    const removalFailedBuild = runProductionBuild({ ...fixture, removeFail: true });
    expect(removalFailedBuild.status).toBe(31);
    await expect(readFile(fixture.buildLog, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(fixture.removeLog, "utf8")).resolves.toBe(".next/cache\n");
    await expect(readFile(cacheStamp, "utf8")).resolves.toBe(
      "webpack-next-16.3-v5-isolated-worker-cold-webpack\n",
    );

    const recoveredAfterRemovalFailure = runProductionBuild(fixture);
    expect(recoveredAfterRemovalFailure.status, recoveredAfterRemovalFailure.stderr).toBe(0);
    await expect(readFile(cacheStamp, "utf8")).resolves.toBe(`${buildCacheEpoch}\n`);
  } finally {
    await fixture.cleanup();
  }
});

test("production Next runner fails closed before compilation when the prepared typecheck fails", async () => {
  const fixture = await createRunnerFixture();

  try {
    const result = runProductionBuild({ ...fixture, typecheckExitCode: 19 });
    expect(result.status).toBe(19);
    await expect(readFile(fixture.buildLog, "utf8")).resolves.toBe([
      "NODE_OPTIONS=--trace-warnings --max-old-space-size=3072",
      "GOMEMLIMIT=8GiB",
      "TYPECHECK_GATE=",
      "--max-old-space-size=1024",
      "/fixture/next",
      "typegen",
      "",
    ].join("\n"));
  } finally {
    await fixture.cleanup();
  }
});

test("native route checking rejects invalid Next-generated contracts and accepts a repair", async () => {
  const fixture = await createRunnerFixture();
  try {
    await symlink(path.join(appRoot, "node_modules"), path.join(fixture.appDir, "node_modules"), "dir");
    await mkdir(path.join(fixture.appDir, "app"));
    await writeFile(path.join(fixture.appDir, "package.json"), '{"private":true,"type":"module"}');
    await writeFile(path.join(fixture.appDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "es2022", module: "esnext", moduleResolution: "bundler",
        jsx: "react-jsx", strict: true, skipLibCheck: true, noEmit: true,
        incremental: true, types: ["react"], tsBuildInfoFile: ".next/check.tsbuildinfo",
      },
      include: ["app/**/*.tsx", ".next/types/**/*.ts"],
    }));
    const page = path.join(fixture.appDir, "app/page.tsx");
    await writeFile(page, 'export const generateStaticParams = () => "invalid"; export default function Page() { return null; }\n');
    const generated = spawnSync(process.execPath, [
      path.join(appRoot, "node_modules/next/dist/bin/next"), "typegen",
    ], { cwd: fixture.appDir, encoding: "utf8", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    expect(generated.status, generated.stdout + generated.stderr).toBe(0);
    const check = () => spawnSync(process.execPath, [
      path.resolve(appRoot, "../../scripts/run-typescript.mjs"),
      "web", "-p", path.join(fixture.appDir, "tsconfig.json"), "--pretty", "false",
    ], { cwd: fixture.appDir, encoding: "utf8", env: { ...process.env, MURPH_VERIFY_SHARED_HOST: "1" } });
    const invalid = check();
    expect(invalid.status, invalid.stderr).not.toBe(0);
    expect(invalid.stdout).toContain(".next/types/validator.ts");
    expect(invalid.stdout).toContain("generateStaticParams");
    await writeFile(page, "export const generateStaticParams = () => []; export default function Page() { return null; }\n");
    const repaired = check();
    expect(repaired.status, repaired.stdout + repaired.stderr).toBe(0);
  } finally {
    await fixture.cleanup();
  }
}, 30_000);
