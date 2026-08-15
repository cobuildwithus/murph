import type { Prisma, PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  assertNoHostedFamilyStripeEffectTx,
  readHostedAccountGroupStripeBillingRef,
  readHostedFamilyOwnerSnapshotForMember,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  assertNoHostedDirectSubscriptionStripeEffectTx,
  readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { requireHostedStripeApi } from "@/src/lib/hosted-onboarding/runtime";
import { normalizeNullableString } from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readOptionalJsonObject(request, { limitBytes: 1_024 });
  const billingScope = body.billingScope === "family" ? "family" : "member";
  const owner = await readBillingPortalOwner({
    billingScope,
    memberId: auth.member.id,
    prisma,
  });

  if (!owner.stripeCustomerId) {
    throw hostedOnboardingError({
      code: "STRIPE_CUSTOMER_NOT_READY",
      message:
        billingScope === "family"
          ? "Your Family subscription is not ready for management yet."
          : "Your subscription is not ready for management yet.",
      httpStatus: 409,
    });
  }

  const stripe = requireHostedStripeApi();
  const familyPortalConfigurationId = normalizeNullableString(
    process.env.HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID,
  );
  const sessionParams: Stripe.BillingPortal.SessionCreateParams = {
    customer: owner.stripeCustomerId,
    return_url: new URL("/settings", request.url).toString(),
  };
  if (billingScope === "family" && familyPortalConfigurationId) {
    sessionParams.configuration = familyPortalConfigurationId;
  }
  const session = await stripe.billingPortal.sessions.create(sessionParams);

  if (!session.url) {
    throw hostedOnboardingError({
      code: "STRIPE_PORTAL_SESSION_MISSING_URL",
      message: "Stripe did not return a billing portal URL.",
      httpStatus: 502,
    });
  }

  await assertBillingPortalOwnerStillCurrent({
    expected: owner,
    memberId: auth.member.id,
    prisma,
  });

  return jsonOk({
    url: session.url,
  });
});

type BillingPortalOwner = {
  billingScope: "family" | "member";
  groupId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

async function readBillingPortalOwner(input: {
  billingScope: "family" | "member";
  memberId: string;
  prisma: PrismaClient;
}): Promise<BillingPortalOwner> {
  return withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: (tx) =>
      input.billingScope === "family"
        ? readFamilyBillingPortalOwner({
            memberId: input.memberId,
            tx,
          })
        : readMemberBillingPortalOwner({
            memberId: input.memberId,
            tx,
          }),
  });
}

async function readMemberBillingPortalOwner(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<BillingPortalOwner> {
  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma: input.tx,
  });
  await assertNoHostedDirectSubscriptionStripeEffectTx({
    memberId: input.memberId,
    stripeSubscriptionId: billingRef?.stripeSubscriptionId,
    tx: input.tx,
  });
  return {
    billingScope: "member",
    groupId: null,
    stripeCustomerId: billingRef?.stripeCustomerId ?? null,
    stripeSubscriptionId: billingRef?.stripeSubscriptionId ?? null,
  };
}

async function readFamilyBillingPortalOwner(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<BillingPortalOwner> {
  const familyOwner = await readHostedFamilyOwnerSnapshotForMember({
    memberId: input.memberId,
    prisma: input.tx,
  });

  if (!familyOwner) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_OWNER_NOT_FOUND",
      httpStatus: 403,
      message: "Only the Family plan owner can manage Family billing.",
    });
  }

  const billingRef = await readHostedAccountGroupStripeBillingRef({
    groupId: familyOwner.groupId,
    prisma: input.tx,
  });
  await assertNoHostedFamilyStripeEffectTx({
    groupId: familyOwner.groupId,
    tx: input.tx,
  });

  return {
    billingScope: "family",
    groupId: familyOwner.groupId,
    stripeCustomerId: billingRef?.stripeCustomerId ?? null,
    stripeSubscriptionId: billingRef?.stripeSubscriptionId ?? null,
  };
}

async function assertBillingPortalOwnerStillCurrent(input: {
  expected: BillingPortalOwner;
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  const current = await readBillingPortalOwner({
    billingScope: input.expected.billingScope,
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (
    current.groupId !== input.expected.groupId
    || current.stripeCustomerId !== input.expected.stripeCustomerId
    || current.stripeSubscriptionId !== input.expected.stripeSubscriptionId
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PORTAL_OWNER_CHANGED",
      httpStatus: 409,
      message: "Billing changed before the management link was ready. Refresh and try again.",
      retryable: true,
    });
  }
}
