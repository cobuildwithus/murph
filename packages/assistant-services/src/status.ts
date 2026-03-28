import { refreshAssistantStatusSnapshot as refreshMurphAssistantStatusSnapshot } from "murph/assistant/status";

export async function refreshAssistantStatusSnapshot(
  ...args: Parameters<typeof refreshMurphAssistantStatusSnapshot>
): Promise<Awaited<ReturnType<typeof refreshMurphAssistantStatusSnapshot>>> {
  return await refreshMurphAssistantStatusSnapshot(...args);
}
