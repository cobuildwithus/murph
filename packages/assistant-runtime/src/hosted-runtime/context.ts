import { existsSync } from "node:fs";
import path from "node:path";

import { VAULT_LAYOUT } from "@murphai/contracts";
import {
  updateAssistantPreferences,
} from "@murphai/core";
import {
  emitHostedExecutionStructuredLog,
  type HostedExecutionMemberChannels,
  type HostedExecutionMemberPreferencesUpdatedWake,
  type HostedExecutionWake,
  type HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
} from "@murphai/hosted-execution/env";
import type { AssistantExecutionContext } from "@murphai/assistant-engine";
import type { AssistantModelTarget } from "@murphai/operator-config/assistant-backend";
import { createAssistantModelTarget } from "@murphai/operator-config/assistant-backend";
import {
  enableAssistantAutoReplyChannelLocal,
  readAssistantAutomationState,
  reconcileManagedAssistantAutoReplyChannelsLocal,
} from "@murphai/assistant-engine/assistant-state";
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
  HostedAssistantRuntimeManagedAutoReplyChannel,
  HostedBootstrapResult,
} from "./models.ts";
import {
  createDefaultHostedManagedAutoReplyChannels,
  HOSTED_INBOUND_SELF_HEAL_AUTO_REPLY_CHANNELS,
} from "./managed-auto-reply.ts";
import {
  HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV,
} from "./codex-runtime-env.ts";
import {
  summarizeHostedAssistantAutoReplyEligibleAfter,
} from "./runtime-logs.ts";

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
  | "linqAutoReplyEnabled"
  | "telegramAutoReplyEnabled"
> & {
  assistantActiveProfileId: string | null;
  assistantActiveProfileManagedBy: "member" | "platform" | null;
  assistantActiveProfileReady: boolean;
  assistantConfigInvalid: boolean;
  assistantConfigPresent: boolean;
};

export type HostedAssistantRuntimeReadinessState = Pick<
  HostedAssistantRuntimeState,
  | "assistantActiveProfileId"
  | "assistantActiveProfileManagedBy"
  | "assistantActiveProfileReady"
  | "assistantConfigInvalid"
  | "assistantConfigPresent"
  | "assistantConfigStatus"
  | "assistantConfigured"
  | "assistantProvider"
>;

export type HostedAssistantAutoReplyReadinessState =
  HostedAssistantRuntimeReadinessState
  & HostedAssistantAutoReplyChannelState;

type HostedAssistantAutoReplyChannelState = Pick<
  HostedBootstrapResult,
  "emailAutoReplyEnabled" | "linqAutoReplyEnabled" | "telegramAutoReplyEnabled"
>;

const EMPTY_HOSTED_AUTO_REPLY_CHANNEL_STATE: HostedAssistantAutoReplyChannelState = {
  emailAutoReplyEnabled: false,
  linqAutoReplyEnabled: false,
  telegramAutoReplyEnabled: false,
};
const DEFAULT_HOSTED_MEMBER_TIME_ZONE = "America/New_York";

export async function prepareHostedWakeContext(
  vaultRoot: string,
  wake: HostedExecutionWake,
  runtimeEnv: Readonly<Record<string, string>>,
  resolvedConfig: {
    channelCapabilities: HostedAssistantRuntimeChannelCapabilities;
    managedAutoReplyChannels?: readonly HostedAssistantRuntimeManagedAutoReplyChannel[];
  },
  options: {
    operatorHomeRoot?: string | null;
  } = {},
): Promise<HostedBootstrapResult | null> {
  const isMemberActivation = wake.kind === "member.activated";
  const memberBootstrap = isMemberActivation
    ? await bootstrapHostedMemberContext(vaultRoot, wake)
    : null;

  await requireHostedBootstrapForWake(vaultRoot, wake);

  const assistantRuntimeState = await bootstrapHostedAssistantRuntimeState(
    vaultRoot,
    wake,
    runtimeEnv,
    resolvedConfig,
    {
      enableAssistantChannelReconciliation:
        wake.kind === "member.activated"
        || wake.kind === "member.channels.updated",
      operatorHomeRoot: options.operatorHomeRoot ?? null,
    },
  );

  return memberBootstrap
    ? {
        ...assistantRuntimeState!,
        vaultCreated: memberBootstrap.vaultCreated,
      }
    : null;
}

