import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";

export const HOSTED_RETELL_USAGE_COST_KEY = "combinedCostUsdMicros";
export const HOSTED_RETELL_USAGE_SOURCE_PATH = "retell.call.call_cost";
export const HOSTED_RETELL_USAGE_VERSION = "retell-call-cost-v1";
export const HOSTED_RETELL_USAGE_PRICING_VERSION =
  "retell-reported-call-cost-2026-07-16";
export const HOSTED_RETELL_USAGE_PRICING_SOURCE =
  "https://docs.retellai.com/api-references/get-call";

export function buildHostedRetellPhoneCallUsageRecord(input: {
  combinedCostUsdMicros: number;
  memberId: string;
  occurredAt: Date;
  phoneCallId: string;
  providerCallId: string;
}): AssistantUsageRecord {
  requireNonNegativeSafeInteger(input.combinedCostUsdMicros, "Retell combined call cost");
  const phoneCallId = requireNonEmptyString(input.phoneCallId, "Murph phone call id");
  const memberId = requireNonEmptyString(input.memberId, "Hosted member id");
  const providerCallId = requireNonEmptyString(input.providerCallId, "Retell call id");
  if (Number.isNaN(input.occurredAt.getTime())) {
    throw new TypeError("Retell usage occurrence time must be valid.");
  }

  const turnId = `turn_phone_call_${phoneCallId}`;
  return {
    apiKeyEnv: "RETELL_API_KEY",
    attemptCount: 1,
    baseUrl: "https://api.retellai.com",
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: "phone-call",
    gatewayTags: [],
    inputTokens: null,
    memberId,
    occurredAt: input.occurredAt.toISOString(),
    outputTokens: null,
    provider: "retell",
    providerName: "Retell AI",
    providerRequestId: providerCallId,
    providerRequestOutcome: "succeeded",
    providerRequestOrdinal: 0,
    rawUsageJson: {
      [HOSTED_RETELL_USAGE_COST_KEY]: input.combinedCostUsdMicros,
    },
    rawUsageJsonHash: null,
    reasoningTokens: null,
    reportingUserId: null,
    requestedModel: null,
    routeId: null,
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: null,
    sessionId: turnId,
    stripeMeterSource: "murph",
    surface: "hosted-web",
    tokenPricingBasis: "standard",
    totalTokens: null,
    triggerKind: "phone-call",
    turnId,
    turnProfileJson: null,
    usageId: createAssistantUsageId({
      attemptCount: 1,
      turnId,
    }),
    usageExtractionSourcePath: HOSTED_RETELL_USAGE_SOURCE_PATH,
    usageExtractionVersion: HOSTED_RETELL_USAGE_VERSION,
  };
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
}

function requireNonEmptyString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}
