import {
  HostedStripeEventStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
} from "../hosted-crypto/secure-box";

const PULSE_TRIAL_CLEANUP_FIELD = "hosted-pulse-trial-cleanup.subscription-id";
const PULSE_TRIAL_CLEANUP_PURPOSE = "hosted-stripe-event-pulse-trial-cleanup";

const pulseTrialCleanupReceiptSelect =
  Prisma.validator<Prisma.HostedStripeEventSelect>()({
    eventId: true,
    pulseTrialCleanupAcceptedAt: true,
    pulseTrialCleanupEncryptionMemberId: true,
    pulseTrialCleanupSubscriptionIdEncrypted: true,
  });

type PulseTrialCleanupReceipt = Prisma.HostedStripeEventGetPayload<{
  select: typeof pulseTrialCleanupReceiptSelect;
}>;

type PulseTrialCleanupPrisma = PrismaClient | Prisma.TransactionClient;

export type HostedPulseTrialCleanup = {
  effectId: string;
  memberId: string;
  subscriptionId: string;
};

export async function acceptHostedPulseTrialCleanupTx(input: {
  cleanup: HostedPulseTrialCleanup;
  tx: Prisma.TransactionClient;
}): Promise<HostedPulseTrialCleanup> {
  if (
    !input.cleanup.effectId.trim() ||
    !input.cleanup.memberId.trim() ||
    !input.cleanup.subscriptionId.trim()
  ) {
    throw new Error("Pulse Trial cleanup ownership was invalid.");
  }
  const currentReceipt = await input.tx.hostedStripeEvent.findUnique({
    select: pulseTrialCleanupReceiptSelect,
    where: { eventId: input.cleanup.effectId },
  });
  const current = currentReceipt
    ? await readHostedPulseTrialCleanupFromReceipt({
        prisma: input.tx,
        receipt: currentReceipt,
      })
    : null;
  if (current) {
    assertSameHostedPulseTrialCleanup(current, input.cleanup);
    return current;
  }

  const subscriptionIdEncrypted = await sealHostedUserSecureBoxString({
    aad: {
      field: PULSE_TRIAL_CLEANUP_FIELD,
      purpose: PULSE_TRIAL_CLEANUP_PURPOSE,
      rowId: input.cleanup.effectId,
      table: "hosted_stripe_event",
    },
    lane: "hosted-member-private-field",
    prisma: input.tx,
    scope: `${PULSE_TRIAL_CLEANUP_PURPOSE}:${PULSE_TRIAL_CLEANUP_FIELD}`,
    userId: input.cleanup.memberId,
    value: input.cleanup.subscriptionId,
  });
  if (!subscriptionIdEncrypted) {
    throw new Error("Pulse Trial cleanup subscription was invalid.");
  }
  const accepted = await input.tx.hostedStripeEvent.updateMany({
    data: {
      pulseTrialCleanupAcceptedAt: new Date(),
      pulseTrialCleanupEncryptionMemberId: input.cleanup.memberId,
      pulseTrialCleanupSubscriptionIdEncrypted: subscriptionIdEncrypted,
    },
    where: {
      eventId: input.cleanup.effectId,
      pulseTrialCleanupAcceptedAt: null,
    },
  });
  if (accepted.count === 1) {
    return input.cleanup;
  }

  const racedReceipt = await input.tx.hostedStripeEvent.findUnique({
    select: pulseTrialCleanupReceiptSelect,
    where: { eventId: input.cleanup.effectId },
  });
  const raced = racedReceipt
    ? await readHostedPulseTrialCleanupFromReceipt({
        prisma: input.tx,
        receipt: racedReceipt,
      })
    : null;
  if (!raced) {
    throw new Error("Pulse Trial cleanup ownership changed.");
  }
  assertSameHostedPulseTrialCleanup(raced, input.cleanup);
  return raced;
}

