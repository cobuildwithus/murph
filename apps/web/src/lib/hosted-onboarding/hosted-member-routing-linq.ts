import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "./contact-privacy";
import type { HostedLinqParticipantContact } from "./linq-participant-contact";
import { buildHostedMemberRoutingPrivateColumns } from "./member-private-codecs";
import { normalizePhoneNumber } from "./phone";
import { type HostedOnboardingReadClient } from "./shared";

export async function upsertHostedMemberPendingLinqBindingTx(input: {
  linqChatId: string;
  memberId: string;
  participantContact?: HostedLinqParticipantContact | null;
  participantContactObservedAt?: Date | null;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}): Promise<void> {
  await writeHostedMemberLinqBindingTx({
    clearPending: false,
    kind: "pending",
    linqChatId: input.linqChatId,
    memberId: input.memberId,
    participantContact: input.participantContact ?? null,
    participantContactObservedAt: input.participantContactObservedAt ?? null,
    prisma: input.prisma,
    recipientPhone: input.recipientPhone,
  });
}

export async function upsertHostedMemberPendingLinqParticipantContactTx(input: {
  contact: HostedLinqParticipantContact;
  memberId: string;
  observedAt: Date;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  if (Number.isNaN(input.observedAt.getTime())) {
    throw new TypeError("Hosted Linq participant contact observed timestamp must be valid.");
  }

  const routingPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: input.memberId,
    pendingLinqChatId: null,
    pendingLinqParticipantContact: input.contact.value,
    pendingLinqRecipientPhone: null,
    prisma: input.prisma,
    telegramThreadId: null,
    telegramUserId: null,
  });

  await input.prisma.hostedMemberRouting.upsert({
    where: {
      memberId: input.memberId,
    },
    create: {
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      linqRecipientPhoneEncrypted: null,
      linqRecipientPhoneLookupKey: null,
      memberId: input.memberId,
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
      pendingLinqParticipantContactEncrypted:
        routingPrivateColumns.pendingLinqParticipantContactEncrypted,
      pendingLinqParticipantContactKind: input.contact.kind,
      pendingLinqParticipantContactLookupKey: input.contact.lookupKey,
      pendingLinqParticipantContactObservedAt: input.observedAt,
      pendingLinqRecipientPhoneEncrypted: null,
      pendingLinqRecipientPhoneLookupKey: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    },
    update: {
      pendingLinqParticipantContactEncrypted:
        routingPrivateColumns.pendingLinqParticipantContactEncrypted,
      pendingLinqParticipantContactKind: input.contact.kind,
      pendingLinqParticipantContactLookupKey: input.contact.lookupKey,
      pendingLinqParticipantContactObservedAt: input.observedAt,
    },
  });
}

export async function tryCreateHostedMemberPendingLinqParticipantContactTx(input: {
  contact: HostedLinqParticipantContact;
  memberId: string;
  observedAt: Date;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  if (Number.isNaN(input.observedAt.getTime())) {
    throw new TypeError("Hosted Linq participant contact observed timestamp must be valid.");
  }

  const routingPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: input.memberId,
    pendingLinqChatId: null,
    pendingLinqParticipantContact: input.contact.value,
    pendingLinqRecipientPhone: null,
    prisma: input.prisma,
    telegramThreadId: null,
    telegramUserId: null,
  });

  const result = await input.prisma.hostedMemberRouting.createMany({
    data: {
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      linqRecipientPhoneEncrypted: null,
      linqRecipientPhoneLookupKey: null,
      memberId: input.memberId,
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
      pendingLinqParticipantContactEncrypted:
        routingPrivateColumns.pendingLinqParticipantContactEncrypted,
      pendingLinqParticipantContactKind: input.contact.kind,
      pendingLinqParticipantContactLookupKey: input.contact.lookupKey,
      pendingLinqParticipantContactObservedAt: input.observedAt,
      pendingLinqRecipientPhoneEncrypted: null,
      pendingLinqRecipientPhoneLookupKey: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    },
    skipDuplicates: true,
  });

  return result.count > 0;
}

