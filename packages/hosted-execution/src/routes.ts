export const HOSTED_RUNTIME_MAILBOX_FETCH_PATH = "/api/internal/hosted-mailbox/fetch";
export const HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH =
  "/api/internal/hosted-mailbox/payload/fetch";
export const HOSTED_RUNTIME_WORKSPACE_PATH = "/api/internal/hosted-workspace";
export const HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH =
  "/api/internal/hosted-workspace/checkpoint";
export const HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH =
  "/api/internal/hosted-workspace/browser-vault-replica";
export const HOSTED_RUNTIME_LOG_PATH = "/api/internal/hosted-runtime/log";
export const HOSTED_RUNTIME_LATENCY_TRACE_PATH =
  "/api/internal/hosted-runtime/latency";
export const HOSTED_RUNTIME_STATUS_PATH = "/api/internal/hosted-runtime/status";
export const HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_PATH =
  "/api/internal/hosted-runtime/health-data-admission";
export const HOSTED_RUNTIME_OWNER_RELEASED_PATH =
  "/api/internal/hosted-runtime/owner-released";
export const HOSTED_RUNTIME_OWNER_RELEASE_IMMEDIATE_RECHECK_QUERY =
  "immediateRecheckRequested";
export const HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH =
  "/api/internal/hosted-runtime/crypto-context";
export const HOSTED_RUNTIME_CRYPTO_ROOT_PATH =
  "/api/internal/hosted-runtime/crypto-context/root";
export const HOSTED_RUNTIME_USAGE_RECORD_PATH =
  "/api/internal/hosted-execution/usage/record";
export const HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH =
  "/api/internal/hosted-execution/product-feedback/record";
export const HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH =
  "/api/internal/hosted-execution/family-plan/tool";
export const HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH =
  "/api/internal/hosted-execution/plan-usage/tool";
export const HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH =
  "/api/internal/hosted-execution/imessage-contact/tool";
export const HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH =
  "/api/internal/hosted-execution/subscription/tool";
export const HOSTED_RUNTIME_LABS_TOOL_PATH =
  "/api/internal/hosted-execution/labs/tool";
export const HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH =
  "/api/internal/hosted-execution/assistant-configuration/tool";

export const HOSTED_RUNTIME_GROUP_TOOL_PATH =
  "/api/internal/hosted-execution/groups/tool";
export const HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH =
  "/api/internal/hosted-execution/assistant-asks/runtime";
export const HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_BODY_MAX_BYTES = 32 * 1_024;
export const HOSTED_RUNTIME_CODEX_AUTH_PATH =
  "/api/internal/hosted-runtime/codex-auth";
export const HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH =
  "/api/internal/hosted-runtime/vault-share/deliver";
export const HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH =
  "/api/internal/hosted-runtime/vault-share/active-kinds";
export const HOSTED_RUNTIME_ACTION_APPROVAL_REQUEST_PATH =
  "/api/internal/hosted-runtime/action-approvals/request";
export const HOSTED_RUNTIME_ACTION_APPROVAL_READ_PATH =
  "/api/internal/hosted-runtime/action-approvals/read";
export const HOSTED_RUNTIME_ACTION_APPROVAL_CONSUME_PATH =
  "/api/internal/hosted-runtime/action-approvals/consume";
export const HOSTED_RUNTIME_ISSUE_RECORD_PATH =
  "/api/internal/hosted-execution/issues/record";
export const HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH =
  "/api/internal/hosted-runtime/linq-egress/engagement";
export const HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH =
  "/api/internal/hosted-runtime/linq-egress/delivery";

export const HOSTED_RUNTIME_LINQ_DELIVERY_POSTURES = [
  "cautious",
  "recover",
] as const;
export type HostedRuntimeLinqDeliveryPosture =
  typeof HOSTED_RUNTIME_LINQ_DELIVERY_POSTURES[number];

export const HOSTED_RUNTIME_LINQ_DELIVERY_BLOCK_CODES = [
  "operator_disabled",
  "line_flagged",
  "line_critical",
  "line_at_risk_new_conversation",
  "chat_critical",
  "chat_opted_out",
  "delivery_unhealthy",
  "delivery_warning_new_conversation",
] as const;
export type HostedRuntimeLinqDeliveryBlockCode =
  typeof HOSTED_RUNTIME_LINQ_DELIVERY_BLOCK_CODES[number];

export const HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH =
  "/api/internal/hosted-runtime/email-egress/recipient";
export const HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH =
  "/api/internal/hosted-runtime/thread-route/authority";
export const HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_PATH =
  "/api/internal/device-sync/recovery-sweep";
export const HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID =
  "hosted-device-sync-reconciler";
