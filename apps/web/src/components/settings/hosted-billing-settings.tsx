import type { ReactNode } from "react";
import { CheckIcon } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import {
  HOSTED_FAMILY_PLAN_DISPLAY,
  HOSTED_PULSE_TRIAL_OFFER,
  getHostedBillingPlanDefinition,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { cn } from "@/src/lib/utils";

import { BillingPortalButton } from "./billing-portal-button";
import { HostedFamilyStartButton } from "./hosted-family-settings-actions";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { StartPaidPulseButton } from "./hosted-start-paid-pulse-button";
import { SwitchToPulseButton } from "./hosted-plan-switch-to-pulse-button";
import { UpgradeToEdgeButton } from "./hosted-plan-upgrade-button";

const PULSE_FEATURES = [
  "Run experiments, see what changed",
  "Sync your health data",
  "Private before/after outcomes",
  "Chat via iMessage, Telegram, or email",
  "Access to frontier AI models",
];

const EDGE_FEATURES = [
  "Everything in Pulse",
  "More usage on the latest AI models",
  "Longer experiment context",
  "Deeper research and analysis",
];

const FAMILY_FEATURES = [
  "Up to 4 people, one bill",
  "Everyone gets full Pulse",
  "Each person keeps a private Murph",
  "You can't see members' chats or health data",
];

interface PlanCardModel {
  action: ReactNode;
  current: boolean;
  currentLabel: string;
  features: readonly string[];
  key: string;
  name: string;
  note: string | null;
  price: string;
}

export function HostedBillingSettings(props: {
  authenticated: boolean;
  billingStatus?: unknown;
  canStartFamily?: boolean;
  canStartPaidPulse?: boolean;
  canSwitchToPulse?: boolean;
  canUpgradeToEdge?: boolean;
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  currentCheckoutOffer?: unknown;
  currentPeriodEnd?: Date | null;
  familyState?: "none" | "owner" | "sponsored";
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: unknown;
}) {
  if (!props.authenticated) {
    return (
      <HostedSettingsSessionState
        authenticated={props.authenticated}
        signedOutDescription="Sign in to manage your subscription."
      />
    );
  }

  const currentPlanCode = parseHostedBillingPlanCode(props.currentBillingPlanCode);
  const currentPhase = parseHostedBillingPhase(props.currentBillingPhase);
  const currentOffer = parseHostedBillingCheckoutOffer(props.currentCheckoutOffer);
  const scheduledPlanCode = parseHostedBillingPlanCode(props.scheduledBillingPlanCode);
  const scheduledBillingEffectiveAt =
    props.scheduledBillingEffectiveAt instanceof Date ? props.scheduledBillingEffectiveAt : null;
  const currentPeriodEndIso = props.currentPeriodEnd?.toISOString() ?? null;

  const familyState = props.familyState ?? "none";
  const familyCurrent = familyState === "owner" || familyState === "sponsored";
  const familyOwner = familyState === "owner";
  const pulseCurrent = !familyCurrent && currentPlanCode === "launch_monthly";
  const edgeCurrent = !familyCurrent && currentPlanCode === "launch_edge_monthly";

  const isPulseTrial =
    pulseCurrent && currentPhase !== "paid" && currentOffer === HOSTED_PULSE_TRIAL_OFFER;
  const hasPendingPulseSwitch =
    edgeCurrent && scheduledPlanCode === "launch_monthly" && scheduledBillingEffectiveAt !== null;
  const pendingPulseSwitchDate = hasPendingPulseSwitch
    ? formatHostedBillingDate(scheduledBillingEffectiveAt)
    : null;

  const cards: PlanCardModel[] = [
    {
      action: familyOwner
        ? <FamilyBillingChangeButton block targetPlanName="Pulse" />
        : pulseCurrent
        ? isPulseTrial && props.canStartPaidPulse === true
          ? <StartPaidPulseButton block>Start Pulse plan</StartPaidPulseButton>
          : <CurrentPlanButton />
        : hasPendingPulseSwitch
          ? null
          : props.canSwitchToPulse === true
            ? (
                <SwitchToPulseButton block currentPeriodEnd={currentPeriodEndIso}>
                  Choose Pulse
                </SwitchToPulseButton>
              )
            : <BillingPortalButton block variant="secondary" label="Choose Pulse" />,
      current: pulseCurrent,
      currentLabel: isPulseTrial ? "Free trial" : "Current plan",
      features: PULSE_FEATURES,
      key: "launch_monthly",
      name: "Pulse",
      note: familyOwner
        ? "Switching away from Family ends sponsored access for your family members when Family ends."
        : !pulseCurrent && hasPendingPulseSwitch && pendingPulseSwitchDate
        ? `Scheduled to start ${pendingPulseSwitchDate}`
        : null,
      price: formatMonthlyPrice(getHostedBillingPlanDefinition("launch_monthly").recurringAmountUsdCents),
    },
    {
      action: familyOwner
        ? <FamilyBillingChangeButton block targetPlanName="Edge" />
        : edgeCurrent
        ? <CurrentPlanButton />
        : props.canUpgradeToEdge === true
          ? <UpgradeToEdgeButton block>Choose Edge</UpgradeToEdgeButton>
          : <BillingPortalButton block variant="secondary" label="Choose Edge" />,
      current: edgeCurrent,
      currentLabel: "Current plan",
      features: EDGE_FEATURES,
      key: "launch_edge_monthly",
      name: "Edge",
      note: familyOwner
        ? "Move to an individual plan only after you have ended or changed the Family subscription."
        : edgeCurrent && hasPendingPulseSwitch && pendingPulseSwitchDate
        ? `Switching to Pulse on ${pendingPulseSwitchDate}. Want to keep Edge? Contact support.`
        : null,
      price: formatMonthlyPrice(getHostedBillingPlanDefinition("launch_edge_monthly").recurringAmountUsdCents),
    },
    {
      action: familyCurrent
        ? <CurrentPlanButton />
        : props.canStartFamily === true
          ? <HostedFamilyStartButton block label="Choose Family" />
          : null,
      current: familyCurrent,
      currentLabel: familyState === "sponsored" ? "Sponsored" : "Current plan",
      features: FAMILY_FEATURES,
      key: "family",
      name: "Family",
      note: familyState === "sponsored" ? "Paid by your family plan owner." : null,
      price: formatMonthlyPrice(HOSTED_FAMILY_PLAN_DISPLAY.recurringAmountUsdCents),
    },
  ];

  const planResolved = pulseCurrent || edgeCurrent || familyCurrent;
  const noPlanText =
    props.billingStatus === "active"
      ? "Your subscription is active."
      : "You're not on a paid plan yet. Choose one below.";

  return (
    <div className="flex flex-col gap-4">
      {!planResolved ? (
        <p className="text-sm text-pretty text-muted-foreground">{noPlanText}</p>
      ) : null}
      <div className="grid items-stretch gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <PlanCard key={card.key} card={card} />
        ))}
      </div>
      <div className="flex justify-end">
        {familyState === "sponsored" ? (
          <p className="text-sm text-muted-foreground">
            Billing is managed by your Family plan owner.
          </p>
        ) : (
          <BillingPortalButton
            billingScope={familyOwner ? "family" : "member"}
            variant="ghost"
            label={familyOwner ? "Manage Family billing" : "Manage billing"}
          />
        )}
      </div>
    </div>
  );
}

