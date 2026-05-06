import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { UpgradeToEdgeButton } from "@/src/components/settings/hosted-plan-upgrade-button";
import { StartPaidPulseButton } from "@/src/components/settings/hosted-start-paid-pulse-button";
import type { HostedAiUsageGateNoticeCode } from "@/src/lib/hosted-execution/usage-allowance";

interface UsageLimitBannerProps {
  noticeCode: HostedAiUsageGateNoticeCode;
}

const usageLimitBannerCopy: Record<
  HostedAiUsageGateNoticeCode,
  {
    action: string;
    body: string;
    title: string;
  }
> = {
  edge_enable_usage_based_pricing: {
    action: "Enable usage-based pricing",
    body:
      "Your included assistant usage is used up. Turn on usage-based pricing to keep Murph replying now.",
    title: "Assistant usage is paused",
  },
  pulse_upgrade_edge: {
    action: "Upgrade to Edge",
    body:
      "Your monthly assistant usage is used up. Upgrade to Edge to keep Murph replying now.",
    title: "You are out of included usage",
  },
  trial_conversion_pending: {
    action: "Open billing",
    body:
      "Your trial has ended and billing is still settling. Open billing if you want to keep Murph replying now.",
    title: "Trial billing is updating",
  },
  trial_usage_limit_reached: {
    action: "Start Pulse",
    body:
      "Start your Pulse plan now to keep Murph replying.",
    title: "Trial credits are used up",
  },
};

export function UsageLimitBanner({ noticeCode }: UsageLimitBannerProps) {
  const copy = usageLimitBannerCopy[noticeCode] ?? usageLimitBannerCopy.pulse_upgrade_edge;

  return (
    <section
      aria-label="Usage limit"
      className="flex flex-col gap-5 rounded-lg border border-[#c4a882]/25 border-l-[3px] border-l-[#7a8c6e] bg-[rgba(255,252,246,0.9)] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Monthly allowance
        </p>
        <h2 className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground">
          {copy.title}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {copy.body}
        </p>
      </div>

      {noticeCode === "pulse_upgrade_edge" ? (
        <UpgradeToEdgeButton presentation="banner">
          {copy.action}
        </UpgradeToEdgeButton>
      ) : noticeCode === "trial_usage_limit_reached" ? (
        <StartPaidPulseButton presentation="banner">
          {copy.action}
        </StartPaidPulseButton>
      ) : (
        <Link
          href="/settings"
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-2xl bg-[#5a6e32] px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7a8c6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 sm:self-center"
        >
          {copy.action}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}
