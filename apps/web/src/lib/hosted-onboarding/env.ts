import { decodeHostedEncryptionKey } from "../device-sync/crypto";
import { normalizeNullableString, parseInteger } from "../device-sync/shared";
import { readHostedPublicBaseUrl } from "../hosted-web/public-url";
import { readLinqEnvironment } from "../linq/env";

export interface HostedOnboardingEnvironment {
  contactPrivacyKey: Buffer;
  inviteTtlHours: number;
  isProduction: boolean;
  linqApiBaseUrl: string;
  linqApiToken: string | null;
  linqWebhookSecret: string | null;
  linqWebhookTimestampToleranceMs: number;
  privyAppId: string | null;
  privyVerificationKey: string | null;
  publicBaseUrl: string | null;
  stripePriceId: string | null;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  telegramBotUsername: string | null;
  telegramWebhookSecret: string | null;
}

type HostedOnboardingEnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedOnboardingEnvironment(
  source: HostedOnboardingEnvSource = process.env,
): HostedOnboardingEnvironment {
  const contactPrivacyKeyValue = readEnv(source, ["HOSTED_CONTACT_PRIVACY_KEY"]);

  if (!contactPrivacyKeyValue) {
    throw new TypeError("HOSTED_CONTACT_PRIVACY_KEY is required for hosted contact privacy.");
  }

  const publicBaseUrl = readHostedPublicBaseUrl(source);
  const linq = readLinqEnvironment(source as NodeJS.ProcessEnv);

  return {
    contactPrivacyKey: decodeHostedEncryptionKey(contactPrivacyKeyValue),
    inviteTtlHours: readPositiveInteger(
      readEnv(source, ["HOSTED_ONBOARDING_INVITE_TTL_HOURS"]),
      24 * 7,
      "HOSTED_ONBOARDING_INVITE_TTL_HOURS",
    ),
    isProduction: (source.NODE_ENV ?? "development") === "production",
    linqApiBaseUrl: linq.apiBaseUrl,
    linqApiToken: linq.apiToken,
    linqWebhookSecret: linq.webhookSecret,
    linqWebhookTimestampToleranceMs: linq.webhookTimestampToleranceMs,
    privyAppId: readEnv(source, ["NEXT_PUBLIC_PRIVY_APP_ID"]),
    privyVerificationKey: readEnv(source, ["PRIVY_VERIFICATION_KEY"]),
    publicBaseUrl,
    stripePriceId: readEnv(source, ["HOSTED_ONBOARDING_STRIPE_PRICE_ID"]),
    stripeSecretKey: readEnv(source, ["STRIPE_SECRET_KEY"]),
    stripeWebhookSecret: readEnv(source, ["STRIPE_WEBHOOK_SECRET"]),
    telegramBotUsername: readEnv(source, ["TELEGRAM_BOT_USERNAME"]),
    telegramWebhookSecret: readEnv(source, ["TELEGRAM_WEBHOOK_SECRET"]),
  };
}

function readEnv(source: HostedOnboardingEnvSource, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = normalizeNullableString(source[key]);

    if (value) {
      return value;
    }
  }

  return null;
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
