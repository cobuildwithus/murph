import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPackageManagerProcessEnv,
  runPnpmCommand,
} from "./process.js";
import { readWorkspacePackageVersions } from "./workspace-artifacts.js";

interface WorkspacePnpmInstallPolicy {
  npmrcLines: string[];
  overrides: Record<string, string>;
}

interface WorkspacePackageManifest {
  name?: string;
  packageManager?: string;
  version?: string;
}

const runnerBundlePlatformTarget = {
  cpu: "x64",
  libc: "glibc",
  os: "linux",
} as const;

const runnerBundleSupportedArchitectures = {
  cpu: [runnerBundlePlatformTarget.cpu],
  libc: [runnerBundlePlatformTarget.libc],
  os: [runnerBundlePlatformTarget.os],
};
const runnerBundleForbiddenInstallArtifactPaths = [
  "apps/web",
  "node_modules/next",
  "node_modules/@next",
  "node_modules/@privy-io/react-auth",
  "node_modules/@wagmi",
  "node_modules/@walletconnect",
] as const;

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
    packageManager?: string;
    pnpm?: {
      overrides?: Record<string, string>;
      supportedArchitectures?: {
        cpu?: string[];
        libc?: string[];
        os?: string[];
      };
    };
  };
  const workspaceInstallPolicy = await readWorkspacePnpmInstallPolicy(
    input.repoRoot,
  );
  const workspacePackageManager = await readWorkspacePackageManager(
    input.repoRoot,
  );
  const workspaceTarballOverrides = buildWorkspaceTarballOverrides(
    bundleDir,
    tarballPaths,
    runtimeWorkspaceClosure,
  );
  const workspaceTarballReleaseAgeExclusions =
    await buildWorkspaceTarballReleaseAgeExclusions(
      input.repoRoot,
      runtimeWorkspaceClosure,
    );

  if (workspacePackageManager) {
    packageJson.packageManager = workspacePackageManager;
  }
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
      ...workspaceInstallPolicy.overrides,
      ...(packageJson.pnpm?.overrides ?? {}),
      ...workspaceTarballOverrides,
    },
    supportedArchitectures: runnerBundleSupportedArchitectures,
  };

  await writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
  await installPinnedProductionDependencies(bundleDir, {
    minimumReleaseAgeExclusions: workspaceTarballReleaseAgeExclusions,
    policy: workspaceInstallPolicy,
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
        `Could not resolve an installed version for direct dependency ${packageName} from the runner runtime package.`,
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
    minimumReleaseAgeExclusions: readonly string[];
    policy: WorkspacePnpmInstallPolicy;
    repoRoot: string;
  },
): Promise<void> {
  const installEnv = {
    COREPACK_ENABLE_AUTO_PIN: "0",
    SHARP_IGNORE_GLOBAL_LIBVIPS: "1",
  };

  await writeRunnerBundlePnpmInstallConfigFromPolicy(installRoot, input.policy, {
    minimumReleaseAgeExclusions: input.minimumReleaseAgeExclusions,
  });
  await seedRunnerBundleResolutionLockfileFromRoot(installRoot, input.repoRoot);
  await runPnpmCommand(["install", "--prod", "--lockfile-only"], {
    cwd: installRoot,
    env: installEnv,
  });
  await assertRunnerBundleLockfileUsesOnlyBundleImporter(
    path.join(installRoot, "pnpm-lock.yaml"),
  );
  await assertRunnerBundleLockfileUsesCommittedResolutions({
    bundleLockfilePath: path.join(installRoot, "pnpm-lock.yaml"),
    rootLockfilePath: path.join(input.repoRoot, "pnpm-lock.yaml"),
  });
  await runPnpmCommand(["install", "--prod", "--frozen-lockfile"], {
    cwd: installRoot,
    env: installEnv,
  });
  await pruneRunnerBundleUnsupportedPlatformPackages(installRoot);
  await assertRunnerBundleHasNoForbiddenInstallArtifacts(installRoot);
}

