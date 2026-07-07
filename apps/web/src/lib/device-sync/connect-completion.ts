import "server-only";

import { resolveDeviceConnectSourceById } from "@murphai/device-syncd/connect-config";

import {
  buildHostedDeviceSyncMessagingReturnMessageBody,
  resolveHostedDeviceSyncAssignedMessagesReturnDestination,
  resolveHostedDeviceSyncCallbackStatus,
  resolveHostedDeviceSyncMessagingReturnDestination,
  resolveHostedDeviceSyncProviderLabel,
  type HostedDeviceSyncCallbackStatus,
} from "@/src/lib/device-sync/messaging-return-destination";
import type {
  DeviceSyncCompletionContactAction,
  DeviceSyncCompletionDialogModel,
} from "@/src/lib/device-sync/connect-completion-types";
import { buildHostedDeviceSyncSettingsResponse } from "@/src/lib/device-sync/settings-service";
import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";
import type { HostedMemberCoreState } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { getPrisma } from "@/src/lib/prisma";

export const DEVICE_SYNC_COMPLETION_HOME_MARKER = "deviceSyncCompletion";

const DEVICE_SYNC_COMPLETION_REDIRECT_KEYS = [
  "source",
  "connectSource",
  "connectTarget",
  "deviceSyncStatus",
  "deviceSyncProvider",
  "deviceSyncError",
] as const;

export type DeviceSyncCompletionSearchParams = Record<string, string | string[] | undefined>;

interface CompletionCallback {
  connectSource: string | null;
  connectTarget: string | null;
  provider: string | null;
  providerLabel: string | null;
  sourceLabel: string | null;
  status: HostedDeviceSyncCallbackStatus | null;
}

interface CompletionState {
  contactAction: DeviceSyncCompletionContactAction | null;
  connectedSource: HostedDeviceSyncSettingsSource | null;
  loadError: string | null;
  member: HostedMemberCoreState | null;
}

export function buildDeviceSyncCompletionHomeRedirectHref(
  searchParams: DeviceSyncCompletionSearchParams,
): string {
  const params = new URLSearchParams();

  params.set(DEVICE_SYNC_COMPLETION_HOME_MARKER, "1");
  for (const key of DEVICE_SYNC_COMPLETION_REDIRECT_KEYS) {
    const value = readSearchParamString(searchParams, key);
    if (value) {
      params.set(key, value);
    }
  }

  return `/home?${params.toString()}`;
}

export async function resolveDeviceSyncCompletionDialogModel(input: {
  member: HostedMemberCoreState | null;
  searchParams: DeviceSyncCompletionSearchParams;
}): Promise<DeviceSyncCompletionDialogModel | null> {
  if (readSearchParamString(input.searchParams, DEVICE_SYNC_COMPLETION_HOME_MARKER) !== "1") {
    return null;
  }

  const callback = readCompletionCallback(input.searchParams);
  const state = await loadCompletionState({
    callback,
    member: input.member,
  });
  const providerLabel =
    callback.sourceLabel
    ?? resolveConnectedSourceLabel({
      connectSource: callback.connectSource,
      connectTarget: callback.connectTarget,
      source: state.connectedSource,
    })
    ?? state.connectedSource?.providerLabel
    ?? callback.providerLabel
    ?? "Device";
  const connected = callback.status === "connected" && state.connectedSource !== null;
  const failed = callback.status === "error";
  const title = failed
    ? `${providerLabel} connection did not finish`
    : connected
      ? `${providerLabel} is connected`
      : "Device connection complete";

  return {
    contactAction: state.contactAction,
    detail: resolveCompletionDetail({
      connected,
      failed,
      hasContactAction: Boolean(state.contactAction),
      hasMember: Boolean(state.member),
      loadError: state.loadError,
      providerLabel,
      source: state.connectedSource,
    }),
    failed,
    kind: "device-sync",
    retryHref: failed ? "/connect" : null,
    title,
    unverified: !failed && callback.status === "connected" && !connected,
  };
}

function readCompletionCallback(searchParams: DeviceSyncCompletionSearchParams): CompletionCallback {
  const connectSource = readSearchParamString(searchParams, "connectSource");
  const connectTarget = readSearchParamString(searchParams, "connectTarget");
  const provider = readSearchParamString(searchParams, "deviceSyncProvider");

  return {
    connectSource,
    connectTarget,
    provider,
    providerLabel: resolveHostedDeviceSyncProviderLabel(provider),
    sourceLabel: resolveDeviceConnectSourceById(connectSource ?? "")?.label ?? null,
    status: resolveHostedDeviceSyncCallbackStatus(
      readSearchParamString(searchParams, "deviceSyncStatus"),
    ),
  };
}

