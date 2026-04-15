import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCloudflareDeployPaths } from "./deploy-automation.js";
import {
  hostedRunnerBuildPackageNames,
  hostedRunnerWorkspacePackageNames,
  runnerBundleDirectoryName,
} from "./runner-bundle-contract.js";
import { installPackedRunnerDependencies } from "./runner-bundle/dependency-install.js";
import { materializeFinalRunnerBundle } from "./runner-bundle/final-bundle.js";
import { runPnpmCommand } from "./runner-bundle/process.js";
import {
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
const runnerBundleDeployRoot = path.join(
  resolveCloudflareDeployPaths().deployDir,
  runnerBundleDirectoryName,
);
const runnerBundleDisplayRoot =
  path.relative(appDir, runnerBundleDeployRoot) || runnerBundleDeployRoot;
const shouldSkipBuild = process.argv.includes("--skip-build");

await assembleRunnerBundle();

async function assembleRunnerBundle(): Promise<void> {
  const stagingRoot = await mkdtemp(
    path.join(tmpdir(), "murph-cloudflare-runner-bundle-"),
  );
  const stagingBundleDir = path.join(stagingRoot, runnerBundleDirectoryName);
  const tarballsDir = path.join(stagingRoot, "tarballs");
  const packedWorkspacePackageNames = [...hostedRunnerWorkspacePackageNames].sort();

  try {
    if (!shouldSkipBuild) {
      await buildHostedRunnerWorkspaceArtifacts(hostedRunnerBuildPackageNames, {
        repoRoot,
      });
      await runPnpmCommand(["build"], { cwd: appDir });
    }

    await stageHostedRunnerRuntimeArtifact(stagingBundleDir, { appDir });
    await mkdir(tarballsDir, { recursive: true });
    const tarballPaths = await packWorkspacePackageArtifacts(
      packedWorkspacePackageNames,
      tarballsDir,
      { repoRoot },
    );

    await installPackedRunnerDependencies(
      stagingBundleDir,
      tarballPaths,
      hostedRunnerWorkspacePackageNames,
      { runtimePackageRoot: appDir },
    );
    await pruneRunnerBundle(stagingBundleDir);
    await rewriteRuntimePackageManifest(stagingBundleDir);
    await rewriteRuntimeBinWrappers(stagingBundleDir);
    await materializeFinalRunnerBundle(
      stagingBundleDir,
      runnerBundleDeployRoot,
    );

    console.log(
      `Assembled Cloudflare runner bundle at ${runnerBundleDisplayRoot}`,
    );
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}
