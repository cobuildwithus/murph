import type { HostedPlanUsageRecommendedAction } from "@murphai/hosted-execution/plan-usage";

import { UpgradeToEdgeButton } from "@/src/components/settings/hosted-plan-upgrade-button";
import { StartPaidPulseButton } from "@/src/components/settings/hosted-start-paid-pulse-button";
import type { HostedAiUsageGateNoticeCode } from "@/src/lib/hosted-execution/usage-allowance";

interface UsageLimitBannerProps {
  noticeCode: HostedAiUsageGateNoticeCode;
  now?: Date | null;
  recommendedAction?: HostedPlanUsageRecommendedAction | null;
  resetAt?: Date | null;
}

const resettableMonthlyNoticeCodes = new Set<HostedAiUsageGateNoticeCode>([
  "edge_usage_limit_reached",
  "family_usage_limit_reached",
  "thread_usage_limit_reached",
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const usageLimitBannerCopy: Record<
  HostedAiUsageGateNoticeCode,
  {
    body: string;
    title: string;
  }
> = {
  edge_usage_limit_reached: {
    body: "Murph will start replying again when your plan resets.",
    title: "You've hit this month's limit",
  },
  family_usage_limit_reached: {
    body: "Murph will start replying again when your Family usage resets.",
    title: "You've hit this month's Family limit",
  },
  hosted_access_inactive: {
    body: "Hosted AI access is inactive right now.",
    title: "Murph replies are paused",
  },
  thread_usage_limit_reached: {
    body: "Murph will start replying in this chat again when its included usage resets.",
    title: "This chat has hit its monthly limit",
  },
  trial_conversion_pending: {
    body: "Hosted replies are paused because the trial has ended.",
    title: "Your trial just ended",
  },
  trial_usage_limit_reached: {
    body: "Hosted replies are paused because the included trial usage is used.",
    title: "Your trial credits are used up",
  },
};

export function UsageLimitBanner({
  noticeCode,
  now,
  recommendedAction = null,
  resetAt,
}: UsageLimitBannerProps) {
  const copy = usageLimitBannerCopy[noticeCode] ?? usageLimitBannerCopy.edge_usage_limit_reached;
  const resetLabel = formatUsageResetCountdown({ noticeCode, now, resetAt });

  return (
    <section
      aria-label={
        noticeCode === "thread_usage_limit_reached"
          ? "Chat usage notice"
          : "Account notice"
      }
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

      {recommendedAction?.kind === "upgrade_edge" ? (
        <UpgradeToEdgeButton presentation="banner">
          {recommendedAction.label}
        </UpgradeToEdgeButton>
      ) : recommendedAction?.kind === "start_pulse" ? (
        <StartPaidPulseButton presentation="banner">
          {recommendedAction.label}
        </StartPaidPulseButton>
      ) : null}
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
