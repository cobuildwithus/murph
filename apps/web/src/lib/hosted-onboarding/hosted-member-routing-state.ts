import {
  type HostedMember,
  Prisma,
} from "@prisma/client";

import {
  readHostedMemberRoutingPrivateState,
} from "./member-private-codecs";
import {
  normalizeHostedLinqParticipantContactKind,
  type HostedLinqParticipantContactClaim,
} from "./linq-participant-contact";
import type { HostedOnboardingReadClient } from "./shared";
import { readHostedUserSecureBoxStringRootReference } from "../hosted-crypto/secure-box";

export const hostedMemberRoutingStateSelect =
  Prisma.validator<Prisma.HostedMemberRoutingSelect>()({
    linqChatIdEncrypted: true,
    linqChatLookupKey: true,
    linqHomeLineAssignedAt: true,
    linqParticipantContactKind: true,
    linqParticipantContactLookupKey: true,
    linqRecipientPhoneEncrypted: true,
    linqRecipientPhoneLookupKey: true,
    memberId: true,
    pendingLinqChatIdEncrypted: true,
    pendingLinqChatLookupKey: true,
    pendingLinqParticipantContactEncrypted: true,
    pendingLinqParticipantContactKind: true,
    pendingLinqParticipantContactLookupKey: true,
    pendingLinqParticipantContactObservedAt: true,
    pendingLinqRecipientPhoneEncrypted: true,
    pendingLinqRecipientPhoneLookupKey: true,
    replyAliasLookupKey: true,
    telegramUserLookupKey: true,
    telegramUserIdEncrypted: true,
  });

export type HostedMemberRoutingRecord = Prisma.HostedMemberRoutingGetPayload<{
  select: typeof hostedMemberRoutingStateSelect;
}>;

const HOSTED_MEMBER_ROUTING_RECORD_KEYS = [
  "linqChatIdEncrypted",
  "linqChatLookupKey",
  "linqHomeLineAssignedAt",
  "linqParticipantContactKind",
  "linqParticipantContactLookupKey",
  "linqRecipientPhoneEncrypted",
  "linqRecipientPhoneLookupKey",
  "memberId",
  "pendingLinqChatIdEncrypted",
  "pendingLinqChatLookupKey",
  "pendingLinqParticipantContactEncrypted",
  "pendingLinqParticipantContactKind",
  "pendingLinqParticipantContactLookupKey",
  "pendingLinqParticipantContactObservedAt",
  "pendingLinqRecipientPhoneEncrypted",
  "pendingLinqRecipientPhoneLookupKey",
  "replyAliasLookupKey",
  "telegramUserIdEncrypted",
  "telegramUserLookupKey",
] as const satisfies readonly (keyof HostedMemberRoutingRecord)[];

export function hostedMemberRoutingRecordsEqual(
  current: HostedMemberRoutingRecord | null,
  prepared: HostedMemberRoutingRecord | null,
): boolean {
  if (!current || !prepared) {
    return current === prepared;
  }
  return HOSTED_MEMBER_ROUTING_RECORD_KEYS.every((key) => {
    const currentValue = current[key];
    const preparedValue = prepared[key];
    return currentValue instanceof Date && preparedValue instanceof Date
      ? currentValue.getTime() === preparedValue.getTime()
      : currentValue === preparedValue;
  });
}

export function readHostedMemberRoutingControlRootKeyIds(
  routing: HostedMemberRoutingRecord | null,
): string[] {
  if (!routing) {
    return [];
  }
  const encryptedValues = [
    routing.linqChatIdEncrypted,
    routing.linqRecipientPhoneEncrypted,
    routing.pendingLinqChatIdEncrypted,
    routing.pendingLinqParticipantContactEncrypted,
    routing.pendingLinqRecipientPhoneEncrypted,
    routing.telegramUserIdEncrypted,
  ];
  return [...new Set(encryptedValues.flatMap((value) => {
    const reference = readHostedUserSecureBoxStringRootReference({
      lane: "hosted-member-private-field",
      value,
    });
    return reference ? [reference.rootKeyId] : [];
  }))];
}