async function loadCompletionState(input: {
  callback: CompletionCallback;
  member: HostedMemberCoreState | null;
}): Promise<CompletionState> {
  if (!input.member) {
    return {
      contactAction: null,
      connectedSource: null,
      loadError: null,
      member: null,
    };
  }

  try {
    const [settings, routing] = await Promise.all([
      buildHostedDeviceSyncSettingsResponse({ member: input.member }),
      readHostedMemberRoutingState({
        memberId: input.member.id,
        prisma: getPrisma(),
      }),
    ]);
    const connectedSource = findConnectedSource({
      connectSource: input.callback.connectSource,
      connectTarget: input.callback.connectTarget,
      provider: input.callback.provider,
      sources: settings.sources,
    });
    const messageBody = buildHostedDeviceSyncMessagingReturnMessageBody(
      input.callback.sourceLabel
        ?? resolveConnectedSourceLabel({
          connectSource: input.callback.connectSource,
          connectTarget: input.callback.connectTarget,
          source: connectedSource,
        })
        ?? connectedSource?.providerLabel
        ?? input.callback.providerLabel,
    );

    return {
      contactAction: input.callback.status === "connected" && connectedSource !== null
        ? resolvePreferredContactAction({
            hasTelegramRouting: Boolean(routing?.telegramThreadId || routing?.telegramUserId),
            messageBody,
            recipient: routing?.linqRecipientPhone ?? null,
          })
        : null,
      connectedSource,
      loadError: null,
      member: input.member,
    };
  } catch {
    return {
      contactAction: null,
      connectedSource: null,
      loadError: "Could not load your wearable details right now.",
      member: input.member,
    };
  }
}

function findConnectedSource(input: {
  connectSource: string | null;
  connectTarget: string | null;
  provider: string | null;
  sources: readonly HostedDeviceSyncSettingsSource[];
}): HostedDeviceSyncSettingsSource | null {
  const connectSource = normalizeProviderKey(input.connectSource);
  const connectTarget = normalizeProviderKey(input.connectTarget);
  const provider = normalizeProviderKey(input.provider);
  const activeSources = input.sources.filter((source) => source.state === "active");

  if (connectSource || connectTarget) {
    const matchedSource = activeSources.find((source) =>
      sourceMatchesConnectIdentity(source, { connectSource, connectTarget })
    );
    if (matchedSource) {
      return matchedSource;
    }
  }

  if (!provider) {
    return activeSources[0] ?? null;
  }

  return activeSources.find((source) => normalizeProviderKey(source.provider) === provider) ?? null;
}

function sourceMatchesConnectIdentity(
  source: HostedDeviceSyncSettingsSource,
  identity: {
    connectSource: string | null;
    connectTarget: string | null;
  },
): boolean {
  const provider = normalizeProviderKey(source.provider);

  if (identity.connectTarget && provider === identity.connectTarget) {
    return true;
  }

  if (identity.connectSource && provider === identity.connectSource) {
    return true;
  }

  return source.upstreamSources.some((upstreamSource) => {
    const sourceProviderSlug = normalizeProviderKey(upstreamSource.sourceProviderSlug);
    return Boolean(
      sourceProviderSlug
      && (sourceProviderSlug === identity.connectTarget || sourceProviderSlug === identity.connectSource),
    );
  });
}

function resolveConnectedSourceLabel(input: {
  connectSource: string | null;
  connectTarget: string | null;
  source: HostedDeviceSyncSettingsSource | null;
}): string | null {
  if (!input.source) {
    return null;
  }

  const connectSource = normalizeProviderKey(input.connectSource);
  const connectTarget = normalizeProviderKey(input.connectTarget);
  const upstreamSource = input.source.upstreamSources.find((candidate) => {
    const sourceProviderSlug = normalizeProviderKey(candidate.sourceProviderSlug);
    return Boolean(
      sourceProviderSlug
      && (sourceProviderSlug === connectTarget || sourceProviderSlug === connectSource),
    );
  });

  return upstreamSource?.providerLabel ?? null;
}

function resolvePreferredContactAction(input: {
  hasTelegramRouting: boolean;
  messageBody: string;
  recipient: string | null;
}): DeviceSyncCompletionContactAction | null {
  const messagesHref = resolveHostedDeviceSyncAssignedMessagesReturnDestination({
    messageBody: input.messageBody,
    recipient: input.recipient,
  });

  if (messagesHref) {
    return {
      href: messagesHref,
      kind: "imessage",
      label: "Text Murph",
    };
  }

  if (input.hasTelegramRouting) {
    return {
      href: resolveHostedDeviceSyncMessagingReturnDestination({
        messageBody: input.messageBody,
        recipient: null,
        target: "telegram",
      }),
      kind: "telegram",
      label: "Text Murph",
      ariaLabel: "Text Murph in Telegram",
      rel: "noopener noreferrer",
      target: "_blank",
    };
  }

  return null;
}

function resolveCompletionDetail(input: {
  connected: boolean;
  failed: boolean;
  hasContactAction: boolean;
  hasMember: boolean;
  loadError: string | null;
  providerLabel: string;
  source: HostedDeviceSyncSettingsSource | null;
}): string {
  if (input.failed) {
    return "Try again from Murph when you are ready.";
  }

  if (!input.connected && !input.failed) {
    return "Open Murph to confirm your connected sources.";
  }

  if (!input.hasMember) {
    return "Open Murph to confirm your connected sources.";
  }

  if (input.loadError) {
    return input.loadError;
  }

  if (input.connected && !input.hasContactAction) {
    return `${input.providerLabel} is ready. Murph will start learning from your data.`;
  }

  if (input.connected && input.source) {
    return `${input.providerLabel} is ready. Say hi to start exploring your data.`;
  }

  return "Your wearable is ready. Murph will start learning from your data.";
}

function readSearchParamString(
  searchParams: DeviceSyncCompletionSearchParams,
  key: string,
): string | null {
  const value = searchParams[key];

  if (typeof value === "string") {
    return value;
  }

  return value?.[0] ?? null;
}

function normalizeProviderKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}
