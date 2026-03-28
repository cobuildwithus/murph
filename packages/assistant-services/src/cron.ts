import { getAssistantCronStatus as getMurphAssistantCronStatus } from "murph/assistant/cron";

export async function getAssistantCronStatus(
  ...args: Parameters<typeof getMurphAssistantCronStatus>
): Promise<Awaited<ReturnType<typeof getMurphAssistantCronStatus>>> {
  return await getMurphAssistantCronStatus(...args);
}
