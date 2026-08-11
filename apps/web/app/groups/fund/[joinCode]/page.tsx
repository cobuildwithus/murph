import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  GroupFundingSignInButton,
  GroupFundingSignInRequired,
} from "@/src/components/hosted-groups/group-funding-sign-in-button";
import { GroupFundingSupporters } from "@/src/components/hosted-groups/group-funding-supporters";
import {
  GroupUsageFundingActions,
  GroupUsageFundingShell,
} from "@/src/components/hosted-groups/group-usage-funding-shell";
import {
  GroupSponsorshipDialog,
  type GroupSponsorshipMonthlyCapOption,
  type GroupSponsorshipOffer,
} from "@/src/components/hosted-groups/group-sponsorship-dialog";
import {
  GroupSponsorshipManagementCard,
} from "@/src/components/hosted-groups/group-sponsorship-management-card";
import {
  type HostedUsageTopUpActivePurchase,
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
  readHostedGroupUsageFundingManagementTargetByLocator,
  readHostedGroupUsageStatus,
} from "@/src/lib/hosted-groups/group-usage-funding";
import {
  readHostedGroupSponsorshipManagementProjection,
} from "@/src/lib/hosted-groups/group-sponsorship-authorization";
import {
  hasHostedGroupSponsorshipCustomizationAuthority,
  readHostedGroupFundingSupporters,
  readHostedGroupSponsorshipDraftForCreator,
} from "@/src/lib/hosted-groups/group-sponsorship-store";
import {
  getHostedGroupSponsorshipExperiencePolicy,
  readHostedConfiguredGroupSponsorshipOfferCodes,
} from "@/src/lib/hosted-groups/group-sponsorship-policy";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { readHostedConfiguredUsageCreditOfferCodes } from "@/src/lib/hosted-onboarding/personal-usage-credit-eligibility";
import {
  getHostedUsageCreditOfferDefinition,
  type HostedGroupSponsorshipOfferCode,
} from "@/src/lib/hosted-onboarding/usage-credit-offers";
import {
  type HostedActiveUsageCreditPurchaseProjection,
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
const HOSTED_GROUP_FUNDING_SUPPORTERS_TIMEOUT_MS = 2_000;

type GroupFundingSearchParams = {
  usageCheckout?: string | string[] | undefined;
  usagePurchase?: string | string[] | undefined;
};

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "Sponsor Murph in this chat",
    description:
      "Keep the group talking and make the thank-you unnecessarily entertaining.",
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
  const [auth, publicTarget] = await Promise.all([
    getHostedPageAuthSnapshot(),
    readHostedGroupUsageFundingTargetByJoinCode({ joinCode, prisma }),
  ]);
  const member = auth.authenticatedMember;
  const managementTarget = !publicTarget && member
    ? await readHostedGroupUsageFundingManagementTargetByLocator({
        locator: joinCode,
        prisma,
      })
    : null;
  const target = publicTarget ?? managementTarget;
  if (!target) {
    return member ? <GroupFundingUnavailable /> : <GroupFundingSignInRequired />;
  }

  const managementOnly = publicTarget === null;
  const requestedPurchaseReturn = readUsageTopUpPurchaseReturn(
    resolvedSearchParams,
  );
  const customizationAllowedPromise =
    member && !managementOnly && !member.suspendedAt
      ? hasHostedGroupSponsorshipCustomizationAuthority({
          containerMemberId: target.runtimeMemberId,
          now: new Date(),
          participantMemberId: member.id,
          prisma,
        })
      : Promise.resolve(false);
  const [
    usageStatus,
    activePurchase,
    purchaseReturnMatchesTarget,
    customizationAllowed,
    sponsorshipManagement,
  ] =
    await Promise.all([
      managementOnly
        ? Promise.resolve({ sponsorshipStatus: "sponsored" } as const)
        : readHostedGroupUsageStatus({
            prisma,
            runtimeMemberId: target.runtimeMemberId,
          }),
      member && !managementOnly && !member.suspendedAt
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
      member && !managementOnly && !member.suspendedAt && requestedPurchaseReturn
        ? readHostedUsageCreditPurchaseStatus({
            beneficiaryMemberId: target.runtimeMemberId,
            payerMemberId: member.id,
            prisma,
            purchaseId: requestedPurchaseReturn.purchaseId,
          }).then(() => true).catch(() => false)
        : Promise.resolve(false),
      customizationAllowedPromise,
      member
        ? readHostedGroupSponsorshipManagementProjection({
            beneficiaryMemberId: target.runtimeMemberId,
            payerMemberId: member.id,
            prisma,
          })
        : Promise.resolve(null),
    ]);
  if (!usageStatus || (managementOnly && !sponsorshipManagement)) {
    return <GroupFundingUnavailable />;
  }
  const groupName = target.displayName?.trim() || describeGroupKind(target.kind);
  const activePurchaseMatchesTarget =
    activePurchase?.target.kind === "group" &&
    activePurchase.target.beneficiaryMemberId === target.runtimeMemberId;
  const frozenSponsorship =
    member && activePurchaseMatchesTarget && activePurchase
      ? await readHostedGroupSponsorshipDraftForCreator({
          creatorMemberId: member.id,
          prisma,
          purchaseId: activePurchase.purchaseId,
        })
      : undefined;
  const visibleActivePurchase = activePurchase
    ? activePurchaseMatchesTarget
      ? projectHostedGroupActivePurchaseForClient(activePurchase)
      : {
          ...projectHostedGroupActivePurchaseForClient(activePurchase),
          retryAllowed: false,
          targetConflict: true as const,
          url: undefined,
        }
    : null;
  const oneTimeOffers = member && !managementOnly && !member.suspendedAt && !activePurchase
    ? projectHostedUsageTopUpOffers(
        readHostedConfiguredGroupSponsorshipOfferCodes({
          configuredOfferCodes: readHostedConfiguredUsageCreditOfferCodes(),
        }),
      )
    : [];
  const monthlyOffer = projectHostedUsageTopUpOffers(["usage_5_usd"]);
  const monthlyCapOptions = projectHostedMonthlyCapOptions();
  const purchaseReturn = purchaseReturnMatchesTarget
    ? requestedPurchaseReturn
    : null;
  const openOneTimeContribution =
    sponsorshipManagement === null &&
    usageStatus.sponsorshipStatus === "sponsored";
  const oneTimeContributionDialog = member && oneTimeOffers.length > 0 ? (
    <GroupSponsorshipDialog
      checkoutUrl={`/api/groups/fund/${encodeURIComponent(target.joinCode)}/usage-credit/checkout`}
      customizationAllowed={customizationAllowed}
      initialOpen={openOneTimeContribution}
      mode="one_time"
      offers={oneTimeOffers}
      payerMemberId={member.id}
      purchaseReturn={purchaseReturn}
      triggerSize="default"
      triggerVariant="link"
    />
  ) : null;
  const oneTimeContributionAction = member && visibleActivePurchase ? (
    <GroupSponsorshipDialog
      activePurchase={visibleActivePurchase}
      checkoutUrl={`/api/groups/fund/${encodeURIComponent(target.joinCode)}/usage-credit/checkout`}
      customizationAllowed={customizationAllowed}
      frozenSponsorship={frozenSponsorship}
      initialOpen
      mode="one_time"
      offers={oneTimeOffers}
      payerMemberId={member.id}
      purchaseReturn={purchaseReturn}
    />
  ) : oneTimeContributionDialog ? (
    <GroupUsageFundingActions oneTimeAction={oneTimeContributionDialog} />
  ) : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-8 sm:px-6 sm:py-12">
      <GroupUsageFundingShell
        action={
          <div>
            {member ? (
              sponsorshipManagement?.status === "pending_activation" &&
              visibleActivePurchase ? (
                <GroupSponsorshipDialog
                  activePurchase={visibleActivePurchase}
                  checkoutUrl={`/api/groups/fund/${encodeURIComponent(target.joinCode)}/usage-credit/checkout`}
                  customizationAllowed={customizationAllowed}
                  frozenSponsorship={frozenSponsorship}
                  initialOpen
                  mode="monthly"
                  monthlyCapMinor={sponsorshipManagement.monthlyCapMinor}
                  monthlyCapOptions={monthlyCapOptions}
                  offers={monthlyOffer}
                  payerMemberId={member.id}
                  purchaseReturn={purchaseReturn}
                />
              ) : sponsorshipManagement ? (
                <div className="space-y-4">
                  <GroupSponsorshipManagementCard
                    cancelOnly={managementOnly || Boolean(member.suspendedAt)}
                    endpoint={`/api/groups/fund/${encodeURIComponent(target.joinCode)}/sponsorship`}
                    management={sponsorshipManagement}
                  />
                  {oneTimeContributionAction}
                </div>
              ) : usageStatus.sponsorshipStatus === "sponsored" ? (
                <div className="space-y-4">
                  <p className="py-2 text-center text-sm text-muted-foreground">
                    Murph is sponsored in this chat.
                  </p>
                  {oneTimeContributionAction}
                </div>
              ) : visibleActivePurchase ? (
                oneTimeContributionAction
              ) : oneTimeOffers.length > 0 ? (
                <GroupUsageFundingActions
                  monthlyAction={(
                    <GroupSponsorshipDialog
                      checkoutUrl={`/api/groups/fund/${encodeURIComponent(target.joinCode)}/usage-credit/checkout`}
                      customizationAllowed={customizationAllowed}
                      initialOpen
                      mode="monthly"
                      monthlyCapOptions={monthlyCapOptions}
                      offers={monthlyOffer}
                      payerMemberId={member.id}
                      purchaseReturn={purchaseReturn}
                    />
                  )}
                  oneTimeAction={oneTimeContributionDialog}
                />
              ) : (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  Sponsorship isn&apos;t available from this account right now.
                </p>
              )
            ) : (
              <GroupFundingSignInButton />
            )}
            {customizationAllowed ? (
              <Suspense fallback={null}>
                <GroupFundingSupportersStream
                  beneficiaryMemberId={target.runtimeMemberId}
                  prisma={prisma}
                />
              </Suspense>
            ) : null}
          </div>
        }
        groupName={groupName}
      />
    </main>
  );
}

