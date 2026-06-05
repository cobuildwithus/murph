import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildHostedWorkerSecretsPayload,
  buildHostedWranglerDeployConfig,
  readHostedDeployAutomationEnvironment,
} from "./deploy-automation.js";
import {
  hostedRunnerRuntimePackageName,
  resolveHostedRunnerBuildPackageNames,
  resolveHostedRunnerWorkspacePackageNames,
} from "./runner-bundle-contract.js";

export const runnerBundleManifestFileName = ".murph-runner-bundle-manifest.json";

const runnerBundleManifestSchemaVersion = 2;
const deployArtifactTimestampGraceMs = 2_000;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultAppDir = path.resolve(scriptDir, "..");
const defaultRepoRoot = path.resolve(defaultAppDir, "../..");
const expectedDeployContainerImage = "../../../Dockerfile.cloudflare-hosted-runner";
const expectedDeployContainerBuildContext = "..";
const healthCommonsPackageName = "@murphai/health-commons";
const healthCommonsFinnishDrySaunaProtocol = {
  key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  slug: "protocols/dry-sauna/murph-finnish-standard-3x-week",
  title: "Finnish Dry Sauna",
} as const;
const healthCommonsRuntimeGeneratedArtifacts = [
  {
    label: "Health Commons protocol index",
    relativePath: path.join("generated", "protocol-index.json"),
  },
  {
    label: "Health Commons protocol run specs",
    relativePath: path.join("generated", "protocol-run-specs.json"),
  },
  {
    label: "Health Commons protocol family graph",
    relativePath: path.join("generated", "protocol-family-graph.json"),
  },
] as const;

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface RunnerBundleManifest {
  buildSkipped: boolean;
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
    buildSkipped?: boolean;
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
    buildSkipped?: boolean;
    includeBundleOnlyDependencies?: boolean;
    now?: () => Date;
    repoRoot?: string;
  } = {},
): Promise<RunnerBundleManifest> {
  const includeBundleOnlyDependencies = input.includeBundleOnlyDependencies ?? true;
  const appDir = input.appDir ?? defaultAppDir;
  const repoRoot = input.repoRoot ?? defaultRepoRoot;

  return {
    buildSkipped: input.buildSkipped === true,
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
  source?: EnvSource;
}): Promise<void> {
  const source = input.source ?? process.env;
  const manifest = await assertPreparedRunnerBundle({
    ...(input.appDir ? { appDir: input.appDir } : {}),
    ...(input.repoRoot ? { repoRoot: input.repoRoot } : {}),
    runnerBundleDir: input.runnerBundleDir,
  });
  const manifestGeneratedAtMs = parseManifestGeneratedAt(manifest.generatedAt);

  const generatedConfig = await readJsonObjectFile(
    input.configPath,
    "generated Wrangler config",
  );
  assertGeneratedWranglerConfig(generatedConfig);
  assertGeneratedWranglerConfigMatchesCurrentEnvironment(generatedConfig, source);
  await assertArtifactNotNewerThanManifest({
    artifactPath: input.configPath,
    label: "generated Wrangler config",
    manifestGeneratedAtMs,
  });

  if (input.includeSecrets) {
    const workerSecretsPayload = await readJsonObjectFile(
      input.secretsFilePath,
      "worker secrets payload",
    );
    assertWorkerSecretsPayloadMatchesCurrentEnvironment(
      workerSecretsPayload,
      source,
    );
  }

}

