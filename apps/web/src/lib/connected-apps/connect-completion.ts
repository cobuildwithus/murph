import "server-only";

import { formatHostedConnectedAppToolkitLabel } from "@/src/lib/connected-apps/config";
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

export const CONNECTED_APP_COMPLETION_HOME_MARKER = "connectedAppCompletion";

export type ConnectedAppCompletionStatus = "success" | "error";

export type ConnectedAppCompletionSearchParams = Record<
  string,
  string | string[] | undefined
>;

interface BuildHomeRedirectInput {
  alias?: string | null;
  status: ConnectedAppCompletionStatus;
  toolkit?: string | null;
}

// Builds the /home URL that triggers the connected-app completion dialog.
// Mirrors the device-sync `buildDeviceSyncCompletionHomeRedirectHref` shape
// so the home page just resolves both models in parallel.
export function buildConnectedAppCompletionHomeRedirectHref(
  input: BuildHomeRedirectInput,
): string {
  const params = new URLSearchParams();
  params.set(CONNECTED_APP_COMPLETION_HOME_MARKER, "1");
  params.set("connectedAppStatus", input.status);
  if (input.toolkit) {
    params.set("toolkit", input.toolkit);
  }
  if (input.alias) {
    params.set("alias", input.alias);
  }
  return `/home?${params.toString()}`;
}

export async function resolveConnectedAppCompletionDialogModel(input: {
  member: HostedMemberCoreState | null;
  searchParams: ConnectedAppCompletionSearchParams;
}): Promise<DeviceSyncCompletionDialogModel | null> {
  if (
    readSearchParamString(input.searchParams, CONNECTED_APP_COMPLETION_HOME_MARKER)
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

  if (failed) {
    return {
      contactAction: null,
      // The failure path on a connected-app callback typically lands the user
      // here without a fresh claim; the only useful next step is to ask Murph
      // for a new connect link, not a route-level retry.
      detail: "Ask Murph for a new connection link when you are ready.",
      failed: true,
      kind: "connected-app",
      retryHref: null,
      title: `${accountLabel} connection did not finish`,
    };
  }

  const contactAction = await resolveConnectedAppContactAction({
    accountLabel,
    member: input.member,
  });

  return {
    contactAction,
    detail: contactAction
      ? `${accountLabel} is ready. Text Murph to start using it.`
      : `${accountLabel} is ready. Murph will start using it on your next message.`,
    failed: false,
    kind: "connected-app",
    retryHref: null,
    title: `${accountLabel} is connected`,
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
      label: "Text Murph",
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
