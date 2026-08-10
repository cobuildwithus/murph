import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedRunnerRuntimeArtifactPackageJson,
  hostedRunnerBundleOnlyDependencyNames,
  hostedRunnerRuntimeDistDirectoryName,
  hostedRunnerRuntimePackageName,
} from "../runner-bundle-contract.js";

import { runNpmCommand, runPnpmCommand } from "./process.js";

const HEALTH_COMMONS_PACKAGE_NAME = "@murphai/health-commons";
const CONTRACTS_PACKAGE_NAME = "@murphai/contracts";
const CLI_PACKAGE_NAME = "@murphai/murph";
const HEALTH_COMMONS_RUNTIME_GENERATED_FILES = [
  "generated/biomarker-desired-directions.json",
  "generated/knowledge.sqlite",
  "generated/protocol-index.json",
  "generated/protocol-run-specs.json",
  "generated/protocol-family-graph.json",
] as const;

interface WorkspacePackageManifest {
  bundleDependencies?: string[];
  bundledDependencies?: string[];
  dependencies?: Record<string, string>;
  engines?: Record<string, string>;
  exports?: Record<string, unknown> | string;
  files?: string[];
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
  const sortedPackageNames = await topologicallySortWorkspacePackageNames(
    packageNames,
    input,
  );

  if (sortedPackageNames.length === 0) {
    return;
  }

  await runPnpmCommand(
    buildHostedRunnerWorkspaceBuildArgs(sortedPackageNames),
    { cwd: input.repoRoot },
  );
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
    dependencySpecRoot?: string;
    repoRoot: string;
    skipPreflights?: boolean;
  },
): Promise<Map<string, string>> {
  if (!input.skipPreflights) {
    await runWorkspacePackagePackPreflights(packageNames, input);
  }

  const workspacePackageVersions = await readWorkspacePackageVersions(
    input.repoRoot,
  );
  const workspacePackageTarballSpecifiers =
    buildWorkspacePackageTarballSpecifiers({
      dependencySpecRoot: input.dependencySpecRoot ?? tarballsDir,
      packageNames,
      tarballsDir,
      workspacePackageVersions,
    });
  const packedEntries = await mapWithConcurrency(
    packageNames,
    resolveHostedRunnerPackConcurrency(),
    async (packageName, index) => {
      const packageTarballsDir = resolvePackageTarballsDir(
        tarballsDir,
        packageName,
        index,
      );

      await mkdir(packageTarballsDir, { recursive: true });

      return [
        packageName,
        await packWorkspacePackage(packageName, packageTarballsDir, {
          ...input,
          workspacePackageTarballSpecifiers,
          workspacePackageVersions,
        }),
      ] as const;
    },
  );

  return new Map(packedEntries);
}

export function buildHostedRunnerWorkspaceBuildArgs(
  packageNames: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const defaultConcurrency = resolveDefaultHostedRunnerBuildConcurrency();
  return [
    `--workspace-concurrency=${resolvePositiveIntegerEnv(
      env.MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY,
      defaultConcurrency,
      "MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY",
    )}`,
    ...packageNames.flatMap((packageName) => ["--filter", packageName]),
    "run",
    "build",
  ];
}

export function buildWorkspacePackagePackPreflightArgs(
  packageName: string,
): string[] | null {
  if (packageName === CONTRACTS_PACKAGE_NAME) {
    return ["--filter", CONTRACTS_PACKAGE_NAME, "run", "build"];
  }

  if (packageName !== HEALTH_COMMONS_PACKAGE_NAME) {
    return null;
  }

  return ["--filter", HEALTH_COMMONS_PACKAGE_NAME, "run", "build"];
}

