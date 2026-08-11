export const HOSTED_STRIPE_BILLING_LIVE_SCENARIO =
  "stripe-billing-browser-matrix" as const;

export const HOSTED_STRIPE_BILLING_LIVE_ENABLED_ENV =
  "MURPH_HOSTED_STRIPE_BILLING_LIVE";
export const HOSTED_STRIPE_BILLING_SECRET_KEY_ENV =
  "MURPH_HOSTED_STRIPE_BILLING_SECRET_KEY";
export const HOSTED_STRIPE_BILLING_ACCOUNT_ID_ENV =
  "MURPH_HOSTED_STRIPE_BILLING_ACCOUNT_ID";
export const HOSTED_STRIPE_BILLING_RUN_ID_ENV =
  "MURPH_HOSTED_STRIPE_BILLING_RUN_ID";
export const HOSTED_STRIPE_BILLING_PRIVY_APP_ID_ENV =
  "NEXT_PUBLIC_PRIVY_APP_ID";

export const HOSTED_STRIPE_BILLING_PRICE_ENV_KEYS = [
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY",
] as const;
export const HOSTED_STRIPE_BILLING_PORTAL_CONFIGURATION_ENV_KEY =
  "HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_EDGE_MONTHLY";

export const HOSTED_STRIPE_BILLING_LIVE_ENV_KEYS = [
  HOSTED_STRIPE_BILLING_LIVE_ENABLED_ENV,
  HOSTED_STRIPE_BILLING_SECRET_KEY_ENV,
  HOSTED_STRIPE_BILLING_ACCOUNT_ID_ENV,
  HOSTED_STRIPE_BILLING_RUN_ID_ENV,
  ...HOSTED_STRIPE_BILLING_PRICE_ENV_KEYS,
  HOSTED_STRIPE_BILLING_PORTAL_CONFIGURATION_ENV_KEY,
] as const;

const HOSTED_STRIPE_BILLING_DEDICATED_ENV_KEYS = [
  HOSTED_STRIPE_BILLING_SECRET_KEY_ENV,
  HOSTED_STRIPE_BILLING_ACCOUNT_ID_ENV,
  HOSTED_STRIPE_BILLING_RUN_ID_ENV,
] as const;

export interface HostedStripeBillingLiveConfig {
  accountId: string;
  privyAppId: string;
  priceIds: {
    edge: string;
    familyEdge: string;
    familyMax: string;
    familyPulse: string;
    pulse: string;
  };
  portalConfigurationId: string;
  runId: string;
  secretKey: string;
}

export type HostedStripeBillingLiveConfigResolution =
  | {
      configured: false;
      reason: "not_enabled";
    }
  | {
      configured: true;
      config: HostedStripeBillingLiveConfig;
    };

export class HostedStripeBillingLiveConfigError extends Error {
  readonly code: "malformed" | "partial";
  readonly fields: readonly string[];

  constructor(input: {
    code: "malformed" | "partial";
    fields: readonly string[];
    message: string;
  }) {
    super(input.message);
    this.name = "HostedStripeBillingLiveConfigError";
    this.code = input.code;
    this.fields = [...input.fields];
  }
}

