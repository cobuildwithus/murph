import {
  runAssistantAutomation as runMurphAssistantAutomation,
  type RunAssistantAutomationInput,
} from "murph/assistant/automation";

export type { RunAssistantAutomationInput };

export async function runAssistantAutomation(input: RunAssistantAutomationInput) {
  return await runMurphAssistantAutomation(input);
}
