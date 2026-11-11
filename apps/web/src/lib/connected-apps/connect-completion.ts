import "server-only";

import { formatHostedConnectedAppToolkitLabel } from "@/src/lib/connected-apps/config";
import { resolveConnectLogoSrc } from "@/src/lib/device-sync/connect-logos";
import type {
  DeviceSyncCompletionContactAction,
  DeviceSyncCompletionDialogModel,
} from "@/src/lib/device-sync/connect-completion-types";
import {
  buildHostedDeviceSyncMessagingReturnMessageBody,
  resolveHostedDeviceSyncAssignedMessagesReturnDestination,
  resolveHostedDeviceSyncMessagingReturnDestination,
} from "@/src/lib/device-sync/messaging-return-destination";
import type { HostedMemberCoreState } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { getPrisma } from "@/src/lib/prisma";

export const CONNECTED_APP_COMPLETION_MARKER = "connectedAppCompletion";

export type ConnectedAppCompletionStatus = "success" | "error";

export type ConnectedAppCompletionSearchParams = Record<
  string,
  string | string[] | undefined
>;

interface BuildSettingsRedirectInput {
  alias?: string | null;
  status: ConnectedAppCompletionStatus;
  toolkit?: string | null;
}

// Builds the /settings URL that triggers the connected-app completion dialog.
// Mirrors the device-sync `buildDeviceSyncCompletionSettingsRedirectHref` shape
// so Settings can render either connection result.
export function buildConnectedAppCompletionSettingsRedirectHref(
  input: BuildSettingsRedirectInput,
): string {
  const params = new URLSearchParams();
  params.set(CONNECTED_APP_COMPLETION_MARKER, "1");
  params.set("connectedAppStatus", input.status);
  if (input.toolkit) {
    params.set("toolkit", input.toolkit);
  }
  if (input.alias) {
    params.set("alias", input.alias);
  }
  return `/settings?${params.toString()}`;
}

export async function resolveConnectedAppCompletionDialogModel(input: {
  member: HostedMemberCoreState | null;
  searchParams: ConnectedAppCompletionSearchParams;
}): Promise<DeviceSyncCompletionDialogModel | null> {
  if (
    readSearchParamString(input.searchParams, CONNECTED_APP_COMPLETION_MARKER)
      !== "1"
  ) {
    return null;
  }

  const status = readSearchParamString(input.searchParams, "connectedAppStatus");
  const toolkit = readSearchParamString(input.searchParams, "toolkit");
  const alias = readSearchParamString(input.searchParams, "alias");
  const toolkitLabel = toolkit
    ? formatHostedConnectedAppToolkitLabel(toolkit)
    : null;
  const accountLabel = alias && toolkitLabel
    ? `${alias} ${toolkitLabel}`
    : toolkitLabel ?? alias ?? "Your integration";
  const failed = status !== "success";
  const logo = toolkit && toolkitLabel
    ? { name: toolkitLabel, src: resolveConnectLogoSrc(toolkit) }
    : null;

  if (failed) {
    return {
      contactAction: null,
      // The failure path on a connected-app callback typically lands the user
      // here without a fresh claim; the only useful next step is to ask Murph
      // for a new connect link, not a route-level retry.
      detail: "Ask Murph for a new link.",
      failed: true,
      kind: "connected-app",
      logo,
      retryHref: null,
      title: `${accountLabel} didn’t connect.`,
      unverified: false,
    };
  }

  const contactAction = await resolveConnectedAppContactAction({
    accountLabel,
    member: input.member,
  });

  return {
    contactAction,
    detail: contactAction
      ? "Go back to your chat."
      : `${accountLabel} is ready. Murph will start using it on your next message.`,
    failed: false,
    kind: "connected-app",
    logo,
    retryHref: null,
    title: `${accountLabel} is connected.`,
    unverified: false,
  };
}

async function resolveConnectedAppContactAction(input: {
  accountLabel: string;
  member: HostedMemberCoreState | null;
}): Promise<DeviceSyncCompletionContactAction | null> {
  if (!input.member) {
    return null;
  }

  const routing = await readHostedMemberRoutingState({
    memberId: input.member.id,
    prisma: getPrisma(),
  });
  const messageBody = buildHostedDeviceSyncMessagingReturnMessageBody(
    input.accountLabel,
  );
  const messagesHref = resolveHostedDeviceSyncAssignedMessagesReturnDestination({
    messageBody,
    recipient: routing?.linqRecipientPhone ?? null,
  });

  if (messagesHref) {
    return {
      href: messagesHref,
      kind: "imessage",
      label: "Open Messages",
    };
  }

  if (routing?.telegramThreadId || routing?.telegramUserId) {
    return {
      ariaLabel: "Text Murph in Telegram",
      href: resolveHostedDeviceSyncMessagingReturnDestination({
        messageBody,
        recipient: null,
        target: "telegram",
      }),
      kind: "telegram",
      label: "Text Murph",
      rel: "noopener noreferrer",
      target: "_blank",
    };
  }

  return null;
}

function readSearchParamString(
  searchParams: ConnectedAppCompletionSearchParams,
  key: string,
): string | null {
  const value = searchParams[key];

  if (typeof value === "string") {
    return value;
  }

  return value?.[0] ?? null;
}
