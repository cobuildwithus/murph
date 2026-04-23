import { existsSync } from "node:fs";
import path from "node:path";

import { VAULT_LAYOUT } from "@murphai/contracts";
import {
  emitHostedExecutionStructuredLog,
  type HostedExecutionMemberChannels,
  type HostedIngressEnvelope,
} from "@murphai/hosted-execution";
import {
  createAssistantFoodAutoLogHooks,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import type { AssistantModelTarget } from "@murphai/operator-config/assistant-backend";
import { createAssistantModelTarget } from "@murphai/operator-config/assistant-backend";
import {
  enableAssistantAutoReplyChannelLocal,
  readAssistantAutomationState,
  reconcileManagedAssistantAutoReplyChannelsLocal,
} from "@murphai/assistant-engine/assistant-state";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import {
  ensureHostedAssistantOperatorDefaults,
  isHostedAssistantProfileReady,
  resolveActiveHostedAssistantProfile,
  resolveHostedAssistantProviderConfig,
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

const HOSTED_AUTO_REPLY_CHANNELS = ["email", "linq", "telegram"] as const;

type HostedAutoReplyChannel = typeof HOSTED_AUTO_REPLY_CHANNELS[number];

type HostedAssistantRuntimeState = Pick<
  HostedBootstrapResult,
  | "assistantConfigStatus"
  | "assistantConfigured"
  | "assistantProvider"
  | "assistantSeeded"
  | "emailAutoReplyEnabled"
  | "linqAutoReplyEnabled"
  | "telegramAutoReplyEnabled"
> & {
  assistantActiveProfileId: string | null;
  assistantActiveProfileManagedBy: "member" | "platform" | null;
  assistantActiveProfileReady: boolean;
  assistantConfigInvalid: boolean;
  assistantConfigPresent: boolean;
};

type HostedAssistantAutoReplyChannelState = Pick<
  HostedBootstrapResult,
  "emailAutoReplyEnabled" | "linqAutoReplyEnabled" | "telegramAutoReplyEnabled"
>;

const EMPTY_HOSTED_AUTO_REPLY_CHANNEL_STATE: HostedAssistantAutoReplyChannelState = {
  emailAutoReplyEnabled: false,
  linqAutoReplyEnabled: false,
  telegramAutoReplyEnabled: false,
};

export async function prepareHostedWakeContext(
  vaultRoot: string,
  wake: HostedIngressEnvelope,
  runtimeEnv: Readonly<Record<string, string>>,
  resolvedConfig: {
    channelCapabilities: HostedAssistantRuntimeChannelCapabilities;
  },
): Promise<HostedBootstrapResult | null> {
  const isMemberActivation = wake.kind === "member.activated";
  const memberBootstrap = isMemberActivation
    ? await bootstrapHostedMemberContext(vaultRoot, wake)
    : null;

  await requireHostedBootstrapForWake(vaultRoot, wake);
  await prepareHostedLocalRuntime(vaultRoot, wake.eventId);

  const assistantRuntimeState = await bootstrapHostedAssistantRuntimeState(
    vaultRoot,
    wake,
    runtimeEnv,
    resolvedConfig.channelCapabilities,
    {
      enableAssistantChannelReconciliation:
        wake.kind === "member.activated"
        || wake.kind === "member.channels.updated",
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
  wake: HostedIngressEnvelope,
): Promise<HostedMemberBootstrapResult> {
  const requestId = wake.eventId;
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
  wake: HostedIngressEnvelope,
  runtimeEnv: Readonly<Record<string, string>>,
  channelCapabilities: HostedAssistantRuntimeChannelCapabilities,
  options: {
    enableAssistantChannelReconciliation: boolean;
  },
): Promise<HostedAssistantRuntimeState> {
  const assistantBootstrap = await ensureHostedAssistantOperatorDefaults({
    allowMissing: true,
    env: runtimeEnv,
  });
  const assistantConfigStatus = normalizeHostedAssistantBootstrapStatus(assistantBootstrap)

  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      assistantConfigStatus,
      assistantConfigured: assistantBootstrap.configured,
      assistantProvider: assistantBootstrap.provider,
      assistantSeeded: assistantBootstrap.seeded,
      bootstrapSource: assistantBootstrap.source,
      hostedAssistantModelConfigured: typeof runtimeEnv.HOSTED_ASSISTANT_MODEL === "string"
        && runtimeEnv.HOSTED_ASSISTANT_MODEL.length > 0,
      hostedAssistantProviderConfigured: typeof runtimeEnv.HOSTED_ASSISTANT_PROVIDER === "string"
        && runtimeEnv.HOSTED_ASSISTANT_PROVIDER.length > 0,
      linqApiTokenConfigured: typeof runtimeEnv.LINQ_API_TOKEN === "string"
        && runtimeEnv.LINQ_API_TOKEN.length > 0,
    },
    wake,
    message: "Hosted assistant bootstrap evaluated.",
    phase: "wake.running",
  });

  const reconciledChannelCapabilities = options.enableAssistantChannelReconciliation
    ? await reconcileHostedAssistantChannelState(
        vaultRoot,
        resolveHostedWakeMemberChannels(wake),
        channelCapabilities,
        assistantBootstrap.configured,
        {
          wake,
        },
      )
    : await ensureHostedAssistantAutoReplyChannelForWake(
        vaultRoot,
        wake,
        channelCapabilities,
        assistantBootstrap.configured,
      );

  return {
    assistantActiveProfileId: null,
    assistantActiveProfileManagedBy: null,
    assistantActiveProfileReady: assistantBootstrap.configured,
    assistantConfigInvalid: assistantBootstrap.source === "invalid",
    assistantConfigPresent: assistantBootstrap.source !== "missing",
    assistantConfigStatus,
    assistantConfigured: assistantBootstrap.configured,
    assistantProvider: assistantBootstrap.provider,
    assistantSeeded: assistantBootstrap.seeded,
    ...reconciledChannelCapabilities,
  };
}

async function ensureHostedAssistantAutoReplyChannelForWake(
  vaultRoot: string,
  wake: HostedIngressEnvelope,
  channelCapabilities: HostedAssistantRuntimeChannelCapabilities,
  assistantConfigured: boolean,
): Promise<HostedAssistantAutoReplyChannelState> {
  const target = resolveHostedAutoReplySelfHealTarget(wake, channelCapabilities);

  if (target === null) {
    return EMPTY_HOSTED_AUTO_REPLY_CHANNEL_STATE;
  }

  if (!assistantConfigured || !target.capabilityReady) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: {
        assistantConfigured,
        autoReplyChanged: false,
        capabilityReady: target.capabilityReady,
        channel: target.channel,
        reason: !assistantConfigured ? "assistant_unconfigured" : "channel_unavailable",
      },
      wake,
      message: "Hosted assistant auto-reply self-heal skipped.",
      phase: "wake.running",
    });
    return EMPTY_HOSTED_AUTO_REPLY_CHANNEL_STATE;
  }

  const beforeState = await readAssistantAutomationState(vaultRoot);
  const beforeEnabled = beforeState.autoReply.some((entry) => entry.channel === target.channel);

  if (!beforeEnabled) {
    await enableAssistantAutoReplyChannelLocal({
      channel: target.channel,
      isManagedChannel: isHostedManagedAutoReplyChannel,
      vault: vaultRoot,
    });
  }

  const afterState = beforeEnabled ? beforeState : await readAssistantAutomationState(vaultRoot);
  const afterEnabled = afterState.autoReply.some((entry) => entry.channel === target.channel);

  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      assistantConfigured,
      autoReplyChanged: beforeEnabled !== afterEnabled,
      autoReplyChannels: afterState.autoReply.map((entry) => entry.channel).join(","),
      autoReplyCursorSummary: afterState.autoReply.map((entry) =>
        `${entry.channel}:${entry.cursor?.captureId ?? "null"}`
      ).join(","),
      capabilityReady: target.capabilityReady,
      channel: target.channel,
      previouslyEnabled: beforeEnabled,
      selfHealEnabled: afterEnabled,
    },
    wake,
    message: "Hosted assistant auto-reply self-heal evaluated.",
    phase: "wake.running",
  });

  return resolveHostedAssistantAutoReplyState(afterState.autoReply.map((entry) => entry.channel));
}

