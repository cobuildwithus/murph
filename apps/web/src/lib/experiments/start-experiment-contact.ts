import {
  resolveHostedPrivyLinkedAccounts,
  type HostedPrivyLinkedAccountContainer,
  type PrivyLinkedAccountLike,
} from "@/src/lib/hosted-onboarding/privy-shared";
import { normalizePhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import {
  buildMurphEmailHref,
  buildMurphSmsHref,
  buildMurphTelegramTextHref,
  DEFAULT_MURPH_CONTACT_CHANNELS,
  MURPH_CONTACT_EMAIL,
  type MurphContactChannels,
  MURPH_TELEGRAM_BOT_USERNAME,
  MURPH_TELEGRAM_URL,
  resolveMurphContactChannels,
} from "@/src/lib/murph-contact-routing";

export const MURPH_EXPERIMENT_CONTACT_EMAIL = MURPH_CONTACT_EMAIL;
export const MURPH_EXPERIMENT_TELEGRAM_BOT_USERNAME = MURPH_TELEGRAM_BOT_USERNAME;
export const MURPH_EXPERIMENT_TELEGRAM_URL = MURPH_TELEGRAM_URL;

export type ExperimentStartContactKind = "text" | "telegram" | "email";

export type ExperimentStartContactChannels = MurphContactChannels;

export interface ExperimentStartContactOption {
  connected: boolean;
  description: string;
  href: string;
  kind: ExperimentStartContactKind;
  label: string;
  meta: string;
}

export interface ExperimentStartProtocolReference {
  key: string;
  pageRevisionId: string;
  runSpecRevisionId: string;
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
  protocolRef?: ExperimentStartProtocolReference | null;
  protocolTitle: string;
}

export const DEFAULT_EXPERIMENT_START_CONTACT_CHANNELS = DEFAULT_MURPH_CONTACT_CHANNELS;

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
  const message = buildExperimentStartMessage(input.protocolTitle, input.protocolRef);
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
      href: buildMurphTelegramTextHref({
        body: message,
        username: MURPH_EXPERIMENT_TELEGRAM_BOT_USERNAME,
      }),
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

export function buildExperimentStartMessage(
  protocolTitle: string,
  protocolRef?: ExperimentStartProtocolReference | null,
): string {
  const title = normalizeOptionalString(protocolTitle) ?? "this";
  const opening = `I want to start the ${title} experiment.`;

  if (!protocolRef) {
    return opening;
  }

  const normalizedRef = normalizeExperimentStartProtocolReference(protocolRef);
  return [
    opening,
    "",
    "Protocol reference:",
    `key: ${normalizedRef.key}`,
    `pageRevisionId: ${normalizedRef.pageRevisionId}`,
    `runSpecRevisionId: ${normalizedRef.runSpecRevisionId}`,
  ].join("\n");
}

export function resolveExperimentStartContactChannels(input: {
  accountContainer?: HostedPrivyLinkedAccountContainer | null;
  linkedAccounts?: readonly PrivyLinkedAccountLike[];
}): ExperimentStartContactChannels {
  return resolveMurphContactChannels(input);
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
  return buildMurphSmsHref(input);
}

function buildExperimentStartEmailHref(input: {
  body: string;
  protocolTitle: string;
}): string {
  const subject = `Start experiment: ${normalizeOptionalString(input.protocolTitle) ?? "Murph protocol"}`;
  return buildMurphEmailHref({
    body: input.body,
    subject,
  });
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeExperimentStartProtocolReference(
  input: ExperimentStartProtocolReference,
): ExperimentStartProtocolReference {
  const key = normalizeOptionalString(input.key);
  const pageRevisionId = normalizeOptionalString(input.pageRevisionId);
  const runSpecRevisionId = normalizeOptionalString(input.runSpecRevisionId);

  if (
    !isProtocolVariantKey(key) ||
    !isSha256RevisionId(pageRevisionId) ||
    !isSha256RevisionId(runSpecRevisionId)
  ) {
    throw new Error("Invalid experiment start protocol reference.");
  }

  return { key, pageRevisionId, runSpecRevisionId };
}

function isProtocolVariantKey(value: string | null): value is string {
  return value !== null
    && /^protocol_variant:[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+$/u.test(value);
}

function isSha256RevisionId(value: string | null): value is string {
  return value !== null && /^sha256:[a-f0-9]{64}$/u.test(value);
}
