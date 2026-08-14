import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";

import {
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedLinqChatLookupKey,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
  normalizeHostedOpaqueInput,
} from "./contact-privacy";
import {
  acquireHostedLinqParticipantContactLockTx,
  createHostedLinqParticipantContactLookupKeyReadCandidates,
  type HostedLinqParticipantContact,
  type HostedLinqParticipantIdentity,
} from "./linq-participant-contact";
import { buildHostedMemberRoutingPrivateColumns } from "./member-private-codecs";
import { hostedOnboardingError } from "./errors";
import { normalizePhoneNumber } from "./phone";
import {
  type HostedOnboardingReadClient,
} from "./shared";
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "../hosted-routing/linq-chat-ownership-lock";
import {
  hasUnresolvedHostedLinqProviderDispatchForChatTx,
} from "./linq-delivery-store";

export async function demoteHostedMemberLinqGroupChatBindingsTx(input: {
  enforceProviderDispatchFence?: boolean;
  linqChatId: string;
  mailboxDedupeKey?: string | null;
  prisma: Prisma.TransactionClient;
}): Promise<{ mailboxConsumedAt: Date | null }> {
  const linqChatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(
    input.linqChatId,
  );
  if (linqChatLookupKeys.length === 0) {
    throw new TypeError("Hosted Linq group routing requires a non-empty chat id.");
  }

  if (
    input.enforceProviderDispatchFence === true
    && await hasUnresolvedHostedLinqProviderDispatchForChatTx({
      linqChatId: input.linqChatId,
      prisma: input.prisma,
    })
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_PROVIDER_DISPATCH_IN_FLIGHT",
      httpStatus: 409,
      message: "Linq provider dispatch is still active during group isolation.",
      retryable: true,
    });
  }

  const readBindings = () => input.prisma.hostedMemberRouting.findMany({
    select: {
      memberId: true,
    },
    where: {
      OR: [
        {
          linqChatLookupKey: {
            in: linqChatLookupKeys,
          },
        },
        {
          pendingLinqChatLookupKey: {
            in: linqChatLookupKeys,
          },
        },
      ],
    },
  });
  const bindingsBeforeLocks = await readBindings();
  const lockedMemberIds = [...new Set(
    bindingsBeforeLocks.map((binding) => binding.memberId),
  )].sort();
  for (const memberId of lockedMemberIds) {
    await acquireHostedMemberHomeLinqRouteLockTx({
      memberId,
      prisma: input.prisma,
    });
  }
  await acquireHostedLinqRoutingWriteLockTx({
    lockValue: normalizeHostedOpaqueInput(input.linqChatId),
    namespace: "chat",
    tx: input.prisma,
  });

  if (
    input.enforceProviderDispatchFence === true
    && await hasUnresolvedHostedLinqProviderDispatchForChatTx({
      linqChatId: input.linqChatId,
      prisma: input.prisma,
    })
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_PROVIDER_DISPATCH_IN_FLIGHT",
      httpStatus: 409,
      message: "Linq provider dispatch is still active during group isolation.",
      retryable: true,
    });
  }

  const bindings = await readBindings();
  const memberIds = [...new Set(bindings.map((binding) => binding.memberId))];
  const lockedMemberIdSet = new Set(lockedMemberIds);
  if (memberIds.some((memberId) => !lockedMemberIdSet.has(memberId))) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_ROUTE_CHANGED",
      httpStatus: 503,
      message: "Linq group routing changed while its member owners were locking.",
      retryable: true,
    });
  }

  const mailboxDedupeKey = input.mailboxDedupeKey?.trim() ?? "";
  let mailboxConsumedAt: Date | null = null;
  if (mailboxDedupeKey && memberIds.length > 0) {
    const consumedMailboxItem = await input.prisma.hostedMailboxItem.findFirst({
      orderBy: {
        consumedAt: "asc",
      },
      select: {
        consumedAt: true,
      },
      where: {
        consumedAt: {
          not: null,
        },
        dedupeKey: mailboxDedupeKey,
        userId: {
          in: memberIds,
        },
      },
    });
    mailboxConsumedAt = consumedMailboxItem?.consumedAt ?? null;
    await input.prisma.hostedMailboxItem.deleteMany({
      where: {
        dedupeKey: mailboxDedupeKey,
        userId: {
          in: memberIds,
        },
      },
    });
  }

  await input.prisma.hostedMemberRouting.updateMany({
    where: {
      linqChatLookupKey: {
        in: linqChatLookupKeys,
      },
    },
    data: {
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
    },
  });
  await input.prisma.hostedMemberRouting.updateMany({
    where: {
      pendingLinqChatLookupKey: {
        in: linqChatLookupKeys,
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

  return { mailboxConsumedAt };
}

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

  await acquireHostedMemberHomeLinqRouteLockTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  await acquireHostedLinqParticipantContactLockTx({
    contact: input.contact,
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
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
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

  await acquireHostedMemberHomeLinqRouteLockTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  await acquireHostedLinqParticipantContactLockTx({
    contact: input.contact,
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
  participantContact?: HostedLinqParticipantIdentity | null;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}): Promise<HostedLinqParticipantIdentity | null> {
  return await writeHostedMemberLinqBindingTx({
    clearPending: input.clearPending ?? false,
    kind: "home",
    linqChatId: input.linqChatId,
    memberId: input.memberId,
    participantContact: input.participantContact
      ? {
          kind: input.participantContact.kind,
          lookupKey: input.participantContact.lookupKey,
        }
      : null,
    participantContactObservedAt: null,
    prisma: input.prisma,
    recipientPhone: input.recipientPhone,
    homeLineAssignedAt: input.homeLineAssignedAt ?? null,
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
  await acquireHostedMemberHomeLinqRouteLockTx({
    memberId: input.memberId,
    prisma: input.prisma,
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
      linqParticipantContactKind: null,
      linqParticipantContactLookupKey: null,
      ...(input.homeLineAssignedAt === undefined
        ? {}
        : { linqHomeLineAssignedAt: input.homeLineAssignedAt }),
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

export async function acquireHostedMemberHomeLinqRouteLockTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  // The durable member row is the sole per-member route owner. NO KEY UPDATE
  // still serializes route owners with each other and with activation's UPDATE
  // lock, while remaining compatible with mailbox foreign-key KEY SHARE locks
  // from Telegram and other channels.
  await input.prisma.$queryRaw`
    SELECT 1
    FROM "hosted_member"
    WHERE "id" = ${input.memberId}
    FOR NO KEY UPDATE
  `;
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

async function writeHostedMemberLinqBindingTx(input: {
  clearPending: boolean;
  homeLineAssignedAt: Date | null;
  kind: "home" | "pending";
  linqChatId: string;
  memberId: string;
  participantContact: HostedLinqParticipantContact | HostedLinqParticipantIdentity | null;
  participantContactObservedAt: Date | null;
  prisma: Prisma.TransactionClient;
  recipientPhone: string | null;
}): Promise<HostedLinqParticipantIdentity | null> {
  const linqChatLookupKey = createHostedLinqChatLookupKey(input.linqChatId);
  const linqChatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.linqChatId);

  if (!linqChatLookupKey || linqChatLookupKeys.length === 0) {
    throw new TypeError("Hosted Linq routing requires a non-empty chat id.");
  }

  const recipientPhone = normalizePhoneNumber(input.recipientPhone);
  const recipientPhoneLookupKey = createHostedPhoneLookupKey(recipientPhone);
  const reservesHomeRecipient = input.kind === "home" || input.homeLineAssignedAt !== null;
  const routingPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
    linqChatId: input.kind === "home" ? input.linqChatId : null,
    linqRecipientPhone: reservesHomeRecipient ? recipientPhone : null,
    memberId: input.memberId,
    pendingLinqChatId: input.kind === "pending" ? input.linqChatId : null,
    pendingLinqParticipantContact: input.kind === "pending" && input.participantContact && "value" in input.participantContact
      ? input.participantContact.value
      : null,
    pendingLinqRecipientPhone: input.kind === "pending" ? recipientPhone : null,
    prisma: input.prisma,
    telegramThreadId: null,
    telegramUserId: null,
  });

  await acquireHostedMemberHomeLinqRouteLockTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  const lockedHomeRoute = reservesHomeRecipient
    ? await readHostedMemberHomeLinqRouteAuthorityTx({
        memberId: input.memberId,
        tx: input.prisma,
      })
    : null;
  if (input.kind === "pending" && lockedHomeRoute?.linqChatLookupKey) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_HOME_ROUTE_CHANGED",
      httpStatus: 503,
      message: "Hosted Linq home routing changed while the inbound route was resolving.",
      retryable: true,
    });
  }

  if (
    input.kind === "pending"
    && input.participantContact
    && "value" in input.participantContact
  ) {
    const participantContactLookupKeys = readHostedLinqParticipantContactLookupKeys(
      input.participantContact,
    );
    await acquireHostedLinqParticipantContactLockTx({
      contact: input.participantContact,
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
  await assertHostedLinqChatNotOwnedByThreadRouteTx({
    linqChatId: input.linqChatId,
    tx: input.prisma,
  });
  await clearHostedMemberLinqChatConflicts({
    linqChatLookupKeys,
    memberId: input.memberId,
    tx: input.prisma,
  });
  const existingHomeParticipant = input.kind === "home"
    ? lockedHomeRoute?.participantContact ?? null
    : null;
  const participantContact = existingHomeParticipant ?? input.participantContact;
  await input.prisma.hostedMemberRouting.upsert({
    where: {
      memberId: input.memberId,
    },
    create: buildHostedMemberLinqBindingCreateData({
      kind: input.kind,
      homeLineAssignedAt: input.homeLineAssignedAt,
      linqChatLookupKey,
      memberId: input.memberId,
      participantContact,
      participantContactObservedAt: input.participantContactObservedAt,
      recipientPhoneLookupKey,
      routingPrivateColumns,
    }),
    update: buildHostedMemberLinqBindingUpdateData({
      clearPending: input.clearPending,
      kind: input.kind,
      homeLineAssignedAt: input.homeLineAssignedAt,
      linqChatLookupKey,
      participantContact,
      participantContactObservedAt: input.participantContactObservedAt,
      recipientPhoneLookupKey,
      routingPrivateColumns,
    }),
  });

  return participantContact;
}

export async function readHostedMemberHomeLinqRouteAuthorityTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<{
  linqChatLookupKey: string | null;
  participantContact: HostedLinqParticipantIdentity | null;
} | null> {
  const routing = await input.tx.hostedMemberRouting.findUnique({
    select: {
      linqChatLookupKey: true,
      linqParticipantContactKind: true,
      linqParticipantContactLookupKey: true,
    },
    where: {
      memberId: input.memberId,
    },
  });
  if (!routing) {
    return null;
  }

  const kind = routing.linqParticipantContactKind;
  const lookupKey = routing.linqParticipantContactLookupKey?.trim() ?? "";
  return {
    linqChatLookupKey: routing.linqChatLookupKey,
    participantContact:
      routing.linqChatLookupKey
      && (kind === "email" || kind === "phone")
      && lookupKey
        ? { kind, lookupKey }
        : null,
  };
}

async function assertHostedLinqChatNotOwnedByThreadRouteTx(input: {
  linqChatId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: "linq",
      threadId: input.linqChatId,
    });
  const threadRoute = await input.tx.hostedThreadRoute.findFirst({
    select: {
      containerMemberId: true,
    },
    where: {
      channel: "linq",
      threadIdentityLookupKey: {
        in: threadIdentityLookupKeys,
      },
    },
  });

  if (!threadRoute) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_LINQ_CHAT_THREAD_ROUTE_CONFLICT",
    httpStatus: 409,
    message: "Linq chat is already owned by a thread container route.",
    retryable: true,
  });
}

function buildHostedMemberLinqBindingCreateData(input: {
  homeLineAssignedAt: Date | null;
  kind: "home" | "pending";
  linqChatLookupKey: string;
  memberId: string;
  participantContact: HostedLinqParticipantContact | HostedLinqParticipantIdentity | null;
  participantContactObservedAt: Date | null;
  recipientPhoneLookupKey: string | null;
  routingPrivateColumns: Awaited<ReturnType<typeof buildHostedMemberRoutingPrivateColumns>>;
}): Prisma.HostedMemberRoutingUncheckedCreateInput {
  return {
    linqChatIdEncrypted: input.kind === "home"
      ? input.routingPrivateColumns.linqChatIdEncrypted
      : null,
    linqChatLookupKey: input.kind === "home" ? input.linqChatLookupKey : null,
    linqParticipantContactKind: input.kind === "home"
      ? input.participantContact?.kind ?? null
      : null,
    linqParticipantContactLookupKey: input.kind === "home"
      ? input.participantContact?.lookupKey ?? null
      : null,
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
  participantContact: HostedLinqParticipantContact | HostedLinqParticipantIdentity | null;
  participantContactObservedAt: Date | null;
  recipientPhoneLookupKey: string | null;
  routingPrivateColumns: Awaited<ReturnType<typeof buildHostedMemberRoutingPrivateColumns>>;
}): Prisma.HostedMemberRoutingUncheckedUpdateInput {
  if (input.kind === "home") {
    return {
      linqChatIdEncrypted: input.routingPrivateColumns.linqChatIdEncrypted,
      linqChatLookupKey: input.linqChatLookupKey,
      ...(input.participantContact
        ? {
            linqParticipantContactKind: input.participantContact.kind,
            linqParticipantContactLookupKey: input.participantContact.lookupKey,
          }
        : {}),
      ...(input.homeLineAssignedAt === null
        ? {}
        : { linqHomeLineAssignedAt: input.homeLineAssignedAt }),
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
    pendingLinqRecipientPhoneLookupKey: input.recipientPhoneLookupKey,
  };
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

  const conflictingPendingRoutes = await input.tx.hostedMemberRouting.findMany({
    select: {
      memberId: true,
    },
    where: {
      pendingLinqChatLookupKey: {
        in: [...input.linqChatLookupKeys],
      },
      NOT: {
        memberId: input.memberId,
      },
    },
  });
  const conflictingMemberIds = [...new Set(
    conflictingPendingRoutes
      .map((route) => route.memberId)
      .filter((memberId) => memberId !== input.memberId),
  )].sort();
  for (const memberId of conflictingMemberIds) {
    if (!(await tryAcquireHostedMemberHomeLinqRouteLockTx({
      memberId,
      prisma: input.tx,
    }))) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_PENDING_ROUTE_BUSY",
        httpStatus: 503,
        message: "A superseded Linq pending route is changing concurrently.",
        retryable: true,
      });
    }
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
    },
  });
}

async function tryAcquireHostedMemberHomeLinqRouteLockTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  const memberId = input.memberId.trim();
  if (!memberId) {
    throw new TypeError("Hosted Linq member routing lock requires a non-empty member id.");
  }

  const rows = await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "hosted_member"
    WHERE "id" = ${memberId}
    FOR NO KEY UPDATE SKIP LOCKED
  `;
  return rows[0]?.id === memberId;
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
  namespace: "chat";
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const lockValue = input.lockValue?.trim() ?? "";
  if (!lockValue) {
    throw new TypeError("Hosted Linq routing lock requires a non-empty value.");
  }

  await acquireHostedLinqChatOwnershipLockTx({
    chatId: lockValue,
    tx: input.tx,
  });
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
