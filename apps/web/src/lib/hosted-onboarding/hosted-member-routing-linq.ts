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
import { hostedOnboardingError } from "./errors";
import { buildHostedMemberRoutingPrivateColumns } from "./member-private-codecs";
import { normalizePhoneNumber } from "./phone";
import { type HostedOnboardingReadClient } from "./shared";

export type HostedMemberPendingLinqNewChatReservationOutcome =
  | "already_reserved"
  | "home_chat_exists"
  | "pending_chat_exists"
  | "reservation_conflict"
  | "reserved";

export async function upsertHostedMemberPendingLinqBindingTx(input: {
  existingChatPolicy?: "replace" | "fail";
  expectedNewChatReservationKey?: string | null;
  linqChatId: string;
  memberId: string;
  participantContact?: HostedLinqParticipantContact | null;
  participantContactObservedAt?: Date | null;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}): Promise<void> {
  await writeHostedMemberLinqBindingTx({
    clearPending: false,
    existingChatPolicy: input.existingChatPolicy ?? "replace",
    expectedNewChatReservationKey: input.expectedNewChatReservationKey ?? null,
    kind: "pending",
    linqChatId: input.linqChatId,
    memberId: input.memberId,
    participantContact: input.participantContact ?? null,
    participantContactObservedAt: input.participantContactObservedAt ?? null,
    prisma: input.prisma,
    recipientPhone: input.recipientPhone,
  });
}

export async function reserveHostedMemberPendingLinqNewChatTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  reservationKey: string;
  reservedAt: Date;
}): Promise<HostedMemberPendingLinqNewChatReservationOutcome> {
  const reservationKey = normalizeHostedOpaqueInput(input.reservationKey);
  if (!reservationKey) {
    throw new TypeError("Hosted Linq new-chat reservation requires a non-empty key.");
  }
  if (Number.isNaN(input.reservedAt.getTime())) {
    throw new TypeError("Hosted Linq new-chat reservation timestamp must be valid.");
  }

  await acquireHostedLinqRoutingWriteLockTx({
    lockValue: input.memberId,
    namespace: "member",
    tx: input.prisma,
  });

  const existingRouting = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      linqChatLookupKey: true,
      pendingLinqChatLookupKey: true,
      pendingLinqNewChatReservationKey: true,
    },
  });

  if (existingRouting?.linqChatLookupKey) {
    return "home_chat_exists";
  }
  if (existingRouting?.pendingLinqChatLookupKey) {
    return "pending_chat_exists";
  }
  if (existingRouting?.pendingLinqNewChatReservationKey) {
    return existingRouting.pendingLinqNewChatReservationKey === reservationKey
      ? "already_reserved"
      : "reservation_conflict";
  }

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
      pendingLinqNewChatReservationKey: reservationKey,
      pendingLinqNewChatReservedAt: input.reservedAt,
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
      pendingLinqNewChatReservationKey: reservationKey,
      pendingLinqNewChatReservedAt: input.reservedAt,
    },
  });

  return "reserved";
}