export async function upsertHostedMemberHomeLinqBindingTx(input: {
  clearPending?: boolean;
  linqChatId: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}): Promise<void> {
  await writeHostedMemberLinqBindingTx({
    clearPending: input.clearPending ?? false,
    kind: "home",
    linqChatId: input.linqChatId,
    memberId: input.memberId,
    participantContact: null,
    participantContactObservedAt: null,
    prisma: input.prisma,
    recipientPhone: input.recipientPhone,
  });
}

export async function upsertHostedMemberHomeLinqRecipientPhoneTx(input: {
  clearPending?: boolean;
  memberId: string;
  prisma: Prisma.TransactionClient;
  recipientPhone: string;
}): Promise<void> {
  const recipientPhone = normalizePhoneNumber(input.recipientPhone);
  const recipientPhoneLookupKey = createHostedPhoneLookupKey(recipientPhone);

  if (!recipientPhone || !recipientPhoneLookupKey) {
    throw new TypeError(
      "Hosted Linq home-line assignment requires a non-empty recipient phone.",
    );
  }

  const routingPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
    linqChatId: null,
    linqRecipientPhone: recipientPhone,
    memberId: input.memberId,
    pendingLinqChatId: null,
    pendingLinqParticipantContact: null,
    pendingLinqRecipientPhone: null,
    prisma: input.prisma,
    telegramThreadId: null,
    telegramUserId: null,
  });

  await input.prisma.hostedMemberRouting.upsert({
    where: {
      memberId: input.memberId,
    },
    create: {
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      linqRecipientPhoneEncrypted: routingPrivateColumns.linqRecipientPhoneEncrypted,
      linqRecipientPhoneLookupKey: recipientPhoneLookupKey,
      memberId: input.memberId,
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
      pendingLinqParticipantContactEncrypted: null,
      pendingLinqParticipantContactKind: null,
      pendingLinqParticipantContactLookupKey: null,
      pendingLinqParticipantContactObservedAt: null,
      pendingLinqRecipientPhoneEncrypted: null,
      pendingLinqRecipientPhoneLookupKey: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    },
    update: {
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      linqRecipientPhoneEncrypted: routingPrivateColumns.linqRecipientPhoneEncrypted,
      linqRecipientPhoneLookupKey: recipientPhoneLookupKey,
      ...(input.clearPending
        ? {
            pendingLinqChatIdEncrypted: null,
            pendingLinqChatLookupKey: null,
            pendingLinqParticipantContactEncrypted: null,
            pendingLinqParticipantContactKind: null,
            pendingLinqParticipantContactLookupKey: null,
            pendingLinqParticipantContactObservedAt: null,
            pendingLinqRecipientPhoneEncrypted: null,
            pendingLinqRecipientPhoneLookupKey: null,
          }
        : {}),
    },
  });
}

