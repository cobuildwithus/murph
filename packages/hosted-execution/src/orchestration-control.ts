import {
  HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES,
  type HostedMailboxLane,
  type HostedWorkspaceInvocationProcessingMode,
} from "./runtime-control-values.ts";
import type { HostedMailboxKind } from "./runtime-control.ts";
export { isHostedMailboxLane } from "./runtime-control-values.ts";

import type {
  HostedRuntimeReconciliationBlockedReason,
  HostedRuntimeSystemMailboxFrontierClass,
} from "./reconciliation-facts-wire.ts";

export {
  HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS,
  HOSTED_RUNTIME_SYSTEM_MAILBOX_FRONTIER_CLASSES,
  projectHostedRuntimeReconciliationFactsWireResponse,
  type HostedRuntimeReconciliationBlockedReason,
  type HostedRuntimeReconciliationFacts,
  type HostedRuntimeReconciliationFactsBlocked,
  type HostedRuntimeReconciliationFactsWireResponse,
  type HostedRuntimeReconciliationFactsWorkspace,
  type HostedRuntimeSystemMailboxFrontierClass,
} from "./reconciliation-facts-wire.ts";

export const HOSTED_USER_RUNTIME_WORKFLOW_TYPE =
  "hostedUserRuntimeWorkflow" as const;

export const HOSTED_USER_RUNTIME_TASK_QUEUE =
  "murph-hosted-runtime" as const;

export const HOSTED_USER_RUNTIME_SIGNAL_NAME = "runtimeSignal" as const;

export const HOSTED_USER_RUNTIME_STATUS_QUERY_NAME =
  "runtimeWorkflowStatus" as const;

export const HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON =
  "assistant_delivery" as const;

export const HOSTED_RUNTIME_SIGNAL_KINDS = [
  "mailbox_appended",
  "runtime_owner_released",
  "runtime_recheck_requested",
  "runtime_wake_requested",
] as const;

export type HostedRuntimeSignalKind = (typeof HOSTED_RUNTIME_SIGNAL_KINDS)[number];

export type HostedRuntimeSignal =
  | {
      kind: "mailbox_appended";
      mailboxItemId: string;
      lane: HostedMailboxLane;
      laneSeq: string;
    }
  | {
      kind: "runtime_owner_released";
      runtimeAttemptId: string;
    }
  | {
      kind: "runtime_recheck_requested";
    }
  | {
      kind: "runtime_wake_requested";
    };

export interface HostedRuntimeMailboxPointer {
  mailboxItemId: string;
  lane: HostedMailboxLane;
  laneSeq: string;
}

export interface HostedRuntimeReconciliationFactsRequest {
  userId: string;
}

export const HOSTED_RUNTIME_PROCESSING_MODES =
  HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES;

export type HostedRuntimeProcessingMode = HostedWorkspaceInvocationProcessingMode;

// One policy owns both admission kinds and derived runner route actions.
const HOSTED_SYSTEM_MAILBOX_MODEL_FREE_POLICY = [
  ["assistant.notification.requested", "always"],
  ["clinical-records.sync-requested", "assistant_blocked"],
  ["device-sync.wake", "always"],
  ["health.daily-metric.reported", "always"],
  ["journal.group-fact.recorded", "always"],
  ["member.action.requested", "assistant_blocked"],
  ["member.channels.updated", "always"],
  ["member.preferences.updated", "assistant_blocked"],
  ["runtime.browser-vault-refresh-requested", "always"],
  ["runtime.maintenance-requested", "always"],
] as const satisfies readonly (readonly [HostedMailboxKind, "always" | "assistant_blocked"])[];

export function getHostedSystemMailboxModelFreeKinds(assistantExecutionBlocked = false) {
  return HOSTED_SYSTEM_MAILBOX_MODEL_FREE_POLICY
    .filter(([, admission]) => admission === "always" || assistantExecutionBlocked)
    .map(([kind]) => kind);
}

export const HOSTED_SYSTEM_MAILBOX_MODEL_FREE_KINDS = getHostedSystemMailboxModelFreeKinds();

export const HOSTED_SYSTEM_MAILBOX_MODEL_FREE_NOTIFICATION_DEDUPE_KEY_PREFIXES =
  [
    "assistant.notification.requested:device-delivery-stalled:v1:",
    "assistant.notification.requested:group-join:",
  ] as const;

