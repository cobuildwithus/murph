import {
  extractHostedPrivyPhoneAccount,
  extractHostedPrivyTelegramAccount,
  extractHostedPrivyVerifiedEmailAccount,
  resolveHostedPrivyLinkedAccounts,
  type HostedPrivyLinkedAccountContainer,
  type PrivyLinkedAccountLike,
} from "@/src/lib/hosted-onboarding/privy-shared";
import { normalizePhoneNumber } from "@/src/lib/hosted-onboarding/phone";

export const MURPH_EXPERIMENT_CONTACT_EMAIL = "murph@mail.withmurph.ai";
export const MURPH_EXPERIMENT_TELEGRAM_BOT_USERNAME = "withmurph_bot";
export const MURPH_EXPERIMENT_TELEGRAM_URL =
  `https://t.me/${MURPH_EXPERIMENT_TELEGRAM_BOT_USERNAME}`;

export type ExperimentStartContactKind = "text" | "telegram" | "email";

export interface ExperimentStartContactChannels {
  email: boolean;
  telegram: boolean;
  text: boolean;
}

export interface ExperimentStartContactOption {
  connected: boolean;
  description: string;
  href: string;
  kind: ExperimentStartContactKind;
  label: string;
  meta: string;
}

export type ExperimentStartContactAction =
  | {
      kind: "choose";
      options: ExperimentStartContactOption[];
    }
  | {
      kind: "open";
      option: ExperimentStartContactOption;
    };

interface ExperimentStartContactOptionsInput {
  accountContainer?: HostedPrivyLinkedAccountContainer | null;
  initialContactChannels?: Partial<ExperimentStartContactChannels> | null;
  murphPhoneNumber?: string | null;
  protocolTitle: string;
}

export const DEFAULT_EXPERIMENT_START_CONTACT_CHANNELS: ExperimentStartContactChannels = {
  email: false,
  telegram: false,
  text: false,
};

export function resolveExperimentStartContactAction(
  input: ExperimentStartContactOptionsInput,
): ExperimentStartContactAction {
  const options = resolveExperimentStartContactOptions(input);
  const connectedOptions = options.filter((option) => option.connected);

  if (connectedOptions.length > 1) {
    return {
      kind: "choose",
      options: connectedOptions,
    };
  }

  if (connectedOptions.length === 1) {
    return {
      kind: "open",
      option: connectedOptions[0],
    };
  }

  return {
    kind: "open",
    option: selectFallbackExperimentStartContactOption(options),
  };
}

export function resolveExperimentStartContactOptions(
  input: ExperimentStartContactOptionsInput,
): ExperimentStartContactOption[] {
  const contactChannels = resolveExperimentStartContactChannelsForOptions(input);
  const message = buildExperimentStartMessage(input.protocolTitle);
  const murphPhoneNumber = normalizePhoneNumber(input.murphPhoneNumber);
  const textConnected = contactChannels.text && murphPhoneNumber !== null;

  return [
    {
      connected: textConnected,
      description: murphPhoneNumber
        ? "Open Messages to text Murph about this protocol."
        : "Open Messages and continue from your Murph text thread.",
      href: buildExperimentStartSmsHref({
        body: message,
        murphPhoneNumber,
      }),
      kind: "text",
      label: "Text",
      meta: murphPhoneNumber ? "Messages" : "Messages fallback",
    },
    {
      connected: contactChannels.telegram,
      description: `Open @${MURPH_EXPERIMENT_TELEGRAM_BOT_USERNAME} in Telegram.`,
      href: MURPH_EXPERIMENT_TELEGRAM_URL,
      kind: "telegram",
      label: "Telegram",
      meta: "Telegram",
    },
    {
      connected: contactChannels.email,
      description: "Draft an email to Murph with this experiment name included.",
      href: buildExperimentStartEmailHref({
        body: message,
        protocolTitle: input.protocolTitle,
      }),
      kind: "email",
      label: "Email",
      meta: "Email",
    },
  ];
}

export function buildExperimentStartMessage(protocolTitle: string): string {
  const title = normalizeOptionalString(protocolTitle) ?? "this";
  return `I want to start the ${title} experiment.`;
}

export function resolveExperimentStartContactChannels(input: {
  accountContainer?: HostedPrivyLinkedAccountContainer | null;
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
}): ExperimentStartContactChannels {
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

export function openExperimentStartContactOption(option: ExperimentStartContactOption): void {
  if (typeof window === "undefined") {
    return;
  }

  if (option.kind === "telegram") {
    window.open(option.href, "_blank", "noreferrer");
    return;
  }

  window.location.assign(option.href);
}

function resolveExperimentStartLinkedAccounts(
  input: ExperimentStartContactOptionsInput,
): PrivyLinkedAccountLike[] {
  const accountContainer = input.accountContainer ?? { linkedAccounts: [] };
  const linkedAccounts = resolveHostedPrivyLinkedAccounts(accountContainer);

  if (linkedAccounts.length > 0) {
    return linkedAccounts;
  }

  return [];
}

function resolveExperimentStartContactChannelsForOptions(
  input: ExperimentStartContactOptionsInput,
): ExperimentStartContactChannels {
  const initialChannels = normalizeExperimentStartContactChannels(input.initialContactChannels);

  if (!input.accountContainer) {
    return initialChannels;
  }

  const accountChannels = resolveExperimentStartContactChannels({
    accountContainer: input.accountContainer,
    linkedAccounts: resolveExperimentStartLinkedAccounts(input),
  });

  return {
    email: accountChannels.email || initialChannels.email,
    telegram: accountChannels.telegram || initialChannels.telegram,
    text: accountChannels.text || initialChannels.text,
  };
}

function normalizeExperimentStartContactChannels(
  channels: Partial<ExperimentStartContactChannels> | null | undefined,
): ExperimentStartContactChannels {
  return {
    email: channels?.email === true,
    telegram: channels?.telegram === true,
    text: channels?.text === true,
  };
}

function selectFallbackExperimentStartContactOption(
  options: readonly ExperimentStartContactOption[],
): ExperimentStartContactOption {
  const text = options.find((option) => option.kind === "text");
  const telegram = options.find((option) => option.kind === "telegram");

  if (text && hasExplicitSmsTarget(text)) {
    return text;
  }

  if (telegram) {
    return telegram;
  }

  if (text) {
    return text;
  }

  return options[0];
}

function hasExplicitSmsTarget(option: ExperimentStartContactOption): boolean {
  return option.kind === "text"
    && option.href.startsWith("sms:")
    && !option.href.startsWith("sms:?")
    && option.href !== "sms:";
}

function buildExperimentStartSmsHref(input: {
  body: string;
  murphPhoneNumber: string | null;
}): string {
  const target = normalizePhoneNumber(input.murphPhoneNumber) ?? "";
  const body = normalizeOptionalString(input.body);

  if (!body) {
    return `sms:${target}`;
  }

  return `sms:${target}?body=${encodeURIComponent(body)}`;
}

function buildExperimentStartEmailHref(input: {
  body: string;
  protocolTitle: string;
}): string {
  const subject = `Start experiment: ${normalizeOptionalString(input.protocolTitle) ?? "Murph protocol"}`;
  return `mailto:${MURPH_EXPERIMENT_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${
    encodeURIComponent(input.body)
  }`;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
