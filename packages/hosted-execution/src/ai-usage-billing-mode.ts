export const HOSTED_AI_USAGE_BILLING_MODE_ENV =
  "HOSTED_AI_USAGE_BILLING_MODE";

export const HOSTED_AI_USAGE_BILLING_DISABLED_MESSAGE =
  "Hosted AI usage billing is disabled until Stripe native LLM billing is enabled.";

export const HOSTED_AI_USAGE_BILLING_MODES = [
  "disabled",
  "stripe_meter",
] as const;

export type HostedAiUsageBillingMode =
  (typeof HOSTED_AI_USAGE_BILLING_MODES)[number];

type HostedAiUsageBillingModeSource = Readonly<Record<string, string | undefined>>;

export function readHostedAiUsageBillingMode(
  source: HostedAiUsageBillingModeSource = process.env,
): HostedAiUsageBillingMode {
  return parseHostedAiUsageBillingModeOrDisabled(
    source[HOSTED_AI_USAGE_BILLING_MODE_ENV],
  );
}

export function parseHostedAiUsageBillingMode(
  value: string | null | undefined,
): HostedAiUsageBillingMode {
  const normalized = normalizeHostedAiUsageBillingModeValue(value);

  if (!normalized) {
    return "disabled";
  }

  if (isHostedAiUsageBillingMode(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `${HOSTED_AI_USAGE_BILLING_MODE_ENV} must be one of: ${HOSTED_AI_USAGE_BILLING_MODES.join(", ")}.`,
  );
}

export function parseHostedAiUsageBillingModeOrDisabled(
  value: string | null | undefined,
): HostedAiUsageBillingMode {
  const normalized = normalizeHostedAiUsageBillingModeValue(value);

  return isHostedAiUsageBillingMode(normalized) ? normalized : "disabled";
}

function isHostedAiUsageBillingMode(
  value: string,
): value is HostedAiUsageBillingMode {
  return HOSTED_AI_USAGE_BILLING_MODES.includes(
    value as HostedAiUsageBillingMode,
  );
}

function normalizeHostedAiUsageBillingModeValue(
  value: string | null | undefined,
): string {
  return typeof value === "string" ? value.trim() : "";
}