async function seedRunnerBundleResolutionLockfileFromRoot(
  installRoot: string,
  repoRoot: string,
): Promise<void> {
  const rootLockfile = await readFile(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");

  await writeFile(
    path.join(installRoot, "pnpm-lock.yaml"),
    stripPnpmLockfileImporters(rootLockfile),
    "utf8",
  );
}

export function stripPnpmLockfileImporters(lockfile: string): string {
  const lines = lockfile.split(/\r?\n/u);
  const outputLines: string[] = [];
  let skippingImporters = false;

  for (const line of lines) {
    const isTopLevelSection = /^\S[^:]*:\s*$/u.test(line);

    if (isTopLevelSection) {
      skippingImporters = line === "importers:";
    }

    if (!skippingImporters) {
      outputLines.push(line);
    }
  }

  return outputLines.join("\n");
}

export async function pruneRunnerBundleUnsupportedPlatformPackages(
  bundleDir: string,
): Promise<void> {
  const nodeModulesDir = path.join(bundleDir, "node_modules");

  for (const packageDir of await listTopLevelPackageDirs(nodeModulesDir)) {
    const packageJsonPath = path.join(packageDir, "package.json");
    let rawPackageJson: string;

    try {
      rawPackageJson = await readFile(packageJsonPath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }

      throw error;
    }

    const packageJson = JSON.parse(rawPackageJson) as {
      cpu?: unknown;
      libc?: unknown;
      os?: unknown;
    };

    if (isRunnerBundlePlatformCompatible(packageJson)) {
      continue;
    }

    await rm(packageDir, { force: true, recursive: true });
  }
}

async function listTopLevelPackageDirs(nodeModulesDir: string): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(nodeModulesDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }

  const packageDirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(nodeModulesDir, entry.name);
    if (!entry.name.startsWith("@")) {
      packageDirs.push(entryPath);
      continue;
    }

    for (const scopedEntry of await readdir(entryPath, { withFileTypes: true })) {
      if (scopedEntry.isDirectory()) {
        packageDirs.push(path.join(entryPath, scopedEntry.name));
      }
    }
  }

  return packageDirs;
}

function isRunnerBundlePlatformCompatible(packageJson: {
  cpu?: unknown;
  libc?: unknown;
  os?: unknown;
}): boolean {
  return (
    packageManifestFieldAllowsTarget(packageJson.cpu, runnerBundlePlatformTarget.cpu) &&
    packageManifestFieldAllowsTarget(packageJson.libc, runnerBundlePlatformTarget.libc) &&
    packageManifestFieldAllowsTarget(packageJson.os, runnerBundlePlatformTarget.os)
  );
}

function packageManifestFieldAllowsTarget(value: unknown, target: string): boolean {
  const constraints = normalizePackageManifestPlatformField(value);

  if (constraints.includes(`!${target}`)) {
    return false;
  }

  const allowedValues = constraints.filter((constraint) => !constraint.startsWith("!"));

  return allowedValues.length === 0 || allowedValues.includes(target);
}

function normalizePackageManifestPlatformField(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function assertRunnerBundleLockfileUsesOnlyBundleImporter(
  lockfilePath: string,
): Promise<void> {
  const lockfile = await readFile(lockfilePath, "utf8");
  const importers = extractPnpmLockfileImporterNames(lockfile);
  const foreignImporters = importers.filter((importer) => importer !== ".");

  if (foreignImporters.length === 0) {
    return;
  }

  throw new Error(
    [
      "Runner bundle lockfile included workspace importers outside the bundle artifact.",
      `Foreign importers: ${foreignImporters.slice(0, 10).join(", ")}`,
    ].join(" "),
  );
}

function extractPnpmLockfileImporterNames(lockfile: string): string[] {
  const importers: string[] = [];
  let inImportersSection = false;

  for (const line of lockfile.split(/\r?\n/u)) {
    const isTopLevelSection = /^\S[^:]*:\s*$/u.test(line);

    if (isTopLevelSection) {
      inImportersSection = line === "importers:";
      continue;
    }

    if (!inImportersSection) {
      continue;
    }

    const match = /^  (\S.*):\s*$/u.exec(line);
    if (match) {
      importers.push(stripYamlStringQuotes(match[1]!.trim()));
    }
  }

  return importers;
}

export async function assertRunnerBundleHasNoForbiddenInstallArtifacts(
  bundleDir: string,
): Promise<void> {
  const presentPaths: string[] = [];

  for (const relativePath of runnerBundleForbiddenInstallArtifactPaths) {
    try {
      await access(path.join(bundleDir, relativePath));
      presentPaths.push(relativePath);
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }

      throw error;
    }
  }

  if (presentPaths.length === 0) {
    return;
  }

  throw new Error(
    [
      "Runner bundle installed web-only dependency artifacts.",
      `Forbidden paths: ${presentPaths.join(", ")}`,
    ].join(" "),
  );
}

