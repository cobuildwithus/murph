import { ArrowRight } from "lucide-react";
import Link from "next/link";

import {
  isHostedPulseTrialBillingState,
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";

export type HomeTrialBillingBannerVariant = "resume";

export function TrialBillingBanner() {
  const copy = {
    action: "Open billing",
    body: "Add a payment method and resume billing to keep Murph replying.",
    title: "Resume Pulse billing",
  };

  return (
    <section
      aria-label="Trial billing"
      className="flex flex-col gap-5 rounded-lg border border-[#c4a882]/25 border-l-[3px] border-l-[#7a8c6e] bg-[rgba(255,252,246,0.9)] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
          Pulse trial
        </p>
        <h2 className="mt-2 font-serif text-xl font-semibold tracking-tight text-balance text-foreground">
          {copy.title}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground">
          {copy.body}
        </p>
      </div>

      <Link
        href="/settings"
        className="inline-flex shrink-0 items-center gap-2 self-start rounded-2xl bg-[#5a6e32] px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7a8c6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 sm:self-center"
      >
        {copy.action}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

export function resolveHomeTrialBillingBannerVariant(input: {
  billingRef?: {
    currentBillingPhase?: unknown;
    currentBillingPlanCode?: unknown;
    currentCheckoutOffer?: unknown;
    stripeCustomerId?: unknown;
    stripeSubscriptionId?: unknown;
  } | null;
  billingStatus?: unknown;
  suspendedAt?: unknown;
}): HomeTrialBillingBannerVariant | null {
  if (
    input.billingStatus === "paused" &&
    !(input.suspendedAt instanceof Date) &&
    parseHostedBillingPlanCode(input.billingRef?.currentBillingPlanCode) === "launch_monthly" &&
    isHostedPulseTrialBillingState({
      currentBillingPhase: input.billingRef?.currentBillingPhase,
      currentCheckoutOffer: input.billingRef?.currentCheckoutOffer,
    }) &&
    typeof input.billingRef?.stripeCustomerId === "string" &&
    input.billingRef.stripeCustomerId.length > 0 &&
    typeof input.billingRef?.stripeSubscriptionId === "string" &&
    input.billingRef.stripeSubscriptionId.length > 0
  ) {
    return "resume";
  }

  return null;
}
