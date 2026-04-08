export const runnerVaultCliArtifactPackageName =
  "@murphai/cloudflare-runner-vault-cli";

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

type RunnerVaultCliArtifactDependencyName =
  (typeof runnerVaultCliArtifactDependencyNames)[number];

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
