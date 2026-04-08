import { spawn } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCloudflareDeployPaths } from "../src/deploy-automation.js";
import {
  buildRunnerVaultCliArtifactPackageJson,
  runnerVaultCliArtifactDependencyNames,
  runnerVaultCliArtifactPackageName,
} from "../src/runner-bundle-contract.js";

import { resolvePnpmCommand } from "./wrangler-runner.js";

interface WorkspacePackageInfo {
  dir: string;
  manifest: WorkspacePackageManifest;
}

interface WorkspacePackageManifest {
  dependencies?: Record<string, string>;
  name?: string;
  optionalDependencies?: Record<string, string>;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const workspaceCliPackageDir = path.join(repoRoot, "packages", "cli");
const workspaceRootDirs = [
  path.join(repoRoot, "apps"),
  path.join(repoRoot, "packages"),
] as const;
const runnerBundleDeployRoot = path.join(
  resolveCloudflareDeployPaths().deployDir,
  "runner-bundle",
);
const runnerBundleDisplayRoot =
  path.relative(appDir, runnerBundleDeployRoot) || runnerBundleDeployRoot;
const require = createRequire(import.meta.url);

await assembleRunnerBundle();

async function assembleRunnerBundle(): Promise<void> {
  const stagingRoot = await mkdtemp(
    path.join(tmpdir(), "murph-cloudflare-runner-bundle-"),
  );
  const stagingBundleDir = path.join(stagingRoot, "runner-bundle");
  const tarballsDir = path.join(stagingRoot, "tarballs");
  const workspacePackages = await loadWorkspacePackageIndex();
  const cloudflarePackageName = "@murphai/cloudflare-runner";
  const runtimeWorkspaceClosure = await collectWorkspaceRuntimeClosure(
    cloudflarePackageName,
    workspacePackages,
  );
  const runnerCliWorkspacePackages = await collectWorkspacePackageNamesFromRoots(
    runnerVaultCliArtifactDependencyNames,
    workspacePackages,
  );
  const runnerCliBuildWorkspacePackages =
    await collectWorkspacePackageNamesFromRoots(
      ["@murphai/murph"],
      workspacePackages,
    );
  const packedWorkspacePackageNames = [...new Set([
    cloudflarePackageName,
    ...runtimeWorkspaceClosure,
    ...runnerCliWorkspacePackages,
  ])].sort();
  const workspacePackagesToBuild = [...new Set([
    ...packedWorkspacePackageNames,
    ...runnerCliBuildWorkspacePackages,
  ])];

  try {
    await buildWorkspacePackagesForAssembly(
      workspacePackagesToBuild,
      workspacePackages,
    );
    await mkdir(tarballsDir, { recursive: true });
    const tarballPaths = await packWorkspaceRuntimePackages(
      packedWorkspacePackageNames,
      tarballsDir,
    );
    await extractTarball(
      tarballPaths.get(cloudflarePackageName) ?? null,
      stagingBundleDir,
    );
    await installPackedRunnerDependencies(
      stagingBundleDir,
      tarballPaths,
      runtimeWorkspaceClosure,
    );
    await stageRunnerVaultCliArtifact(
      stagingBundleDir,
      tarballPaths,
      runnerCliWorkspacePackages,
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

async function loadWorkspacePackageIndex(): Promise<
  Map<string, WorkspacePackageInfo>
> {
  const packages = new Map<string, WorkspacePackageInfo>();

  for (const rootDir of workspaceRootDirs) {
    const entries = await readdir(rootDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageDir = path.join(rootDir, entry.name);
      const manifestPath = path.join(packageDir, "package.json");
      let manifestRaw: string;

      try {
        manifestRaw = await readFile(manifestPath, "utf8");
      } catch (error) {
        if (isMissingFileError(error)) {
          continue;
        }

        throw error;
      }

      const manifest = JSON.parse(manifestRaw) as WorkspacePackageManifest;

      if (!manifest.name) {
        continue;
      }

      packages.set(manifest.name, {
        dir: packageDir,
        manifest,
      });
    }
  }

  return packages;
}

async function collectWorkspaceRuntimeClosure(
  rootPackageName: string,
  workspacePackages: Map<string, WorkspacePackageInfo>,
): Promise<string[]> {
  return collectWorkspacePackageNamesFromRoots(
    [rootPackageName],
    workspacePackages,
    { includeRootPackages: false },
  );
}

async function collectWorkspacePackageNamesFromRoots(
  rootPackageNames: readonly string[],
  workspacePackages: Map<string, WorkspacePackageInfo>,
  options: {
    includeRootPackages?: boolean;
  } = {
    includeRootPackages: true,
  },
): Promise<string[]> {
  const closure = new Set<string>();

  function visit(packageName: string): void {
    const packageInfo = workspacePackages.get(packageName);

    if (!packageInfo || closure.has(packageName)) {
      return;
    }

    closure.add(packageName);

    for (const [dependencyName, specifier] of iterateWorkspaceDependencyEntries(
      packageInfo.manifest,
    )) {
      if (!specifier.startsWith("workspace:")) {
        continue;
      }

      visit(dependencyName);
    }
  }

  for (const packageName of rootPackageNames) {
    visit(packageName);
  }

  if (!options.includeRootPackages) {
    for (const packageName of rootPackageNames) {
      closure.delete(packageName);
    }
  }

  return [...closure].sort();
}

function* iterateWorkspaceDependencyEntries(
  manifest: WorkspacePackageManifest,
): Iterable<[string, string]> {
  for (const dependencyGroup of [
    manifest.dependencies,
    manifest.optionalDependencies,
  ]) {
    if (!dependencyGroup) {
      continue;
    }

    for (const entry of Object.entries(dependencyGroup)) {
      yield entry;
    }
  }
}

async function packWorkspaceRuntimePackages(
  packageNames: string[],
  tarballsDir: string,
): Promise<Map<string, string>> {
  const tarballs = new Map<string, string>();

  for (const packageName of packageNames) {
    tarballs.set(
      packageName,
      await packWorkspacePackage(packageName, tarballsDir),
    );
  }

  return tarballs;
}

async function buildWorkspacePackagesForAssembly(
  packageNames: readonly string[],
  workspacePackages: Map<string, WorkspacePackageInfo>,
): Promise<void> {
  const buildOrder = topologicallySortWorkspacePackages(
    packageNames,
    workspacePackages,
  );

  for (const packageName of buildOrder) {
    await runCommand(["--dir", "../..", "--filter", packageName, "build"], {
      cwd: appDir,
    });
  }
}

function topologicallySortWorkspacePackages(
  packageNames: readonly string[],
  workspacePackages: Map<string, WorkspacePackageInfo>,
): string[] {
  const targetPackages = new Set(packageNames);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: string[] = [];

  function visit(packageName: string): void {
    if (visited.has(packageName)) {
      return;
    }

    if (visiting.has(packageName)) {
      throw new Error(
        `Detected a cycle while preparing the Cloudflare runner build closure: ${packageName}.`,
      );
    }

    const packageInfo = workspacePackages.get(packageName);

    if (!packageInfo) {
      throw new Error(`Could not resolve workspace package ${packageName}.`);
    }

    visiting.add(packageName);

    for (const [dependencyName, specifier] of iterateWorkspaceDependencyEntries(
      packageInfo.manifest,
    )) {
      if (
        specifier.startsWith("workspace:") &&
        targetPackages.has(dependencyName)
      ) {
        visit(dependencyName);
      }
    }

    visiting.delete(packageName);
    visited.add(packageName);
    ordered.push(packageName);
  }

  for (const packageName of targetPackages) {
    visit(packageName);
  }

  return ordered;
}

async function packWorkspacePackage(
  packageName: string,
  tarballsDir: string,
): Promise<string> {
  const before = new Set(await readdir(tarballsDir));

  await runCommand(
    [
      "--config.node-linker=hoisted",
      "--filter",
      packageName,
      "pack",
      "--pack-destination",
      tarballsDir,
    ],
    { cwd: repoRoot },
  );

  const tarballName = (await readdir(tarballsDir)).find(
    (entry) => !before.has(entry) && entry.endsWith(".tgz"),
  );

  if (!tarballName) {
    throw new Error(`Could not locate packed tarball for ${packageName}.`);
  }

  return path.join(tarballsDir, tarballName);
}

async function extractTarball(
  tarballPath: string | null,
  destinationDir: string,
): Promise<void> {
  if (tarballPath === null) {
    throw new Error(
      "Missing tarball path for Cloudflare runner bundle assembly.",
    );
  }

  await rm(destinationDir, { force: true, recursive: true });
  await mkdir(destinationDir, { recursive: true });
  await runProcess(
    "tar",
    ["-xzf", tarballPath, "-C", destinationDir, "--strip-components=1"],
    { cwd: repoRoot },
  );
}

async function installPackedRunnerDependencies(
  bundleDir: string,
  tarballPaths: Map<string, string>,
  runtimeWorkspaceClosure: string[],
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
  );
  pinDirectExternalDependencyVersions(
    packageJson.optionalDependencies,
    workspaceTarballOverrides,
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
): void {
  if (!dependencyGroup) {
    return;
  }

  for (const packageName of Object.keys(dependencyGroup)) {
    if (packageName in overrides) {
      continue;
    }

    const installedVersion = readInstalledPackageVersion(packageName);
    if (installedVersion !== null) {
      dependencyGroup[packageName] = installedVersion;
    }
  }
}

function readInstalledPackageVersion(
  packageName: string,
  searchRoots: readonly string[] = [repoRoot, workspaceCliPackageDir],
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

  for (let index = pathSegments.length - nodeModulesSegments.length; index >= 0; index -= 1) {
    const candidateSegments = pathSegments.slice(
      index,
      index + nodeModulesSegments.length,
    );

    if (
      candidateSegments.length === nodeModulesSegments.length &&
      candidateSegments.every((segment, segmentIndex) =>
        segment === nodeModulesSegments[segmentIndex]
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

async function materializeFinalRunnerBundle(
  stagingBundleDir: string,
  finalBundleDir: string,
): Promise<void> {
  const finalParentDir = path.dirname(finalBundleDir);
  const finalBackupDir = `${finalBundleDir}.previous`;
  const preparedParentDir = await mkdtemp(
    path.join(finalParentDir, ".runner-bundle-prepared-"),
  );
  const preparedBundleDir = path.join(preparedParentDir, "runner-bundle");

  try {
    await prepareBundleReplica(stagingBundleDir, preparedBundleDir);
    await replaceFinalBundle(preparedBundleDir, finalBundleDir, finalBackupDir);
  } finally {
    await rm(preparedParentDir, { force: true, recursive: true });
  }
}

async function prepareBundleReplica(
  stagingBundleDir: string,
  preparedBundleDir: string,
): Promise<void> {
  await rm(preparedBundleDir, { force: true, recursive: true });

  try {
    await rename(stagingBundleDir, preparedBundleDir);
  } catch (error) {
    if (!isCrossDeviceRenameError(error)) {
      throw error;
    }

    await cp(stagingBundleDir, preparedBundleDir, {
      force: true,
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}

async function replaceFinalBundle(
  preparedBundleDir: string,
  finalBundleDir: string,
  finalBackupDir: string,
): Promise<void> {
  await rm(finalBackupDir, { force: true, recursive: true });

  let finalWasBackedUp = false;

  try {
    await rename(finalBundleDir, finalBackupDir);
    finalWasBackedUp = true;
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  try {
    await rm(finalBundleDir, { force: true, recursive: true });
    await rename(preparedBundleDir, finalBundleDir);
  } catch (error) {
    if (finalWasBackedUp) {
      await rm(finalBundleDir, { force: true, recursive: true });
      await rename(finalBackupDir, finalBundleDir);
    }

    throw error;
  }

  await rm(finalBackupDir, { force: true, recursive: true });
}

async function pruneRunnerBundle(bundleDir: string): Promise<void> {
  await Promise.all([
    removeBundlePathIfPresent(path.join(bundleDir, "README.md")),
    removeBundlePathIfPresent(path.join(bundleDir, "DEPLOY.md")),
    removeBundlePathIfPresent(path.join(bundleDir, "LICENSE")),
  ]);
  await pruneNonRuntimeFiles(bundleDir);
}

async function pruneNonRuntimeFiles(rootDir: string): Promise<void> {
  try {
    await walkBundleFiles(rootDir, async (entryPath) => {
      const entryName = path.basename(entryPath);

      if (
        entryName === ".modules.yaml" ||
        entryName === "pnpm-lock.yaml" ||
        entryPath.endsWith(".d.ts") ||
        entryPath.endsWith(".d.ts.map") ||
        entryPath.endsWith(".d.mts") ||
        entryPath.endsWith(".d.cts") ||
        entryPath.endsWith(".map") ||
        entryPath.endsWith(".tsbuildinfo")
      ) {
        await rm(entryPath, { force: true });
      }
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }
}

async function walkBundleFiles(
  rootDir: string,
  visit: (entryPath: string) => Promise<void>,
): Promise<void> {
  const directoryEntries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of directoryEntries) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      await walkBundleFiles(entryPath, visit);
      continue;
    }

    await visit(entryPath);
  }
}

async function rewriteRuntimePackageManifest(bundleDir: string): Promise<void> {
  const packageJsonPath = path.join(bundleDir, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(raw) as Record<string, unknown> & {
    dependencies?: Record<string, string>;
    exports?: Record<string, unknown> | string;
  };

  const runtimePackageJson = {
    dependencies: await resolveInstalledBundleDependencyVersions(
      bundleDir,
      packageJson.dependencies,
    ),
    engines: packageJson.engines,
    exports: stripTypeOnlyExportMetadata(packageJson.exports),
    license: packageJson.license,
    main: packageJson.main,
    name: packageJson.name,
    private: packageJson.private,
    type: packageJson.type,
    version: packageJson.version,
  };

  await writeFile(
    packageJsonPath,
    `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
    "utf8",
  );
}

function stripTypeOnlyExportMetadata(
  exportsField: Record<string, unknown> | string | undefined,
): Record<string, unknown> | string | undefined {
  if (!exportsField || typeof exportsField === "string") {
    return exportsField;
  }

  return Object.fromEntries(
    Object.entries(exportsField).map(([subpath, value]) => {
      if (!value || typeof value === "string") {
        return [subpath, value];
      }

      if (Array.isArray(value)) {
        return [subpath, value];
      }

      const runtimeConditions = Object.fromEntries(
        Object.entries(value).filter(([condition]) => condition !== "types"),
      );

      return [subpath, runtimeConditions];
    }),
  );
}

async function resolveInstalledBundleDependencyVersions(
  bundleDir: string,
  dependencyGroup: Record<string, string> | undefined,
): Promise<Record<string, string>> {
  if (!dependencyGroup) {
    return {};
  }

  const resolvedEntries = await Promise.all(
    Object.keys(dependencyGroup).map(async (dependencyName) => {
      const packageJsonPath = path.join(
        bundleDir,
        "node_modules",
        ...dependencyName.split("/"),
        "package.json",
      );
      const dependencyPackageJson = JSON.parse(
        await readFile(packageJsonPath, "utf8"),
      ) as {
        version?: string;
      };

      if (
        typeof dependencyPackageJson.version !== "string" ||
        dependencyPackageJson.version.length === 0
      ) {
        throw new Error(
          `Runner bundle is missing an installed version for ${dependencyName}.`,
        );
      }

      return [dependencyName, dependencyPackageJson.version] as const;
    }),
  );

  return Object.fromEntries(resolvedEntries);
}

async function stageRunnerVaultCliArtifact(
  bundleDir: string,
  tarballPaths: Map<string, string>,
  runnerCliWorkspacePackages: string[],
): Promise<void> {
  const cliPackageJson = JSON.parse(
    await readFile(path.join(workspaceCliPackageDir, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    license?: string;
    optionalDependencies?: Record<string, string>;
    version?: string;
  };
  const artifactRoot = path.join(
    bundleDir,
    "node_modules",
    ...runnerVaultCliArtifactPackageName.split("/"),
  );
  const artifactDistRoot = path.join(artifactRoot, "dist");

  await rm(artifactRoot, { force: true, recursive: true });
  await mkdir(path.dirname(artifactRoot), { recursive: true });
  await cp(path.join(workspaceCliPackageDir, "dist"), artifactDistRoot, {
    force: true,
    recursive: true,
  });

  const artifactWorkspaceTarballOverrides = buildWorkspaceTarballOverrides(
    artifactRoot,
    tarballPaths,
    runnerCliWorkspacePackages,
  );
  const artifactInstallPackageJson = {
    ...buildRunnerVaultCliArtifactPackageJson({
      dependencies: resolvePackedDependencySpecs(
        runnerVaultCliArtifactDependencyNames,
        artifactWorkspaceTarballOverrides,
        cliPackageJson,
      ),
      version: cliPackageJson.version ?? "0.0.0",
      license: cliPackageJson.license ?? "Apache-2.0",
    }),
    pnpm: {
      overrides: artifactWorkspaceTarballOverrides,
    },
  };

  await writeFile(
    path.join(artifactRoot, "package.json"),
    `${JSON.stringify(artifactInstallPackageJson, null, 2)}\n`,
    "utf8",
  );
  await installPinnedProductionDependencies(artifactRoot);

  const artifactRuntimePackageJson = buildRunnerVaultCliArtifactPackageJson({
    dependencies: await readInstalledDependencyVersions(
      artifactRoot,
      runnerVaultCliArtifactDependencyNames,
    ),
    version: cliPackageJson.version ?? "0.0.0",
    license: cliPackageJson.license ?? "Apache-2.0",
  });

  await writeFile(
    path.join(artifactRoot, "package.json"),
    `${JSON.stringify(artifactRuntimePackageJson, null, 2)}\n`,
    "utf8",
  );
}

function resolvePackedDependencySpecs<const TDependencyNames extends readonly string[]>(
  dependencyNames: TDependencyNames,
  workspaceTarballOverrides: Record<string, string>,
  manifest: WorkspacePackageManifest,
): Record<TDependencyNames[number], string> {
  const dependencies = {} as Record<TDependencyNames[number], string>;

  for (const dependencyName of dependencyNames) {
    const workspaceSpecifier = workspaceTarballOverrides[dependencyName];

    if (typeof workspaceSpecifier === "string") {
      dependencies[dependencyName as TDependencyNames[number]] =
        workspaceSpecifier;
      continue;
    }

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

async function installPinnedProductionDependencies(
  installRoot: string,
): Promise<void> {
  const installEnv = {
    COREPACK_ENABLE_AUTO_PIN: "0",
  };

  await runCommand(["install", "--prod", "--lockfile-only"], {
    cwd: installRoot,
    env: installEnv,
  });
  await runCommand(["install", "--prod", "--frozen-lockfile"], {
    cwd: installRoot,
    env: installEnv,
  });
}

async function readInstalledDependencyVersions<
  const TDependencyNames extends readonly string[],
>(
  bundleDir: string,
  dependencyNames: TDependencyNames,
): Promise<Record<TDependencyNames[number], string>> {
  const versions = {} as Record<TDependencyNames[number], string>;

  for (const dependencyName of dependencyNames) {
    const installedPackageJsonPath = path.join(
      bundleDir,
      "node_modules",
      ...dependencyName.split("/"),
      "package.json",
    );
    const installedPackageJson = JSON.parse(
      await readFile(installedPackageJsonPath, "utf8"),
    ) as {
      version?: string;
    };

    if (
      typeof installedPackageJson.version !== "string" ||
      installedPackageJson.version.length === 0
    ) {
      throw new Error(
        `Runner bundle is missing a concrete version for ${dependencyName}.`,
      );
    }

    versions[dependencyName as TDependencyNames[number]] =
      installedPackageJson.version;
  }

  return versions;
}

async function rewriteRuntimeBinWrappers(bundleDir: string): Promise<void> {
  const nodeModulesDir = path.join(bundleDir, "node_modules");
  const binDir = path.join(nodeModulesDir, ".bin");

  for (const packageDir of await listTopLevelInstalledPackages(nodeModulesDir)) {
    const packageJsonPath = path.join(packageDir, "package.json");
    let packageJsonRaw: string;

    try {
      packageJsonRaw = await readFile(packageJsonPath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }

      throw error;
    }

    const packageJson = JSON.parse(packageJsonRaw) as {
      bin?: Record<string, string> | string;
      name?: string;
    };
    const binMap = normalizeBinMap(packageJson);

    if (!binMap) {
      continue;
    }

    for (const [binName, targetPath] of Object.entries(binMap)) {
      const wrapperPath = path.join(binDir, binName);
      const relativeTargetPath = toPosixPath(
        path.relative(binDir, path.join(packageDir, targetPath)),
      );

      await writeFile(
        wrapperPath,
        buildPortableNodeBinWrapper(relativeTargetPath),
        "utf8",
      );
      await chmod(wrapperPath, 0o755);
    }
  }
}

async function listTopLevelInstalledPackages(
  nodeModulesDir: string,
): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(nodeModulesDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }

  const packages: string[] = [];

  for (const entry of entries) {
    if (entry.name === ".bin" || entry.name === ".pnpm") {
      continue;
    }

    const entryPath = path.join(nodeModulesDir, entry.name);

    if (entry.name.startsWith("@")) {
      const scopedEntries = await readdir(entryPath, { withFileTypes: true });

      for (const scopedEntry of scopedEntries) {
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
          packages.push(path.join(entryPath, scopedEntry.name));
        }
      }

      continue;
    }

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      packages.push(entryPath);
    }
  }

  return packages;
}

function normalizeBinMap(packageJson: {
  bin?: Record<string, string> | string;
  name?: string;
}): Record<string, string> | null {
  if (!packageJson.bin) {
    return null;
  }

  if (typeof packageJson.bin === "string") {
    if (!packageJson.name) {
      return null;
    }

    const inferredBinName = packageJson.name.startsWith("@")
      ? packageJson.name.slice(packageJson.name.indexOf("/") + 1)
      : packageJson.name;

    return {
      [inferredBinName]: packageJson.bin,
    };
  }

  return Object.fromEntries(
    Object.entries(packageJson.bin).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].length > 0,
    ),
  );
}

function buildPortableNodeBinWrapper(relativeTargetPath: string): string {
  return [
    "#!/bin/sh",
    "basedir=$(dirname \"$(echo \"$0\" | sed -e 's,\\\\,/,g')\")",
    "",
    "case `uname` in",
    "    *CYGWIN*|*MINGW*|*MSYS*)",
    "        if command -v cygpath > /dev/null 2>&1; then",
    "            basedir=`cygpath -w \"$basedir\"`",
    "        fi",
    "    ;;",
    "esac",
    "",
    "if [ -x \"$basedir/node\" ]; then",
    `  exec \"$basedir/node\" \"$basedir/${relativeTargetPath}\" \"$@\"`,
    "else",
    `  exec node \"$basedir/${relativeTargetPath}\" \"$@\"`,
    "fi",
    "",
  ].join("\n");
}

function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function isCrossDeviceRenameError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "EXDEV",
  );
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT",
  );
}

async function removeBundlePathIfPresent(targetPath: string): Promise<void> {
  await rm(targetPath, { force: true, recursive: true });
}

async function runCommand(
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await runProcess(resolvePnpmCommand(), args, options);
}

async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}
