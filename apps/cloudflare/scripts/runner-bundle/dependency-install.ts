import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runPnpmCommand } from "./process.js";

export async function installPackedRunnerDependencies(
  bundleDir: string,
  tarballPaths: Map<string, string>,
  runtimeWorkspaceClosure: readonly string[],
  input: {
    runtimePackageRoot: string;
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
  pinInstalledDependencyVersions(
    packageJson.dependencies,
    workspaceTarballOverrides,
    input.runtimePackageRoot,
  );
  pinInstalledDependencyVersions(
    packageJson.optionalDependencies,
    workspaceTarballOverrides,
    input.runtimePackageRoot,
    { allowMissing: true, dropMissing: true },
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

export function pinInstalledDependencyVersions(
  dependencyGroup: Record<string, string> | undefined,
  overrides: Record<string, string>,
  runtimePackageRoot: string,
  options: {
    allowMissing?: boolean;
    dropMissing?: boolean;
  } = {},
): void {
  if (!dependencyGroup) {
    return;
  }

  for (const packageName of Object.keys(dependencyGroup)) {
    if (packageName in overrides) {
      continue;
    }

    const installedVersion = resolveInstalledPackageVersion(
      packageName,
      runtimePackageRoot,
    );

    if (installedVersion !== null) {
      dependencyGroup[packageName] = installedVersion;
      continue;
    }

    if (!options.allowMissing) {
      throw new Error(
        `Could not resolve an installed version for direct dependency ${packageName} from ${runtimePackageRoot}.`,
      );
    }

    if (options.dropMissing) {
      delete dependencyGroup[packageName];
    }
  }
}

function resolveInstalledPackageVersion(
  packageName: string,
  searchRoot: string,
): string | null {
  try {
    const manifestPath = resolveInstalledPackageManifestPath(packageName, searchRoot);
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
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
  runtimePackageRoot: string,
): string {
  return path.join(
    runtimePackageRoot,
    "node_modules",
    ...packageName.split("/"),
    "package.json",
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
