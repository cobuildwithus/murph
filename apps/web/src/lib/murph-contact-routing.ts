import { normalizePhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import {
  extractHostedPrivyPhoneAccount,
  extractHostedPrivyTelegramAccount,
  extractHostedPrivyVerifiedEmailAccount,
  resolveHostedPrivyLinkedAccounts,
  type HostedPrivyLinkedAccountContainer,
  type PrivyLinkedAccountLike,
} from "@/src/lib/hosted-onboarding/privy-shared";

export const MURPH_CONTACT_EMAIL = "murph@mail.withmurph.ai";
export const MURPH_TELEGRAM_BOT_USERNAME = "withmurph_bot";
export const MURPH_TELEGRAM_URL = `https://t.me/${MURPH_TELEGRAM_BOT_USERNAME}`;

export type MurphContactKind = "text" | "telegram" | "email";

export interface MurphContactChannels {
  email: boolean;
  telegram: boolean;
  text: boolean;
}

export interface MurphContactOption {
  href: string;
  kind: MurphContactKind;
  label: string;
  rel?: string;
  target?: string;
}

export interface MurphContactMessage {
  body?: string | null;
  subject?: string | null;
}

export const DEFAULT_MURPH_CONTACT_CHANNELS: MurphContactChannels = {
  email: false,
  telegram: false,
  text: false,
};

export function resolveMurphContactOptions(input: {
  contactChannels?: Partial<MurphContactChannels> | null;
  message?: MurphContactMessage | null;
  murphEmailAddress?: string | null;
  murphPhoneNumber?: string | null;
}): MurphContactOption[] {
  const contactChannels = normalizeMurphContactChannels(input.contactChannels);
  const message = normalizeMurphContactMessage(input.message);
  const murphPhoneNumber = normalizePhoneNumber(input.murphPhoneNumber);
  const options: MurphContactOption[] = [];

  if (murphPhoneNumber && contactChannels.text) {
    options.push(buildMurphTextContactOption({
      message,
      murphPhoneNumber,
    }));
  }

  if (contactChannels.telegram) {
    options.push(buildMurphTelegramContactOption({ message }));
  }

  if (contactChannels.email) {
    options.push(buildMurphEmailContactOption({
      message,
      murphEmailAddress: input.murphEmailAddress ?? null,
    }));
  }

  return options;
}

export function resolveMurphContactChannels(input: {
  accountContainer?: HostedPrivyLinkedAccountContainer | null;
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
}): MurphContactChannels {
  const linkedAccounts = input.linkedAccounts
    ? [...input.linkedAccounts]
    : resolveHostedPrivyLinkedAccounts(input.accountContainer ?? { linkedAccounts: [] });
  const telegram = extractHostedPrivyTelegramAccount({
    linkedAccounts,
    telegram: input.accountContainer?.telegram,
  });

  return {
    email: extractHostedPrivyVerifiedEmailAccount(linkedAccounts) !== null,
    telegram: telegram !== null,
    text: extractHostedPrivyPhoneAccount(linkedAccounts) !== null,
  };
}

export function buildMurphSmsHref(input: {
  body?: string | null;
  murphPhoneNumber: string | null;
}): string {
  const target = normalizePhoneNumber(input.murphPhoneNumber) ?? "";
  const body = normalizeOptionalString(input.body);

  if (!body) {
    return `sms:${target}`;
  }

  return `sms:${target}?body=${encodeURIComponent(body)}`;
}

export function buildMurphEmailHref(input: {
  address?: string | null;
  body?: string | null;
  subject?: string | null;
} = {}): string {
  const address = normalizeOptionalString(input.address) ?? MURPH_CONTACT_EMAIL;
  const query: string[] = [];
  const subject = normalizeOptionalString(input.subject);
  const body = normalizeOptionalString(input.body);

  if (subject) {
    query.push(`subject=${encodeURIComponent(subject)}`);
  }

  if (body) {
    query.push(`body=${encodeURIComponent(body)}`);
  }

  const queryString = query.join("&");
  return queryString
    ? `mailto:${address}?${queryString}`
    : `mailto:${address}`;
}

export function normalizeMurphContactChannels(
  channels: Partial<MurphContactChannels> | null | undefined,
): MurphContactChannels {
  return {
    email: channels?.email === true,
    telegram: channels?.telegram === true,
    text: channels?.text === true,
  };
}

function buildMurphTextContactOption(input: {
  message: NormalizedMurphContactMessage;
  murphPhoneNumber: string;
}): MurphContactOption {
  return {
    href: buildMurphSmsHref({
      body: input.message.body,
      murphPhoneNumber: input.murphPhoneNumber,
    }),
    kind: "text",
    label: "Messages",
  };
}

function buildMurphTelegramContactOption(input: {
  message: NormalizedMurphContactMessage;
}): MurphContactOption {
  const query = new URLSearchParams();

  if (input.message.body) {
    query.set("text", input.message.body);
  }

  const queryString = query.toString();

  return {
    href: queryString ? `${MURPH_TELEGRAM_URL}?${queryString}` : MURPH_TELEGRAM_URL,
    kind: "telegram",
    label: "Telegram",
    rel: "noopener noreferrer",
    target: "_blank",
  };
}

function buildMurphEmailContactOption(input: {
  message: NormalizedMurphContactMessage;
  murphEmailAddress: string | null;
}): MurphContactOption {
  return {
    href: buildMurphEmailHref({
      address: input.murphEmailAddress,
      body: input.message.body,
      subject: input.message.subject ?? "Hey Murph",
    }),
    kind: "email",
    label: "Email",
  };
}

interface NormalizedMurphContactMessage {
  body: string | null;
  subject: string | null;
}

function normalizeMurphContactMessage(
  message: MurphContactMessage | null | undefined,
): NormalizedMurphContactMessage {
  return {
    body: normalizeOptionalString(message?.body),
    subject: normalizeOptionalString(message?.subject),
  };
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
