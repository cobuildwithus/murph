import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

import { JOIN_INVITE_ACTIVATION_PENDING_COPY } from "./join-invite-copy";

export function hasResolvedHostedInviteVerification(
  status: HostedInviteStatusPayload,
): boolean {
  return status.stage !== "verify" || !status.session.authenticated;
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
  return !input.hasCompletedInitialRefresh && !hasResolvedHostedInviteVerification(input.status);
}

export function resolveJoinInviteTitle(status: HostedInviteStatusPayload): string {
  switch (status.stage) {
    case "invalid":
      return "Invite link not valid";
    case "expired":
      return "Invite link expired";
    case "verify":
      return "Confirm your number";
    case "checkout":
      return "Start your first experiment";
    case "activating":
      return "Finishing your setup";
    case "blocked":
      return "Account blocked";
    case "active":
      return "Welcome to Murph";
    default:
      return "Murph";
  }
}

export function resolveJoinInviteSubtitle(status: HostedInviteStatusPayload): string {
  switch (status.stage) {
    case "invalid":
    case "expired":
      return "Text Murph again for a fresh link.";
    case "verify":
      return "Verify the number you texted Murph from.";
    case "checkout":
      return status.messagingSetupRequired
        ? "Add a phone number or Telegram so Murph can reach you after payment."
        : "See what actually works for your body.";
    case "activating":
      return JOIN_INVITE_ACTIVATION_PENDING_COPY.subtitle;
    case "blocked":
      return "This account can’t continue from this invite.";
    case "active":
      return status.murphPhoneNumber
        ? "Text Murph below to start."
        : "You’re all set.";
    default:
      return "Murph signup";
  }
}
