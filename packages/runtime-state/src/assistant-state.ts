import path from "node:path";

import {
  ASSISTANT_STATE_DIRECTORY_NAME,
  resolveSiblingLocalStateBucketRoot,
} from "./shared.ts";

export interface AssistantStatePaths {
  absoluteVaultRoot: string;
  assistantStateRoot: string;
  automationPath: string;
  cronDirectory: string;
  cronJobsPath: string;
  cronRunsDirectory: string;
  dailyMemoryDirectory: string;
  diagnosticsDirectory: string;
  diagnosticEventsPath: string;
  diagnosticSnapshotPath: string;
  failoverStatePath: string;
  indexesPath: string;
  longTermMemoryPath: string;
  outboxDirectory: string;
  receiptsDirectory: string;
  sessionsDirectory: string;
  stateDirectory: string;
  statusPath: string;
  transcriptsDirectory: string;
  turnsDirectory: string;
}

export function resolveAssistantStatePaths(vaultRoot: string): AssistantStatePaths {
  const { absoluteVaultRoot, rootPath } = resolveSiblingLocalStateBucketRoot(
    vaultRoot,
    ASSISTANT_STATE_DIRECTORY_NAME,
  );
  const cronDirectory = path.join(rootPath, "cron");
  const diagnosticsDirectory = path.join(rootPath, "diagnostics");
  const receiptsDirectory = path.join(rootPath, "receipts");

  return {
    absoluteVaultRoot,
    assistantStateRoot: rootPath,
    automationPath: path.join(rootPath, "automation.json"),
    cronDirectory,
    cronJobsPath: path.join(cronDirectory, "jobs.json"),
    cronRunsDirectory: path.join(cronDirectory, "runs"),
    dailyMemoryDirectory: path.join(rootPath, "memory"),
    diagnosticsDirectory,
    diagnosticEventsPath: path.join(diagnosticsDirectory, "events.jsonl"),
    diagnosticSnapshotPath: path.join(diagnosticsDirectory, "snapshot.json"),
    failoverStatePath: path.join(rootPath, "failover.json"),
    indexesPath: path.join(rootPath, "indexes.json"),
    longTermMemoryPath: path.join(rootPath, "MEMORY.md"),
    outboxDirectory: path.join(rootPath, "outbox"),
    receiptsDirectory,
    sessionsDirectory: path.join(rootPath, "sessions"),
    stateDirectory: path.join(rootPath, "state"),
    statusPath: path.join(rootPath, "status.json"),
    transcriptsDirectory: path.join(rootPath, "transcripts"),
    // Keep the newer timeline-oriented helper name aligned with the existing
    // receipts directory so in-flight receipt-based tooling stays compatible.
    turnsDirectory: receiptsDirectory,
  };
}
