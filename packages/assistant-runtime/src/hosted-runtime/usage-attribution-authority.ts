import type {
  HostedRuntimeUsageAttribution,
} from "@murphai/hosted-execution/runtime-control";

export interface HostedRuntimeUsageAttributionAuthority {
  recordAssistantInputs(input: {
    assistantInputIds: readonly string[];
    usageAttribution: HostedRuntimeUsageAttribution;
  }): void;
  resolve(
    acceptedInputIds: readonly string[],
    fallback: HostedRuntimeUsageAttribution | null | undefined,
  ): HostedRuntimeUsageAttribution | null;
}

export function createHostedRuntimeUsageAttributionAuthority(
  initial: HostedRuntimeUsageAttribution | null | undefined,
): HostedRuntimeUsageAttributionAuthority {
  const byAssistantInputId = new Map<string, HostedRuntimeUsageAttribution>();
  const fallbackAttribution = initial ? { ...initial } : null;

  return {
    recordAssistantInputs({ assistantInputIds, usageAttribution }) {
      const attribution = { ...usageAttribution };
      for (const assistantInputId of assistantInputIds) {
        byAssistantInputId.set(assistantInputId, attribution);
      }
    },
    resolve(acceptedInputIds, fallback) {
      let resolved: HostedRuntimeUsageAttribution | null = null;
      for (const assistantInputId of acceptedInputIds) {
        const attribution = byAssistantInputId.get(assistantInputId);
        if (attribution) {
          if (resolved && JSON.stringify(resolved) !== JSON.stringify(attribution)) {
            throw new TypeError(
              "Hosted provider accepted inputs cannot combine distinct usage attribution.",
            );
          }
          resolved = attribution;
        }
      }
      return resolved
        ? { ...resolved }
        : fallback
          ? { ...fallback }
          : fallbackAttribution
            ? { ...fallbackAttribution }
            : null;
    },
  };
}
