import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
  normalizeHostedOpaqueInput,
} from "./contact-privacy";
import {
  createHostedLinqParticipantContactLookupKeyReadCandidates,
  normalizeHostedLinqParticipantContactValue,
  type HostedLinqParticipantContact,
} from "./linq-participant-contact";
import { buildHostedMemberRoutingPrivateColumns } from "./member-private-codecs";
import { hostedOnboardingError } from "./errors";
import { normalizePhoneNumber } from "./phone";
import { type HostedOnboardingReadClient } from "./shared";

export async function upsertHostedMemberPendingLinqBindingTx(input: {
  homeLineAssignedAt?: Date | null;
  linqChatId: string;
  memberId: string;
  participantContact?: HostedLinqParticipantContact | null;
  participantContactObservedAt?: Date | null;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}): Promise<void> {
  await writeHostedMemberLinqBindingTx({
    clearPending: false,
    homeLineAssignedAt: input.homeLineAssignedAt ?? null,
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

  const contactLookupKeys = readHostedLinqParticipantContactLookupKeys(input.contact);
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

  await acquireHostedLinqRoutingWriteLockTx({
    lockValue: buildHostedLinqParticipantContactLockValue(input.contact),
    namespace: "participant-contact",
    tx: input.prisma,
  });
  await assertHostedPendingLinqParticipantContactAvailableTx({
    lookupKeys: contactLookupKeys,
    memberId: input.memberId,
    tx: input.prisma,
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

  const contactLookupKeys = readHostedLinqParticipantContactLookupKeys(input.contact);
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

  await acquireHostedLinqRoutingWriteLockTx({
    lockValue: buildHostedLinqParticipantContactLockValue(input.contact),
    namespace: "participant-contact",
    tx: input.prisma,
  });

  const existingRoutes = await findHostedPendingLinqParticipantContactRoutesTx({
    lookupKeys: contactLookupKeys,
    tx: input.prisma,
  });
  if (existingRoutes.length > 0) {
    return false;
  }

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
  homeLineAssignedAt?: Date | null;
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
    homeLineAssignedAt: input.homeLineAssignedAt ?? null,
  });
}

export async function clearHostedMemberBareHomeLinqReservationTx(input: {
  homeLineAssignedAt: Date;
  memberId: string;
  prisma: Prisma.TransactionClient;
  recipientPhone: string;
}): Promise<void> {
  const recipientPhone = normalizePhoneNumber(input.recipientPhone);
  const lookupKeys = createHostedPhoneLookupKeyReadCandidates(recipientPhone);
  if (lookupKeys.length === 0) {
    return;
  }

  // Release only the exact bare reservation this request created; a route
  // that gained a chat binding in the meantime must keep its line.
  await input.prisma.hostedMemberRouting.updateMany({
    where: {
      linqChatLookupKey: null,
      linqHomeLineAssignedAt: input.homeLineAssignedAt,
      linqRecipientPhoneLookupKey: {
        in: [...lookupKeys],
      },
      memberId: input.memberId,
      pendingLinqChatLookupKey: null,
    },
    data: {
      linqHomeLineAssignedAt: null,
      linqRecipientPhoneEncrypted: null,
      linqRecipientPhoneLookupKey: null,
    },
  });
}

export async function upsertHostedMemberHomeLinqRecipientPhoneTx(input: {
  clearPending?: boolean;
  homeLineAssignedAt?: Date;
  memberId: string;
  prisma: Prisma.TransactionClient;
  recipientPhone: string;
}): Promise<void> {
  const recipientPhone = normalizePhoneNumber(input.recipientPhone);
  const recipientPhoneLookupKey = createHostedPhoneLookupKey(recipientPhone);
  const recipientPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(recipientPhone);

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
  const promotedLinqLastInboundAt =
    await readHostedMemberPromotedLinqLastInboundAtTx({
      clearPending: input.clearPending ?? false,
      memberId: input.memberId,
      prisma: input.prisma,
      recipientPhoneLookupKeys,
    });

  await input.prisma.hostedMemberRouting.upsert({
    where: {
      memberId: input.memberId,
    },
    create: {
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      ...(input.homeLineAssignedAt === undefined
        ? {}
        : { linqHomeLineAssignedAt: input.homeLineAssignedAt }),
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
      ...(input.homeLineAssignedAt === undefined
        ? {}
        : { linqHomeLineAssignedAt: input.homeLineAssignedAt }),
      linqRecipientPhoneEncrypted: routingPrivateColumns.linqRecipientPhoneEncrypted,
      linqRecipientPhoneLookupKey: recipientPhoneLookupKey,
      ...(input.clearPending
        ? {
            linqLastInboundAt: promotedLinqLastInboundAt,
            pendingLinqChatIdEncrypted: null,
            pendingLinqChatLookupKey: null,
            pendingLinqParticipantContactEncrypted: null,
            pendingLinqParticipantContactKind: null,
            pendingLinqParticipantContactLookupKey: null,
            pendingLinqParticipantContactObservedAt: null,
            pendingLinqRecipientPhoneEncrypted: null,
            pendingLinqRecipientPhoneLookupKey: null,
            pendingLinqLastInboundAt: null,
          }
        : {}),
    },
  });
}

export async function acquireHostedMemberHomeLinqRecipientAssignmentLockTx(input: {
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await acquireHostedLinqRoutingWriteLockTx({
    lockValue: "home-line-pool",
    namespace: "recipient-assignment",
    tx: input.prisma,
  });
}

export async function countHostedMemberHomeLinqBindingsByRecipientPhone(input: {
  excludedMemberId?: string | null;
  now: Date;
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

  const groupedCounts = await input.prisma.hostedMemberRouting.groupBy({
    by: ["linqRecipientPhoneLookupKey"],
    where: {
      linqRecipientPhoneLookupKey: {
        in: recipientPhoneEntries.map(({ lookupKey }) => lookupKey),
      },
      ...(input.excludedMemberId
        ? {
            memberId: {
              not: input.excludedMemberId,
            },
          }
        : {}),
      OR: [
        {
          member: {
            is: {
              billingStatus: HostedBillingStatus.active,
              suspendedAt: null,
            },
          },
        },
        {
          member: {
            is: {
              accountGroupMemberships: {
                some: {
                  group: {
                    billingStatus: HostedBillingStatus.active,
                    suspendedAt: null,
                  },
                  status: "active",
                },
              },
              suspendedAt: null,
            },
          },
        },
        {
          linqHomeLineAssignedAt: {
            not: null,
          },
          member: {
            is: {
              billingStatus: {
                in: [
                  HostedBillingStatus.not_started,
                  HostedBillingStatus.incomplete,
                ],
              },
              invites: {
                some: {
                  channel: "linq",
                  expiresAt: {
                    gt: input.now,
                  },
                },
              },
              suspendedAt: null,
            },
          },
        },
      ],
    },
    _count: {
      _all: true,
    },
  });

  for (const groupedCount of groupedCounts) {
    const recipientPhone = groupedCount.linqRecipientPhoneLookupKey
      ? recipientPhoneByLookupKey.get(groupedCount.linqRecipientPhoneLookupKey)
      : null;

    if (!recipientPhone) {
      continue;
    }

    counts.set(recipientPhone, (counts.get(recipientPhone) ?? 0) + groupedCount._count._all);
  }

  return counts;
}

export async function countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince(input: {
  prisma: HostedOnboardingReadClient;
  recipientPhones: readonly string[];
  since: Date;
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

  const groupedCounts = await input.prisma.hostedMemberRouting.groupBy({
    by: ["linqRecipientPhoneLookupKey"],
    where: {
      linqHomeLineAssignedAt: {
        gte: input.since,
      },
      linqRecipientPhoneLookupKey: {
        in: recipientPhoneEntries.map(({ lookupKey }) => lookupKey),
      },
    },
    _count: {
      _all: true,
    },
  });

  for (const groupedCount of groupedCounts) {
    const recipientPhone = groupedCount.linqRecipientPhoneLookupKey
      ? recipientPhoneByLookupKey.get(groupedCount.linqRecipientPhoneLookupKey)
      : null;

    if (!recipientPhone) {
      continue;
    }

    counts.set(recipientPhone, (counts.get(recipientPhone) ?? 0) + groupedCount._count._all);
  }

  return counts;
}

async function writeHostedMemberLinqBindingTx(input: {
  clearPending: boolean;
  homeLineAssignedAt: Date | null;
  kind: "home" | "pending";
  linqChatId: string;
  memberId: string;
  participantContact: HostedLinqParticipantContact | null;
  participantContactObservedAt: Date | null;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}): Promise<void> {
  const linqChatLookupKey = createHostedLinqChatLookupKey(input.linqChatId);
  const linqChatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.linqChatId);

  if (!linqChatLookupKey || linqChatLookupKeys.length === 0) {
    throw new TypeError("Hosted Linq routing requires a non-empty chat id.");
  }

  const participantContactLookupKeys = input.participantContact
    ? readHostedLinqParticipantContactLookupKeys(input.participantContact)
    : [];
  const recipientPhone = normalizePhoneNumber(input.recipientPhone);
  const recipientPhoneLookupKey = createHostedPhoneLookupKey(recipientPhone);
  const reservesHomeRecipient = input.kind === "home" || input.homeLineAssignedAt !== null;
  const routingPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
    linqChatId: input.kind === "home" ? input.linqChatId : null,
    linqRecipientPhone: reservesHomeRecipient ? recipientPhone : null,
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

  if (input.participantContact) {
    await acquireHostedLinqRoutingWriteLockTx({
      lockValue: buildHostedLinqParticipantContactLockValue(input.participantContact),
      namespace: "participant-contact",
      tx: input.prisma,
    });
    await assertHostedPendingLinqParticipantContactAvailableTx({
      lookupKeys: participantContactLookupKeys,
      memberId: input.memberId,
      tx: input.prisma,
    });
  }

  await acquireHostedLinqRoutingWriteLockTx({
    lockValue: normalizeHostedOpaqueInput(input.linqChatId),
    namespace: "chat",
    tx: input.prisma,
  });
  await clearHostedMemberLinqChatConflicts({
    linqChatLookupKeys,
    memberId: input.memberId,
    tx: input.prisma,
  });
  const promotedLinqLastInboundAt =
    await readHostedMemberPromotedLinqLastInboundAtTx({
      clearPending: input.clearPending,
      linqChatLookupKeys,
      memberId: input.memberId,
      prisma: input.prisma,
    });
  const scopedPendingLinqLastInboundAt = input.kind === "pending"
    ? await readHostedMemberPendingLinqLastInboundAtTx({
        linqChatLookupKeys,
        memberId: input.memberId,
        prisma: input.prisma,
      })
    : null;

  await input.prisma.hostedMemberRouting.upsert({
    where: {
      memberId: input.memberId,
    },
    create: buildHostedMemberLinqBindingCreateData({
      kind: input.kind,
      homeLineAssignedAt: input.homeLineAssignedAt,
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
      homeLineAssignedAt: input.homeLineAssignedAt,
      linqChatLookupKey,
      participantContact: input.participantContact,
      participantContactObservedAt: input.participantContactObservedAt,
      pendingLinqLastInboundAt: scopedPendingLinqLastInboundAt,
      recipientPhoneLookupKey,
      routingPrivateColumns,
      promotedLinqLastInboundAt,
    }),
  });
}

function buildHostedMemberLinqBindingCreateData(input: {
  homeLineAssignedAt: Date | null;
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
    ...(input.homeLineAssignedAt
      ? { linqHomeLineAssignedAt: input.homeLineAssignedAt }
      : {}),
    linqRecipientPhoneEncrypted: input.kind === "home" || input.homeLineAssignedAt
      ? input.routingPrivateColumns.linqRecipientPhoneEncrypted
      : null,
    linqRecipientPhoneLookupKey: input.kind === "home" || input.homeLineAssignedAt
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
  homeLineAssignedAt: Date | null;
  kind: "home" | "pending";
  linqChatLookupKey: string;
  participantContact: HostedLinqParticipantContact | null;
  participantContactObservedAt: Date | null;
  pendingLinqLastInboundAt: Date | null;
  promotedLinqLastInboundAt: Date | null;
  recipientPhoneLookupKey: string | null;
  routingPrivateColumns: Awaited<ReturnType<typeof buildHostedMemberRoutingPrivateColumns>>;
}): Prisma.HostedMemberRoutingUncheckedUpdateInput {
  if (input.kind === "home") {
    return {
      linqChatIdEncrypted: input.routingPrivateColumns.linqChatIdEncrypted,
      linqChatLookupKey: input.linqChatLookupKey,
      ...(input.homeLineAssignedAt === null
        ? {}
        : { linqHomeLineAssignedAt: input.homeLineAssignedAt }),
      linqRecipientPhoneEncrypted: input.routingPrivateColumns.linqRecipientPhoneEncrypted,
      linqRecipientPhoneLookupKey: input.recipientPhoneLookupKey,
      ...(input.clearPending
        ? {
            linqLastInboundAt: input.promotedLinqLastInboundAt,
            pendingLinqChatIdEncrypted: null,
            pendingLinqChatLookupKey: null,
            pendingLinqParticipantContactEncrypted: null,
            pendingLinqParticipantContactKind: null,
            pendingLinqParticipantContactLookupKey: null,
            pendingLinqParticipantContactObservedAt: null,
            pendingLinqRecipientPhoneEncrypted: null,
            pendingLinqRecipientPhoneLookupKey: null,
            pendingLinqLastInboundAt: null,
          }
        : {}),
    };
  }

  return {
    ...(input.homeLineAssignedAt
      ? {
          linqHomeLineAssignedAt: input.homeLineAssignedAt,
          linqRecipientPhoneEncrypted: input.routingPrivateColumns.linqRecipientPhoneEncrypted,
          linqRecipientPhoneLookupKey: input.recipientPhoneLookupKey,
        }
      : {}),
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
    pendingLinqLastInboundAt: input.pendingLinqLastInboundAt,
    pendingLinqRecipientPhoneLookupKey: input.recipientPhoneLookupKey,
  };
}

async function readHostedMemberPromotedLinqLastInboundAtTx(input: {
  clearPending: boolean;
  linqChatLookupKeys?: readonly string[];
  memberId: string;
  prisma: Prisma.TransactionClient;
  recipientPhoneLookupKeys?: readonly string[];
}): Promise<Date | null> {
  if (!input.clearPending) {
    return null;
  }
  const linqChatLookupKeys = new Set(input.linqChatLookupKeys ?? []);
  const recipientPhoneLookupKeys = new Set(input.recipientPhoneLookupKeys ?? []);

  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      linqChatLookupKey: true,
      linqLastInboundAt: true,
      linqRecipientPhoneLookupKey: true,
      pendingLinqChatLookupKey: true,
      pendingLinqLastInboundAt: true,
      pendingLinqRecipientPhoneLookupKey: true,
    },
  });

  if (!routing) {
    return null;
  }

  const candidates: Date[] = [];
  if (
    routing.linqLastInboundAt
    && routeLookupMatches({
      linqChatLookupKey: routing.linqChatLookupKey,
      linqChatLookupKeys,
      recipientPhoneLookupKey: routing.linqRecipientPhoneLookupKey,
      recipientPhoneLookupKeys,
    })
  ) {
    candidates.push(routing.linqLastInboundAt);
  }
  if (
    routing.pendingLinqLastInboundAt
    && routeLookupMatches({
      linqChatLookupKey: routing.pendingLinqChatLookupKey,
      linqChatLookupKeys,
      recipientPhoneLookupKey: routing.pendingLinqRecipientPhoneLookupKey,
      recipientPhoneLookupKeys,
    })
  ) {
    candidates.push(routing.pendingLinqLastInboundAt);
  }

  return readLatestDate(candidates);
}

async function readHostedMemberPendingLinqLastInboundAtTx(input: {
  linqChatLookupKeys: readonly string[];
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<Date | null> {
  const linqChatLookupKeys = new Set(input.linqChatLookupKeys);
  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      pendingLinqChatLookupKey: true,
      pendingLinqLastInboundAt: true,
    },
  });

  return routing?.pendingLinqChatLookupKey
    && linqChatLookupKeys.has(routing.pendingLinqChatLookupKey)
    ? routing.pendingLinqLastInboundAt
    : null;
}

