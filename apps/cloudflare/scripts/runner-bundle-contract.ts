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
  "@murphai/murph",
  "@murphai/inboxd",
  "@murphai/parsers",
  "@murphai/runtime-state",
  "jose",
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
  "@murphai/messaging-ingress",
  "@murphai/murph",
  "@murphai/operator-config",
  "@murphai/parsers",
  "@murphai/query",
  "@murphai/runtime-state",
  "@murphai/vault-usecases",
] as const;

export const publishedMurphBundledWorkspacePackageNames = [
  "@murphai/assistant-cli",
  "@murphai/assistant-engine",
  "@murphai/assistantd",
  "@murphai/core",
  "@murphai/device-syncd",
  "@murphai/gateway-local",
  "@murphai/importers",
  "@murphai/inbox-services",
  "@murphai/inboxd",
  "@murphai/inboxd-imessage",
  "@murphai/messaging-ingress",
  "@murphai/operator-config",
  "@murphai/parsers",
  "@murphai/query",
  "@murphai/runtime-state",
  "@murphai/setup-cli",
  "@murphai/vault-usecases",
] as const;

const hostedRunnerWorkspacePackageNameSet = new Set<string>(
  hostedRunnerWorkspacePackageNames,
);

export const hostedRunnerBuildPackageNames = [
  ...hostedRunnerWorkspacePackageNames,
  ...publishedMurphBundledWorkspacePackageNames.filter(
    (packageName) => !hostedRunnerWorkspacePackageNameSet.has(packageName),
  ),
];

type HostedRunnerRuntimeDependencyName =
  (typeof hostedRunnerRuntimeDependencyNames)[number];

export function buildHostedRunnerRuntimeArtifactPackageJson(input: {
  dependencies: Record<HostedRunnerRuntimeDependencyName, string>;
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
