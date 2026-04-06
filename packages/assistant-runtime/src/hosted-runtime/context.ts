import { existsSync } from "node:fs";
import path from "node:path";

import {
  readHostedEmailCapabilities,
  type HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";
import {
  createIntegratedInboxServices,
  createIntegratedVaultServices,
  ensureHostedAssistantOperatorDefaults,
  readAssistantAutomationState,
  readOperatorConfig,
  resolveHostedAssistantConfig,
  resolveHostedAssistantOperatorDefaultsState,
  saveAssistantAutomationState,
} from "@murphai/assistant-core";

import type { HostedBootstrapResult } from "./models.ts";

interface HostedMemberBootstrapResult {
  vaultCreated: boolean;
}

type HostedAssistantRuntimeState = Pick<
  HostedBootstrapResult,
  | "assistantConfigStatus"
  | "assistantConfigured"
  | "assistantProvider"
  | "assistantSeeded"
  | "emailAutoReplyEnabled"
  | "telegramAutoReplyEnabled"
>;

export async function prepareHostedDispatchContext(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest,
  runtimeEnv: Readonly<Record<string, string>>,
): Promise<HostedBootstrapResult | null> {
  const isMemberActivation = dispatch.event.kind === "member.activated";
  const memberBootstrap = isMemberActivation
    ? await bootstrapHostedMemberContext(vaultRoot, dispatch)
    : null;

  await requireHostedBootstrapForDispatch(vaultRoot, dispatch);

  const assistantRuntimeState = await bootstrapHostedAssistantRuntimeState(
    vaultRoot,
    runtimeEnv,
    {
      enableChannelCapabilityReconciliation: isMemberActivation,
    },
  );

  await prepareHostedLocalRuntime(vaultRoot, dispatch.eventId);

  return memberBootstrap
    ? {
        ...assistantRuntimeState!,
        vaultCreated: memberBootstrap.vaultCreated,
      }
    : null;
}

export async function bootstrapHostedMemberContext(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest,
): Promise<HostedMemberBootstrapResult> {
  const requestId = dispatch.eventId;
  const vaultServices = createIntegratedVaultServices();
  const vaultMetadataPath = path.join(vaultRoot, "vault.json");
  const vaultCreated = !existsSync(vaultMetadataPath);

  if (vaultCreated) {
    await vaultServices.core.init({
      requestId,
      vault: vaultRoot,
    });
  }

  return {
    vaultCreated,
  };
}

async function bootstrapHostedAssistantRuntimeState(
  vaultRoot: string,
  runtimeEnv: Readonly<Record<string, string>>,
  options: {
    enableChannelCapabilityReconciliation: boolean;
  },
): Promise<HostedAssistantRuntimeState> {
  const assistantBootstrap = await ensureHostedAssistantOperatorDefaults({
    allowMissing: true,
    env: runtimeEnv,
  });
  const channelCapabilities = options.enableChannelCapabilityReconciliation
    ? await reconcileHostedAssistantChannelCapabilities(
        vaultRoot,
        runtimeEnv,
        assistantBootstrap.configured,
      )
    : {
        emailAutoReplyEnabled: false,
        telegramAutoReplyEnabled: false,
      };

  return {
    assistantConfigStatus: normalizeHostedAssistantBootstrapStatus(assistantBootstrap),
    assistantConfigured: assistantBootstrap.configured,
    assistantProvider: assistantBootstrap.provider,
    assistantSeeded: assistantBootstrap.seeded,
    ...channelCapabilities,
  };
}

export async function readHostedAssistantRuntimeState(): Promise<Pick<
  HostedAssistantRuntimeState,
  "assistantConfigStatus" | "assistantConfigured" | "assistantProvider"
>> {
  const operatorConfig = await readOperatorConfig();
  const hostedAssistantConfig = operatorConfig?.hostedAssistant
    ?? (await resolveHostedAssistantConfig());
  const hostedAssistantState = resolveHostedAssistantOperatorDefaultsState(hostedAssistantConfig);
  const assistantConfigStatus = operatorConfig?.hostedAssistantInvalid === true
    ? "invalid"
    : hostedAssistantConfig === null
      ? "missing"
      : hostedAssistantState.configured
        ? "saved"
        : "unready";

  return {
    assistantConfigStatus,
    assistantConfigured: hostedAssistantState.configured,
    assistantProvider: hostedAssistantState.provider,
  };
}

export async function reconcileHostedAssistantChannelCapabilities(
  vaultRoot: string,
  runtimeEnv: Readonly<Record<string, string>>,
  assistantConfigured: boolean,
): Promise<Pick<HostedBootstrapResult, "emailAutoReplyEnabled" | "telegramAutoReplyEnabled">> {
  const emailAutoReplyEnabled = assistantConfigured
    && readHostedEmailCapabilities(runtimeEnv).sendReady;
  const telegramAutoReplyEnabled = assistantConfigured
    && Boolean(normalizeNullableString(runtimeEnv.TELEGRAM_BOT_TOKEN));

  const automationState = await readAssistantAutomationState(vaultRoot);
  const nextAutoReplyChannels = reconcileHostedAssistantChannels(
    automationState.autoReplyChannels,
    {
      emailAutoReplyEnabled,
      telegramAutoReplyEnabled,
    },
  );
  const nextBacklogChannels = reconcileHostedAssistantBacklogChannels(
    automationState.autoReplyBacklogChannels,
    nextAutoReplyChannels,
    emailAutoReplyEnabled,
  );
  const channelsChanged = !sameHostedAssistantChannels(
    automationState.autoReplyChannels,
    nextAutoReplyChannels,
  ) || !sameHostedAssistantChannels(
    automationState.autoReplyBacklogChannels,
    nextBacklogChannels,
  );

  if (channelsChanged) {
    await saveAssistantAutomationState(vaultRoot, {
      ...automationState,
      autoReplyScanCursor: null,
      autoReplyChannels: nextAutoReplyChannels,
      autoReplyBacklogChannels: nextBacklogChannels,
      autoReplyPrimed: false,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    emailAutoReplyEnabled,
    telegramAutoReplyEnabled,
  };
}

function reconcileHostedAssistantChannels(
  currentChannels: readonly string[],
  input: {
    emailAutoReplyEnabled: boolean;
    telegramAutoReplyEnabled: boolean;
  },
): string[] {
  const nextChannels = currentChannels.filter(
    (channel) => channel !== "email" && channel !== "telegram",
  );

  if (input.emailAutoReplyEnabled) {
    nextChannels.push("email");
  }

  if (input.telegramAutoReplyEnabled) {
    nextChannels.push("telegram");
  }

  return nextChannels;
}

function reconcileHostedAssistantBacklogChannels(
  currentChannels: readonly string[],
  nextAutoReplyChannels: readonly string[],
  emailAutoReplyEnabled: boolean,
): string[] {
  const nextChannels = currentChannels.filter(
    (channel) => channel !== "email" && nextAutoReplyChannels.includes(channel),
  );

  if (emailAutoReplyEnabled) {
    nextChannels.push("email");
  }

  return nextChannels;
}

function sameHostedAssistantChannels(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeHostedAssistantBootstrapStatus(
  result: Awaited<ReturnType<typeof ensureHostedAssistantOperatorDefaults>>,
): HostedBootstrapResult["assistantConfigStatus"] {
  if (result.source === "invalid" || result.source === "missing") {
    return result.source;
  }

  if (!result.configured) {
    return "unready";
  }

  return result.source;
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
  const inboxServices = createIntegratedInboxServices();
  await inboxServices.init({
    rebuild: false,
    requestId,
    vault: vaultRoot,
  });
}
