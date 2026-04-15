import type {
  AcceptHostedShareResult,
  HostedSharePageData,
} from "@/src/lib/hosted-share/service";
import type {
  HostedInviteStatusPayload,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";

import { JOIN_INVITE_ACTIVATION_PENDING_COPY } from "./join-invite-copy";

export type JoinInviteShareImportState = "idle" | "processing" | "completed";

export function resolveInviteStatusAfterPrivyCompletion(
  status: HostedInviteStatusPayload,
  payload: HostedPrivyCompletionPayload,
): HostedInviteStatusPayload {
  return {
    ...status,
    messagingSetupRequired: payload.messagingSetupRequired,
    session: {
      ...status.session,
      authenticated: true,
      matchesInvite: true,
    },
    stage: payload.stage,
  };
}

export function resolveJoinInviteStatusFromRefresh(input: {
  nextStatus: HostedInviteStatusPayload;
  status: HostedInviteStatusPayload;
}): HostedInviteStatusPayload {
  if (
    input.status.stage === "verify"
    || !input.status.session.authenticated
    || !input.status.session.matchesInvite
    || input.nextStatus.stage !== "verify"
    || !input.nextStatus.session.authenticated
    || !input.nextStatus.session.matchesInvite
  ) {
    return input.nextStatus;
  }

  return {
    ...input.nextStatus,
    stage: input.status.stage,
  };
}

export function shouldAwaitHostedInviteSessionResolution(input: {
  hasCompletedInitialRefresh: boolean;
  status: HostedInviteStatusPayload;
}): boolean {
  return input.status.stage === "verify" && !input.hasCompletedInitialRefresh;
}

export function resolveJoinInviteShareStateFromAccept(
  payload: Pick<AcceptHostedShareResult, "alreadyImported" | "imported" | "pending">,
): JoinInviteShareImportState {
  if (payload.imported || payload.alreadyImported) {
    return "completed";
  }

  return payload.pending ? "processing" : "idle";
}

export function resolveJoinInviteShareStateFromStatus(
  data: HostedSharePageData,
): JoinInviteShareImportState {
  if (data.stage === "consumed" && data.share?.acceptedByCurrentMember) {
    return "completed";
  }

  if (data.stage === "processing" && data.share?.acceptedByCurrentMember) {
    return "processing";
  }

  return "idle";
}

export function buildHostedShareStatusUrl(input: {
  inviteCode: string;
  shareCode: string;
}): string {
  const url = new URL(
    `/api/hosted-share/${encodeURIComponent(input.shareCode)}/status`,
    "https://join.example.test",
  );
  url.searchParams.set("invite", input.inviteCode);
  return `${url.pathname}${url.search}`;
}

export function resolveJoinInviteTitle(status: HostedInviteStatusPayload): string {
  switch (status.stage) {
    case "invalid":
      return "That invite link is not valid";
    case "expired":
      return "That invite link expired";
    case "verify":
      return "Finish joining Murph";
    case "checkout":
      return "One last step";
    case "blocked":
      return "This account is blocked";
    case "active":
      return "Welcome to Murph";
    default:
      return "Murph";
  }
}

export function resolveJoinInviteSubtitle(status: HostedInviteStatusPayload): string {
  switch (status.stage) {
    case "invalid":
      return "Text the Murph number again and we’ll send you a fresh link.";
    case "expired":
      return "Text the Murph number again and we’ll send you a fresh link.";
    case "verify":
      return "Verify the number that messaged Murph to finish joining.";
    case "checkout":
      return status.messagingSetupRequired
        ? "Before checkout, add a phone number or connect Telegram so Murph can message you after payment."
        : "Your account is ready for checkout. Finish payment to start using Murph.";
    case "blocked":
      return "This account can’t continue from this invite right now. Contact support and we’ll help restore access.";
    case "active":
      return status.activationPending
        ? JOIN_INVITE_ACTIVATION_PENDING_COPY.subtitle
        : "Congrats, you’re all set. Here’s what to expect next.";
    default:
      return "Murph signup";
  }
}
