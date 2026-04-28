export const HOSTED_RUNTIME_MAILBOX_FETCH_PATH = "/api/internal/hosted-mailbox/fetch";
export const HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH =
  "/api/internal/hosted-mailbox/payload/fetch";
export const HOSTED_RUNTIME_WORKSPACE_PATH = "/api/internal/hosted-workspace";
export const HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH =
  "/api/internal/hosted-workspace/checkpoint";
export const HOSTED_RUNTIME_LOG_PATH = "/api/internal/hosted-runtime/log";
export const HOSTED_RUNTIME_STATUS_PATH = "/api/internal/hosted-runtime/status";
export const HOSTED_RUNTIME_USAGE_RECORD_PATH =
  "/api/internal/hosted-execution/usage/record";
export const HOSTED_RUNTIME_ISSUE_RECORD_PATH =
  "/api/internal/hosted-execution/issues/record";
export const HOSTED_RUNTIME_VAULT_SYNC_IMPORT_PATH =
  "/api/internal/hosted-execution/vault-sync/import";

export function buildHostedRuntimeVaultSyncPayloadPath(sessionId: string): string {
  return `/api/internal/hosted-execution/vault-sync/${encodeURIComponent(sessionId)}/payload`;
}
