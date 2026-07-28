"use client";

import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import {
  HostedUsageTopUpDialog,
  type HostedUsageTopUpActivePurchase,
  type HostedUsageTopUpOffer,
} from "./hosted-usage-top-up-dialog";

export function HostedFamilySelfUsageTopUpHost(props: {
  activePurchase?: HostedUsageTopUpActivePurchase | null;
  contactOptions?: readonly MurphContactOption[];
  memberId: string;
  offers: readonly HostedUsageTopUpOffer[];
  targetLabel: string;
}) {
  return (
    <div className="hidden">
      <HostedUsageTopUpDialog
        activePurchase={props.activePurchase}
        checkoutUrl={`/api/settings/billing/family/members/${encodeURIComponent(props.memberId)}/usage-credit/checkout`}
        contactOptions={props.contactOptions}
        deferTerminalRefreshUntilClose
        initialOpen
        offers={props.offers}
        scope="family"
        targetLabel={props.targetLabel}
      />
    </div>
  );
}