export async function readHostedAssistantRuntimeState(): Promise<Pick<
  HostedAssistantRuntimeState,
  | "assistantActiveProfileId"
  | "assistantActiveProfileManagedBy"
  | "assistantActiveProfileReady"
  | "assistantConfigInvalid"
  | "assistantConfigPresent"
  | "assistantConfigStatus"
  | "assistantConfigured"
  | "assistantProvider"
>> {
  const operatorConfig = await readOperatorConfig();
  const hostedAssistantConfig = operatorConfig?.hostedAssistant
    ?? (await resolveHostedAssistantConfig());
  const hostedAssistantState = resolveHostedAssistantOperatorDefaultsState(hostedAssistantConfig);
  const activeProfile = resolveActiveHostedAssistantProfile(hostedAssistantConfig);
  const assistantConfigStatus = operatorConfig?.hostedAssistantInvalid === true
    ? "invalid"
    : hostedAssistantConfig === null
      ? "missing"
      : hostedAssistantState.configured
        ? "saved"
        : "unready";

  return {
    assistantActiveProfileId: activeProfile?.id ?? null,
    assistantActiveProfileManagedBy: activeProfile?.managedBy ?? null,
    assistantActiveProfileReady: isHostedAssistantProfileReady(activeProfile),
    assistantConfigInvalid: operatorConfig?.hostedAssistantInvalid === true,
    assistantConfigPresent: hostedAssistantConfig !== null,
    assistantConfigStatus,
    assistantConfigured: hostedAssistantState.configured,
    assistantProvider: hostedAssistantState.provider,
  };
}