export const hostedMemberRoutingLookupSelect =
  Prisma.validator<Prisma.HostedMemberRoutingSelect>()({
    linqChatIdEncrypted: true,
    linqChatLookupKey: true,
    linqHomeLineAssignedAt: true,
    linqParticipantContactKind: true,
    linqParticipantContactLookupKey: true,
    linqRecipientPhoneEncrypted: true,
    linqRecipientPhoneLookupKey: true,
    memberId: true,
    pendingLinqChatIdEncrypted: true,
    pendingLinqChatLookupKey: true,
    pendingLinqParticipantContactEncrypted: true,
    pendingLinqParticipantContactKind: true,
    pendingLinqParticipantContactLookupKey: true,
    pendingLinqParticipantContactObservedAt: true,
    pendingLinqRecipientPhoneEncrypted: true,
    pendingLinqRecipientPhoneLookupKey: true,
    replyAliasLookupKey: true,
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
  // True when ANY persisted pending-Linq column is set, including lookup
  // keys and metadata the decoded fields above cannot represent (for
  // example a stale pending contact lookup key whose encrypted value no
  // longer decodes). Cleanup paths must key off this raw-column view, not
  // the decoded fields.
  hasPendingLinqRouteState?: boolean;
  linqChatId: string | null;
  // Raw persisted lookup keys for the home binding. Skip/no-op decisions
  // must compare these against the current-generation computed keys so a
  // stale or missing key still gets re-written.
  linqChatLookupKey?: string | null;
  linqHomeLineAssignedAt: Date | null;
  linqParticipantContact?: {
    kind: "email" | "phone";
    lookupKey: string;
  } | null;
  linqRecipientPhone: string | null;
  linqRecipientPhoneLookupKey?: string | null;
  memberId: string;
  pendingLinqChatId: string | null;
  pendingLinqParticipantContact: HostedLinqParticipantContactClaim | null;
  pendingLinqRecipientPhone: string | null;
  replyAliasLookupKey?: string | null;
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
  | "linqChatLookupKey"
  | "pendingLinqParticipantContactLookupKey"
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
  retainFailureInScopedCache?: boolean,
): Promise<HostedMemberRoutingStateSnapshot> {
  const privateState = await readHostedMemberRoutingPrivateState(
    routing,
    prisma,
    retainFailureInScopedCache,
  );

  return {
    hasPendingLinqRouteState: [
      routing.pendingLinqChatIdEncrypted,
      routing.pendingLinqChatLookupKey,
      routing.pendingLinqParticipantContactEncrypted,
      routing.pendingLinqParticipantContactKind,
      routing.pendingLinqParticipantContactLookupKey,
      routing.pendingLinqParticipantContactObservedAt,
      routing.pendingLinqRecipientPhoneEncrypted,
      routing.pendingLinqRecipientPhoneLookupKey,
    ].some((column) => column !== null && column !== undefined),
    linqChatId: privateState.linqChatId,
    linqChatLookupKey: routing.linqChatLookupKey ?? null,
    linqHomeLineAssignedAt: routing.linqHomeLineAssignedAt,
    ...projectHostedLinqParticipantIdentity({
      kind: routing.linqParticipantContactKind,
      lookupKey: routing.linqParticipantContactLookupKey,
    }),
    linqRecipientPhone: privateState.linqRecipientPhone,
    linqRecipientPhoneLookupKey: routing.linqRecipientPhoneLookupKey ?? null,
    memberId: routing.memberId,
    pendingLinqChatId: privateState.pendingLinqChatId,
    pendingLinqParticipantContact: projectHostedPendingLinqParticipantContact({
      kind: routing.pendingLinqParticipantContactKind,
      lookupKey: routing.pendingLinqParticipantContactLookupKey,
      observedAt: routing.pendingLinqParticipantContactObservedAt,
      value: privateState.pendingLinqParticipantContact,
    }),
    pendingLinqRecipientPhone: privateState.pendingLinqRecipientPhone,
    replyAliasLookupKey: routing.replyAliasLookupKey ?? null,
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

function projectHostedLinqParticipantIdentity(input: {
  kind: string | null;
  lookupKey: string | null;
}): Pick<HostedMemberRoutingStateSnapshot, "linqParticipantContact"> {
  const kind = normalizeHostedLinqParticipantContactKind(input.kind);
  return kind && input.lookupKey
    ? { linqParticipantContact: { kind, lookupKey: input.lookupKey } }
    : {};
}

function projectHostedPendingLinqParticipantContact(input: {
  kind: string | null;
  lookupKey: string | null;
  observedAt: Date | null;
  value: string | null;
}): HostedLinqParticipantContactClaim | null {
  const kind = normalizeHostedLinqParticipantContactKind(input.kind);
  if (!kind || !input.lookupKey || !input.value) {
    return null;
  }

  return {
    kind,
    lookupKey: input.lookupKey,
    observedAt: input.observedAt,
    value: input.value,
  };
}