export async function countHostedMemberHomeLinqBindingsByRecipientPhone(input: {
  prisma: HostedOnboardingReadClient;
  recipientPhones: readonly string[];
}): Promise<Map<string, number>> {
  const recipientPhoneEntries = buildHostedRecipientPhoneLookupEntries(
    input.recipientPhones,
  );

  if (recipientPhoneEntries.length === 0) {
    return new Map();
  }

  const counts = new Map<string, number>(
    recipientPhoneEntries.map(({ recipientPhone }) => [recipientPhone, 0]),
  );
  const recipientPhoneByLookupKey = new Map(
    recipientPhoneEntries.map(({ lookupKey, recipientPhone }) => [
      lookupKey,
      recipientPhone,
    ] as const),
  );

  const routingRecords = await input.prisma.hostedMemberRouting.findMany({
    where: {
      linqRecipientPhoneLookupKey: {
        in: recipientPhoneEntries.map(({ lookupKey }) => lookupKey),
      },
      member: {
        is: {
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
      },
    },
    select: {
      linqRecipientPhoneLookupKey: true,
    },
  });

  for (const routingRecord of routingRecords) {
    const recipientPhone = routingRecord.linqRecipientPhoneLookupKey
      ? recipientPhoneByLookupKey.get(routingRecord.linqRecipientPhoneLookupKey)
      : null;

    if (!recipientPhone) {
      continue;
    }

    counts.set(recipientPhone, (counts.get(recipientPhone) ?? 0) + 1);
  }

  return counts;
}

async function writeHostedMemberLinqBindingTx(input: {
  clearPending: boolean;
  kind: "home" | "pending";
  linqChatId: string;
  memberId: string;
  participantContact: HostedLinqParticipantContact | null;
  participantContactObservedAt: Date | null;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}): Promise<void> {
  const linqChatLookupKey = createHostedLinqChatLookupKey(input.linqChatId);

  if (!linqChatLookupKey) {
    throw new TypeError("Hosted Linq routing requires a non-empty chat id.");
  }

  const recipientPhone = normalizePhoneNumber(input.recipientPhone);
  const recipientPhoneLookupKey = createHostedPhoneLookupKey(recipientPhone);
  const routingPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
    linqChatId: input.kind === "home" ? input.linqChatId : null,
    linqRecipientPhone: input.kind === "home" ? recipientPhone : null,
    memberId: input.memberId,
    pendingLinqChatId: input.kind === "pending" ? input.linqChatId : null,
    pendingLinqParticipantContact: input.kind === "pending"
      ? input.participantContact?.value ?? null
      : null,
    pendingLinqRecipientPhone: input.kind === "pending" ? recipientPhone : null,
    prisma: input.prisma,
    telegramThreadId: null,
    telegramUserId: null,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await clearHostedMemberLinqChatConflicts({
        linqChatLookupKey,
        memberId: input.memberId,
        tx: input.prisma,
      });

      await input.prisma.hostedMemberRouting.upsert({
        where: {
          memberId: input.memberId,
        },
        create: buildHostedMemberLinqBindingCreateData({
          kind: input.kind,
          linqChatLookupKey,
          memberId: input.memberId,
          participantContact: input.participantContact,
          participantContactObservedAt: input.participantContactObservedAt,
          recipientPhoneLookupKey,
          routingPrivateColumns,
        }),
        update: buildHostedMemberLinqBindingUpdateData({
          clearPending: input.clearPending,
          kind: input.kind,
          linqChatLookupKey,
          participantContact: input.participantContact,
          participantContactObservedAt: input.participantContactObservedAt,
          recipientPhoneLookupKey,
          routingPrivateColumns,
        }),
      });
      return;
    } catch (error) {
      if (attempt === 0 && isPrismaUniqueConstraintError(error)) {
        continue;
      }

      throw error;
    }
  }
}

function buildHostedMemberLinqBindingCreateData(input: {
  kind: "home" | "pending";
  linqChatLookupKey: string;
  memberId: string;
  participantContact: HostedLinqParticipantContact | null;
  participantContactObservedAt: Date | null;
  recipientPhoneLookupKey: string | null;
  routingPrivateColumns: Awaited<ReturnType<typeof buildHostedMemberRoutingPrivateColumns>>;
}): Prisma.HostedMemberRoutingUncheckedCreateInput {
  return {
    linqChatIdEncrypted: input.kind === "home"
      ? input.routingPrivateColumns.linqChatIdEncrypted
      : null,
    linqChatLookupKey: input.kind === "home" ? input.linqChatLookupKey : null,
    linqRecipientPhoneEncrypted: input.kind === "home"
      ? input.routingPrivateColumns.linqRecipientPhoneEncrypted
      : null,
    linqRecipientPhoneLookupKey: input.kind === "home"
      ? input.recipientPhoneLookupKey
      : null,
    memberId: input.memberId,
    pendingLinqChatIdEncrypted: input.kind === "pending"
      ? input.routingPrivateColumns.pendingLinqChatIdEncrypted
      : null,
    pendingLinqChatLookupKey: input.kind === "pending" ? input.linqChatLookupKey : null,
    pendingLinqParticipantContactEncrypted: input.kind === "pending"
      ? input.routingPrivateColumns.pendingLinqParticipantContactEncrypted
      : null,
    pendingLinqParticipantContactKind: input.kind === "pending"
      ? input.participantContact?.kind ?? null
      : null,
    pendingLinqParticipantContactLookupKey: input.kind === "pending"
      ? input.participantContact?.lookupKey ?? null
      : null,
    pendingLinqParticipantContactObservedAt: input.kind === "pending"
      ? input.participantContactObservedAt
      : null,
    pendingLinqRecipientPhoneEncrypted: input.kind === "pending"
      ? input.routingPrivateColumns.pendingLinqRecipientPhoneEncrypted
      : null,
    pendingLinqRecipientPhoneLookupKey: input.kind === "pending"
      ? input.recipientPhoneLookupKey
      : null,
    telegramUserIdEncrypted: null,
    telegramUserLookupKey: null,
  };
}

