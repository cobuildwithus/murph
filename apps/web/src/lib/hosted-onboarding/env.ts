import { readHostedPublicBaseUrl } from "../hosted-web/public-url";
import { readLinqEnvironment } from "../linq/env";
import { normalizeMurphTelegramUsername } from "../murph-contact-routing";
import { normalizeNullableString, parseInteger } from "../primitives";
import {
  getHostedBillingPlanDefinition,
  getHostedFamilyBillingOfferDefinition,
  HOSTED_BILLING_PLAN_CODES,
  HOSTED_FAMILY_PLAN_CODES,
  type HostedBillingPlanCode,
  type HostedFamilyPlanCode,
} from "./billing-plans";
import { normalizePhoneNumber } from "./phone";
import {
  getHostedUsageCreditOfferDefinition,
  HOSTED_USAGE_CREDIT_OFFER_CODES,
  type HostedUsageCreditOfferCode,
} from "./usage-credit-offers";

const HOSTED_CONTACT_PRIVACY_VERSION_PATTERN = /^v[0-9]+$/u;
const HOSTED_CONTACT_PRIVACY_KEY_BASE64_CANONICAL_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export interface HostedContactPrivacyKeyring {
  currentVersion: string;
  keysByVersion: Readonly<Record<string, Buffer>>;
  readVersions: readonly string[];
}

export type HostedLinqFirstContactAdmissionMode = "enforce" | "off";

const DEFAULT_HOSTED_LINQ_FIRST_CONTACT_ADMISSION_MODEL = "gpt-5.6-luna";
const DEFAULT_HOSTED_LINQ_INSTANT_START_PHONE_PREFIXES = [
  // North America. This is intentionally the full NANP, not US/Canada-only.
  "+1",
  // Europe.
  "+30",
  "+31",
  "+32",
  "+33",
  "+34",
  "+351",
  "+352",
  "+353",
  "+354",
  "+356",
  "+357",
  "+358",
  "+359",
  "+36",
  "+370",
  "+371",
  "+372",
  "+376",
  "+377",
  "+378",
  "+385",
  "+386",
  "+39",
  "+40",
  "+41",
  "+420",
  "+421",
  "+423",
  "+43",
  "+44",
  "+45",
  "+46",
  "+47",
  "+48",
  "+49",
  // Asia-Pacific.
  "+61",
  "+64",
  "+65",
  "+673",
  "+81",
  "+82",
  "+852",
  "+853",
  "+886",
  // Middle East.
  "+965",
  "+966",
  "+968",
  "+971",
  "+972",
  "+973",
  "+974",
  // Latin America.
  "+56",
  "+598",
] as const;
const HOSTED_LINQ_INSTANT_START_PHONE_PREFIX_PATTERN = /^\+[1-9]\d{0,5}$/u;

export interface HostedOnboardingEnvironment {
  allowedMutationOrigins?: readonly string[];
  contactPrivacyKeyring: HostedContactPrivacyKeyring;
  inviteTtlHours: number;
  isProduction: boolean;
  linqApiBaseUrl: string;
  linqApiToken: string | null;
  linqConversationPhoneNumbers: readonly string[];
  linqFirstContactAdmissionMode: HostedLinqFirstContactAdmissionMode;
  linqFirstContactAdmissionModel: string;
  linqFirstContactAdmissionOpenAiApiKey: string | null;
  linqInstantStartPhonePrefixes: readonly string[];
  linqLocalAllowedInboundPhoneNumbers?: readonly string[];
  /**
   * @deprecated Rollback compatibility for application builds that still
   * populate HostedLinqLine.activeMemberLimit. Weighted assignment does not
   * read this value.
   */
  linqMaxActiveMembersPerConversationPhone: number | null;
  linqWebhookSecret: string | null;
  linqWebhookTimestampToleranceMs: number;
  privyAppId: string | null;
  privyAppSecret: string | null;
  privyVerificationKey: string | null;
  publicBaseUrl: string | null;
  stripePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
  stripeFamilyPriceIdsByPlan: Readonly<
    Record<HostedFamilyPlanCode, string | null>
  >;
  stripeUsageCreditPriceIdsByOffer: Readonly<
    Record<HostedUsageCreditOfferCode, string | null>
  >;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  telegramBotToken: string | null;
  telegramBotUsername: string | null;
  telegramWebhookSecret: string | null;
}

type HostedOnboardingEnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedOnboardingEnvironment(
  source: HostedOnboardingEnvSource = process.env,
): HostedOnboardingEnvironment {
  const publicBaseUrl = readHostedPublicBaseUrl(source);
  const linq = readLinqEnvironment(source as NodeJS.ProcessEnv);
  const isProduction = (source.NODE_ENV ?? "development") === "production";

  return {
    allowedMutationOrigins: readHostedOnboardingAllowedMutationOrigins(source, isProduction),
    contactPrivacyKeyring: readHostedContactPrivacyKeyring(source),
    inviteTtlHours: readPositiveInteger(
      readEnv(source, "HOSTED_ONBOARDING_INVITE_TTL_HOURS"),
      24 * 7,
      "HOSTED_ONBOARDING_INVITE_TTL_HOURS",
    ),
    isProduction,
    linqApiBaseUrl: linq.apiBaseUrl,
    linqApiToken: linq.apiToken,
    linqConversationPhoneNumbers: readHostedLinqConversationPhoneNumbers(source),
    linqFirstContactAdmissionMode: readHostedLinqFirstContactAdmissionMode(source),
    linqFirstContactAdmissionModel:
      readEnv(source, "HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_MODEL")
      ?? DEFAULT_HOSTED_LINQ_FIRST_CONTACT_ADMISSION_MODEL,
    linqFirstContactAdmissionOpenAiApiKey:
      readEnv(source, "HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_OPENAI_API_KEY")
      ?? readEnv(source, "OPENAI_API_KEY"),
    linqInstantStartPhonePrefixes:
      readHostedLinqInstantStartPhonePrefixes(source),
    linqLocalAllowedInboundPhoneNumbers:
      readHostedLinqLocalAllowedInboundPhoneNumbers(source, isProduction),
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
    stripeFamilyPriceIdsByPlan: readHostedStripeFamilyPriceIdsByPlan(source),
    stripePriceIdsByPlan: readHostedStripePriceIdsByPlan(source),
    stripeUsageCreditPriceIdsByOffer: readHostedStripeUsageCreditPriceIdsByOffer(source),
    stripeSecretKey: readEnv(source, "STRIPE_SECRET_KEY"),
    stripeWebhookSecret: readEnv(source, "STRIPE_WEBHOOK_SECRET"),
    telegramBotToken: readEnv(source, "TELEGRAM_BOT_TOKEN"),
    telegramBotUsername: readHostedTelegramBotUsername(source),
    telegramWebhookSecret: readEnv(source, "TELEGRAM_WEBHOOK_SECRET"),
  };
}


function readHostedTelegramBotUsername(
  source: HostedOnboardingEnvSource,
): string | null {
  return normalizeMurphTelegramUsername(readEnv(source, "MURPH_TELEGRAM_USERNAME_OVERRIDE"))
    ?? normalizeMurphTelegramUsername(readEnv(source, "TELEGRAM_BOT_USERNAME"));
}

function readHostedOnboardingAllowedMutationOrigins(
  source: HostedOnboardingEnvSource,
  isProduction: boolean,
): string[] {
  const configured = readEnv(source, "HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS");

  if (!configured) {
    return [];
  }

  const origins: string[] = [];

  for (const value of configured.split(/[\n,]+/u)) {
    const origin = normalizeHostedOnboardingMutationOrigin(value, isProduction);

    if (origin && !origins.includes(origin)) {
      origins.push(origin);
    }
  }

  return origins;
}

function normalizeHostedOnboardingMutationOrigin(
  value: string,
  isProduction: boolean,
): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(normalized);
  } catch {
    throw new TypeError(
      `HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS contains an invalid origin: ${JSON.stringify(normalized)}.`,
    );
  }

  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const isHttpsOrigin = protocol === "https:";
  const isLoopbackOrigin = isLoopbackHost(hostname);
  const isHttpLoopbackOrigin = protocol === "http:" && isLoopbackOrigin;

  if (!isHttpsOrigin && !isHttpLoopbackOrigin) {
    throw new TypeError(
      "HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS entries must be HTTPS origins or HTTP loopback origins for local development.",
    );
  }

  if (isProduction && isLoopbackOrigin) {
    throw new TypeError(
      "HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS must not include loopback origins in production.",
    );
  }

  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError(
      "HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS entries must be origins without credentials, paths, queries, or fragments.",
    );
  }

  return url.origin;
}

function isLoopbackHost(hostname: string): boolean {
  const normalizedHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  if (normalizedHostname === "localhost" || normalizedHostname === "::1") {
    return true;
  }

  const ipv4Parts = normalizedHostname.split(".");
  return ipv4Parts.length === 4
    && ipv4Parts.every((part) => /^[0-9]+$/u.test(part))
    && Number(ipv4Parts[0]) === 127
    && ipv4Parts.every((part) => Number(part) >= 0 && Number(part) <= 255);
}