export async function prepareHostedAssistantAutomationForWake(
  vaultRoot: string,
  wake: HostedRuntimeEvent,
  runtimeEnv: Readonly<Record<string, string>>,
  resolvedConfig: {
    channelCapabilities: HostedAssistantRuntimeChannelCapabilities;
    managedAutoReplyChannels?: readonly HostedAssistantRuntimeManagedAutoReplyChannel[];
  },
  options: {
    operatorHomeRoot?: string | null;
  } = {},
): Promise<HostedAssistantRuntimeReadinessState> {
  return await bootstrapHostedAssistantRuntimeState(
    vaultRoot,
    wake,
    runtimeEnv,
    resolvedConfig,
    {
      enableAssistantChannelReconciliation: false,
      operatorHomeRoot: options.operatorHomeRoot ?? null,
    },
  );
}

export async function prepareHostedAssistantAutoReplyForWake(
  vaultRoot: string,
  wake: HostedExecutionWake,
  runtimeEnv: Readonly<Record<string, string>>,
  resolvedConfig: {
    channelCapabilities: HostedAssistantRuntimeChannelCapabilities;
    managedAutoReplyChannels?: readonly HostedAssistantRuntimeManagedAutoReplyChannel[];
  },
  options: {
    operatorHomeRoot?: string | null;
  } = {},
): Promise<HostedAssistantAutoReplyReadinessState> {
  return await bootstrapHostedAssistantRuntimeState(
    vaultRoot,
    wake,
    runtimeEnv,
    resolvedConfig,
    {
      enableAssistantChannelReconciliation: false,
      operatorHomeRoot: options.operatorHomeRoot ?? null,
    },
  );
}

export async function bootstrapHostedMemberContext(
  vaultRoot: string,
  wake: HostedExecutionWake,
): Promise<HostedMemberBootstrapResult> {
  const requestId = wake.eventId;
  const vaultServices = createIntegratedVaultServices();
  const vaultMetadataPath = path.join(vaultRoot, VAULT_LAYOUT.metadata);
  const vaultCreated = !existsSync(vaultMetadataPath);

  if (vaultCreated) {
    const timeZone = wake.kind === "member.activated"
      ? wake.timeZone ?? DEFAULT_HOSTED_MEMBER_TIME_ZONE
      : DEFAULT_HOSTED_MEMBER_TIME_ZONE;

    await vaultServices.core.init({
      requestId,
      timezone: timeZone,
      vault: vaultRoot,
    });
  }

  return {
    vaultCreated,
  };
}

export async function applyHostedMemberPreferences(
  vaultRoot: string,
  wake: HostedExecutionMemberPreferencesUpdatedWake,
  causalSeq: string,
  appliedAt: string = wake.occurredAt,
): Promise<void> {
  if (!existsSync(path.join(vaultRoot, VAULT_LAYOUT.metadata))) {
    throw new Error(
      "Hosted member preferences require member.activated bootstrap first.",
    );
  }

  await updateAssistantPreferences({
    ...(wake.causalOrigin ? { causalOrigin: wake.causalOrigin } : {}),
    causalSeq,
    preferences: wake.requestedFields === undefined
      ? wake.preferences
      : {
          ...(wake.requestedFields.includes("persona")
            && wake.preferences.persona !== undefined
            ? { persona: wake.preferences.persona }
            : {}),
          ...(wake.preferences.personality === undefined
            ? {}
            : { personality: wake.preferences.personality }),
          ...(wake.requestedFields.includes("tone")
            && wake.preferences.tone !== undefined
            ? { tone: wake.preferences.tone }
            : {}),
          ...(wake.requestedFields.includes("voice")
            && wake.preferences.voice !== undefined
            ? { voice: wake.preferences.voice }
            : {}),
        },
    updatedAt: appliedAt,
    vaultRoot,
  });
}

