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

export const DEFAULT_MURPH_CONTACT_CHANNELS: MurphContactChannels = {
  email: false,
  telegram: false,
  text: false,
};

export function resolvePreferredMurphChatContactOption(input: {
  contactChannels?: Partial<MurphContactChannels> | null;
  murphPhoneNumber?: string | null;
}): MurphContactOption | null {
  const contactChannels = normalizeMurphContactChannels(input.contactChannels);
  const murphPhoneNumber = normalizePhoneNumber(input.murphPhoneNumber);

  if (murphPhoneNumber && contactChannels.text) {
    return buildMurphTextContactOption(murphPhoneNumber);
  }

  if (contactChannels.telegram) {
    return buildMurphTelegramContactOption();
  }

  if (contactChannels.email) {
    return buildMurphEmailContactOption();
  }

  return null;
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
  body?: string | null;
  subject?: string | null;
} = {}): string {
  const query = new URLSearchParams();
  const subject = normalizeOptionalString(input.subject);
  const body = normalizeOptionalString(input.body);

  if (subject) {
    query.set("subject", subject);
  }

  if (body) {
    query.set("body", body);
  }

  const queryString = query.toString();
  return queryString
    ? `mailto:${MURPH_CONTACT_EMAIL}?${queryString}`
    : `mailto:${MURPH_CONTACT_EMAIL}`;
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

function buildMurphTextContactOption(murphPhoneNumber: string): MurphContactOption {
  return {
    href: buildMurphSmsHref({
      murphPhoneNumber,
    }),
    kind: "text",
    label: "Messages",
  };
}

function buildMurphTelegramContactOption(): MurphContactOption {
  return {
    href: MURPH_TELEGRAM_URL,
    kind: "telegram",
    label: "Telegram",
    rel: "noopener noreferrer",
    target: "_blank",
  };
}

function buildMurphEmailContactOption(): MurphContactOption {
  return {
    href: buildMurphEmailHref({
      subject: "Chat with Murph",
    }),
    kind: "email",
    label: "Email",
  };
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
