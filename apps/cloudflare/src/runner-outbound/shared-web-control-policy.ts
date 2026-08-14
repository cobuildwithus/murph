import {
  HOSTED_CONNECTED_APPS_PATH,
} from "@murphai/hosted-execution/connected-apps";
import {
  HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
} from "@murphai/hosted-execution/clinical-records-boundary";
import {
  HOSTED_PHONE_CALLS_PATH,
} from "@murphai/hosted-execution/phone-calls";
import {
  HOSTED_PHYSICAL_NOTES_PATH,
} from "@murphai/hosted-execution/physical-notes";
import {
  HOSTED_RUNTIME_PROVIDER_SETUP_CONTINUATION_VALIDATE_PATH,
  HOSTED_RUNTIME_PROVIDER_SETUP_TOOL_PATH,
} from "@murphai/hosted-execution/provider-setup";
import {
  HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH,
} from "@murphai/hosted-execution/assistant-personalization";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RECONCILE_PATH,
} from "@murphai/device-syncd/hosted-runtime";
import {
  isHostedComputerWebControlRequest,
} from "@murphai/hosted-execution/computer-use";
import {
  HOSTED_RUNTIME_ACTION_APPROVAL_CONSUME_PATH,
  HOSTED_RUNTIME_ACTION_APPROVAL_READ_PATH,
  HOSTED_RUNTIME_ACTION_APPROVAL_REQUEST_PATH,
  HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
  HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH,
  HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
  HOSTED_RUNTIME_CODEX_AUTH_PATH,
  HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH,
  HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH,
  HOSTED_RUNTIME_GROUP_TOOL_PATH,
  HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH,
  HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH,
  HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
  HOSTED_RUNTIME_ISSUE_RECORD_PATH,
  HOSTED_RUNTIME_LABS_TOOL_PATH,
  HOSTED_RUNTIME_LATENCY_TRACE_PATH,
  HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH,
  HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH,
  HOSTED_RUNTIME_LOG_PATH,
  HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
  HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH,
  HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH,
  HOSTED_RUNTIME_USAGE_RECORD_PATH,
  HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH,
  HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import {
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH,
} from "../runtime-mailbox-payload-decode-contract.ts";

export {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RECONCILE_PATH,
};

const HOSTED_DEVICE_SYNC_CONNECT_LINK_PATH =
  /^\/api\/internal\/device-sync\/connect-targets\/[^/]+\/connect-link$/u;

export type HostedRunnerWebControlOperation =
  | "action_approval_consume"
  | "action_approval_read"
  | "action_approval_request"
  | "assistant_runtime_issue_export"
  | "assistant_ask"
  | "assistant_personalization_tool"
  | "assistant_configuration_tool"
  | "browser_vault_replica_publish"
  | "codex_auth_update"
  | "computer_use"
  | "connected_apps"
  | "clinical_records_connect_link"
  | "clinical_records_fetch_page"
  | "clinical_records_read_run"
  | "clinical_records_record_outcome"
  | "device_sync_connect_link"
  | "device_sync_dirty_ack"
  | "device_sync_pending_dirty_state"
  | "device_sync_reconcile"
  | "device_sync_runtime_apply"
  | "device_sync_runtime_snapshot"
  | "email_egress_recipient"
  | "family_plan_tool"
  | "group_tool"
  | "imessage_contact_tool"
  | "labs_tool"
  | "mailbox_fetch"
  | "mailbox_payload_decode"
  | "mailbox_payload_fetch"
  | "linq_delivery_outcome"
  | "linq_egress_engagement"
  | "plan_usage_tool"
  | "subscription_tool"
  | "thread_route_authority"
  | "phone_call_start"
  | "physical_note_send"
  | "provider_setup"
  | "runtime_latency_trace"
  | "runtime_log_write"
  | "product_feedback_recording"
  | "usage_recording"
  | "vault_share_active_kinds"
  | "vault_share_deliver"
  | "workspace_checkpoint"
  | "workspace_read"
  | "web_control_blocked";

export interface HostedRunnerWebControlPolicy {
  allowed: boolean;
  operation: HostedRunnerWebControlOperation;
}

const HOSTED_RUNNER_WEB_CONTROL_POST_POLICY = new Map<string, HostedRunnerWebControlOperation>([
  [HOSTED_RUNTIME_ACTION_APPROVAL_CONSUME_PATH, "action_approval_consume"],
  [HOSTED_RUNTIME_ACTION_APPROVAL_READ_PATH, "action_approval_read"],
  [HOSTED_RUNTIME_ACTION_APPROVAL_REQUEST_PATH, "action_approval_request"],
  [HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH, "assistant_ask"],
  [HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH, "assistant_personalization_tool"],
  [HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH, "assistant_configuration_tool"],
  [HOSTED_CONNECTED_APPS_PATH, "connected_apps"],
  [HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH, "clinical_records_connect_link"],
  [HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH, "clinical_records_fetch_page"],
  [HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH, "clinical_records_read_run"],
  [HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH, "clinical_records_record_outcome"],
  [HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH, "device_sync_runtime_apply"],
  [HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH, "device_sync_dirty_ack"],
  [HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH, "device_sync_pending_dirty_state"],
  [HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH, "device_sync_runtime_snapshot"],
  [HOSTED_EXECUTION_DEVICE_SYNC_RECONCILE_PATH, "device_sync_reconcile"],
  [HOSTED_RUNTIME_LOG_PATH, "runtime_log_write"],
  [HOSTED_RUNTIME_LATENCY_TRACE_PATH, "runtime_latency_trace"],
  [HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH, "browser_vault_replica_publish"],
  [HOSTED_RUNTIME_CODEX_AUTH_PATH, "codex_auth_update"],
  [HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH, "email_egress_recipient"],
  [HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH, "family_plan_tool"],
  [HOSTED_RUNTIME_GROUP_TOOL_PATH, "group_tool"],
  [HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH, "imessage_contact_tool"],
  [HOSTED_RUNTIME_LABS_TOOL_PATH, "labs_tool"],
  [HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH, "plan_usage_tool"],
  [HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH, "subscription_tool"],
  [HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH, "thread_route_authority"],
  [HOSTED_RUNTIME_MAILBOX_FETCH_PATH, "mailbox_fetch"],
  [HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH, "mailbox_payload_fetch"],
  [HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH, "linq_delivery_outcome"],
  [HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH, "linq_egress_engagement"],
  [HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH, "workspace_checkpoint"],
  [HOSTED_RUNTIME_ISSUE_RECORD_PATH, "assistant_runtime_issue_export"],
  [HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH, "product_feedback_recording"],
  [HOSTED_RUNTIME_USAGE_RECORD_PATH, "usage_recording"],
  [HOSTED_PHONE_CALLS_PATH, "phone_call_start"],
  [HOSTED_PHYSICAL_NOTES_PATH, "physical_note_send"],
  [HOSTED_RUNTIME_PROVIDER_SETUP_CONTINUATION_VALIDATE_PATH, "provider_setup"],
  [HOSTED_RUNTIME_PROVIDER_SETUP_TOOL_PATH, "provider_setup"],
  [HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH, "vault_share_deliver"],
]);

export function isAllowedHostedRunnerWebControlPath(path: string): boolean {
  return isAllowedHostedRunnerWebControlRequest({
    method: "GET",
    path,
  }) || isAllowedHostedRunnerWebControlRequest({
    method: "POST",
    path,
  });
}

export function isAllowedHostedRunnerWebControlRequest(input: {
  method: string;
  path: string;
}): boolean {
  return readHostedRunnerWebControlPolicy(input).allowed;
}

export function assertAllowedHostedRunnerWebControlRequest(input: {
  method: string;
  path: string;
}): void {
  if (isAllowedHostedRunnerWebControlRequest(input)) {
    return;
  }

  throw new TypeError(
    `Hosted runtime web-control route is not allowlisted for proxy transport: ${input.method} ${input.path}`,
  );
}

export function readHostedRunnerWebControlOperation(input: {
  method: string;
  path: string;
}): HostedRunnerWebControlOperation {
  return readHostedRunnerWebControlPolicy(input).operation;
}

export function readHostedRunnerWebControlPolicy(input: {
  method: string;
  path: string;
}): HostedRunnerWebControlPolicy {
  if (
    input.method === "GET"
    && input.path === HOSTED_RUNTIME_WORKSPACE_PATH
  ) {
    return {
      allowed: true,
      operation: "workspace_read",
    };
  }

  if (
    input.method === "GET"
    && input.path === HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH
  ) {
    return {
      allowed: true,
      operation: "vault_share_active_kinds",
    };
  }

  if (input.method !== "POST") {
    return {
      allowed: false,
      operation: "web_control_blocked",
    };
  }

  const path = input.path;
  if (isHostedComputerWebControlRequest(input)) {
    return {
      allowed: true,
      operation: "computer_use",
    };
  }

  if (path === HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH) {
    return {
      allowed: false,
      operation: "mailbox_payload_decode",
    };
  }
  const operation = HOSTED_RUNNER_WEB_CONTROL_POST_POLICY.get(path);
  if (operation) {
    return {
      allowed: true,
      operation,
    };
  }

  if (HOSTED_DEVICE_SYNC_CONNECT_LINK_PATH.test(path)) {
    return {
      allowed: true,
      operation: "device_sync_connect_link",
    };
  }

  return {
    allowed: false,
    operation: "web_control_blocked",
  };
}

export function readHostedRunnerWebControlRoute(path: string): {
  pathAndSearch: string;
  pathname: string;
} {
  const base = new URL("https://hosted-runtime.invalid/");
  const url = new URL(path, base);
  if (url.origin !== base.origin) {
    throw new TypeError("Hosted runtime web-control route must be relative.");
  }

  return {
    pathAndSearch: `${url.pathname}${url.search}`,
    pathname: url.pathname,
  };
}
