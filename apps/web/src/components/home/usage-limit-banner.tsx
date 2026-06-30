import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { UpgradeToEdgeButton } from "@/src/components/settings/hosted-plan-upgrade-button";
import { StartPaidPulseButton } from "@/src/components/settings/hosted-start-paid-pulse-button";
import type { HostedAiUsageGateNoticeCode } from "@/src/lib/hosted-execution/usage-allowance";

interface UsageLimitBannerProps {
  noticeCode: HostedAiUsageGateNoticeCode;
  now?: Date | null;
  resetAt?: Date | null;
}

const resettableMonthlyNoticeCodes = new Set<HostedAiUsageGateNoticeCode>([
  "edge_usage_limit_reached",
  "family_usage_limit_reached",
  "pulse_upgrade_edge",
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const usageLimitBannerCopy: Record<
  HostedAiUsageGateNoticeCode,
  {
    action: string;
    body: string;
    title: string;
  }
> = {
  edge_usage_limit_reached: {
    action: "View settings",
    body: "Murph will start replying again when your plan resets.",
    title: "You've hit this month's limit",
  },
  family_usage_limit_reached: {
    action: "View settings",
    body: "Murph will start replying again when your Family usage resets.",
    title: "You've hit this month's Family limit",
  },
  pulse_upgrade_edge: {
    action: "Upgrade to Edge",
    body: "Upgrade to Edge for more, or wait for your reset.",
    title: "You've hit this month's limit",
  },
  trial_conversion_pending: {
    action: "Open billing",
    body: "Start Pulse to keep Murph replying.",
    title: "Your trial just ended",
  },
  trial_usage_limit_reached: {
    action: "Start Pulse",
    body: "Start Pulse to keep Murph replying.",
    title: "Your trial credits are used up",
  },
};

export function UsageLimitBanner({ noticeCode, now, resetAt }: UsageLimitBannerProps) {
  const copy = usageLimitBannerCopy[noticeCode] ?? usageLimitBannerCopy.pulse_upgrade_edge;
  const resetLabel = formatUsageResetCountdown({ noticeCode, now, resetAt });

  return (
    <section
      aria-label="Account notice"
      className="flex flex-col gap-5 rounded-lg border border-[#c4a882]/25 border-l-[3px] border-l-[#7a8c6e] bg-[rgba(255,252,246,0.9)] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div className="min-w-0">
        {resetLabel ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] tabular-nums text-[#5a6e32]">
            {resetLabel}
          </p>
        ) : null}
        <h2 className="mt-2 font-serif text-xl font-semibold tracking-tight text-balance text-foreground">
          {copy.title}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground">
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

function formatUsageResetCountdown(input: {
  noticeCode: HostedAiUsageGateNoticeCode;
  now?: Date | null;
  resetAt?: Date | null;
}): string | null {
  if (!resettableMonthlyNoticeCodes.has(input.noticeCode)) {
    return null;
  }

  const nowTime = input.now instanceof Date ? input.now.getTime() : Number.NaN;
  const resetTime = input.resetAt instanceof Date ? input.resetAt.getTime() : Number.NaN;
  if (!Number.isFinite(nowTime) || !Number.isFinite(resetTime) || resetTime <= nowTime) {
    return null;
  }

  const remainingMs = resetTime - nowTime;
  if (remainingMs < MS_PER_DAY) {
    return "Resets in under a day";
  }

  const remainingDays = Math.ceil(remainingMs / MS_PER_DAY);
  return `Resets in ${remainingDays} ${remainingDays === 1 ? "day" : "days"}`;
}
