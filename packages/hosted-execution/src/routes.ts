export const HOSTED_EXECUTION_DISPATCH_PATH = "/internal/dispatch";
export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH =
  "/api/internal/device-sync/runtime/snapshot";
export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH =
  "/api/internal/device-sync/runtime/apply";
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

export function buildHostedExecutionSharePayloadPath(shareId: string, shareCode: string): string {
  const url = new URL(
    `/api/hosted-share/internal/${encodeURIComponent(shareId)}/payload`,
    "https://hosted.invalid",
  );
  url.searchParams.set("shareCode", shareCode);
  return `${url.pathname}${url.search}`;
}
