import path from "node:path";

import {
  ASSISTANT_STATE_DIRECTORY_NAME,
  resolveSiblingLocalStateBucketRoot,
} from "./shared.js";

export interface AssistantStatePaths {
  absoluteVaultRoot: string;
  assistantStateRoot: string;
  automationPath: string;
  cronDirectory: string;
  cronJobsPath: string;
  cronRunsDirectory: string;
  dailyMemoryDirectory: string;
  eventDeadLetterPath: string;
  eventQueuePath: string;
  indexesPath: string;
  longTermMemoryPath: string;
  sessionsDirectory: string;
  transcriptArchivesDirectory: string;
  transcriptContinuationsDirectory: string;
  transcriptMaintenanceDirectory: string;
  transcriptsDirectory: string;
}

export function resolveAssistantStatePaths(vaultRoot: string): AssistantStatePaths {
  const { absoluteVaultRoot, rootPath } = resolveSiblingLocalStateBucketRoot(
    vaultRoot,
    ASSISTANT_STATE_DIRECTORY_NAME,
  );
  const cronDirectory = path.join(rootPath, "cron");

  return {
    absoluteVaultRoot,
    assistantStateRoot: rootPath,
    automationPath: path.join(rootPath, "automation.json"),
    cronDirectory,
    cronJobsPath: path.join(cronDirectory, "jobs.json"),
    cronRunsDirectory: path.join(cronDirectory, "runs"),
    dailyMemoryDirectory: path.join(rootPath, "memory"),
    eventDeadLetterPath: path.join(rootPath, "automation-events.dead-letter.jsonl"),
    eventQueuePath: path.join(rootPath, "automation-events.jsonl"),
    indexesPath: path.join(rootPath, "indexes.json"),
    longTermMemoryPath: path.join(rootPath, "MEMORY.md"),
    sessionsDirectory: path.join(rootPath, "sessions"),
    transcriptArchivesDirectory: path.join(rootPath, "transcript-archives"),
    transcriptContinuationsDirectory: path.join(rootPath, "transcript-continuations"),
    transcriptMaintenanceDirectory: path.join(rootPath, "transcript-maintenance"),
    transcriptsDirectory: path.join(rootPath, "transcripts"),
  };
}

export function resolveAssistantTranscriptArchiveDirectory(
  paths: AssistantStatePaths,
  sessionId: string,
): string {
  return path.join(paths.transcriptArchivesDirectory, sessionId);
}

export function resolveAssistantTranscriptContinuationPath(
  paths: AssistantStatePaths,
  sessionId: string,
): string {
  return path.join(paths.transcriptContinuationsDirectory, `${sessionId}.json`);
}

export function resolveAssistantTranscriptMaintenancePath(
  paths: AssistantStatePaths,
  sessionId: string,
): string {
  return path.join(paths.transcriptMaintenanceDirectory, `${sessionId}.json`);
}
