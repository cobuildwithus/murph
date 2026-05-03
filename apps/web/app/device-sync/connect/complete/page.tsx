import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  MessageCircleIcon,
  SendIcon,
  SettingsIcon,
} from "lucide-react";
import { resolveDeviceConnectSourceById } from "@murphai/device-syncd/config";

import { buttonVariants } from "@/src/components/ui/button";
import {
  buildHostedDeviceSyncMessagingReturnMessageBody,
  resolveHostedDeviceSyncAssignedMessagesReturnDestination,
  resolveHostedDeviceSyncCallbackStatus,
  resolveHostedDeviceSyncMessagingReturnDestination,
  resolveHostedDeviceSyncProviderLabel,
  type HostedDeviceSyncCallbackStatus,
  type HostedDeviceSyncMessagingReturnTarget,
} from "@/src/lib/device-sync/messaging-return-destination";
import { buildHostedDeviceSyncSettingsResponse } from "@/src/lib/device-sync/settings-service";
import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";
import { getHostedAppSession, type HostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { getPrisma } from "@/src/lib/prisma";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";
import { cn } from "@/src/lib/utils";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Device Connected - Murph",
  description: "Finish a wearable connection in Murph.",
});

type CompletionPageSearchParams = Record<string, string | string[] | undefined>;

interface CompletionCallback {
  connectSource: string | null;
  connectTarget: string | null;
  provider: string | null;
  providerLabel: string | null;
  sourceLabel: string | null;
  status: HostedDeviceSyncCallbackStatus | null;
}

interface CompletionState {
  contactAction: CompletionContactAction | null;
  connectedSource: HostedDeviceSyncSettingsSource | null;
  loadError: string | null;
  session: HostedAppSession | null;
}

interface CompletionContactAction {
  href: string;
  kind: HostedDeviceSyncMessagingReturnTarget;
  label: string;
  rel?: string;
  target?: string;
}

export default async function DeviceSyncConnectCompletePage({
  searchParams,
}: {
  searchParams?: Promise<CompletionPageSearchParams>;
} = {}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const callback = readCompletionCallback(resolvedSearchParams);
  const state = await loadCompletionState(callback);
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
  const connected = callback.status === "connected";
  const failed = callback.status === "error";
  const title = failed
    ? `${providerLabel} connection did not finish`
    : connected
      ? `${providerLabel} is connected`
      : "Device connection complete";
  const detail = resolveCompletionDetail({
    connected,
    failed,
    hasSession: Boolean(state.session),
    loadError: state.loadError,
    source: state.connectedSource,
  });
  const StatusIcon = failed ? AlertCircleIcon : CheckCircle2Icon;

  return (
    <main className="min-h-[72vh] bg-background px-4 py-16 text-foreground sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
        <div
          className={cn(
            "mb-7 flex size-16 items-center justify-center rounded-lg border",
            failed
              ? "border-destructive/20 bg-destructive/10 text-destructive"
              : "border-primary/20 bg-primary/10 text-primary",
          )}
        >
          <StatusIcon aria-hidden="true" className="size-8" />
        </div>

        <p className="mb-3 font-mono text-xs font-medium text-muted-foreground">
          Device connection
        </p>
        <h1 className="max-w-2xl font-serif text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
          {title}
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
          {detail}
        </p>

        <div className="mt-9 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
          {state.contactAction ? (
            <a
              className={buttonVariants({
                className: "w-full sm:w-auto",
                size: "lg",
              })}
              href={state.contactAction.href}
              rel={state.contactAction.rel}
              target={state.contactAction.target}
            >
              {state.contactAction.kind === "imessage" ? (
                <MessageCircleIcon aria-hidden="true" className="size-4" />
              ) : (
                <SendIcon aria-hidden="true" className="size-4" />
              )}
              {state.contactAction.label}
            </a>
          ) : null}
          <Link
            className={buttonVariants({
              className: "w-full sm:w-auto",
              size: "lg",
              variant: state.contactAction ? "outline" : "default",
            })}
            href="/connect"
          >
            <SettingsIcon aria-hidden="true" className="size-4" />
            View devices
          </Link>
        </div>
      </section>
    </main>
  );
}

function readCompletionCallback(searchParams: CompletionPageSearchParams): CompletionCallback {
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

async function loadCompletionState(callback: CompletionCallback): Promise<CompletionState> {
  const session = await getHostedAppSession();

  if (!session) {
    return {
      contactAction: null,
      connectedSource: null,
      loadError: null,
      session: null,
    };
  }

  try {
    const [settings, routing] = await Promise.all([
      buildHostedDeviceSyncSettingsResponse({ member: session.member }),
      readHostedMemberRoutingState({
        memberId: session.member.id,
        prisma: getPrisma(),
      }),
    ]);
    const connectedSource = findConnectedSource({
      connectSource: callback.connectSource,
      connectTarget: callback.connectTarget,
      provider: callback.provider,
      sources: settings.sources,
    });
    const messageBody = buildHostedDeviceSyncMessagingReturnMessageBody(
      callback.sourceLabel
        ?? resolveConnectedSourceLabel({
          connectSource: callback.connectSource,
          connectTarget: callback.connectTarget,
          source: connectedSource,
        })
        ?? connectedSource?.providerLabel
        ?? callback.providerLabel,
    );

    return {
      contactAction: callback.status === "connected"
        ? resolvePreferredContactAction({
            hasTelegramRouting: Boolean(routing?.telegramThreadId || routing?.telegramUserId),
            messageBody,
            recipient: routing?.linqRecipientPhone ?? null,
          })
        : null,
      connectedSource,
      loadError: null,
      session,
    };
  } catch {
    return {
      contactAction: null,
      connectedSource: null,
      loadError: "Could not load your wearable details right now.",
      session,
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
}): CompletionContactAction | null {
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
      label: "Open Telegram",
      rel: "noopener noreferrer",
      target: "_blank",
    };
  }

  return null;
}

function resolveCompletionDetail(input: {
  connected: boolean;
  failed: boolean;
  hasSession: boolean;
  loadError: string | null;
  source: HostedDeviceSyncSettingsSource | null;
}): string {
  if (input.failed) {
    return "Try again from Murph when you are ready.";
  }

  if (!input.connected && !input.failed) {
    return "Open Murph to confirm your connected sources.";
  }

  if (!input.hasSession) {
    return "Open Murph to confirm your connected sources.";
  }

  if (input.loadError) {
    return input.loadError;
  }

  if (input.connected && input.source) {
    return `${input.source.providerLabel} is now available in your connected sources.`;
  }

  return "Your connected sources are ready in Murph.";
}

function readSearchParamString(
  searchParams: CompletionPageSearchParams,
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
