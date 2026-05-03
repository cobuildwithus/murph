import type { HostedOnboardingTelegramWebhookResponse } from "./webhook-provider-telegram";
import type { HostedOnboardingLinqWebhookResponse } from "./webhook-provider-linq-types";

export type HostedWebhookPlan<TResult, TSideEffect = never> = {
  desiredSideEffects: readonly TSideEffect[];
  response: TResult;
  wakeLinqChatId?: string;
  wakeMailboxItemId?: string;
  wakeUserId?: string;
};

export type HostedStripeWebhookResponse = {
  duplicate?: boolean;
  ok: true;
  type: string;
};

export type HostedWebhookServiceResponse =
  | HostedOnboardingLinqWebhookResponse
  | HostedOnboardingTelegramWebhookResponse;
