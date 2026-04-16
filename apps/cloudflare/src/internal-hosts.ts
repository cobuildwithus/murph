export const CLOUDFLARE_HOSTED_RUNTIME_HOSTS = {
  artifactStore: "artifacts.worker",
  effectsPort: "results.worker",
} as const;

export const CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS = {
  artifactStore: `http://${CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore}`,
  effectsPort: `http://${CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort}`,
} as const;

export const CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES = new Set<string>(
  Object.values(CLOUDFLARE_HOSTED_RUNTIME_HOSTS),
);

export const HOSTED_EXECUTION_INTERNAL_PROXY_HOST_HEADER =
  "x-hosted-execution-internal-host";
