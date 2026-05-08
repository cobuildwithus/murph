import type { HostedAiUsageAllowDecision } from "@murphai/hosted-execution/runtime-control";

import type { HostedOnboardingTelegramWebhookResponse } from "./webhook-provider-telegram";
import type { HostedOnboardingLinqWebhookResponse } from "./webhook-provider-linq-types";
import type { HostedOnboardingWhatsAppWebhookResponse } from "./webhook-provider-whatsapp";

export type HostedWebhookPlan<TResult, TSideEffect = never> = {
  desiredSideEffects: readonly TSideEffect[];
  response: TResult;
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
  wakeHandoffs?: readonly HostedWebhookWakeHandoff[];
  wakeLinqChatId?: string;
  wakeMailboxItemId?: string;
  wakeUserId?: string;
};

export type HostedWebhookWakeHandoff = {
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
  eventId: string;
  linqChatId?: string | null;
  mailboxItemId: string;
  source: "linq" | "telegram" | "whatsapp";
  userId: string;
};

export type HostedStripeWebhookResponse = {
  duplicate?: boolean;
  ok: true;
  type: string;
};

export type HostedWebhookServiceResponse =
  | HostedOnboardingLinqWebhookResponse
  | HostedOnboardingTelegramWebhookResponse
  | HostedOnboardingWhatsAppWebhookResponse;
