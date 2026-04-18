import type { HostedLinqMessageSideEffect } from "./webhook-transport";
import type { HostedWebhookPlan } from "./webhook-service-types";

export type HostedOnboardingLinqWebhookResponse = {
  duplicate?: boolean;
  ignored?: boolean;
  inviteCode?: string;
  joinUrl?: string;
  ok: true;
  reason?: string;
};

export type HostedOnboardingLinqDirectFinalization =
  | {
      kind: "mark_daily_quota_reply_sent";
      memberId: string;
      occurredAt: string;
    }
  | {
      kind: "mark_onboarding_link_sent";
      memberId: string;
      occurredAt: string;
    };

export type HostedOnboardingLinqDirectPlan =
  HostedWebhookPlan<HostedOnboardingLinqWebhookResponse, HostedLinqMessageSideEffect> & {
    finalization: HostedOnboardingLinqDirectFinalization | null;
  };
