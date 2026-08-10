import Stripe from "stripe";

import {
  getHostedBillingPlanDefinition,
  getHostedDefaultBillingPlanCode,
  getHostedFamilyBillingOfferDefinition,
  type HostedBillingPlanCode,
  type HostedFamilyPlanCode,
} from "./billing-plans";
import { hostedOnboardingError } from "./errors";
import { readHostedOnboardingEnvironment, type HostedOnboardingEnvironment } from "./env";
import { buildHostedStripeAlertCorrelationCause } from "./stripe-error-fields";
import {
  getHostedUsageCreditOfferDefinition,
  type HostedUsageCreditOfferCode,
} from "./usage-credit-offers";

const globalForHostedOnboarding = globalThis as typeof globalThis & {
  __murphHostedOnboardingEnv?: HostedOnboardingEnvironment;
  __murphHostedOnboardingStripe?: Stripe | null;
};

const HOSTED_BILLING_PLAN_DISPLAY_PRICE_REQUEST_OPTIONS = {
  maxNetworkRetries: 0,
  timeout: 5_000,
} as const satisfies Stripe.RequestOptions;

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
  stripeLiveMode: boolean;
} {
  return requireHostedStripeBillingPlanConfig(input);
}

export function requireHostedStripeBillingPlanConfig(input?: {
  billingPlanCode?: HostedBillingPlanCode;
}): {
  billingPlanCode: HostedBillingPlanCode;
  priceId: string;
  stripe: Stripe;
  stripeLiveMode: boolean;
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

  if (billingPlanCode === "launch_group_monthly") {
    assertHostedBillingPlanPriceIdIsDistinct({
      billingPlanCode,
      environment,
      priceId,
    });
  }

  return {
    billingPlanCode,
    priceId,
    stripe: requireHostedStripeApi(),
    stripeLiveMode: readHostedStripeSecretKeyLiveMode(
      environment.stripeSecretKey,
    ),
  };
}

export async function requireValidatedHostedStripeBillingPlanConfig(input?: {
  billingPlanCode?: HostedBillingPlanCode;
}): Promise<{
  billingPlanCode: HostedBillingPlanCode;
  priceId: string;
  stripe: Stripe;
}> {
  return requireValidatedHostedStripeBillingPlanConfigWithRequestOptions(input);
}

async function requireValidatedHostedStripeBillingPlanConfigWithRequestOptions(
  input?: {
    billingPlanCode?: HostedBillingPlanCode;
    requestOptions?: Stripe.RequestOptions;
  },
): Promise<{
  billingPlanCode: HostedBillingPlanCode;
  priceId: string;
  stripe: Stripe;
}> {
  const config = requireHostedStripeBillingPlanConfig(input);
  let price: Stripe.Price;

  try {
    const retrieveParams: Stripe.PriceRetrieveParams = {
      expand: ["currency_options"],
    };
    price = input?.requestOptions
      ? await config.stripe.prices.retrieve(
          config.priceId,
          retrieveParams,
          input.requestOptions,
        )
      : await config.stripe.prices.retrieve(config.priceId, retrieveParams);
  } catch (error) {
    throw hostedOnboardingError({
      cause: buildHostedStripeAlertCorrelationCause(error),
      code: "HOSTED_BILLING_PRICE_UNAVAILABLE",
      httpStatus: 502,
      message:
        "Stripe billing is unavailable for this plan right now. Try again shortly.",
      retryable: true,
    });
  }

  assertHostedStripeBillingPlanPriceMatchesCatalog({
    billingPlanCode: config.billingPlanCode,
    price,
    priceId: config.priceId,
    stripeLiveMode: readHostedStripeSecretKeyLiveMode(
      getHostedOnboardingEnvironment().stripeSecretKey,
    ),
  });

  return config;
}

export async function isHostedBillingPlanSelectionAvailable(input: {
  billingPlanCode: HostedBillingPlanCode;
}): Promise<boolean> {
  try {
    await requireValidatedHostedStripeBillingPlanConfigWithRequestOptions({
      ...input,
      requestOptions: HOSTED_BILLING_PLAN_DISPLAY_PRICE_REQUEST_OPTIONS,
    });
    return true;
  } catch {
    return false;
  }
}

function assertHostedBillingPlanPriceIdIsDistinct(input: {
  billingPlanCode: HostedBillingPlanCode;
  environment: HostedOnboardingEnvironment;
  priceId: string;
}): void {
  const duplicatePlanCode = Object.entries(
    input.environment.stripePriceIdsByPlan,
  ).find(([planCode, priceId]) =>
    planCode !== input.billingPlanCode && priceId === input.priceId
  )?.[0];

  if (!duplicatePlanCode) {
    return;
  }

  throw buildHostedBillingPriceConfigurationError(
    "price_identity_not_distinct",
  );
}

function assertHostedStripeBillingPlanPriceMatchesCatalog(input: {
  billingPlanCode: HostedBillingPlanCode;
  price: Stripe.Price;
  priceId: string;
  stripeLiveMode: boolean;
}): void {
  const definition = getHostedBillingPlanDefinition(input.billingPlanCode);
  const recurring = input.price.recurring;
  const hasUnsupportedCurrencyOption = input.price.currency_options
    ? Object.keys(input.price.currency_options).some(
        (currency) => currency.toLowerCase() !== "usd",
      )
    : false;

  if (input.price.id !== input.priceId || input.price.object !== "price") {
    throw buildHostedBillingPriceConfigurationError("price_identity_mismatch");
  }
  if (input.price.livemode !== input.stripeLiveMode) {
    throw buildHostedBillingPriceConfigurationError("price_mode_mismatch");
  }
  if (!input.price.active) {
    throw buildHostedBillingPriceConfigurationError("price_inactive");
  }
  if (
    input.price.type !== "recurring"
    || recurring?.interval !== definition.interval
    || recurring.interval_count !== 1
    || recurring.usage_type !== "licensed"
  ) {
    throw buildHostedBillingPriceConfigurationError("price_recurrence_mismatch");
  }
  if (
    input.price.billing_scheme !== "per_unit"
    || input.price.custom_unit_amount !== null
    || input.price.transform_quantity !== null
    || input.price.tiers_mode !== null
  ) {
    throw buildHostedBillingPriceConfigurationError("price_quantity_unsupported");
  }
  if (input.price.currency.toLowerCase() !== "usd") {
    throw buildHostedBillingPriceConfigurationError("price_currency_mismatch");
  }
  if (
    input.price.unit_amount !== definition.recurringAmountUsdCents
    || hasUnsupportedCurrencyOption
  ) {
    throw buildHostedBillingPriceConfigurationError("price_amount_mismatch");
  }
}

function buildHostedBillingPriceConfigurationError(
  reason: string,
): Error {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_PRICE_CONFIGURATION_INVALID",
    details: { reason },
    httpStatus: 500,
    message: "The configured Stripe Price does not match this billing plan.",
  });
}

export function requireHostedStripeFamilyPlanConfig(input: {
  planCode: HostedFamilyPlanCode;
}): {
  planCode: HostedFamilyPlanCode;
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

function readHostedStripeSecretKeyLiveMode(secretKey: string | null): boolean {
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

function hostedUsageCreditRequiresLiveStripe(
  environment: HostedOnboardingEnvironment,
): boolean {
  const vercelEnvironment = process.env.VERCEL_ENV?.trim().toLowerCase();

  return vercelEnvironment
    ? vercelEnvironment === "production"
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
