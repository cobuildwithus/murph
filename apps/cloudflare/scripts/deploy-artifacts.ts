import { createHash } from "node:crypto";
import { readlink, readdir, readFile, stat, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hostedRunnerRuntimePackageName,
  resolveHostedRunnerBuildPackageNames,
  resolveHostedRunnerWorkspacePackageNames,
} from "./runner-bundle-contract.js";

export const runnerBundleManifestFileName = ".murph-runner-bundle-manifest.json";

const runnerBundleManifestSchemaVersion = 1;
const deployArtifactTimestampGraceMs = 2_000;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultAppDir = path.resolve(scriptDir, "..");
const defaultRepoRoot = path.resolve(defaultAppDir, "../..");
const expectedDeployContainerImage = "../../../Dockerfile.cloudflare-hosted-runner";
const expectedDeployContainerBuildContext = "..";

export interface RunnerBundleManifest {
  buildPackageNames: readonly string[];
  bundleFingerprint: string;
  generatedAt: string;
  includeBundleOnlyDependencies: boolean;
  schemaVersion: typeof runnerBundleManifestSchemaVersion;
  sourceFingerprint: string;
  workspacePackageNames: readonly string[];
}

export async function writeRunnerBundleManifest(
  bundleDir: string,
  input: {
    appDir?: string;
    includeBundleOnlyDependencies?: boolean;
    now?: () => Date;
    repoRoot?: string;
  } = {},
): Promise<RunnerBundleManifest> {
  const manifest = await buildRunnerBundleManifest(bundleDir, input);

  await writeFile(
    path.join(bundleDir, runnerBundleManifestFileName),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

async function buildRunnerBundleManifest(
  bundleDir: string,
  input: {
    appDir?: string;
    includeBundleOnlyDependencies?: boolean;
    now?: () => Date;
    repoRoot?: string;
  } = {},
): Promise<RunnerBundleManifest> {
  const includeBundleOnlyDependencies = input.includeBundleOnlyDependencies ?? true;
  const appDir = input.appDir ?? defaultAppDir;
  const repoRoot = input.repoRoot ?? defaultRepoRoot;

  return {
    buildPackageNames: [
      ...resolveHostedRunnerBuildPackageNames({ includeBundleOnlyDependencies }),
    ],
    bundleFingerprint: await fingerprintRunnerBundle(bundleDir),
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    includeBundleOnlyDependencies,
    schemaVersion: runnerBundleManifestSchemaVersion,
    sourceFingerprint: await fingerprintHostedRunnerSources({
      appDir,
      includeBundleOnlyDependencies,
      repoRoot,
    }),
    workspacePackageNames: [
      ...resolveHostedRunnerWorkspacePackageNames({ includeBundleOnlyDependencies }),
    ],
  };
}

export async function assertPreparedDeployArtifacts(input: {
  appDir?: string;
  configPath: string;
  includeSecrets: boolean;
  repoRoot?: string;
  runnerBundleDir: string;
  secretsFilePath: string;
}): Promise<void> {
  const appDir = input.appDir ?? defaultAppDir;
  const repoRoot = input.repoRoot ?? defaultRepoRoot;
  const manifest = await readRunnerBundleManifest(input.runnerBundleDir);
  const manifestGeneratedAtMs = parseManifestGeneratedAt(manifest.generatedAt);

  assertGeneratedWranglerConfig(
    await readJsonObjectFile(input.configPath, "generated Wrangler config"),
  );
  await assertArtifactNotNewerThanManifest({
    artifactPath: input.configPath,
    label: "generated Wrangler config",
    manifestGeneratedAtMs,
  });

  if (input.includeSecrets) {
    await readJsonObjectFile(input.secretsFilePath, "worker secrets payload");
    await assertArtifactNotNewerThanManifest({
      artifactPath: input.secretsFilePath,
      label: "worker secrets payload",
      manifestGeneratedAtMs,
    });
  }

  await assertRunnerBundleShape(input.runnerBundleDir, manifest);

  if (!manifest.includeBundleOnlyDependencies) {
    throw new Error(
      "Prepared runner bundle was assembled for hosted-local use; rebuild deploy artifacts before deploying.",
    );
  }

  const expectedWorkspacePackageNames = [
    ...resolveHostedRunnerWorkspacePackageNames({ includeBundleOnlyDependencies: true }),
  ];
  const expectedBuildPackageNames = [
    ...resolveHostedRunnerBuildPackageNames({ includeBundleOnlyDependencies: true }),
  ];

  if (!stringArraysEqual(manifest.workspacePackageNames, expectedWorkspacePackageNames)) {
    throw new Error("Prepared runner bundle package closure is stale; rebuild deploy artifacts before deploying.");
  }

  if (!stringArraysEqual(manifest.buildPackageNames, expectedBuildPackageNames)) {
    throw new Error("Prepared runner bundle build closure is stale; rebuild deploy artifacts before deploying.");
  }

  const expectedSourceFingerprint = await fingerprintHostedRunnerSources({
    appDir,
    includeBundleOnlyDependencies: true,
    repoRoot,
  });

  if (manifest.sourceFingerprint !== expectedSourceFingerprint) {
    throw new Error("Prepared runner bundle source fingerprint is stale; rebuild deploy artifacts before deploying.");
  }

  const expectedBundleFingerprint = await fingerprintRunnerBundle(input.runnerBundleDir);

  if (manifest.bundleFingerprint !== expectedBundleFingerprint) {
    throw new Error("Prepared runner bundle changed after assembly; rebuild deploy artifacts before deploying.");
  }
}

async function readRunnerBundleManifest(bundleDir: string): Promise<RunnerBundleManifest> {
  const manifest = await readJsonObjectFile(
    path.join(bundleDir, runnerBundleManifestFileName),
    "runner bundle manifest",
  );

  if (
    manifest.schemaVersion !== runnerBundleManifestSchemaVersion ||
    typeof manifest.generatedAt !== "string" ||
    typeof manifest.includeBundleOnlyDependencies !== "boolean" ||
    typeof manifest.sourceFingerprint !== "string" ||
    typeof manifest.bundleFingerprint !== "string" ||
    !isStringArray(manifest.workspacePackageNames) ||
    !isStringArray(manifest.buildPackageNames)
  ) {
    throw new Error("Runner bundle manifest is incomplete or invalid.");
  }

  return {
    buildPackageNames: manifest.buildPackageNames,
    bundleFingerprint: manifest.bundleFingerprint,
    generatedAt: manifest.generatedAt,
    includeBundleOnlyDependencies: manifest.includeBundleOnlyDependencies,
    schemaVersion: runnerBundleManifestSchemaVersion,
    sourceFingerprint: manifest.sourceFingerprint,
    workspacePackageNames: manifest.workspacePackageNames,
  };
}

async function assertRunnerBundleShape(
  bundleDir: string,
  manifest: RunnerBundleManifest,
): Promise<void> {
  const packageJson = await readJsonObjectFile(
    path.join(bundleDir, "package.json"),
    "runner bundle package manifest",
  );

  if (packageJson.name !== hostedRunnerRuntimePackageName) {
    throw new Error("Runner bundle package manifest has the wrong package name.");
  }

  assertNoWorkspaceDependencySpecs(packageJson.dependencies, "dependencies");
  assertNoWorkspaceDependencySpecs(packageJson.optionalDependencies, "optionalDependencies");
  await assertReadableFile(path.join(bundleDir, "dist", "container-entrypoint.js"), "runner container entrypoint");
  await assertReadableFile(path.join(bundleDir, "dist", "index.js"), "runner worker entrypoint");
  await assertReadableDirectory(path.join(bundleDir, "node_modules"), "runner bundle dependencies");

  for (const packageName of manifest.workspacePackageNames) {
    if (packageName === hostedRunnerRuntimePackageName) {
      continue;
    }

    await assertReadableFile(
      path.join(bundleDir, "node_modules", ...packageName.split("/"), "package.json"),
      `runner dependency ${packageName}`,
    );
  }

  if (manifest.includeBundleOnlyDependencies) {
    await assertReadableFile(path.join(bundleDir, "node_modules", ".bin", "murph"), "runner murph binary");
    await assertReadableFile(path.join(bundleDir, "node_modules", ".bin", "vault-cli"), "runner vault-cli binary");
  }
}

function assertGeneratedWranglerConfig(config: Record<string, unknown>): void {
  const containers = config.containers;

  if (!Array.isArray(containers)) {
    throw new Error("Generated Wrangler config is missing the runner container definition.");
  }

  const runnerContainer = containers.find((entry) =>
    Boolean(
      entry &&
        typeof entry === "object" &&
        "class_name" in entry &&
        entry.class_name === "RunnerContainer",
    ),
  );

  if (!runnerContainer || typeof runnerContainer !== "object") {
    throw new Error("Generated Wrangler config is missing the RunnerContainer entry.");
  }

  const image = "image" in runnerContainer ? runnerContainer.image : undefined;
  const imageBuildContext = "image_build_context" in runnerContainer
    ? runnerContainer.image_build_context
    : undefined;

  if (
    image !== expectedDeployContainerImage ||
    imageBuildContext !== expectedDeployContainerBuildContext
  ) {
    throw new Error("Generated Wrangler config must use the prepared runner-bundle image context.");
  }
}

async function assertArtifactNotNewerThanManifest(input: {
  artifactPath: string;
  label: string;
  manifestGeneratedAtMs: number;
}): Promise<void> {
  const artifactStat = await stat(input.artifactPath);

  if (artifactStat.mtimeMs > input.manifestGeneratedAtMs + deployArtifactTimestampGraceMs) {
    throw new Error(`${input.label} is newer than the runner bundle; rebuild deploy artifacts before deploying.`);
  }
}

function parseManifestGeneratedAt(value: string): number {
  const timestampMs = Date.parse(value);

  if (!Number.isFinite(timestampMs)) {
    throw new Error("Runner bundle manifest has an invalid generatedAt timestamp.");
  }

  return timestampMs;
}

function assertNoWorkspaceDependencySpecs(
  dependencyGroup: unknown,
  groupName: string,
): void {
  if (dependencyGroup === undefined) {
    return;
  }

  if (!isStringRecord(dependencyGroup)) {
    throw new Error(`Runner bundle package manifest ${groupName} must be a string map.`);
  }

  const workspaceDependencyName = Object.entries(dependencyGroup).find(
    ([, version]) => version.startsWith("workspace:"),
  )?.[0];

  if (workspaceDependencyName) {
    throw new Error(`Runner bundle still contains a workspace dependency for ${workspaceDependencyName}.`);
  }
}

async function readJsonObjectFile(
  filePath: string,
  label: string,
): Promise<Record<string, unknown>> {
  let raw: string;

  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`Missing ${label}.`);
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

async function assertReadableFile(filePath: string, label: string): Promise<void> {
  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      throw new Error(`${label} must be a file.`);
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`Missing ${label}.`);
    }

    throw error;
  }
}