async function GroupFundingSupportersStream({
  beneficiaryMemberId,
  prisma,
}: {
  beneficiaryMemberId: string;
  prisma: ReturnType<typeof getPrisma>;
}) {
  const supporters = await readHostedGroupFundingSupporters({
    beneficiaryMemberId,
    prisma,
    signal: AbortSignal.timeout(HOSTED_GROUP_FUNDING_SUPPORTERS_TIMEOUT_MS),
  }).catch(() => null);
  return supporters
    ? <GroupFundingSupporters supporters={supporters} />
    : null;
}

function projectHostedMonthlyCapOptions(): GroupSponsorshipMonthlyCapOption[] {
  return ([500, 1_000, 2_000] as const).map((monthlyCapMinor) => ({
    amountLabel: formatUsageTopUpAmount(monthlyCapMinor),
    monthlyCapMinor,
  }));
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
  offerCodes: readonly HostedGroupSponsorshipOfferCode[],
): GroupSponsorshipOffer[] {
  return offerCodes.map((offerCode) => {
    const offer = getHostedUsageCreditOfferDefinition(offerCode);
    const experience =
      getHostedGroupSponsorshipExperiencePolicy(offerCode);
    return {
      amountLabel: formatUsageTopUpAmount(offer.cashAmountMinor),
      offerCode: offer.code,
      runningBitDurationLabel: experience.runningBitDurationLabel,
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

function projectHostedGroupActivePurchaseForClient(
  purchase: HostedActiveUsageCreditPurchaseProjection,
): HostedUsageTopUpActivePurchase {
  return {
    cancelAllowed: purchase.cancelAllowed,
    offerCode: purchase.offerCode,
    purchaseId: purchase.purchaseId,
    restartAt: purchase.restartAt,
    retryAllowed: purchase.retryAllowed,
    status: purchase.status,
    url: purchase.url,
  };
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
