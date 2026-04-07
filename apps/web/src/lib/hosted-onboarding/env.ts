import { decodeHostedEncryptionKey } from "../device-sync/crypto";
import { normalizeNullableString, parseInteger } from "../device-sync/shared";
import { readHostedPublicBaseUrl } from "../hosted-web/public-url";
import { readLinqEnvironment } from "../linq/env";

const HOSTED_CONTACT_PRIVACY_VERSION_PATTERN = /^v[0-9]+$/u;

export interface HostedContactPrivacyKeyring {
  currentVersion: string;
  keysByVersion: Readonly<Record<string, Buffer>>;
  readVersions: readonly string[];
}

export interface HostedOnboardingEnvironment {
  contactPrivacyKeyring: HostedContactPrivacyKeyring;
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
  const publicBaseUrl = readHostedPublicBaseUrl(source);
  const linq = readLinqEnvironment(source as NodeJS.ProcessEnv);

  return {
    contactPrivacyKeyring: readHostedContactPrivacyKeyring(source),
    inviteTtlHours: readPositiveInteger(
      readEnv(source, "HOSTED_ONBOARDING_INVITE_TTL_HOURS"),
      24 * 7,
      "HOSTED_ONBOARDING_INVITE_TTL_HOURS",
    ),
    isProduction: (source.NODE_ENV ?? "development") === "production",
    linqApiBaseUrl: linq.apiBaseUrl,
    linqApiToken: linq.apiToken,
    linqWebhookSecret: linq.webhookSecret,
    linqWebhookTimestampToleranceMs: linq.webhookTimestampToleranceMs,
    privyAppId: readEnv(source, "NEXT_PUBLIC_PRIVY_APP_ID"),
    privyVerificationKey: readEnv(source, "PRIVY_VERIFICATION_KEY"),
    publicBaseUrl,
    stripePriceId: readEnv(source, "HOSTED_ONBOARDING_STRIPE_PRICE_ID"),
    stripeSecretKey: readEnv(source, "STRIPE_SECRET_KEY"),
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

function readEnv(source: HostedOnboardingEnvSource, key: string): string | null {
  return normalizeNullableString(source[key]);
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
