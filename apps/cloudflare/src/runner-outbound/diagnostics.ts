import {
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
} from "../internal-hosts.ts";
import {
  readHostedRunnerWebControlOperation,
} from "./shared-web-control-policy.ts";

export type HostedRunnerDiagnosticMethod =
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT"
  | "other";

export function readHostedRunnerDiagnosticMethod(method: string): HostedRunnerDiagnosticMethod {
  switch (method) {
    case "DELETE":
    case "GET":
    case "HEAD":
    case "OPTIONS":
    case "PATCH":
    case "POST":
    case "PUT":
      return method;
    default:
      return "other";
  }
}

export function readHostedRunnerInternalHostKind(hostname: string): string {
  if (hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane) {
    return "web_control_plane";
  }
  if (hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort) {
    return "effects_port";
  }
  if (hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore) {
    return "artifact_store";
  }
  if (hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore) {
    return "browser_vault_replica_store";
  }
  if (hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl) {
    return "runner_control";
  }

  return "unknown_internal_host";
}

export function readHostedRunnerInternalOperation(input: {
  hostname: string;
  method: string;
  pathname: string;
}): string {
  if (input.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.webControlPlane) {
    return readHostedRunnerWebControlOperation({
      method: input.method,
      path: input.pathname,
    });
  }
  if (input.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore) {
    return input.method === "PUT" ? "artifact_upload" : "artifact_fetch";
  }
  if (input.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore) {
    return "browser_vault_replica_write";
  }
  if (input.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl) {
    return "runner_control";
  }
  if (input.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort) {
    return "effects_port";
  }

  return "unknown_internal_operation";
}
