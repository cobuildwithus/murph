import type { PrismaClient } from "@prisma/client";

import {
  buildHostedInviteUrl,
  issueHostedInvite,
} from "./invite-service";
import {
  readHostedRuntimeAiAccessDecision,
  type HostedRuntimeAiAccessNoticeCode,
} from "./member-access";

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
    return { kind: "silent" };
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
  return code === "trial_conversion_pending"
    ? "sent-trial-conversion-notice"
    : "sent-billing-inactive-notice";
}
