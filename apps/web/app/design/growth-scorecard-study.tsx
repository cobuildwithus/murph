import {
  GrowthScorecard,
  type GrowthScorecardProps,
} from "../(dashboard)/ops/growth/growth-scorecard";

const STUDY_INPUT = {
  activeUsers: {
    trailing30Days: 143,
    trailing7Days: 87,
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
    trailing7Days: 0,
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

export function GrowthScorecardStudy() {
  return (
    <div
      className="flex flex-col gap-8 rounded-2xl border border-border bg-background p-4 sm:p-8"
      data-design-study="ops-weekly-growth-compass"
      id="ops-weekly-growth-compass"
    >
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
