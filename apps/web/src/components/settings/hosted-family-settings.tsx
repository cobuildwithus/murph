import { HOSTED_FAMILY_PLAN_DISPLAY } from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedFamilyOwnerSnapshot } from "@/src/lib/hosted-onboarding/family-plan";
import type {
  HostedUsageTopUpActivePurchase,
  HostedUsageTopUpOffer,
  HostedUsageTopUpReturn,
} from "./hosted-usage-top-up-dialog";

import {
  HostedFamilyManager,
  type FamilyManagerInvite,
  type FamilyManagerMember,
} from "./hosted-family-settings-actions";

export function HostedFamilySettings(props: {
  ownerSnapshot: HostedFamilyOwnerSnapshot;
  payerMemberId: string;
  usageTopUpActiveMemberId?: string | null;
  usageTopUpActivePurchase?: HostedUsageTopUpActivePurchase | null;
  usageTopUpOffers?: readonly HostedUsageTopUpOffer[];
  usageTopUpPurchaseReturn?: HostedUsageTopUpReturn | null;
  usageTopUpReturnMemberId?: string | null;
}) {
  const snapshot = props.ownerSnapshot;

  const members: FamilyManagerMember[] = snapshot.members.map((member) => ({
    isOwner: member.isOwner,
    joinedAtIso: member.joinedAt ? member.joinedAt.toISOString() : null,
    label: member.label,
    memberId: member.memberId,
    pendingPlanCode: member.pendingPlanCode,
    planCode: member.planCode,
  }));
  const invites: FamilyManagerInvite[] = snapshot.invites.map((invite) => ({
    acceptUrl: invite.acceptUrl,
    channel: invite.channel,
    expiresAtIso: invite.expiresAt.toISOString(),
    id: invite.id,
    planCode: invite.planCode,
    targetEmail: invite.targetEmail,
    targetLabel: invite.targetLabel,
    targetPhoneHint: invite.targetPhoneHint,
    targetTelegramUsername: invite.targetTelegramUsername,
    telegramInviteUrl: invite.telegramInviteUrl,
  }));

  return (
    <div className="flex flex-col gap-5">
      <HostedFamilyManager
        billingActive={snapshot.billingActive}
        invites={invites}
        members={members}
        plans={snapshot.plans}
        payerMemberId={props.payerMemberId}
        seats={snapshot.seats}
        tiers={HOSTED_FAMILY_PLAN_DISPLAY.plans.map((plan) => ({
          name: plan.displayName,
          planCode: plan.code,
          priceLabel: `$${Math.round(plan.recurringAmountUsdCents / 100)}/mo`,
          recurringAmountUsdCents: plan.recurringAmountUsdCents,
        }))}
        usageTopUpActiveMemberId={props.usageTopUpActiveMemberId}
        usageTopUpActivePurchase={props.usageTopUpActivePurchase}
        usageTopUpOffers={props.usageTopUpOffers ?? []}
        usageTopUpPurchaseReturn={props.usageTopUpPurchaseReturn}
        usageTopUpReturnMemberId={props.usageTopUpReturnMemberId}
      />
    </div>
  );
}
