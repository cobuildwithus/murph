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
  HOSTED_PHONE_CALL_STATUS_PATH,
  HOSTED_PHONE_CALL_STOP_PATH,
} from "@murphai/hosted-execution/phone-calls";
import {
  HOSTED_PHYSICAL_NOTE_RECOVERY_PATH,
  HOSTED_PHYSICAL_NOTES_PATH,
} from "@murphai/hosted-execution/physical-notes";
import {
  HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH,
} from "@murphai/hosted-execution/assistant-personalization";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_FITBIT_MIGRATION_CUTOVER_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_NO_DATA_OUTREACH_PATH,
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
  HOSTED_RUNTIME_MEMBER_ACTION_OUTCOME_PATH,
  HOSTED_RUNTIME_OUTBOUND_MESSAGE_VOLUME_RECEIPT_PATH,
  HOSTED_RUNTIME_OPERATOR_TASK_CONTROL_PATH,
  HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH,
  HOSTED_RUNTIME_PHONE_CALL_RESULT_DELIVERY_PATH,
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
  HOSTED_EXECUTION_DEVICE_SYNC_FITBIT_MIGRATION_CUTOVER_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_NO_DATA_OUTREACH_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RECONCILE_PATH,
};

const HOSTED_DEVICE_SYNC_CONNECT_LINK_PATH =
  /^\/api\/internal\/device-sync\/connect-targets\/[^/]+\/connect-link$/u;

const HOSTED_RUNNER_WEB_CONTROL_ROUTE_BRAND = Symbol(
  "hosted-runner-web-control-route",
);

type HostedRunnerWebControlMethod = "GET" | "POST";

type RegisteredHostedRunnerWebControlRoute<
  Method extends HostedRunnerWebControlMethod = HostedRunnerWebControlMethod,
  Operation extends string = string,
> = Readonly<{
  method: Method;
  operation: Operation;
  path: string;
  [HOSTED_RUNNER_WEB_CONTROL_ROUTE_BRAND]: true;
}>;

function defineHostedRunnerWebControlRoute<
  const Method extends HostedRunnerWebControlMethod,
  const Operation extends string,
>(input: {
  method: Method;
  operation: Operation;
  path: string;
}): RegisteredHostedRunnerWebControlRoute<Method, Operation> {
  return Object.freeze({
    ...input,
    [HOSTED_RUNNER_WEB_CONTROL_ROUTE_BRAND]: true as const,
  });
}

function defineHostedRunnerWebControlGetRoute<const Operation extends string>(
  operation: Operation,
  path: string,
): RegisteredHostedRunnerWebControlRoute<"GET", Operation> {
  return defineHostedRunnerWebControlRoute({ method: "GET", operation, path });
}

function defineHostedRunnerWebControlPostRoute<const Operation extends string>(
  operation: Operation,
  path: string,
): RegisteredHostedRunnerWebControlRoute<"POST", Operation> {
  return defineHostedRunnerWebControlRoute({ method: "POST", operation, path });
}

