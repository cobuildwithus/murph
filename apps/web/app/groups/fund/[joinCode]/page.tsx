import {
  GroupFundingCheckout,
  type GroupFundingMonthlyCapOption,
} from "@/src/components/hosted-groups/group-funding-checkout";
import {
  GroupFundingSignInButton,
  GroupFundingSignInRequired,
} from "@/src/components/hosted-groups/group-funding-sign-in-button";
import {
  LinkPageFrame,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import {
  GroupSponsorshipManagementCard,
} from "@/src/components/hosted-groups/group-sponsorship-management-card";
import {
  type HostedUsageTopUpActivePurchase,
  type HostedUsageTopUpOffer,
  type HostedUsageTopUpReturn,
} from "@/src/components/settings/hosted-usage-top-up-dialog";
import { readHostedGroupChatName } from "@/src/lib/hosted-groups/group-chat-name";
import {
  readHostedGroupUsageFundingTargetByJoinCode,
  readHostedGroupUsageFundingManagementTargetByLocator,
  readHostedGroupUsageStatus,
} from "@/src/lib/hosted-groups/group-usage-funding";
import {
  readHostedGroupSponsorshipAuthorizationByPurchase,
  readHostedGroupSponsorshipManagementProjection,
} from "@/src/lib/hosted-groups/group-sponsorship-authorization";
import {
  HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR,
} from "@/src/lib/hosted-groups/group-sponsorship-contract";
import {
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

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN = /^hucp_[A-Za-z0-9_-]{16}$/u;
const HOSTED_GROUP_FUNDING_CHAT_NAME_TIMEOUT_MS = 2_000;

type GroupFundingSearchParams = {
  usageCheckout?: string | string[] | undefined;
  usagePurchase?: string | string[] | undefined;
};

export { generateMetadata } from "./page-metadata";

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
  const [
    usageStatus,
    activePurchase,
    purchaseReturnMatchesTarget,
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
  const groupName = await resolveGroupFundingName({
    target,
    viewerSponsors: sponsorshipManagement !== null,
  });
  const activePurchaseMatchesTarget =
    activePurchase?.target.kind === "group" &&
    activePurchase.target.beneficiaryMemberId === target.runtimeMemberId;
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
  const oneTimeOffers = member && !managementOnly && !member.suspendedAt
    ? readHostedConfiguredGroupSponsorshipOfferCodes({
        configuredOfferCodes: readHostedConfiguredUsageCreditOfferCodes(),
      }).map(projectHostedUsageTopUpOffer)
    : [];
  const purchaseReturn = purchaseReturnMatchesTarget
    ? requestedPurchaseReturn
    : null;
  const sponsorshipCheckoutReturned = await isSponsorshipCheckoutReturn({
    management: sponsorshipManagement,
    prisma,
    purchaseReturn,
  });
  const activatingSponsorship =
    sponsorshipManagement?.status === "pending_activation" &&
    visibleActivePurchase !== null;
  const managingSponsorship =
    sponsorshipManagement !== null && !activatingSponsorship;
  const sponsoredByAnother =
    usageStatus.sponsorshipStatus === "sponsored" &&
    sponsorshipManagement === null;
  // One element across every checkout state, so a canceled activation keeps its
  // place and its note when the page refreshes around it.
  const checkout = member ? (
    <GroupFundingCheckout
      activePurchase={visibleActivePurchase}
      checkoutUrl={`/api/groups/fund/${encodeURIComponent(target.joinCode)}/usage-credit/checkout`}
      groupName={groupName}
      initialMode={
        activatingSponsorship
          ? "monthly"
          : visibleActivePurchase
            ? "one_time"
            : undefined
      }
      initialMonthlyCapMinor={
        activatingSponsorship ? sponsorshipManagement.monthlyCapMinor : undefined
      }
      keepPurchaseReturnQuery={sponsorshipCheckoutReturned}
      monthly={
        sponsoredByAnother || managingSponsorship
          ? null
          : {
              capOptions: projectHostedMonthlyCapOptions(),
              offer: projectHostedUsageTopUpOffer("usage_5_usd"),
            }
      }
      oneTimeOffers={managingSponsorship ? [] : oneTimeOffers}
      payerMemberId={member.id}
      purchaseReturn={purchaseReturn}
      sponsoredByAnother={sponsoredByAnother}
    />
  ) : null;

  return (
    <LinkPageFrame>
      {!member ? (
        <LinkPageScreen
          actions={<GroupFundingSignInButton />}
          title={`Keep Murph in ${groupName}.`}
        />
      ) : managingSponsorship ? (
        <>
          <GroupSponsorshipManagementCard
            cancelOnly={managementOnly || Boolean(member.suspendedAt)}
            checkoutReturned={sponsorshipCheckoutReturned}
            endpoint={`/api/groups/fund/${encodeURIComponent(target.joinCode)}/sponsorship`}
            groupName={groupName}
            management={sponsorshipManagement}
          />
          {/* Monthly sponsors raise their limit instead; only an open
              one-time payment stays reachable here. */}
          {visibleActivePurchase ? checkout : null}
        </>
      ) : visibleActivePurchase || oneTimeOffers.length > 0 ? (
        checkout
      ) : (
        <LinkPageScreen
          title={
            sponsoredByAnother
              ? "Murph is sponsored in this chat."
              : "Sponsoring isn’t available from this account."
          }
        />
      )}
    </LinkPageFrame>
  );
}

function projectHostedMonthlyCapOptions(): GroupFundingMonthlyCapOption[] {
  return HOSTED_GROUP_SPONSORSHIP_MONTHLY_CAPS_MINOR.map((monthlyCapMinor) => ({
    amountLabel: formatUsageTopUpAmount(monthlyCapMinor),
    monthlyCapMinor,
  }));
}

function GroupFundingUnavailable() {
  return (
    <LinkPageFrame>
      <LinkPageScreen
        detail="Ask the group for a new one."
        title="This link isn’t working."
      />
    </LinkPageFrame>
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

function projectHostedUsageTopUpOffer(
  offerCode: HostedGroupSponsorshipOfferCode,
): HostedUsageTopUpOffer {
  const offer = getHostedUsageCreditOfferDefinition(offerCode);
  return {
    amountLabel: formatUsageTopUpAmount(offer.cashAmountMinor),
    offerCode: offer.code,
  };
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

// A validated Checkout return confirms payment on the sponsorship card only when
// the returned purchase belongs to this payer's sponsorship; one-time purchases
// keep their own receipt.
async function isSponsorshipCheckoutReturn(input: {
  management: { authorizationId: string } | null;
  prisma: ReturnType<typeof getPrisma>;
  purchaseReturn: HostedUsageTopUpReturn | null;
}): Promise<boolean> {
  if (input.purchaseReturn?.kind !== "success" || !input.management) {
    return false;
  }
  const sponsorship = await readHostedGroupSponsorshipAuthorizationByPurchase({
    prisma: input.prisma,
    purchaseId: input.purchaseReturn.purchaseId,
  }).catch(() => null);
  return sponsorship?.authorizationId === input.management.authorizationId;
}

// Only the sponsor paying for this chat may see its provider title when the
// group never stored a name; everyone else sees the stored name or a label.
async function resolveGroupFundingName(input: {
  target: { displayName: string | null; kind: string; runtimeMemberId: string };
  viewerSponsors: boolean;
}): Promise<string> {
  const storedName = input.target.displayName?.trim();
  if (storedName) {
    return storedName;
  }
  const chatName = input.viewerSponsors
    ? await readGroupChatNameWithin(input.target.runtimeMemberId)
    : null;
  return chatName ?? describeUnnamedGroup(input.target.kind);
}

async function readGroupChatNameWithin(
  runtimeMemberId: string,
): Promise<string | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(
      () => resolve(null),
      HOSTED_GROUP_FUNDING_CHAT_NAME_TIMEOUT_MS,
    );
  });
  try {
    const result = await Promise.race([
      readHostedGroupChatName({ memberId: runtimeMemberId }).catch(() => null),
      timeout,
    ]);
    return result?.status === "ok" ? result.displayName : null;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function describeUnnamedGroup(kind: string): string {
  switch (kind) {
    case "couple": return "your couple chat";
    case "family": return "your family chat";
    case "friends": return "your friends chat";
    case "household": return "your household chat";
    case "team": return "your team chat";
    default: return "your group chat";
  }
}
