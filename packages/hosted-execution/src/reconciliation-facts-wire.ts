import type {
  HostedMailboxLaneLag,
} from "./runtime-control.ts";

export const HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS = [
  "ai_usage_denied",
  "ai_usage_gate_unavailable",
  "automation_engagement_paused",
  "health_data_consent_withdrawn",
  "hosted_runtime_not_configured",
  "user_not_active",
] as const;

export type HostedRuntimeReconciliationBlockedReason =
  (typeof HOSTED_RUNTIME_RECONCILIATION_BLOCKED_REASONS)[number];

export const HOSTED_RUNTIME_SYSTEM_MAILBOX_FRONTIER_CLASSES = [
  "default_owned",
  "model_free",
] as const;

export type HostedRuntimeSystemMailboxFrontierClass =
  (typeof HOSTED_RUNTIME_SYSTEM_MAILBOX_FRONTIER_CLASSES)[number];

export interface HostedRuntimeReconciliationFactsWorkspace {
  hostedMailboxSystemHandledThroughSeq?: string;
  inboxMediaRetentionWakeAt: string | null;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  systemMailboxFrontier?: HostedRuntimeSystemMailboxFrontierClass | null;
  version: string | null;
}

export interface HostedRuntimeReconciliationFactsBlocked {
  reason: HostedRuntimeReconciliationBlockedReason;
  retryAt: string | null;
}

export interface HostedRuntimeReconciliationFacts {
  blocked: HostedRuntimeReconciliationFactsBlocked | null;
  environmentInterviewPending: boolean;
  mailboxLag: HostedMailboxLaneLag[];
  workspace: HostedRuntimeReconciliationFactsWorkspace | null;
}

export interface HostedRuntimeReconciliationFactsWireResponse {
  blocked: HostedRuntimeReconciliationFactsBlocked | null;
  environmentInterviewPending: boolean;
  mailboxLag: HostedMailboxLaneLag[];
  workspace: HostedRuntimeReconciliationFactsWorkspace | null;
}

export function projectHostedRuntimeReconciliationFactsWireResponse(
  facts: HostedRuntimeReconciliationFacts,
): HostedRuntimeReconciliationFactsWireResponse {
  return {
    blocked: facts.blocked,
    environmentInterviewPending: facts.environmentInterviewPending,
    mailboxLag: facts.mailboxLag,
    workspace: facts.workspace,
  };
}