export function resolveHostedStripeBillingLiveConfig(
  environment: NodeJS.ProcessEnv,
): HostedStripeBillingLiveConfigResolution {
  const enabled = normalize(environment[HOSTED_STRIPE_BILLING_LIVE_ENABLED_ENV]);
  const configuredDedicatedFields = HOSTED_STRIPE_BILLING_DEDICATED_ENV_KEYS
    .filter((key) => normalize(environment[key]) !== null);

  if (enabled === null || enabled === "0") {
    if (configuredDedicatedFields.length > 0) {
      throw new HostedStripeBillingLiveConfigError({
        code: "partial",
        fields: configuredDedicatedFields,
        message: [
          `${HOSTED_STRIPE_BILLING_LIVE_ENABLED_ENV}=1 is required when `
            + "dedicated Stripe sandbox configuration is present.",
          `Configured fields: ${configuredDedicatedFields.join(", ")}.`,
        ].join(" "),
      });
    }
    return { configured: false, reason: "not_enabled" };
  }

  if (enabled !== "1") {
    throw new HostedStripeBillingLiveConfigError({
      code: "malformed",
      fields: [HOSTED_STRIPE_BILLING_LIVE_ENABLED_ENV],
      message: `${HOSTED_STRIPE_BILLING_LIVE_ENABLED_ENV} must be exactly 0, 1, or unset.`,
    });
  }

  const required = [
    HOSTED_STRIPE_BILLING_SECRET_KEY_ENV,
    HOSTED_STRIPE_BILLING_ACCOUNT_ID_ENV,
    HOSTED_STRIPE_BILLING_RUN_ID_ENV,
    HOSTED_STRIPE_BILLING_PRIVY_APP_ID_ENV,
    ...HOSTED_STRIPE_BILLING_PRICE_ENV_KEYS,
    HOSTED_STRIPE_BILLING_PORTAL_CONFIGURATION_ENV_KEY,
  ] as const;
  const missing = required.filter((key) => normalize(environment[key]) === null);
  if (missing.length > 0) {
    throw new HostedStripeBillingLiveConfigError({
      code: "partial",
      fields: missing,
      message: `Dedicated Stripe sandbox configuration is incomplete. Missing fields: ${missing.join(", ")}.`,
    });
  }

  const secretKey = requireNormalized(environment, HOSTED_STRIPE_BILLING_SECRET_KEY_ENV);
  const accountId = requireNormalized(environment, HOSTED_STRIPE_BILLING_ACCOUNT_ID_ENV);
  const privyAppId = requireNormalized(
    environment,
    HOSTED_STRIPE_BILLING_PRIVY_APP_ID_ENV,
  );
  const malformed: string[] = [];
  if (!/^(?:sk|rk)_test_[A-Za-z0-9_]+$/u.test(secretKey)) {
    malformed.push(HOSTED_STRIPE_BILLING_SECRET_KEY_ENV);
  }
  if (!/^acct_[A-Za-z0-9]+$/u.test(accountId)) {
    malformed.push(HOSTED_STRIPE_BILLING_ACCOUNT_ID_ENV);
  }
  if (!/^[A-Za-z0-9_-]{25}$/u.test(privyAppId)) {
    malformed.push(HOSTED_STRIPE_BILLING_PRIVY_APP_ID_ENV);
  }
  for (const key of HOSTED_STRIPE_BILLING_PRICE_ENV_KEYS) {
    if (!/^price_[A-Za-z0-9]+$/u.test(requireNormalized(environment, key))) {
      malformed.push(key);
    }
  }
  if (
    !/^bpc_[A-Za-z0-9]+$/u.test(
      requireNormalized(
        environment,
        HOSTED_STRIPE_BILLING_PORTAL_CONFIGURATION_ENV_KEY,
      ),
    )
  ) {
    malformed.push(HOSTED_STRIPE_BILLING_PORTAL_CONFIGURATION_ENV_KEY);
  }
  const runId = requireNormalized(environment, HOSTED_STRIPE_BILLING_RUN_ID_ENV);
  if (!/^[A-Za-z0-9_-]{8,80}$/u.test(runId)) {
    malformed.push(HOSTED_STRIPE_BILLING_RUN_ID_ENV);
  }
  if (malformed.length > 0) {
    throw new HostedStripeBillingLiveConfigError({
      code: "malformed",
      fields: malformed,
      message: [
        `Dedicated Stripe sandbox configuration has malformed fields: ${malformed.join(", ")}.`,
        "Values are intentionally not echoed.",
      ].join(" "),
    });
  }

  return {
    configured: true,
    config: {
      accountId,
      privyAppId,
      priceIds: {
        edge: requireNormalized(
          environment,
          "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
        ),
        familyEdge: requireNormalized(
          environment,
          "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY",
        ),
        familyMax: requireNormalized(
          environment,
          "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY",
        ),
        familyPulse: requireNormalized(
          environment,
          "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY",
        ),
        pulse: requireNormalized(
          environment,
          "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
        ),
      },
      portalConfigurationId: requireNormalized(
        environment,
        HOSTED_STRIPE_BILLING_PORTAL_CONFIGURATION_ENV_KEY,
      ),
      runId,
      secretKey,
    },
  };
}

export function removeHostedStripeBillingLiveEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  for (const key of HOSTED_STRIPE_BILLING_LIVE_ENV_KEYS) {
    delete environment[key];
  }
}

export function partitionHostedStripeBillingLiveEnvironment(input: {
  environment: NodeJS.ProcessEnv;
  selectedScenarioNames: readonly string[];
}): {
  genericEnvironment: NodeJS.ProcessEnv;
  scenarioEnvironment: NodeJS.ProcessEnv;
} {
  const resolution = resolveHostedStripeBillingLiveConfig(input.environment);
  if (!resolution.configured) {
    return {
      genericEnvironment: input.environment,
      scenarioEnvironment: { NODE_ENV: input.environment.NODE_ENV },
    };
  }

  if (
    input.selectedScenarioNames.length !== 1
    || input.selectedScenarioNames[0] !== HOSTED_STRIPE_BILLING_LIVE_SCENARIO
  ) {
    throw new Error(
      "Run the live Stripe billing browser matrix by itself: "
        + `pnpm hosted-local e2e ${HOSTED_STRIPE_BILLING_LIVE_SCENARIO}.`,
    );
  }

  const genericEnvironment = { ...input.environment };
  const scenarioEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: input.environment.NODE_ENV,
  };
  for (const key of HOSTED_STRIPE_BILLING_LIVE_ENV_KEYS) {
    const value = genericEnvironment[key];
    if (value !== undefined) {
      scenarioEnvironment[key] = value;
    }
    delete genericEnvironment[key];
  }
  return { genericEnvironment, scenarioEnvironment };
}

function normalize(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function requireNormalized(
  environment: NodeJS.ProcessEnv,
  key: string,
): string {
  const value = normalize(environment[key]);
  if (value === null) {
    throw new Error(`Missing required environment field ${key}.`);
  }
  return value;
}