export async function assertPreparedRunnerBundle(input: {
  appDir?: string;
  repoRoot?: string;
  runnerBundleDir: string;
}): Promise<RunnerBundleManifest> {
  const appDir = input.appDir ?? defaultAppDir;
  const repoRoot = input.repoRoot ?? defaultRepoRoot;
  const manifest = await readRunnerBundleManifest(input.runnerBundleDir);

  await assertRunnerBundleShape(input.runnerBundleDir, manifest);

  if (manifest.buildSkipped) {
    throw new Error(
      "Prepared runner bundle was assembled without rebuilding workspace artifacts; rebuild deploy artifacts before deploying.",
    );
  }

  if (!manifest.includeBundleOnlyDependencies) {
    throw new Error(
      "Prepared runner bundle was assembled for hosted-local use; rebuild deploy artifacts before deploying.",
    );
  }

  const expectedWorkspacePackageNames = [
    ...resolveHostedRunnerWorkspacePackageNames({
      includeBundleOnlyDependencies: true,
    }),
  ];
  const expectedBuildPackageNames = [
    ...resolveHostedRunnerBuildPackageNames({
      includeBundleOnlyDependencies: true,
    }),
  ];

  if (
    !stringArraysEqual(
      manifest.workspacePackageNames,
      expectedWorkspacePackageNames,
    )
  ) {
    throw new Error(
      "Prepared runner bundle package closure is stale; rebuild deploy artifacts before deploying.",
    );
  }

  if (!stringArraysEqual(manifest.buildPackageNames, expectedBuildPackageNames)) {
    throw new Error(
      "Prepared runner bundle build closure is stale; rebuild deploy artifacts before deploying.",
    );
  }

  const expectedSourceFingerprint = await fingerprintHostedRunnerSources({
    appDir,
    includeBundleOnlyDependencies: true,
    repoRoot,
  });

  if (manifest.sourceFingerprint !== expectedSourceFingerprint) {
    throw new Error(
      "Prepared runner bundle source fingerprint is stale; rebuild deploy artifacts before deploying.",
    );
  }

  const expectedBundleFingerprint = await fingerprintRunnerBundle(
    input.runnerBundleDir,
  );

  if (manifest.bundleFingerprint !== expectedBundleFingerprint) {
    throw new Error("Prepared runner bundle changed after assembly; rebuild deploy artifacts before deploying.");
  }

  await assertRunnerBundleHealthCommonsProtocolArtifacts(input.runnerBundleDir);

  return manifest;
}

