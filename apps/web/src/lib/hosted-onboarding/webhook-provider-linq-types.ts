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

export type HostedOnboardingLinqDirectPlan =
  HostedWebhookPlan<HostedOnboardingLinqWebhookResponse, HostedLinqMessageSideEffect>;
