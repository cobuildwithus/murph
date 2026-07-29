import {
  ResultsTab,
  type ResultsTabExperiment,
} from "@/src/components/experiments/experiment-detail/results-tab";
import type {
  ExperimentRunProjection,
  TrendData,
} from "@/src/types/experiments";

function makePrivateRun(
  input: Pick<
    ExperimentRunProjection,
    "id" | "outcomeKind" | "structuredReviewStatus" | "title" | "trends"
  >,
): ExperimentRunProjection {
  return {
    ...input,
    outcomeStatus: "available",
    signals: [],
    slug: input.id,
    snapshotGeneratedAt: "2026-04-15T12:00:00.000Z",
    source: "browser-vault",
    startedOn: "2026-04-01",
    status: "finished",
    statusLabel: "Finished",
    tags: [],
    timeline: [],
    timingKnown: true,
  };
}

function makeExperiment(input: {
  privateRun: ExperimentRunProjection;
  summary?: string;
  summaryDetail?: string;
}): ResultsTabExperiment {
  return {
    baselineDays: 0,
    outcomeConfidence: "medium",
    privateRun: input.privateRun,
    signals: input.privateRun.signals,
    status: "finished",
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.summaryDetail === undefined
      ? {}
      : { summaryDetail: input.summaryDetail }),
    timeline: [],
    title: input.privateRun.title,
    trends: input.privateRun.trends,
  };
}

const readyReview = makeExperiment({
  privateRun: makePrivateRun({
    id: "structured-review-ready",
    outcomeKind: "structured_review",
    structuredReviewStatus: "ready_for_review",
    title: "Movement quality review",
    trends: [],
  }),
  summary: "The baseline and follow-up evidence are ready to review.",
  summaryDetail:
    "Murph kept the evidence together without converting a qualitative observation into a numeric effect.",
});

const missingReview = makeExperiment({
  privateRun: makePrivateRun({
    id: "structured-review-missing",
    outcomeKind: "structured_review",
    structuredReviewStatus: "missing",
    title: "Movement quality review",
    trends: [],
  }),
  summary: "The review still needs baseline and follow-up evidence.",
  summaryDetail:
    "Add both planned observations before reviewing the result. The experiment remains saved.",
});

const supportingMetricTrend: TrendData = {
  active: [],
  baseline: [],
  baselineAvg: 61,
  currentValue: 59,
  delta: "-2 bpm",
  history: [],
  label: "Resting heart rate",
  startDate: "2026-04-01",
  statistic: "mean",
  unit: "bpm",
  windowComparison: {
    baselineDaysWithData: 3,
    baselineTotalDays: 3,
    interventionDaysWithData: 3,
    interventionTotalDays: 3,
  },
};

const partialReview = makeExperiment({
  privateRun: makePrivateRun({
    id: "structured-review-partial",
    outcomeKind: "structured_review",
    structuredReviewStatus: "baseline_only",
    title: "Movement quality review",
    trends: [supportingMetricTrend],
  }),
  summary: "The review still needs follow-up evidence.",
  summaryDetail:
    "The baseline is saved. Add the planned follow-up observation before reviewing the result.",
});

function makeMetricExperiment(input: {
  baseline: number;
  current: number;
  label: string;
  statistic: NonNullable<TrendData["statistic"]>;
  unit: string;
}): ResultsTabExperiment {
  const trend: TrendData = {
    active: [],
    baseline: [],
    baselineAvg: input.baseline,
    currentValue: input.current,
    delta: `+${input.current - input.baseline}${input.unit ? ` ${input.unit}` : ""}`,
    history: [],
    label: input.label,
    startDate: "2026-04-01",
    statistic: input.statistic,
    unit: input.unit,
    windowComparison: {
      baselineDaysWithData: 3,
      baselineTotalDays: 3,
      interventionDaysWithData: 3,
      interventionTotalDays: 3,
    },
  };
  const privateRun = makePrivateRun({
    id: `metric-${input.statistic}`,
    outcomeKind: "metric",
    title: input.label,
    trends: [trend],
  });
  return makeExperiment({ privateRun });
}

const maximumResult = makeMetricExperiment({
  baseline: 7,
  current: 9,
  label: "Response score",
  statistic: "max",
  unit: "points",
});

const countResult = makeMetricExperiment({
  baseline: 3,
  current: 5,
  label: "Symptom-free days",
  statistic: "count",
  unit: "",
});

function StudyState({
  experiment,
  state,
}: {
  experiment: ResultsTabExperiment;
  state: string;
}) {
  return (
    <div data-design-state={state} id={state} inert>
      <ResultsTab
        experiment={experiment}
        privateRunError={null}
        privateRunStatus="ready"
      />
    </div>
  );
}

export function StructuredReviewResultsStudy() {
  return (
    <div
      className="flex flex-col gap-16"
      data-design-section="structured-review-results"
      id="structured-review-results"
      inert
    >
      <StudyState experiment={readyReview} state="structured-review-ready" />
      <StudyState experiment={missingReview} state="structured-review-missing" />
      <StudyState experiment={partialReview} state="structured-review-partial" />
      <StudyState experiment={maximumResult} state="metric-result-maximum" />
      <StudyState experiment={countResult} state="metric-result-count" />
    </div>
  );
}
