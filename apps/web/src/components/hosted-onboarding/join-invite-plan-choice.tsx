"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { CheckIcon } from "lucide-react";

import {
  LINK_PAGE_NIGHT_TOKENS,
  LINK_PAGE_PILL_CLASS,
} from "@/src/components/link-page/link-page-shell";
import { HostedFamilyStartButton } from "@/src/components/settings/hosted-family-start-button";
import type { HostedBillingPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
import { cn } from "@/src/lib/utils";

import { JoinInviteCheckoutPlanButtonIsland } from "./join-invite-islands";

const FAMILY_CHOICE = "Family";

export interface JoinInvitePlanOption {
  description: string;
  disabledLabel?: string;
  idleLabel: string;
  name: string;
  planCode: HostedBillingPlanCode | null;
  price: string;
}

export interface JoinInviteFamilyOption {
  description: string;
  features: readonly string[];
  price: string;
}

/**
 * One choice and one button. Each plan keeps the checkout button it always had;
 * only the selected one is on the page, and selection locks while it runs, so
 * the plan that opens is always the plan on the pill.
 */
export function JoinInvitePlanChoice({
  billingReady,
  family,
  inviteCode,
  plans,
}: {
  billingReady: boolean;
  family: JoinInviteFamilyOption | null;
  inviteCode: string;
  plans: readonly JoinInvitePlanOption[];
}) {
  const groupName = useId();
  const [selected, setSelected] = useState(family ? FAMILY_CHOICE : plans[0]?.name);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const selectedPlan = plans.find((plan) => plan.name === selected) ?? null;

  useEffect(() => {
    // Back from checkout revives this page mid-redirect. With one button, that
    // would leave no way to choose again.
    function restore(event: PageTransitionEvent) {
      if (!event.persisted) return;
      setBusy(false);
      setAttempt((current) => current + 1);
    }

    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  return (
    <div className="flex w-full flex-col gap-[18px]" style={LINK_PAGE_NIGHT_TOKENS}>
      <div aria-label="Murph plan" className="flex flex-col gap-2.5" role="radiogroup">
        {family ? (
          <JoinInvitePlanRow
            description={family.description}
            disabled={busy}
            groupName={groupName}
            name={FAMILY_CHOICE}
            onSelect={setSelected}
            price={family.price}
            priceUnit="/ person / mo"
            selected={selected === FAMILY_CHOICE}
          />
        ) : null}
        {plans.map((plan) => (
          <JoinInvitePlanRow
            description={plan.description}
            disabled={busy}
            groupName={groupName}
            key={plan.name}
            name={plan.name}
            onSelect={setSelected}
            price={plan.price}
            priceUnit="/ mo"
            selected={selected === plan.name}
          />
        ))}
      </div>

      {selectedPlan ? (
        <JoinInviteCheckoutPlanButtonIsland
          billingReady={billingReady}
          className={LINK_PAGE_PILL_CLASS}
          disabledLabel={selectedPlan.disabledLabel}
          idleLabel={selectedPlan.idleLabel}
          inviteCode={inviteCode}
          key={`${selectedPlan.name}:${attempt}`}
          onBusyChange={setBusy}
          planCode={selectedPlan.planCode}
        />
      ) : null}

      {family && !selectedPlan ? (
        <>
          <ul className="flex flex-col gap-2">
            {family.features.map((feature) => (
              <JoinInvitePlanFeature key={feature}>{feature}</JoinInvitePlanFeature>
            ))}
          </ul>
          <HostedFamilyStartButton
            block
            className={cn(LINK_PAGE_PILL_CLASS, "hover:bg-[#FFFCF6]")}
            key={`${FAMILY_CHOICE}:${attempt}`}
            label="Restart Family"
            onSubmittingChange={setBusy}
          />
        </>
      ) : null}
    </div>
  );
}

function JoinInvitePlanRow({
  description,
  disabled,
  groupName,
  name,
  onSelect,
  price,
  priceUnit,
  selected,
}: {
  description: string;
  disabled: boolean;
  groupName: string;
  name: string;
  onSelect: (name: string) => void;
  price: string;
  priceUnit: string;
  selected: boolean;
}) {
  return (
    <label
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-[18px] border-[1.5px] bg-[#2A2622] p-[18px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#FFFCF6]/70 has-[:disabled]:cursor-default",
        selected ? "border-[#FFFCF6]" : "border-transparent",
      )}
    >
      <input
        checked={selected}
        className="sr-only"
        disabled={disabled}
        name={groupName}
        onChange={() => onSelect(name)}
        type="radio"
        value={name}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xl font-semibold leading-[22px] text-[#FFFCF6]">{name}</span>
        <span className="text-pretty text-sm font-medium leading-[19px] text-[#FFFCF6]/60">
          {description}
        </span>
      </span>
      <span className="flex shrink-0 items-baseline gap-[3px]">
        <span className="font-serif text-[26px] font-semibold leading-[30px] tracking-[-0.01em] text-[#FFFCF6]">
          {price}
        </span>
        <span className="text-sm font-medium leading-[18px] text-[#FFFCF6]/60">{priceUnit}</span>
      </span>
    </label>
  );
}

function JoinInvitePlanFeature({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-base font-medium leading-[22px] text-[#FFFCF6]/85">
      <CheckIcon aria-hidden="true" className="mt-[3px] size-4 shrink-0 text-[#D9B969]" strokeWidth={2.5} />
      <span className="min-w-0">{children}</span>
    </li>
  );
}
