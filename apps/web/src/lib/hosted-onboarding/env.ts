import {
  readHostedAiUsageBillingMode,
  type HostedAiUsageBillingMode,
} from "@murphai/hosted-execution";

import { decodeHostedEncryptionKey } from "../device-sync/crypto";
import { readHostedPublicBaseUrl } from "../hosted-web/public-url";
import { readLinqEnvironment } from "../linq/env";
import { normalizeNullableString, parseInteger } from "../primitives";
import {
  getHostedBillingPlanDefinition,
  HOSTED_BILLING_PLAN_CODES,
  type HostedBillingPlanCode,
} from "./billing-plans";
import { normalizePhoneNumber } from "./phone";

const HOSTED_CONTACT_PRIVACY_VERSION_PATTERN = /^v[0-9]+$/u;
const DEFAULT_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_DELAYS_MS = [0] as const;
const DEFAULT_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_MODE = "deferred";
const MAX_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_ATTEMPTS = 8;
const MAX_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_DELAY_MS = 30_000;

export type HostedLinqIngressTypingDiagnosticBurstMode = "deferred" | "inline";

export interface HostedContactPrivacyKeyring {
  currentVersion: string;
  keysByVersion: Readonly<Record<string, Buffer>>;
  readVersions: readonly string[];
}

export interface HostedOnboardingEnvironment {
  aiUsageBillingMode: HostedAiUsageBillingMode;
  contactPrivacyKeyring: HostedContactPrivacyKeyring;
  inviteTtlHours: number;
  isProduction: boolean;
  linqApiBaseUrl: string;
  linqApiToken: string | null;
  linqConversationPhoneNumbers: readonly string[];
  linqIngressTypingDiagnosticBurstDelaysMs: readonly number[];
  linqIngressTypingDiagnosticBurstMode: HostedLinqIngressTypingDiagnosticBurstMode;
  linqIngressTypingDiagnosticEnabled: boolean;
  linqIngressTypingDiagnosticTimeoutMs: number;
  linqMaxActiveMembersPerConversationPhone: number | null;
  linqWebhookSecret: string | null;
  linqWebhookTimestampToleranceMs: number;
  privyAppId: string | null;
  privyAppSecret: string | null;
  privyVerificationKey: string | null;
  publicBaseUrl: string | null;
  stripePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
  stripeSecretKey: string | null;
  stripeUsageMeterEventName: string | null;
  stripeUsagePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
  stripeWebhookSecret: string | null;
  telegramBotUsername: string | null;
  telegramWebhookSecret: string | null;
}

type HostedOnboardingEnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedOnboardingEnvironment(
  source: HostedOnboardingEnvSource = process.env,
): HostedOnboardingEnvironment {
  const publicBaseUrl = readHostedPublicBaseUrl(source);
  const linq = readLinqEnvironment(source as NodeJS.ProcessEnv);

  return {
    aiUsageBillingMode: readHostedAiUsageBillingMode(source),
    contactPrivacyKeyring: readHostedContactPrivacyKeyring(source),
    inviteTtlHours: readPositiveInteger(
      readEnv(source, "HOSTED_ONBOARDING_INVITE_TTL_HOURS"),
      24 * 7,
      "HOSTED_ONBOARDING_INVITE_TTL_HOURS",
    ),
    isProduction: (source.NODE_ENV ?? "development") === "production",
    linqApiBaseUrl: linq.apiBaseUrl,
    linqApiToken: linq.apiToken,
    linqConversationPhoneNumbers: readHostedLinqConversationPhoneNumbers(source),
    linqIngressTypingDiagnosticBurstDelaysMs: readLinqIngressTypingDiagnosticBurstDelaysMs(
      readEnv(source, "HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_DELAYS_MS"),
    ),
    linqIngressTypingDiagnosticBurstMode: readLinqIngressTypingDiagnosticBurstMode(
      readEnv(source, "HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_MODE"),
    ),
    linqIngressTypingDiagnosticEnabled: readBoolean(
      readEnv(source, "HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC"),
      false,
    ),
    linqIngressTypingDiagnosticTimeoutMs: readPositiveInteger(
      readEnv(source, "HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC_TIMEOUT_MS"),
      750,
      "HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC_TIMEOUT_MS",
    ),
    linqMaxActiveMembersPerConversationPhone: readPositiveInteger(
      readEnv(source, "HOSTED_ONBOARDING_LINQ_MAX_ACTIVE_MEMBERS_PER_PHONE_NUMBER"),
      1000,
      "HOSTED_ONBOARDING_LINQ_MAX_ACTIVE_MEMBERS_PER_PHONE_NUMBER",
    ),
    linqWebhookSecret: linq.webhookSecret,
    linqWebhookTimestampToleranceMs: linq.webhookTimestampToleranceMs,
    privyAppId: readEnv(source, "NEXT_PUBLIC_PRIVY_APP_ID"),
    privyAppSecret: readEnv(source, "PRIVY_APP_SECRET"),
    privyVerificationKey: readEnv(source, "PRIVY_VERIFICATION_KEY"),
    publicBaseUrl,
    stripePriceIdsByPlan: readHostedStripePriceIdsByPlan(source),
    stripeSecretKey: readEnv(source, "STRIPE_SECRET_KEY"),
    stripeUsageMeterEventName: readEnv(source, "HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME"),
    stripeUsagePriceIdsByPlan: readHostedStripeUsagePriceIdsByPlan(source),
    stripeWebhookSecret: readEnv(source, "STRIPE_WEBHOOK_SECRET"),
    telegramBotUsername: readEnv(source, "TELEGRAM_BOT_USERNAME"),
    telegramWebhookSecret: readEnv(source, "TELEGRAM_WEBHOOK_SECRET"),
  };
}

function readHostedContactPrivacyKeyring(
  source: HostedOnboardingEnvSource,
): HostedContactPrivacyKeyring {
  const keyringValue = readEnv(source, "HOSTED_CONTACT_PRIVACY_KEYS");

  if (!keyringValue) {
    throw new TypeError(
      "HOSTED_CONTACT_PRIVACY_KEYS is required for hosted contact privacy.",
    );
  }

  const entries = keyringValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new TypeError("HOSTED_CONTACT_PRIVACY_KEYS must include at least one version:key entry.");
  }

  const keysByVersion: Record<string, Buffer> = {};
  const readVersions: string[] = [];

  for (const entry of entries) {
    const separatorIndex = entry.indexOf(":");

    if (separatorIndex < 1 || separatorIndex === entry.length - 1) {
      throw new TypeError(
        "HOSTED_CONTACT_PRIVACY_KEYS entries must use the format vN:base64key.",
      );
    }

    const version = entry.slice(0, separatorIndex).trim();
    const encodedKey = entry.slice(separatorIndex + 1).trim();

    if (!HOSTED_CONTACT_PRIVACY_VERSION_PATTERN.test(version)) {
      throw new TypeError(
        `Hosted contact privacy key version ${JSON.stringify(version)} must match /^v[0-9]+$/.`,
      );
    }

    if (Object.prototype.hasOwnProperty.call(keysByVersion, version)) {
      throw new TypeError(`HOSTED_CONTACT_PRIVACY_KEYS must not repeat ${version}.`);
    }

    keysByVersion[version] = decodeHostedEncryptionKey(encodedKey);
    readVersions.push(version);
  }

  const configuredCurrentVersion = readEnv(source, "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION");
  const currentVersion = configuredCurrentVersion ?? (
    readVersions.length === 1 ? readVersions[0] : null
  );

  if (!currentVersion) {
    throw new TypeError(
      "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION is required when HOSTED_CONTACT_PRIVACY_KEYS defines multiple versions.",
    );
  }

  if (!Object.prototype.hasOwnProperty.call(keysByVersion, currentVersion)) {
    throw new TypeError(
      `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION ${JSON.stringify(currentVersion)} is not present in HOSTED_CONTACT_PRIVACY_KEYS.`,
    );
  }

  return {
    currentVersion,
    keysByVersion,
    readVersions: [
      currentVersion,
      ...readVersions.filter((version) => version !== currentVersion),
    ],
  };
}

