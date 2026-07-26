import Stripe from "stripe";

import {
  getHostedBillingPlanDefinition,
  getHostedDefaultBillingPlanCode,
  getHostedFamilyBillingOfferDefinition,
  type HostedBillingPlanCode,
  type HostedPlanCode,
} from "./billing-plans";
import { hostedOnboardingError } from "./errors";
import {
  readHostedOnboardingEnvironment,
  type HostedOnboardingEnvironment,
} from "./env";
import {
  HOSTED_STRIPE_PORTAL_CONFIGURATION_ENV_KEYS,
  isHostedStripePortalConfigurationId,
  readHostedStripeSecretKeyLiveMode,
  type HostedStripePortalConfigurationKind,
} from "./stripe-portal-config";
import {
  getHostedUsageCreditOfferDefinition,
  type HostedUsageCreditOfferCode,
} from "./usage-credit-offers";

const globalForHostedOnboarding = globalThis as typeof globalThis & {
  __murphHostedOnboardingEnv?: HostedOnboardingEnvironment;
  __murphHostedOnboardingStripe?: Stripe | null;
};

export function getHostedOnboardingEnvironment(): HostedOnboardingEnvironment {
  if (globalForHostedOnboarding.__murphHostedOnboardingEnv) {
    return globalForHostedOnboarding.__murphHostedOnboardingEnv;
  }

  const environment = readHostedOnboardingEnvironment(process.env);

  if (process.env.NODE_ENV !== "production") {
    globalForHostedOnboarding.__murphHostedOnboardingEnv = environment;
  }

  return environment;
}

export function getHostedOnboardingStripe(): Stripe | null {
  if (globalForHostedOnboarding.__murphHostedOnboardingStripe !== undefined) {
    return globalForHostedOnboarding.__murphHostedOnboardingStripe;
  }

  const environment = getHostedOnboardingEnvironment();
  const stripe = environment.stripeSecretKey ? new Stripe(environment.stripeSecretKey) : null;

  if (process.env.NODE_ENV !== "production") {
    globalForHostedOnboarding.__murphHostedOnboardingStripe = stripe;
  }

  return stripe;
}

export function requireHostedOnboardingPublicBaseUrl(): string {
  const publicBaseUrl = getHostedOnboardingEnvironment().publicBaseUrl;

  if (!publicBaseUrl) {
    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_PUBLIC_BASE_URL_REQUIRED",
      message: "HOSTED_ONBOARDING_PUBLIC_BASE_URL must be configured before invite links can be sent.",
      httpStatus: 500,
    });
  }

  return publicBaseUrl;
}

export function requireHostedStripeApi(): Stripe {
  const stripe = getHostedOnboardingStripe();

  if (!stripe) {
    throw hostedOnboardingError({
      code: "STRIPE_SECRET_KEY_REQUIRED",
      message: "STRIPE_SECRET_KEY must be configured for Stripe billing and webhook processing.",
      httpStatus: 500,
    });
  }

  return stripe;
}

type HostedStripePortalConfigurationEnvironment = Pick<
  HostedOnboardingEnvironment,
  "isProduction" | "stripePortalConfigurationIds"
>;

export function resolveHostedStripePortalConfigurationId(
  kind: HostedStripePortalConfigurationKind,
  options?: {
    environment?: HostedStripePortalConfigurationEnvironment;
    isDeployedRuntime?: boolean;
  },
): string | undefined {
  const environment = options?.environment ?? getHostedOnboardingEnvironment();
  const configurationId = environment.stripePortalConfigurationIds[kind];
  const isDeployedRuntime = options?.isDeployedRuntime
    ?? hostedStripePortalRequiresExplicitConfiguration(environment);

  if (isHostedStripePortalConfigurationId(configurationId)) {
    return configurationId;
  }

  if (!configurationId && !isDeployedRuntime) {
    return undefined;
  }

  const envKey = HOSTED_STRIPE_PORTAL_CONFIGURATION_ENV_KEYS[kind];
  throw hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_PORTAL_CONFIGURATION_REQUIRED",
    details: {
      configurationKind: kind,
      envKey,
      reason: configurationId ? "invalid" : "missing",
    },
    httpStatus: 500,
    message: configurationId
      ? `${envKey} must contain a valid Stripe Billing Portal configuration ID.`
      : `${envKey} must be configured for Stripe Billing Portal sessions in deployed environments.`,
    retryable: false,
  });
}

export function requireHostedStripeApiMode(): {
  stripe: Stripe;
  stripeLiveMode: boolean;
} {
  const environment = getHostedOnboardingEnvironment();
  const stripeLiveMode = readHostedStripeSecretKeyLiveMode(
    environment.stripeSecretKey,
  );

  if (hostedUsageCreditRequiresLiveStripe(environment) && !stripeLiveMode) {
    throw hostedOnboardingError({
      code: "HOSTED_USAGE_CREDIT_LIVE_STRIPE_REQUIRED",
      message: "Hosted usage-credit checkout requires live Stripe in production.",
      httpStatus: 500,
    });
  }

  return {
    stripe: requireHostedStripeApi(),
    stripeLiveMode,
  };
}

