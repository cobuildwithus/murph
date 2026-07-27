"use client";

import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import {
  HostedUsageTopUpDialog,
  type HostedUsageTopUpActivePurchase,
  type HostedUsageTopUpOffer,
  type HostedUsageTopUpReturn,
} from "./hosted-usage-top-up-dialog";

export function HostedFamilySelfUsageTopUpHost(props: {
  activePurchase?: HostedUsageTopUpActivePurchase | null;
  contactOptions?: readonly MurphContactOption[];
  initialOpen: boolean;
  memberId: string;
  offers: readonly HostedUsageTopUpOffer[];
  purchaseReturn?: HostedUsageTopUpReturn | null;
  targetLabel: string;
}) {
  if (!props.initialOpen && !props.purchaseReturn) {
    return null;
  }

  return (
    <div className="hidden">
      <HostedUsageTopUpDialog
        activePurchase={props.activePurchase}
        checkoutUrl={`/api/settings/billing/family/members/${encodeURIComponent(props.memberId)}/usage-credit/checkout`}
        contactOptions={props.contactOptions}
        deferTerminalRefreshUntilClose
        initialOpen={props.initialOpen}
        offers={props.offers}
        purchaseReturn={props.purchaseReturn}
        scope="family"
        targetLabel={props.targetLabel}
      />
    </div>
  );
}
