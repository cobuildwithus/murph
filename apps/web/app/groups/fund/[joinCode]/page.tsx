import type { Metadata } from "next";
import Link from "next/link";

import { GroupFundingSignInButton } from "@/src/components/hosted-groups/group-funding-sign-in-button";
import { GroupUsageFundingCard } from "@/src/components/hosted-groups/group-usage-funding-card";
import {
  HostedUsageTopUpDialog,
  type HostedUsageTopUpOffer,
  type HostedUsageTopUpReturn,
} from "@/src/components/settings/hosted-usage-top-up-dialog";
import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/src/components/ui/card";
import {
  readHostedGroupUsageFundingTargetByJoinCode,
  readHostedGroupUsageStatus,
} from "@/src/lib/hosted-groups/group-usage-funding";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { readHostedConfiguredUsageCreditOfferCodes } from "@/src/lib/hosted-onboarding/personal-usage-credit-eligibility";
import {
  estimateHostedUsageCreditMessages,
  getHostedUsageCreditOfferDefinition,
  type HostedUsageCreditOfferCode,
} from "@/src/lib/hosted-onboarding/usage-credit-offers";
import {
  readHostedActiveUsageCreditPurchaseForPayer,
  readHostedUsageCreditPurchaseStatus,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-service";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN = /^hucp_[A-Za-z0-9_-]{16}$/u;

type GroupFundingSearchParams = {
  usageCheckout?: string | string[] | undefined;
  usagePurchase?: string | string[] | undefined;
};

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "Add group usage · Murph",
    description: "Add one-time usage credit to a Murph group.",
  }),
  robots: { follow: false, index: false },
};

export default async function GroupFundingPage({
  params,
  searchParams,
}: {
  params: Promise<{ joinCode: string }>;
  searchParams?: Promise<GroupFundingSearchParams>;
}) {
  const [joinCode, resolvedSearchParams] = await Promise.all([
    resolveDecodedRouteParam(params, "joinCode"),
    searchParams ?? Promise.resolve<GroupFundingSearchParams>({}),
  ]);
  const prisma = getPrisma();
  const [auth, target] = await Promise.all([
    getHostedPageAuthSnapshot(),
    readHostedGroupUsageFundingTargetByJoinCode({ joinCode, prisma }),
  ]);
  if (!target) {
    return <GroupFundingUnavailable />;
  }

  const groupName = target.displayName?.trim() || describeGroupKind(target.kind);
  const member = auth.authenticatedMember;
  const requestedPurchaseReturn = readUsageTopUpPurchaseReturn(
    resolvedSearchParams,
  );
  const [usageStatus, activePurchase, purchaseReturnMatchesTarget] =
    await Promise.all([
      readHostedGroupUsageStatus({
        prisma,
        runtimeMemberId: target.runtimeMemberId,
      }),
      member
        ? readHostedActiveUsageCreditPurchaseForPayer({
            serverApprovedPayableTargets: [{
              beneficiaryMemberId: target.runtimeMemberId,
              groupJoinCode: target.joinCode,
              kind: "group",
            }],
            payerMemberId: member.id,
            prisma,
          }).catch(() => null)
        : Promise.resolve(null),
      member && requestedPurchaseReturn
        ? readHostedUsageCreditPurchaseStatus({
            beneficiaryMemberId: target.runtimeMemberId,
            payerMemberId: member.id,
            prisma,
            purchaseId: requestedPurchaseReturn.purchaseId,
          }).then(() => true).catch(() => false)
        : Promise.resolve(false),
    ]);
  if (!usageStatus) {
    return <GroupFundingUnavailable />;
  }
  const activePurchaseMatchesTarget =
    activePurchase?.target.kind === "group" &&
    activePurchase.target.beneficiaryMemberId === target.runtimeMemberId &&
    activePurchase.target.groupJoinCode === target.joinCode;
  const visibleActivePurchase = activePurchase
    ? activePurchaseMatchesTarget
      ? activePurchase
      : {
          ...activePurchase,
          retryAllowed: false,
          targetConflict: true as const,
          url: undefined,
        }
    : null;
  const offers = member && !member.suspendedAt && !activePurchase
    ? projectHostedUsageTopUpOffers(readHostedConfiguredUsageCreditOfferCodes())
    : [];
  const purchaseReturn = purchaseReturnMatchesTarget
    ? requestedPurchaseReturn
    : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-12 sm:px-6 sm:py-16">
      <GroupUsageFundingCard
        action={
          member ? (
            offers.length > 0 || visibleActivePurchase ? (
              <HostedUsageTopUpDialog
                activePurchase={visibleActivePurchase}
                checkoutUrl={`/api/groups/fund/${encodeURIComponent(target.joinCode)}/usage-credit/checkout`}
                offers={offers}
                payerMemberId={member.id}
                purchaseReturn={purchaseReturn}
                scope="group"
              />
            ) : (
              <p className="py-2 text-center text-sm text-muted-foreground">
                Usage credit isn&apos;t available from this account right now.
              </p>
            )
          ) : (
            <GroupFundingSignInButton />
          )
        }
        groupName={groupName}
      />
    </main>
  );
}

function GroupFundingUnavailable() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <h1 className="font-serif text-base font-medium leading-snug">
            This group funding link isn&apos;t available
          </h1>
          <CardDescription>
            Ask the group to share its current Murph usage link.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button render={<Link href="/home" />} nativeButton={false} className="w-full">
            Open Murph
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}

function readUsageTopUpPurchaseReturn(
  searchParams: GroupFundingSearchParams,
): HostedUsageTopUpReturn | null {
  const kind = readOnlySearchParamValue(searchParams.usageCheckout);
  const purchaseId = readOnlySearchParamValue(searchParams.usagePurchase);
  if (
    (kind !== "success" && kind !== "cancel")
    || typeof purchaseId !== "string"
    || !HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN.test(purchaseId)
  ) {
    return null;
  }
  return { kind, purchaseId };
}

function readOnlySearchParamValue(
  value: string | string[] | undefined,
): string | undefined {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.length === 1 ? value[0] : undefined;
}

function projectHostedUsageTopUpOffers(
  offerCodes: readonly HostedUsageCreditOfferCode[],
): HostedUsageTopUpOffer[] {
  return offerCodes.map((offerCode) => {
    const offer = getHostedUsageCreditOfferDefinition(offerCode);
    return {
      amountLabel: formatUsageTopUpAmount(offer.cashAmountMinor),
      estimatedMessages: estimateHostedUsageCreditMessages(offer.cashAmountMinor),
      offerCode: offer.code,
    };
  });
}

function formatUsageTopUpAmount(amountUsdCents: number): string {
  const wholeDollars = Math.floor(amountUsdCents / 100);
  const cents = amountUsdCents % 100;
  return cents === 0
    ? `$${wholeDollars}`
    : `$${wholeDollars}.${String(cents).padStart(2, "0")}`;
}

function describeGroupKind(kind: string): string {
  switch (kind) {
    case "couple": return "this couple";
    case "family": return "this family";
    case "friends": return "this circle";
    case "household": return "this household";
    case "team": return "this team";
    default: return "this group";
  }
}
