export const HOSTED_EXECUTION_DISPATCH_PATH = "/internal/dispatch";
export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH =
  "/api/internal/device-sync/runtime/snapshot";
export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH =
  "/api/internal/device-sync/runtime/apply";
export const HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH = "/send";

export function buildHostedExecutionRunnerCommitPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}/commit`;
}

export function buildHostedExecutionRunnerSideEffectPath(effectId: string): string {
  return `/effects/${encodeURIComponent(effectId)}`;
}

export function buildHostedExecutionRunnerEmailMessagePath(rawMessageKey: string): string {
  return `/messages/${encodeURIComponent(rawMessageKey)}`;
}

export function buildHostedExecutionDeviceSyncConnectLinkPath(provider: string): string {
  return `/api/internal/device-sync/providers/${encodeURIComponent(provider)}/connect-link`;
}
export const HOSTED_EXECUTION_AI_USAGE_RECORD_PATH =
  "/api/internal/hosted-execution/usage/record";

export function buildHostedExecutionSharePackPath(userId: string, shareId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/shares/${encodeURIComponent(shareId)}/pack`;
}

export function buildHostedExecutionUserCryptoContextPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/crypto-context`;
}

export function buildHostedExecutionUserStatusPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/status`;
}

export function buildHostedExecutionUserRunPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/run`;
}

export function buildHostedExecutionMemberPrivateStatePath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/member-private-state`;
}

export function buildHostedExecutionUserEnvPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/env`;
}

export function buildHostedExecutionUserDeviceSyncRuntimePath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/device-sync/runtime`;
}

export function buildHostedExecutionUserPendingUsagePath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/usage/pending`;
}

export function buildHostedExecutionPendingUsageUsersPath(): string {
  return "/internal/usage/pending-users";
}

export function buildHostedExecutionUserDispatchPayloadPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/dispatch-payload`;
}

export function buildHostedExecutionUserStoredDispatchPath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/dispatch-payload/dispatch`;
}
