import Stripe from "stripe";

import { createHostedSecretCodec } from "../device-sync/crypto";
import { hostedOnboardingError } from "./errors";
import { readHostedOnboardingEnvironment, type HostedOnboardingEnvironment } from "./env";

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

export function getHostedOnboardingSecretCodec() {
  const environment = getHostedOnboardingEnvironment();
  return createHostedSecretCodec({
    key: environment.encryptionKey,
    keyVersion: environment.encryptionKeyVersion,
  });
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

export function requireHostedOnboardingStripeConfig(): {
  billingMode: "payment" | "subscription";
  priceId: string;
  stripe: Stripe;
  webhookSecret: string | null;
} {
  const environment = getHostedOnboardingEnvironment();
  const stripe = getHostedOnboardingStripe();

  if (!stripe || !environment.stripePriceId) {
    throw hostedOnboardingError({
      code: "STRIPE_CONFIG_REQUIRED",
      message: "STRIPE_SECRET_KEY and HOSTED_ONBOARDING_STRIPE_PRICE_ID must be configured for billing.",
      httpStatus: 500,
    });
  }

  return {
    billingMode: environment.stripeBillingMode,
    priceId: environment.stripePriceId,
    stripe,
    webhookSecret: environment.stripeWebhookSecret,
  };
}

export function requireHostedOnboardingLinqConfig(): {
  apiBaseUrl: string;
  apiToken: string;
  webhookSecret: string | null;
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
    webhookSecret: environment.linqWebhookSecret,
  };
}
