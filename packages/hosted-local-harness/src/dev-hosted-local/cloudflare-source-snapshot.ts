import { existsSync, readdirSync, readFileSync } from "node:fs";
import { access, copyFile, cp, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";

import { cloudflareDir, HOSTED_LOCAL_RUNNER_BUNDLE_ROOT, repoRoot } from "./constants.ts";
import { throwIfAbortSignalAborted } from "./runtime.ts";

const HOSTED_LOCAL_CLOUDFLARE_SOURCE_SNAPSHOT_DIR = "cloudflare-source";
const HOSTED_LOCAL_WORKSPACE_PACKAGE_SCOPE = "@murphai/";

type HostedLocalCloudflareSourceSnapshot = {
  cloudflareAppDir: string;
  workspaceRoot: string;
};

type HostedLocalWorkspacePackage = {
  dependencies: readonly string[];
  dir: string;
  externalDependencies: readonly string[];
  packageJsonPath: string;
};

export async function prepareHostedLocalCloudflareSourceSnapshot(input: {
  abortSignal: AbortSignal | undefined;
  tempDir: string;
}): Promise<HostedLocalCloudflareSourceSnapshot> {
  const workspaceRoot = path.join(
    input.tempDir,
    HOSTED_LOCAL_CLOUDFLARE_SOURCE_SNAPSHOT_DIR,
  );
  const cloudflareAppDir = path.join(workspaceRoot, "apps", "cloudflare");

  await rm(workspaceRoot, { force: true, recursive: true });
  await mkdir(cloudflareAppDir, { recursive: true });
  throwIfAbortSignalAborted(input.abortSignal);

  await copyFile(
    path.join(repoRoot, "Dockerfile.cloudflare-hosted-runner"),
    path.join(workspaceRoot, "Dockerfile.cloudflare-hosted-runner"),
  );
  await copyFile(
    path.join(cloudflareDir, "package.json"),
    path.join(cloudflareAppDir, "package.json"),
  );
  await copyFile(
    path.join(cloudflareDir, ".dockerignore"),
    path.join(cloudflareAppDir, ".dockerignore"),
  );
  await cp(
    path.join(cloudflareDir, "src"),
    path.join(cloudflareAppDir, "src"),
    { recursive: true },
  );
  throwIfAbortSignalAborted(input.abortSignal);

  await mkdir(path.join(cloudflareAppDir, ".deploy"), { recursive: true });
  await cp(
    HOSTED_LOCAL_RUNNER_BUNDLE_ROOT,
    path.join(cloudflareAppDir, ".deploy", "runner-bundle"),
    { recursive: true },
  );
  await symlinkIfPresent(
    path.join(repoRoot, "node_modules"),
    path.join(workspaceRoot, "node_modules"),
  );
  await materializeHostedLocalCloudflareWorkspacePackages({
    abortSignal: input.abortSignal,
    cloudflareAppDir,
  });

  return { cloudflareAppDir, workspaceRoot };
}

async function materializeHostedLocalCloudflareWorkspacePackages(input: {
  abortSignal: AbortSignal | undefined;
  cloudflareAppDir: string;
}): Promise<void> {
  const packagesByName = discoverHostedLocalWorkspacePackages();
  const packageNames = resolveHostedLocalCloudflareWorkspacePackageNames(packagesByName);
  const nodeModulesRoot = path.join(input.cloudflareAppDir, "node_modules");
  const cloudflarePackageJson = readPackageJsonRecord(
    path.join(cloudflareDir, "package.json"),
  );

  await rm(
    path.join(nodeModulesRoot, HOSTED_LOCAL_WORKSPACE_PACKAGE_SCOPE.slice(0, -1)),
    { force: true, recursive: true },
  );

  for (const packageName of packageNames) {
    throwIfAbortSignalAborted(input.abortSignal);
    const workspacePackage = packagesByName.get(packageName);
    if (!workspacePackage) {
      throw new Error(
        `Hosted local Cloudflare snapshot could not find workspace package ${packageName}.`,
      );
    }

    const packageTargetDir = path.join(nodeModulesRoot, ...packageName.split("/"));
    const sourceDistDir = path.join(workspacePackage.dir, "dist");
    if (!existsSync(sourceDistDir)) {
      throw new Error(
        `Hosted local Cloudflare snapshot requires ${packageName}/dist. Run the package build before starting pnpm dev.`,
      );
    }

    await mkdir(packageTargetDir, { recursive: true });
    await copyFile(
      workspacePackage.packageJsonPath,
      path.join(packageTargetDir, "package.json"),
    );
    await cp(sourceDistDir, path.join(packageTargetDir, "dist"), {
      recursive: true,
    });
    await linkHostedLocalExternalDependencies({
      dependencyNames: workspacePackage.externalDependencies,
      sourceNodeModulesRoot: path.join(workspacePackage.dir, "node_modules"),
      targetNodeModulesRoot: path.join(packageTargetDir, "node_modules"),
    });
  }

  await linkHostedLocalExternalDependencies({
    dependencyNames: readExternalDependencyNames(cloudflarePackageJson),
    sourceNodeModulesRoot: path.join(cloudflareDir, "node_modules"),
    targetNodeModulesRoot: nodeModulesRoot,
  });
}

async function linkHostedLocalExternalDependencies(input: {
  dependencyNames: readonly string[];
  sourceNodeModulesRoot: string;
  targetNodeModulesRoot: string;
}): Promise<void> {
  for (const dependencyName of input.dependencyNames) {
    const dependencyParts = dependencyName.split("/");
    const sourcePath = path.join(input.sourceNodeModulesRoot, ...dependencyParts);
    const targetPath = path.join(input.targetNodeModulesRoot, ...dependencyParts);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await symlinkIfPresent(sourcePath, targetPath);
  }
}

function resolveHostedLocalCloudflareWorkspacePackageNames(
  packagesByName: ReadonlyMap<string, HostedLocalWorkspacePackage>,
): readonly string[] {
  const cloudflarePackageJsonPath = path.join(cloudflareDir, "package.json");
  const cloudflarePackageJson = readPackageJsonRecord(cloudflarePackageJsonPath);
  const queue = readWorkspaceDependencyNames(cloudflarePackageJson);
  const names: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index];
    if (seen.has(packageName)) {
      continue;
    }

    const workspacePackage = packagesByName.get(packageName);
    if (!workspacePackage) {
      throw new Error(
        `Cloudflare depends on ${packageName}, but no matching workspace package was found.`,
      );
    }

    seen.add(packageName);
    names.push(packageName);
    queue.push(...workspacePackage.dependencies);
  }

  return names;
}

