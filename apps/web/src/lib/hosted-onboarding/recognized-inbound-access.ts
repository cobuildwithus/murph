import type { PrismaClient } from "@prisma/client";

import {
  buildHostedInviteUrl,
  issueHostedInvite,
} from "./invite-service";
import {
  readHostedRuntimeAiAccessDecision,
  type HostedRuntimeAiAccessNoticeCode,
} from "./member-access";

const HOSTED_ACCOUNT_SETTINGS_URL = "https://withmurph.ai/settings";
const HOSTED_GROUP_CHAT_ACCESS_RETRY_REPLY =
  "Once that's sorted, send me another message in the group and I'll try again.";

export type HostedRecognizedInboundAccessResolution =
  | { kind: "allowed" }
  | { kind: "silent" }
  | {
      kind: "access_notice";
      message: string;
      noticeCode: HostedRuntimeAiAccessNoticeCode;
      responseReason: string;
    }
  | {
      inviteCode: string;
      inviteId: string;
      joinUrl: string;
      kind: "signup";
      message: string;
      responseReason: "sent-signup-link";
    };

export function buildHostedGroupChatAccessRecoveryMessage(message: string): string {
  return `${message}\n\n${HOSTED_GROUP_CHAT_ACCESS_RETRY_REPLY}`;
}

export async function resolveHostedRecognizedInboundAccess(input: {
  allowSignupFallback: boolean;
  inviteChannel: "linq" | "share" | "web";
  member: {
    id: string;
    suspendedAt: Date | null;
  };
  noticeSeed: string;
  now?: Date;
  prisma: PrismaClient;
}): Promise<HostedRecognizedInboundAccessResolution> {
  if (input.member.suspendedAt) {
    // The channel has already resolved to this member, so a generic account
    // handoff is safe. Do not expose the suspension reason over chat.
    return {
      kind: "access_notice",
      message: `Murph can't use this account right now. Check your account settings or contact support:\n${HOSTED_ACCOUNT_SETTINGS_URL}`,
      noticeCode: "billing_inactive",
      responseReason: "sent-account-unavailable-notice",
    };
  }

  const access = await readHostedRuntimeAiAccessDecision({
    memberId: input.member.id,
    noticeSeed: input.noticeSeed,
    now: input.now,
    prisma: input.prisma,
  });
  if (access.allowed) {
    return { kind: "allowed" };
  }

  if (access.userNotice) {
    return {
      kind: "access_notice",
      message: access.userNotice.message,
      noticeCode: access.userNotice.code,
      responseReason: resolveHostedRecognizedInboundNoticeReason(
        access.userNotice.code,
      ),
    };
  }

  if (!input.allowSignupFallback) {
    return { kind: "silent" };
  }

  // A recognized, non-suspended person without a recoverable subscription is
  // still on the acquisition path. Give them a fresh invite rather than letting
  // a permanent home-route binding turn that state into an unexplained drop.
  const invite = await issueHostedInvite({
    channel: input.inviteChannel,
    memberId: input.member.id,
    prisma: input.prisma,
  });
  const joinUrl = buildHostedInviteUrl(invite.inviteCode);

  return {
    inviteCode: invite.inviteCode,
    inviteId: invite.id,
    joinUrl,
    kind: "signup",
    message: `Murph isn't fully set up on this account yet. Finish setup here:\n${joinUrl}`,
    responseReason: "sent-signup-link",
  };
}

function resolveHostedRecognizedInboundNoticeReason(
  code: HostedRuntimeAiAccessNoticeCode,
): string {
  switch (code) {
    case "health_data_consent_withdrawn":
      return "sent-health-data-consent-withdrawn-notice";
    case "billing_inactive":
      return "sent-billing-inactive-notice";
  }
}
