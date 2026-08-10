import {
  buildHostedGrowthMessageSeries,
  type HostedGrowthMessageSnapshot,
} from "@/src/lib/hosted-ops/growth-message-series";
import {
  buildHostedGrowthMonthlyRevenueSeries,
} from "@/src/lib/hosted-ops/growth-monthly-revenue-series";
import type { HostedGrowthDashboard } from "@/src/lib/hosted-ops/growth-metrics";
import type { HostedGrowthSponsorshipMetrics } from "@/src/lib/hosted-ops/growth-sponsorship-metrics";
import {
  GrowthScorecard,
  type GrowthScorecardProps,
} from "../(dashboard)/ops/growth/growth-scorecard";
import { GrowthCharts } from "../(dashboard)/ops/growth/growth-charts";
import { GrowthSponsorships } from "../(dashboard)/ops/growth/growth-sponsorships";
import { GrowthWeeklyTable } from "../(dashboard)/ops/growth/growth-weekly-table";
import { ReferralLinkUsage } from "../(dashboard)/ops/growth/referral-link-usage";
import { TrialStartAttribution } from "../(dashboard)/ops/growth/trial-start-attribution";

const GROWTH_DATES = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 6, index + 1));
  return date.toISOString().slice(0, 10);
});

const DAILY_MESSAGE_VOLUMES = GROWTH_DATES.map(
  (_, index) => index === 14 ? 0 : 58 + ((index * 17) % 83),
);
const MESSAGE_TRACKING_START_INDEX = 8;
const MISSING_TRACKED_MESSAGE_INDEX = 24;
const MESSAGE_SNAPSHOTS = GROWTH_DATES
  .slice(MESSAGE_TRACKING_START_INDEX - 1)
  .flatMap((messageDate, relativeIndex) => {
    const messageIndex = relativeIndex + MESSAGE_TRACKING_START_INDEX - 1;
    if (messageIndex === MISSING_TRACKED_MESSAGE_INDEX) {
      return [];
    }
    const snapshotDate = new Date(`${messageDate}T00:00:00.000Z`);
    snapshotDate.setUTCDate(snapshotDate.getUTCDate() + 1);
    const messages = DAILY_MESSAGE_VOLUMES[messageIndex] ?? 0;
    const trackingAvailable = messageIndex >= MESSAGE_TRACKING_START_INDEX;
    const activityIndex = messageIndex - 10;
    const activeUsersTrailing7Days = activityIndex >= 0 && activityIndex !== 13
      ? 68 + activityIndex * 2
      : null;

    return [{
      activeUsersPriorDay: activeUsersTrailing7Days === null
        ? null
        : activityIndex === 8
          ? activeUsersTrailing7Days
          : 12 + ((activityIndex * 5) % 17),
      activeUsersTrailing7Days,
      inboundMessagesPriorDay: trackingAvailable
        ? Math.floor(messages * 0.45)
        : null,
      outboundMessagesPriorDay: trackingAvailable
        ? messages - Math.floor(messages * 0.45)
        : null,
      snapshotDate,
    } satisfies HostedGrowthMessageSnapshot];
  });
const MESSAGE_SERIES = buildHostedGrowthMessageSeries({
  messagesBeforeSeries: 5_240,
  snapshots: MESSAGE_SNAPSHOTS,
  trackingEstablishedBeforeSeries: false,
  windowEnd: new Date("2026-07-31T12:00:00.000Z"),
});

const DAILY_SERIES = GROWTH_DATES.map((date, index) => ({
  date,
  newMembers: 2 + ((index * 3) % 8),
  trialStarts: 1 + ((index * 2) % 5),
}));

