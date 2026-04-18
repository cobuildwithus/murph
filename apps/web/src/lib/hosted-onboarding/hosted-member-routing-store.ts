/**
 * Owns hosted member messaging-routing lookup and binding surfaces.
 */
import { createHostedTelegramUserLookupKeyReadCandidates } from "./contact-privacy";
import {
  hostedMemberRoutingLookupSelect,
  hostedMemberRoutingStateSelect,
  projectHostedMemberRoutingLookup,
  projectHostedMemberRoutingState,
  type HostedMemberRoutingLookup,
} from "./hosted-member-routing-state";
import { type HostedOnboardingReadClient } from "./shared";

export {
  countHostedMemberHomeLinqBindingsByRecipientPhone,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
  upsertHostedMemberPendingLinqBindingTx,
} from "./hosted-member-routing-linq";
export {
  syncHostedMemberTelegramRoutingBinding,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "./hosted-member-routing-telegram";
export {
  projectHostedMemberRoutingState,
  type HostedMemberRoutingLookupMatch,
  type HostedMemberRoutingLookupSnapshot,
  type HostedMemberRoutingStateSnapshot,
} from "./hosted-member-routing-state";

export async function lookupHostedMemberRoutingByTelegramUserLookupKey(input: {
  prisma: HostedOnboardingReadClient;
  telegramUserLookupKey: string;
}): Promise<HostedMemberRoutingLookup | null> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      telegramUserLookupKey: input.telegramUserLookupKey,
    },
    select: hostedMemberRoutingLookupSelect,
  });

  return routingRecord
    ? projectHostedMemberRoutingLookup(routingRecord, "telegramUserLookupKey")
    : null;
}

export async function lookupHostedMemberRoutingByTelegramUserId(input: {
  prisma: HostedOnboardingReadClient;
  telegramUserId: string;
}): Promise<HostedMemberRoutingLookup | null> {
  const telegramUserLookupKeys = createHostedTelegramUserLookupKeyReadCandidates(
    input.telegramUserId,
  );

  if (telegramUserLookupKeys.length === 0) {
    return null;
  }

  const routingRecord = await input.prisma.hostedMemberRouting.findFirst({
    where: {
      telegramUserLookupKey: {
        in: telegramUserLookupKeys,
      },
    },
    select: hostedMemberRoutingLookupSelect,
  });

  return routingRecord
    ? projectHostedMemberRoutingLookup(routingRecord, "telegramUserId")
    : null;
}

export async function readHostedMemberRoutingState(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}) {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: hostedMemberRoutingStateSelect,
  });

  return routingRecord ? projectHostedMemberRoutingState(routingRecord) : null;
}
