import type {
  AcceptHostedShareResult,
  HostedSharePageData,
} from "@/src/lib/hosted-share/service";
import type {
  HostedInviteStatusPayload,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";

export type JoinInviteShareImportState = "idle" | "processing" | "completed";

export function resolveInviteStatusAfterPrivyCompletion(
  status: HostedInviteStatusPayload,
  payload: HostedPrivyCompletionPayload,
): HostedInviteStatusPayload {
  return {
    ...status,
    session: {
      ...status.session,
      authenticated: true,
      matchesInvite: true,
    },
    stage: payload.stage,
  };
}

export function shouldAwaitHostedInviteSessionResolution(input: {
  authenticated: boolean;
  ready: boolean;
  status: HostedInviteStatusPayload;
}): boolean {
  if (input.status.stage !== "verify" || input.status.session.authenticated) {
    return false;
  }

  if (!input.ready) {
    return true;
  }

  return input.authenticated;
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
    case "activating":
      return "We’re setting up your account";
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
      return "Text the Murph number again and we’ll send you a fresh hosted link.";
    case "expired":
      return "Text the Murph number again and we’ll send you a fresh link.";
    case "verify":
      return "Verify the number that messaged Murph to finish joining.";
    case "checkout":
      return "Your phone is confirmed. Finish checkout to start using Murph.";
    case "activating":
      return "Your payment went through. Murph is finishing hosted activation now.";
    case "blocked":
      return "This hosted account cannot continue from the invite right now. Contact support to restore access.";
    case "active":
      return "Congrats, you’re all set. Here’s what to expect next.";
    default:
      return "Murph signup";
  }
}
