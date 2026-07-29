import "server-only";

import {
  isHostedTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeIMessageContactToolRequest,
  HostedRuntimeIMessageContactToolResponse,
} from "@murphai/hosted-execution/runtime-control";

import { getPrisma } from "@/src/lib/prisma";
import {
  acquireHostedMemberHomeLinqRouteLockTx,
  readHostedMemberRoutingState,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  readHostedLinqHomeLineAuthority,
  reserveHostedLinqHomeLineFromPoolTx,
} from "@/src/lib/hosted-onboarding/linq-home-routing";
import {
  readHostedMemberIdentity,
} from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import {
  readHostedMemberEmailAuthorization,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import { normalizePhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import {
  requireHostedRuntimeActiveAccessForUpdateTx,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  readHostedMailboxConversationWakeByAssistantInputId,
} from "@/src/lib/hosted-mailbox/store";

export async function handleHostedRuntimeIMessageContactTool(input: {
  memberId: string;
  request: HostedRuntimeIMessageContactToolRequest;
}): Promise<HostedRuntimeIMessageContactToolResponse> {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, {
      prisma: tx,
    });
    const wake = await readHostedMailboxConversationWakeByAssistantInputId({
      assistantInputId: input.request.assistantInputId,
      memberId: input.memberId,
      prisma: tx,
    });
    if (
      !wake
      || !isHostedTelegramConversationMessageWake(wake)
      || wake.message.telegramMessage.threadIsDirect !== true
    ) {
      throw new TypeError(
        "iMessage contact assignment requires current direct Telegram input.",
      );
    }
    const [identity, emailAuthorization] = await Promise.all([
      readHostedMemberIdentity({
        memberId: input.memberId,
        prisma: tx,
      }),
      readHostedMemberEmailAuthorization({
        memberId: input.memberId,
        prisma: tx,
      }),
    ]);
    if (
      !(identity?.phoneLookupKey && identity.phoneNumberVerifiedAt)
      && !emailAuthorization?.verifiedEmail?.lookupKey
    ) {
      return {
        phoneNumber: null,
        status: "identity_required",
      };
    }

    await acquireHostedMemberHomeLinqRouteLockTx({
      memberId: input.memberId,
      prisma: tx,
    });
    const routing = await readHostedMemberRoutingState({
      memberId: input.memberId,
      prisma: tx,
    });
    const existingPhoneNumber = normalizePhoneNumber(
      routing?.linqRecipientPhone,
    );
    if (existingPhoneNumber) {
      return {
        phoneNumber: existingPhoneNumber,
        status: "existing",
      };
    }
    if (readHostedLinqHomeLineAuthority(routing).kind !== "none") {
      return {
        phoneNumber: null,
        status: "unavailable",
      };
    }

    const reservation = await reserveHostedLinqHomeLineFromPoolTx({
      preferredRecipientPhone: null,
      prisma: tx,
    });
    if (reservation.kind !== "reserved") {
      return {
        phoneNumber: null,
        status: "unavailable",
      };
    }

    const phoneNumber = reservation.reservation.line.phoneNumber;
    await upsertHostedMemberHomeLinqRecipientPhoneTx({
      clearPending: false,
      homeLineAssignedAt: reservation.reservation.assignedAt,
      memberId: input.memberId,
      prisma: tx,
      recipientPhone: phoneNumber,
    });

    return {
      phoneNumber,
      status: "assigned",
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}