function routeLookupMatches(input: {
  linqChatLookupKey: string | null;
  linqChatLookupKeys: ReadonlySet<string>;
  recipientPhoneLookupKey: string | null;
  recipientPhoneLookupKeys: ReadonlySet<string>;
}): boolean {
  return Boolean(
    (input.linqChatLookupKey && input.linqChatLookupKeys.has(input.linqChatLookupKey))
      || (
        input.recipientPhoneLookupKey
        && input.recipientPhoneLookupKeys.has(input.recipientPhoneLookupKey)
      ),
  );
}

function readLatestDate(dates: readonly Date[]): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (!latest || date.getTime() > latest.getTime()) {
      latest = date;
    }
  }
  return latest;
}

async function clearHostedMemberLinqChatConflicts(input: {
  linqChatLookupKeys: readonly string[];
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  // Another member's home route is durable authority; binding over it must
  // fail closed instead of silently clearing that member's route.
  const conflictingHomeRoute = await input.tx.hostedMemberRouting.findFirst({
    where: {
      linqChatLookupKey: {
        in: [...input.linqChatLookupKeys],
      },
      NOT: {
        memberId: input.memberId,
      },
    },
    select: {
      memberId: true,
    },
  });
  if (conflictingHomeRoute && conflictingHomeRoute.memberId !== input.memberId) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_CHAT_HOME_ROUTE_CONFLICT",
      httpStatus: 409,
      message: "Linq chat is already bound as another member's home chat.",
      retryable: false,
    });
  }

  await input.tx.hostedMemberRouting.updateMany({
    where: {
      linqChatLookupKey: null,
      pendingLinqChatLookupKey: {
        in: [...input.linqChatLookupKeys],
      },
      NOT: {
        memberId: input.memberId,
      },
    },
    data: {
      linqHomeLineAssignedAt: null,
      linqRecipientPhoneEncrypted: null,
      linqRecipientPhoneLookupKey: null,
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
      pendingLinqParticipantContactEncrypted: null,
      pendingLinqParticipantContactKind: null,
      pendingLinqParticipantContactLookupKey: null,
      pendingLinqParticipantContactObservedAt: null,
      pendingLinqRecipientPhoneEncrypted: null,
      pendingLinqRecipientPhoneLookupKey: null,
      pendingLinqLastInboundAt: null,
    },
  });

  await input.tx.hostedMemberRouting.updateMany({
    where: {
      linqChatLookupKey: {
        not: null,
      },
      pendingLinqChatLookupKey: {
        in: [...input.linqChatLookupKeys],
      },
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
      pendingLinqLastInboundAt: null,
    },
  });
}

