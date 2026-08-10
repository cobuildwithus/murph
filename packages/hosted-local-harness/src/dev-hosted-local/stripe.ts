export const HOSTED_LOCAL_STRIPE_BILLING_PRICE_ENV_KEYS = [
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MAX_MONTHLY",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_5_USD",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_10_USD",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_20_USD",
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_25_USD",
] as const;

const FLAT_PRICE_PLAN_KEYS = [
  {
    code: "launch_monthly",
    label: "monthly",
    priceKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
  },
  {
    code: "launch_edge_monthly",
    label: "edge",
    priceKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
  },
  {
    code: "launch_max_monthly",
    label: "max",
    priceKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MAX_MONTHLY",
  },
  {
    code: "launch_family_seat_monthly",
    label: "family-pulse",
    priceKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY",
  },
  {
    code: "launch_family_edge_seat_monthly",
    label: "family-edge",
    priceKey:
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY",
  },
  {
    code: "launch_family_max_seat_monthly",
    label: "family-max",
    priceKey:
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY",
  },
] as const;

type StripeSecretMode = "missing" | "placeholder" | "test" | "live" | "unknown";

interface StripePlanStatus {
  code: string;
  label: string;
  priceKey: string;
  flatPriceReady: boolean;
}

export interface HostedLocalStripeCheckoutDiagnostics {
  configuredPlanLabels: string[];
  missingFlatPriceKeys: string[];
  secretMode: StripeSecretMode;
}

export function evaluateHostedLocalStripeCheckoutEnv(
  env: Readonly<NodeJS.ProcessEnv>,
): HostedLocalStripeCheckoutDiagnostics {
  const planStatuses = FLAT_PRICE_PLAN_KEYS.map((plan): StripePlanStatus => ({
    code: plan.code,
    label: plan.label,
    priceKey: plan.priceKey,
    flatPriceReady: isConfiguredStripePriceId(env[plan.priceKey]),
  }));

  return {
    configuredPlanLabels: planStatuses
      .filter((plan) => plan.flatPriceReady)
      .map((plan) => plan.label),
    missingFlatPriceKeys: planStatuses
      .filter((plan) => !plan.flatPriceReady)
      .map((plan) => plan.priceKey),
    secretMode: classifyStripeSecretKey(env.STRIPE_SECRET_KEY),
  };
}

export function writeHostedLocalStripeCheckoutDiagnostics(input: {
  env: NodeJS.ProcessEnv;
  stderrTarget?: NodeJS.WritableStream;
  stripeListenerWillCaptureSecret: boolean;
}): HostedLocalStripeCheckoutDiagnostics {
  const diagnostics = evaluateHostedLocalStripeCheckoutEnv(input.env);
  const stderrTarget = input.stderrTarget ?? process.stderr;

  if (
    diagnostics.secretMode === "live"
    && input.env.MURPH_DEV_ALLOW_LIVE_STRIPE !== "1"
  ) {
    throw new Error(
      [
        "Local hosted dev refuses to start with a live Stripe secret key.",
        "Use a test-mode key (`sk_test_...` or `rk_test_...`) for local checkout,",
        "or set MURPH_DEV_ALLOW_LIVE_STRIPE=1 only if you intentionally need live-mode local dev.",
      ].join(" "),
    );
  }

  if (diagnostics.secretMode !== "test") {
    stderrTarget.write(
      [
        "[setup] Warning: STRIPE_SECRET_KEY is not configured with a test-mode Stripe key.",
        " Local hosted checkout needs `sk_test_...` or a suitably scoped `rk_test_...` key.",
        " Add it to `.tmp/.env.hosted-local-stripe`, `apps/web/.env.local`, or your shell env.\n",
      ].join(""),
    );
  }

  if (diagnostics.missingFlatPriceKeys.length > 0) {
    stderrTarget.write(
      [
        "[setup] Warning: Stripe test checkout is missing plan price env keys: ",
        diagnostics.missingFlatPriceKeys.join(", "),
        ". Create recurring test-mode Prices in Stripe and add their `price_...` ids locally.\n",
      ].join(""),
    );
  }

  if (diagnostics.secretMode === "test" && diagnostics.configuredPlanLabels.length > 0) {
    stderrTarget.write(
      `[setup] Stripe test checkout env ready for ${diagnostics.configuredPlanLabels.join(", ")} plan(s).\n`,
    );
  }

  if (!input.stripeListenerWillCaptureSecret && !isConfiguredStripeWebhookSecret(input.env.STRIPE_WEBHOOK_SECRET)) {
    stderrTarget.write(
      [
        "[setup] Warning: STRIPE_WEBHOOK_SECRET is not configured and the auto `stripe listen` forwarder is disabled.",
        " Hosted onboarding webhooks will not verify locally until a webhook signing secret is available.\n",
      ].join(""),
    );
  } else if (input.stripeListenerWillCaptureSecret) {
    stderrTarget.write(
      "[setup] Stripe webhook signing secret will be injected from the local `stripe listen` process.\n",
    );
  }

  return diagnostics;
}

function classifyStripeSecretKey(value: string | undefined): StripeSecretMode {
  const normalized = value?.trim();

  if (!normalized) {
    return "missing";
  }

  if (isPlaceholderStripeValue(normalized)) {
    return "placeholder";
  }

  if (normalized.startsWith("sk_test_") || normalized.startsWith("rk_test_")) {
    return "test";
  }

  if (normalized.startsWith("sk_live_") || normalized.startsWith("rk_live_")) {
    return "live";
  }

  return "unknown";
}

function isConfiguredStripePriceId(value: string | undefined): boolean {
  const normalized = value?.trim();
  return Boolean(
    normalized
    && normalized.startsWith("price_")
    && !isPlaceholderStripeValue(normalized),
  );
}

function isConfiguredStripeWebhookSecret(value: string | undefined): boolean {
  const normalized = value?.trim();
  return Boolean(
    normalized
    && normalized.startsWith("whsec_")
    && !isPlaceholderStripeValue(normalized),
  );
}

function isPlaceholderStripeValue(value: string): boolean {
  return value.trim().toLowerCase().includes("replace_me");
}