const REFERRAL_LINK_DAILY_SERIES = GROWTH_DATES.map((date, index) => {
  const claims = index % 6 === 0
    ? 4
    : index % 4 === 0
      ? 2
      : index % 3 === 0
        ? 1
        : 0;
  return {
    activatedClaims: claims === 0 || index % 5 === 0
      ? 0
      : Math.max(1, claims - 1),
    claims,
    date,
  };
});
const REFERRAL_LINK_CLAIMS = REFERRAL_LINK_DAILY_SERIES.reduce(
  (sum, point) => sum + point.claims,
  0,
);
const REFERRAL_LINK_ACTIVATED_CLAIMS = REFERRAL_LINK_DAILY_SERIES.reduce(
  (sum, point) => sum + point.activatedClaims,
  0,
);
const REFERRAL_LINK_USAGE = {
  activatedClaims: REFERRAL_LINK_ACTIVATED_CLAIMS,
  activationRatePercent:
    (REFERRAL_LINK_ACTIVATED_CLAIMS / REFERRAL_LINK_CLAIMS) * 100,
  activeReferrers: 18,
  claims: REFERRAL_LINK_CLAIMS,
  dailySeries: REFERRAL_LINK_DAILY_SERIES,
} satisfies HostedGrowthDashboard["referralLinkUsage"];

const SNAPSHOT_SERIES = GROWTH_DATES.map((date, index) => ({
  coveredMembers: 82 + index * 3,
  date,
  mrrUsdCents: 14_400 + index * 320,
  payingCustomers: 54 + Math.floor(index * 0.8),
  trialingMembers: 16 + (index % 7),
}));

// March has purchase cash but no snapshot, so its total is withheld; April
// predates the subscription split columns, so it renders as one unsplit
// subscription value; February has no data and is trimmed; July is the
// window-end month, so it renders as month to date.
const MONTHLY_REVENUE_SERIES = buildHostedGrowthMonthlyRevenueSeries({
  monthCount: 6,
  purchases: [
    {
      cashAmountMinor: 800,
      isGroupSponsorship: false,
      paidAt: new Date("2026-03-12T15:00:00.000Z"),
    },
    {
      cashAmountMinor: 1_000,
      isGroupSponsorship: false,
      paidAt: new Date("2026-04-19T16:20:00.000Z"),
    },
    {
      cashAmountMinor: 2_000,
      isGroupSponsorship: false,
      paidAt: new Date("2026-05-11T09:05:00.000Z"),
    },
    {
      cashAmountMinor: 500,
      isGroupSponsorship: true,
      paidAt: new Date("2026-05-27T21:40:00.000Z"),
    },
    {
      cashAmountMinor: 1_500,
      isGroupSponsorship: true,
      paidAt: new Date("2026-07-03T12:00:00.000Z"),
    },
    {
      cashAmountMinor: 1_000,
      isGroupSponsorship: false,
      paidAt: new Date("2026-07-14T18:30:00.000Z"),
    },
    {
      cashAmountMinor: 1_500,
      isGroupSponsorship: false,
      paidAt: new Date("2026-07-24T07:55:00.000Z"),
    },
  ],
  snapshots: [
    {
      familyMrrUsdCents: null,
      individualMrrUsdCents: null,
      mrrUsdCents: 6_200,
      snapshotDate: new Date("2026-04-28T00:00:00.000Z"),
    },
    {
      familyMrrUsdCents: 2_100,
      individualMrrUsdCents: 7_000,
      mrrUsdCents: 9_100,
      snapshotDate: new Date("2026-05-30T00:00:00.000Z"),
    },
    {
      familyMrrUsdCents: 3_200,
      individualMrrUsdCents: 9_600,
      mrrUsdCents: 12_800,
      snapshotDate: new Date("2026-06-29T00:00:00.000Z"),
    },
    {
      familyMrrUsdCents: 3_300,
      individualMrrUsdCents: 10_600,
      mrrUsdCents: 13_900,
      snapshotDate: new Date("2026-07-15T00:00:00.000Z"),
    },
    {
      familyMrrUsdCents: 4_300,
      individualMrrUsdCents: 11_800,
      mrrUsdCents: 16_100,
      snapshotDate: new Date("2026-07-30T00:00:00.000Z"),
    },
  ],
  windowEnd: new Date("2026-07-31T12:00:00.000Z"),
});

