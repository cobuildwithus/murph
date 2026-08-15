import type { Prisma, PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CUSTOMER_FIELD,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  assertNoHostedDirectSubscriptionStripeEffectByLookupKeyTx,
  assertHostedStripeEffectClaimAbsent,
  withHostedMemberStripeMutationLock,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import {
  HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { requireHostedStripeApi } from "@/src/lib/hosted-onboarding/runtime";
import { normalizeNullableString } from "@/src/lib/hosted-onboarding/shared";
import { decryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
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
    expected: owner.authority,
    memberId: auth.member.id,
    prisma,
  });

  return jsonOk({
    url: session.url,
  });
});

type MemberBillingPortalAuthority = {
  billingScope: "member";
  groupId: null;
  stripeCustomerIdEncrypted: string | null;
  stripeCustomerLookupKey: string | null;
  stripeSubscriptionLookupKey: string | null;
};

type FamilyBillingPortalAuthority = {
  billingScope: "family";
  groupId: string;
  ownerMemberId: string;
  stripeCustomerIdEncrypted: string | null;
  stripeCustomerLookupKey: string | null;
  stripeSubscriptionIdEncrypted: string | null;
  stripeSubscriptionLookupKey: string | null;
};

type BillingPortalAuthority =
  | FamilyBillingPortalAuthority
  | MemberBillingPortalAuthority;

type BillingPortalOwner = {
  authority: BillingPortalAuthority;
  stripeCustomerId: string | null;
};

async function readBillingPortalOwner(input: {
  billingScope: "family" | "member";
  memberId: string;
  prisma: PrismaClient;
}): Promise<BillingPortalOwner> {
  const authority = await readBillingPortalAuthority(input);
  if (authority.billingScope === "member") {
    return {
      authority,
      stripeCustomerId: await decryptHostedWebNullableString({
        field: HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
        memberId: input.memberId,
        prisma: input.prisma,
        value: authority.stripeCustomerIdEncrypted,
      }),
    };
  }
  return {
    authority,
    stripeCustomerId: await decryptHostedWebNullableString({
      field: HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CUSTOMER_FIELD,
      memberId: authority.ownerMemberId,
      prisma: input.prisma,
      value: authority.stripeCustomerIdEncrypted,
    }),
  };
}

async function readBillingPortalAuthority(input: {
  billingScope: "family" | "member";
  memberId: string;
  prisma: PrismaClient;
}): Promise<BillingPortalAuthority> {
  return withHostedMemberStripeMutationLock<BillingPortalAuthority>({
    memberId: input.memberId,
    prisma: input.prisma,
    run: (tx) =>
      input.billingScope === "family"
        ? readFamilyBillingPortalAuthority({
            memberId: input.memberId,
            tx,
          })
        : readMemberBillingPortalAuthority({
            memberId: input.memberId,
            tx,
          }),
  });
}

async function readMemberBillingPortalAuthority(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<MemberBillingPortalAuthority> {
  const billingRef = await input.tx.hostedMemberBillingRef.findUnique({
    select: {
      stripeCustomerIdEncrypted: true,
      stripeCustomerLookupKey: true,
      stripeEffectClaimId: true,
      stripeSubscriptionLookupKey: true,
    },
    where: { memberId: input.memberId },
  });
  await assertNoHostedDirectSubscriptionStripeEffectByLookupKeyTx({
    memberId: input.memberId,
    stripeEffectClaimId: billingRef?.stripeEffectClaimId,
    stripeSubscriptionLookupKey: billingRef?.stripeSubscriptionLookupKey,
    tx: input.tx,
  });
  return {
    billingScope: "member",
    groupId: null,
    stripeCustomerIdEncrypted:
      billingRef?.stripeCustomerIdEncrypted ?? null,
    stripeCustomerLookupKey: billingRef?.stripeCustomerLookupKey ?? null,
    stripeSubscriptionLookupKey:
      billingRef?.stripeSubscriptionLookupKey ?? null,
  };
}

async function readFamilyBillingPortalAuthority(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<FamilyBillingPortalAuthority> {
  const group = await input.tx.hostedAccountGroup.findUnique({
    select: {
      billingRef: {
        select: {
          stripeCustomerIdEncrypted: true,
          stripeCustomerLookupKey: true,
          stripeEffectClaimId: true,
          stripeSubscriptionIdEncrypted: true,
          stripeSubscriptionLookupKey: true,
        },
      },
      id: true,
      ownerMemberId: true,
    },
    where: { ownerMemberId: input.memberId },
  });

  if (!group) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_OWNER_NOT_FOUND",
      httpStatus: 403,
      message: "Only the Family plan owner can manage Family billing.",
    });
  }

  assertHostedStripeEffectClaimAbsent(group.billingRef?.stripeEffectClaimId);

  return {
    billingScope: "family",
    groupId: group.id,
    ownerMemberId: group.ownerMemberId,
    stripeCustomerIdEncrypted:
      group.billingRef?.stripeCustomerIdEncrypted ?? null,
    stripeCustomerLookupKey:
      group.billingRef?.stripeCustomerLookupKey ?? null,
    stripeSubscriptionIdEncrypted:
      group.billingRef?.stripeSubscriptionIdEncrypted ?? null,
    stripeSubscriptionLookupKey:
      group.billingRef?.stripeSubscriptionLookupKey ?? null,
  };
}

async function assertBillingPortalOwnerStillCurrent(input: {
  expected: BillingPortalAuthority;
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  const current = await readBillingPortalAuthority({
    billingScope: input.expected.billingScope,
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (!haveSameBillingPortalAuthority(current, input.expected)) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PORTAL_OWNER_CHANGED",
      httpStatus: 409,
      message: "Billing changed before the management link was ready. Refresh and try again.",
      retryable: true,
    });
  }
}

function haveSameBillingPortalAuthority(
  current: BillingPortalAuthority,
  expected: BillingPortalAuthority,
): boolean {
  if (current.billingScope !== expected.billingScope) {
    return false;
  }
  if (current.billingScope === "member" && expected.billingScope === "member") {
    return current.stripeCustomerIdEncrypted
        === expected.stripeCustomerIdEncrypted
      && current.stripeCustomerLookupKey === expected.stripeCustomerLookupKey
      && current.stripeSubscriptionLookupKey
        === expected.stripeSubscriptionLookupKey;
  }
  if (current.billingScope === "family" && expected.billingScope === "family") {
    return current.groupId === expected.groupId
      && current.ownerMemberId === expected.ownerMemberId
      && current.stripeCustomerIdEncrypted
        === expected.stripeCustomerIdEncrypted
      && current.stripeCustomerLookupKey === expected.stripeCustomerLookupKey
      && current.stripeSubscriptionIdEncrypted
        === expected.stripeSubscriptionIdEncrypted
      && current.stripeSubscriptionLookupKey
        === expected.stripeSubscriptionLookupKey;
  }
  return false;
}
