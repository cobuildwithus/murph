interface GrowthScorecardProps {
  activeUsers: {
    today: number;
    todayComplete: boolean;
    trailing30Days: number;
    trailing30DaysComplete: boolean;
    trailing7Days: number;
    trailing7DaysComplete: boolean;
    wowComparisonComplete: boolean;
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
    trackedFulfilled: number;
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
                helper="Recurring subscriptions only; sponsorship stays separate"
                label="Current MRR"
                value={formatCurrency(input.mrrUsdCents)}
              />
              <SupportingRevenueMetric
                helper="Retained history + new fulfillments"
                label="Tracked fulfilled top-ups"
                value={formatInteger(input.usageTopUps.trackedFulfilled)}
              />
            </div>
          </div>

          <div className="grid border-t border-border/70 sm:grid-cols-3 lg:grid-cols-1 lg:border-l lg:border-t-0">
            <GrowthSignal
              detail="Unique senders whose messages Murph received since 00:00 UTC"
              helper={formatTodayActiveUserDefinition(input.activeUsers)}
              label="Messaged Murph today"
              value={formatTodayActiveUsers(input.activeUsers)}
            />
            <GrowthSignal
              className="border-t border-border/60 sm:border-l sm:border-t-0 lg:border-l-0 lg:border-t"
              detail={formatMonthlyActiveUsers(input.activeUsers)}
              helper={formatActiveUserChange(input.activeUsers)}
              label="Messaged Murph · last 7 days"
              value={formatWeeklyActiveUsers(input.activeUsers)}
            />
            <GrowthSignal
              className="border-t border-border/60 sm:border-l sm:border-t-0 lg:border-l-0 lg:border-t"
              detail={`${formatInteger(input.payingCustomers)} paying now`}
              label="Paying customer growth"
              value={formatGrowthRate(input.payingCustomersWowPercent)}
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
              label="Records"
              unit="member records created"
              value={formatInteger(input.newMembers.trailing7Days)}
            />
            <FunnelCheck
              className="border-t border-border/60 md:border-l md:border-t-0"
              detail={formatWindowChange(input.trialStarts.wowPercent)}
              label="Activate"
              unit="starter activations"
              value={formatInteger(input.trialStarts.trailing7Days)}
            />
            <FunnelCheck
              className="border-t border-border/60 md:border-l md:border-t-0"
              detail={input.conversion.percent === null
                ? "No mature cohort"
                : `${formatInteger(input.conversion.converted)} of ${formatInteger(
                  input.conversion.matureStarted,
                )} mature starter activations`}
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
  helper?: string;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {input.label}
        </span>
        <span className="font-serif text-2xl font-semibold tabular-nums text-foreground">
          {input.value}
        </span>
      </div>
      {input.helper ? (
        <div className="mt-1 text-xs leading-5 text-muted-foreground">
          {input.helper}
        </div>
      ) : null}
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

function formatMonthlyActiveUsers(
  activeUsers: GrowthScorecardProps["activeUsers"],
): string {
  const prefix = activeUsers.trailing30DaysComplete ? "" : "At least ";
  return `${prefix}${formatInteger(activeUsers.trailing30Days)} MAU across personal + group chats`;
}

function formatWeeklyActiveUsers(
  activeUsers: GrowthScorecardProps["activeUsers"],
): string {
  const prefix = activeUsers.trailing7DaysComplete ? "" : "At least ";
  return `${prefix}${formatInteger(activeUsers.trailing7Days)}`;
}

function formatTodayActiveUsers(
  activeUsers: GrowthScorecardProps["activeUsers"],
): string {
  const prefix = activeUsers.todayComplete ? "" : "At least ";
  return `${prefix}${formatInteger(activeUsers.today)}`;
}

function formatTodayActiveUserDefinition(
  activeUsers: GrowthScorecardProps["activeUsers"],
): string {
  const definition =
    "Each retained distinct sender counts once when Murph receives a message in the UTC window, across personal + group chats";
  return activeUsers.todayComplete
    ? definition
    : `Today is a lower bound because group sender evidence was intentionally retired · ${definition}`;
}

function formatActiveUserChange(
  activeUsers: GrowthScorecardProps["activeUsers"],
): string {
  const activityDefinition =
    "Each retained distinct sender counts once when Murph receives a message in the UTC window, across personal + group chats";

  if (!activeUsers.wowComparisonComplete) {
    return `Prior-week comparison unavailable because older group sender evidence was intentionally retired · ${activityDefinition}`;
  }

  const monthlyHistory =
    activeUsers.trailing30DaysComplete
      ? ""
      : "MAU is a lower bound because older group sender evidence was intentionally retired · ";

  if (activeUsers.wowPercent === null) {
    return `${monthlyHistory}No prior-week WAU baseline · ${activityDefinition}`;
  }

  return `${formatGrowthRate(activeUsers.wowPercent)} WAU versus the prior seven days · ${monthlyHistory}${activityDefinition}`;
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
