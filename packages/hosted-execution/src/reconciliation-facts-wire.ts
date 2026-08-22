import type {
  HostedRuntimeReconciliationFacts,
  HostedRuntimeReconciliationFactsBlocked,
  HostedRuntimeReconciliationFactsWorkspace,
} from "./orchestration-control.ts";
import type {
  HostedMailboxLaneLag,
} from "./runtime-control.ts";

export interface HostedRuntimeReconciliationFactsWireResponse {
  blocked: HostedRuntimeReconciliationFactsBlocked | null;
  mailboxLag: HostedMailboxLaneLag[];
  workspace: HostedRuntimeReconciliationFactsWorkspace | null;
}

export function projectHostedRuntimeReconciliationFactsWireResponse(
  facts: HostedRuntimeReconciliationFacts,
): HostedRuntimeReconciliationFactsWireResponse {
  return {
    blocked: facts.blocked,
    mailboxLag: facts.mailboxLag,
    workspace: facts.workspace,
  };
}
