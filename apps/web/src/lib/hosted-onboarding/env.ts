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
  revnetChainId: number | null;
  revnetProjectId: string | null;
  revnetRpcUrl: string | null;
  revnetStripeCurrency: string | null;
  revnetTerminalAddress: string | null;
  revnetTreasuryPrivateKey: string | null;
  revnetWeiPerStripeMinorUnit: string | null;
  stripeBillingMode: "payment" | "subscription";
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
  const stripeBillingMode = readBillingMode(
    readEnv(source, ["HOSTED_ONBOARDING_STRIPE_BILLING_MODE"]),
  );
  const linq = readLinqEnvironment(source as NodeJS.ProcessEnv);
  const revnet = readHostedRevnetEnvironment(source);

  if (revnet.enabled && stripeBillingMode !== "subscription") {
    throw new TypeError(
      "HOSTED_ONBOARDING_REVNET_* issuance currently requires HOSTED_ONBOARDING_STRIPE_BILLING_MODE=subscription.",
    );
  }

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
    revnetChainId: revnet.chainId,
    revnetProjectId: revnet.projectId,
    revnetRpcUrl: revnet.rpcUrl,
    revnetStripeCurrency: revnet.stripeCurrency,
    revnetTerminalAddress: revnet.terminalAddress,
    revnetTreasuryPrivateKey: revnet.treasuryPrivateKey,
    revnetWeiPerStripeMinorUnit: revnet.weiPerStripeMinorUnit,
    stripeBillingMode,
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

function normalizeRpcUrl(value: string | null): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  return new URL(normalized).toString();
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
  const normalized = normalizeNullableString(value) ?? "payment";

  if (normalized !== "payment" && normalized !== "subscription") {
    throw new TypeError("HOSTED_ONBOARDING_STRIPE_BILLING_MODE must be either 'payment' or 'subscription'.");
  }

  return normalized;
}

function readUnsignedIntegerString(value: string | null, label: string): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  if (!/^\d+$/u.test(normalized)) {
    throw new TypeError(`${label} must be an unsigned integer string.`);
  }

  return normalized;
}

function readHostedRevnetEnvironment(source: HostedOnboardingEnvSource): {
  chainId: number | null;
  enabled: boolean;
  projectId: string | null;
  rpcUrl: string | null;
  stripeCurrency: string | null;
  terminalAddress: string | null;
  treasuryPrivateKey: string | null;
  weiPerStripeMinorUnit: string | null;
} {
  const chainId = readEnv(source, ["HOSTED_ONBOARDING_REVNET_CHAIN_ID"]);
  const projectId = readEnv(source, ["HOSTED_ONBOARDING_REVNET_PROJECT_ID"]);
  const rpcUrl = normalizeRpcUrl(readEnv(source, ["HOSTED_ONBOARDING_REVNET_RPC_URL"]));
  const terminalAddress = readEnv(source, ["HOSTED_ONBOARDING_REVNET_TERMINAL_ADDRESS"]);
  const stripeCurrency =
    normalizeNullableString(readEnv(source, ["HOSTED_ONBOARDING_REVNET_STRIPE_CURRENCY"]))?.toLowerCase() ?? null;
  const treasuryPrivateKey = readEnv(source, ["HOSTED_ONBOARDING_REVNET_TREASURY_PRIVATE_KEY"]);
  const weiPerStripeMinorUnit = readUnsignedIntegerString(
    readEnv(source, ["HOSTED_ONBOARDING_REVNET_WEI_PER_STRIPE_MINOR_UNIT"]),
    "HOSTED_ONBOARDING_REVNET_WEI_PER_STRIPE_MINOR_UNIT",
  );

  const enabled = [
    chainId,
    projectId,
    rpcUrl,
    terminalAddress,
    stripeCurrency,
    treasuryPrivateKey,
    weiPerStripeMinorUnit,
  ].some((value) => Boolean(value));

  if (!enabled) {
    return {
      chainId: null,
      enabled: false,
      projectId: null,
      rpcUrl: null,
      stripeCurrency: null,
      terminalAddress: null,
      treasuryPrivateKey: null,
      weiPerStripeMinorUnit: null,
    };
  }

  const missing = [
    ["HOSTED_ONBOARDING_REVNET_CHAIN_ID", chainId],
    ["HOSTED_ONBOARDING_REVNET_PROJECT_ID", projectId],
    ["HOSTED_ONBOARDING_REVNET_RPC_URL", rpcUrl],
    ["HOSTED_ONBOARDING_REVNET_TERMINAL_ADDRESS", terminalAddress],
    ["HOSTED_ONBOARDING_REVNET_STRIPE_CURRENCY", stripeCurrency],
    ["HOSTED_ONBOARDING_REVNET_TREASURY_PRIVATE_KEY", treasuryPrivateKey],
    ["HOSTED_ONBOARDING_REVNET_WEI_PER_STRIPE_MINOR_UNIT", weiPerStripeMinorUnit],
  ]
    .filter(([, value]) => !value)
    .map(([label]) => label);

  if (missing.length > 0) {
    throw new TypeError(`Hosted RevNet issuance is partially configured. Missing: ${missing.join(", ")}.`);
  }

  return {
    chainId: readPositiveInteger(chainId, 0, "HOSTED_ONBOARDING_REVNET_CHAIN_ID"),
    enabled: true,
    projectId,
    rpcUrl,
    stripeCurrency,
    terminalAddress,
    treasuryPrivateKey,
    weiPerStripeMinorUnit,
  };
}
