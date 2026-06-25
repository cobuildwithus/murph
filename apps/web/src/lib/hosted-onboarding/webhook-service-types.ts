import type { HostedOnboardingTelegramWebhookResponse } from "./webhook-provider-telegram";
import type { HostedOnboardingLinqWebhookResponse } from "./webhook-provider-linq-types";
import type { HostedOnboardingWhatsAppWebhookResponse } from "./webhook-provider-whatsapp";
import type { HostedThreadRouteEgressAuthority } from "../hosted-routing/thread-route-store";

export type HostedWebhookPlan<TResult, TSideEffect = never> = {
  desiredSideEffects: readonly TSideEffect[];
  linqReadReceiptRouteAuthority?: HostedThreadRouteEgressAuthority;
  response: TResult;
  wakeHandoffs?: readonly HostedWebhookWakeHandoff[];
  wakeLinqChatId?: string;
  wakeMailboxItemId?: string;
  wakeUserId?: string;
};

export type HostedWebhookWakeHandoff = {
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
