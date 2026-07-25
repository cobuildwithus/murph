interface GrowthScorecardProps {
  activeMembers: {
    trailing7Days: number;
    wowPercent: number | null;
  };
  conversion: {
    converted: number;
    matureStarted: number;
    percent: number | null;
  };
  mrrUsdCents: number;
  mrrWowPercent: number | null;
  newMembers: {
    trailing7Days: number;
    wowPercent: number | null;
  };
  payingCustomers: number;
  payingCustomersWowPercent: number | null;
  trialStarts: {
    trailing7Days: number;
    wowPercent: number | null;
  };
  titleId?: string;
  usageTopUps: {
    totalFulfilled: number;
  };
}

export function GrowthScorecard(input: GrowthScorecardProps) {
  const titleId = input.titleId ?? "growth-compass-title";

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/80">
        <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <div className="px-5 py-6 sm:px-7 sm:py-7">
            <h2
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
              id={titleId}
            >
              MRR growth per week
            </h2>
            <div
              className={`mt-3 font-serif text-5xl font-semibold leading-none tracking-tight tabular-nums sm:text-6xl ${
                mrrTargetTone(input.mrrWowPercent)
              }`}
            >
              {formatGrowthRate(input.mrrWowPercent)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-1 font-mono text-[9px] font-medium uppercase tracking-[0.11em] ${
                  mrrTargetBadgeTone(input.mrrWowPercent)
                }`}
              >
                {mrrTargetStatus(input.mrrWowPercent)}
              </span>
              {input.mrrWowPercent === null ? null : (
                <span className="text-xs leading-5 text-muted-foreground">
                  Closest daily snapshot from six to eight days ago
                </span>
              )}
            </div>
            <div className="mt-6 grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-2">
              <SupportingRevenueMetric
                label="Current MRR"
                value={formatCurrency(input.mrrUsdCents)}
              />
              <SupportingRevenueMetric
                label="Fulfilled top-ups · lifetime"
                value={formatInteger(input.usageTopUps.totalFulfilled)}
              />
            </div>
          </div>

          <div className="grid border-t border-border/70 sm:grid-cols-2 lg:grid-cols-1 lg:border-l lg:border-t-0">
            <GrowthSignal
              detail={`${formatInteger(input.payingCustomers)} paying now`}
              label="Paying customer growth"
              value={formatGrowthRate(input.payingCustomersWowPercent)}
            />
            <GrowthSignal
              className="border-t border-border/60 sm:border-l sm:border-t-0 lg:border-l-0 lg:border-t"
              detail={`${formatInteger(input.activeMembers.trailing7Days)} direct members messaged`}
              helper="Usage pulse, not a retention cohort"
              label="Weekly active member growth"
              value={formatGrowthRate(input.activeMembers.wowPercent)}
            />
          </div>
        </div>

        <div className="border-t border-border/70">
          <div className="px-5 py-3 sm:px-7">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Funnel checks
            </span>
          </div>
          <div className="grid border-t border-border/60 md:grid-cols-3">
            <FunnelCheck
              detail={formatWindowChange(input.newMembers.wowPercent)}
              label="Acquire"
              unit="new members"
              value={formatInteger(input.newMembers.trailing7Days)}
            />
            <FunnelCheck
              className="border-t border-border/60 md:border-l md:border-t-0"
              detail={formatWindowChange(input.trialStarts.wowPercent)}
              label="Activate"
              unit="trial starts"
              value={formatInteger(input.trialStarts.trailing7Days)}
            />
            <FunnelCheck
              className="border-t border-border/60 md:border-l md:border-t-0"
              detail={input.conversion.percent === null
                ? "No mature cohort"
                : `${formatInteger(input.conversion.converted)} of ${formatInteger(
                  input.conversion.matureStarted,
                )} mature trials`}
              label="Monetize"
              value={input.conversion.percent === null
                ? "N/A"
                : formatPercent(input.conversion.percent)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function SupportingRevenueMetric(input: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </span>
      <span className="font-serif text-2xl font-semibold tabular-nums text-foreground">
        {input.value}
      </span>
    </div>
  );
}

function GrowthSignal(input: {
  className?: string;
  detail: string;
  helper?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={`px-5 py-5 sm:px-6 ${input.className ?? ""}`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-2 font-serif text-2xl font-semibold leading-none tabular-nums text-foreground">
        {input.value}
      </div>
      <div className="mt-2 text-sm text-foreground">{input.detail}</div>
      {input.helper ? (
        <div className="mt-1 text-xs leading-5 text-muted-foreground">
          {input.helper}
        </div>
      ) : null}
    </div>
  );
}

function FunnelCheck(input: {
  className?: string;
  detail: string;
  label: string;
  unit?: string;
  value: string;
}) {
  return (
    <div className={`px-5 py-4 sm:px-7 ${input.className ?? ""}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-foreground">
        <span className="font-serif text-xl font-semibold tabular-nums">
          {input.value}
        </span>
        {input.unit ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            {input.unit}
          </span>
        ) : null}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {input.detail}
      </div>
    </div>
  );
}

function mrrTargetTone(value: number | null): string {
  if (value === null) {
    return "text-muted-foreground";
  }

  return roundGrowthRate(value) >= 10 ? "text-primary" : "text-red-700";
}

function mrrTargetBadgeTone(value: number | null): string {
  if (value === null) {
    return "border-border text-muted-foreground";
  }

  return roundGrowthRate(value) >= 10
    ? "border-primary/30 bg-primary/10 text-primary"
    : "border-red-700/30 bg-red-700/10 text-red-700";
}

function mrrTargetStatus(value: number | null): string {
  if (value === null) {
    return "No weekly baseline";
  }

  return roundGrowthRate(value) >= 10
    ? "10% target hit"
    : "Below 10% target";
}

function formatGrowthRate(value: number | null): string {
  if (value === null) {
    return "N/A";
  }

  const roundedValue = roundGrowthRate(value);
  const prefix = roundedValue > 0 ? "+" : "";
  return `${prefix}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(roundedValue)}%`;
}

function roundGrowthRate(value: number): number {
  const roundedValue = Math.round(value * 10) / 10;
  return Object.is(roundedValue, -0) ? 0 : roundedValue;
}

function formatWindowChange(value: number | null): string {
  if (value === null) {
    return "No prior-week baseline";
  }

  return `${formatGrowthRate(value)} versus the prior seven days`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(valueUsdCents: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(valueUsdCents / 100);
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "No mature cohort";
  }

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

export type { GrowthScorecardProps };