async function bootstrapHostedAssistantRuntimeState(
  vaultRoot: string,
  wake: HostedRuntimeEvent,
  runtimeEnv: Readonly<Record<string, string>>,
  resolvedConfig: {
    channelCapabilities: HostedAssistantRuntimeChannelCapabilities;
    managedAutoReplyChannels?: readonly HostedAssistantRuntimeManagedAutoReplyChannel[];
  },
  options: {
    enableAssistantChannelReconciliation: boolean;
    operatorHomeRoot?: string | null;
  },
): Promise<HostedAssistantRuntimeState> {
  const assistantBootstrap = await ensureHostedAssistantOperatorDefaults({
    allowMissing: true,
    env: runtimeEnv,
    homeDirectory: options.operatorHomeRoot ?? undefined,
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
    ? wake.kind === "runtime.timer"
      ? EMPTY_HOSTED_AUTO_REPLY_CHANNEL_STATE
      : await reconcileHostedAssistantChannelState(
        vaultRoot,
        resolveHostedWakeMemberChannels(wake),
        resolveHostedManagedAutoReplyChannels(resolvedConfig),
        assistantBootstrap.configured,
        {
          wake,
        },
      )
    : await ensureHostedAssistantAutoReplyChannelForWake(
        vaultRoot,
        wake,
        resolveHostedManagedAutoReplyChannels(resolvedConfig),
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

function resolveHostedManagedAutoReplyChannels(resolvedConfig: {
  channelCapabilities: HostedAssistantRuntimeChannelCapabilities;
  managedAutoReplyChannels?: readonly HostedAssistantRuntimeManagedAutoReplyChannel[];
}): readonly HostedAssistantRuntimeManagedAutoReplyChannel[] {
  return resolvedConfig.managedAutoReplyChannels
    ?? createDefaultHostedManagedAutoReplyChannels(resolvedConfig.channelCapabilities);
}

async function ensureHostedAssistantAutoReplyChannelForWake(
  vaultRoot: string,
  wake: HostedRuntimeEvent,
  managedAutoReplyChannels: readonly HostedAssistantRuntimeManagedAutoReplyChannel[],
  assistantConfigured: boolean,
): Promise<HostedAssistantAutoReplyChannelState> {
  const target = resolveHostedAutoReplySelfHealTarget(wake, managedAutoReplyChannels);

  if (target === null) {
    return await readEffectiveHostedAssistantAutoReplyState({
      assistantConfigured,
      managedAutoReplyChannels,
      vaultRoot,
    });
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
    return await readEffectiveHostedAssistantAutoReplyState({
      assistantConfigured,
      managedAutoReplyChannels,
      vaultRoot,
    });
  }

  const isManagedChannel = createHostedManagedAutoReplyChannelPredicate(
    managedAutoReplyChannels,
  );
  const beforeState = await readAssistantAutomationState(vaultRoot);
  const beforeEnabled = beforeState.autoReply.some((entry) => entry.channel === target.channel);

  if (!beforeEnabled) {
    await enableAssistantAutoReplyChannelLocal({
      channel: target.channel,
      isManagedChannel,
      latestInputCursor: null,
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
      autoReplyEligibleAfterSummary: summarizeHostedAssistantAutoReplyEligibleAfter(
        afterState.autoReply,
      ),
      capabilityReady: target.capabilityReady,
      channel: target.channel,
      previouslyEnabled: beforeEnabled,
      selfHealEnabled: afterEnabled,
    },
    wake,
    message: "Hosted assistant auto-reply self-heal evaluated.",
    phase: "wake.running",
  });

  return resolveEffectiveHostedAssistantAutoReplyState({
    assistantConfigured,
    autoReplyChannels: afterState.autoReply.map((entry) => entry.channel),
    managedAutoReplyChannels,
  });
}

export async function readHostedAssistantRuntimeState(input: {
  homeDirectory?: string;
} = {}): Promise<HostedAssistantRuntimeReadinessState> {
  const operatorConfig = await readOperatorConfig(input.homeDirectory);
  const hostedAssistantConfig = operatorConfig?.hostedAssistant
    ?? (await resolveHostedAssistantConfig(input.homeDirectory));
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

export async function readHostedAssistantExecutionDefaultTarget(input: {
  homeDirectory?: string;
  runtimeEnv?: Readonly<Record<string, string | undefined>>;
} = {}): Promise<AssistantModelTarget | null> {
  if (input.runtimeEnv) {
    await ensureHostedAssistantOperatorDefaults({
      allowMissing: true,
      env: input.runtimeEnv,
      homeDirectory: input.homeDirectory,
    });
  }

  const operatorConfig = await readOperatorConfig(input.homeDirectory);
  const hostedAssistantConfig = operatorConfig?.hostedAssistant
    ?? (await resolveHostedAssistantConfig(input.homeDirectory));

  const target = createAssistantModelTarget(
    resolveHostedAssistantProviderConfig(hostedAssistantConfig),
  );

  return applyHostedCodexRuntimeCommandTarget({
    codexCommand: readHostedCodexRuntimeCommandOverride(input.runtimeEnv),
    target: applyHostedCodexRuntimeModelProviderTarget({
      modelProviderId: normalizeHostedContextString(
        input.runtimeEnv?.[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV]
          ?? process.env[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV],
      ),
      target,
    }),
  });
}

export async function hydrateHostedExecutionDefaultTarget(
  executionContext: AssistantExecutionContext,
  input: {
    homeDirectory?: string;
    runtimeEnv?: Readonly<Record<string, string | undefined>>;
  } = {},
): Promise<AssistantExecutionContext> {
  if (!executionContext.hosted || executionContext.hosted.defaultTarget) {
    return executionContext;
  }

  const defaultTarget = await readHostedAssistantExecutionDefaultTarget({
    homeDirectory: input.homeDirectory,
    runtimeEnv: input.runtimeEnv,
  });
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

function normalizeHostedContextString(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readHostedCodexRuntimeCommandOverride(
  runtimeEnv: Readonly<Record<string, string | undefined>> | undefined,
): string | null {
  const env = runtimeEnv ?? process.env;
  const command = normalizeHostedContextString(
    env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV],
  );
  if (!command) {
    return null;
  }

  // prepareHostedCodexRuntimeEnvironment owns validation. Keep this projection
  // test-only so hosted production cannot grow an executable selector path here.
  if (
    normalizeHostedContextString(env.NODE_ENV) !== "test" ||
    !path.isAbsolute(command)
  ) {
    return null;
  }

  return command;
}

function applyHostedCodexRuntimeCommandTarget(input: {
  codexCommand: string | null;
  target: AssistantModelTarget | null;
}): AssistantModelTarget | null {
  if (
    !input.target ||
    !input.codexCommand
  ) {
    return input.target;
  }

  if (input.codexCommand === input.target.codexCommand) {
    return input.target;
  }

  return {
    ...input.target,
    codexCommand: input.codexCommand,
  };
}

function applyHostedCodexRuntimeModelProviderTarget(input: {
  modelProviderId?: string | null;
  target: AssistantModelTarget | null;
}): AssistantModelTarget | null {
  if (!input.target) {
    return input.target;
  }

  if (
    !input.modelProviderId
    || input.modelProviderId === input.target.modelProvider
  ) {
    return input.target;
  }

  return {
    ...input.target,
    modelProvider: input.modelProviderId,
  };
}

export async function reconcileHostedAssistantChannelState(
  vaultRoot: string,
  memberChannels: HostedExecutionMemberChannels,
  channelConfig:
    | HostedAssistantRuntimeChannelCapabilities
    | readonly HostedAssistantRuntimeManagedAutoReplyChannel[],
  assistantConfigured: boolean,
  options?: {
    wake?: HostedExecutionWake;
  },
): Promise<Pick<
  HostedBootstrapResult,
  "emailAutoReplyEnabled" | "linqAutoReplyEnabled" | "telegramAutoReplyEnabled"
>> {
  const managedAutoReplyChannels = isHostedManagedAutoReplyChannelList(channelConfig)
    ? channelConfig
    : resolveHostedManagedAutoReplyChannels({
        channelCapabilities: channelConfig,
      });
  const desiredChannels = resolveHostedAssistantAutoReplyChannels({
    assistantConfigured,
    managedAutoReplyChannels,
    memberChannels,
  });
  const reconciliation = await reconcileManagedAssistantAutoReplyChannelsLocal({
    desiredChannels,
    isManagedChannel: createHostedManagedAutoReplyChannelPredicate(managedAutoReplyChannels),
    latestInputCursor: null,
    vault: vaultRoot,
  });
  if (options?.wake) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: {
        assistantConfigured,
        autoReplyChanged: reconciliation.changed,
        autoReplyChannels: reconciliation.state.autoReply.map((entry) => entry.channel).join(","),
        autoReplyEligibleAfterSummary: summarizeHostedAssistantAutoReplyEligibleAfter(
          reconciliation.state.autoReply,
        ),
        desiredAutoReplyChannels: desiredChannels.join(","),
      },
      wake: options.wake,
      message: "Hosted assistant auto-reply channels reconciled.",
      phase: "wake.running",
    });
  }

  return resolveHostedAssistantAutoReplyState(desiredChannels);
}

function resolveHostedAutoReplySelfHealTarget(
  wake: HostedRuntimeEvent,
  managedAutoReplyChannels: readonly HostedAssistantRuntimeManagedAutoReplyChannel[],
): HostedAssistantRuntimeManagedAutoReplyChannel | null {
  if (wake.kind !== "conversation.message") {
    return null;
  }

  if (!HOSTED_INBOUND_SELF_HEAL_AUTO_REPLY_CHANNELS.has(wake.message.channel)) {
    return null;
  }

  return managedAutoReplyChannels.find((channel) => channel.channel === wake.message.channel)
    ?? null;
}

function createHostedManagedAutoReplyChannelPredicate(
  managedAutoReplyChannels: readonly HostedAssistantRuntimeManagedAutoReplyChannel[],
): (channel: string) => boolean {
  const channels = new Set(managedAutoReplyChannels.map((entry) => entry.channel));
  return (channel) => channels.has(channel);
}

function isHostedManagedAutoReplyChannelList(
  channelConfig:
    | HostedAssistantRuntimeChannelCapabilities
    | readonly HostedAssistantRuntimeManagedAutoReplyChannel[],
): channelConfig is readonly HostedAssistantRuntimeManagedAutoReplyChannel[] {
  return Array.isArray(channelConfig);
}

function resolveHostedAssistantAutoReplyChannels(input: {
  assistantConfigured: boolean;
  managedAutoReplyChannels: readonly HostedAssistantRuntimeManagedAutoReplyChannel[];
  memberChannels: HostedExecutionMemberChannels;
}): string[] {
  if (!input.assistantConfigured) {
    return [];
  }

  return input.managedAutoReplyChannels
    .filter((channel) =>
      channel.capabilityReady
      && isHostedMemberChannelEnabled(
        input.memberChannels,
        channel.memberChannel ?? channel.channel,
      )
    )
    .map((channel) => channel.channel);
}

async function readEffectiveHostedAssistantAutoReplyState(input: {
  assistantConfigured: boolean;
  managedAutoReplyChannels: readonly HostedAssistantRuntimeManagedAutoReplyChannel[];
  vaultRoot: string;
}): Promise<HostedAssistantAutoReplyChannelState> {
  const state = await readAssistantAutomationState(input.vaultRoot);
  return resolveEffectiveHostedAssistantAutoReplyState({
    assistantConfigured: input.assistantConfigured,
    autoReplyChannels: state.autoReply.map((entry) => entry.channel),
    managedAutoReplyChannels: input.managedAutoReplyChannels,
  });
}

function resolveEffectiveHostedAssistantAutoReplyState(input: {
  assistantConfigured: boolean;
  autoReplyChannels: readonly string[];
  managedAutoReplyChannels: readonly HostedAssistantRuntimeManagedAutoReplyChannel[];
}): HostedAssistantAutoReplyChannelState {
  if (!input.assistantConfigured) {
    return EMPTY_HOSTED_AUTO_REPLY_CHANNEL_STATE;
  }

  const capableChannels = new Set(
    input.managedAutoReplyChannels
      .filter((channel) => channel.capabilityReady)
      .map((channel) => channel.channel),
  );
  return resolveHostedAssistantAutoReplyState(
    input.autoReplyChannels.filter((channel) => capableChannels.has(channel)),
  );
}

function isHostedMemberChannelEnabled(
  memberChannels: HostedExecutionMemberChannels,
  channel: string,
): boolean {
  return channel === "email"
    ? memberChannels.email
    : channel === "linq"
      ? memberChannels.linq
      : channel === "telegram"
        ? memberChannels.telegram
        : false;
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
  wake: HostedExecutionWake,
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
  wake: HostedExecutionWake,
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
