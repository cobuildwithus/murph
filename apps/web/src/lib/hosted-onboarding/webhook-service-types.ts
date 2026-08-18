import type { HostedMailboxLane } from "@murphai/hosted-execution/runtime-control";
import type { HostedOnboardingTelegramWebhookResponse } from "./webhook-provider-telegram";
import type { HostedOnboardingLinqWebhookResponse } from "./webhook-provider-linq-types";
import type { HostedLinqThreadRouteEgressAuthority } from "../hosted-routing/thread-route-store";

// Lane facts from the planner's own mailbox append/dedupe row. Presence means
// the planning transaction already proved the active member, admission, and
// workspace row for this wake, so Linq handoff can include them in its
// Temporal signal and, after that signal is accepted, fire the direct runtime
// ensure fast path.
export type HostedWebhookWakeMailboxCheckpoint = {
  lane: HostedMailboxLane;
  laneSeq: string;
};

export type HostedWebhookPlan<TResult, TSideEffect = never> = {
  desiredSideEffects: readonly TSideEffect[];
  linqReadReceiptRouteAuthority?: HostedLinqThreadRouteEgressAuthority;
  postCommitGroupJoinConfirmationMemberIds?: readonly string[];
  postCommitPhoneCallResultRecoveryMemberIds?: readonly string[];
  postCommitUsageReferralIds?: readonly string[];
  response: TResult;
  wakeHandoffs?: readonly HostedWebhookWakeHandoff[];
};

export type HostedWebhookWakeHandoff = {
  eventId: string;
  linqChatId?: string | null;
  mailboxItemId: string;
  source: "linq" | "telegram";
  userId: string;
  wakeMailboxCheckpoint?: HostedWebhookWakeMailboxCheckpoint;
};

export type HostedStripeWebhookResponse = {
  duplicate?: boolean;
  ok: true;
  type: string;
};

export type HostedWebhookServiceResponse =
  | HostedOnboardingLinqWebhookResponse
  | HostedOnboardingTelegramWebhookResponse;
