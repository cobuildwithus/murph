import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { runPnpmCommand } from "./process.js";

const require = createRequire(import.meta.url);

export async function installPackedRunnerDependencies(
  bundleDir: string,
  tarballPaths: Map<string, string>,
  runtimeWorkspaceClosure: readonly string[],
  input: {
    repoRoot: string;
  },
): Promise<void> {
  const packageJsonPath = path.join(bundleDir, "package.json");
  const packageJson = JSON.parse(
    await readFile(packageJsonPath, "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    pnpm?: {
      overrides?: Record<string, string>;
    };
  };
  const workspaceTarballOverrides = buildWorkspaceTarballOverrides(
    bundleDir,
    tarballPaths,
    runtimeWorkspaceClosure,
  );

  rewriteDependencySpecs(packageJson.dependencies, workspaceTarballOverrides);
  rewriteDependencySpecs(
    packageJson.optionalDependencies,
    workspaceTarballOverrides,
  );
  pinDirectExternalDependencyVersions(
    packageJson.dependencies,
    workspaceTarballOverrides,
    input.repoRoot,
  );
  pinDirectExternalDependencyVersions(
    packageJson.optionalDependencies,
    workspaceTarballOverrides,
    input.repoRoot,
  );
  packageJson.pnpm = {
    ...packageJson.pnpm,
    overrides: {
      ...(packageJson.pnpm?.overrides ?? {}),
      ...workspaceTarballOverrides,
    },
  };

  await writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
  await installPinnedProductionDependencies(bundleDir);
}

function buildWorkspaceTarballOverrides(
  installRoot: string,
  tarballPaths: Map<string, string>,
  workspacePackageNames: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    workspacePackageNames.map((packageName) => {
      const tarballPath = tarballPaths.get(packageName);

      if (!tarballPath) {
        throw new Error(`Missing packed tarball for ${packageName}.`);
      }

      return [
        packageName,
        `file:${toPosixPath(path.relative(installRoot, tarballPath))}`,
      ];
    }),
  );
}

function rewriteDependencySpecs(
  dependencyGroup: Record<string, string> | undefined,
  overrides: Record<string, string>,
): void {
  if (!dependencyGroup) {
    return;
  }

  for (const [packageName, overrideSpecifier] of Object.entries(overrides)) {
    if (packageName in dependencyGroup) {
      dependencyGroup[packageName] = overrideSpecifier;
    }
  }
}

function pinDirectExternalDependencyVersions(
  dependencyGroup: Record<string, string> | undefined,
  overrides: Record<string, string>,
  repoRoot: string,
): void {
  if (!dependencyGroup) {
    return;
  }

  for (const packageName of Object.keys(dependencyGroup)) {
    if (packageName in overrides) {
      continue;
    }

    const installedVersion = readInstalledPackageVersion(packageName, [repoRoot]);
    if (installedVersion !== null) {
      dependencyGroup[packageName] = installedVersion;
    }
  }
}

function readInstalledPackageVersion(
  packageName: string,
  searchRoots: readonly string[],
): string | null {
  try {
    const manifestPath = resolveInstalledPackageManifestPath(
      packageName,
      searchRoots,
    );
    const manifest = JSON.parse(
      require("node:fs").readFileSync(manifestPath, "utf8"),
    ) as {
      version?: string;
    };

    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

function resolveInstalledPackageManifestPath(
  packageName: string,
  searchRoots: readonly string[],
): string {
  try {
    return require.resolve(`${packageName}/package.json`, {
      paths: [...searchRoots],
    });
  } catch {
    const resolvedEntrypoint = require.resolve(packageName, {
      paths: [...searchRoots],
    });
    const packageRoot = findInstalledPackageRoot(
      resolvedEntrypoint,
      packageName,
    );

    return path.join(packageRoot, "package.json");
  }
}

function findInstalledPackageRoot(
  resolvedEntrypoint: string,
  packageName: string,
): string {
  const packageSegments = packageName.split("/");
  const nodeModulesSegments = ["node_modules", ...packageSegments];
  const normalizedEntrypoint = path.normalize(resolvedEntrypoint);
  const pathSegments = normalizedEntrypoint.split(path.sep);

  for (
    let index = pathSegments.length - nodeModulesSegments.length;
    index >= 0;
    index -= 1
  ) {
    const candidateSegments = pathSegments.slice(
      index,
      index + nodeModulesSegments.length,
    );

    if (
      candidateSegments.length === nodeModulesSegments.length &&
      candidateSegments.every(
        (segment, segmentIndex) =>
          segment === nodeModulesSegments[segmentIndex],
      )
    ) {
      return path.join(
        pathSegments.slice(0, index + nodeModulesSegments.length).join(path.sep),
      );
    }
  }

  throw new Error(
    `Could not determine package root for ${packageName} from ${resolvedEntrypoint}.`,
  );
}

async function installPinnedProductionDependencies(
  installRoot: string,
): Promise<void> {
  const installEnv = {
    COREPACK_ENABLE_AUTO_PIN: "0",
  };

  await runPnpmCommand(["install", "--prod", "--lockfile-only"], {
    cwd: installRoot,
    env: installEnv,
  });
  await runPnpmCommand(["install", "--prod", "--frozen-lockfile"], {
    cwd: installRoot,
    env: installEnv,
  });
}

function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, "/");
}