export async function assertRunnerBundleLockfileUsesCommittedResolutions(input: {
  bundleLockfilePath: string;
  rootLockfilePath: string;
}): Promise<void> {
  const [bundleLockfile, rootLockfile] = await Promise.all([
    readFile(input.bundleLockfilePath, "utf8"),
    readFile(input.rootLockfilePath, "utf8"),
  ]);
  const bundlePackages = extractPnpmLockPackageResolutions(bundleLockfile);
  const rootPackages = extractPnpmLockPackageResolutions(rootLockfile);
  const mismatchedKeys = [...bundlePackages]
    .filter(([key]) => !isLocalRunnerBundlePackageKey(key))
    .filter(([key, resolution]) => rootPackages.get(key) !== resolution)
    .map(([key]) => key);

  if (mismatchedKeys.length > 0) {
    throw new Error(
      [
        "Runner bundle lockfile resolved packages that are not present with the same resolution in the committed root pnpm-lock.yaml.",
        "Update the root lockfile through the normal dependency workflow before assembling the runner bundle.",
        `Mismatched package keys: ${mismatchedKeys.slice(0, 10).join(", ")}`,
      ].join(" "),
    );
  }
}

function extractPnpmLockPackageResolutions(lockfile: string): Map<string, string | null> {
  const packages = new Map<string, string | null>();
  let inPackagesSection = false;
  let currentPackageKey: string | null = null;

  for (const line of lockfile.split(/\r?\n/u)) {
    if (/^\S[^:]*:\s*$/u.test(line)) {
      inPackagesSection = line === "packages:";
      currentPackageKey = null;
      continue;
    }

    if (!inPackagesSection) {
      continue;
    }

    const match = /^  (\S.*):\s*$/u.exec(line);
    if (match) {
      currentPackageKey = stripYamlStringQuotes(match[1]!.trim());
      packages.set(currentPackageKey, null);
      continue;
    }

    if (!currentPackageKey) {
      continue;
    }

    const resolutionMatch = /^    resolution:\s*(.+)$/u.exec(line);
    if (resolutionMatch) {
      packages.set(currentPackageKey, resolutionMatch[1]!.trim());
    }
  }

  return packages;
}

function isLocalRunnerBundlePackageKey(key: string): boolean {
  const baseKey = key.split("(", 1)[0]!;

  return (
    baseKey.startsWith("file:") ||
    baseKey.startsWith("link:") ||
    /^(?:@[^/]+\/[^@]+|[^@]+)@(file:|link:)/u.test(baseKey)
  );
}

export async function writeRunnerBundlePnpmInstallConfig(
  installRoot: string,
  repoRoot: string,
  options: {
    minimumReleaseAgeExclusions?: readonly string[];
  } = {},
): Promise<void> {
  const policy = await readWorkspacePnpmInstallPolicy(repoRoot);

  await writeRunnerBundlePnpmInstallConfigFromPolicy(installRoot, policy, options);
}

async function writeRunnerBundlePnpmInstallConfigFromPolicy(
  installRoot: string,
  policy: WorkspacePnpmInstallPolicy,
  options: {
    minimumReleaseAgeExclusions?: readonly string[];
  } = {},
): Promise<void> {
  const npmrcLines = [
    ...policy.npmrcLines,
    "node-linker=hoisted",
  ];
  appendMinimumReleaseAgeExclusionLines(
    npmrcLines,
    options.minimumReleaseAgeExclusions ?? [],
  );

  if (npmrcLines.length === 0) {
    return;
  }

  await writeFile(
    path.join(installRoot, ".npmrc"),
    `${npmrcLines.join("\n")}\n`,
    "utf8",
  );
}

function appendMinimumReleaseAgeExclusionLines(
  lines: string[],
  exclusions: readonly string[],
): void {
  const existingExclusions = new Set<string>();
  for (const line of lines) {
    const match = /^minimum-release-age-exclude\[\]=(.+)$/u.exec(line);
    if (match) {
      existingExclusions.add(match[1]!);
    }
  }

  for (const exclusion of exclusions) {
    if (existingExclusions.has(exclusion)) {
      continue;
    }

    existingExclusions.add(exclusion);
    lines.push(`minimum-release-age-exclude[]=${exclusion}`);
  }
}

async function readWorkspacePackageManager(
  repoRoot: string,
): Promise<string | null> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf8"),
    ) as WorkspacePackageManifest;

    return typeof manifest.packageManager === "string" &&
      manifest.packageManager.length > 0
      ? manifest.packageManager
      : null;
  } catch {
    return null;
  }
}

async function buildWorkspaceTarballReleaseAgeExclusions(
  repoRoot: string,
  workspacePackageNames: readonly string[],
): Promise<readonly string[]> {
  const workspacePackageVersions = await readWorkspacePackageVersions(repoRoot);

  return [...new Set(workspacePackageNames)]
    .map((packageName) => {
      const packageVersion = workspacePackageVersions.get(packageName);
      if (!packageVersion) {
        throw new Error(
          `Could not resolve a workspace package version for ${packageName}.`,
        );
      }

      return `${packageName}@${packageVersion}`;
    })
    .sort();
}

