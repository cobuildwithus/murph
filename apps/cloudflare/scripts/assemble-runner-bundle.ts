import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCloudflareDeployPaths } from "./deploy-automation.js";
import { writeRunnerBundleManifest } from "./deploy-artifacts.js";
import {
  hostedRunnerBundleOnlyDependencyNames,
  hostedRunnerRuntimePackageName,
  runnerBundleDirectoryName,
  resolveHostedRunnerBuildPackageNames,
  resolveHostedRunnerWorkspacePackageNames,
} from "./runner-bundle-contract.js";
import { bundleInstalledVaultCliBinary } from "./runner-bundle/bundle-cli.js";
import { bundleRunnerContainerEntrypoint } from "./runner-bundle/bundle-entrypoint.js";
import {
  assertInstalledRunnerHealthCommonsRuntimeImport,
  installPackedRunnerDependencies,
} from "./runner-bundle/dependency-install.js";
import { materializeFinalRunnerBundle } from "./runner-bundle/final-bundle.js";
import {
  pruneBundledRunnerDependencies,
  pruneRunnerBundle,
  rewriteRuntimeBinWrappers,
  rewriteRuntimePackageManifest,
} from "./runner-bundle/runtime-shape.js";
import {
  buildHostedRunnerWorkspaceArtifacts,
  packWorkspacePackageArtifacts,
  stageHostedRunnerRuntimeArtifact,
} from "./runner-bundle/workspace-artifacts.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const workspaceArtifactLockHeldEnv = "MURPH_WORKSPACE_ARTIFACT_LOCK_HELD";
const runnerBundleDeployRoot = path.join(
  resolveCloudflareDeployPaths().deployDir,
  runnerBundleDirectoryName,
);
const runnerBundleDisplayRoot =
  path.relative(appDir, runnerBundleDeployRoot) || runnerBundleDeployRoot;
const shouldSkipBuild = process.argv.includes("--skip-build");
const shouldSkipBundleOnlyDependencies = process.argv.includes(
  "--skip-bundle-only-dependencies",
);
const shouldSkipPackPreflights =
  process.argv.includes("--skip-pack-preflights") ||
  process.env.MURPH_RUNNER_BUNDLE_SKIP_PACK_PREFLIGHTS === "1";

rerunUnderWorkspaceArtifactLockIfNeeded();

await assembleRunnerBundle();

function rerunUnderWorkspaceArtifactLockIfNeeded(): void {
  if (process.env[workspaceArtifactLockHeldEnv] === "1") {
    return;
  }

  const result = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "scripts", "run-with-workspace-artifact-lock.mjs"),
      "cloudflare runner bundle",
      "--",
      pnpmCommand,
      "--dir",
      repoRoot,
      "exec",
      "tsx",
      "--tsconfig",
      "apps/cloudflare/tsconfig.scripts.json",
      "apps/cloudflare/scripts/assemble-runner-bundle.ts",
      ...process.argv.slice(2),
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}

async function assembleRunnerBundle(): Promise<void> {
  const stagingRoot = await mkdtemp(
    path.join(tmpdir(), "murph-cloudflare-runner-bundle-"),
  );
  const stagingBundleDir = path.join(stagingRoot, runnerBundleDirectoryName);
  const tarballsDir = path.join(stagingRoot, "tarballs");
  const includeBundleOnlyDependencies = !shouldSkipBundleOnlyDependencies;
  const hostedRunnerWorkspacePackageNames = resolveHostedRunnerWorkspacePackageNames({
    includeBundleOnlyDependencies,
  });
  const hostedRunnerBuildPackageNames = resolveHostedRunnerBuildPackageNames({
    includeBundleOnlyDependencies,
  });
  const packedWorkspacePackageNames = [...hostedRunnerWorkspacePackageNames].sort();

  try {
    if (!shouldSkipBuild) {
      await buildHostedRunnerWorkspaceArtifacts(
        [...hostedRunnerBuildPackageNames, hostedRunnerRuntimePackageName],
        { repoRoot },
      );
    }

    await stageHostedRunnerRuntimeArtifact(stagingBundleDir, {
      appDir,
      bundleOnlyDependencyNames: includeBundleOnlyDependencies
        ? hostedRunnerBundleOnlyDependencyNames
        : [],
    });
    await mkdir(tarballsDir, { recursive: true });
    const tarballPaths = await packWorkspacePackageArtifacts(
      packedWorkspacePackageNames,
      tarballsDir,
      {
        dependencySpecRoot: stagingBundleDir,
        repoRoot,
        skipPreflights: shouldSkipPackPreflights || !shouldSkipBuild,
      },
    );

    await installPackedRunnerDependencies(
      stagingBundleDir,
      tarballPaths,
      hostedRunnerWorkspacePackageNames,
      {
        repoRoot,
        runtimePackageRoot: appDir,
      },
    );
    await assertInstalledRunnerHealthCommonsRuntimeImport(stagingBundleDir);
    await pruneRunnerBundle(stagingBundleDir);
    await rewriteRuntimePackageManifest(stagingBundleDir);
    await rewriteRuntimeBinWrappers(stagingBundleDir);
    await bundleInstalledVaultCliBinary(stagingBundleDir);
    await bundleRunnerContainerEntrypoint(stagingBundleDir);
    await pruneBundledRunnerDependencies(stagingBundleDir);
    await materializeFinalRunnerBundle(
      stagingBundleDir,
      runnerBundleDeployRoot,
    );
    if (process.env.MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN === "1") {
      await writeHostedLocalE2eParserToolchain(runnerBundleDeployRoot);
    }
    await writeRunnerBundleManifest(runnerBundleDeployRoot, {
      appDir,
      buildSkipped: shouldSkipBuild,
      includeBundleOnlyDependencies,
      repoRoot,
    });

    console.log(
      `Assembled Cloudflare runner bundle at ${runnerBundleDisplayRoot}`,
    );
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

async function writeHostedLocalE2eParserToolchain(bundleRoot: string): Promise<void> {
  const toolchainRoot = path.join(bundleRoot, "test-parser-toolchain");
  await mkdir(toolchainRoot, { recursive: true });
  await writeExecutable(path.join(toolchainRoot, "ffmpeg"), [
    "#!/usr/bin/env node",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "const args = process.argv.slice(2);",
    "const inputIndex = args.indexOf('-i');",
    "const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : null;",
    "const outputPath = args.at(-1);",
    "if (!inputPath || !outputPath) process.exit(2);",
    "fs.mkdirSync(path.dirname(outputPath), { recursive: true });",
    "fs.copyFileSync(inputPath, outputPath);",
  ].join("\n"));
}

async function writeExecutable(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, `${contents}\n`, "utf8");
  await chmod(filePath, 0o755);
}
