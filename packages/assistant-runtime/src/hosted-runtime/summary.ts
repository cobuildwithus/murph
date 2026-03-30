import type { HostedExecutionDispatchRequest } from "@murph/hosted-execution";

import type {
  HostedBootstrapResult,
  HostedDispatchExecutionMetrics,
  HostedMaintenanceMetrics,
} from "./models.ts";
import { assertNever } from "./utils.ts";

export function summarizeDispatch(
  dispatch: HostedExecutionDispatchRequest,
  metrics: HostedDispatchExecutionMetrics & HostedMaintenanceMetrics,
): string {
  const suffix = ` Parser jobs: ${metrics.parserProcessed}. Device sync jobs: ${metrics.deviceSyncProcessed}${metrics.deviceSyncSkipped ? " (skipped: providers not configured)." : "."}`;

  switch (dispatch.event.kind) {
    case "member.activated":
      return `Processed member activation (${formatHostedBootstrapResult(metrics.bootstrapResult)}) and ran the hosted maintenance loop.${suffix}`;
    case "linq.message.received":
      return `Persisted Linq capture and ran the hosted maintenance loop.${suffix}`;
    case "telegram.message.received":
      return `Persisted Telegram capture and ran the hosted maintenance loop.${suffix}`;
    case "email.message.received":
      return `Persisted hosted email capture and ran the hosted maintenance loop.${suffix}`;
    case "assistant.cron.tick":
      return `Processed assistant cron tick (${dispatch.event.reason}) and ran the hosted maintenance loop.${suffix}`;
    case "device-sync.wake":
      return `Processed device-sync wake (${dispatch.event.reason}) and ran the hosted maintenance loop.${suffix}`;
    case "vault.share.accepted": {
      const importedFoods = metrics.shareImportResult?.foods.length ?? 0;
      const importedProtocols = metrics.shareImportResult?.protocols.length ?? 0;
      const importedRecipes = metrics.shareImportResult?.recipes.length ?? 0;
      const loggedMeal = metrics.shareImportResult?.meal ? " Logged one meal entry from the shared food." : "";
      const title = metrics.shareImportTitle ?? dispatch.event.share.shareId;
      return `Imported share pack "${title}" (${importedFoods} foods, ${importedProtocols} protocols, ${importedRecipes} recipes).${loggedMeal}${suffix}`;
    }
    case "gateway.message.send":
      return `Queued a hosted gateway reply for ${dispatch.event.sessionKey} and ran the hosted maintenance loop.${suffix}`;
    default:
      return assertNever(dispatch.event);
  }
}

function formatHostedBootstrapResult(result: HostedBootstrapResult | null): string {
  if (!result) {
    return "bootstrap state unavailable";
  }

  return [
    result.vaultCreated
      ? "created the canonical vault"
      : "reused the canonical vault",
    result.emailAutoReplyEnabled
      ? "enabled hosted email auto-reply"
      : "kept hosted email auto-reply unchanged",
    result.telegramAutoReplyEnabled
      ? "enabled hosted Telegram auto-reply"
      : "kept hosted Telegram auto-reply unchanged",
  ].join("; ");
}
