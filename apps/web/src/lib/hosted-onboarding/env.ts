import { decodeHostedEncryptionKey } from "../device-sync/crypto";
import { normalizeString, parseInteger } from "../device-sync/shared";

export interface HostedOnboardingEnvironment {
  encryptionKey: Buffer;
  encryptionKeyVersion: string;
  inviteTtlHours: number;
  isProduction: boolean;
  linqApiBaseUrl: string;
  linqApiToken: string | null;
  linqWebhookSecret: string | null;
  privyAppId: string | null;
  privyAppSecret: string | null;
  publicBaseUrl: string | null;
  sessionCookieName: string;
  sessionTtlDays: number;
  stripeBillingMode: "payment" | "subscription";
  stripePriceId: string | null;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
}

const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
type HostedOnboardingEnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedOnboardingEnvironment(
  source: HostedOnboardingEnvSource = process.env,
): HostedOnboardingEnvironment {
  const encryptionKey = readEnv(source, ["DEVICE_SYNC_ENCRYPTION_KEY"]);
  const encryptionKeyVersion = readEnv(source, ["DEVICE_SYNC_ENCRYPTION_KEY_VERSION"]) ?? "v1";

  if (!encryptionKey) {
    throw new TypeError("DEVICE_SYNC_ENCRYPTION_KEY is required for hosted onboarding secrets.");
  }

  const publicBaseUrl = normalizeBaseUrl(
    readEnv(source, ["HOSTED_ONBOARDING_PUBLIC_BASE_URL", "NEXT_PUBLIC_SITE_URL"]),
  );
  const stripeBillingMode = readBillingMode(
    readEnv(source, ["HOSTED_ONBOARDING_STRIPE_BILLING_MODE"]),
  );

  return {
    encryptionKey: decodeHostedEncryptionKey(encryptionKey),
    encryptionKeyVersion,
    inviteTtlHours: readPositiveInteger(
      readEnv(source, ["HOSTED_ONBOARDING_INVITE_TTL_HOURS"]),
      24 * 7,
      "HOSTED_ONBOARDING_INVITE_TTL_HOURS",
    ),
    isProduction: (source.NODE_ENV ?? "development") === "production",
    linqApiBaseUrl: normalizeBaseUrl(
      readEnv(source, ["LINQ_API_BASE_URL", "HEALTHYBOB_LINQ_API_BASE_URL"]),
    ) ?? DEFAULT_LINQ_API_BASE_URL,
    linqApiToken: readEnv(source, ["LINQ_API_TOKEN", "HEALTHYBOB_LINQ_API_TOKEN"]),
    linqWebhookSecret: readEnv(source, ["LINQ_WEBHOOK_SECRET", "HEALTHYBOB_LINQ_WEBHOOK_SECRET"]),
    privyAppId: readEnv(source, ["NEXT_PUBLIC_PRIVY_APP_ID"]),
    privyAppSecret: readEnv(source, ["PRIVY_APP_SECRET"]),
    publicBaseUrl,
    sessionCookieName: readEnv(source, ["HOSTED_ONBOARDING_SESSION_COOKIE_NAME"]) ?? "hb_hosted_session",
    sessionTtlDays: readPositiveInteger(
      readEnv(source, ["HOSTED_ONBOARDING_SESSION_TTL_DAYS"]),
      30,
      "HOSTED_ONBOARDING_SESSION_TTL_DAYS",
    ),
    stripeBillingMode,
    stripePriceId: readEnv(source, ["HOSTED_ONBOARDING_STRIPE_PRICE_ID"]),
    stripeSecretKey: readEnv(source, ["STRIPE_SECRET_KEY"]),
    stripeWebhookSecret: readEnv(source, ["STRIPE_WEBHOOK_SECRET"]),
  };
}

function readEnv(source: HostedOnboardingEnvSource, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = normalizeString(source[key]);

    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeBaseUrl(value: string | null): string | null {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  const url = new URL(normalized);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/u, "");
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

function readBillingMode(value: string | null): "payment" | "subscription" {
  const normalized = normalizeString(value) ?? "payment";

  if (normalized !== "payment" && normalized !== "subscription") {
    throw new TypeError("HOSTED_ONBOARDING_STRIPE_BILLING_MODE must be either 'payment' or 'subscription'.");
  }

  return normalized;
}
