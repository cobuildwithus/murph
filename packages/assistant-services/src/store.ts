import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  assistantAutomationStateSchema,
  type AssistantAutomationState,
} from "murph";
import {
  resolveAssistantStatePaths,
  writeJsonFileAtomic,
} from "@murph/runtime-state";

const ASSISTANT_AUTOMATION_STATE_VERSION = 2;

export async function readAssistantAutomationState(
  vault: string,
): Promise<AssistantAutomationState> {
  const paths = resolveAssistantStatePaths(vault);
  await mkdir(path.dirname(paths.automationPath), { recursive: true });

  try {
    const raw = await readFile(paths.automationPath, "utf8");
    return assistantAutomationStateSchema.parse(JSON.parse(raw) as unknown);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const initial = assistantAutomationStateSchema.parse({
    version: ASSISTANT_AUTOMATION_STATE_VERSION,
    inboxScanCursor: null,
    autoReplyScanCursor: null,
    autoReplyChannels: [],
    preferredChannels: [],
    autoReplyBacklogChannels: [],
    autoReplyPrimed: true,
    updatedAt: new Date().toISOString(),
  });
  await writeJsonFileAtomic(paths.automationPath, initial);
  return initial;
}

export async function saveAssistantAutomationState(
  vault: string,
  state: AssistantAutomationState,
): Promise<AssistantAutomationState> {
  const paths = resolveAssistantStatePaths(vault);
  await mkdir(path.dirname(paths.automationPath), { recursive: true });
  const parsed = assistantAutomationStateSchema.parse(state);
  await writeJsonFileAtomic(paths.automationPath, parsed);
  return parsed;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT",
  );
}