function readHostedLinqConversationPhoneNumbers(
  source: HostedOnboardingEnvSource,
): string[] {
  const configured = readEnv(source, "HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS");

  if (!configured) {
    return [];
  }

  const values = configured
    .split(/[\n,]+/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const recipientPhones: string[] = [];

  for (const value of values) {
    const recipientPhone = normalizePhoneNumber(value);

    if (!recipientPhone) {
      throw new TypeError(
        `HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS contains an invalid phone number: ${JSON.stringify(value)}.`,
      );
    }

    if (!recipientPhones.includes(recipientPhone)) {
      recipientPhones.push(recipientPhone);
    }
  }

  return recipientPhones;
}

function readEnv(source: HostedOnboardingEnvSource, key: string): string | null {
  return normalizeNullableString(source[key]);
}

function readBoolean(value: string | null, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }

  return fallback;
}

function readHostedStripePriceIdsByPlan(
  source: HostedOnboardingEnvSource,
): Record<HostedBillingPlanCode, string | null> {
  return readHostedStripePriceIdsByEnvKey(source, (definition) => definition.priceIdEnvKey);
}

function readHostedStripeUsagePriceIdsByPlan(
  source: HostedOnboardingEnvSource,
): Record<HostedBillingPlanCode, string | null> {
  return readHostedStripePriceIdsByEnvKey(source, (definition) => definition.usagePriceIdEnvKey);
}

function readHostedStripePriceIdsByEnvKey(
  source: HostedOnboardingEnvSource,
  selectEnvKey: (definition: ReturnType<typeof getHostedBillingPlanDefinition>) => string,
): Record<HostedBillingPlanCode, string | null> {
  return Object.fromEntries(
    HOSTED_BILLING_PLAN_CODES.map((code) => {
      const definition = getHostedBillingPlanDefinition(code);
      return [code, readEnv(source, selectEnvKey(definition))];
    }),
  ) as Record<HostedBillingPlanCode, string | null>;
}

function readPositiveInteger(value: string | null, fallback: number, label: string): number {
  const parsed = parseInteger(value);

  if (parsed === null) {
    return fallback;
  }

  if (parsed < 1) {
    throw new RangeError(`${label} must be greater than zero.`);
  }

  return parsed;
}

function readLinqIngressTypingDiagnosticBurstDelaysMs(
  value: string | null,
): readonly number[] {
  if (!value) {
    return DEFAULT_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_DELAYS_MS;
  }

  const rawEntries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (rawEntries.length === 0) {
    return DEFAULT_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_DELAYS_MS;
  }

  const delays = new Set<number>([0]);

  for (const entry of rawEntries) {
    if (!/^[0-9]+$/u.test(entry)) {
      throw new TypeError(
        "HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_DELAYS_MS must be a comma-separated list of non-negative millisecond delays.",
      );
    }

    const parsed = parseInteger(entry);

    if (parsed === null) {
      throw new TypeError(
        "HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_DELAYS_MS must be a comma-separated list of non-negative millisecond delays.",
      );
    }

    if (parsed > MAX_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_DELAY_MS) {
      throw new RangeError(
        "HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_DELAYS_MS entries must be at most 30000.",
      );
    }

    delays.add(parsed);
  }

  if (delays.size > MAX_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_ATTEMPTS) {
    throw new RangeError(
      "HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_DELAYS_MS must not include more than 8 delays.",
    );
  }

  return Array.from(delays).sort((left, right) => left - right);
}

function readLinqIngressTypingDiagnosticBurstMode(
  value: string | null,
): HostedLinqIngressTypingDiagnosticBurstMode {
  if (!value) {
    return DEFAULT_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_MODE;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "deferred" || normalized === "inline") {
    return normalized;
  }

  throw new TypeError(
    "HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC_BURST_MODE must be deferred or inline.",
  );
}
