import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "../hosted-web/encryption";
import { createHostedStripeCheckoutSessionLookupKey } from "./contact-privacy";

export const HOSTED_MEMBER_SUBSCRIPTION_CHECKOUT_SESSION_FIELD =
  "hosted-member-subscription-checkout.stripe-session-id";

type HostedSubscriptionCheckoutPrisma =
  | Prisma.TransactionClient
  | PrismaClient;

export interface PreparedHostedMemberSubscriptionCheckout {
  encryptedSessionId: string;
  lookupKey: string;
}

export async function prepareHostedMemberSubscriptionCheckout(input: {
  memberId: string;
  prisma: PrismaClient;
  stripeCheckoutSessionId: string;
}): Promise<PreparedHostedMemberSubscriptionCheckout> {
  const lookupKey = createHostedStripeCheckoutSessionLookupKey(
    input.stripeCheckoutSessionId,
  );
  if (!lookupKey) {
    throw new TypeError("Stripe Checkout session id is required.");
  }
  const encryptedSessionId = await encryptHostedWebNullableString({
    field: HOSTED_MEMBER_SUBSCRIPTION_CHECKOUT_SESSION_FIELD,
    memberId: input.memberId,
    prisma: input.prisma,
    value: input.stripeCheckoutSessionId,
  });
  if (!encryptedSessionId) {
    throw new TypeError("Stripe Checkout session id encryption failed.");
  }
  return {
    encryptedSessionId,
    lookupKey,
  };
}

export async function bindHostedMemberSubscriptionCheckoutUnderLockTx(input: {
  memberId: string;
  preparedCheckout: PreparedHostedMemberSubscriptionCheckout;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  try {
    await input.tx.hostedMemberSubscriptionCheckout.create({
      data: {
        memberId: input.memberId,
        stripeCheckoutSessionIdEncrypted:
          input.preparedCheckout.encryptedSessionId,
        stripeCheckoutSessionLookupKey: input.preparedCheckout.lookupKey,
      },
    });
    return;
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }
  }

  const existing = await input.tx.hostedMemberSubscriptionCheckout.findUnique({
    select: { memberId: true },
    where: {
      stripeCheckoutSessionLookupKey: input.preparedCheckout.lookupKey,
    },
  });
  if (existing?.memberId !== input.memberId) {
    throw new TypeError("Stripe Checkout session already has a different owner.");
  }
}

export async function listHostedMemberSubscriptionCheckoutSessionIds(input: {
  memberId: string;
  prisma: HostedSubscriptionCheckoutPrisma;
}): Promise<string[]> {
  const rows = await input.prisma.hostedMemberSubscriptionCheckout.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      memberId: true,
      stripeCheckoutSessionIdEncrypted: true,
    },
    where: { memberId: input.memberId },
  });

  return Promise.all(rows.map(async (row) => {
    const sessionId = await decryptHostedWebNullableString({
      field: HOSTED_MEMBER_SUBSCRIPTION_CHECKOUT_SESSION_FIELD,
      memberId: row.memberId,
      prisma: input.prisma,
      value: row.stripeCheckoutSessionIdEncrypted,
    });
    if (!sessionId) {
      throw new TypeError("Stored Stripe Checkout session id is unavailable.");
    }
    return sessionId;
  }));
}

function isPrismaUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002"
  );
}
