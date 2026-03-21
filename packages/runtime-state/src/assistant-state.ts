import path from "node:path";

import {
  ASSISTANT_STATE_DIRECTORY_NAME,
  resolveSiblingLocalStateBucketRoot,
} from "./shared.js";

export interface AssistantStatePaths {
  absoluteVaultRoot: string;
  assistantStateRoot: string;
  automationPath: string;
  dailyMemoryDirectory: string;
  indexesPath: string;
  longTermMemoryPath: string;
  sessionsDirectory: string;
  transcriptsDirectory: string;
}

export function resolveAssistantStatePaths(vaultRoot: string): AssistantStatePaths {
  const { absoluteVaultRoot, rootPath } = resolveSiblingLocalStateBucketRoot(
    vaultRoot,
    ASSISTANT_STATE_DIRECTORY_NAME,
  );

  return {
    absoluteVaultRoot,
    assistantStateRoot: rootPath,
    automationPath: path.join(rootPath, "automation.json"),
    dailyMemoryDirectory: path.join(rootPath, "memory"),
    indexesPath: path.join(rootPath, "indexes.json"),
    longTermMemoryPath: path.join(rootPath, "MEMORY.md"),
    sessionsDirectory: path.join(rootPath, "sessions"),
    transcriptsDirectory: path.join(rootPath, "transcripts"),
  };
}
