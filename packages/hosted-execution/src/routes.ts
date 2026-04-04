export const HOSTED_EXECUTION_DISPATCH_PATH = "/internal/dispatch";
export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH =
  "/api/internal/device-sync/runtime/snapshot";
export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH =
  "/api/internal/device-sync/runtime/apply";
export function buildHostedExecutionDeviceSyncConnectLinkPath(provider: string): string {
  return `/api/internal/device-sync/providers/${encodeURIComponent(provider)}/connect-link`;
}
export const HOSTED_EXECUTION_AI_USAGE_RECORD_PATH =
  "/api/internal/hosted-execution/usage/record";

export function buildHostedExecutionUserStatusPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/status`;
}

export function buildHostedExecutionUserRunPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/run`;
}

export function buildHostedExecutionUserEnvPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/env`;
}

export function buildHostedExecutionUserKeyEnvelopePath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/keys/envelope`;
}

export function buildHostedExecutionUserKeyRecipientPath(userId: string, kind: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/keys/recipients/${encodeURIComponent(kind)}`;
}

export function buildHostedExecutionUserDeviceSyncRuntimeSnapshotPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/device-sync/runtime/snapshot`;
}

export function buildHostedExecutionUserPendingUsagePath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/usage/pending`;
}
