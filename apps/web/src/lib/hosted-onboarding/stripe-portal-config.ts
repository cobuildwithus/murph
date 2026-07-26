import { hostedOnboardingError } from "./errors";

export const HOSTED_STRIPE_PORTAL_CONFIGURATION_ENV_KEYS = {
  family: "HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID",
  member: "HOSTED_ONBOARDING_STRIPE_MEMBER_PORTAL_CONFIGURATION_ID",
  payment_recovery:
    "HOSTED_ONBOARDING_STRIPE_PAYMENT_RECOVERY_PORTAL_CONFIGURATION_ID",
} as const;

export type HostedStripePortalConfigurationKind =
  keyof typeof HOSTED_STRIPE_PORTAL_CONFIGURATION_ENV_KEYS;

export type HostedStripePortalConfigurationIds = Readonly<
  Record<HostedStripePortalConfigurationKind, string | null>
>;

type HostedStripePortalEnvSource =
  Readonly<Record<string, string | undefined>>;

export function readHostedStripePortalConfigurationIds(
  source: HostedStripePortalEnvSource = process.env,
): HostedStripePortalConfigurationIds {
  return {
    family: readNullablePortalEnvironmentValue(
      source,
      HOSTED_STRIPE_PORTAL_CONFIGURATION_ENV_KEYS.family,
    ),
    member: readNullablePortalEnvironmentValue(
      source,
      HOSTED_STRIPE_PORTAL_CONFIGURATION_ENV_KEYS.member,
    ),
    payment_recovery: readNullablePortalEnvironmentValue(
      source,
      HOSTED_STRIPE_PORTAL_CONFIGURATION_ENV_KEYS.payment_recovery,
    ),
  };
}

export function assertHostedStripePortalConfigurationsForDeployment(input: {
  configurationIds: HostedStripePortalConfigurationIds;
  isDeployedRuntime: boolean;
}): void {
  if (!input.isDeployedRuntime) {
    return;
  }

  const missingEnvKeys = (
    Object.keys(HOSTED_STRIPE_PORTAL_CONFIGURATION_ENV_KEYS) as
      HostedStripePortalConfigurationKind[]
  ).flatMap((kind) =>
    isHostedStripePortalConfigurationId(input.configurationIds[kind])
      ? []
      : [HOSTED_STRIPE_PORTAL_CONFIGURATION_ENV_KEYS[kind]]
  );

  if (missingEnvKeys.length === 0) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_PORTAL_CONFIGURATIONS_REQUIRED",
    details: {
      envKeys: missingEnvKeys,
    },
    httpStatus: 500,
    message:
      "Every Stripe Billing Portal configuration must be explicit in deployed environments.",
    retryable: false,
  });
}

export function isHostedStripePortalConfigurationId(
  value: string | null,
): value is string {
  return typeof value === "string" && /^bpc_[A-Za-z0-9]+$/u.test(value);
}

export function readHostedStripeSecretKeyLiveMode(
  secretKey: string | null,
): boolean {
  if (secretKey?.startsWith("sk_live_") || secretKey?.startsWith("rk_live_")) {
    return true;
  }

  if (secretKey?.startsWith("sk_test_") || secretKey?.startsWith("rk_test_")) {
    return false;
  }

  throw hostedOnboardingError({
    code: "STRIPE_SECRET_KEY_MODE_INVALID",
    message: "STRIPE_SECRET_KEY must identify a Stripe test or live environment.",
    httpStatus: 500,
  });
}

function readNullablePortalEnvironmentValue(
  source: HostedStripePortalEnvSource,
  key: string,
): string | null {
  const value = source[key]?.trim();
  return value ? value : null;
}