export const HOSTED_RUNNER_WEB_CONTROL_ROUTES = {
  actionApprovalConsume: defineHostedRunnerWebControlPostRoute(
    "action_approval_consume",
    HOSTED_RUNTIME_ACTION_APPROVAL_CONSUME_PATH,
  ),
  actionApprovalRead: defineHostedRunnerWebControlPostRoute(
    "action_approval_read",
    HOSTED_RUNTIME_ACTION_APPROVAL_READ_PATH,
  ),
  actionApprovalRequest: defineHostedRunnerWebControlPostRoute(
    "action_approval_request",
    HOSTED_RUNTIME_ACTION_APPROVAL_REQUEST_PATH,
  ),
  assistantAsk: defineHostedRunnerWebControlPostRoute(
    "assistant_ask",
    HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_PATH,
  ),
  assistantConfigurationTool: defineHostedRunnerWebControlPostRoute(
    "assistant_configuration_tool",
    HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH,
  ),
  assistantPersonalizationTool: defineHostedRunnerWebControlPostRoute(
    "assistant_personalization_tool",
    HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH,
  ),
  assistantRuntimeIssueExport: defineHostedRunnerWebControlPostRoute(
    "assistant_runtime_issue_export",
    HOSTED_RUNTIME_ISSUE_RECORD_PATH,
  ),
  browserVaultReplicaPublish: defineHostedRunnerWebControlPostRoute(
    "browser_vault_replica_publish",
    HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
  ),
  clinicalRecordsConnectLink: defineHostedRunnerWebControlPostRoute(
    "clinical_records_connect_link",
    HOSTED_CLINICAL_RECORDS_CONNECT_LINK_PATH,
  ),
  clinicalRecordsFetchPage: defineHostedRunnerWebControlPostRoute(
    "clinical_records_fetch_page",
    HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
  ),
  clinicalRecordsReadRun: defineHostedRunnerWebControlPostRoute(
    "clinical_records_read_run",
    HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
  ),
  clinicalRecordsRecordOutcome: defineHostedRunnerWebControlPostRoute(
    "clinical_records_record_outcome",
    HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
  ),
  codexAuthUpdate: defineHostedRunnerWebControlPostRoute(
    "codex_auth_update",
    HOSTED_RUNTIME_CODEX_AUTH_PATH,
  ),
  connectedApps: defineHostedRunnerWebControlPostRoute(
    "connected_apps",
    HOSTED_CONNECTED_APPS_PATH,
  ),
  deviceSyncDirtyAck: defineHostedRunnerWebControlPostRoute(
    "device_sync_dirty_ack",
    HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
  ),
  deviceSyncFitbitMigrationCutover: defineHostedRunnerWebControlPostRoute(
    "device_sync_fitbit_migration_cutover",
    HOSTED_EXECUTION_DEVICE_SYNC_FITBIT_MIGRATION_CUTOVER_PATH,
  ),
  deviceSyncNoDataOutreach: defineHostedRunnerWebControlPostRoute(
    "device_sync_no_data_outreach",
    HOSTED_EXECUTION_DEVICE_SYNC_NO_DATA_OUTREACH_PATH,
  ),
  deviceSyncPendingDirtyState: defineHostedRunnerWebControlPostRoute(
    "device_sync_pending_dirty_state",
    HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
  ),
  deviceSyncReconcile: defineHostedRunnerWebControlPostRoute(
    "device_sync_reconcile",
    HOSTED_EXECUTION_DEVICE_SYNC_RECONCILE_PATH,
  ),
  deviceSyncRuntimeApply: defineHostedRunnerWebControlPostRoute(
    "device_sync_runtime_apply",
    HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  ),
  deviceSyncRuntimeSnapshot: defineHostedRunnerWebControlPostRoute(
    "device_sync_runtime_snapshot",
    HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  ),
  emailEgressRecipient: defineHostedRunnerWebControlPostRoute(
    "email_egress_recipient",
    HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH,
  ),
  familyPlanTool: defineHostedRunnerWebControlPostRoute(
    "family_plan_tool",
    HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH,
  ),
  groupTool: defineHostedRunnerWebControlPostRoute(
    "group_tool",
    HOSTED_RUNTIME_GROUP_TOOL_PATH,
  ),
  imessageContactTool: defineHostedRunnerWebControlPostRoute(
    "imessage_contact_tool",
    HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH,
  ),
  labsTool: defineHostedRunnerWebControlPostRoute(
    "labs_tool",
    HOSTED_RUNTIME_LABS_TOOL_PATH,
  ),
  linqDeliveryOutcome: defineHostedRunnerWebControlPostRoute(
    "linq_delivery_outcome",
    HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH,
  ),
  linqEgressEngagement: defineHostedRunnerWebControlPostRoute(
    "linq_egress_engagement",
    HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH,
  ),
  mailboxFetch: defineHostedRunnerWebControlPostRoute(
    "mailbox_fetch",
    HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  ),
  mailboxPayloadFetch: defineHostedRunnerWebControlPostRoute(
    "mailbox_payload_fetch",
    HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
  ),
  memberActionOutcome: defineHostedRunnerWebControlPostRoute(
    "member_action_outcome",
    HOSTED_RUNTIME_MEMBER_ACTION_OUTCOME_PATH,
  ),
  operatorTaskControl: defineHostedRunnerWebControlPostRoute(
    "operator_task_control",
    HOSTED_RUNTIME_OPERATOR_TASK_CONTROL_PATH,
  ),
  outboundMessageVolumeReceipt: defineHostedRunnerWebControlPostRoute(
    "outbound_message_volume_receipt",
    HOSTED_RUNTIME_OUTBOUND_MESSAGE_VOLUME_RECEIPT_PATH,
  ),
  phoneCallResultDelivery: defineHostedRunnerWebControlPostRoute(
    "phone_call_result_delivery",
    HOSTED_RUNTIME_PHONE_CALL_RESULT_DELIVERY_PATH,
  ),
  phoneCallStart: defineHostedRunnerWebControlPostRoute(
    "phone_call_start",
    HOSTED_PHONE_CALLS_PATH,
  ),
  phoneCallStatus: defineHostedRunnerWebControlPostRoute(
    "phone_call_status",
    HOSTED_PHONE_CALL_STATUS_PATH,
  ),
  phoneCallStop: defineHostedRunnerWebControlPostRoute(
    "phone_call_stop",
    HOSTED_PHONE_CALL_STOP_PATH,
  ),
  physicalNoteRecovery: defineHostedRunnerWebControlPostRoute(
    "physical_note_recovery",
    HOSTED_PHYSICAL_NOTE_RECOVERY_PATH,
  ),
  physicalNoteSend: defineHostedRunnerWebControlPostRoute(
    "physical_note_send",
    HOSTED_PHYSICAL_NOTES_PATH,
  ),
  planUsageTool: defineHostedRunnerWebControlPostRoute(
    "plan_usage_tool",
    HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH,
  ),
  productFeedbackRecording: defineHostedRunnerWebControlPostRoute(
    "product_feedback_recording",
    HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH,
  ),
  runtimeLatencyTrace: defineHostedRunnerWebControlPostRoute(
    "runtime_latency_trace",
    HOSTED_RUNTIME_LATENCY_TRACE_PATH,
  ),
  runtimeLogWrite: defineHostedRunnerWebControlPostRoute(
    "runtime_log_write",
    HOSTED_RUNTIME_LOG_PATH,
  ),
  subscriptionTool: defineHostedRunnerWebControlPostRoute(
    "subscription_tool",
    HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
  ),
  threadRouteAuthority: defineHostedRunnerWebControlPostRoute(
    "thread_route_authority",
    HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH,
  ),
  usageRecording: defineHostedRunnerWebControlPostRoute(
    "usage_recording",
    HOSTED_RUNTIME_USAGE_RECORD_PATH,
  ),
  vaultShareActiveKinds: defineHostedRunnerWebControlGetRoute(
    "vault_share_active_kinds",
    HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH,
  ),
  vaultShareDeliver: defineHostedRunnerWebControlPostRoute(
    "vault_share_deliver",
    HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
  ),
  workspaceCheckpoint: defineHostedRunnerWebControlPostRoute(
    "workspace_checkpoint",
    HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
  ),
  workspaceRead: defineHostedRunnerWebControlGetRoute(
    "workspace_read",
    HOSTED_RUNTIME_WORKSPACE_PATH,
  ),
} as const;

