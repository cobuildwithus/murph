export const CLOUDFLARE_HOSTED_RUNTIME_HOSTS = {
  artifactStore: "artifacts.worker",
  browserVaultReplicaStore: "browser-vault.worker",
  effectsPort: "results.worker",
  runnerControl: "runner-control.worker",
  webControlPlane: "web-control.worker",
  workspaceSnapshotStore: "workspace-snapshots.worker",
} as const;

export const CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS = {
  artifactStore: `http://${CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore}`,
  browserVaultReplicaStore: `http://${CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore}`,
  effectsPort: `http://${CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort}`,
  runnerControl: `http://${CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl}`,
  webControlPlane: `http://${CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane}`,
  workspaceSnapshotStore: `http://${CLOUDFLARE_HOSTED_RUNTIME_HOSTS.workspaceSnapshotStore}`,
} as const;

export const CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES = new Set<string>(
  Object.values(CLOUDFLARE_HOSTED_RUNTIME_HOSTS),
);

export const HOSTED_EXECUTION_INTERNAL_PROXY_HOST_HEADER =
  "x-hosted-execution-internal-host";