async function readRunnerBundleManifest(bundleDir: string): Promise<RunnerBundleManifest> {
  const manifest = await readJsonObjectFile(
    path.join(bundleDir, runnerBundleManifestFileName),
    "runner bundle manifest",
  );

  if (
    manifest.schemaVersion !== runnerBundleManifestSchemaVersion ||
    typeof manifest.buildSkipped !== "boolean" ||
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
    buildSkipped: manifest.buildSkipped,
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
  await assertReadableFile(
    path.join(bundleDir, "dist", "container-entrypoint.js"),
    "runner container entrypoint",
  );
  await assertReadableFile(
    path.join(bundleDir, "dist", "index.js"),
    "runner worker entrypoint",
  );
  await assertReadableDirectory(
    path.join(bundleDir, "node_modules"),
    "runner bundle dependencies",
  );

  for (const packageName of manifest.workspacePackageNames) {
    if (packageName === hostedRunnerRuntimePackageName) {
      continue;
    }

    await assertInstalledRunnerDependency(bundleDir, packageName);
  }

  if (manifest.includeBundleOnlyDependencies) {
    await assertReadableFile(
      path.join(bundleDir, "node_modules", ".bin", "murph"),
      "runner murph binary",
    );
    await assertReadableFile(
      path.join(bundleDir, "node_modules", ".bin", "vault-cli"),
      "runner vault-cli binary",
    );
  }

  await assertRunnerBundleHealthCommonsPackageFiles(bundleDir);
}

function assertGeneratedWranglerConfig(config: Record<string, unknown>): void {
  const containers = config.containers;

  if (!Array.isArray(containers)) {
    throw new Error("Generated Wrangler config is missing the runner container definition.");
  }

  const runnerContainer = findGeneratedContainerConfig(
    containers,
    "RunnerContainer",
  );
  const deploySmokeContainer = findGeneratedContainerConfig(
    containers,
    "DeploySmokeRunnerContainer",
  );

  if (!runnerContainer) {
    throw new Error("Generated Wrangler config is missing the RunnerContainer entry.");
  }

  if (!deploySmokeContainer) {
    throw new Error("Generated Wrangler config is missing the DeploySmokeRunnerContainer entry.");
  }

  assertGeneratedContainerUsesPreparedImage(runnerContainer);
  assertGeneratedContainerUsesPreparedImage(deploySmokeContainer);
}

function findGeneratedContainerConfig(
  containers: unknown[],
  className: string,
): Record<string, unknown> | null {
  const entry = containers.find((candidate) =>
    Boolean(
      candidate &&
        typeof candidate === "object" &&
        "class_name" in candidate &&
        candidate.class_name === className,
    ),
  );
  return entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
}

function assertGeneratedContainerUsesPreparedImage(
  container: Record<string, unknown>,
): void {
  const image = container.image;
  const imageBuildContext = container.image_build_context;

  if (
    image !== expectedDeployContainerImage ||
    imageBuildContext !== expectedDeployContainerBuildContext
  ) {
    throw new Error("Generated Wrangler config must use the prepared runner-bundle image context.");
  }
}

function assertGeneratedWranglerConfigMatchesCurrentEnvironment(
  config: Record<string, unknown>,
  source: EnvSource,
): void {
  const expectedConfig = buildHostedWranglerDeployConfig(
    readHostedDeployAutomationEnvironment(source),
  );

  if (!stableJsonEqual(config, expectedConfig)) {
    throw new Error(
      "Generated Wrangler config does not match the current deploy environment; rerender deploy artifacts before deploying.",
    );
  }
}

function assertWorkerSecretsPayloadMatchesCurrentEnvironment(
  payload: Record<string, unknown>,
  source: EnvSource,
): void {
  const expectedPayload = buildHostedWorkerSecretsPayload(source);

  if (!stableJsonEqual(payload, expectedPayload)) {
    throw new Error(
      "Worker secrets payload does not match the current deploy environment; rerender deploy artifacts before deploying.",
    );
  }
}

async function assertArtifactNotNewerThanManifest(input: {
  artifactPath: string;
  label: string;
  manifestGeneratedAtMs: number;
}): Promise<void> {
  const artifactStat = await stat(input.artifactPath);

  if (artifactStat.mtimeMs > input.manifestGeneratedAtMs + deployArtifactTimestampGraceMs) {
    throw new Error(
      `${input.label} is newer than the runner bundle; rebuild deploy artifacts before deploying.`,
    );
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
    throw new Error(
      `Runner bundle package manifest ${groupName} must be a string map.`,
    );
  }

  const workspaceDependencyName = Object.entries(dependencyGroup).find(
    ([, version]) => version.startsWith("workspace:"),
  )?.[0];

  if (workspaceDependencyName) {
    throw new Error(
      `Runner bundle still contains a workspace dependency for ${workspaceDependencyName}.`,
    );
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

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);

    return fileStat.isFile();
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

async function assertInstalledRunnerDependency(
  bundleDir: string,
  packageName: string,
): Promise<void> {
  const nodeModulesDir = path.join(bundleDir, "node_modules");
  const packageParts = packageName.split("/");

  if (await isReadableFile(path.join(nodeModulesDir, ...packageParts, "package.json"))) {
    return;
  }

  if (
    await hasPnpmVirtualPackageManifest(
      path.join(nodeModulesDir, ".pnpm"),
      packageParts,
    )
  ) {
    return;
  }

  throw new Error(`Missing runner dependency ${packageName}.`);
}

async function assertRunnerBundleHealthCommonsPackageFiles(bundleDir: string): Promise<void> {
  const packageDirs = await findInstalledPackageDirectories(
    path.join(bundleDir, "node_modules"),
    healthCommonsPackageName,
  );

  if (packageDirs.length === 0) {
    throw new Error(`Missing runner dependency ${healthCommonsPackageName}.`);
  }

  for (const packageDir of packageDirs) {
    await resolveContainedRunnerDependencyFile({
      filePath: path.join(packageDir, "dist", "runtime.js"),
      label: "Health Commons runtime entrypoint",
      packageName: healthCommonsPackageName,
      rootDir: bundleDir,
    });
    for (const artifact of healthCommonsRuntimeGeneratedArtifacts) {
      await resolveContainedRunnerDependencyFile({
        filePath: path.join(packageDir, artifact.relativePath),
        label: artifact.label,
        packageName: healthCommonsPackageName,
        rootDir: bundleDir,
      });
    }
  }
}

async function assertRunnerBundleHealthCommonsProtocolArtifacts(bundleDir: string): Promise<void> {
  const packageDirs = await findInstalledPackageDirectories(
    path.join(bundleDir, "node_modules"),
    healthCommonsPackageName,
  );

  if (packageDirs.length === 0) {
    throw new Error(`Missing runner dependency ${healthCommonsPackageName}.`);
  }

  for (const packageDir of packageDirs) {
    await resolveContainedRunnerDependencyFile({
      filePath: path.join(packageDir, "dist", "runtime.js"),
      label: "Health Commons runtime entrypoint",
      packageName: healthCommonsPackageName,
      rootDir: bundleDir,
    });
    const [protocolIndex, protocolRunSpecs, protocolFamilyGraph] = await Promise.all(
      healthCommonsRuntimeGeneratedArtifacts.map(async (artifact) => {
        const artifactPath = await resolveContainedRunnerDependencyFile({
          filePath: path.join(packageDir, artifact.relativePath),
          label: artifact.label,
          packageName: healthCommonsPackageName,
          rootDir: bundleDir,
        });
        return await readJsonObjectFile(
          artifactPath,
          `Runner ${artifact.label}`,
        );
      }),
    );
    assertHealthCommonsProtocolIndexIncludesFinnishDrySauna(protocolIndex);
    assertHealthCommonsProtocolRunSpecsIncludeFinnishDrySauna(protocolRunSpecs);
    assertHealthCommonsProtocolFamilyGraphIncludesFinnishDrySauna(protocolFamilyGraph);
  }
}

async function resolveContainedRunnerDependencyFile(input: {
  filePath: string;
  label: string;
  packageName: string;
  rootDir: string;
}): Promise<string> {
  let entryStat;

  try {
    entryStat = await lstat(input.filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`Missing ${input.label}.`);
    }

    throw error;
  }

  if (entryStat.isSymbolicLink()) {
    throw new Error(`${input.label} must not be a symlink.`);
  }

  if (!entryStat.isFile()) {
    throw new Error(`${input.label} must be a file.`);
  }

  const [resolvedFilePath, resolvedRootDir] = await Promise.all([
    realpath(input.filePath),
    realpath(input.rootDir),
  ]);

  if (!isPathInsideDirectory(resolvedRootDir, resolvedFilePath)) {
    throw new Error(`Runner dependency ${input.packageName} ${input.label} resolves outside the runner bundle.`);
  }

  return resolvedFilePath;
}

async function findInstalledPackageDirectories(
  nodeModulesDir: string,
  packageName: string,
): Promise<string[]> {
  const packageParts = packageName.split("/");
  const packageDirs = new Set<string>();
  const containmentRootDir = path.dirname(nodeModulesDir);

  await collectInstalledPackageDirectories({
    containmentRootDir,
    currentDir: nodeModulesDir,
    packageDirs,
    packageName,
    packageParts,
  });

  return [...packageDirs].sort();
}

async function collectInstalledPackageDirectories(input: {
  containmentRootDir: string;
  currentDir: string;
  packageDirs: Set<string>;
  packageName: string;
  packageParts: readonly string[];
}): Promise<void> {
  await maybeCollectInstalledPackageDirectory(input.currentDir, input);

  let entries;

  try {
    entries = await readdir(input.currentDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(input.currentDir, entry.name);

    if (entry.isSymbolicLink()) {
      await maybeCollectInstalledPackageDirectory(entryPath, input);
      continue;
    }

    if (!entry.isDirectory() || entry.name === ".bin") {
      continue;
    }

    await collectInstalledPackageDirectories({
      ...input,
      currentDir: entryPath,
    });
  }
}

async function maybeCollectInstalledPackageDirectory(
  packageDir: string,
  input: {
    containmentRootDir: string;
    packageDirs: Set<string>;
    packageName: string;
    packageParts: readonly string[];
  },
): Promise<void> {
  if (!isPackageDirectory(packageDir, input.packageParts)) {
    return;
  }

  if (
    !(await isContainedPackageDirectory({
      packageDir,
      packageName: input.packageName,
      rootDir: input.containmentRootDir,
    }))
  ) {
    return;
  }

  const packageJsonPath = path.join(packageDir, "package.json");

  if (!(await isReadableFile(packageJsonPath))) {
    return;
  }

  const packageJson = await readJsonObjectFile(packageJsonPath, "runner package manifest");

  if (packageJson.name === input.packageName) {
    input.packageDirs.add(packageDir);
  }
}

async function isContainedPackageDirectory(input: {
  packageDir: string;
  packageName: string;
  rootDir: string;
}): Promise<boolean> {
  let resolvedPackageDir: string;
  let resolvedRootDir: string;

  try {
    [resolvedPackageDir, resolvedRootDir] = await Promise.all([
      realpath(input.packageDir),
      realpath(input.rootDir),
    ]);
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }

  if (!isPathInsideDirectory(resolvedRootDir, resolvedPackageDir)) {
    throw new Error(`Runner dependency ${input.packageName} resolves outside the runner bundle.`);
  }

  return true;
}

function isPathInsideDirectory(rootDir: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootDir, candidatePath);

  return relativePath === "" ||
    Boolean(relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isPackageDirectory(
  directoryPath: string,
  packageParts: readonly string[],
): boolean {
  const parts = directoryPath.split(path.sep);
  const tail = parts.slice(-packageParts.length);

  return tail.length === packageParts.length
    && tail.every((part, index) => part === packageParts[index]);
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

function assertHealthCommonsProtocolIndexIncludesFinnishDrySauna(
  artifact: Record<string, unknown>,
): void {
  const protocol = findProtocolArtifactEntry(artifact, "protocols");

  if (!protocol) {
    throw new Error(
      "Runner Health Commons protocol index is stale or missing Finnish Dry Sauna; rebuild deploy artifacts before deploying.",
    );
  }
}

function assertHealthCommonsProtocolRunSpecsIncludeFinnishDrySauna(
  artifact: Record<string, unknown>,
): void {
  const protocol = findProtocolArtifactEntry(artifact, "protocols");

  if (
    !protocol ||
    !isRecordObject(protocol.protocol) ||
    !Array.isArray(protocol.testPlans) ||
    protocol.testPlans.length === 0
  ) {
    throw new Error(
      "Runner Health Commons protocol run specs are stale or missing Finnish Dry Sauna; rebuild deploy artifacts before deploying.",
    );
  }
}

function assertHealthCommonsProtocolFamilyGraphIncludesFinnishDrySauna(
  artifact: Record<string, unknown>,
): void {
  const protocol = findProtocolArtifactEntry(artifact, "protocols");
  const families = Array.isArray(artifact.families) ? artifact.families : [];
  const drySaunaFamily = families.find((entry) =>
    isRecordObject(entry) && entry.key === "experiment_family:dry-sauna"
  );
  const edges = Array.isArray(artifact.edges) ? artifact.edges : [];
  const hasParentFamilyEdge = edges.some((entry) =>
    isRecordObject(entry) &&
    entry.sourceKey === healthCommonsFinnishDrySaunaProtocol.key &&
    entry.targetKey === "experiment_family:dry-sauna" &&
    entry.type === "parent_family"
  );

  if (!protocol || !drySaunaFamily || !hasParentFamilyEdge) {
    throw new Error(
      "Runner Health Commons protocol family graph is stale or missing Finnish Dry Sauna; rebuild deploy artifacts before deploying.",
    );
  }
}

function findProtocolArtifactEntry(
  artifact: Record<string, unknown>,
  collectionKey: "protocols",
): Record<string, unknown> | null {
  if (
    typeof artifact.catalogHash !== "string" ||
    !Array.isArray(artifact[collectionKey])
  ) {
    return null;
  }

  const protocol = artifact[collectionKey].find((entry) =>
    isRecordObject(entry) &&
    entry.key === healthCommonsFinnishDrySaunaProtocol.key
  );

  if (
    !isRecordObject(protocol) ||
    protocol.entityType !== "protocol_variant" ||
    protocol.slug !== healthCommonsFinnishDrySaunaProtocol.slug ||
    protocol.title !== healthCommonsFinnishDrySaunaProtocol.title
  ) {
    return null;
  }

  return protocol;
}

async function hasPnpmVirtualPackageManifest(
  virtualStoreDir: string,
  packageParts: readonly string[],
): Promise<boolean> {
  let entries;

  try {
    entries = await readdir(virtualStoreDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (
      await isReadableFile(
        path.join(virtualStoreDir, entry.name, "node_modules", ...packageParts, "package.json"),
      )
    ) {
      return true;
    }
  }

  return false;
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

interface WorkspacePackageSourceManifest {
  bin?: unknown;
  files?: unknown;
}

async function readWorkspacePackageSourceManifest(
  packageDir: string,
): Promise<WorkspacePackageSourceManifest> {
  return await readJsonObjectFile(
    path.join(packageDir, "package.json"),
    "workspace package manifest",
  );
}

function listWorkspacePackageSourceAssetRoots(
  packageDir: string,
  packageJson: WorkspacePackageSourceManifest,
): string[] {
  const roots = [
    path.join(packageDir, "package.json"),
    path.join(packageDir, "src"),
    path.join(packageDir, "tsconfig.json"),
    path.join(packageDir, "tsconfig.build.json"),
    path.join(packageDir, "tsconfig.typecheck.json"),
    path.join(packageDir, "README.md"),
    path.join(packageDir, "DEPLOY.md"),
    path.join(packageDir, "assets"),
    path.join(packageDir, "bin"),
    path.join(packageDir, "scripts"),
  ];

  for (const entry of listPackageFilesEntries(packageJson.files)) {
    if (isPackageBuildOutputEntry(entry)) {
      continue;
    }

    roots.push(path.join(packageDir, entry));
  }

  for (const entry of listPackageBinEntries(packageJson.bin)) {
    if (isPackageBuildOutputEntry(entry)) {
      continue;
    }

    roots.push(path.join(packageDir, entry));
  }

  return roots;
}

function isPackageBuildOutputEntry(entry: string): boolean {
  const firstPart = entry.split(/[\\/]/u).find((part) => part !== "" && part !== ".");
  return firstPart === "dist" || firstPart === "generated";
}

function listPackageFilesEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) =>
    typeof entry === "string" && isSafeRelativePackagePath(entry) ? [entry] : []
  );
}

function listPackageBinEntries(value: unknown): string[] {
  if (typeof value === "string") {
    return isSafeRelativePackagePath(value) ? [value] : [];
  }

  if (!isStringRecord(value)) {
    return [];
  }

  return Object.values(value).filter(isSafeRelativePackagePath);
}

function isSafeRelativePackagePath(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/u).includes("..");
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
    roots.push(...listWorkspacePackageSourceAssetRoots(
      packageDir,
      await readWorkspacePackageSourceManifest(packageDir),
    ));
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

function stableJsonEqual(left: unknown, right: unknown): boolean {
  return stableJsonStringify(left) === stableJsonStringify(right);
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJsonStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
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
