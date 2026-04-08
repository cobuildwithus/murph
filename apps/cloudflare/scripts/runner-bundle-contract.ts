export const runnerBundleDirectoryName = "runner-bundle";

export const hostedRunnerRuntimePackageName = "@murphai/cloudflare-runner";
export const hostedRunnerRuntimeDistDirectoryName = "dist";

export const runnerVaultCliArtifactPackageName =
  "@murphai/cloudflare-runner-vault-cli";

export const hostedRunnerWorkerDependencyNames = [
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
  "@murphai/operator-config",
  "@murphai/parsers",
  "@murphai/query",
  "@murphai/runtime-state",
  "@murphai/vault-usecases",
] as const;

export const runnerVaultCliArtifactDependencyNames = [
  "@murphai/assistant-engine",
  "@murphai/contracts",
  "@murphai/core",
  "@murphai/inbox-services",
  "@murphai/operator-config",
  "@murphai/query",
  "@murphai/vault-usecases",
  "incur",
] as const;

export const runnerVaultCliArtifactWorkspacePackageNames = [
  "@murphai/assistant-engine",
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
  "@murphai/operator-config",
  "@murphai/parsers",
  "@murphai/query",
  "@murphai/runtime-state",
  "@murphai/vault-usecases",
] as const;

export const hostedRunnerBuildPackageNames = [
  ...new Set([
    ...hostedRunnerWorkspacePackageNames,
    ...runnerVaultCliArtifactWorkspacePackageNames,
    "@murphai/murph",
  ]),
];

type HostedRunnerWorkerDependencyName =
  (typeof hostedRunnerWorkerDependencyNames)[number];
type RunnerVaultCliArtifactDependencyName =
  (typeof runnerVaultCliArtifactDependencyNames)[number];

export function buildHostedRunnerRuntimeArtifactPackageJson(input: {
  dependencies: Record<HostedRunnerWorkerDependencyName, string>;
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

export function buildRunnerVaultCliArtifactPackageJson(input: {
  dependencies: Record<RunnerVaultCliArtifactDependencyName, string>;
  license: string;
  version: string;
}) {
  return {
    name: runnerVaultCliArtifactPackageName,
    private: true,
    type: "module",
    version: input.version,
    license: input.license,
    main: "./dist/runner-vault-cli.js",
    exports: {
      ".": "./dist/runner-vault-cli.js",
      "./package.json": "./package.json",
    },
    bin: {
      "vault-cli": "./dist/runner-vault-cli-bin.js",
    },
    dependencies: input.dependencies,
  };
}
