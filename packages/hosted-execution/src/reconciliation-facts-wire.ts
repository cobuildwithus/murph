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

// Legacy Temporal readers reject unknown reconciliation keys. New readers use
// this signed search value to opt into the Environment fact until those readers
// have drained and the compatibility floor can be removed.
export const HOSTED_RUNTIME_RECONCILIATION_ENVIRONMENT_INTERVIEW_SEARCH =
  "?includeEnvironmentInterviewPending=1" as const;

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
  environmentInterviewPending?: boolean;
  mailboxLag: HostedMailboxLaneLag[];
  workspace: HostedRuntimeReconciliationFactsWorkspace | null;
}

export function projectHostedRuntimeReconciliationFactsWireResponse(
  facts: HostedRuntimeReconciliationFacts,
  includeEnvironmentInterviewPending = false,
): HostedRuntimeReconciliationFactsWireResponse {
  return {
    blocked: facts.blocked,
    ...(includeEnvironmentInterviewPending
      ? { environmentInterviewPending: facts.environmentInterviewPending }
      : {}),
    mailboxLag: facts.mailboxLag,
    workspace: facts.workspace,
  };
}
