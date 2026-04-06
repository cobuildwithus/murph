import Stripe from "stripe";

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

export function requireHostedStripeCheckoutConfig(): {
  priceId: string;
  stripe: Stripe;
} {
  const environment = getHostedOnboardingEnvironment();

  if (!environment.stripePriceId) {
    throw hostedOnboardingError({
      code: "STRIPE_PRICE_ID_REQUIRED",
      message: "HOSTED_ONBOARDING_STRIPE_PRICE_ID must be configured for Stripe checkout creation.",
      httpStatus: 500,
    });
  }

  return {
    priceId: environment.stripePriceId,
    stripe: requireHostedStripeApi(),
  };
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
