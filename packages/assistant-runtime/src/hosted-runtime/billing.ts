import type {
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
  readHostedAiUsageBillingMode,
} from "@murphai/hosted-execution";
import {
  isAssistantVercelAIGatewayBaseUrl,
} from "@murphai/operator-config/assistant/shared";

import type {
  HostedRuntimePlatform,
} from "./platform.ts";
import {
  HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV,
  HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV,
} from "./platform.ts";

export async function resolveHostedVercelAiGatewayStripeCustomerId(input: {
  billingPort: HostedRuntimePlatform["billingPort"] | null | undefined;
  forwardedEnv: Readonly<Record<string, string>>;
  userEnv: Readonly<Record<string, string>>;
  wake: HostedRuntimeEvent;
}): Promise<string | null> {
  if (
    !isHostedVercelAiGatewayStripeBillingConfigured(input.forwardedEnv, input.userEnv)
    || !input.billingPort
  ) {
    return null;
  }

  try {
    const response = await input.billingPort.resolveVercelAiGatewayStripeCustomerId();
    return response.stripeCustomerId;
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: {
        provider: normalizeHostedRuntimeString(input.forwardedEnv.HOSTED_ASSISTANT_PROVIDER),
        providerName: normalizeHostedRuntimeString(input.forwardedEnv.HOSTED_ASSISTANT_PROVIDER_NAME),
        stripeRestrictedAccessKeyConfigured: Boolean(
          normalizeHostedRuntimeString(
            input.forwardedEnv[HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV],
          ),
        ),
        vercelStripeBillingEnabled: readHostedRuntimeEnabledFlag(
          input.forwardedEnv[HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV],
        ),
      },
      error,
      level: "warn",
      message: "Hosted runtime delegated Vercel Stripe billing customer lookup failed; proceeding without delegated billing.",
      phase: "runtime.starting",
      wake: input.wake,
    });
    return null;
  }
}

function isHostedVercelAiGatewayStripeBillingConfigured(
  forwardedEnv: Readonly<Record<string, string>>,
  userEnv: Readonly<Record<string, string>>,
): boolean {
  return readHostedAiUsageStripeMeterBillingModeEnabled(forwardedEnv)
    && readHostedRuntimeEnabledFlag(
      forwardedEnv[HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV],
    )
    && Boolean(
      normalizeHostedRuntimeString(
        forwardedEnv[HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV],
      ),
    ) && isHostedAssistantUsingVercelAiGateway(forwardedEnv)
    && isHostedAssistantUsingPlatformCredential(forwardedEnv, userEnv);
}

function readHostedAiUsageStripeMeterBillingModeEnabled(
  forwardedEnv: Readonly<Record<string, string>>,
): boolean {
  try {
    return readHostedAiUsageBillingMode(forwardedEnv) === "stripe_meter";
  } catch {
    return false;
  }
}

function isHostedAssistantUsingPlatformCredential(
  forwardedEnv: Readonly<Record<string, string>>,
  userEnv: Readonly<Record<string, string>>,
): boolean {
  const apiKeyEnv = normalizeHostedRuntimeString(forwardedEnv.HOSTED_ASSISTANT_API_KEY_ENV);

  return !apiKeyEnv || normalizeHostedRuntimeString(userEnv[apiKeyEnv]) === null;
}

function isHostedAssistantUsingVercelAiGateway(
  forwardedEnv: Readonly<Record<string, string>>,
): boolean {
  const baseUrl = normalizeHostedRuntimeString(forwardedEnv.HOSTED_ASSISTANT_BASE_URL);
  return baseUrl !== null && isTrustedHostedVercelAiGatewayBaseUrl(baseUrl);
}

function isTrustedHostedVercelAiGatewayBaseUrl(value: string): boolean {
  return isAssistantVercelAIGatewayBaseUrl(value);
}

function normalizeHostedRuntimeString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readHostedRuntimeEnabledFlag(value: string | null | undefined): boolean {
  const normalized = normalizeHostedRuntimeString(value)?.toLowerCase();
  return normalized === "1" || normalized === "true";
}