function FamilyBillingChangeButton(props: {
  block?: boolean;
  targetPlanName: "Edge" | "Pulse";
}) {
  return (
    <BillingPortalButton
      billingScope="family"
      block={props.block}
      variant="secondary"
      label={`Manage Family billing`}
      confirmation={{
        confirmLabel: "Open Family billing",
        title: `Switch from Family to ${props.targetPlanName}`,
        description:
          "Family billing is shared. If you end or change it, sponsored members keep their private Murph accounts, but they lose Family-sponsored access when the Family subscription ends.",
      }}
    />
  );
}

function PlanCard({ card }: { card: PlanCardModel }) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border",
        card.current ? "border-primary ring-1 ring-primary/40" : "border-border",
      )}
    >
      {card.current ? (
        <div className="bg-primary px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-primary-foreground">
          {card.currentLabel}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {card.name}
        </p>
        <p className="text-sm text-muted-foreground">
          <span className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            {card.price}
          </span>{" "}
          / month
        </p>
        <ul className="flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
          {card.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <CheckIcon
                className="mt-0.5 size-3.5 shrink-0 text-primary"
                strokeWidth={2.5}
                aria-hidden="true"
              />
              {feature}
            </li>
          ))}
        </ul>
        {card.note ? <p className="text-xs leading-5 text-muted-foreground">{card.note}</p> : null}
        {card.action ? <div className="pt-1">{card.action}</div> : null}
      </div>
    </div>
  );
}

function CurrentPlanButton() {
  return (
    <Button type="button" variant="outline" size="default" disabled className="w-full">
      Current plan
    </Button>
  );
}

function formatMonthlyPrice(amountUsdCents: number): string {
  return `$${Math.round(amountUsdCents / 100)}`;
}

function formatHostedBillingDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(value);
}
