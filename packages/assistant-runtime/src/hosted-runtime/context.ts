import { existsSync } from "node:fs";
import path from "node:path";

import { VAULT_LAYOUT } from "@murphai/contracts";
import {
  type HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";
import {
  createAssistantFoodAutoLogHooks,
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from "@murphai/assistant-engine";
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

type HostedAssistantAutomationCursor = Awaited<
  ReturnType<typeof readAssistantAutomationState>
>["inboxScanCursor"];

type HostedAssistantAutoReplyEntry = {
  channel: string;
  cursor: HostedAssistantAutomationCursor | null;
};

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

  const automationState = await readAssistantAutomationState(vaultRoot);
  const currentAutoReply = normalizeHostedAssistantAutoReplyEntries(
    "autoReply" in automationState ? automationState.autoReply : [],
  );
  const nextHostedAutoReplyChannels = resolveHostedAssistantAutoReplyChannels({
    emailAutoReplyEnabled,
    telegramAutoReplyEnabled,
  });
  const nextHostedReplyCursor = needsHostedAutoReplyCursorSeed(
    currentAutoReply,
    nextHostedAutoReplyChannels,
  )
    ? await readLatestPersistedInboxCaptureCursor(vaultRoot)
    : null;
  const nextAutoReply = reconcileHostedAssistantAutoReplyEntries({
    current: currentAutoReply,
    desiredChannels: nextHostedAutoReplyChannels,
    latestCaptureCursor: nextHostedReplyCursor,
  });

  if (!sameHostedAssistantAutoReplyEntries(currentAutoReply, nextAutoReply)) {
    await saveAssistantAutomationState(vaultRoot, {
      version: automationState.version,
      inboxScanCursor: automationState.inboxScanCursor,
      autoReply: nextAutoReply,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    emailAutoReplyEnabled,
    telegramAutoReplyEnabled,
  };
}

function needsHostedAutoReplyCursorSeed(
  currentAutoReply: readonly HostedAssistantAutoReplyEntry[],
  nextHostedAutoReplyChannels: readonly HostedAutoReplyChannel[],
): boolean {
  const currentManagedChannels = new Set(
    currentAutoReply
      .filter((entry) => isHostedManagedAutoReplyChannel(entry.channel))
      .map((entry) => entry.channel),
  );

  return nextHostedAutoReplyChannels.some((channel) => !currentManagedChannels.has(channel));
}

function compareHostedAssistantAutoReplyEntry(
  left: HostedAssistantAutoReplyEntry,
  right: HostedAssistantAutoReplyEntry,
): number {
  return left.channel.localeCompare(right.channel);
}

function sameHostedAssistantAutomationCursor(
  left: HostedAssistantAutomationCursor | null,
  right: HostedAssistantAutomationCursor | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.captureId === right.captureId && left.occurredAt === right.occurredAt;
}

function sameHostedAssistantAutoReplyEntries(
  left: readonly HostedAssistantAutoReplyEntry[],
  right: readonly HostedAssistantAutoReplyEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.channel === right[index]?.channel &&
        sameHostedAssistantAutomationCursor(entry.cursor, right[index]?.cursor ?? null),
    )
  );
}

function isHostedAssistantAutomationCursor(
  value: unknown,
): value is NonNullable<HostedAssistantAutomationCursor> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "captureId" in value &&
      typeof value.captureId === "string" &&
      "occurredAt" in value &&
      typeof value.occurredAt === "string",
  );
}

function normalizeHostedAssistantAutoReplyEntries(
  value: unknown,
): HostedAssistantAutoReplyEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entriesByChannel = new Map<string, HostedAssistantAutoReplyEntry>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const channel = typeof entry.channel === "string" ? entry.channel.trim() : "";
    if (!channel) {
      continue;
    }

    entriesByChannel.set(channel, {
      channel,
      cursor: isHostedAssistantAutomationCursor(entry.cursor) ? entry.cursor : null,
    });
  }

  return [...entriesByChannel.values()].sort(compareHostedAssistantAutoReplyEntry);
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

function reconcileHostedAssistantAutoReplyEntries(input: {
  current: readonly HostedAssistantAutoReplyEntry[];
  desiredChannels: readonly HostedAutoReplyChannel[];
  latestCaptureCursor: HostedAssistantAutomationCursor | null;
}): HostedAssistantAutoReplyEntry[] {
  const currentByChannel = new Map(
    input.current.map((entry) => [entry.channel, entry] as const),
  );
  const preservedEntries = input.current.filter(
    (entry) => !isHostedManagedAutoReplyChannel(entry.channel),
  );
  const managedEntries = input.desiredChannels.map((channel) => {
    const existing = currentByChannel.get(channel);
    return existing ?? { channel, cursor: input.latestCaptureCursor };
  });

  return [...preservedEntries, ...managedEntries].sort(compareHostedAssistantAutoReplyEntry);
}

async function readLatestPersistedInboxCaptureCursor(
  vaultRoot: string,
): Promise<HostedAssistantAutomationCursor | null> {
  const inboxServices = createIntegratedInboxServices();
  const latestCapture = (
    await inboxServices.list({
    afterCaptureId: null,
    afterOccurredAt: null,
    limit: 1,
    oldestFirst: false,
    requestId: null,
    sourceId: null,
    vault: vaultRoot,
  })
  ).items[0];

  return latestCapture
    ? {
        captureId: latestCapture.captureId,
        occurredAt: latestCapture.occurredAt,
      }
    : null;
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
