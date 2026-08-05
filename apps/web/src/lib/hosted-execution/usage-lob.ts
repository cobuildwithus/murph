import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";

export const HOSTED_LOB_USAGE_COST_KEY = "providerCostUsdMicros";
export const HOSTED_LOB_USAGE_PROVIDER_PRICING_VERSION_KEY =
  "providerPricingVersion";
export const HOSTED_LOB_USAGE_SOURCE_PATH = "lob.letters.create";
export const HOSTED_LOB_USAGE_VERSION = "lob-physical-note-cost-v1";
export const HOSTED_LOB_USAGE_PRICING_VERSION =
  "lob-configured-physical-note-cost-v1";
export const HOSTED_LOB_USAGE_PRICING_SOURCE =
  "LOB_PHYSICAL_NOTE_COST_USD_MICROS";

export function buildHostedLobPhysicalNoteUsageRecord(input: {
  memberId: string;
  occurredAt: Date;
  physicalNoteId: string;
  providerCostUsdMicros: number;
  providerLetterId: string;
  providerPricingVersion: string;
}): AssistantUsageRecord {
  requireNonNegativeSafeInteger(
    input.providerCostUsdMicros,
    "Lob physical-note cost",
  );
  const memberId = requireNonEmptyString(input.memberId, "Hosted member id");
  const physicalNoteId = requireNonEmptyString(
    input.physicalNoteId,
    "Murph physical-note id",
  );
  const providerLetterId = requireNonEmptyString(
    input.providerLetterId,
    "Lob letter id",
  );
  const providerPricingVersion = requireNonEmptyString(
    input.providerPricingVersion,
    "Lob pricing version",
  );
  const turnId = `turn_physical_note_${physicalNoteId}`;
  return {
    apiKeyEnv: "LOB_API_KEY",
    attemptCount: 1,
    baseUrl: "https://api.lob.com",
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: "physical-note",
    gatewayTags: [],
    inputTokens: null,
    memberId,
    occurredAt: input.occurredAt.toISOString(),
    outputTokens: null,
    provider: "lob",
    providerName: "Lob",
    providerRequestId: providerLetterId,
    providerRequestOutcome: "succeeded",
    providerRequestOrdinal: 0,
    rawUsageJson: {
      [HOSTED_LOB_USAGE_COST_KEY]: input.providerCostUsdMicros,
      [HOSTED_LOB_USAGE_PROVIDER_PRICING_VERSION_KEY]: providerPricingVersion,
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
    triggerKind: "physical-note",
    turnId,
    turnProfileJson: null,
    usageId: createAssistantUsageId({ attemptCount: 1, turnId }),
    usageExtractionSourcePath: HOSTED_LOB_USAGE_SOURCE_PATH,
    usageExtractionVersion: HOSTED_LOB_USAGE_VERSION,
  };
}

export function matchHostedLobPhysicalNoteUsageRecord(
  record: AssistantUsageRecord,
): {
  providerCostUsdMicros: bigint;
  providerPricingVersion: string;
} | null {
  const raw = record.rawUsageJson;
  if (
    record.provider !== "lob"
    || record.providerName !== "Lob"
    || record.apiKeyEnv !== "LOB_API_KEY"
    || record.baseUrl !== "https://api.lob.com"
    || record.credentialSource !== "platform"
    || record.featureKey !== "physical-note"
    || record.surface !== "hosted-web"
    || record.triggerKind !== "physical-note"
    || record.usageExtractionSourcePath !== HOSTED_LOB_USAGE_SOURCE_PATH
    || record.usageExtractionVersion !== HOSTED_LOB_USAGE_VERSION
    || record.requestedModel !== null
    || record.servedModel !== null
    || record.inputTokens !== null
    || record.outputTokens !== null
    || record.reasoningTokens !== null
    || record.cachedInputTokens !== null
    || record.cacheWriteTokens !== null
    || record.totalTokens !== null
    || !raw
    || !Object.keys(raw).every((key) =>
      key === HOSTED_LOB_USAGE_COST_KEY
      || key === HOSTED_LOB_USAGE_PROVIDER_PRICING_VERSION_KEY)
  ) {
    return null;
  }
  const cost = raw[HOSTED_LOB_USAGE_COST_KEY];
  const pricingVersion = raw[HOSTED_LOB_USAGE_PROVIDER_PRICING_VERSION_KEY];
  return typeof cost === "number"
      && Number.isSafeInteger(cost)
      && cost >= 0
      && typeof pricingVersion === "string"
      && pricingVersion.trim()
    ? {
        providerCostUsdMicros: BigInt(cost),
        providerPricingVersion: pricingVersion.trim(),
      }
    : null;
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
}

function requireNonEmptyString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}