export function requireHostedStripeCheckoutConfig(input?: {
  billingPlanCode?: HostedBillingPlanCode;
}): {
  billingPlanCode: HostedBillingPlanCode;
  priceId: string;
  stripe: Stripe;
} {
  return requireHostedStripeBillingPlanConfig(input);
}

export function requireHostedStripeBillingPlanConfig(input?: {
  billingPlanCode?: HostedBillingPlanCode;
}): {
  billingPlanCode: HostedBillingPlanCode;
  priceId: string;
  stripe: Stripe;
} {
  const environment = getHostedOnboardingEnvironment();
  const billingPlanCode = input?.billingPlanCode ?? getHostedDefaultBillingPlanCode();
  const billingPlan = getHostedBillingPlanDefinition(billingPlanCode);
  const priceId = environment.stripePriceIdsByPlan[billingPlanCode];

  if (!priceId) {
    throw hostedOnboardingError({
      code: "STRIPE_PRICE_ID_REQUIRED",
      message: `${billingPlan.priceIdEnvKey} must be configured for hosted Stripe billing.`,
      httpStatus: 500,
    });
  }

  return {
    billingPlanCode,
    priceId,
    stripe: requireHostedStripeApi(),
  };
}

export function requireHostedStripeFamilyPlanConfig(input: {
  planCode: HostedPlanCode;
}): {
  planCode: HostedPlanCode;
  priceId: string;
  stripe: Stripe;
} {
  const environment = getHostedOnboardingEnvironment();
  const offer = getHostedFamilyBillingOfferDefinition(input.planCode);
  const priceId = environment.stripeFamilyPriceIdsByPlan[input.planCode];
  if (!priceId) {
    throw hostedOnboardingError({
      code: "STRIPE_PRICE_ID_REQUIRED",
      message: `${offer.priceIdEnvKey} must be configured for hosted Family billing.`,
      httpStatus: 500,
    });
  }

  return {
    planCode: input.planCode,
    priceId,
    stripe: requireHostedStripeApi(),
  };
}

export function requireHostedStripeUsageCreditCheckoutConfig(input: {
  offerCode: HostedUsageCreditOfferCode;
}): {
  offerCode: HostedUsageCreditOfferCode;
  priceId: string;
  stripe: Stripe;
  stripeLiveMode: boolean;
} {
  const environment = getHostedOnboardingEnvironment();
  const offer = getHostedUsageCreditOfferDefinition(input.offerCode);
  const priceId = environment.stripeUsageCreditPriceIdsByOffer[input.offerCode];

  if (!priceId) {
    throw hostedOnboardingError({
      code: "STRIPE_PRICE_ID_REQUIRED",
      message: `${offer.priceIdEnvKey} must be configured for hosted usage credit.`,
      httpStatus: 500,
    });
  }

  const { stripe, stripeLiveMode } = requireHostedStripeApiMode();

  return {
    offerCode: input.offerCode,
    priceId,
    stripe,
    stripeLiveMode,
  };
}

function hostedUsageCreditRequiresLiveStripe(
  environment: HostedOnboardingEnvironment,
): boolean {
  const vercelEnvironment = process.env.VERCEL_ENV?.trim().toLowerCase();

  return vercelEnvironment
    ? vercelEnvironment === "production"
    : environment.isProduction;
}

function hostedStripePortalRequiresExplicitConfiguration(
  environment: HostedStripePortalConfigurationEnvironment,
): boolean {
  const vercelEnvironment = process.env.VERCEL_ENV?.trim().toLowerCase();

  return vercelEnvironment
    ? vercelEnvironment !== "development"
    : environment.isProduction;
}

export function requireHostedStripeWebhookVerificationConfig(): {
  stripe: Stripe;
  webhookSecret: string | null;
} {
  const environment = getHostedOnboardingEnvironment();

  return {
    stripe: requireHostedStripeApi(),
    webhookSecret: environment.stripeWebhookSecret,
  };
}

export function requireHostedOnboardingLinqConfig(): {
  apiBaseUrl: string;
  apiToken: string;
} {
  const environment = getHostedOnboardingEnvironment();

  if (!environment.linqApiToken) {
    throw hostedOnboardingError({
      code: "LINQ_CONFIG_REQUIRED",
      message: "LINQ_API_TOKEN must be configured for Linq replies.",
      httpStatus: 500,
    });
  }

  return {
    apiBaseUrl: environment.linqApiBaseUrl,
    apiToken: environment.linqApiToken,
  };
}
