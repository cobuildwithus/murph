import {
  resolveAssistantSelfDeliveryTarget as resolveMurphAssistantSelfDeliveryTarget,
  saveAssistantSelfDeliveryTarget as saveMurphAssistantSelfDeliveryTarget,
} from "murph/operator-config";
import type { AssistantSelfDeliveryTarget } from "murph";

export type { AssistantSelfDeliveryTarget };

export async function resolveAssistantSelfDeliveryTarget(
  ...args: Parameters<typeof resolveMurphAssistantSelfDeliveryTarget>
): Promise<Awaited<ReturnType<typeof resolveMurphAssistantSelfDeliveryTarget>>> {
  return await resolveMurphAssistantSelfDeliveryTarget(...args);
}

export async function saveAssistantSelfDeliveryTarget(
  ...args: Parameters<typeof saveMurphAssistantSelfDeliveryTarget>
): Promise<Awaited<ReturnType<typeof saveMurphAssistantSelfDeliveryTarget>>> {
  return await saveMurphAssistantSelfDeliveryTarget(...args);
}
