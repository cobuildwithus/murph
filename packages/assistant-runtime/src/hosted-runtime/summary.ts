import {
  type HostedExecutionWake,
} from "@murphai/hosted-execution";

import type {
  HostedBootstrapResult,
  HostedWakeExecutionMetrics,
  HostedMaintenanceMetrics,
} from "./models.ts";
import { assertNever } from "./utils.ts";

export function summarizeWake(
  wake: HostedExecutionWake,
  metrics: HostedWakeExecutionMetrics & HostedMaintenanceMetrics,
): string {
  switch (wake.kind) {
    case "member.activated":
      return `Processed member activation (${formatHostedBootstrapResult(metrics.bootstrapResult)}).`;
    case "member.channels.updated":
      return "Processed member channel sync.";
    case "conversation.message":
      switch (wake.message.channel) {
        case "linq":
          return "Persisted Linq capture on the hosted conversation lane.";
        case "telegram":
          return "Persisted Telegram capture on the hosted conversation lane.";
        case "email":
          return "Persisted hosted email capture on the hosted conversation lane.";
      }
      return assertNever(wake.message);
    case "assistant.cron.tick":
      return `Processed assistant cron tick (${wake.reason}) on the hosted assistant lane.`;
    case "device-sync.wake":
      return `Processed device-sync wake (${wake.reason}) on the hosted device-sync lane.${formatDeviceSyncSuffix(metrics)}`;
    case "vault.share.accepted": {
      const importedFoods = metrics.shareImportResult?.foods.length ?? 0;
      const importedProtocols = metrics.shareImportResult?.protocols.length ?? 0;
      const importedRecipes = metrics.shareImportResult?.recipes.length ?? 0;
      const loggedMeal = metrics.shareImportResult?.meal ? " Logged one meal entry from the shared food." : "";
      const title = metrics.shareImportTitle ?? wake.share.shareId;
      return `Imported share pack "${title}" (${importedFoods} foods, ${importedProtocols} protocols, ${importedRecipes} recipes).${loggedMeal}`;
    }
  }

  return assertNever(wake);
}

function formatDeviceSyncSuffix(metrics: HostedMaintenanceMetrics): string {
  return ` Device sync jobs: ${metrics.deviceSyncProcessed}${metrics.deviceSyncSkipped ? " (skipped: providers not configured)." : "."}`;
}

function formatHostedBootstrapResult(result: HostedBootstrapResult | null): string {
  if (!result) {
    return "bootstrap state unavailable";
  }

  return [
    result.vaultCreated
      ? "created the canonical vault"
      : "reused the canonical vault",
    formatHostedAssistantBootstrap(result),
    result.emailAutoReplyEnabled
      ? "hosted email auto-reply ready"
      : "hosted email auto-reply unavailable",
    result.linqAutoReplyEnabled
      ? "hosted Linq auto-reply ready"
      : "hosted Linq auto-reply unavailable",
    result.telegramAutoReplyEnabled
      ? "hosted Telegram auto-reply ready"
      : "hosted Telegram auto-reply unavailable",
  ].join("; ");
}

function formatHostedAssistantBootstrap(result: HostedBootstrapResult): string {
  if (!result.assistantConfigured || !result.assistantProvider) {
    switch (result.assistantConfigStatus) {
      case "invalid":
        return "hosted assistant config invalid";
      case "missing":
        return "hosted assistant config missing";
      case "unready":
        return "hosted assistant config not ready";
      default:
        return "hosted assistant config unavailable";
    }
  }

  return result.assistantSeeded
    ? `seeded explicit hosted assistant config (${result.assistantProvider})`
    : `reused explicit hosted assistant config (${result.assistantProvider})`;
}
