import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runPnpmCommand } from "./process.js";

export async function installPackedRunnerDependencies(
  bundleDir: string,
  tarballPaths: Map<string, string>,
  runtimeWorkspaceClosure: readonly string[],
  input: {
    repoRoot: string;
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
  await installPinnedProductionDependencies(bundleDir, {
    repoRoot: input.repoRoot,
  });
}

export async function assertInstalledRunnerHealthCommonsRuntimeImport(
  bundleDir: string,
): Promise<void> {
  await runNodeImportProbe(bundleDir, "@murphai/health-commons/runtime");
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
  input: {
    repoRoot: string;
  },
): Promise<void> {
  const installEnv = {
    COREPACK_ENABLE_AUTO_PIN: "0",
  };

  await writeRunnerBundlePnpmInstallConfig(installRoot, input.repoRoot);
  await runPnpmCommand(["install", "--prod", "--lockfile-only"], {
    cwd: installRoot,
    env: installEnv,
  });
  await runPnpmCommand(["install", "--prod", "--frozen-lockfile"], {
    cwd: installRoot,
    env: installEnv,
  });
}

export async function writeRunnerBundlePnpmInstallConfig(
  installRoot: string,
  repoRoot: string,
): Promise<void> {
  const policy = await readWorkspaceMinimumReleaseAgePolicy(repoRoot);

  if (policy === null) {
    return;
  }

  const lines = [`minimum-release-age=${policy.minimumReleaseAge}`];
  for (const excludedPackage of policy.minimumReleaseAgeExclude) {
    lines.push(`minimum-release-age-exclude[]=${excludedPackage}`);
  }

  await writeFile(path.join(installRoot, ".npmrc"), `${lines.join("\n")}\n`, "utf8");
}

async function readWorkspaceMinimumReleaseAgePolicy(repoRoot: string): Promise<{
  minimumReleaseAge: number;
  minimumReleaseAgeExclude: string[];
} | null> {
  let workspaceConfig: string;
  try {
    workspaceConfig = await readFile(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  } catch {
    return null;
  }

  const minimumReleaseAgeMatch = /^minimumReleaseAge:\s*(\d+)\s*$/mu.exec(
    workspaceConfig,
  );
  if (!minimumReleaseAgeMatch) {
    return null;
  }

  const minimumReleaseAge = Number.parseInt(minimumReleaseAgeMatch[1] ?? "", 10);
  if (!Number.isInteger(minimumReleaseAge) || minimumReleaseAge < 0) {
    return null;
  }

  return {
    minimumReleaseAge,
    minimumReleaseAgeExclude: parseYamlStringList(
      workspaceConfig,
      "minimumReleaseAgeExclude",
    ),
  };
}

function parseYamlStringList(source: string, key: string): string[] {
  const lines = source.split(/\r?\n/u);
  const listStartIndex = lines.findIndex((line) => line.trim() === `${key}:`);
  if (listStartIndex === -1) {
    return [];
  }

  const values: string[] = [];
  for (const line of lines.slice(listStartIndex + 1)) {
    if (line.length > 0 && !/^\s/u.test(line)) {
      break;
    }

    const match = /^\s*-\s+(.+?)\s*$/u.exec(line);
    if (!match) {
      continue;
    }

    values.push(stripYamlStringQuotes(match[1] ?? ""));
  }

  return values;
}

function stripYamlStringQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

async function runNodeImportProbe(
  cwd: string,
  specifier: string,
): Promise<void> {
  const probeSource = `await import(${JSON.stringify(specifier)});`;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--input-type=module",
      "--eval",
      probeSource,
    ], {
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Runner bundle cannot import ${specifier} from installed production dependencies.`,
        ),
      );
    });
  });
}

function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, "/");
}
