import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  encryptHostedWebNullableString,
} from "../hosted-web/encryption";
import { createHostedStripeCheckoutSessionLookupKey } from "./contact-privacy";

export const HOSTED_MEMBER_SUBSCRIPTION_CHECKOUT_SESSION_FIELD =
  "hosted-member-subscription-checkout.stripe-session-id";

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

function isPrismaUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002"
  );
}
