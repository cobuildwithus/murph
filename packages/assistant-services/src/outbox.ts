import {
  dispatchAssistantOutboxIntent as dispatchMurphAssistantOutboxIntent,
  listAssistantOutboxIntents as listMurphAssistantOutboxIntents,
  shouldDispatchAssistantOutboxIntent as shouldMurphDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
  type AssistantOutboxDispatchHooks,
} from "murph/assistant/outbox";

export type {
  AssistantChannelDelivery,
  AssistantOutboxDispatchHooks,
} from "murph/assistant/outbox";

export async function dispatchAssistantOutboxIntent(
  ...args: Parameters<typeof dispatchMurphAssistantOutboxIntent>
): Promise<Awaited<ReturnType<typeof dispatchMurphAssistantOutboxIntent>>> {
  return await dispatchMurphAssistantOutboxIntent(...args);
}

export async function listAssistantOutboxIntents(
  ...args: Parameters<typeof listMurphAssistantOutboxIntents>
): Promise<Awaited<ReturnType<typeof listMurphAssistantOutboxIntents>>> {
  return await listMurphAssistantOutboxIntents(...args);
}

export function shouldDispatchAssistantOutboxIntent(
  ...args: Parameters<typeof shouldMurphDispatchAssistantOutboxIntent>
): ReturnType<typeof shouldMurphDispatchAssistantOutboxIntent> {
  return shouldMurphDispatchAssistantOutboxIntent(...args);
}