type StaticHostedRunnerWebControlRoute =
  (typeof HOSTED_RUNNER_WEB_CONTROL_ROUTES)[keyof typeof HOSTED_RUNNER_WEB_CONTROL_ROUTES];

export type HostedRunnerWebControlOperation =
  | StaticHostedRunnerWebControlRoute["operation"]
  | "computer_use"
  | "device_sync_connect_link"
  | "mailbox_payload_decode"
  | "web_control_blocked";

export const HOSTED_WEB_CONTROL_ROUTE_NOT_ALLOWLISTED_ERROR_CODE =
  "HOSTED_WEB_CONTROL_ROUTE_NOT_ALLOWLISTED" as const;

export type HostedRunnerWebControlRoute = RegisteredHostedRunnerWebControlRoute<
  HostedRunnerWebControlMethod,
  HostedRunnerWebControlOperation
>;

export class HostedWebControlRouteNotAllowlistedError extends TypeError {
  readonly code = HOSTED_WEB_CONTROL_ROUTE_NOT_ALLOWLISTED_ERROR_CODE;
  readonly operation: HostedRunnerWebControlOperation;

  constructor(input: {
    method: string;
    operation: HostedRunnerWebControlOperation;
    path: string;
  }) {
    super(
      `Hosted runtime web-control route is not allowlisted for proxy transport: ${input.method} ${input.path}`,
    );
    this.name = "HostedWebControlRouteNotAllowlistedError";
    this.operation = input.operation;
  }
}

