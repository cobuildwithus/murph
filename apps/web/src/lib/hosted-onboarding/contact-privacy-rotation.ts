import {
  ExecutionOutboxStatus,
  type PrismaClient,
} from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
  createHostedPrivyUserLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,
  createHostedTelegramUserLookupKey,
  createHostedWalletAddressLookupKey,
  parseHostedBlindIndex,
  readHostedContactPrivacyCurrentVersion,
} from "./contact-privacy";
import {
  buildHostedMemberIdentityPrivateColumns,
  buildHostedMemberRoutingPrivateColumns,
  readHostedMemberBillingPrivateState,
  readHostedMemberIdentityPrivateState,
  readHostedMemberRoutingPrivateState,
} from "./member-private-codecs";

type HostedContactPrivacyRotationClient = PrismaClient;

const LOOKUP_IDENTITY_OUTBOX_EVENT_KINDS = [
  "linq.message.received",
  "member.activated",
] as const;

export interface HostedContactPrivacyRotationBlocker {
  currentVersion: string;
  field:
    | "linqChatLookupKey"
    | "phoneLookupKey"
    | "privyUserLookupKey"
    | "stripeCustomerLookupKey"
    | "stripeSubscriptionLookupKey"
    | "telegramUserLookupKey"
    | "walletAddressLookupKey";
  memberId: string;
  owner: "billingRef" | "identity" | "routing";
  reason: "missing_raw_value";
  storedVersion: string | null;
}

export interface HostedContactPrivacyRotationResult {
  blockers: HostedContactPrivacyRotationBlocker[];
  currentVersion: string;
  dryRun: boolean;
  outboxBlockingEventCount: number;
  scanned: {
    billingRefs: number;
    identities: number;
    routings: number;
  };
  updated: {
    billingRefs: number;
    identities: number;
    routings: number;
  };
}

interface HostedContactPrivacyRowUpdate {
  data: Record<string, unknown>;
  memberId: string;
}

