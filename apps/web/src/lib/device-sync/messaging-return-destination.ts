import "server-only";

import { formatHostedDeviceSyncProviderLabel } from "./provider-label";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import {
  buildMurphSmsHref,
  buildMurphTelegramTextHref,
  MURPH_TELEGRAM_BOT_USERNAME,
  normalizeMurphTelegramUsername,
} from "../murph-contact-routing";

export type HostedDeviceSyncMessagingReturnTarget = "imessage" | "telegram";
export type HostedDeviceSyncCallbackStatus = "connected" | "error";

const MURPH_LINQ_CONVERSATION_PHONE_NUMBERS_ENV =
  "HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS";

export function readHostedDeviceSyncMessagingReturnTarget(
  value: string | null,
): HostedDeviceSyncMessagingReturnTarget | null {
  if (value === "imessage" || value === "telegram") {
    return value;
  }

  return null;
}

export function resolveHostedDeviceSyncProviderLabel(value: string | null): string | null {
  if (!value || !/^[A-Za-z0-9_-]{1,40}$/u.test(value)) {
    return null;
  }

  return formatHostedDeviceSyncProviderLabel(value);
}

export function resolveHostedDeviceSyncCallbackStatus(
  value: string | null,
): HostedDeviceSyncCallbackStatus | null {
  if (value === "connected" || value === "error") {
    return value;
  }

  return null;
}

export function buildHostedDeviceSyncMessagingReturnMessageBody(
  providerLabel: string | null,
): string {
  return providerLabel ? `I just connected my ${providerLabel}` : "I just connected my device";
}

export function resolveHostedDeviceSyncMessagingReturnDestination(input: {
  messageBody: string;
  recipient: string | null;
  target: HostedDeviceSyncMessagingReturnTarget;
}): string {
  if (input.target === "imessage") {
    return buildMurphSmsHref({
      body: input.messageBody,
      murphPhoneNumber: resolveHostedDeviceSyncMessagingReturnPhoneRecipient(input.recipient),
    });
  }

  return buildMurphTelegramTextHref({
    body: input.messageBody,
    username: resolveHostedDeviceSyncMessagingReturnTelegramUsername(),
  });
}

export function resolveHostedDeviceSyncMessagingReturnPhoneRecipient(
  value: string | null,
): string | null {
  const configuredRecipients = readConfiguredMurphPhoneNumbers();
  const recipient = normalizePhoneNumber(value);

  if (recipient && configuredRecipients.includes(recipient)) {
    return recipient;
  }

  return configuredRecipients[0] ?? null;
}

export function resolveHostedDeviceSyncAssignedMessagingReturnPhoneRecipient(
  value: string | null,
): string | null {
  return normalizePhoneNumber(value);
}

export function resolveHostedDeviceSyncAssignedMessagesReturnDestination(input: {
  messageBody: string;
  recipient: string | null;
}): string | null {
  const recipient = resolveHostedDeviceSyncAssignedMessagingReturnPhoneRecipient(input.recipient);

  return recipient
    ? buildMurphSmsHref({
        body: input.messageBody,
        murphPhoneNumber: recipient,
      })
    : null;
}

export function readConfiguredMurphPhoneNumbers(): string[] {
  const configured = process.env[MURPH_LINQ_CONVERSATION_PHONE_NUMBERS_ENV];

  if (!configured) {
    return [];
  }

  const recipientPhones: string[] = [];

  for (const value of configured.split(/[\n,]+/u)) {
    const recipientPhone = normalizePhoneNumber(value);

    if (recipientPhone && !recipientPhones.includes(recipientPhone)) {
      recipientPhones.push(recipientPhone);
    }
  }

  return recipientPhones;
}

export function resolveHostedDeviceSyncMessagingReturnTelegramUsername(): string {
  const username = normalizeMurphTelegramUsername(process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE)
    ?? normalizeMurphTelegramUsername(process.env.TELEGRAM_BOT_USERNAME);

  return username ?? MURPH_TELEGRAM_BOT_USERNAME;
}
