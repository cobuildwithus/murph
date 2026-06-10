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

// Worker-mediated transcription is provider egress (active-user-fence
// authorized), not an internal control-plane host, so it stays out of
// CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.
export const CLOUDFLARE_HOSTED_TRANSCRIBE_HOST = "murph-transcribe.worker";
export const CLOUDFLARE_HOSTED_TRANSCRIBE_PATH = "/v1/transcribe";
export const CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT =
  `http://${CLOUDFLARE_HOSTED_TRANSCRIBE_HOST}${CLOUDFLARE_HOSTED_TRANSCRIBE_PATH}`;

export const HOSTED_EXECUTION_INTERNAL_PROXY_HOST_HEADER =
  "x-hosted-execution-internal-host";