export async function backfillHostedContactPrivacyRotation(input: {
  dryRun: boolean;
  memberIds?: readonly string[] | null;
  prisma: HostedContactPrivacyRotationClient;
}): Promise<HostedContactPrivacyRotationResult> {
  const memberWhere = buildHostedMemberIdWhere(input.memberIds);
  const currentVersion = readHostedContactPrivacyCurrentVersion();
  const [identities, routings, billingRefs, outboxBlockingEventCount] = await Promise.all([
    input.prisma.hostedMemberIdentity.findMany({
      where: memberWhere,
      select: {
        memberId: true,
        phoneLookupKey: true,
        phoneNumberEncrypted: true,
        privyUserIdEncrypted: true,
        privyUserLookupKey: true,
        signupPhoneCodeSendAttemptId: true,
        signupPhoneCodeSendAttemptStartedAt: true,
        signupPhoneCodeSentAt: true,
        signupPhoneNumberEncrypted: true,
        walletAddressEncrypted: true,
        walletAddressLookupKey: true,
      },
    }),
    input.prisma.hostedMemberRouting.findMany({
      where: memberWhere,
      select: {
        linqChatIdEncrypted: true,
        linqChatLookupKey: true,
        memberId: true,
        telegramUserIdEncrypted: true,
        telegramUserLookupKey: true,
      },
    }),
    input.prisma.hostedMemberBillingRef.findMany({
      where: memberWhere,
      select: {
        memberId: true,
        stripeCustomerIdEncrypted: true,
        stripeCustomerLookupKey: true,
        stripeSubscriptionIdEncrypted: true,
        stripeSubscriptionLookupKey: true,
      },
    }),
    input.prisma.executionOutbox.count({
      where: {
        eventKind: {
          in: [...LOOKUP_IDENTITY_OUTBOX_EVENT_KINDS],
        },
        status: {
          in: [
            ExecutionOutboxStatus.delivery_failed,
            ExecutionOutboxStatus.dispatching,
            ExecutionOutboxStatus.queued,
          ],
        },
        ...(memberWhere
          ? {
              userId: memberWhere.memberId?.in
                ? {
                    in: memberWhere.memberId.in,
                  }
                : undefined,
            }
          : {}),
      },
    }),
  ]);

  const blockers: HostedContactPrivacyRotationBlocker[] = [];
  const identityUpdates: HostedContactPrivacyRowUpdate[] = [];
  const routingUpdates: HostedContactPrivacyRowUpdate[] = [];
  const billingRefUpdates: HostedContactPrivacyRowUpdate[] = [];
  let updatedIdentities = 0;
  let updatedRoutings = 0;
  let updatedBillingRefs = 0;

  for (const identity of identities) {
    const privateState = readHostedMemberIdentityPrivateState(identity);
    const phoneNumber = privateState.phoneNumber ?? privateState.signupPhoneNumber;
    const nextPhoneLookupKey = createHostedPhoneLookupKey(phoneNumber);
    const nextPrivyUserLookupKey = createHostedPrivyUserLookupKey(privateState.privyUserId);
    const nextWalletAddressLookupKey = createHostedWalletAddressLookupKey(privateState.walletAddress);
    const data: Record<string, unknown> = {};

    if (!identity.phoneNumberEncrypted && phoneNumber) {
      data.phoneNumberEncrypted = buildHostedMemberIdentityPrivateColumns({
        memberId: identity.memberId,
        phoneNumber,
        privyUserId: null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: null,
        walletAddress: null,
      }).phoneNumberEncrypted;
    }

    assignLookupRotationUpdate({
      blockers,
      currentVersion,
      data,
      expectedLookupKey: nextPhoneLookupKey,
      field: "phoneLookupKey",
      memberId: identity.memberId,
      owner: "identity",
      storedLookupKey: identity.phoneLookupKey,
    });
    assignLookupRotationUpdate({
      blockers,
      currentVersion,
      data,
      expectedLookupKey: nextPrivyUserLookupKey,
      field: "privyUserLookupKey",
      memberId: identity.memberId,
      owner: "identity",
      storedLookupKey: identity.privyUserLookupKey,
    });
    assignLookupRotationUpdate({
      blockers,
      currentVersion,
      data,
      expectedLookupKey: nextWalletAddressLookupKey,
      field: "walletAddressLookupKey",
      memberId: identity.memberId,
      owner: "identity",
      storedLookupKey: identity.walletAddressLookupKey,
    });

    if (Object.keys(data).length > 0) {
      identityUpdates.push({
        data,
        memberId: identity.memberId,
      });
      updatedIdentities += 1;
    }
  }

  for (const routing of routings) {
    const privateState = readHostedMemberRoutingPrivateState(routing);
    const nextLinqChatLookupKey = createHostedLinqChatLookupKey(privateState.linqChatId);
    const nextTelegramUserLookupKey = createHostedTelegramUserLookupKey(privateState.telegramUserId);
    const data: Record<string, unknown> = {};

    assignLookupRotationUpdate({
      blockers,
      currentVersion,
      data,
      expectedLookupKey: nextLinqChatLookupKey,
      field: "linqChatLookupKey",
      memberId: routing.memberId,
      owner: "routing",
      storedLookupKey: routing.linqChatLookupKey,
    });

    if (!routing.telegramUserIdEncrypted && privateState.telegramUserId) {
      data.telegramUserIdEncrypted = buildHostedMemberRoutingPrivateColumns({
        linqChatId: null,
        memberId: routing.memberId,
        telegramUserId: privateState.telegramUserId,
      }).telegramUserIdEncrypted;
    }

    assignLookupRotationUpdate({
      blockers,
      currentVersion,
      data,
      expectedLookupKey: nextTelegramUserLookupKey,
      field: "telegramUserLookupKey",
      memberId: routing.memberId,
      owner: "routing",
      storedLookupKey: routing.telegramUserLookupKey,
    });

    if (Object.keys(data).length > 0) {
      routingUpdates.push({
        data,
        memberId: routing.memberId,
      });
      updatedRoutings += 1;
    }
  }

  for (const billingRef of billingRefs) {
    const privateState = readHostedMemberBillingPrivateState(billingRef);
    const nextStripeCustomerLookupKey = createHostedStripeCustomerLookupKey(
      privateState.stripeCustomerId,
    );
    const nextStripeSubscriptionLookupKey = createHostedStripeSubscriptionLookupKey(
      privateState.stripeSubscriptionId,
    );
    const data: Record<string, unknown> = {};

    assignLookupRotationUpdate({
      blockers,
      currentVersion,
      data,
      expectedLookupKey: nextStripeCustomerLookupKey,
      field: "stripeCustomerLookupKey",
      memberId: billingRef.memberId,
      owner: "billingRef",
      storedLookupKey: billingRef.stripeCustomerLookupKey,
    });
    assignLookupRotationUpdate({
      blockers,
      currentVersion,
      data,
      expectedLookupKey: nextStripeSubscriptionLookupKey,
      field: "stripeSubscriptionLookupKey",
      memberId: billingRef.memberId,
      owner: "billingRef",
      storedLookupKey: billingRef.stripeSubscriptionLookupKey,
    });

    if (Object.keys(data).length > 0) {
      billingRefUpdates.push({
        data,
        memberId: billingRef.memberId,
      });
      updatedBillingRefs += 1;
    }
  }

  const canApplyWrite =
    input.dryRun || (outboxBlockingEventCount === 0 && blockers.length === 0);

  if (!input.dryRun && canApplyWrite) {
    for (const update of identityUpdates) {
      await input.prisma.hostedMemberIdentity.update({
        where: {
          memberId: update.memberId,
        },
        data: update.data,
      });
    }

    for (const update of routingUpdates) {
      await input.prisma.hostedMemberRouting.update({
        where: {
          memberId: update.memberId,
        },
        data: update.data,
      });
    }

    for (const update of billingRefUpdates) {
      await input.prisma.hostedMemberBillingRef.update({
        where: {
          memberId: update.memberId,
        },
        data: update.data,
      });
    }
  }

  return {
    blockers,
    currentVersion,
    dryRun: input.dryRun,
    outboxBlockingEventCount,
    scanned: {
      billingRefs: billingRefs.length,
      identities: identities.length,
      routings: routings.length,
    },
    updated: {
      billingRefs: updatedBillingRefs,
      identities: updatedIdentities,
      routings: updatedRoutings,
    },
  };
}