export interface HostedRunnerWebControlPolicy {
  allowed: boolean;
  operation: HostedRunnerWebControlOperation;
}

const HOSTED_RUNNER_WEB_CONTROL_STATIC_POLICY =
  createHostedRunnerWebControlStaticPolicy();

function createHostedRunnerWebControlStaticPolicy(): ReadonlyMap<
  string,
  HostedRunnerWebControlOperation
> {
  const policy = new Map<string, HostedRunnerWebControlOperation>();
  for (const route of Object.values(HOSTED_RUNNER_WEB_CONTROL_ROUTES)) {
    const key = createHostedRunnerWebControlPolicyKey(route.method, route.path);
    if (policy.has(key)) {
      throw new TypeError(`Duplicate hosted runtime web-control route: ${key}`);
    }
    policy.set(key, route.operation);
  }
  return policy;
}

function createHostedRunnerWebControlPolicyKey(
  method: string,
  path: string,
): string {
  return `${method} ${path}`;
}

export function bindHostedRunnerWebControlRoutePath(
  route: HostedRunnerWebControlRoute,
  pathAndSearch: string,
): HostedRunnerWebControlRoute {
  const expected = readHostedRunnerWebControlRoute(route.path);
  const actual = readHostedRunnerWebControlRoute(pathAndSearch);
  if (actual.pathname !== expected.pathname) {
    throw new TypeError(
      "Hosted runtime web-control route path must match its registered route.",
    );
  }
  return defineHostedRunnerWebControlRoute({
    method: route.method,
    operation: route.operation,
    path: actual.pathAndSearch,
  });
}

export function createHostedRunnerDeviceSyncConnectLinkRoute(
  pathAndSearch: string,
): HostedRunnerWebControlRoute {
  const route = readHostedRunnerWebControlRoute(pathAndSearch);
  if (!HOSTED_DEVICE_SYNC_CONNECT_LINK_PATH.test(route.pathname)) {
    throw new TypeError(
      "Hosted runtime device-sync connect-link route is invalid.",
    );
  }
  return defineHostedRunnerWebControlRoute({
    method: "POST",
    operation: "device_sync_connect_link",
    path: route.pathAndSearch,
  });
}

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
  const policy = readHostedRunnerWebControlPolicy(input);
  if (policy.allowed) {
    return;
  }

  throw new HostedWebControlRouteNotAllowlistedError({
    method: input.method,
    operation: policy.operation,
    path: input.path,
  });
}

export function assertAllowedHostedRunnerWebControlRoute(
  route: HostedRunnerWebControlRoute,
): void {
  const parsed = readHostedRunnerWebControlRoute(route.path);
  const policy = readHostedRunnerWebControlPolicy({
    method: route.method,
    path: parsed.pathname,
  });
  if (policy.allowed && policy.operation === route.operation) {
    return;
  }

  throw new HostedWebControlRouteNotAllowlistedError({
    method: route.method,
    operation: policy.operation,
    path: parsed.pathname,
  });
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
  if (input.method !== "GET" && input.method !== "POST") {
    return {
      allowed: false,
      operation: "web_control_blocked",
    };
  }

  const operation = HOSTED_RUNNER_WEB_CONTROL_STATIC_POLICY.get(
    createHostedRunnerWebControlPolicyKey(input.method, input.path),
  );
  if (operation) {
    return {
      allowed: true,
      operation,
    };
  }

  const path = input.path;
  if (input.method !== "POST") {
    return {
      allowed: false,
      operation: "web_control_blocked",
    };
  }
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