export function readHostedContactPrivacyKeyring(
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

    keysByVersion[version] = decodeHostedContactPrivacyKey(encodedKey);
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

function decodeHostedContactPrivacyKey(value: string): Buffer {
  const normalized = value.trim();

  if (!normalized) {
    throw new TypeError("Hosted contact privacy key must not be empty.");
  }

  if (/^[0-9a-f]{64}$/iu.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  const decoded = decodeStrictHostedContactPrivacyBase64(
    normalizeHostedContactPrivacyBase64(normalized),
  );

  if (decoded.length !== 32) {
    throw new TypeError(
      "Hosted contact privacy key must decode to exactly 32 bytes (hex or base64/base64url).",
    );
  }

  return decoded;
}

function normalizeHostedContactPrivacyBase64(value: string): string {
  const normalized = value.trim().replace(/-/gu, "+").replace(/_/gu, "/");
  const remainder = normalized.length % 4;

  if (remainder === 0) {
    return normalized;
  }

  return normalized.padEnd(normalized.length + (4 - remainder), "=");
}

function decodeStrictHostedContactPrivacyBase64(value: string): Buffer {
  const normalized = value.trim();

  if (
    normalized.length === 0
    || normalized.length % 4 !== 0
    || !HOSTED_CONTACT_PRIVACY_KEY_BASE64_CANONICAL_PATTERN.test(normalized)
  ) {
    throw new TypeError(
      "Hosted contact privacy key must decode to exactly 32 bytes (hex or base64/base64url).",
    );
  }

  const decoded = Buffer.from(normalized, "base64");

  if (decoded.toString("base64") !== normalized) {
    throw new TypeError(
      "Hosted contact privacy key must decode to exactly 32 bytes (hex or base64/base64url).",
    );
  }

  return decoded;
}

function readHostedLinqConversationPhoneNumbers(
  source: HostedOnboardingEnvSource,
): string[] {
  const configured = readEnv(source, "HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS");

  if (!configured) {
    return [];
  }

  return readHostedLinqPhoneNumberList(
    configured,
    "HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS",
    false,
  );
}

function readHostedLinqLocalAllowedInboundPhoneNumbers(
  source: HostedOnboardingEnvSource,
  isProduction: boolean,
): string[] | undefined {
  const configured = readEnv(source, "HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS");

  if (!configured) {
    return undefined;
  }

  if (isProduction) {
    throw new TypeError(
      "HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS is local-development only and must not be configured in production.",
    );
  }

  return readHostedLinqPhoneNumberList(
    configured,
    "HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS",
    false,
  );
}

function readHostedLinqFirstContactAdmissionMode(
  source: HostedOnboardingEnvSource,
): HostedLinqFirstContactAdmissionMode {
  const configured = readEnv(source, "HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_MODE");
  if (!configured) {
    return "off";
  }

  const normalized = configured.trim().toLowerCase();
  if (normalized === "enforce" || normalized === "off") {
    return normalized;
  }

  throw new TypeError(
    "HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_MODE must be either \"off\" or \"enforce\".",
  );
}

export function parseHostedLinqInstantStartPhonePrefixes(
  configured: string | null | undefined,
): string[] {
  const values = configured?.trim()
    ? configured.split(/[\n,]+/u)
    : [...DEFAULT_HOSTED_LINQ_INSTANT_START_PHONE_PREFIXES];
  const prefixes: string[] = [];

  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) {
      continue;
    }
    if (!HOSTED_LINQ_INSTANT_START_PHONE_PREFIX_PATTERN.test(value)) {
      throw new TypeError(
        "HOSTED_ONBOARDING_LINQ_INSTANT_START_PHONE_PREFIXES must contain comma-separated E.164 phone prefixes.",
      );
    }
    if (!prefixes.includes(value)) {
      prefixes.push(value);
    }
  }

  if (prefixes.length === 0) {
    return [...DEFAULT_HOSTED_LINQ_INSTANT_START_PHONE_PREFIXES];
  }

  return prefixes.sort((left, right) =>
    right.length - left.length || left.localeCompare(right)
  );
}

function readHostedLinqInstantStartPhonePrefixes(
  source: HostedOnboardingEnvSource,
): string[] {
  return parseHostedLinqInstantStartPhonePrefixes(
    readEnv(source, "HOSTED_ONBOARDING_LINQ_INSTANT_START_PHONE_PREFIXES"),
  );
}

function readHostedLinqPhoneNumberList(
  configured: string,
  envName: string,
  includeInvalidValue: boolean,
): string[] {
  const values = configured
    .split(/[\n,]+/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const recipientPhones: string[] = [];

  for (const value of values) {
    const recipientPhone = normalizePhoneNumber(value);

    if (!recipientPhone) {
      const suffix = includeInvalidValue ? `: ${JSON.stringify(value)}` : "";
      throw new TypeError(`${envName} contains an invalid phone number${suffix}.`);
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

function readHostedStripePriceIdsByPlan(
  source: HostedOnboardingEnvSource,
): Record<HostedBillingPlanCode, string | null> {
  return readHostedStripePriceIdsByEnvKey(source, (definition) => definition.priceIdEnvKey);
}

function readHostedStripeFamilyPriceIdsByPlan(
  source: HostedOnboardingEnvSource,
): Record<HostedFamilyPlanCode, string | null> {
  return Object.fromEntries(
    HOSTED_FAMILY_PLAN_CODES.map((planCode) => {
      const offer = getHostedFamilyBillingOfferDefinition(planCode);
      return [planCode, readEnv(source, offer.priceIdEnvKey)];
    }),
  ) as Record<HostedFamilyPlanCode, string | null>;
}

function readHostedStripeUsageCreditPriceIdsByOffer(
  source: HostedOnboardingEnvSource,
): Record<HostedUsageCreditOfferCode, string | null> {
  return Object.fromEntries(
    HOSTED_USAGE_CREDIT_OFFER_CODES.map((offerCode) => {
      const offer = getHostedUsageCreditOfferDefinition(offerCode);
      return [offerCode, readEnv(source, offer.priceIdEnvKey)];
    }),
  ) as Record<HostedUsageCreditOfferCode, string | null>;
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