export async function readHostedPulseTrialCleanupFromReceipt(input: {
  prisma: PulseTrialCleanupPrisma;
  receipt: PulseTrialCleanupReceipt;
}): Promise<HostedPulseTrialCleanup | null> {
  const values = [
    input.receipt.pulseTrialCleanupAcceptedAt,
    input.receipt.pulseTrialCleanupEncryptionMemberId,
    input.receipt.pulseTrialCleanupSubscriptionIdEncrypted,
  ];
  if (values.every((value) => value === null)) {
    return null;
  }
  if (
    !input.receipt.pulseTrialCleanupAcceptedAt ||
    !input.receipt.pulseTrialCleanupEncryptionMemberId ||
    !input.receipt.pulseTrialCleanupSubscriptionIdEncrypted
  ) {
    throw new Error("Pulse Trial cleanup receipt was incomplete.");
  }
  const subscriptionId = await openHostedUserSecureBoxString({
    aad: {
      field: PULSE_TRIAL_CLEANUP_FIELD,
      purpose: PULSE_TRIAL_CLEANUP_PURPOSE,
      rowId: input.receipt.eventId,
      table: "hosted_stripe_event",
    },
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: `${PULSE_TRIAL_CLEANUP_PURPOSE}:${PULSE_TRIAL_CLEANUP_FIELD}`,
    userId: input.receipt.pulseTrialCleanupEncryptionMemberId,
    value: input.receipt.pulseTrialCleanupSubscriptionIdEncrypted,
  });
  if (!subscriptionId?.trim()) {
    throw new Error("Pulse Trial cleanup receipt was invalid.");
  }
  return {
    effectId: input.receipt.eventId,
    memberId: input.receipt.pulseTrialCleanupEncryptionMemberId,
    subscriptionId,
  };
}

export async function listHostedPulseTrialCleanupsByEncryptionMembers(input: {
  encryptionMemberIds: readonly string[];
  prisma: PulseTrialCleanupPrisma;
}): Promise<HostedPulseTrialCleanup[]> {
  const encryptionMemberIds = uniqueNonEmptyStrings(input.encryptionMemberIds);
  if (encryptionMemberIds.length === 0) {
    return [];
  }
  const receipts = await input.prisma.hostedStripeEvent.findMany({
    select: pulseTrialCleanupReceiptSelect,
    where: {
      pulseTrialCleanupEncryptionMemberId: { in: encryptionMemberIds },
    },
  });
  return Promise.all(receipts.map(async (receipt) => {
    const cleanup = await readHostedPulseTrialCleanupFromReceipt({
      prisma: input.prisma,
      receipt,
    });
    if (!cleanup) {
      throw new Error("Pulse Trial cleanup receipt was unavailable.");
    }
    return cleanup;
  }));
}

export async function lockHostedPulseTrialCleanupReceiptsTx(input: {
  encryptionMemberIds: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const encryptionMemberIds = uniqueNonEmptyStrings(input.encryptionMemberIds);
  if (encryptionMemberIds.length === 0) {
    return;
  }
  await input.tx.$queryRaw`
    SELECT event_id
    FROM hosted_stripe_event
    WHERE pulse_trial_cleanup_encryption_member_id IN (${Prisma.join(encryptionMemberIds)})
    ORDER BY event_id
    FOR UPDATE
  `;
}

export function completeAndScrubHostedPulseTrialCleanupReceiptsTx(input: {
  completedAt: Date;
  encryptionMemberIds: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<{ count: number }> {
  const encryptionMemberIds = uniqueNonEmptyStrings(input.encryptionMemberIds);
  if (encryptionMemberIds.length === 0) {
    return Promise.resolve({ count: 0 });
  }
  return input.tx.hostedStripeEvent.updateMany({
    data: {
      claimExpiresAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextAttemptAt: input.completedAt,
      processedAt: input.completedAt,
      pulseTrialCleanupAcceptedAt: null,
      pulseTrialCleanupEncryptionMemberId: null,
      pulseTrialCleanupSubscriptionIdEncrypted: null,
      status: HostedStripeEventStatus.completed,
    },
    where: {
      pulseTrialCleanupEncryptionMemberId: { in: encryptionMemberIds },
    },
  });
}

function assertSameHostedPulseTrialCleanup(
  current: HostedPulseTrialCleanup,
  expected: HostedPulseTrialCleanup,
): void {
  if (
    current.effectId !== expected.effectId ||
    current.memberId !== expected.memberId ||
    current.subscriptionId !== expected.subscriptionId
  ) {
    throw new Error("Pulse Trial cleanup ownership changed.");
  }
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