function buildHostedMemberLinqBindingUpdateData(input: {
  clearPending: boolean;
  kind: "home" | "pending";
  linqChatLookupKey: string;
  participantContact: HostedLinqParticipantContact | null;
  participantContactObservedAt: Date | null;
  recipientPhoneLookupKey: string | null;
  routingPrivateColumns: Awaited<ReturnType<typeof buildHostedMemberRoutingPrivateColumns>>;
}): Prisma.HostedMemberRoutingUncheckedUpdateInput {
  if (input.kind === "home") {
    return {
      linqChatIdEncrypted: input.routingPrivateColumns.linqChatIdEncrypted,
      linqChatLookupKey: input.linqChatLookupKey,
      linqRecipientPhoneEncrypted: input.routingPrivateColumns.linqRecipientPhoneEncrypted,
      linqRecipientPhoneLookupKey: input.recipientPhoneLookupKey,
      ...(input.clearPending
        ? {
            pendingLinqChatIdEncrypted: null,
            pendingLinqChatLookupKey: null,
            pendingLinqParticipantContactEncrypted: null,
            pendingLinqParticipantContactKind: null,
            pendingLinqParticipantContactLookupKey: null,
            pendingLinqParticipantContactObservedAt: null,
            pendingLinqRecipientPhoneEncrypted: null,
            pendingLinqRecipientPhoneLookupKey: null,
          }
        : {}),
    };
  }

  return {
    pendingLinqChatIdEncrypted: input.routingPrivateColumns.pendingLinqChatIdEncrypted,
    pendingLinqChatLookupKey: input.linqChatLookupKey,
    ...(input.participantContact
      ? {
          pendingLinqParticipantContactEncrypted:
            input.routingPrivateColumns.pendingLinqParticipantContactEncrypted,
          pendingLinqParticipantContactKind: input.participantContact.kind,
          pendingLinqParticipantContactLookupKey: input.participantContact.lookupKey,
          pendingLinqParticipantContactObservedAt: input.participantContactObservedAt,
        }
      : {}),
    pendingLinqRecipientPhoneEncrypted:
      input.routingPrivateColumns.pendingLinqRecipientPhoneEncrypted,
    pendingLinqRecipientPhoneLookupKey: input.recipientPhoneLookupKey,
  };
}

async function clearHostedMemberLinqChatConflicts(input: {
  linqChatLookupKey: string;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.hostedMemberRouting.updateMany({
    where: {
      linqChatLookupKey: input.linqChatLookupKey,
      NOT: {
        memberId: input.memberId,
      },
    },
    data: {
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      linqRecipientPhoneEncrypted: null,
      linqRecipientPhoneLookupKey: null,
    },
  });

  await input.tx.hostedMemberRouting.updateMany({
    where: {
      pendingLinqChatLookupKey: input.linqChatLookupKey,
      NOT: {
        memberId: input.memberId,
      },
    },
    data: {
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
      pendingLinqParticipantContactEncrypted: null,
      pendingLinqParticipantContactKind: null,
      pendingLinqParticipantContactLookupKey: null,
      pendingLinqParticipantContactObservedAt: null,
      pendingLinqRecipientPhoneEncrypted: null,
      pendingLinqRecipientPhoneLookupKey: null,
    },
  });
}

function buildHostedRecipientPhoneLookupEntries(
  recipientPhones: readonly string[],
): Array<{ lookupKey: string; recipientPhone: string }> {
  const seenRecipientPhones = new Set<string>();
  const entries: Array<{ lookupKey: string; recipientPhone: string }> = [];

  for (const value of recipientPhones) {
    const recipientPhone = normalizePhoneNumber(value);

    if (!recipientPhone || seenRecipientPhones.has(recipientPhone)) {
      continue;
    }

    const lookupKey = createHostedPhoneLookupKey(recipientPhone);

    if (!lookupKey) {
      continue;
    }

    seenRecipientPhones.add(recipientPhone);
    entries.push({
      lookupKey,
      recipientPhone,
    });
  }

  return entries;
}

function isPrismaUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
