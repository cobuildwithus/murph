import Stripe from "stripe";

import { createHostedSecretCodec } from "../device-sync/crypto";
import { hostedOnboardingError } from "./errors";
import { readHostedOnboardingEnvironment, type HostedOnboardingEnvironment } from "./env";

const globalForHostedOnboarding = globalThis as typeof globalThis & {
  __healthybobHostedOnboardingEnv?: HostedOnboardingEnvironment;
  __healthybobHostedOnboardingStripe?: Stripe | null;
};

export function getHostedOnboardingEnvironment(): HostedOnboardingEnvironment {
  if (globalForHostedOnboarding.__healthybobHostedOnboardingEnv) {
    return globalForHostedOnboarding.__healthybobHostedOnboardingEnv;
  }

  const environment = readHostedOnboardingEnvironment(process.env);

  if (process.env.NODE_ENV !== "production") {
    globalForHostedOnboarding.__healthybobHostedOnboardingEnv = environment;
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
  if (globalForHostedOnboarding.__healthybobHostedOnboardingStripe !== undefined) {
    return globalForHostedOnboarding.__healthybobHostedOnboardingStripe;
  }

  const environment = getHostedOnboardingEnvironment();
  const stripe = environment.stripeSecretKey ? new Stripe(environment.stripeSecretKey) : null;

  if (process.env.NODE_ENV !== "production") {
    globalForHostedOnboarding.__healthybobHostedOnboardingStripe = stripe;
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

export function requireHostedOnboardingPasskeyConfig(): {
  expectedOrigin: string;
  rpId: string;
  rpName: string;
} {
  const environment = getHostedOnboardingEnvironment();

  if (!environment.passkeyOrigin || !environment.passkeyRpId) {
    throw hostedOnboardingError({
      code: "PASSKEY_CONFIG_REQUIRED",
      message:
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL or explicit HOSTED_ONBOARDING_PASSKEY_ORIGIN/HOSTED_ONBOARDING_PASSKEY_RP_ID must be configured for passkeys.",
      httpStatus: 500,
    });
  }

  return {
    expectedOrigin: environment.passkeyOrigin,
    rpId: environment.passkeyRpId,
    rpName: environment.passkeyRpName,
  };
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
      message: "LINQ_API_TOKEN or HEALTHYBOB_LINQ_API_TOKEN must be configured for Linq replies.",
      httpStatus: 500,
    });
  }

  return {
    apiBaseUrl: environment.linqApiBaseUrl,
    apiToken: environment.linqApiToken,
    webhookSecret: environment.linqWebhookSecret,
  };
}