async function assertReadableDirectory(directoryPath: string, label: string): Promise<void> {
  try {
    const directoryStat = await stat(directoryPath);

    if (!directoryStat.isDirectory()) {
      throw new Error(`${label} must be a directory.`);
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`Missing ${label}.`);
    }

    throw error;
  }
}

async function fingerprintHostedRunnerSources(input: {
  appDir: string;
  includeBundleOnlyDependencies: boolean;
  repoRoot: string;
}): Promise<string> {
  const sourceRoots = await resolveHostedRunnerSourceRoots(input);
  const files = await collectFingerprintFiles(input.repoRoot, sourceRoots, {
    skipDirectoryNames: sourceDirectorySkipNames,
  });

  return fingerprintFiles(input.repoRoot, files);
}

async function fingerprintRunnerBundle(bundleDir: string): Promise<string> {
  const files = await collectFingerprintFiles(bundleDir, [bundleDir], {
    skipFileNames: new Set([runnerBundleManifestFileName]),
  });

  return fingerprintFiles(bundleDir, files);
}

async function resolveHostedRunnerSourceRoots(input: {
  appDir: string;
  includeBundleOnlyDependencies: boolean;
  repoRoot: string;
}): Promise<string[]> {
  const packageNames = new Set([
    hostedRunnerRuntimePackageName,
    ...resolveHostedRunnerBuildPackageNames({
      includeBundleOnlyDependencies: input.includeBundleOnlyDependencies,
    }),
  ]);
  const packageDirectories = await Promise.all(
    [...packageNames].map((packageName) =>
      resolveWorkspacePackageDirectory(input.repoRoot, packageName),
    ),
  );
  const roots = [
    path.join(input.repoRoot, "package.json"),
    path.join(input.repoRoot, "pnpm-lock.yaml"),
    path.join(input.repoRoot, "pnpm-workspace.yaml"),
    path.join(input.repoRoot, "tsconfig.json"),
    path.join(input.repoRoot, "tsconfig.base.json"),
    path.join(input.repoRoot, "Dockerfile.cloudflare-hosted-runner"),
    path.join(input.repoRoot, "Dockerfile.cloudflare-hosted-runner-base"),
    path.join(input.appDir, ".dockerignore"),
    path.join(input.appDir, "scripts"),
  ];

  for (const packageDir of packageDirectories) {
    roots.push(
      path.join(packageDir, "package.json"),
      path.join(packageDir, "src"),
      path.join(packageDir, "tsconfig.json"),
      path.join(packageDir, "tsconfig.build.json"),
      path.join(packageDir, "tsconfig.typecheck.json"),
    );
  }

  return roots;
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

      const packageDir = path.join(membersDir, entry.name);

      try {
        const packageJson = await readJsonObjectFile(
          path.join(packageDir, "package.json"),
          `workspace package ${packageName} manifest`,
        );

        if (packageJson.name === packageName) {
          return packageDir;
        }
      } catch {
        continue;
      }
    }
  }

  throw new Error(`Could not resolve workspace package directory for ${packageName}.`);
}