export async function clearHostedMemberPendingLinqNewChatReservationTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  reservationKey: string;
}): Promise<void> {
  const reservationKey = normalizeHostedOpaqueInput(input.reservationKey);
  if (!reservationKey) {
    throw new TypeError("Hosted Linq new-chat reservation requires a non-empty key.");
  }

  await acquireHostedLinqRoutingWriteLockTx({
    lockValue: input.memberId,
    namespace: "member",
    tx: input.prisma,
  });

  await input.prisma.hostedMemberRouting.updateMany({
    where: {
      memberId: input.memberId,
      pendingLinqNewChatReservationKey: reservationKey,
    },
    data: {
      pendingLinqNewChatReservationKey: null,
      pendingLinqNewChatReservedAt: null,
    },
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
  linqChatId: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}): Promise<void> {
  await writeHostedMemberLinqBindingTx({
    clearPending: input.clearPending ?? false,
    existingChatPolicy: "replace",
    expectedNewChatReservationKey: null,
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
      linqRecipientPhoneEncrypted: routingPrivateColumns.linqRecipientPhoneEncrypted,
      linqRecipientPhoneLookupKey: recipientPhoneLookupKey,
      memberId: input.memberId,
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
      pendingLinqNewChatReservationKey: null,
      pendingLinqNewChatReservedAt: null,
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
            linqLastInboundAt: promotedLinqLastInboundAt,
            pendingLinqChatIdEncrypted: null,
            pendingLinqChatLookupKey: null,
            pendingLinqNewChatReservationKey: null,
            pendingLinqNewChatReservedAt: null,
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
  existingChatPolicy: "replace" | "fail";
  expectedNewChatReservationKey: string | null;
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
  const expectedNewChatReservationKey = normalizeHostedOpaqueInput(
    input.expectedNewChatReservationKey,
  );

  if (!linqChatLookupKey || linqChatLookupKeys.length === 0) {
    throw new TypeError("Hosted Linq routing requires a non-empty chat id.");
  }
  if (input.expectedNewChatReservationKey && !expectedNewChatReservationKey) {
    throw new TypeError("Hosted Linq routing requires a non-empty reservation key.");
  }

  if (input.kind === "pending" && input.existingChatPolicy === "fail") {
    await acquireHostedLinqRoutingWriteLockTx({
      lockValue: input.memberId,
      namespace: "member",
      tx: input.prisma,
    });
    const existingRouting = await input.prisma.hostedMemberRouting.findUnique({
      where: {
        memberId: input.memberId,
      },
      select: {
        linqChatLookupKey: true,
        pendingLinqChatLookupKey: true,
        pendingLinqNewChatReservationKey: true,
      },
    });

    if (existingRouting?.linqChatLookupKey) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_HOME_CHAT_ALREADY_BOUND",
        httpStatus: 409,
        message: "Hosted Linq routing already has a home chat for this member.",
        retryable: false,
      });
    }

    if (existingRouting?.pendingLinqChatLookupKey) {
      if (linqChatLookupKeys.includes(existingRouting.pendingLinqChatLookupKey)) {
        return;
      }
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_PENDING_CHAT_CONFLICT",
        httpStatus: 409,
        message: "Hosted Linq routing already has a different pending chat for this member.",
        retryable: false,
      });
    }

    if (
      expectedNewChatReservationKey
      && existingRouting?.pendingLinqNewChatReservationKey !== expectedNewChatReservationKey
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_PENDING_CHAT_RESERVATION_CONFLICT",
        httpStatus: 409,
        message: "Hosted Linq routing new-chat reservation is no longer owned by this send.",
        retryable: false,
      });
    }
  }

  const participantContactLookupKeys = input.participantContact
    ? readHostedLinqParticipantContactLookupKeys(input.participantContact)
    : [];
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
      pendingLinqLastInboundAt: scopedPendingLinqLastInboundAt,
      recipientPhoneLookupKey,
      routingPrivateColumns,
      promotedLinqLastInboundAt,
    }),
  });
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
    pendingLinqNewChatReservationKey: null,
    pendingLinqNewChatReservedAt: null,
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
  pendingLinqLastInboundAt: Date | null;
  promotedLinqLastInboundAt: Date | null;
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
            linqLastInboundAt: input.promotedLinqLastInboundAt,
            pendingLinqChatIdEncrypted: null,
            pendingLinqChatLookupKey: null,
            pendingLinqNewChatReservationKey: null,
            pendingLinqNewChatReservedAt: null,
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
    pendingLinqChatIdEncrypted: input.routingPrivateColumns.pendingLinqChatIdEncrypted,
    pendingLinqChatLookupKey: input.linqChatLookupKey,
    pendingLinqNewChatReservationKey: null,
    pendingLinqNewChatReservedAt: null,
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
  await input.tx.hostedMemberRouting.updateMany({
    where: {
      linqChatLookupKey: {
        in: [...input.linqChatLookupKeys],
      },
      NOT: {
        memberId: input.memberId,
      },
    },
    data: {
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      linqRecipientPhoneEncrypted: null,
      linqRecipientPhoneLookupKey: null,
      linqLastInboundAt: null,
    },
  });

  await input.tx.hostedMemberRouting.updateMany({
    where: {
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
  namespace: "chat" | "member" | "participant-contact" | "recipient-assignment";
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