const TRIAL_START_ATTRIBUTION = {
  counts: {
    companion_onboarding: 8,
    linq_instant_start: 5,
    unknown: 3,
    web_onboarding: 11,
  },
  recent: [
    {
      memberCreatedAt: "2026-07-31T14:08:00.000Z",
      phoneHint: "*** 0194",
      pulseTrialStartSource: "linq_instant_start",
      trialStartedAt: "2026-07-31T14:09:00.000Z",
    },
    {
      memberCreatedAt: "2026-07-12T09:20:00.000Z",
      phoneHint: null,
      pulseTrialStartSource: "companion_onboarding",
      trialStartedAt: "2026-07-30T17:42:00.000Z",
    },
    {
      memberCreatedAt: "2026-07-29T11:15:00.000Z",
      phoneHint: "*** 4827",
      pulseTrialStartSource: "web_onboarding",
      trialStartedAt: "2026-07-29T11:21:00.000Z",
    },
    {
      memberCreatedAt: "2026-06-18T18:00:00.000Z",
      phoneHint: null,
      pulseTrialStartSource: "unknown",
      trialStartedAt: "2026-07-28T13:05:00.000Z",
    },
  ],
  windowStartDate: "2026-07-02",
} satisfies HostedGrowthDashboard["trialStartAttribution"];

const EMPTY_TRIAL_START_ATTRIBUTION = {
  counts: {
    companion_onboarding: 0,
    linq_instant_start: 0,
    unknown: 0,
    web_onboarding: 0,
  },
  recent: [],
  windowStartDate: "2026-07-02",
} satisfies HostedGrowthDashboard["trialStartAttribution"];

const WEEKLY_ROWS: HostedGrowthDashboard["weeklyRows"] = [
  {
    endDate: "2026-07-31",
    newMembers: 34,
    newMembersWowPercent: 13.3,
    startDate: "2026-07-25",
    trialStarts: 23,
    trialStartsWowPercent: 9.5,
  },
  {
    endDate: "2026-07-24",
    newMembers: 30,
    newMembersWowPercent: null,
    startDate: "2026-07-18",
    trialStarts: 21,
    trialStartsWowPercent: null,
  },
];

const SPONSORSHIP_METRICS = {
  activeMonthlyCapUsdCents: 3_000,
  activeMonthlySponsorships: 2,
  available: true,
  monthlyPaidPurchasesThisMonth: 3,
  monthlyPaidThisMonthUsdCents: 1_500,
  oneTimePaidPurchasesThisMonth: 1,
  oneTimePaidThisMonthUsdCents: 2_000,
  paidPurchasesThisMonth: 4,
  paidThisMonthUsdCents: 3_500,
  remainingUsageUsdMicros: 11_750_000,
  usageConsumedThisMonthUsdMicros: 4_250_000,
} satisfies HostedGrowthSponsorshipMetrics;

const UNAVAILABLE_SPONSORSHIP_METRICS = {
  available: false,
} satisfies HostedGrowthSponsorshipMetrics;

const STUDY_INPUT = {
  activeUsers: {
    today: 22,
    todayComplete: true,
    trailing30Days: 143,
    trailing30DaysComplete: true,
    trailing7Days: 87,
    trailing7DaysComplete: true,
    wowComparisonComplete: true,
    wowPercent: 8.8,
  },
  conversion: {
    converted: 18,
    matureStarted: 42,
    percent: 42.9,
  },
  mrrUsdCents: 18_600,
  newMembers: {
    trailing7Days: 34,
    wowPercent: 13.3,
  },
  payingCustomers: 71,
  payingCustomersWowPercent: 5.9,
  trialStarts: {
    trailing7Days: 23,
    wowPercent: 9.5,
  },
  usageTopUps: {
    trackedFulfilled: 12,
  },
} satisfies Omit<GrowthScorecardProps, "mrrWowPercent">;

const NO_SUPPORTING_BASELINES_INPUT = {
  ...STUDY_INPUT,
  activeUsers: {
    today: 0,
    todayComplete: true,
    trailing30Days: 0,
    trailing30DaysComplete: true,
    trailing7Days: 0,
    trailing7DaysComplete: true,
    wowComparisonComplete: true,
    wowPercent: null,
  },
  conversion: {
    converted: 0,
    matureStarted: 0,
    percent: null,
  },
  newMembers: {
    trailing7Days: 0,
    wowPercent: null,
  },
  mrrUsdCents: 0,
  payingCustomers: 0,
  payingCustomersWowPercent: null,
  trialStarts: {
    trailing7Days: 0,
    wowPercent: null,
  },
} satisfies Omit<GrowthScorecardProps, "mrrWowPercent">;

