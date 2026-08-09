import {
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
} from "../internal-hosts.ts";
import {
  HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH,
  HOSTED_EXECUTION_RUNNER_PRIVATE_IMAGE_URL_PUBLISH_PATH,
} from "../runner-effects-contract.ts";
import {
  matchHostedExecutionRunnerMealPhotoPath,
} from "../runner-meal-photo-route.ts";
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
  if (hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.workspaceSnapshotStore) {
    return "workspace_snapshot_store";
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
  if (input.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.workspaceSnapshotStore) {
    if (input.pathname === "/workspace-snapshots/start") {
      return "workspace_snapshot_start";
    }
    if (/^\/workspace-snapshots\/[^/]+\/presign-put$/u.test(input.pathname)) {
      return "workspace_snapshot_presign_put";
    }
    if (/^\/workspace-snapshots\/[^/]+\/presign-get$/u.test(input.pathname)) {
      return "workspace_snapshot_presign_get";
    }
    if (/^\/workspace-snapshots\/[^/]+\/complete$/u.test(input.pathname)) {
      return "workspace_snapshot_complete";
    }
    if (/^\/workspace-snapshots\/[^/]+\/heartbeat$/u.test(input.pathname)) {
      return "workspace_snapshot_heartbeat";
    }
    if (/^\/workspace-snapshots\/[^/]+\/data-key\/unwrap$/u.test(input.pathname)) {
      return "workspace_snapshot_data_key_unwrap";
    }
    if (input.method === "GET") {
      return "workspace_snapshot_fetch";
    }
    return "workspace_snapshot_unknown";
  }
  if (input.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.runnerControl) {
    return "runner_control";
  }
  if (input.hostname === CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort) {
    if (matchHostedExecutionRunnerMealPhotoPath(input.pathname)) {
      return input.method === "DELETE" ? "meal_photo_delete" : "meal_photo_read";
    }
    if (
      input.method === "POST" &&
      input.pathname === HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH
    ) {
      return "generated_image_upload";
    }
    if (
      input.method === "POST"
      && input.pathname
        === HOSTED_EXECUTION_RUNNER_PRIVATE_IMAGE_URL_PUBLISH_PATH
    ) {
      return "private_image_url_publish";
    }
    return "effects_port";
  }

  return "unknown_internal_operation";
}

export async function readHostedRunnerSafeResponseBodyMetadata(
  response: Response,
): Promise<Record<string, boolean | number | string>> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return {
      responseBodyKind: "unreadable",
    };
  }

  const responseBodyBytes = new TextEncoder().encode(text).byteLength;
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      responseBodyBytes,
      responseBodyKind: "empty",
    };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = parseJsonOrNull(trimmed);
    const errorCode = readSafeResponseErrorCode(parsed);
    const errorShape = readJsonResponseErrorShape(parsed);
    return {
      responseBodyBytes,
      responseBodyKind: parsed === null ? "invalid_json" : "json",
      ...(errorCode ? { responseErrorCode: errorCode } : {}),
      ...(errorShape ? { responseErrorShape: errorShape } : {}),
    };
  }

  if (
    contentType.includes("html")
    || /^<!doctype\s+html\b/iu.test(trimmed)
    || /^<html(?:\s|>)/iu.test(trimmed)
  ) {
    return {
      responseBodyBytes,
      responseBodyKind: "html",
    };
  }

  return {
    responseBodyBytes,
    responseBodyKind: contentType.startsWith("text/") ? "text" : "unknown",
  };
}

function parseJsonOrNull(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readSafeResponseErrorCode(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const topLevelCode = normalizeSafeResponseCode(value.code);
  if (topLevelCode) {
    return topLevelCode;
  }
  const error = value.error;
  if (isRecord(error)) {
    return normalizeSafeResponseCode(error.code);
  }
  return null;
}

function readJsonResponseErrorShape(value: unknown): string | null {
  if (!isRecord(value)) {
    return value === null ? null : "non_object";
  }
  const error = value.error;
  if (typeof error === "string") {
    return "string_error";
  }
  if (isRecord(error)) {
    return "object_error";
  }
  if (typeof value.code === "string") {
    return "top_level_code";
  }
  return null;
}

function normalizeSafeResponseCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 96) {
    return null;
  }
  return /^[a-z0-9][a-z0-9_.:-]*$/u.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
