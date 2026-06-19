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
export const DEFAULT_MURPH_TELEGRAM_BOT_USERNAME = "withmurph_bot";
export const MURPH_TELEGRAM_USERNAME_OVERRIDE_ENV = "MURPH_TELEGRAM_USERNAME_OVERRIDE";
export const MURPH_TELEGRAM_BOT_USERNAME = resolveMurphTelegramBotUsername();
export const MURPH_TELEGRAM_URL = buildMurphTelegramUrl(MURPH_TELEGRAM_BOT_USERNAME);

export type MurphContactKind = "text" | "telegram" | "email";

export interface MurphContactChannels {
  email: boolean;
  telegram: boolean;
  text: boolean;
}

export interface MurphContactOption {
  copyValue?: string | null;
  href: string;
  kind: MurphContactKind;
  label: string;
  rel?: string;
  target?: string;
  webmail?: MurphWebmailShortcut | null;
}

export interface MurphWebmailShortcut {
  href: string;
  label: string;
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
  userEmailAddress?: string | null;
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
      userEmailAddress: input.userEmailAddress ?? null,
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

export function normalizeMurphTelegramUsername(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  const username = normalized.startsWith("@") ? normalized.slice(1) : normalized;

  return /^[A-Za-z0-9_]{5,32}$/u.test(username) ? username : null;
}

export function resolveMurphTelegramBotUsername(
  source?: Readonly<Record<string, string | undefined>>,
): string {
  const overrideUsername = source
    ? normalizeMurphTelegramUsername(source.MURPH_TELEGRAM_USERNAME_OVERRIDE)
    : normalizeMurphTelegramUsername(process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE);

  return overrideUsername ?? DEFAULT_MURPH_TELEGRAM_BOT_USERNAME;
}

export function buildMurphTelegramUrl(username: string): string {
  return `https://t.me/${username}`;
}

export function resolveMurphWebmailShortcut(input: {
  address: string;
  body?: string | null;
  subject?: string | null;
  userEmailAddress?: string | null;
}): MurphWebmailShortcut | null {
  const domain = extractEmailDomain(input.userEmailAddress);

  if (!domain) {
    return null;
  }

  const provider = WEBMAIL_PROVIDERS.find((candidate) =>
    candidate.domains.includes(domain),
  );

  if (!provider) {
    return null;
  }

  const subject = normalizeOptionalString(input.subject);
  const body = normalizeOptionalString(input.body);

  if (provider.mode === "mailto") {
    const mailto = buildMurphEmailHref({
      address: input.address,
      body,
      subject,
    });
    return {
      href: provider.composeUrl + encodeURIComponent(mailto),
      label: provider.label,
    };
  }

  const url = new URL(provider.composeUrl);
  url.searchParams.set(provider.params.to, input.address);

  if (subject) {
    url.searchParams.set(provider.params.subject, subject);
  }

  if (body) {
    url.searchParams.set(provider.params.body, body);
  }

  return {
    href: url.toString(),
    label: provider.label,
  };
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
    copyValue: input.murphPhoneNumber,
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
  const username = resolveMurphTelegramBotUsername();
  const telegramUrl = buildMurphTelegramUrl(username);

  if (input.message.body) {
    query.set("text", input.message.body);
  }

  const queryString = query.toString();

  return {
    copyValue: `@${username}`,
    href: queryString ? `${telegramUrl}?${queryString}` : telegramUrl,
    kind: "telegram",
    label: "Telegram",
    rel: "noopener noreferrer",
    target: "_blank",
  };
}

function buildMurphEmailContactOption(input: {
  message: NormalizedMurphContactMessage;
  murphEmailAddress: string | null;
  userEmailAddress: string | null;
}): MurphContactOption {
  const address = normalizeOptionalString(input.murphEmailAddress) ?? MURPH_CONTACT_EMAIL;
  const subject = input.message.subject ?? "Hey Murph";

  return {
    copyValue: address,
    href: buildMurphEmailHref({
      address,
      body: input.message.body,
      subject,
    }),
    kind: "email",
    label: "Email",
    webmail: resolveMurphWebmailShortcut({
      address,
      body: input.message.body,
      subject,
      userEmailAddress: input.userEmailAddress,
    }),
  };
}

type WebmailProvider =
  | {
      composeUrl: string;
      domains: readonly string[];
      label: string;
      mode: "params";
      params: { body: string; subject: string; to: string };
    }
  | {
      composeUrl: string;
      domains: readonly string[];
      label: string;
      mode: "mailto";
    };

const WEBMAIL_PROVIDERS: ReadonlyArray<WebmailProvider> = [
  {
    composeUrl: "https://mail.google.com/mail/u/0/?tf=cm",
    domains: ["gmail.com", "googlemail.com"],
    label: "Gmail",
    mode: "params",
    params: { body: "body", subject: "su", to: "to" },
  },
  {
    composeUrl: "https://outlook.live.com/mail/0/deeplink/compose",
    domains: ["hotmail.com", "live.com", "msn.com", "outlook.com"],
    label: "Outlook",
    mode: "params",
    params: { body: "body", subject: "subject", to: "to" },
  },
  {
    composeUrl: "https://compose.mail.yahoo.com/",
    domains: ["yahoo.com", "ymail.com"],
    label: "Yahoo Mail",
    mode: "params",
    params: { body: "body", subject: "subject", to: "to" },
  },
  {
    composeUrl: "https://mail.proton.me/inbox?mailto=",
    domains: ["proton.me", "protonmail.com", "pm.me"],
    label: "Proton Mail",
    mode: "mailto",
  },
  {
    composeUrl: "https://app.fastmail.com/mail/compose?mailto=",
    domains: ["fastmail.com", "fastmail.fm"],
    label: "Fastmail",
    mode: "mailto",
  },
];

function extractEmailDomain(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value)?.toLowerCase() ?? null;
  const atIndex = normalized?.lastIndexOf("@") ?? -1;

  if (!normalized || atIndex <= 0 || atIndex === normalized.length - 1) {
    return null;
  }

  return normalized.slice(atIndex + 1);
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
