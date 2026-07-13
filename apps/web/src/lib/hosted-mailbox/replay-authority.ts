import type {
  HostedMailboxItem,
  HostedMailboxReplayAuthority,
} from "@murphai/hosted-execution/runtime-control";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import { readHostedMailboxItemByLaneSeq } from "./store";

export async function requireHostedMailboxReplayAuthority(input: {
  authority: HostedMailboxReplayAuthority;
  userId: string;
}): Promise<void> {
  const member = await getPrisma().hostedMember.findUnique({
    select: {
      suspendedAt: true,
    },
    where: {
      id: input.userId,
    },
  });
  if (!member || member.suspendedAt !== null) {
    throw invalidHostedMailboxReplayAuthority();
  }
  const accepted = await readHostedMailboxItemByLaneSeq({
    lane: "conversation",
    laneSeq: input.authority.acceptedConversationSeq,
    userId: input.userId,
  });
  const acceptedAtMatches = input.authority.processingMode
      === "conversation_replay_usage_limit"
    || accepted?.createdAt === input.authority.acceptedConversationAt;
  if (
    !accepted
    || accepted.kind !== "conversation.message"
    || !acceptedAtMatches
  ) {
    throw invalidHostedMailboxReplayAuthority();
  }
}

export async function requireHostedMailboxReplayPayloadTarget(input: {
  authority: HostedMailboxReplayAuthority;
  item: HostedMailboxItem | null;
  userId: string;
}): Promise<void> {
  await requireHostedMailboxReplayAuthority({
    authority: input.authority,
    userId: input.userId,
  });
  const item = input.item;
  const targetAllowed = item?.lane === "conversation"
    ? item.laneSeq === input.authority.acceptedConversationSeq
    : input.authority.bootstrapActivationAllowed
      && item?.lane === "system"
      && item.kind === "member.activated";
  if (!targetAllowed) {
    throw invalidHostedMailboxReplayAuthority();
  }
}

export function isHostedMailboxReplayBootstrapActivation(
  item: { kind: string; lane: string },
): boolean {
  return item.lane === "system" && item.kind === "member.activated";
}

function invalidHostedMailboxReplayAuthority() {
  return hostedOnboardingError({
    code: "HOSTED_RUNTIME_MAILBOX_REPLAY_AUTHORITY_INVALID",
    httpStatus: 403,
    message: "Hosted runtime mailbox replay authority is invalid.",
  });
}
