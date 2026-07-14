import {
  HostedStripeEventStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
} from "../hosted-crypto/secure-box";
import {
  createHostedStripeInvoiceLookupKey,
  createHostedStripeInvoiceLookupKeyReadCandidates,
  createHostedStripeSubscriptionLookupKey,
  createHostedStripeSubscriptionLookupKeyReadCandidates,
} from "./contact-privacy";

const HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_LANE =
  "hosted-member-private-field" as const;
const HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_PURPOSE =
  "hosted-stripe-event-family-compensation";
const HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_TABLE = "hosted_stripe_event";
const HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_INVOICE_FIELD =
  "hosted-family-payment-conflict-compensation.invoice-id";
const HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_SUBSCRIPTION_FIELD =
  "hosted-family-payment-conflict-compensation.subscription-id";

const hostedFamilyPaymentConflictCompensationReceiptSelect =
  Prisma.validator<Prisma.HostedStripeEventSelect>()({
    eventId: true,
    familyPaymentConflictCompensationAcceptedAt: true,
    familyPaymentConflictCompensationEncryptionMemberId: true,
    familyPaymentConflictCompensationInvoiceIdEncrypted: true,
    familyPaymentConflictCompensationInvoiceLookupKey: true,
    familyPaymentConflictCompensationSubscriptionIdEncrypted: true,
    familyPaymentConflictCompensationSubscriptionLookupKey: true,
  });

export type HostedFamilyPaymentConflictCompensationReceipt =
  Prisma.HostedStripeEventGetPayload<{
    select: typeof hostedFamilyPaymentConflictCompensationReceiptSelect;
  }>;

export type HostedFamilyPaymentConflictCompensation = {
  effectId: string;
  invoiceId: string | null;
  subscriptionId: string;
};

type HostedFamilyPaymentConflictCompensationPrismaClient =
  | PrismaClient
  | Prisma.TransactionClient;

export async function listHostedFamilyPaymentConflictCompensationsByEncryptionMembers(input: {
  encryptionMemberIds: readonly string[];
  prisma: HostedFamilyPaymentConflictCompensationPrismaClient;
}): Promise<HostedFamilyPaymentConflictCompensation[]> {
  const encryptionMemberIds = uniqueNonEmptyStrings(input.encryptionMemberIds);
  if (encryptionMemberIds.length === 0) {
    return [];
  }
  const receipts = await input.prisma.hostedStripeEvent.findMany({
    select: hostedFamilyPaymentConflictCompensationReceiptSelect,
    where: {
      familyPaymentConflictCompensationEncryptionMemberId: {
        in: encryptionMemberIds,
      },
    },
  });
  return Promise.all(receipts.map(async (receipt) => {
    const compensation = await readHostedFamilyPaymentConflictCompensationFromReceipt({
      prisma: input.prisma,
      receipt,
    });
    if (!compensation) {
      throw new Error("Family payment-conflict compensation receipt was incomplete.");
    }
    return compensation;
  }));
}

