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
  revnetChainId: number | null;
  revnetPaymentCurrency: string | null;
  revnetPaymentTokenAddress: string | null;
  revnetPaymentTokenDecimals: number | null;
  revnetProjectId: string | null;
  revnetRpcUrl: string | null;
  revnetTerminalAddress: string | null;
  revnetTreasuryPrivateKey: string | null;
  revnetWaitConfirmations: number;
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
  const revnet = readHostedRevnetEnvironment(source);

  if (revnet.enabled && stripeBillingMode !== "subscription") {
    throw new TypeError(
      "HOSTED_ONBOARDING_REVNET_* issuance currently requires HOSTED_ONBOARDING_STRIPE_BILLING_MODE=subscription.",
    );
  }

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
      readEnv(source, ["LINQ_API_BASE_URL"]),
    ) ?? DEFAULT_LINQ_API_BASE_URL,
    linqApiToken: readEnv(source, ["LINQ_API_TOKEN"]),
    linqWebhookSecret: readEnv(source, ["LINQ_WEBHOOK_SECRET"]),
    privyAppId: readEnv(source, ["NEXT_PUBLIC_PRIVY_APP_ID"]),
    privyAppSecret: readEnv(source, ["PRIVY_APP_SECRET"]),
    publicBaseUrl,
    revnetChainId: revnet.chainId,
    revnetPaymentCurrency: revnet.paymentCurrency,
    revnetPaymentTokenAddress: revnet.paymentTokenAddress,
    revnetPaymentTokenDecimals: revnet.paymentTokenDecimals,
    revnetProjectId: revnet.projectId,
    revnetRpcUrl: revnet.rpcUrl,
    revnetTerminalAddress: revnet.terminalAddress,
    revnetTreasuryPrivateKey: revnet.treasuryPrivateKey,
    revnetWaitConfirmations: revnet.waitConfirmations,
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

function normalizeRpcUrl(value: string | null): string | null {
  const normalized = normalizeString(value);

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

function readNonNegativeInteger(value: string | null, fallback: number, label: string): number {
  const parsed = parseInteger(value);

  if (parsed === null) {
    return fallback;
  }

  if (parsed < 0) {
    throw new RangeError(`${label} must be zero or greater.`);
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

function readHostedRevnetEnvironment(source: HostedOnboardingEnvSource): {
  chainId: number | null;
  enabled: boolean;
  paymentCurrency: string | null;
  paymentTokenAddress: string | null;
  paymentTokenDecimals: number | null;
  projectId: string | null;
  rpcUrl: string | null;
  terminalAddress: string | null;
  treasuryPrivateKey: string | null;
  waitConfirmations: number;
} {
  const chainId = readEnv(source, ["HOSTED_ONBOARDING_REVNET_CHAIN_ID"]);
  const projectId = readEnv(source, ["HOSTED_ONBOARDING_REVNET_PROJECT_ID"]);
  const rpcUrl = normalizeRpcUrl(readEnv(source, ["HOSTED_ONBOARDING_REVNET_RPC_URL"]));
  const terminalAddress = readEnv(source, ["HOSTED_ONBOARDING_REVNET_TERMINAL_ADDRESS"]);
  const paymentTokenAddress = readEnv(source, ["HOSTED_ONBOARDING_REVNET_PAYMENT_TOKEN_ADDRESS"]);
  const paymentTokenDecimals = readEnv(source, ["HOSTED_ONBOARDING_REVNET_PAYMENT_TOKEN_DECIMALS"]);
  const paymentCurrency =
    normalizeString(readEnv(source, ["HOSTED_ONBOARDING_REVNET_PAYMENT_CURRENCY"]))?.toLowerCase() ?? null;
  const treasuryPrivateKey = readEnv(source, ["HOSTED_ONBOARDING_REVNET_TREASURY_PRIVATE_KEY"]);
  const waitConfirmations = readNonNegativeInteger(
    readEnv(source, ["HOSTED_ONBOARDING_REVNET_WAIT_CONFIRMATIONS"]),
    1,
    "HOSTED_ONBOARDING_REVNET_WAIT_CONFIRMATIONS",
  );

  const enabled = [
    chainId,
    projectId,
    rpcUrl,
    terminalAddress,
    paymentTokenAddress,
    paymentTokenDecimals,
    paymentCurrency,
    treasuryPrivateKey,
  ].some((value) => Boolean(value));

  if (!enabled) {
    return {
      chainId: null,
      enabled: false,
      paymentCurrency: null,
      paymentTokenAddress: null,
      paymentTokenDecimals: null,
      projectId: null,
      rpcUrl: null,
      terminalAddress: null,
      treasuryPrivateKey: null,
      waitConfirmations,
    };
  }

  const missing = [
    ["HOSTED_ONBOARDING_REVNET_CHAIN_ID", chainId],
    ["HOSTED_ONBOARDING_REVNET_PROJECT_ID", projectId],
    ["HOSTED_ONBOARDING_REVNET_RPC_URL", rpcUrl],
    ["HOSTED_ONBOARDING_REVNET_TERMINAL_ADDRESS", terminalAddress],
    ["HOSTED_ONBOARDING_REVNET_PAYMENT_TOKEN_ADDRESS", paymentTokenAddress],
    ["HOSTED_ONBOARDING_REVNET_PAYMENT_TOKEN_DECIMALS", paymentTokenDecimals],
    ["HOSTED_ONBOARDING_REVNET_PAYMENT_CURRENCY", paymentCurrency],
    ["HOSTED_ONBOARDING_REVNET_TREASURY_PRIVATE_KEY", treasuryPrivateKey],
  ]
    .filter(([, value]) => !value)
    .map(([label]) => label);

  if (missing.length > 0) {
    throw new TypeError(`Hosted RevNet issuance is partially configured. Missing: ${missing.join(", ")}.`);
  }

  return {
    chainId: readPositiveInteger(chainId, 0, "HOSTED_ONBOARDING_REVNET_CHAIN_ID"),
    enabled: true,
    paymentCurrency,
    paymentTokenAddress,
    paymentTokenDecimals: readPositiveInteger(
      paymentTokenDecimals,
      6,
      "HOSTED_ONBOARDING_REVNET_PAYMENT_TOKEN_DECIMALS",
    ),
    projectId,
    rpcUrl,
    terminalAddress,
    treasuryPrivateKey,
    waitConfirmations,
  };
}