export function isHostedSystemMailboxModelFreeNotification(input: {
  dedupeKey: string | null | undefined;
  kind: string;
}): boolean {
  if (input.kind !== "assistant.notification.requested") {
    return false;
  }

  const dedupeKey = input.dedupeKey?.trim() ?? "";
  return HOSTED_SYSTEM_MAILBOX_MODEL_FREE_NOTIFICATION_DEDUPE_KEY_PREFIXES.some(
    (prefix) => dedupeKey.length > prefix.length && dedupeKey.startsWith(prefix),
  );
}

export function classifyHostedSystemMailboxExecutionClass(input: {
  assistantExecutionBlocked?: boolean;
  dedupeKey: string | null | undefined;
  kind: string;
}): HostedRuntimeSystemMailboxFrontierClass {
  if (
    isHostedSystemMailboxModelFreeNotification({
      dedupeKey: input.dedupeKey,
      kind: input.kind,
    })
  ) {
    return "model_free";
  }

  return getHostedSystemMailboxModelFreeKinds(input.assistantExecutionBlocked).some((kind) =>
    kind === input.kind && kind !== "assistant.notification.requested"
  )
    ? "model_free"
    : "default_owned";
}

export interface HostedRuntimeEnsureProcessingRequest {
  /** Ephemeral reservation only; SDP never enters an invocation job. */
  voiceCallId?: string;
  admission?: import("./runtime-owner.ts").HostedRuntimeOwnerResponse;
  assistantExecutionBlocked?: true;
  conversationWorkPending?: true;
  mailboxWakeHighWater?: import("./runtime-control.ts").HostedMailboxWakeHighWater;
  orchestrationAttemptId: string;
  processingMode?: HostedRuntimeProcessingMode | null;
}

export const HOSTED_RUNTIME_ENSURE_PROCESSING_RESPONSE_KINDS = [
  "runtime_processing_accepted",
  "retry_later",
] as const;

export type HostedRuntimeEnsureProcessingResponseKind =
  (typeof HOSTED_RUNTIME_ENSURE_PROCESSING_RESPONSE_KINDS)[number];

export const HOSTED_RUNTIME_PROCESSING_ACCEPTED_ACTIONS = [
  "started",
  "replaced",
  "woken",
  "already_running",
] as const;

export type HostedRuntimeProcessingAcceptedAction =
  (typeof HOSTED_RUNTIME_PROCESSING_ACCEPTED_ACTIONS)[number];

export type HostedRuntimeEnsureProcessingResponse =
  | {
      action: HostedRuntimeProcessingAcceptedAction;
      kind: "runtime_processing_accepted";
      recommendedRecheckAt: string;
      runtimeAttemptId: string;
    }
  | {
      kind: "retry_later";
      retryAt: string;
    };

export const HOSTED_RUNTIME_CURRENT_WAIT_REASONS = [
  "idle_next_wake",
  "blocked_retry",
  "reconciliation_failure_retry",
  "execution_failure_retry",
  "processing_retry_later",
  "runtime_wake_recheck",
  "non_retryable_signal_only",
] as const;

export type HostedRuntimeCurrentWaitReason =
  | (typeof HOSTED_RUNTIME_CURRENT_WAIT_REASONS)[number]
  | null;

export type HostedRuntimeLastExecutionKind =
  | HostedRuntimeEnsureProcessingResponseKind
  | "failed"
  | null;

export type HostedRuntimeLastRuntimeStatus =
  | "retry_later"
  | "scheduled"
  | null;

export const HOSTED_RUNTIME_RECONCILIATION_STATUSES = [
  "blocked",
  "idle",
  "work_pending",
] as const;

export type HostedRuntimeReconciliationStatus =
  (typeof HOSTED_RUNTIME_RECONCILIATION_STATUSES)[number];

export interface HostedRuntimeWorkflowState {
  currentWaitReason: HostedRuntimeCurrentWaitReason;
  currentWaitUntil: string | null;
  invalidSignalCount: number;
  lastOrchestrationAttemptId: string | null;
  lastInvalidSignalErrorCode: string | null;
  lastExecutionAt: string | null;
  lastExecutionErrorCode: string | null;
  lastExecutionKind: HostedRuntimeLastExecutionKind;
  lastMailboxLagLaneCount: number;
  lastReconciliationBlockedReason: HostedRuntimeReconciliationBlockedReason | null;
  lastReconciliationNextWakeAt: string | null;
  lastReconciliationStatus: HostedRuntimeReconciliationStatus | null;
  lastRuntimeAttemptId: string | null;
  lastRuntimeStatus: HostedRuntimeLastRuntimeStatus;
  latestMailboxPointer: HostedRuntimeMailboxPointer | null;
  mailboxSignalCount: number;
  runtimeWakeRequested: boolean;
  signalVersion: number;
  userId: string;
}
