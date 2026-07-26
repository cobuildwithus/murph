import { pathToFileURL } from "node:url";

import Stripe from "stripe";

import {
  assertHostedStripePortalConfigurationsForDeployment,
  HOSTED_STRIPE_PORTAL_CONFIGURATION_ENV_KEYS,
  readHostedStripePortalConfigurationIds,
  readHostedStripeSecretKeyLiveMode,
  type HostedStripePortalConfigurationKind,
} from "../src/lib/hosted-onboarding/stripe-portal-config";
import {
  readHostedStripePortalConfigurationIssues,
} from "../src/lib/hosted-onboarding/stripe-portal-policy";

const PORTAL_CONFIGURATION_KINDS = [
  "member",
  "family",
  "payment_recovery",
] as const satisfies readonly HostedStripePortalConfigurationKind[];

type EnvSource = Readonly<Record<string, string | undefined>>;
type StripePortalConfigurationReader = {
  billingPortal: {
    configurations: {
      retrieve: (
        configurationId: string,
      ) => Promise<Stripe.BillingPortal.Configuration>;
    };
  };
};
type StripePortalConfigurationPreflightDependencies = {
  log?: (message: string) => void;
  stripe?: StripePortalConfigurationReader;
};

export async function runStripePortalConfigurationPreflight(
  source: EnvSource = process.env,
  dependencies: StripePortalConfigurationPreflightDependencies = {},
): Promise<void> {
  const log = dependencies.log ?? console.log;
  if (!isDeployedVercelEnvironment(source.VERCEL_ENV)) {
    log("Stripe Billing Portal preflight skipped: local or test environment.");
    return;
  }

  const configurationIds = readHostedStripePortalConfigurationIds(source);
  assertHostedStripePortalConfigurationsForDeployment({
    configurationIds,
    isDeployedRuntime: true,
  });

  const stripeSecretKey = requireEnvironmentVariable(source, "STRIPE_SECRET_KEY");
  const stripeLiveMode = readHostedStripeSecretKeyLiveMode(stripeSecretKey);
  const stripe = dependencies.stripe
    ?? new Stripe(stripeSecretKey);
  const entries = PORTAL_CONFIGURATION_KINDS.map((kind) => ({
    configurationId: requirePortalConfigurationId(
      configurationIds[kind],
      kind,
    ),
    kind,
  }));

  assertDedicatedPortalConfigurationIds(entries);

  const configurations = await Promise.all(entries.map(async (entry) => {
    try {
      return await stripe.billingPortal.configurations.retrieve(
        entry.configurationId,
      );
    } catch {
      throw new Error(
        `Unable to inspect the ${formatPortalKind(entry.kind)} Stripe Billing Portal configuration.`,
      );
    }
  }));
  const issues = configurations.flatMap((configuration, index) =>
    readHostedStripePortalConfigurationIssues({
      configuration,
      expectedConfigurationId: entries[index]!.configurationId,
      expectedLiveMode: stripeLiveMode,
      kind: entries[index]!.kind,
    })
  );

  if (issues.length > 0) {
    throw new Error(
      `Stripe Billing Portal configuration preflight failed: ${issues.join("; ")}.`,
    );
  }

  log("Stripe Billing Portal configuration preflight passed.");
}

function assertDedicatedPortalConfigurationIds(
  entries: readonly {
    configurationId: string;
    kind: HostedStripePortalConfigurationKind;
  }[],
): void {
  if (new Set(entries.map((entry) => entry.configurationId)).size === entries.length) {
    return;
  }

  throw new Error(
    "Member, Family, and payment-recovery Stripe Billing Portal configurations must use distinct IDs.",
  );
}

function requirePortalConfigurationId(
  value: string | null,
  kind: HostedStripePortalConfigurationKind,
): string {
  if (value) {
    return value;
  }

  throw new Error(
    `${HOSTED_STRIPE_PORTAL_CONFIGURATION_ENV_KEYS[kind]} is required in deployed environments.`,
  );
}

function requireEnvironmentVariable(
  source: EnvSource,
  name: string,
): string {
  const value = source[name]?.trim();
  if (value) {
    return value;
  }

  throw new Error(`${name} is required for Stripe Billing Portal preflight.`);
}

function isDeployedVercelEnvironment(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "preview" || normalized === "production";
}

function formatPortalKind(
  kind: HostedStripePortalConfigurationKind,
): string {
  return kind === "payment_recovery" ? "payment-recovery" : kind;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runStripePortalConfigurationPreflight().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Stripe Billing Portal configuration preflight failed.",
    );
    process.exitCode = 1;
  });
}
