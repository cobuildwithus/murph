import { ArrowRight } from "lucide-react";
import Link from "next/link";
import {
  HOSTED_ADD_USAGE_SETTINGS_URL,
  type HostedPlanUsageRecommendedAction,
} from "@murphai/hosted-execution/plan-usage";

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
  "group_upgrade_pulse",
  "max_usage_limit_reached",
  "pulse_upgrade_edge",
]);

const familyUsageRecoveryAction = {
  kind: "add_usage",
  label: "Add usage",
  url: HOSTED_ADD_USAGE_SETTINGS_URL,
} satisfies HostedPlanUsageRecommendedAction;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const usageLimitBannerCopy: Record<
  Exclude<HostedAiUsageGateNoticeCode, "thread_usage_limit_reached">,
  {
    body: string;
    title: string;
  }
> = {
  edge_usage_limit_reached: {
    body: "Murph is paused until your included usage resets.",
    title: "You've used 100% of this month's included Edge usage",
  },
  family_usage_limit_reached: {
    body: "Murph is paused until more usage is added or your allowance resets.",
    title: "You've used 100% of your included usage this month",
  },
  group_upgrade_pulse: {
    body: "Murph is paused until your included usage resets.",
    title: "You've used 100% of this month's included Core usage",
  },
  max_usage_limit_reached: {
    body: "Murph is paused until your included usage resets.",
    title: "You've used 100% of this month's included Max usage",
  },
  pulse_upgrade_edge: {
    body: "Murph is paused until your included usage resets.",
    title: "You've used 100% of this month's included Pulse usage",
  },
  starter_usage_limit_reached: {
    body: "Murph is paused because your starter usage is exhausted.",
    title: "You've used 100% of your starter usage",
  },
};

export function UsageLimitBanner({
  noticeCode,
  now,
  recommendedAction,
  resetAt,
}: UsageLimitBannerProps) {
  if (noticeCode === "thread_usage_limit_reached") {
    return null;
  }

  const copy = usageLimitBannerCopy[noticeCode] ?? usageLimitBannerCopy.pulse_upgrade_edge;
  const resetLabel = formatUsageResetCountdown({ noticeCode, now, resetAt });
  const action = recommendedAction
    ?? (noticeCode === "family_usage_limit_reached"
      ? familyUsageRecoveryAction
      : null);
  const body = action?.kind === "add_usage" && noticeCode !== "family_usage_limit_reached"
    ? "Murph is paused until you add usage or your allowance resets."
    : copy.body;
  const actionBody = action?.kind === "start_pulse"
    ? " Start Pulse to continue."
    : action?.kind === "upgrade_edge"
      ? " Edge offers more included usage."
      : action?.kind === "change_plan"
        ? action.targetPlanCode === "launch_group_monthly"
          ? " Core keeps you connected with lighter private Murph usage."
          : action.targetPlanCode === "launch_monthly"
            ? " Pulse includes more private Murph usage."
            : " Edge offers more included usage."
        : "";

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
          {body}{actionBody}
        </p>
      </div>

      {action ? (
        <Link
          href={action.url}
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-2xl bg-[#5a6e32] px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7a8c6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 sm:self-center"
        >
          {action.label}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
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
