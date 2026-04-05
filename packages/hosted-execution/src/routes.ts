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

export function buildHostedExecutionSharePackPath(shareId: string): string {
  return `/internal/shares/${encodeURIComponent(shareId)}/pack`;
}

export function buildHostedExecutionUserStatusPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/status`;
}

export function buildHostedExecutionUserRunPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/run`;
}

export function buildHostedExecutionUserEnvPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/env`;
}

export function buildHostedExecutionUserDeviceSyncRuntimeSnapshotPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/device-sync/runtime/snapshot`;
}

export function buildHostedExecutionUserDeviceSyncRuntimePath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/device-sync/runtime`;
}

export function buildHostedExecutionUserPendingUsagePath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/usage/pending`;
}
