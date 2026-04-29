import path from "node:path";

import { resolveRuntimePaths, ASSISTANT_RUNTIME_DIRECTORY_RELATIVE_PATH } from "./runtime-paths.ts";

export interface AssistantStatePaths {
  absoluteVaultRoot: string;
  assistantStateRoot: string;
  automationStatePath: string;
  cronDirectory: string;
  cronAutomationStatePath: string;
  cronJobsPath: string;
  cronRunsDirectory: string;
  diagnosticsDirectory: string;
  diagnosticEventsPath: string;
  diagnosticSnapshotPath: string;
  indexesPath: string;
  journalsDirectory: string;
  issuesDirectory: string;
  issuesPendingDirectory: string;
  outboxDirectory: string;
  outboxQuarantineDirectory: string;
  quarantineDirectory: string;
  secretsDirectory: string;
  sessionSecretsDirectory: string;
  resourceBudgetPath: string;
  runtimeEventsPath: string;
  sessionsDirectory: string;
  stateDirectory: string;
  statusPath: string;
  transcriptsDirectory: string;
  turnsDirectory: string;
  usageDirectory: string;
  usagePendingDirectory: string;
}

export function resolveAssistantStatePaths(vaultRoot: string): AssistantStatePaths {
  const { absoluteVaultRoot } = resolveRuntimePaths(vaultRoot);
  const rootPath = path.join(absoluteVaultRoot, ASSISTANT_RUNTIME_DIRECTORY_RELATIVE_PATH);
  const cronDirectory = path.join(rootPath, "cron");
  const diagnosticsDirectory = path.join(rootPath, "diagnostics");
  const journalsDirectory = path.join(rootPath, "journals");
  const issuesDirectory = path.join(rootPath, "issues");
  const outboxDirectory = path.join(rootPath, "outbox");
  const turnsDirectory = path.join(rootPath, "receipts");
  const secretsDirectory = path.join(rootPath, "secrets");
  const sessionSecretsDirectory = path.join(secretsDirectory, "sessions");
  const usageDirectory = path.join(rootPath, "usage");

  return {
    absoluteVaultRoot,
    assistantStateRoot: rootPath,
    automationStatePath: path.join(rootPath, "automation-state.json"),
    cronDirectory,
    cronAutomationStatePath: path.join(cronDirectory, "automation-runtime.json"),
    cronJobsPath: path.join(cronDirectory, "jobs.json"),
    cronRunsDirectory: path.join(cronDirectory, "runs"),
    diagnosticsDirectory,
    diagnosticEventsPath: path.join(diagnosticsDirectory, "events.jsonl"),
    diagnosticSnapshotPath: path.join(diagnosticsDirectory, "snapshot.json"),
    indexesPath: path.join(rootPath, "indexes.json"),
    journalsDirectory,
    issuesDirectory,
    issuesPendingDirectory: path.join(issuesDirectory, "pending"),
    outboxDirectory,
    outboxQuarantineDirectory: path.join(outboxDirectory, ".quarantine"),
    quarantineDirectory: path.join(rootPath, "quarantine"),
    secretsDirectory,
    sessionSecretsDirectory,
    resourceBudgetPath: path.join(rootPath, "runtime-budgets.json"),
    runtimeEventsPath: path.join(journalsDirectory, "runtime-events.jsonl"),
    sessionsDirectory: path.join(rootPath, "sessions"),
    stateDirectory: path.join(rootPath, "state"),
    statusPath: path.join(rootPath, "status.json"),
    transcriptsDirectory: path.join(rootPath, "transcripts"),
    turnsDirectory,
    usageDirectory,
    usagePendingDirectory: path.join(usageDirectory, "pending"),
  };
}