async function packWorkspacePackage(
  packageName: string,
  tarballsDir: string,
  input: {
    repoRoot: string;
    workspacePackageTarballSpecifiers: ReadonlyMap<string, string>;
    workspacePackageVersions: ReadonlyMap<string, string>;
  },
): Promise<string> {
  const before = new Set(await readdir(tarballsDir));
  const sourcePackageDir = await resolveWorkspacePackageDirectory(input.repoRoot, packageName);
  const packRoot = await prepareRunnerPackagePackRoot(
    packageName,
    sourcePackageDir,
    tarballsDir,
    input.workspacePackageTarballSpecifiers,
  );
  const packageDir = packRoot ?? sourcePackageDir;

  try {
    await assertWorkspacePackageRuntimeFiles(packageName, packageDir);

    try {
      await runNpmCommand(
        ["pack", "--ignore-scripts", "--silent", "--pack-destination", tarballsDir],
        {
          cwd: packageDir,
        },
      );
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new Error(`Failed to pack ${packageName}.${detail}`);
    }
  } finally {
    if (packRoot) {
      await rm(packRoot, { force: true, recursive: true });
    }
  }

  const tarballName = (await readdir(tarballsDir)).find(
    (entry) => !before.has(entry) && entry.endsWith(".tgz"),
  );

  if (!tarballName) {
    throw new Error(`Could not locate packed tarball for ${packageName}.`);
  }

  return path.join(tarballsDir, tarballName);
}

async function prepareRunnerPackagePackRoot(
  packageName: string,
  sourcePackageDir: string,
  tarballsDir: string,
  workspacePackageTarballSpecifiers: ReadonlyMap<string, string>,
): Promise<string | null> {
  if (packageName === CLI_PACKAGE_NAME) {
    return await prepareRunnerCliPackagePackRoot(
      sourcePackageDir,
      tarballsDir,
      workspacePackageTarballSpecifiers,
    );
  }

  if (packageName === HEALTH_COMMONS_PACKAGE_NAME) {
    return await prepareRunnerHealthCommonsPackagePackRoot(
      sourcePackageDir,
      tarballsDir,
      workspacePackageTarballSpecifiers,
    );
  }

  return await prepareRunnerWorkspacePackagePackRoot(
    packageName,
    sourcePackageDir,
    tarballsDir,
    workspacePackageTarballSpecifiers,
  );
}

