import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const runnerBundleDirectoryName = "runner-bundle";

export const hostedRunnerRuntimePackageName = "@murphai/cloudflare-runner";
export const hostedRunnerRuntimeDistDirectoryName = "dist";

export const hostedRunnerRuntimeDependencyNames = [
  "@cloudflare/containers",
  "@murphai/assistant-runtime",
  "@murphai/cloudflare-hosted-control",
  "@murphai/device-syncd",
  "@murphai/gateway-core",
  "@murphai/hosted-execution",
  "@murphai/inboxd",
  "@murphai/parsers",
  "@murphai/runtime-state",
  "jose",
] as const;

export const hostedRunnerBundleOnlyDependencyNames = [
  "@murphai/murph",
] as const;

export const hostedRunnerWorkspacePackageNames = [
  "@murphai/assistant-engine",
  "@murphai/assistant-runtime",
  "@murphai/cloudflare-hosted-control",
  "@murphai/contracts",
  "@murphai/core",
  "@murphai/device-syncd",
  "@murphai/gateway-core",
  "@murphai/gateway-local",
  "@murphai/hosted-execution",
  "@murphai/importers",
  "@murphai/inbox-services",
  "@murphai/inboxd",
  "@murphai/inboxd-imessage",
  "@murphai/messaging-ingress",
  "@murphai/murph",
  "@murphai/operator-config",
  "@murphai/parsers",
  "@murphai/query",
  "@murphai/runtime-state",
  "@murphai/vault-usecases",
] as const;

export const publishedMurphBundledWorkspacePackageNames =
  readPublishedMurphBundledWorkspacePackageNames();

const hostedRunnerWorkspacePackageNameSet = new Set<string>(
  hostedRunnerWorkspacePackageNames,
);

export const hostedRunnerBuildPackageNames = [
  ...hostedRunnerWorkspacePackageNames,
  ...publishedMurphBundledWorkspacePackageNames.filter(
    (packageName) => !hostedRunnerWorkspacePackageNameSet.has(packageName),
  ),
];

type HostedRunnerArtifactDependencyName =
  | (typeof hostedRunnerRuntimeDependencyNames)[number]
  | (typeof hostedRunnerBundleOnlyDependencyNames)[number];

export function buildHostedRunnerRuntimeArtifactPackageJson(input: {
  dependencies: Record<HostedRunnerArtifactDependencyName, string>;
  engines?: Record<string, string>;
  exports?: Record<string, unknown> | string;
  license: string;
  main?: string;
  name?: string;
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
  };
}

function readPublishedMurphBundledWorkspacePackageNames(): readonly string[] {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "../../..");
  const murphPackageJsonPath = path.join(repoRoot, "packages/cli/package.json");
  const packageJson = JSON.parse(
    readFileSync(murphPackageJsonPath, "utf8"),
  ) as {
    bundleDependencies?: unknown;
  };

  if (
    !Array.isArray(packageJson.bundleDependencies) ||
    packageJson.bundleDependencies.some(
      (dependencyName) =>
        typeof dependencyName !== "string" || dependencyName.length === 0,
    )
  ) {
    throw new Error(
      "packages/cli/package.json must declare a string-only bundleDependencies array.",
    );
  }

  return packageJson.bundleDependencies;
}