export async function lockHostedFamilyPaymentConflictCompensationReceiptsTx(input: {
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
    WHERE family_payment_conflict_compensation_encryption_member_id IN (${Prisma.join(encryptionMemberIds)})
    ORDER BY event_id
    FOR UPDATE
  `;
}

export async function completeAndScrubHostedFamilyPaymentConflictCompensationReceiptsTx(input: {
  completedAt: Date;
  compensations: readonly HostedFamilyPaymentConflictCompensation[];
  encryptionMemberIds: readonly string[];
  subscriptionIds: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<{ count: number }> {
  const encryptionMemberIds = uniqueNonEmptyStrings(input.encryptionMemberIds);
  const candidateLookupKeys = uniqueNonEmptyStrings(
    [
      ...input.subscriptionIds,
      ...input.compensations.map((compensation) => compensation.subscriptionId),
    ].flatMap((subscriptionId) =>
      createHostedStripeSubscriptionLookupKeyReadCandidates(subscriptionId)
    ),
  );
  const owners = encryptionMemberIds.length === 0
    ? { count: 0 }
    : await input.tx.hostedStripeEvent.updateMany({
        data: {
          claimExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          familyPaymentConflictCompensationAcceptedAt: null,
          familyPaymentConflictCompensationCandidateSubscriptionLookupKey: null,
          familyPaymentConflictCompensationEncryptionMemberId: null,
          familyPaymentConflictCompensationInvoiceIdEncrypted: null,
          familyPaymentConflictCompensationInvoiceLookupKey: null,
          familyPaymentConflictCompensationSubscriptionIdEncrypted: null,
          familyPaymentConflictCompensationSubscriptionLookupKey: null,
          processedAt: input.completedAt,
          status: HostedStripeEventStatus.completed,
        },
        where: {
          familyPaymentConflictCompensationEncryptionMemberId: {
            in: encryptionMemberIds,
          },
        },
      });
  const candidates = candidateLookupKeys.length === 0
    ? { count: 0 }
    : await input.tx.hostedStripeEvent.updateMany({
        data: {
          familyPaymentConflictCompensationCandidateSubscriptionLookupKey: null,
        },
        where: {
          familyPaymentConflictCompensationCandidateSubscriptionLookupKey: {
            in: candidateLookupKeys,
          },
        },
      });
  return {
    count: owners.count + candidates.count,
  };
}

export async function acceptHostedFamilyPaymentConflictCompensationTx(input: {
  compensation: HostedFamilyPaymentConflictCompensation;
  encryptionMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedFamilyPaymentConflictCompensation> {
  const subscriptionLookupKey = createHostedStripeSubscriptionLookupKey(
    input.compensation.subscriptionId,
  );
  if (!subscriptionLookupKey || !input.encryptionMemberId.trim()) {
    throw new Error("Family payment-conflict compensation ownership was invalid.");
  }

  const existing = await findHostedFamilyPaymentConflictCompensationBySubscription({
    prisma: input.tx,
    subscriptionId: input.compensation.subscriptionId,
  });
  if (existing) {
    return promoteHostedFamilyPaymentConflictCompensationInvoice({
      accepted: existing,
      invoiceId: input.compensation.invoiceId,
      prisma: input.tx,
    });
  }

  const encrypted = await encryptHostedFamilyPaymentConflictCompensation({
    compensation: input.compensation,
    encryptionMemberId: input.encryptionMemberId,
    prisma: input.tx,
  });
  const acceptedAt = new Date();
  const accepted = await input.tx.hostedStripeEvent.updateMany({
    data: {
      familyPaymentConflictCompensationAcceptedAt: acceptedAt,
      familyPaymentConflictCompensationEncryptionMemberId: input.encryptionMemberId,
      familyPaymentConflictCompensationInvoiceIdEncrypted: encrypted.invoiceId,
      familyPaymentConflictCompensationInvoiceLookupKey: encrypted.invoiceLookupKey,
      familyPaymentConflictCompensationSubscriptionIdEncrypted: encrypted.subscriptionId,
      familyPaymentConflictCompensationSubscriptionLookupKey: subscriptionLookupKey,
    },
    where: {
      eventId: input.compensation.effectId,
      familyPaymentConflictCompensationAcceptedAt: null,
    },
  });
  if (accepted.count === 1) {
    return input.compensation;
  }

  const currentReceipt = await input.tx.hostedStripeEvent.findUnique({
    select: hostedFamilyPaymentConflictCompensationReceiptSelect,
    where: {
      eventId: input.compensation.effectId,
    },
  });
  const current = currentReceipt
    ? await readHostedFamilyPaymentConflictCompensationFromReceipt({
        prisma: input.tx,
        receipt: currentReceipt,
      })
    : null;
  if (
    !current ||
    current.subscriptionId !== input.compensation.subscriptionId
  ) {
    throw new Error("Family payment-conflict compensation ownership changed.");
  }

  return promoteHostedFamilyPaymentConflictCompensationInvoice({
    accepted: current,
    invoiceId: input.compensation.invoiceId,
    prisma: input.tx,
  });
}

export async function findHostedFamilyPaymentConflictCompensationBySubscription(input: {
  prisma: HostedFamilyPaymentConflictCompensationPrismaClient;
  subscriptionId: string;
}): Promise<HostedFamilyPaymentConflictCompensation | null> {
  const lookupCandidates = createHostedStripeSubscriptionLookupKeyReadCandidates(
    input.subscriptionId,
  );
  if (lookupCandidates.length === 0) {
    throw new Error("Family payment-conflict compensation subscription was invalid.");
  }
  const receipts = await input.prisma.hostedStripeEvent.findMany({
    select: hostedFamilyPaymentConflictCompensationReceiptSelect,
    where: {
      familyPaymentConflictCompensationAcceptedAt: {
        not: null,
      },
      familyPaymentConflictCompensationSubscriptionLookupKey: {
        in: lookupCandidates,
      },
    },
  });
  if (receipts.length === 0) {
    return null;
  }
  if (receipts.length !== 1) {
    throw new Error("Family payment-conflict compensation ownership was ambiguous.");
  }

  const compensation = await readHostedFamilyPaymentConflictCompensationFromReceipt({
    prisma: input.prisma,
    receipt: receipts[0],
  });
  if (!compensation || compensation.subscriptionId !== input.subscriptionId) {
    throw new Error("Family payment-conflict compensation subscription ownership changed.");
  }
  return compensation;
}

export async function findHostedFamilyPaymentConflictCompensationBySubscriptionLookupKey(input: {
  prisma: HostedFamilyPaymentConflictCompensationPrismaClient;
  subscriptionLookupKey: string | null;
}): Promise<HostedFamilyPaymentConflictCompensation | null> {
  if (!input.subscriptionLookupKey?.trim()) {
    return null;
  }
  const receipts = await input.prisma.hostedStripeEvent.findMany({
    select: hostedFamilyPaymentConflictCompensationReceiptSelect,
    where: {
      familyPaymentConflictCompensationAcceptedAt: {
        not: null,
      },
      familyPaymentConflictCompensationSubscriptionLookupKey:
        input.subscriptionLookupKey,
    },
  });
  if (receipts.length === 0) {
    return null;
  }
  if (receipts.length !== 1) {
    throw new Error("Family payment-conflict compensation ownership was ambiguous.");
  }

  return readHostedFamilyPaymentConflictCompensationFromReceipt({
    prisma: input.prisma,
    receipt: receipts[0],
  });
}

export async function readHostedFamilyPaymentConflictCompensationFromReceipt(input: {
  prisma: HostedFamilyPaymentConflictCompensationPrismaClient;
  receipt: HostedFamilyPaymentConflictCompensationReceipt;
}): Promise<HostedFamilyPaymentConflictCompensation | null> {
  const receipt = input.receipt;
  const values = [
    receipt.familyPaymentConflictCompensationAcceptedAt,
    receipt.familyPaymentConflictCompensationEncryptionMemberId,
    receipt.familyPaymentConflictCompensationInvoiceIdEncrypted,
    receipt.familyPaymentConflictCompensationInvoiceLookupKey,
    receipt.familyPaymentConflictCompensationSubscriptionIdEncrypted,
    receipt.familyPaymentConflictCompensationSubscriptionLookupKey,
  ];
  if (values.every((value) => value === null)) {
    return null;
  }
  const invoiceFieldsAreComplete =
    (receipt.familyPaymentConflictCompensationInvoiceIdEncrypted === null) ===
    (receipt.familyPaymentConflictCompensationInvoiceLookupKey === null);
  if (
    !receipt.familyPaymentConflictCompensationAcceptedAt ||
    !receipt.familyPaymentConflictCompensationEncryptionMemberId ||
    !receipt.familyPaymentConflictCompensationSubscriptionIdEncrypted ||
    !receipt.familyPaymentConflictCompensationSubscriptionLookupKey ||
    !invoiceFieldsAreComplete
  ) {
    throw new Error("Family payment-conflict compensation receipt was incomplete.");
  }

  const encryptionMemberId =
    receipt.familyPaymentConflictCompensationEncryptionMemberId;
  const [invoiceId, subscriptionId] = await Promise.all([
    decryptHostedFamilyPaymentConflictCompensationValue({
      encryptionMemberId,
      eventId: receipt.eventId,
      field: HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_INVOICE_FIELD,
      prisma: input.prisma,
      value: receipt.familyPaymentConflictCompensationInvoiceIdEncrypted,
    }),
    decryptHostedFamilyPaymentConflictCompensationValue({
      encryptionMemberId,
      eventId: receipt.eventId,
      field: HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_SUBSCRIPTION_FIELD,
      prisma: input.prisma,
      value: receipt.familyPaymentConflictCompensationSubscriptionIdEncrypted,
    }),
  ]);
  if (
    !subscriptionId ||
    !createHostedStripeSubscriptionLookupKeyReadCandidates(subscriptionId).includes(
      receipt.familyPaymentConflictCompensationSubscriptionLookupKey,
    ) ||
    (invoiceId
      ? !createHostedStripeInvoiceLookupKeyReadCandidates(invoiceId).includes(
          receipt.familyPaymentConflictCompensationInvoiceLookupKey ?? "",
        )
      : receipt.familyPaymentConflictCompensationInvoiceLookupKey !== null)
  ) {
    throw new Error("Family payment-conflict compensation receipt identity did not match.");
  }

  return {
    effectId: receipt.eventId,
    invoiceId,
    subscriptionId,
  };
}

export async function promoteHostedFamilyPaymentConflictCompensationInvoice(input: {
  accepted: HostedFamilyPaymentConflictCompensation;
  invoiceId: string | null;
  prisma: HostedFamilyPaymentConflictCompensationPrismaClient;
}): Promise<HostedFamilyPaymentConflictCompensation> {
  if (!input.invoiceId || input.accepted.invoiceId === input.invoiceId) {
    return input.accepted;
  }
  if (input.accepted.invoiceId) {
    throw new Error("Family payment-conflict compensation invoice ownership changed.");
  }

  const receipt = await input.prisma.hostedStripeEvent.findUnique({
    select: hostedFamilyPaymentConflictCompensationReceiptSelect,
    where: {
      eventId: input.accepted.effectId,
    },
  });
  if (
    !receipt?.familyPaymentConflictCompensationAcceptedAt ||
    !receipt.familyPaymentConflictCompensationEncryptionMemberId
  ) {
    throw new Error("Family payment-conflict compensation owner was unavailable.");
  }
  const invoiceLookupKey = createHostedStripeInvoiceLookupKey(input.invoiceId);
  const invoiceIdEncrypted = await encryptHostedFamilyPaymentConflictCompensationValue({
    encryptionMemberId: receipt.familyPaymentConflictCompensationEncryptionMemberId,
    eventId: receipt.eventId,
    field: HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_INVOICE_FIELD,
    prisma: input.prisma,
    value: input.invoiceId,
  });
  if (!invoiceLookupKey || !invoiceIdEncrypted) {
    throw new Error("Family payment-conflict compensation invoice was invalid.");
  }

  const promoted = await input.prisma.hostedStripeEvent.updateMany({
    data: {
      familyPaymentConflictCompensationInvoiceIdEncrypted: invoiceIdEncrypted,
      familyPaymentConflictCompensationInvoiceLookupKey: invoiceLookupKey,
    },
    where: {
      eventId: receipt.eventId,
      familyPaymentConflictCompensationAcceptedAt:
        receipt.familyPaymentConflictCompensationAcceptedAt,
      familyPaymentConflictCompensationInvoiceIdEncrypted: null,
      familyPaymentConflictCompensationInvoiceLookupKey: null,
    },
  });
  if (promoted.count !== 1) {
    throw new Error("Family payment-conflict compensation invoice ownership changed.");
  }

  return {
    ...input.accepted,
    invoiceId: input.invoiceId,
  };
}

async function encryptHostedFamilyPaymentConflictCompensation(input: {
  compensation: HostedFamilyPaymentConflictCompensation;
  encryptionMemberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<{
  invoiceId: string | null;
  invoiceLookupKey: string | null;
  subscriptionId: string;
}> {
  const [invoiceId, subscriptionId] = await Promise.all([
    encryptHostedFamilyPaymentConflictCompensationValue({
      encryptionMemberId: input.encryptionMemberId,
      eventId: input.compensation.effectId,
      field: HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_INVOICE_FIELD,
      prisma: input.prisma,
      value: input.compensation.invoiceId,
    }),
    encryptHostedFamilyPaymentConflictCompensationValue({
      encryptionMemberId: input.encryptionMemberId,
      eventId: input.compensation.effectId,
      field: HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_SUBSCRIPTION_FIELD,
      prisma: input.prisma,
      value: input.compensation.subscriptionId,
    }),
  ]);
  const invoiceLookupKey = createHostedStripeInvoiceLookupKey(
    input.compensation.invoiceId,
  );
  if (!subscriptionId || Boolean(invoiceId) !== Boolean(invoiceLookupKey)) {
    throw new Error("Family payment-conflict compensation identifiers were invalid.");
  }
  return {
    invoiceId,
    invoiceLookupKey,
    subscriptionId,
  };
}

function encryptHostedFamilyPaymentConflictCompensationValue(input: {
  encryptionMemberId: string;
  eventId: string;
  field: string;
  prisma: HostedFamilyPaymentConflictCompensationPrismaClient;
  value: string | null;
}): Promise<string | null> {
  return sealHostedUserSecureBoxString({
    aad: {
      field: input.field,
      purpose: HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_PURPOSE,
      rowId: input.eventId,
      table: HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_TABLE,
    },
    lane: HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_LANE,
    prisma: input.prisma,
    scope: `${HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_PURPOSE}:${input.field}`,
    userId: input.encryptionMemberId,
    value: input.value,
  });
}

function decryptHostedFamilyPaymentConflictCompensationValue(input: {
  encryptionMemberId: string;
  eventId: string;
  field: string;
  prisma: HostedFamilyPaymentConflictCompensationPrismaClient;
  value: string | null;
}): Promise<string | null> {
  return openHostedUserSecureBoxString({
    aad: {
      field: input.field,
      purpose: HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_PURPOSE,
      rowId: input.eventId,
      table: HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_TABLE,
    },
    lane: HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_LANE,
    prisma: input.prisma,
    scope: `${HOSTED_FAMILY_PAYMENT_CONFLICT_COMPENSATION_PURPOSE}:${input.field}`,
    userId: input.encryptionMemberId,
    value: input.value,
  });
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
