import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import type { HostedFamilyBillingRecoveryState } from "@/src/lib/hosted-onboarding/family-plan";

import { JOIN_INVITE_ACTIVATION_PENDING_COPY } from "./join-invite-copy";

export interface JoinInviteStatusRefreshSnapshot {
  fingerprint: string;
  serverProjectionPending: boolean;
  session: {
    authenticated: boolean;
    matchesInvite: boolean;
  };
  stage: HostedInviteStatusPayload["stage"];
}

export function hasResolvedHostedInviteVerification(
  status: HostedInviteStatusPayload,
): boolean {
  return status.stage !== "verify" || !status.session.authenticated;
}

export function shouldGateJoinInviteStatusWithLaunchConsent(
  status: HostedInviteStatusPayload,
): boolean {
  if (!status.session.authenticated || !status.session.matchesInvite) {
    return false;
  }

  return (
    status.stage === "checkout"
    || status.stage === "activating"
    || status.stage === "active"
  );
}

export function buildJoinInviteStatusRefreshSnapshot(
  status: HostedInviteStatusPayload,
  familyBillingRecovery: HostedFamilyBillingRecoveryState | null = null,
): JoinInviteStatusRefreshSnapshot {
  return {
    fingerprint: buildJoinInviteStatusRefreshFingerprint(status),
    serverProjectionPending:
      familyBillingRecovery === "checkout"
      || familyBillingRecovery === "syncing",
    session: {
      authenticated: status.session.authenticated,
      matchesInvite: status.session.matchesInvite,
    },
    stage: status.stage,
  };
}

export function shouldRefreshJoinInviteStatusFromPayload(input: {
  current: JoinInviteStatusRefreshSnapshot;
  nextStatus: HostedInviteStatusPayload;
}): boolean {
  if (isStaleHostedInviteVerifyRefresh(input)) {
    return false;
  }

  if (input.current.serverProjectionPending) {
    return true;
  }

  return input.current.fingerprint !== buildJoinInviteStatusRefreshFingerprint(input.nextStatus);
}

function isStaleHostedInviteVerifyRefresh(input: {
  current: JoinInviteStatusRefreshSnapshot;
  nextStatus: HostedInviteStatusPayload;
}): boolean {
  return (
    input.current.stage !== "verify"
    && input.current.session.authenticated
    && input.current.session.matchesInvite
    && input.nextStatus.stage === "verify"
    && input.nextStatus.session.authenticated
    && input.nextStatus.session.matchesInvite
  );
}

function buildJoinInviteStatusRefreshFingerprint(
  status: HostedInviteStatusPayload,
): string {
  return hashJoinInviteRefreshPayload(JSON.stringify({
    billing: {
      defaultPlanCode: status.billing.defaultPlanCode,
      plans: status.billing.plans.map((plan) => ({
        code: plan.code,
        recurringAmountUsdCents: plan.recurringAmountUsdCents,
      })),
    },
    capabilities: status.capabilities,
    invite: status.invite
      ? {
          emailAuthTarget: status.invite.emailAuthTarget,
          phoneAuthTarget: status.invite.phoneAuthTarget,
          phoneHint: status.invite.phoneHint,
          verificationMode: status.invite.verificationMode,
        }
      : null,
    messagingSetupRequired: status.messagingSetupRequired,
    murphPhoneNumber: status.murphPhoneNumber ?? null,
    session: {
      authenticated: status.session.authenticated,
      matchesInvite: status.session.matchesInvite,
    },
    stage: status.stage,
    telegramStartRequired: status.telegramStartRequired,
  }));
}

function hashJoinInviteRefreshPayload(payload: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

export function resolveJoinInviteTitle(status: HostedInviteStatusPayload): string {
  switch (status.stage) {
    case "invalid":
      return "Invite link not valid";
    case "expired":
      return "Invite link expired";
    case "verify":
      if (status.invite?.verificationMode === "invite_email") {
        return "Verify your email";
      }
      return status.invite?.verificationMode === "manual_phone"
        ? "Log in or sign up"
        : "Verify your phone";
    case "checkout":
      return status.messagingSetupRequired
        ? "How should Murph reach you?"
        : "Choose your Murph plan";
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
      if (status.invite?.verificationMode === "invite_email") {
        return "Use the iMessage email address that received this join link.";
      }
      return status.invite?.verificationMode === "manual_phone"
        ? "Choose phone, Telegram, or email to continue with this invite."
        : "";
    case "checkout":
      return status.messagingSetupRequired
        ? "Add your phone or Telegram so Murph can message you."
        : "Let us run Murph for you, or run it yourself if you prefer.";
    case "activating":
      return JOIN_INVITE_ACTIVATION_PENDING_COPY.subtitle;
    case "blocked":
      return "This account can’t continue from this invite.";
    case "active":
      if (status.telegramStartRequired) {
        return "Message Murph on Telegram to start.";
      }
      return status.murphPhoneNumber
        ? "Text Murph below to start."
        : "You’re all set.";
    default:
      return "Murph signup";
  }
}
