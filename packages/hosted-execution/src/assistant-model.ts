export const HOSTED_ASSISTANT_LUNA_MODEL = "gpt-5.6-luna" as const;
export const HOSTED_ASSISTANT_TERRA_MODEL = "gpt-5.6-terra" as const;
export const HOSTED_ASSISTANT_SOL_MODEL = "gpt-5.6-sol" as const;

export const HOSTED_ASSISTANT_PRODUCT_MODELS = [
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
] as const;

export type HostedAssistantProductModel =
  (typeof HOSTED_ASSISTANT_PRODUCT_MODELS)[number];

export const HOSTED_ASSISTANT_OPENAI_PROVIDER = "openai" as const;
export const HOSTED_ASSISTANT_VENICE_PROVIDER = "venice" as const;

export const HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS = {
  [HOSTED_ASSISTANT_LUNA_MODEL]: "openai-gpt-56-luna",
  [HOSTED_ASSISTANT_TERRA_MODEL]: "openai-gpt-56-terra",
  [HOSTED_ASSISTANT_SOL_MODEL]: "openai-gpt-56-sol",
} as const satisfies Record<HostedAssistantProductModel, string>;

export const HOSTED_ASSISTANT_PROVIDERS = [
  HOSTED_ASSISTANT_OPENAI_PROVIDER,
  HOSTED_ASSISTANT_VENICE_PROVIDER,
] as const;

export type HostedAssistantProvider =
  (typeof HOSTED_ASSISTANT_PROVIDERS)[number];

export const HOSTED_ASSISTANT_DEFAULT_PROVIDER =
  HOSTED_ASSISTANT_OPENAI_PROVIDER;

export const HOSTED_ASSISTANT_PROVIDER_OVERRIDES = [
  HOSTED_ASSISTANT_VENICE_PROVIDER,
] as const;

export type HostedAssistantProviderOverride =
  (typeof HOSTED_ASSISTANT_PROVIDER_OVERRIDES)[number];

export function isHostedAssistantProvider(
  value: unknown,
): value is HostedAssistantProvider {
  return HOSTED_ASSISTANT_PROVIDERS.some((provider) => provider === value);
}

export function parseHostedAssistantProviderOverride(
  value: unknown,
): HostedAssistantProviderOverride | null {
  return value === HOSTED_ASSISTANT_VENICE_PROVIDER ? value : null;
}

export const HOSTED_ASSISTANT_MODEL_OVERRIDES = [
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
] as const;

export type HostedAssistantModelOverride =
  (typeof HOSTED_ASSISTANT_MODEL_OVERRIDES)[number];

export function isHostedAssistantProductModel(
  value: unknown,
): value is HostedAssistantProductModel {
  return HOSTED_ASSISTANT_PRODUCT_MODELS.some((model) => model === value);
}

export function parseHostedAssistantModelOverride(
  value: unknown,
): HostedAssistantModelOverride | null {
  return value === HOSTED_ASSISTANT_LUNA_MODEL ||
      value === HOSTED_ASSISTANT_SOL_MODEL
    ? value
    : null;
}

export const HOSTED_ASSISTANT_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type HostedAssistantReasoningEffort =
  (typeof HOSTED_ASSISTANT_REASONING_EFFORTS)[number];

export const HOSTED_ASSISTANT_DEFAULT_REASONING_EFFORT = "low" as const satisfies
  HostedAssistantReasoningEffort;

export const HOSTED_ASSISTANT_REASONING_EFFORT_OVERRIDES = [
  "medium",
  "high",
  "xhigh",
] as const;

export type HostedAssistantReasoningEffortOverride =
  (typeof HOSTED_ASSISTANT_REASONING_EFFORT_OVERRIDES)[number];

export function isHostedAssistantReasoningEffort(
  value: unknown,
): value is HostedAssistantReasoningEffort {
  return HOSTED_ASSISTANT_REASONING_EFFORTS.some((effort) => effort === value);
}

export function parseHostedAssistantReasoningEffortOverride(
  value: unknown,
): HostedAssistantReasoningEffortOverride | null {
  return value === "medium" || value === "high" || value === "xhigh"
    ? value
    : null;
}
