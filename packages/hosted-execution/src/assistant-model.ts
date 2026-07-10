export const HOSTED_ASSISTANT_TERRA_MODEL = "gpt-5.6-terra" as const;
export const HOSTED_ASSISTANT_SOL_MODEL = "gpt-5.6-sol" as const;

export const HOSTED_ASSISTANT_PRODUCT_MODELS = [
  HOSTED_ASSISTANT_TERRA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
] as const;

export type HostedAssistantProductModel =
  (typeof HOSTED_ASSISTANT_PRODUCT_MODELS)[number];

export const HOSTED_ASSISTANT_MODEL_OVERRIDES = [
  HOSTED_ASSISTANT_SOL_MODEL,
] as const;

export type HostedAssistantModelOverride =
  (typeof HOSTED_ASSISTANT_MODEL_OVERRIDES)[number];

export function isHostedAssistantProductModel(
  value: unknown,
): value is HostedAssistantProductModel {
  return typeof value === "string" &&
    HOSTED_ASSISTANT_PRODUCT_MODELS.includes(
      value as HostedAssistantProductModel,
    );
}

export function parseHostedAssistantModelOverride(
  value: unknown,
): HostedAssistantModelOverride | null {
  return value === HOSTED_ASSISTANT_SOL_MODEL
    ? HOSTED_ASSISTANT_SOL_MODEL
    : null;
}
