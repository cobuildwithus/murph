import { pathToFileURL } from "node:url";

import Stripe from "stripe";

const STRIPE_CONTRACT_TEST_SECRET_KEY_ENV =
  "MURPH_STRIPE_CONTRACT_TEST_SECRET_KEY";
const STRIPE_CONTRACT_MISSING_SUBSCRIPTION_ID =
  "sub_murph_contract_probe_missing";

interface StripeSubscriptionResumeContractClient {
  resume(
    ...args: Parameters<Stripe["subscriptions"]["resume"]>
  ): Promise<unknown>;
}

export function requireStripeContractTestSecretKey(
  value: string | undefined,
): string {
  if (!value) {
    throw new Error(
      `${STRIPE_CONTRACT_TEST_SECRET_KEY_ENV} is required for the opt-in Stripe contract probe.`,
    );
  }
  if (!value.startsWith("sk_test_")) {
    throw new Error(
      `${STRIPE_CONTRACT_TEST_SECRET_KEY_ENV} must be a Stripe test-mode secret key; live and restricted keys are refused.`,
    );
  }
  return value;
}

export async function verifyStripeSubscriptionResumeContract(
  subscriptions: StripeSubscriptionResumeContractClient,
): Promise<void> {
  const params: Stripe.SubscriptionResumeParams = {
    billing_cycle_anchor: "now",
    expand: [
      "items.data.price",
      "latest_invoice",
      "latest_invoice.payment_intent",
    ],
  };

  try {
    await subscriptions.resume(
      STRIPE_CONTRACT_MISSING_SUBSCRIPTION_ID,
      params,
    );
  } catch (error) {
    const code = readSafeStripeErrorField(error, "code");
    if (code === "resource_missing") {
      return;
    }
    const type = readSafeStripeErrorField(error, "type");
    const param = readSafeStripeErrorField(error, "param");
    throw new Error(
      `Stripe rejected the subscription resume contract with code=${code ?? "unknown"}, type=${type ?? "unknown"}, param=${param ?? "unknown"}.`,
    );
  }

  throw new Error(
    "Stripe unexpectedly found the synthetic missing subscription used by the contract probe.",
  );
}

async function main(): Promise<void> {
  const secretKey = requireStripeContractTestSecretKey(
    process.env[STRIPE_CONTRACT_TEST_SECRET_KEY_ENV],
  );
  const stripe = new Stripe(secretKey, {
    maxNetworkRetries: 0,
    timeout: 10_000,
  });
  await verifyStripeSubscriptionResumeContract(stripe.subscriptions);
  console.log(
    "Stripe test mode accepted the subscription resume parameter contract and returned the expected missing-resource response.",
  );
}

function readSafeStripeErrorField(
  error: unknown,
  field: "code" | "param" | "type",
): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const value = Reflect.get(error, field);
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/u.test(value)
    ? value
    : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