function assignLookupRotationUpdate(input: {
  blockers: HostedContactPrivacyRotationBlocker[];
  currentVersion: string;
  data: Record<string, unknown>;
  expectedLookupKey: string | null;
  field: HostedContactPrivacyRotationBlocker["field"];
  memberId: string;
  owner: HostedContactPrivacyRotationBlocker["owner"];
  storedLookupKey: string | null;
}): void {
  if (!input.storedLookupKey) {
    if (input.expectedLookupKey) {
      input.data[input.field] = input.expectedLookupKey;
    }
    return;
  }

  if (input.expectedLookupKey) {
    if (input.expectedLookupKey !== input.storedLookupKey) {
      input.data[input.field] = input.expectedLookupKey;
    }
    return;
  }

  const parsedLookupKey = parseHostedBlindIndex(input.storedLookupKey);
  if (!parsedLookupKey || parsedLookupKey.version === input.currentVersion) {
    return;
  }

  input.blockers.push({
    currentVersion: input.currentVersion,
    field: input.field,
    memberId: input.memberId,
    owner: input.owner,
    reason: "missing_raw_value",
    storedVersion: parsedLookupKey.version,
  });
}

function buildHostedMemberIdWhere(memberIds: readonly string[] | null | undefined):
  | {
      memberId: {
        in: string[];
      };
    }
  | undefined {
  if (!memberIds || memberIds.length === 0) {
    return undefined;
  }

  return {
    memberId: {
      in: [...new Set(memberIds)],
    },
  };
}