export async function readHostedAssistantExecutionDefaultTarget(): Promise<AssistantModelTarget | null> {
  const operatorConfig = await readOperatorConfig();
  const hostedAssistantConfig = operatorConfig?.hostedAssistant
    ?? (await resolveHostedAssistantConfig());

  return createAssistantModelTarget(
    resolveHostedAssistantProviderConfig(hostedAssistantConfig),
  );
}

export async function hydrateHostedExecutionDefaultTarget(
  executionContext: AssistantExecutionContext,
): Promise<AssistantExecutionContext> {
  if (!executionContext.hosted || executionContext.hosted.defaultTarget) {
    return executionContext;
  }

  const defaultTarget = await readHostedAssistantExecutionDefaultTarget();
  if (!defaultTarget) {
    return executionContext;
  }

  return {
    ...executionContext,
    hosted: {
      ...executionContext.hosted,
      defaultTarget,
    },
  };
}

export async function reconcileHostedAssistantChannelState(
  vaultRoot: string,
  memberChannels: HostedExecutionMemberChannels,
  channelCapabilities: HostedAssistantRuntimeChannelCapabilities,
  assistantConfigured: boolean,
  options?: {
    wake?: HostedIngressEnvelope;
  },
): Promise<Pick<
  HostedBootstrapResult,
  "emailAutoReplyEnabled" | "linqAutoReplyEnabled" | "telegramAutoReplyEnabled"