async function readWorkspacePnpmInstallPolicy(
  repoRoot: string,
): Promise<WorkspacePnpmInstallPolicy> {
  let workspaceConfig: string;
  try {
    workspaceConfig = await readFile(
      path.join(repoRoot, "pnpm-workspace.yaml"),
      "utf8",
    );
  } catch {
    return {
      npmrcLines: [],
      overrides: {},
    };
  }

  const lines: string[] = [];
  appendBooleanPnpmConfigLine(
    lines,
    workspaceConfig,
    "blockExoticSubdeps",
    "block-exotic-subdeps",
  );
  appendBooleanPnpmConfigLine(
    lines,
    workspaceConfig,
    "engineStrict",
    "engine-strict",
  );
  appendBooleanPnpmConfigLine(
    lines,
    workspaceConfig,
    "managePackageManagerVersions",
    "manage-package-manager-versions",
  );
  appendNumberPnpmConfigLine(
    lines,
    workspaceConfig,
    "minimumReleaseAge",
    "minimum-release-age",
  );
  for (
    const excludedPackage of parseYamlStringList(
      workspaceConfig,
      "minimumReleaseAgeExclude",
    )
  ) {
    lines.push(`minimum-release-age-exclude[]=${excludedPackage}`);
  }
  appendStringPnpmConfigLine(
    lines,
    workspaceConfig,
    "nodeVersion",
    "node-version",
  );
  for (
    const allowedBuild of parseYamlTrueMapKeys(
      workspaceConfig,
      "allowBuilds",
    )
  ) {
    lines.push(`only-built-dependencies[]=${allowedBuild}`);
  }
  appendBooleanPnpmConfigLine(
    lines,
    workspaceConfig,
    "packageManagerStrictVersion",
    "package-manager-strict-version",
  );
  appendStringPnpmConfigLine(lines, workspaceConfig, "savePrefix", "save-prefix");
  appendStringPnpmConfigLine(lines, workspaceConfig, "trustPolicy", "trust-policy");
  appendNumberPnpmConfigLine(
    lines,
    workspaceConfig,
    "trustPolicyIgnoreAfter",
    "trust-policy-ignore-after",
  );
  return {
    npmrcLines: lines,
    overrides: parseYamlStringMap(workspaceConfig, "overrides"),
  };
}

function appendBooleanPnpmConfigLine(
  lines: string[],
  source: string,
  yamlKey: string,
  pnpmKey: string,
): void {
  const value = parseYamlScalar(source, yamlKey);
  if (value === "true" || value === "false") {
    lines.push(`${pnpmKey}=${value}`);
  }
}

function appendNumberPnpmConfigLine(
  lines: string[],
  source: string,
  yamlKey: string,
  pnpmKey: string,
): void {
  const value = parseYamlScalar(source, yamlKey);
  if (!value || !/^\d+$/u.test(value)) {
    return;
  }

  lines.push(`${pnpmKey}=${value}`);
}

function appendStringPnpmConfigLine(
  lines: string[],
  source: string,
  yamlKey: string,
  pnpmKey: string,
): void {
  const value = parseYamlScalar(source, yamlKey);
  if (value === null) {
    return;
  }

  lines.push(`${pnpmKey}=${value}`);
}

function parseYamlScalar(source: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^${escapedKey}:\\s*(.*?)\\s*$`, "mu").exec(source);
  if (!match) {
    return null;
  }

  return stripYamlStringQuotes(match[1] ?? "");
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

function parseYamlTrueMapKeys(source: string, key: string): string[] {
  return Object.entries(parseYamlStringMap(source, key))
    .flatMap(([entryKey, entryValue]) =>
      entryValue === "true" ? [entryKey] : [],
    );
}

function parseYamlStringMap(source: string, key: string): Record<string, string> {
  const lines = source.split(/\r?\n/u);
  const mapStartIndex = lines.findIndex((line) => line.trim() === `${key}:`);
  if (mapStartIndex === -1) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const line of lines.slice(mapStartIndex + 1)) {
    if (line.length > 0 && !/^\s/u.test(line)) {
      break;
    }

    const match = /^\s*(.+?)\s*:\s*(.+?)\s*$/u.exec(line);
    if (!match) {
      continue;
    }

    const entryKey = stripYamlStringQuotes(match[1] ?? "");
    if (!entryKey) {
      continue;
    }

    values[entryKey] = stripYamlStringQuotes(match[2] ?? "");
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
  const processEnv = await createPackageManagerProcessEnv(undefined);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--input-type=module",
      "--eval",
      probeSource,
    ], {
      cwd,
      env: processEnv.env,
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
  }).finally(processEnv.cleanup);
}

function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
