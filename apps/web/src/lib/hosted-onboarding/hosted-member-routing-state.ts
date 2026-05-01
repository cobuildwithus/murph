import {
  type HostedMember,
  Prisma,
} from "@prisma/client";

import { readHostedMemberRoutingPrivateState } from "./member-private-codecs";
import type { HostedOnboardingReadClient } from "./shared";

export const hostedMemberRoutingStateSelect =
  Prisma.validator<Prisma.HostedMemberRoutingSelect>()({
    linqChatIdEncrypted: true,
    linqRecipientPhoneEncrypted: true,
    memberId: true,
    pendingLinqChatIdEncrypted: true,
    pendingLinqRecipientPhoneEncrypted: true,
    telegramUserLookupKey: true,
    telegramUserIdEncrypted: true,
  });

export type HostedMemberRoutingRecord = Prisma.HostedMemberRoutingGetPayload<{
  select: typeof hostedMemberRoutingStateSelect;
}>;

export const hostedMemberRoutingLookupSelect =
  Prisma.validator<Prisma.HostedMemberRoutingSelect>()({
    linqChatIdEncrypted: true,
    linqRecipientPhoneEncrypted: true,
    memberId: true,
    pendingLinqChatIdEncrypted: true,
    pendingLinqRecipientPhoneEncrypted: true,
    telegramUserLookupKey: true,
    telegramUserIdEncrypted: true,
    member: {
      select: {
        billingStatus: true,
        createdAt: true,
        id: true,
        suspendedAt: true,
        updatedAt: true,
      },
    },
  });

export type HostedMemberRoutingLookupRecord = Prisma.HostedMemberRoutingGetPayload<{
  select: typeof hostedMemberRoutingLookupSelect;
}>;

export interface HostedMemberRoutingStateSnapshot {
  linqChatId: string | null;
  linqRecipientPhone: string | null;
  memberId: string;
  pendingLinqChatId: string | null;
  pendingLinqRecipientPhone: string | null;
  telegramThreadId: string | null;
  telegramUserId: string | null;
  telegramUserLookupKey: string | null;
}

export interface HostedMemberRoutingLookupSnapshot {
  hasTelegramUserBinding: boolean;
  linqChatId: string | null;
  memberId: string;
}

export type HostedMemberRoutingLookupMatch =
  | "telegramUserLookupKey"
  | "telegramUserId";

export interface HostedMemberRoutingLookup {
  core: Pick<
    HostedMember,
    | "billingStatus"
    | "createdAt"
    | "id"
    | "suspendedAt"
    | "updatedAt"
  >;
  matchedBy: HostedMemberRoutingLookupMatch;
  routing: HostedMemberRoutingLookupSnapshot;
}

export async function projectHostedMemberRoutingState(
  routing: HostedMemberRoutingRecord,
  prisma?: HostedOnboardingReadClient,
): Promise<HostedMemberRoutingStateSnapshot> {
  const privateState = await readHostedMemberRoutingPrivateState(routing, prisma);

  return {
    linqChatId: privateState.linqChatId,
    linqRecipientPhone: privateState.linqRecipientPhone,
    memberId: routing.memberId,
    pendingLinqChatId: privateState.pendingLinqChatId,
    pendingLinqRecipientPhone: privateState.pendingLinqRecipientPhone,
    telegramThreadId: privateState.telegramThreadId,
    telegramUserId: privateState.telegramUserId,
    telegramUserLookupKey: routing.telegramUserLookupKey ?? null,
  };
}

export async function projectHostedMemberRoutingLookup(
  routing: HostedMemberRoutingLookupRecord,
  matchedBy: HostedMemberRoutingLookupMatch,
  prisma?: HostedOnboardingReadClient,
): Promise<HostedMemberRoutingLookup> {
  const routingState = await projectHostedMemberRoutingState(routing, prisma);

  return {
    core: routing.member,
    matchedBy,
    routing: {
      hasTelegramUserBinding: Boolean(routing.telegramUserLookupKey),
      linqChatId: routingState.linqChatId,
      memberId: routingState.memberId,
    },
  };
}
