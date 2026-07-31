import {
  GrowthScorecard,
  type GrowthScorecardProps,
} from "../(dashboard)/ops/growth/growth-scorecard";
import { GrowthCharts } from "../(dashboard)/ops/growth/growth-charts";

const GROWTH_DATES = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 6, index + 1));
  return date.toISOString().slice(0, 10);
});

const DAILY_MESSAGE_VOLUMES = GROWTH_DATES.map(
  (_, index) => 58 + ((index * 17) % 83),
);
const MESSAGE_TRACKING_START_INDEX = 8;
const MESSAGE_SERIES = GROWTH_DATES.map((date, index) => ({
  date,
  messagesPerDay: index < MESSAGE_TRACKING_START_INDEX
    ? null
    : DAILY_MESSAGE_VOLUMES[index] ?? 0,
  totalMessages: index < MESSAGE_TRACKING_START_INDEX
    ? null
    : 5_240 + DAILY_MESSAGE_VOLUMES
      .slice(MESSAGE_TRACKING_START_INDEX, index + 1)
      .reduce((sum, value) => sum + value, 0),
}));

const DAILY_SERIES = GROWTH_DATES.map((date, index) => ({
  date,
  newMembers: 2 + ((index * 3) % 8),
  trialStarts: 1 + ((index * 2) % 5),
}));

const SNAPSHOT_SERIES = GROWTH_DATES.map((date, index) => ({
  coveredMembers: 82 + index * 3,
  date,
  mrrUsdCents: 14_400 + index * 320,
  payingCustomers: 54 + Math.floor(index * 0.8),
  trialingMembers: 16 + (index % 7),
}));

const STUDY_INPUT = {
  activeUsers: {
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
      <div id="growth-message-volume-charts">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Thirty-day movement
        </div>
        <GrowthCharts
          dailySeries={DAILY_SERIES}
          messageSeries={MESSAGE_SERIES}
          snapshotSeries={SNAPSHOT_SERIES}
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
