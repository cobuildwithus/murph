import type { HostedLocalE2eScenarioName } from "./e2e.ts";

export interface HostedLocalCrossRepoCiRequirement {
  reason: string;
  scenario: Exclude<HostedLocalE2eScenarioName, "all">;
}

/**
 * Product-critical hosted-local journeys that must run in Murph Cloud's
 * public-repository integration workflow. The public harness owns this list so
 * adding a regression scenario and adding it to required CI cannot silently
 * drift across repositories again.
 */
export const hostedLocalCrossRepoCiRequirements = [
  {
    reason: "Proves the complete Junction Link browser callback and persisted connection seam.",
    scenario: "junction-link-connect",
  },
  {
    reason: "Proves the runner can create a signed hosted device-connect link through Web.",
    scenario: "device-connect",
  },
  {
    reason: "Proves an authenticated member can render and retain the hosted Connect journey in Chromium.",
    scenario: "hosted-web-browser-smoke",
  },
  {
    reason: "Proves the primary Linq delivery path through the real hosted stack.",
    scenario: "linq-delivery",
  },
  {
    reason: "Proves scheduled work wakes and reaches the outbound messaging provider.",
    scenario: "linq-scheduled-reminder",
  },
  {
    reason: "Proves a scheduled skill-authored recipe reaches generic authorized group email fanout.",
    scenario: "group-email-newsletter",
  },
  {
    reason: "Proves the public runtime contracts against the private Temporal owner.",
    scenario: "temporal-orchestration",
  },
  {
    reason: "Proves canonical receipt recovery after an accepted result loses its acknowledgement.",
    scenario: "canonical-receipt-lost-ack-recovery",
  },
  {
    reason: "Proves an ambiguous quota notice remains durable and exactly-once.",
    scenario: "usage-limit-ambiguous-send",
  },
  {
    reason: "Proves foreground replies retain priority over staged background work.",
    scenario: "foreground-reply-priority",
  },
  {
    reason: "Proves approval-bound sensitive effects resume through the production path.",
    scenario: "vault-file-approval-resume",
  },
] as const satisfies readonly HostedLocalCrossRepoCiRequirement[];
