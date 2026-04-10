import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const runnerBundleDirectoryName = "runner-bundle";

export const hostedRunnerRuntimePackageName = "@murphai/cloudflare-runner";
export const hostedRunnerRuntimeDistDirectoryName = "dist";

export const hostedRunnerBundleOnlyDependencyNames = [
  "@murphai/murph",
] as const;

interface RunnerBundlePackageManifest {
  bundleDependencies?: unknown;
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
const repoRoot = path.resolve(scriptDir, "../../..");
const workspacePackageManifestByName = readWorkspacePackageManifestByName(repoRoot);
const hostedRunnerRuntimePackageManifest = readRequiredWorkspacePackageManifest(
  hostedRunnerRuntimePackageName,
);
export const publishedMurphBundledWorkspacePackageNames =
  readWorkspaceBundleDependencyNames("@murphai/murph");
const murphNonBundledWorkspaceDependencyNames = listNonBundledWorkspaceDependencyNames(
  "@murphai/murph",
  publishedMurphBundledWorkspacePackageNames,
);

export const hostedRunnerWorkspacePackageNames = sortPackageNames([
  ...resolveWorkspaceDependencyClosure([
    ...listWorkspaceDependencyNames(hostedRunnerRuntimePackageManifest),
    ...murphNonBundledWorkspaceDependencyNames,
  ]),
  ...hostedRunnerBundleOnlyDependencyNames,
]);

export const hostedRunnerBuildPackageNames = sortPackageNames([
  ...hostedRunnerWorkspacePackageNames,
  ...resolveWorkspaceDependencyClosure(publishedMurphBundledWorkspacePackageNames),
]);

export function buildHostedRunnerRuntimeArtifactPackageJson(input: {
  dependencies: Record<string, string>;
  engines?: Record<string, string>;
  exports?: Record<string, unknown> | string;
  license: string;
  main?: string;
  name?: string;
  optionalDependencies?: Record<string, string>;
  private?: boolean;
  type?: string;
  version: string;
}) {
  return {
    name: input.name ?? hostedRunnerRuntimePackageName,
    private: input.private ?? true,
    type: input.type ?? "module",
    version: input.version,
    license: input.license,
    main: input.main,
    exports: input.exports,
    engines: input.engines,
    dependencies: input.dependencies,
    ...(hasEntries(input.optionalDependencies)
      ? { optionalDependencies: input.optionalDependencies }
      : {}),
  };
}

function readWorkspacePackageManifestByName(
  rootDir: string,
): Map<string, RunnerBundlePackageManifest> {
  const manifests = new Map<string, RunnerBundlePackageManifest>();

  for (const memberType of ["apps", "packages"]) {
    const membersDir = path.join(rootDir, memberType);

    for (const entry of readdirSync(membersDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = path.join(membersDir, entry.name, "package.json");
      const packageJson = JSON.parse(
        readFileSync(packageJsonPath, "utf8"),
      ) as RunnerBundlePackageManifest;

      if (
        typeof packageJson.name !== "string" ||
        packageJson.name.length === 0
      ) {
        continue;
      }

      manifests.set(packageJson.name, packageJson);
    }
  }

  return manifests;
}

function readRequiredWorkspacePackageManifest(
  packageName: string,
): RunnerBundlePackageManifest {
  const packageJson = workspacePackageManifestByName.get(packageName);

  if (!packageJson) {
    throw new Error(`Could not resolve workspace package manifest for ${packageName}.`);
  }

  return packageJson;
}

function readWorkspaceBundleDependencyNames(
  packageName: string,
): readonly string[] {
  const packageJson = readRequiredWorkspacePackageManifest(packageName);

  if (
    !Array.isArray(packageJson.bundleDependencies) ||
    packageJson.bundleDependencies.some(
      (dependencyName) =>
        typeof dependencyName !== "string" || dependencyName.length === 0,
    )
  ) {
    throw new Error(
      `${packageName} must declare a string-only bundleDependencies array.`,
    );
  }

  return sortPackageNames(packageJson.bundleDependencies);
}

function listNonBundledWorkspaceDependencyNames(
  packageName: string,
  bundledWorkspaceDependencyNames: readonly string[],
): readonly string[] {
  const bundledWorkspaceDependencyNameSet = new Set(
    bundledWorkspaceDependencyNames,
  );

  return listWorkspaceDependencyNames(
    readRequiredWorkspacePackageManifest(packageName),
  ).filter(
    (dependencyName) => !bundledWorkspaceDependencyNameSet.has(dependencyName),
  );
}

function listWorkspaceDependencyNames(
  packageJson: RunnerBundlePackageManifest,
): readonly string[] {
  return sortPackageNames([
    ...readWorkspaceDependencyNames(packageJson.dependencies),
    ...readWorkspaceDependencyNames(packageJson.optionalDependencies),
  ]);
}

function readWorkspaceDependencyNames(
  dependencyGroup: Record<string, string> | undefined,
): readonly string[] {
  if (!dependencyGroup) {
    return [];
  }

  return Object.entries(dependencyGroup)
    .filter((entry): entry is [string, string] => entry[1].startsWith("workspace:"))
    .map(([dependencyName]) => dependencyName);
}

function resolveWorkspaceDependencyClosure(
  seedPackageNames: Iterable<string>,
): readonly string[] {
  const orderedQueue = [...sortPackageNames(seedPackageNames)];
  const visited = new Set<string>();

  while (orderedQueue.length > 0) {
    const packageName = orderedQueue.shift();

    if (!packageName || visited.has(packageName)) {
      continue;
    }

    visited.add(packageName);

    for (const dependencyName of listWorkspaceDependencyNames(
      readRequiredWorkspacePackageManifest(packageName),
    )) {
      if (!visited.has(dependencyName)) {
        orderedQueue.push(dependencyName);
      }
    }
  }

  return sortPackageNames(visited);
}

function sortPackageNames(packageNames: Iterable<string>): readonly string[] {
  return [...new Set(packageNames)].sort();
}

function hasEntries(value: Record<string, string> | undefined): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}
