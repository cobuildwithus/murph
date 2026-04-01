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
  distillationsDirectory: string;
  diagnosticEventsPath: string;
  diagnosticSnapshotPath: string;
  failoverStatePath: string;
  indexesPath: string;
  journalsDirectory: string;
  longTermMemoryPath: string;
  outboxDirectory: string;
  outboxQuarantineDirectory: string;
  providerRouteRecoveryDirectory: string;
  providerRouteRecoverySecretsDirectory: string;
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
  const { absoluteVaultRoot, rootPath } = resolveSiblingLocalStateBucketRoot(
    vaultRoot,
    ASSISTANT_STATE_DIRECTORY_NAME,
  );
  const cronDirectory = path.join(rootPath, "cron");
  const diagnosticsDirectory = path.join(rootPath, "diagnostics");
  const distillationsDirectory = path.join(rootPath, "distillations");
  const journalsDirectory = path.join(rootPath, "journals");
  const outboxDirectory = path.join(rootPath, "outbox");
  const turnsDirectory = path.join(rootPath, "receipts");
  const secretsDirectory = path.join(rootPath, "secrets");
  const sessionSecretsDirectory = path.join(secretsDirectory, "sessions");
  const providerRouteRecoverySecretsDirectory = path.join(
    secretsDirectory,
    "provider-route-recovery",
  );
  const usageDirectory = path.join(rootPath, "usage");

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
    distillationsDirectory,
    diagnosticSnapshotPath: path.join(diagnosticsDirectory, "snapshot.json"),
    failoverStatePath: path.join(rootPath, "failover.json"),
    indexesPath: path.join(rootPath, "indexes.json"),
    journalsDirectory,
    longTermMemoryPath: path.join(rootPath, "MEMORY.md"),
    outboxDirectory,
    outboxQuarantineDirectory: path.join(outboxDirectory, ".quarantine"),
    providerRouteRecoveryDirectory: path.join(rootPath, "provider-route-recovery"),
    providerRouteRecoverySecretsDirectory,
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
