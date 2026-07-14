import type {
  HostedRuntimeUsageAttribution,
} from "@murphai/hosted-execution/runtime-control";

export interface HostedRuntimeUsageAttributionAuthority {
  readLatest(): HostedRuntimeUsageAttribution | null;
  recordAssistantInputs(input: {
    assistantInputIds: readonly string[];
    usageAttribution: HostedRuntimeUsageAttribution;
  }): void;
  recordLatest(usageAttribution: HostedRuntimeUsageAttribution | null | undefined): void;
  resolve(
    acceptedInputIds: readonly string[],
    fallback: HostedRuntimeUsageAttribution | null | undefined,
  ): HostedRuntimeUsageAttribution | null;
}

export function createHostedRuntimeUsageAttributionAuthority(
  initial: HostedRuntimeUsageAttribution | null | undefined,
): HostedRuntimeUsageAttributionAuthority {
  const byAssistantInputId = new Map<string, HostedRuntimeUsageAttribution>();
  let latest = initial ? { ...initial } : null;

  return {
    readLatest: () => latest,
    recordAssistantInputs({ assistantInputIds, usageAttribution }) {
      const attribution = { ...usageAttribution };
      latest = attribution;
      for (const assistantInputId of assistantInputIds) {
        byAssistantInputId.set(assistantInputId, attribution);
      }
    },
    recordLatest(usageAttribution) {
      if (usageAttribution) {
        latest = { ...usageAttribution };
      }
    },
    resolve(acceptedInputIds, fallback) {
      for (const assistantInputId of acceptedInputIds) {
        const attribution = byAssistantInputId.get(assistantInputId);
        if (attribution) {
          return { ...attribution };
        }
      }
      return fallback ? { ...fallback } : null;
    },
  };
}