>> {
  const emailAutoReplyEnabled = assistantConfigured
    && memberChannels.email
    && channelCapabilities.emailSendReady;
  const linqAutoReplyEnabled = assistantConfigured
    && memberChannels.linq;
  const telegramAutoReplyEnabled = assistantConfigured
    && memberChannels.telegram
    && channelCapabilities.telegramBotConfigured;

  const desiredChannels = resolveHostedAssistantAutoReplyChannels({
    emailAutoReplyEnabled,
    linqAutoReplyEnabled,
    telegramAutoReplyEnabled,
  });
  const reconciliation = await reconcileManagedAssistantAutoReplyChannelsLocal({
    desiredChannels,
    isManagedChannel: isHostedManagedAutoReplyChannel,
    vault: vaultRoot,
  });
  if (options?.wake) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: {
        assistantConfigured,
        autoReplyChanged: reconciliation.changed,
        autoReplyChannels: reconciliation.state.autoReply.map((entry) => entry.channel).join(","),
        autoReplyCursorSummary: reconciliation.state.autoReply.map((entry) =>
          `${entry.channel}:${entry.cursor?.captureId ?? "null"}`
        ).join(","),
        desiredAutoReplyChannels: desiredChannels.join(","),
      },
      wake: options.wake,
      message: "Hosted assistant auto-reply channels reconciled.",
      phase: "wake.running",
    });
  }

  return {
    emailAutoReplyEnabled,
    linqAutoReplyEnabled,
    telegramAutoReplyEnabled,
  };
}

function resolveHostedAutoReplySelfHealTarget(
  wake: HostedIngressEnvelope,
  channelCapabilities: HostedAssistantRuntimeChannelCapabilities,
): {
  capabilityReady: boolean;
  channel: HostedAutoReplyChannel;
} | null {
  if (wake.kind !== "conversation.message") {
    return null;
  }

  switch (wake.message.channel) {
    case "email":
      return {
        capabilityReady: channelCapabilities.emailSendReady,
        channel: "email",
      };
    case "linq":
      return {
        capabilityReady: true,
        channel: "linq",
      };
    case "telegram":
      return {
        capabilityReady: channelCapabilities.telegramBotConfigured,
        channel: "telegram",
      };
  }
}

function isHostedManagedAutoReplyChannel(channel: string): channel is HostedAutoReplyChannel {
  return channel === "email" || channel === "linq" || channel === "telegram";
}

function resolveHostedAssistantAutoReplyChannels(input: {
  emailAutoReplyEnabled: boolean;
  linqAutoReplyEnabled: boolean;
  telegramAutoReplyEnabled: boolean;
}): HostedAutoReplyChannel[] {
  const nextChannels: HostedAutoReplyChannel[] = [];

  if (input.emailAutoReplyEnabled) {
    nextChannels.push("email");
  }

  if (input.linqAutoReplyEnabled) {
    nextChannels.push("linq");
  }

  if (input.telegramAutoReplyEnabled) {
    nextChannels.push("telegram");
  }

  return nextChannels;
}

function resolveHostedAssistantAutoReplyState(
  autoReplyChannels: readonly string[],
): HostedAssistantAutoReplyChannelState {
  const channelSet = new Set(autoReplyChannels);

  return {
    emailAutoReplyEnabled: channelSet.has("email"),
    linqAutoReplyEnabled: channelSet.has("linq"),
    telegramAutoReplyEnabled: channelSet.has("telegram"),
  };
}

function resolveHostedWakeMemberChannels(
  wake: HostedIngressEnvelope,
): HostedExecutionMemberChannels {
  if (
    wake.kind === "member.activated"
    || wake.kind === "member.channels.updated"
  ) {
    return wake.memberChannels;
  }

  throw new TypeError(
    `Hosted execution ${wake.kind} does not carry member channel state.`,
  );
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

export async function requireHostedBootstrapForWake(
  vaultRoot: string,
  wake: HostedIngressEnvelope,
): Promise<void> {
  if (existsSync(path.join(vaultRoot, VAULT_LAYOUT.metadata))) {
    return;
  }

  if (wake.kind === "member.activated") {
    return;
  }

  throw new Error(
    `Hosted execution for ${wake.kind} requires member.activated bootstrap first.`,
  );
}

export async function prepareHostedLocalRuntime(
  vaultRoot: string,
  requestId: string,
): Promise<void> {
  const inboxServices = createIntegratedInboxServices();
  await inboxServices.init({
    rebuild: true,
    requestId,
    vault: vaultRoot,
  });
}
