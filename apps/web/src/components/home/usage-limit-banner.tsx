import { ArrowRight } from "lucide-react";
import Link from "next/link";

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
  Exclude<HostedAiUsageGateNoticeCode, "thread_usage_limit_reached">,
  {
    action: string;
    body: string;
    title: string;
  }
> = {
  edge_usage_limit_reached: {
    action: "Review settings",
    body: "Murph keeps replying. Switch to Luna in Settings to use less AI on future turns.",
    title: "You've used this month's included Edge usage",
  },
  family_usage_limit_reached: {
    action: "Review settings",
    body: "Murph keeps replying. Switch to Luna in Settings to use less AI on future turns.",
    title: "Your Family has used this month's included usage",
  },
  pulse_upgrade_edge: {
    action: "Review settings",
    body: "Murph keeps replying. Switch to Luna in Settings to use less AI, or review Edge for more included usage.",
    title: "You've used this month's included Pulse usage",
  },
  trial_conversion_pending: {
    action: "Open billing",
    body: "Start Pulse to keep Murph replying.",
    title: "Your trial just ended",
  },
  trial_usage_limit_reached: {
    action: "Review settings",
    body: "Murph keeps replying. Switch to Luna in Settings to use less AI, or review plan options when you're ready.",
    title: "You've used your included trial usage",
  },
};

export function UsageLimitBanner({ noticeCode, now, resetAt }: UsageLimitBannerProps) {
  if (noticeCode === "thread_usage_limit_reached") {
    return null;
  }

  const copy = usageLimitBannerCopy[noticeCode] ?? usageLimitBannerCopy.pulse_upgrade_edge;
  const resetLabel = formatUsageResetCountdown({ noticeCode, now, resetAt });

  return (
    <section
      aria-label="Account notice"
      className="flex flex-col gap-5 rounded-lg border border-[#c4a882]/25 bg-[rgba(255,252,246,0.9)] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
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