const PARTIAL_MAU_INPUT = {
  ...STUDY_INPUT,
  activeUsers: {
    today: 22,
    todayComplete: true,
    trailing30Days: 119,
    trailing30DaysComplete: false,
    trailing7Days: 87,
    trailing7DaysComplete: true,
    wowComparisonComplete: true,
    wowPercent: 8.8,
  },
} satisfies Omit<GrowthScorecardProps, "mrrWowPercent">;

const PARTIAL_WEEKLY_INPUT = {
  ...STUDY_INPUT,
  activeUsers: {
    today: 19,
    todayComplete: false,
    trailing30Days: 119,
    trailing30DaysComplete: false,
    trailing7Days: 82,
    trailing7DaysComplete: false,
    wowComparisonComplete: false,
    wowPercent: null,
  },
} satisfies Omit<GrowthScorecardProps, "mrrWowPercent">;

export function GrowthScorecardStudy() {
  return (
    <div
      className="flex flex-col gap-8 rounded-2xl border border-border bg-background p-4 sm:p-8"
      data-design-study="ops-weekly-growth-compass"
      id="ops-weekly-growth-compass"
    >
      <div id="growth-charts">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Thirty-day movement
        </div>
        <GrowthCharts
          dailySeries={DAILY_SERIES}
          messageSeries={MESSAGE_SERIES}
          monthlyRevenueSeries={MONTHLY_REVENUE_SERIES}
          snapshotSeries={SNAPSHOT_SERIES}
        />
      </div>
      <div id="growth-referral-link-usage">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Signup referral funnel
        </div>
        <ReferralLinkUsage
          titleId="design-growth-referral-link-usage-title"
          usage={REFERRAL_LINK_USAGE}
        />
      </div>
      <div id="growth-trial-start-attribution">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Trial start provenance
        </div>
        <TrialStartAttribution
          attribution={TRIAL_START_ATTRIBUTION}
          titleId="design-trial-start-attribution-title"
        />
      </div>
      <div id="growth-trial-start-attribution-empty">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Empty trial start provenance
        </div>
        <TrialStartAttribution
          attribution={EMPTY_TRIAL_START_ATTRIBUTION}
          titleId="design-empty-trial-start-attribution-title"
        />
      </div>
      <div id="growth-sponsorships">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Group sponsorship accounting
        </div>
        <GrowthSponsorships
          metrics={SPONSORSHIP_METRICS}
          titleId="design-growth-sponsorship-title"
        />
      </div>
      <div id="growth-sponsorships-unavailable">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Group sponsorship telemetry unavailable
        </div>
        <GrowthSponsorships
          metrics={UNAVAILABLE_SPONSORSHIP_METRICS}
          titleId="design-growth-sponsorship-unavailable-title"
        />
      </div>
      <div id="growth-weekly-intake-and-activation">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Weekly intake semantics
        </div>
        <GrowthWeeklyTable
          rows={WEEKLY_ROWS}
          titleId="design-growth-weekly-title"
        />
      </div>
      <StudyState id="target-hit" label="Target hit" mrrWowPercent={10.8} />
      <StudyState id="below-target" label="Below target" mrrWowPercent={6.2} />
      <StudyState
        id="no-mrr-baseline"
        label="No MRR baseline"
        mrrWowPercent={null}
      />
      <StudyState
        id="no-supporting-baselines"
        input={NO_SUPPORTING_BASELINES_INPUT}
        label="No supporting baselines"
        mrrWowPercent={null}
      />
      <StudyState
        id="partial-mau-history"
        input={PARTIAL_MAU_INPUT}
        label="Partial MAU history"
        mrrWowPercent={6.2}
      />
      <StudyState
        id="partial-weekly-history"
        input={PARTIAL_WEEKLY_INPUT}
        label="Partial weekly history"
        mrrWowPercent={6.2}
      />
    </div>
  );
}

function StudyState(input: {
  id: string;
  input?: Omit<GrowthScorecardProps, "mrrWowPercent" | "titleId">;
  label: string;
  mrrWowPercent: number | null;
}) {
  return (
    <div>
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </div>
      <GrowthScorecard
        {...(input.input ?? STUDY_INPUT)}
        mrrWowPercent={input.mrrWowPercent}
        titleId={`growth-compass-${input.id}`}
      />
    </div>
  );
}