async function collectFingerprintFiles(
  rootDir: string,
  roots: readonly string[],
  options: {
    skipDirectoryNames?: ReadonlySet<string>;
    skipFileNames?: ReadonlySet<string>;
  } = {},
): Promise<string[]> {
  const files = new Set<string>();

  for (const root of roots) {
    await collectFingerprintFilesFromPath(root, files, options);
  }

  return [...files].sort((left, right) =>
    toPosixRelativePath(rootDir, left).localeCompare(toPosixRelativePath(rootDir, right)),
  );
}

async function collectFingerprintFilesFromPath(
  currentPath: string,
  files: Set<string>,
  options: {
    skipDirectoryNames?: ReadonlySet<string>;
    skipFileNames?: ReadonlySet<string>;
  },
): Promise<void> {
  let entryStat;

  try {
    entryStat = await lstat(currentPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }

  const entryName = path.basename(currentPath);

  if (entryStat.isDirectory()) {
    if (options.skipDirectoryNames?.has(entryName)) {
      return;
    }

    for (const entry of await readdir(currentPath, { withFileTypes: true })) {
      await collectFingerprintFilesFromPath(
        path.join(currentPath, entry.name),
        files,
        options,
      );
    }

    return;
  }

  if (options.skipFileNames?.has(entryName)) {
    return;
  }

  if (entryStat.isFile() || entryStat.isSymbolicLink()) {
    files.add(currentPath);
  }
}

async function fingerprintFiles(rootDir: string, files: readonly string[]): Promise<string> {
  const hash = createHash("sha256");

  for (const filePath of files) {
    const relativePath = toPosixRelativePath(rootDir, filePath);
    const entryStat = await lstat(filePath);

    hash.update(relativePath);
    hash.update("\0");

    if (entryStat.isSymbolicLink()) {
      hash.update("symlink");
      hash.update("\0");
      hash.update(await readlink(filePath));
      hash.update("\0");
      continue;
    }

    hash.update(await readFile(filePath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

function toPosixRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

const sourceDirectorySkipNames = new Set([
  ".deploy",
  ".next",
  ".next-dev",
  ".next-smoke",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).every((entry) => typeof entry === "string"),
  );
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}
