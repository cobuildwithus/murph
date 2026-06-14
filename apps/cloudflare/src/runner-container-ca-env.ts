export const CLOUDFLARE_CONTAINERS_CA_CERT_PATH =
  "/etc/cloudflare/certs/cloudflare-containers-ca.crt";

export const HOSTED_RUNNER_CONTAINER_CA_ENV_KEYS = [
  "CODEX_CA_CERTIFICATE",
  "CURL_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_FILE",
] as const;

export type HostedRunnerContainerCaEnvKey = typeof HOSTED_RUNNER_CONTAINER_CA_ENV_KEYS[number];

export function buildHostedRunnerContainerCaEnv(): Record<HostedRunnerContainerCaEnvKey, string> {
  return Object.fromEntries(
    HOSTED_RUNNER_CONTAINER_CA_ENV_KEYS.map((key) => [key, CLOUDFLARE_CONTAINERS_CA_CERT_PATH]),
  ) as Record<HostedRunnerContainerCaEnvKey, string>;
}
