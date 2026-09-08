import type {
  HostedRuntimeAssistantConfigurationControlRequest,
  HostedRuntimeAssistantConfigurationSnapshot,
  HostedRuntimeAssistantConfigurationToolRequest,
  HostedRuntimeAssistantConfigurationToolResponse,
  HostedRuntimeAssistantConfigurationUpdateStatus,
} from "./runtime-control.ts";
import {
  assertAllowedObjectKeys,
  requireArray,
  requireBoolean,
  requireObject,
  requireString,
} from "./parsers/assertions.ts";

export const HOSTED_ASSISTANT_LUNA_MODEL = "gpt-5.6-luna" as const;
export const HOSTED_ASSISTANT_TERRA_MODEL = "gpt-5.6-terra" as const;
export const HOSTED_ASSISTANT_SOL_MODEL = "gpt-5.6-sol" as const;
export const HOSTED_ASSISTANT_ASTRA_MODEL = "gpt-6-astra" as const;

export const HOSTED_ASSISTANT_PRODUCT_MODELS = [
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_ASTRA_MODEL,
] as const;

export type HostedAssistantProductModel =
  (typeof HOSTED_ASSISTANT_PRODUCT_MODELS)[number];

export const HOSTED_ASSISTANT_OPENAI_PROVIDER = "openai" as const;
export const HOSTED_ASSISTANT_VENICE_PROVIDER = "venice" as const;

export const HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS: Partial<Record<HostedAssistantProductModel, string>> = {
  [HOSTED_ASSISTANT_LUNA_MODEL]: "openai-gpt-56-luna",
  [HOSTED_ASSISTANT_TERRA_MODEL]: "openai-gpt-56-terra",
  [HOSTED_ASSISTANT_SOL_MODEL]: "openai-gpt-56-sol",
};

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
  HOSTED_ASSISTANT_ASTRA_MODEL,
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
      value === HOSTED_ASSISTANT_SOL_MODEL ||
      value === HOSTED_ASSISTANT_ASTRA_MODEL
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

