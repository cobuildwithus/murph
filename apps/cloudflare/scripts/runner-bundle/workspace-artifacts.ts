import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedRunnerRuntimeArtifactPackageJson,
  hostedRunnerBundleOnlyDependencyNames,
  hostedRunnerRuntimeDependencyNames,
  hostedRunnerRuntimeDistDirectoryName,
  hostedRunnerRuntimePackageName,
} from "../runner-bundle-contract.js";

import { runPnpmCommand } from "./process.js";

interface WorkspacePackageManifest {
  dependencies?: Record<string, string>;
  engines?: Record<string, string>;
  exports?: Record<string, unknown> | string;
  license?: string;
  main?: string;
  name?: string;
  optionalDependencies?: Record<string, string>;
  private?: boolean;
  type?: string;
  version?: string;
}

export async function buildHostedRunnerWorkspaceArtifacts(
  packageNames: readonly string[],
  input: {
    repoRoot: string;
  },
): Promise<void> {
  const recursiveBuildArgs = [
    "recursive",
    "--workspace-concurrency=1",
    ...packageNames.flatMap((packageName) => ["--filter", packageName]),
    "run",
    "build",
  ];

  await runPnpmCommand(recursiveBuildArgs, { cwd: input.repoRoot });
}

export async function stageHostedRunnerRuntimeArtifact(
  bundleDir: string,
  input: {
    appDir: string;
  },
): Promise<void> {
  const runtimePackageJson = JSON.parse(
    await readFile(path.join(input.appDir, "package.json"), "utf8"),
  ) as WorkspacePackageManifest;
  const runtimeDistDir = path.join(
    input.appDir,
    hostedRunnerRuntimeDistDirectoryName,
  );

  await rm(bundleDir, { force: true, recursive: true });
  await mkdir(bundleDir, { recursive: true });
  await cp(
    runtimeDistDir,
    path.join(bundleDir, hostedRunnerRuntimeDistDirectoryName),
    {
      force: true,
      recursive: true,
    },
  );

  await writeFile(
    path.join(bundleDir, "package.json"),
    `${JSON.stringify(
      buildHostedRunnerRuntimeArtifactPackageJson({
        dependencies: {
          ...resolveDeclaredDependencySpecs(
            hostedRunnerRuntimeDependencyNames,
            runtimePackageJson,
          ),
          ...createBundleOnlyWorkspaceDependencySpecs(
            hostedRunnerBundleOnlyDependencyNames,
          ),
        },
        engines: runtimePackageJson.engines,
        exports: runtimePackageJson.exports,
        license: runtimePackageJson.license ?? "Apache-2.0",
        main: runtimePackageJson.main,
        name: runtimePackageJson.name ?? hostedRunnerRuntimePackageName,
        private: runtimePackageJson.private ?? true,
        type: runtimePackageJson.type ?? "module",
        version: runtimePackageJson.version ?? "0.0.0",
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function packWorkspacePackageArtifacts(
  packageNames: string[],
  tarballsDir: string,
  input: {
    repoRoot: string;
  },
): Promise<Map<string, string>> {
  const tarballs = new Map<string, string>();

  for (const packageName of packageNames) {
    tarballs.set(
      packageName,
      await packWorkspacePackage(packageName, tarballsDir, input),
    );
  }

  return tarballs;
}

async function packWorkspacePackage(
  packageName: string,
  tarballsDir: string,
  input: {
    repoRoot: string;
  },
): Promise<string> {
  const before = new Set(await readdir(tarballsDir));

  await runPnpmCommand(
    [
      "--config.node-linker=hoisted",
      "--filter",
      packageName,
      "pack",
      "--pack-destination",
      tarballsDir,
    ],
    { cwd: input.repoRoot },
  );

  const tarballName = (await readdir(tarballsDir)).find(
    (entry) => !before.has(entry) && entry.endsWith(".tgz"),
  );

  if (!tarballName) {
    throw new Error(`Could not locate packed tarball for ${packageName}.`);
  }

  return path.join(tarballsDir, tarballName);
}

function resolveDeclaredDependencySpecs<
  const TDependencyNames extends readonly string[],
>(
  dependencyNames: TDependencyNames,
  manifest: WorkspacePackageManifest,
): Record<TDependencyNames[number], string> {
  const dependencies = {} as Record<TDependencyNames[number], string>;

  for (const dependencyName of dependencyNames) {
    const declaredSpecifier =
      manifest.dependencies?.[dependencyName] ??
      manifest.optionalDependencies?.[dependencyName] ??
      null;

    if (declaredSpecifier === null) {
      throw new Error(
        `Could not resolve a declared specifier for ${dependencyName}.`,
      );
    }

    dependencies[dependencyName as TDependencyNames[number]] = declaredSpecifier;
  }

  return dependencies;
}

function createBundleOnlyWorkspaceDependencySpecs<
  const TDependencyNames extends readonly string[],
>(
  dependencyNames: TDependencyNames,
): Record<TDependencyNames[number], string> {
  return Object.fromEntries(
    dependencyNames.map((dependencyName) => [dependencyName, "workspace:*"]),
  ) as Record<TDependencyNames[number], string>;
}
