import {
  readAssistantAutomationState as readMurphAssistantAutomationState,
  saveAssistantAutomationState as saveMurphAssistantAutomationState,
} from "murph/assistant/store";

export async function readAssistantAutomationState(
  ...args: Parameters<typeof readMurphAssistantAutomationState>
): Promise<Awaited<ReturnType<typeof readMurphAssistantAutomationState>>> {
  return await readMurphAssistantAutomationState(...args);
}

export async function saveAssistantAutomationState(
  ...args: Parameters<typeof saveMurphAssistantAutomationState>
): Promise<Awaited<ReturnType<typeof saveMurphAssistantAutomationState>>> {
  return await saveMurphAssistantAutomationState(...args);
}
