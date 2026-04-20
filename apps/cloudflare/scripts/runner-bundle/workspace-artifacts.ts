import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedRunnerRuntimeArtifactPackageJson,
  hostedRunnerBundleOnlyDependencyNames,
  hostedRunnerRuntimeDistDirectoryName,
  hostedRunnerRuntimePackageName,
} from "../runner-bundle-contract.js";

import { runNpmCommand, runPnpmCommand } from "./process.js";

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
  for (const packageName of await topologicallySortWorkspacePackageNames(
    packageNames,
    input,
  )) {
    await runPnpmCommand(["build"], {
      cwd: await resolveWorkspacePackageDirectory(input.repoRoot, packageName),
    });
  }
}

export async function stageHostedRunnerRuntimeArtifact(
  bundleDir: string,
  input: {
    appDir: string;
    bundleOnlyDependencyNames?: readonly string[];
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
          ...(runtimePackageJson.dependencies ?? {}),
          ...createBundleOnlyWorkspaceDependencySpecs(
            input.bundleOnlyDependencyNames
            ?? hostedRunnerBundleOnlyDependencyNames,
          ),
        },
        engines: runtimePackageJson.engines,
        exports: runtimePackageJson.exports,
        license: runtimePackageJson.license ?? "Apache-2.0",
        main: runtimePackageJson.main,
        name: runtimePackageJson.name ?? hostedRunnerRuntimePackageName,
        optionalDependencies: runtimePackageJson.optionalDependencies,
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
  const packageDir = await resolveWorkspacePackageDirectory(input.repoRoot, packageName);

  await runNpmCommand(["pack", "--ignore-scripts", "--pack-destination", tarballsDir], {
    cwd: packageDir,
  });

  const tarballName = (await readdir(tarballsDir)).find(
    (entry) => !before.has(entry) && entry.endsWith(".tgz"),
  );

  if (!tarballName) {
    throw new Error(`Could not locate packed tarball for ${packageName}.`);
  }

  return path.join(tarballsDir, tarballName);
}

async function resolveWorkspacePackageDirectory(
  repoRoot: string,
  packageName: string,
): Promise<string> {
  for (const memberType of ["apps", "packages"]) {
    const membersDir = path.join(repoRoot, memberType);
    for (const entry of await readdir(membersDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidateDir = path.join(membersDir, entry.name);
      const packageJsonPath = path.join(candidateDir, "package.json");

      try {
        const packageJson = JSON.parse(
          await readFile(packageJsonPath, "utf8"),
        ) as { name?: string };
        if (packageJson.name === packageName) {
          return candidateDir;
        }
      } catch {
        continue;
      }
    }
  }

  throw new Error(`Could not resolve workspace package directory for ${packageName}.`);
}

async function topologicallySortWorkspacePackageNames(
  packageNames: readonly string[],
  input: {
    repoRoot: string;
  },
): Promise<readonly string[]> {
  const packageSet = new Set(packageNames);
  const manifests = new Map<string, WorkspacePackageManifest>();

  for (const packageName of packageSet) {
    const packageDir = await resolveWorkspacePackageDirectory(input.repoRoot, packageName);
    manifests.set(
      packageName,
      JSON.parse(
        await readFile(path.join(packageDir, "package.json"), "utf8"),
      ) as WorkspacePackageManifest,
    );
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: string[] = [];

  function visit(packageName: string): void {
    if (visited.has(packageName)) {
      return;
    }

    if (visiting.has(packageName)) {
      throw new Error(
        `Detected a cycle while ordering runner bundle builds at ${packageName}.`,
      );
    }

    visiting.add(packageName);

    for (const dependencyName of listWorkspaceDependencyNames(
      manifests.get(packageName),
    )) {
      if (packageSet.has(dependencyName)) {
        visit(dependencyName);
      }
    }

    visiting.delete(packageName);
    visited.add(packageName);
    ordered.push(packageName);
  }

  for (const packageName of packageNames) {
    visit(packageName);
  }

  return ordered;
}

function listWorkspaceDependencyNames(
  packageJson: WorkspacePackageManifest | undefined,
): readonly string[] {
  return Object.entries({
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.optionalDependencies ?? {}),
  })
    .filter((entry): entry is [string, string] => entry[1].startsWith("workspace:"))
    .map(([dependencyName]) => dependencyName)
    .sort();
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