function buildHostedRecipientPhoneLookupEntries(
  recipientPhones: readonly string[],
): Array<{ lookupKey: string; recipientPhone: string }> {
  const seenRecipientPhones = new Set<string>();
  const seenLookupKeys = new Set<string>();
  const entries: Array<{ lookupKey: string; recipientPhone: string }> = [];

  for (const value of recipientPhones) {
    const recipientPhone = normalizePhoneNumber(value);

    if (!recipientPhone || seenRecipientPhones.has(recipientPhone)) {
      continue;
    }

    const lookupKeys = createHostedPhoneLookupKeyReadCandidates(recipientPhone);

    if (lookupKeys.length === 0) {
      continue;
    }

    seenRecipientPhones.add(recipientPhone);
    for (const lookupKey of lookupKeys) {
      if (seenLookupKeys.has(lookupKey)) {
        continue;
      }

      seenLookupKeys.add(lookupKey);
      entries.push({
        lookupKey,
        recipientPhone,
      });
    }
  }

  return entries;
}

async function acquireHostedLinqRoutingWriteLockTx(input: {
  lockValue: string | null;
  namespace: "chat" | "participant-contact" | "recipient-assignment";
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const lockValue = input.lockValue?.trim() ?? "";
  if (!lockValue) {
    throw new TypeError("Hosted Linq routing lock requires a non-empty value.");
  }

  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`hosted-linq-routing:${input.namespace}`}),
      hashtext(${lockValue})
    )
  `;
}

function readHostedLinqParticipantContactLookupKeys(
  contact: HostedLinqParticipantContact,
): string[] {
  const lookupKeys = createHostedLinqParticipantContactLookupKeyReadCandidates({
    kind: contact.kind,
    value: contact.value,
  });

  if (lookupKeys.length === 0) {
    throw new TypeError("Hosted Linq participant contact requires a valid contact value.");
  }

  return lookupKeys;
}

function buildHostedLinqParticipantContactLockValue(
  contact: HostedLinqParticipantContact,
): string {
  const value = normalizeHostedLinqParticipantContactValue({
    kind: contact.kind,
    value: contact.value,
  });
  if (!value) {
    throw new TypeError("Hosted Linq participant contact requires a valid contact value.");
  }

  return `${contact.kind}:${value}`;
}

async function assertHostedPendingLinqParticipantContactAvailableTx(input: {
  lookupKeys: readonly string[];
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const conflictingRoutes = await findHostedPendingLinqParticipantContactRoutesTx({
    lookupKeys: input.lookupKeys,
    tx: input.tx,
  });
  const conflictingMember = conflictingRoutes.find((route) => route.memberId !== input.memberId);

  if (!conflictingMember) {
    return;
  }

  throw new Prisma.PrismaClientKnownRequestError(
    "Hosted member pending Linq participant contact is already bound to another member.",
    {
      clientVersion: Prisma.prismaVersion.client,
      code: "P2002",
    },
  );
}

async function findHostedPendingLinqParticipantContactRoutesTx(input: {
  lookupKeys: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<Array<{ memberId: string }>> {
  return await input.tx.hostedMemberRouting.findMany({
    where: {
      pendingLinqParticipantContactLookupKey: {
        in: [...input.lookupKeys],
      },
    },
    select: {
      memberId: true,
    },
  });
}
