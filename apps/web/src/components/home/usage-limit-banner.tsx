import Link from "next/link";
import { ArrowRight, Gauge } from "lucide-react";

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
    action: "Upgrade",
    body:
      "Your trial assistant usage is used up. Upgrade to keep Murph replying now.",
    title: "Trial usage is used up",
  },
};

export function UsageLimitBanner({ noticeCode }: UsageLimitBannerProps) {
  const copy = usageLimitBannerCopy[noticeCode] ?? usageLimitBannerCopy.pulse_upgrade_edge;

  return (
    <section
      aria-label="Usage limit"
      className="rounded-xl border border-[#c4a882]/35 bg-[rgba(255,252,246,0.92)] p-6 sm:p-7"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-[#c4a882]/35 bg-[#f5f0e8] text-[#5a6e32]">
            <Gauge className="size-5" aria-hidden="true" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Monthly allowance
            </p>
            <h2 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
              {copy.title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {copy.body}
            </p>
          </div>
        </div>

        <Link
          href="/settings"
          className="inline-flex w-fit items-center gap-2.5 rounded-2xl bg-[#5a6e32] px-5 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7a8c6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2"
        >
          {copy.action}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
