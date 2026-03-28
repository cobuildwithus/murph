import { existsSync } from "node:fs";
import path from "node:path";

import {
  readHostedEmailCapabilities,
  type HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";
import {
  createIntegratedInboxCliServices,
} from "@murph/assistant-services/inbox-services";
import {
  createIntegratedVaultCliServices,
} from "@murph/assistant-services/vault-services";
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from "@murph/assistant-services/store";

import type { HostedBootstrapResult } from "./models.ts";

export async function prepareHostedDispatchContext(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest,
  runtimeEnv: Readonly<Record<string, string>>,
): Promise<HostedBootstrapResult | null> {
  const bootstrapResult = dispatch.event.kind === "member.activated"
    ? await bootstrapHostedMemberContext(vaultRoot, dispatch, runtimeEnv)
    : null;

  await requireHostedBootstrapForDispatch(vaultRoot, dispatch);
  await prepareHostedLocalRuntime(vaultRoot, dispatch.eventId);

  if (dispatch.event.kind !== "member.activated") {
    await reconcileHostedAssistantChannelCapabilities(vaultRoot, runtimeEnv);
  }

  return bootstrapResult;
}

export async function bootstrapHostedMemberContext(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest,
  runtimeEnv: Readonly<Record<string, string>>,
): Promise<HostedBootstrapResult> {
  const requestId = dispatch.eventId;
  const vaultServices = createIntegratedVaultCliServices();
  const vaultMetadataPath = path.join(vaultRoot, "vault.json");
  const vaultCreated = !existsSync(vaultMetadataPath);

  if (vaultCreated) {
    await vaultServices.core.init({
      requestId,
      vault: vaultRoot,
    });
  }

  const channelCapabilities = await reconcileHostedAssistantChannelCapabilities(vaultRoot, runtimeEnv);

  return {
    ...channelCapabilities,
    vaultCreated,
  };
}

export async function reconcileHostedAssistantChannelCapabilities(
  vaultRoot: string,
  runtimeEnv: Readonly<Record<string, string>>,
): Promise<Pick<HostedBootstrapResult, "emailAutoReplyEnabled" | "telegramAutoReplyEnabled">> {
  const automationState = await readAssistantAutomationState(vaultRoot);
  const nextAutoReplyChannels = [...automationState.autoReplyChannels];
  let changed = false;
  const emailAutoReplyEnabled = readHostedEmailCapabilities(runtimeEnv).sendReady
    && !nextAutoReplyChannels.includes("email");
  const telegramAutoReplyEnabled = Boolean(normalizeNullableString(runtimeEnv.TELEGRAM_BOT_TOKEN))
    && !nextAutoReplyChannels.includes("telegram");

  if (emailAutoReplyEnabled) {
    nextAutoReplyChannels.push("email");
    changed = true;
  }

  if (telegramAutoReplyEnabled) {
    nextAutoReplyChannels.push("telegram");
    changed = true;
  }

  if (changed) {
    await saveAssistantAutomationState(vaultRoot, {
      ...automationState,
      autoReplyChannels: nextAutoReplyChannels,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    emailAutoReplyEnabled,
    telegramAutoReplyEnabled,
  };
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function requireHostedBootstrapForDispatch(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest,
): Promise<void> {
  if (existsSync(path.join(vaultRoot, "vault.json"))) {
    return;
  }

  if (dispatch.event.kind === "member.activated") {
    return;
  }

  throw new Error(
    `Hosted execution for ${dispatch.event.kind} requires member.activated bootstrap first.`,
  );
}

export async function prepareHostedLocalRuntime(
  vaultRoot: string,
  requestId: string,
): Promise<void> {
  const inboxServices = createIntegratedInboxCliServices();
  await inboxServices.init({
    rebuild: false,
    requestId,
    vault: vaultRoot,
  });
}