function discoverHostedLocalWorkspacePackages(): ReadonlyMap<string, HostedLocalWorkspacePackage> {
  const packagesRoot = path.join(repoRoot, "packages");
  const packagesByName = new Map<string, HostedLocalWorkspacePackage>();

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = path.join(packagesRoot, entry.name, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = readPackageJsonRecord(packageJsonPath);
    const packageName = packageJson.name;
    if (
      typeof packageName !== "string"
      || !packageName.startsWith(HOSTED_LOCAL_WORKSPACE_PACKAGE_SCOPE)
    ) {
      continue;
    }

    packagesByName.set(packageName, {
      dependencies: readWorkspaceDependencyNames(packageJson),
      dir: path.dirname(packageJsonPath),
      externalDependencies: readExternalDependencyNames(packageJson),
      packageJsonPath,
    });
  }

  return packagesByName;
}

function readPackageJsonRecord(packageJsonPath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`Invalid package.json at ${formatRepoPath(packageJsonPath)}.`);
  }

  return parsed;
}

function readWorkspaceDependencyNames(
  packageJson: Record<string, unknown>,
): string[] {
  return readPackageDependencyNames(packageJson, "workspace");
}

function readExternalDependencyNames(
  packageJson: Record<string, unknown>,
): string[] {
  return readPackageDependencyNames(packageJson, "external");
}

function readPackageDependencyNames(
  packageJson: Record<string, unknown>,
  kind: "external" | "workspace",
): string[] {
  const dependencies = isRecord(packageJson.dependencies)
    ? packageJson.dependencies
    : {};

  return Object.entries(dependencies)
    .filter(([name, version]) => {
      if (typeof version !== "string") {
        return false;
      }

      const workspaceDependency =
        name.startsWith(HOSTED_LOCAL_WORKSPACE_PACKAGE_SCOPE)
        && version.startsWith("workspace:");
      return kind === "workspace" ? workspaceDependency : !workspaceDependency;
    })
    .map(([name]) => name);
}

async function symlinkIfPresent(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await access(sourcePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  await symlink(sourcePath, targetPath, "dir");
}

function formatRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
