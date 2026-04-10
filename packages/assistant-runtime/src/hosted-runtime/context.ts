import { existsSync } from "node:fs";
import path from "node:path";

import { VAULT_LAYOUT } from "@murphai/contracts";
import {
  type HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";
import {
  createAssistantFoodAutoLogHooks,
} from "@murphai/assistant-engine";
import { reconcileManagedAssistantAutoReplyChannelsLocal } from "@murphai/assistant-engine/assistant-state";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import {
  ensureHostedAssistantOperatorDefaults,
  resolveHostedAssistantOperatorDefaultsState,
} from "@murphai/operator-config/hosted-assistant-config";
import {
  readOperatorConfig,
  resolveHostedAssistantConfig,
} from "@murphai/operator-config/operator-config";

import type {
  HostedAssistantRuntimeChannelCapabilities,
  HostedBootstrapResult,
} from "./models.ts";

interface HostedMemberBootstrapResult {
  vaultCreated: boolean;
}

const HOSTED_AUTO_REPLY_CHANNELS = ["email", "telegram"] as const;

type HostedAutoReplyChannel = typeof HOSTED_AUTO_REPLY_CHANNELS[number];

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
  resolvedConfig: {
    channelCapabilities: HostedAssistantRuntimeChannelCapabilities;
  },
): Promise<HostedBootstrapResult | null> {
  const isMemberActivation = dispatch.event.kind === "member.activated";
  const memberBootstrap = isMemberActivation
    ? await bootstrapHostedMemberContext(vaultRoot, dispatch)
    : null;

  await requireHostedBootstrapForDispatch(vaultRoot, dispatch);
  await prepareHostedLocalRuntime(vaultRoot, dispatch.eventId);

  const assistantRuntimeState = await bootstrapHostedAssistantRuntimeState(
    vaultRoot,
    runtimeEnv,
    resolvedConfig.channelCapabilities,
    {
      enableChannelCapabilityReconciliation: isMemberActivation,
    },
  );

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
  const vaultServices = createIntegratedVaultServices({
    foodAutoLogHooks: createAssistantFoodAutoLogHooks(),
  });
  const vaultMetadataPath = path.join(vaultRoot, VAULT_LAYOUT.metadata);
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
  channelCapabilities: HostedAssistantRuntimeChannelCapabilities,
  options: {
    enableChannelCapabilityReconciliation: boolean;
  },
): Promise<HostedAssistantRuntimeState> {
  const assistantBootstrap = await ensureHostedAssistantOperatorDefaults({
    allowMissing: true,
    env: runtimeEnv,
  });
  const reconciledChannelCapabilities = options.enableChannelCapabilityReconciliation
    ? await reconcileHostedAssistantChannelCapabilities(
        vaultRoot,
        channelCapabilities,
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
    ...reconciledChannelCapabilities,
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
  channelCapabilities: HostedAssistantRuntimeChannelCapabilities,
  assistantConfigured: boolean,
): Promise<Pick<HostedBootstrapResult, "emailAutoReplyEnabled" | "telegramAutoReplyEnabled">> {
  const emailAutoReplyEnabled = assistantConfigured
    && channelCapabilities.emailSendReady;
  const telegramAutoReplyEnabled = assistantConfigured
    && channelCapabilities.telegramBotConfigured;

  await reconcileManagedAssistantAutoReplyChannelsLocal({
    desiredChannels: resolveHostedAssistantAutoReplyChannels({
      emailAutoReplyEnabled,
      telegramAutoReplyEnabled,
    }),
    isManagedChannel: isHostedManagedAutoReplyChannel,
    vault: vaultRoot,
  });

  return {
    emailAutoReplyEnabled,
    telegramAutoReplyEnabled,
  };
}

function isHostedManagedAutoReplyChannel(channel: string): channel is HostedAutoReplyChannel {
  return channel === "email" || channel === "telegram";
}

function resolveHostedAssistantAutoReplyChannels(input: {
  emailAutoReplyEnabled: boolean;
  telegramAutoReplyEnabled: boolean;
}): HostedAutoReplyChannel[] {
  const nextChannels: HostedAutoReplyChannel[] = [];

  if (input.emailAutoReplyEnabled) {
    nextChannels.push("email");
  }

  if (input.telegramAutoReplyEnabled) {
    nextChannels.push("telegram");
  }

  return nextChannels;
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
  if (existsSync(path.join(vaultRoot, VAULT_LAYOUT.metadata))) {
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