export function parseHostedRuntimeAssistantConfigurationToolRequest(
  value: unknown,
): HostedRuntimeAssistantConfigurationToolRequest {
  const record = requireObject(
    value,
    "Hosted runtime assistant configuration tool request",
  );
  const action = requireString(
    record.action,
    "Hosted runtime assistant configuration tool request action",
  );
  if (action === "read") {
    assertAllowedObjectKeys(
      record,
      new Set(["action"]),
      "Hosted runtime assistant configuration tool read request",
    );
    return { action };
  }
  if (action !== "update") {
    throw new TypeError(
      "Hosted runtime assistant configuration tool action is not supported.",
    );
  }

  assertAllowedObjectKeys(
    record,
    new Set(["action", "model", "provider", "reasoningEffort"]),
    "Hosted runtime assistant configuration tool update request",
  );
  const model =
    record.model === undefined
      ? undefined
      : parseHostedRuntimeAssistantProductModel(
          record.model,
          "Hosted runtime assistant configuration tool model",
        );
  const reasoningEffort =
    record.reasoningEffort === undefined
      ? undefined
      : parseHostedRuntimeAssistantReasoningEffort(
          record.reasoningEffort,
          "Hosted runtime assistant configuration tool reasoningEffort",
        );
  const provider =
    record.provider === undefined
      ? undefined
      : parseHostedRuntimeAssistantProvider(
          record.provider,
          "Hosted runtime assistant configuration tool provider",
        );
  if (model === undefined) {
    if (provider !== undefined) {
      return reasoningEffort === undefined
        ? { action, provider }
        : { action, provider, reasoningEffort };
    }
    if (reasoningEffort === undefined) {
      throw new TypeError(
        "Hosted runtime assistant configuration update requires a model, provider, or reasoning effort.",
      );
    }
    return { action, reasoningEffort };
  }

  return {
    action,
    model,
    ...(provider === undefined ? {} : { provider }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  };
}

export function parseHostedRuntimeAssistantConfigurationControlRequest(
  value: unknown,
): HostedRuntimeAssistantConfigurationControlRequest {
  const record = requireObject(
    value,
    "Hosted runtime assistant configuration control request",
  );
  const action = requireString(
    record.action,
    "Hosted runtime assistant configuration control request action",
  );
  if (action === "read") {
    assertAllowedObjectKeys(
      record,
      new Set(["action"]),
      "Hosted runtime assistant configuration control read request",
    );
    return { action };
  }
  if (action !== "update") {
    throw new TypeError(
      "Hosted runtime assistant configuration control action is not supported.",
    );
  }

  assertAllowedObjectKeys(
    record,
    new Set([
      "action",
      "assistantInputId",
      "model",
      "provider",
      "reasoningEffort",
    ]),
    "Hosted runtime assistant configuration control update request",
  );
  const assistantInputId = requireString(
    record.assistantInputId,
    "Hosted runtime assistant configuration control assistantInputId",
  );
  if (!/^ain_[0-9a-f]{32}$/u.test(assistantInputId)) {
    throw new TypeError(
      "Hosted runtime assistant configuration control assistantInputId is invalid.",
    );
  }
  const changes = parseHostedRuntimeAssistantConfigurationChanges(
    record,
    "Hosted runtime assistant configuration control",
  );
  return { action, assistantInputId, ...changes };
}

function parseHostedRuntimeAssistantConfigurationChanges(
  record: Record<string, unknown>,
  label: string,
):
  | {
      model: HostedAssistantProductModel;
      provider?: HostedAssistantProvider;
      reasoningEffort?: HostedAssistantReasoningEffort;
    }
  | {
      model?: never;
      provider: HostedAssistantProvider;
      reasoningEffort?: HostedAssistantReasoningEffort;
    }
  | {
      model?: never;
      provider?: never;
      reasoningEffort: HostedAssistantReasoningEffort;
    } {
  const model =
    record.model === undefined
      ? undefined
      : parseHostedRuntimeAssistantProductModel(record.model, `${label} model`);
  const provider =
    record.provider === undefined
      ? undefined
      : parseHostedRuntimeAssistantProvider(
          record.provider,
          `${label} provider`,
        );
  const reasoningEffort =
    record.reasoningEffort === undefined
      ? undefined
      : parseHostedRuntimeAssistantReasoningEffort(
          record.reasoningEffort,
          `${label} reasoningEffort`,
        );
  if (model === undefined) {
    if (provider !== undefined) {
      return reasoningEffort === undefined
        ? { provider }
        : { provider, reasoningEffort };
    }
    if (reasoningEffort === undefined) {
      throw new TypeError(
        `${label} update requires a model, provider, or reasoning effort.`,
      );
    }
    return { reasoningEffort };
  }
  return {
    model,
    ...(provider === undefined ? {} : { provider }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  };
}

export function parseHostedRuntimeAssistantConfigurationToolResponse(
  value: unknown,
): HostedRuntimeAssistantConfigurationToolResponse {
  const record = requireObject(
    value,
    "Hosted runtime assistant configuration tool response",
  );
  assertAllowedObjectKeys(
    record,
    new Set(["action", "result"]),
    "Hosted runtime assistant configuration tool response",
  );
  const action = requireString(
    record.action,
    "Hosted runtime assistant configuration tool response action",
  );
  const result = requireObject(
    record.result,
    "Hosted runtime assistant configuration tool response result",
  );
  if (action === "read") {
    return {
      action,
      result: parseHostedRuntimeAssistantConfigurationSnapshot(result, {
        extraKeys: [],
      }),
    };
  }
  if (action !== "update") {
    throw new TypeError(
      "Hosted runtime assistant configuration tool response action is not supported.",
    );
  }

  const snapshot = parseHostedRuntimeAssistantConfigurationSnapshot(result, {
    extraKeys: ["appliesAt", "requiredPlan", "status"],
  });
  const appliesAt = requireString(
    result.appliesAt,
    "Hosted runtime assistant configuration tool appliesAt",
  );
  if (appliesAt !== "next_turn") {
    throw new TypeError(
      "Hosted runtime assistant configuration tool appliesAt is not supported.",
    );
  }
  const requiredPlan =
    result.requiredPlan === null
      ? null
      : requireString(
          result.requiredPlan,
          "Hosted runtime assistant configuration tool requiredPlan",
        );
  if (requiredPlan !== null && requiredPlan !== "edge" && requiredPlan !== "max") {
    throw new TypeError(
      "Hosted runtime assistant configuration tool requiredPlan is not supported.",
    );
  }

  return {
    action,
    result: {
      ...snapshot,
      appliesAt,
      requiredPlan,
      status: parseHostedRuntimeAssistantConfigurationUpdateStatus(
        result.status,
      ),
    },
  };
}

function parseHostedRuntimeAssistantConfigurationSnapshot(
  record: Record<string, unknown>,
  options: { extraKeys: readonly string[] },
): HostedRuntimeAssistantConfigurationSnapshot {
  assertAllowedObjectKeys(
    record,
    new Set([
      "availableModels",
      "availableProviders",
      "availableReasoningEfforts",
      "configurationAvailable",
      "dormantSolPreference",
      "model",
      "provider",
      "reasoningEffort",
      "solAvailable",
      ...options.extraKeys,
    ]),
    "Hosted runtime assistant configuration tool response result",
  );
  const availableModels = requireArray(
    record.availableModels,
    "Hosted runtime assistant configuration availableModels",
  ).map((model) =>
    parseHostedRuntimeAssistantProductModel(
      model,
      "Hosted runtime assistant configuration available model",
    ),
  );
  const configurationAvailable = requireBoolean(
    record.configurationAvailable,
    "Hosted runtime assistant configuration configurationAvailable",
  );
  const hasAvailableProviders = Object.hasOwn(record, "availableProviders");
  const hasProvider = Object.hasOwn(record, "provider");
  if (hasAvailableProviders !== hasProvider) {
    throw new TypeError(
      "Hosted runtime assistant configuration provider fields must be supplied together.",
    );
  }
  const availableProviders = hasAvailableProviders
    ? requireArray(
        record.availableProviders,
        "Hosted runtime assistant configuration availableProviders",
      ).map((provider) =>
        parseHostedRuntimeAssistantProvider(
          provider,
          "Hosted runtime assistant configuration available provider",
        ),
      )
    : configurationAvailable
    ? [HOSTED_ASSISTANT_DEFAULT_PROVIDER]
    : [];
  const availableReasoningEfforts = requireArray(
    record.availableReasoningEfforts,
    "Hosted runtime assistant configuration availableReasoningEfforts",
  ).map((effort) =>
    parseHostedRuntimeAssistantReasoningEffort(
      effort,
      "Hosted runtime assistant configuration available reasoning effort",
    ),
  );

  return {
    availableModels,
    availableProviders,
    availableReasoningEfforts,
    configurationAvailable,
    dormantSolPreference: requireBoolean(
      record.dormantSolPreference,
      "Hosted runtime assistant configuration dormantSolPreference",
    ),
    model: parseHostedRuntimeAssistantProductModel(
      record.model,
      "Hosted runtime assistant configuration model",
    ),
    provider: hasProvider
      ? parseHostedRuntimeAssistantProvider(
          record.provider,
          "Hosted runtime assistant configuration provider",
        )
      : HOSTED_ASSISTANT_DEFAULT_PROVIDER,
    reasoningEffort: parseHostedRuntimeAssistantReasoningEffort(
      record.reasoningEffort,
      "Hosted runtime assistant configuration reasoningEffort",
    ),
    solAvailable: requireBoolean(
      record.solAvailable,
      "Hosted runtime assistant configuration solAvailable",
    ),
  };
}

function parseHostedRuntimeAssistantProvider(value: unknown, label: string) {
  if (!isHostedAssistantProvider(value)) {
    throw new TypeError(`${label} is not supported.`);
  }
  return value;
}

function parseHostedRuntimeAssistantProductModel(
  value: unknown,
  label: string,
) {
  if (!isHostedAssistantProductModel(value)) {
    throw new TypeError(`${label} is not supported.`);
  }
  return value;
}

function parseHostedRuntimeAssistantReasoningEffort(
  value: unknown,
  label: string,
) {
  if (!isHostedAssistantReasoningEffort(value)) {
    throw new TypeError(`${label} is not supported.`);
  }
  return value;
}

function parseHostedRuntimeAssistantConfigurationUpdateStatus(
  value: unknown,
): HostedRuntimeAssistantConfigurationUpdateStatus {
  const status = requireString(
    value,
    "Hosted runtime assistant configuration tool status",
  );
  if (
    status !== "unchanged" &&
    status !== "unavailable" &&
    status !== "updated" &&
    status !== "upgrade_required"
  ) {
    throw new TypeError(
      "Hosted runtime assistant configuration tool status is not supported.",
    );
  }
  return status;
}