async function prepareRunnerCliPackagePackRoot(
  sourcePackageDir: string,
  tarballsDir: string,
  workspacePackageTarballSpecifiers: ReadonlyMap<string, string>,
): Promise<string> {
  const packRoot = await mkdtemp(path.join(tarballsDir, ".runner-cli-pack-"));
  const packageJson = await readWorkspacePackageManifest(sourcePackageDir);

  delete packageJson.bundleDependencies;
  delete packageJson.bundledDependencies;
  rewritePackedWorkspaceDependencySpecs(
    packageJson,
    packageJson.name ?? CLI_PACKAGE_NAME,
    workspacePackageTarballSpecifiers,
  );

  await copyPackageEntries(sourcePackageDir, packRoot, [
    "dist",
    "README.md",
    "CHANGELOG.md",
    "config.schema.json",
    "LICENSE",
  ]);
  await writeFile(
    path.join(packRoot, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );

  return packRoot;
}

async function prepareRunnerHealthCommonsPackagePackRoot(
  sourcePackageDir: string,
  tarballsDir: string,
  workspacePackageTarballSpecifiers: ReadonlyMap<string, string>,
): Promise<string> {
  const packRoot = await mkdtemp(path.join(tarballsDir, ".runner-health-commons-pack-"));
  const packageJson = await readWorkspacePackageManifest(sourcePackageDir);

  packageJson.files = [
    "dist",
    ...HEALTH_COMMONS_RUNTIME_GENERATED_FILES,
    "README.md",
    "LICENSE",
  ];
  rewritePackedWorkspaceDependencySpecs(
    packageJson,
    packageJson.name ?? HEALTH_COMMONS_PACKAGE_NAME,
    workspacePackageTarballSpecifiers,
  );

  await copyPackageEntries(sourcePackageDir, packRoot, [
    "dist",
    ...HEALTH_COMMONS_RUNTIME_GENERATED_FILES,
    "README.md",
    "LICENSE",
  ]);
  await writeFile(
    path.join(packRoot, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );

  return packRoot;
}

async function prepareRunnerWorkspacePackagePackRoot(
  packageName: string,
  sourcePackageDir: string,
  tarballsDir: string,
  workspacePackageTarballSpecifiers: ReadonlyMap<string, string>,
): Promise<string | null> {
  const packageJson = await readWorkspacePackageManifest(sourcePackageDir);
  const didRewrite = rewritePackedWorkspaceDependencySpecs(
    packageJson,
    packageName,
    workspacePackageTarballSpecifiers,
  );

  if (!didRewrite) {
    return null;
  }

  if (
    !Array.isArray(packageJson.files) ||
    packageJson.files.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(
      `${packageName} must declare string-only files before runner package packing can rewrite workspace dependency specs.`,
    );
  }

  const packRoot = await mkdtemp(path.join(tarballsDir, ".runner-workspace-pack-"));
  await copyPackageEntries(sourcePackageDir, packRoot, packageJson.files);
  await writeFile(
    path.join(packRoot, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );

  return packRoot;
}

async function readWorkspacePackageManifest(
  packageDir: string,
): Promise<WorkspacePackageManifest> {
  return JSON.parse(
    await readFile(path.join(packageDir, "package.json"), "utf8"),
  ) as WorkspacePackageManifest;
}

export async function readWorkspacePackageVersions(
  repoRoot: string,
): Promise<ReadonlyMap<string, string>> {
  const versions = new Map<string, string>();

  for (const memberType of ["apps", "packages"]) {
    const membersDir = path.join(repoRoot, memberType);
    for (const entry of await readdir(membersDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = path.join(membersDir, entry.name, "package.json");
      try {
        const packageJson = JSON.parse(
          await readFile(packageJsonPath, "utf8"),
        ) as WorkspacePackageManifest;

        if (
          typeof packageJson.name === "string" &&
          typeof packageJson.version === "string"
        ) {
          versions.set(packageJson.name, packageJson.version);
        }
      } catch {
        continue;
      }
    }
  }

  return versions;
}

function buildWorkspacePackageTarballSpecifiers(input: {
  dependencySpecRoot: string;
  packageNames: readonly string[];
  tarballsDir: string;
  workspacePackageVersions: ReadonlyMap<string, string>;
}): ReadonlyMap<string, string> {
  return new Map(
    input.packageNames.flatMap((packageName, index) => {
      const packageVersion = input.workspacePackageVersions.get(packageName);
      if (!packageVersion) {
        return [];
      }

      const tarballPath = path.join(
        resolvePackageTarballsDir(input.tarballsDir, packageName, index),
        toNpmPackTarballName(packageName, packageVersion),
      );

      return [
        [
          packageName,
          `file:${toPosixPath(path.relative(input.dependencySpecRoot, tarballPath))}`,
        ],
      ];
    }),
  );
}

function rewritePackedWorkspaceDependencySpecs(
  packageJson: WorkspacePackageManifest,
  packageName: string,
  workspacePackageTarballSpecifiers: ReadonlyMap<string, string>,
): boolean {
  const didRewriteDependencies = rewritePackedWorkspaceDependencyGroup(
    packageJson.dependencies,
    packageName,
    workspacePackageTarballSpecifiers,
  );
  const didRewriteOptionalDependencies = rewritePackedWorkspaceDependencyGroup(
    packageJson.optionalDependencies,
    packageName,
    workspacePackageTarballSpecifiers,
  );

  return didRewriteDependencies || didRewriteOptionalDependencies;
}

function rewritePackedWorkspaceDependencyGroup(
  dependencyGroup: Record<string, string> | undefined,
  packageName: string,
  workspacePackageTarballSpecifiers: ReadonlyMap<string, string>,
): boolean {
  if (!dependencyGroup) {
    return false;
  }

  let didRewrite = false;
  for (const [dependencyName, originalDependencySpec] of Object.entries(dependencyGroup)) {
    if (!originalDependencySpec.startsWith("workspace:")) {
      continue;
    }

    const rewrittenDependencySpec =
      workspacePackageTarballSpecifiers.get(dependencyName);
    if (!rewrittenDependencySpec) {
      throw new Error(
        `${packageName} depends on workspace package ${dependencyName}, but no sibling runner tarball was prepared for that dependency.`,
      );
    }

    dependencyGroup[dependencyName] = rewrittenDependencySpec;
    didRewrite = true;
  }

  return didRewrite;
}

async function copyPackageEntries(
  sourcePackageDir: string,
  packRoot: string,
  entries: readonly string[],
): Promise<void> {
  for (const entry of entries) {
    const targetPath = path.join(packRoot, entry);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(path.join(sourcePackageDir, entry), targetPath, {
      force: true,
      recursive: true,
    });
  }
}

async function runWorkspacePackagePackPreflights(
  packageNames: readonly string[],
  input: {
    repoRoot: string;
  },
): Promise<void> {
  const completedPreflightKeys = new Set<string>();

  for (const packageName of packageNames) {
    const preflightArgs = buildWorkspacePackagePackPreflightArgs(packageName);
    if (!preflightArgs) {
      continue;
    }

    const preflightKey = preflightArgs.join("\0");
    if (completedPreflightKeys.has(preflightKey)) {
      continue;
    }

    await runPnpmCommand(preflightArgs, { cwd: input.repoRoot });
    completedPreflightKeys.add(preflightKey);
  }
}

async function assertWorkspacePackageRuntimeFiles(
  packageName: string,
  packageDir: string,
): Promise<void> {
  if (packageName === CONTRACTS_PACKAGE_NAME) {
    await assertReadablePackageFile(
      packageDir,
      path.join("dist", "index.js"),
      "Contracts runtime entrypoint is missing before package packing; build workspace artifacts before packing.",
    );
    await assertReadablePackageFile(
      packageDir,
      path.join("dist", "schemas.js"),
      "Contracts schemas entrypoint is missing before package packing; build workspace artifacts before packing.",
    );
    return;
  }

  if (packageName !== HEALTH_COMMONS_PACKAGE_NAME) {
    return;
  }

  await assertReadablePackageFile(
    packageDir,
    path.join("dist", "runtime.js"),
    "Health Commons runtime entrypoint is missing before package packing; build workspace artifacts before packing.",
  );
  for (const relativePath of HEALTH_COMMONS_RUNTIME_GENERATED_FILES) {
    await assertReadablePackageFile(
      packageDir,
      relativePath,
      `Health Commons runtime generated artifact ${relativePath} is missing after generation preflight.`,
    );
  }
}

async function assertReadablePackageFile(
  packageDir: string,
  relativePath: string,
  message: string,
): Promise<void> {
  try {
    await readFile(path.join(packageDir, relativePath), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(message);
    }

    throw error;
  }
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

function resolveHostedRunnerPackConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return Number.parseInt(
    resolvePositiveIntegerEnv(
      env.MURPH_RUNNER_BUNDLE_PACK_CONCURRENCY,
      "4",
      "MURPH_RUNNER_BUNDLE_PACK_CONCURRENCY",
    ),
    10,
  );
}

function resolveDefaultHostedRunnerBuildConcurrency(): string {
  return "1";
}

function resolvePositiveIntegerEnv(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  const normalized = value?.trim();

  if (!normalized) {
    return fallback;
  }

  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return normalized;
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

export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  let hasError = false;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (!hasError && nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];

      if (item === undefined) {
        continue;
      }

      try {
        results[currentIndex] = await mapper(item, currentIndex);
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );

  if (hasError) {
    throw firstError;
  }

  return results;
}

function toPackageTarballDirectoryName(packageName: string): string {
  return packageName.replaceAll(/[^a-zA-Z0-9._-]+/g, "_");
}

function resolvePackageTarballsDir(
  tarballsDir: string,
  packageName: string,
  index: number,
): string {
  return path.join(
    tarballsDir,
    `${String(index + 1).padStart(2, "0")}-${toPackageTarballDirectoryName(packageName)}`,
  );
}

function toNpmPackTarballName(packageName: string, version: string): string {
  return `${packageName.replace(/^@/u, "").replaceAll("/", "-")}-${version}.tgz`;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}
