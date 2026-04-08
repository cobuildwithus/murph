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

import { resolveCloudflareDeployPaths } from "./deploy-automation.js";
import {
  buildHostedRunnerRuntimeArtifactPackageJson,
  hostedRunnerBuildPackageNames,
  hostedRunnerBundleOnlyDependencyNames,
  hostedRunnerRuntimeDistDirectoryName,
  hostedRunnerRuntimeDependencyNames,
  hostedRunnerRuntimePackageName,
  hostedRunnerWorkspacePackageNames,
  runnerBundleDirectoryName,
} from "./runner-bundle-contract.js";

import { resolvePnpmCommand } from "./wrangler-runner.js";

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

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const runnerBundleDeployRoot = path.join(
  resolveCloudflareDeployPaths().deployDir,
  runnerBundleDirectoryName,
);
const runnerBundleDisplayRoot =
  path.relative(appDir, runnerBundleDeployRoot) || runnerBundleDeployRoot;
const require = createRequire(import.meta.url);

await assembleRunnerBundle();

async function assembleRunnerBundle(): Promise<void> {
  const stagingRoot = await mkdtemp(
    path.join(tmpdir(), "murph-cloudflare-runner-bundle-"),
  );
  const stagingBundleDir = path.join(stagingRoot, runnerBundleDirectoryName);
  const tarballsDir = path.join(stagingRoot, "tarballs");
  const packedWorkspacePackageNames = [...hostedRunnerWorkspacePackageNames].sort();

  try {
    await buildHostedRunnerWorkspaceArtifacts(hostedRunnerBuildPackageNames);
    await runCommand(["build"], { cwd: appDir });
    await stageHostedRunnerRuntimeArtifact(stagingBundleDir);
    await mkdir(tarballsDir, { recursive: true });
    const tarballPaths = await packWorkspacePackageArtifacts(
      packedWorkspacePackageNames,
      tarballsDir,
    );
    await installPackedRunnerDependencies(
      stagingBundleDir,
      tarballPaths,
      hostedRunnerWorkspacePackageNames,
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

async function buildHostedRunnerWorkspaceArtifacts(
  packageNames: readonly string[],
): Promise<void> {
  const recursiveBuildArgs = [
    "recursive",
    "--workspace-concurrency=1",
    ...packageNames.flatMap((packageName) => ["--filter", packageName]),
    "run",
    "build",
  ];

  await runCommand(recursiveBuildArgs, { cwd: repoRoot });
}

async function stageHostedRunnerRuntimeArtifact(
  bundleDir: string,
): Promise<void> {
  const runtimePackageJson = JSON.parse(
    await readFile(path.join(appDir, "package.json"), "utf8"),
  ) as WorkspacePackageManifest;
  const runtimeDistDir = path.join(appDir, hostedRunnerRuntimeDistDirectoryName);

  await rm(bundleDir, { force: true, recursive: true });
  await mkdir(bundleDir, { recursive: true });
  await cp(runtimeDistDir, path.join(bundleDir, hostedRunnerRuntimeDistDirectoryName), {
    force: true,
    recursive: true,
  });

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

async function packWorkspacePackageArtifacts(
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

async function installPackedRunnerDependencies(
  bundleDir: string,
  tarballPaths: Map<string, string>,
  runtimeWorkspaceClosure: readonly string[],
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

function resolveDeclaredDependencySpecs<const TDependencyNames extends readonly string[]>(
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
  searchRoots: readonly string[] = [repoRoot],
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
  await mkdir(finalParentDir, { recursive: true });
  const preparedParentDir = await mkdtemp(
    path.join(finalParentDir, ".runner-bundle-prepared-"),
  );
  const preparedBundleDir = path.join(
    preparedParentDir,
    runnerBundleDirectoryName,
  );

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
        entryName === ".pnpm-workspace-state-v1.json" ||
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
