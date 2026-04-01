import type {
  HostedExecutionBundleKind as RuntimeHostedExecutionBundleKind,
  HostedExecutionBundleRef as RuntimeHostedExecutionBundleRef,
} from "@murphai/runtime-state";

export const HOSTED_EXECUTION_BUNDLE_SLOTS = ["agentState", "vault"] as const;

export type HostedExecutionBundleSlot =
  (typeof HOSTED_EXECUTION_BUNDLE_SLOTS)[number];

export type HostedExecutionBundleSlotMap<TValue> = {
  [slot in HostedExecutionBundleSlot]: TValue;
};

export type HostedExecutionBundlePayloads = HostedExecutionBundleSlotMap<string | null>;
export type HostedExecutionBundleRefs = HostedExecutionBundleSlotMap<RuntimeHostedExecutionBundleRef | null>;

export function createEmptyHostedExecutionBundlePayloads(): HostedExecutionBundlePayloads {
  return mapHostedExecutionBundleSlots(() => null);
}

export function createEmptyHostedExecutionBundleRefs(): HostedExecutionBundleRefs {
  return mapHostedExecutionBundleSlots(() => null);
}

export function mapHostedExecutionBundleSlots<TValue>(
  mapper: (slot: HostedExecutionBundleSlot) => TValue,
): HostedExecutionBundleSlotMap<TValue> {
  return Object.fromEntries(
    HOSTED_EXECUTION_BUNDLE_SLOTS.map((slot) => [slot, mapper(slot)] as const),
  ) as HostedExecutionBundleSlotMap<TValue>;
}

export async function mapHostedExecutionBundleSlotsAsync<TValue>(
  mapper: (slot: HostedExecutionBundleSlot) => Promise<TValue> | TValue,
): Promise<HostedExecutionBundleSlotMap<TValue>> {
  return Object.fromEntries(
    await Promise.all(
      HOSTED_EXECUTION_BUNDLE_SLOTS.map(async (slot) => [slot, await mapper(slot)] as const),
    ),
  ) as HostedExecutionBundleSlotMap<TValue>;
}

export function resolveHostedExecutionBundleKind(
  slot: HostedExecutionBundleSlot,
): RuntimeHostedExecutionBundleKind {
  return slot === "agentState" ? "agent-state" : "vault";
}
