import {
  ResultsTab,
  type ResultsTabExperiment,
} from "@/src/components/experiments/experiment-detail/results-tab";
import type { ExperimentRunProjection } from "@/src/types/experiments";

const privateRun = {
  id: "exp_structured_review_study",
  outcomeKind: "structured_review",
  outcomeStatus: "available",
  signals: [],
  slug: "structured-review-study",
  snapshotGeneratedAt: "2026-04-15T12:00:00.000Z",
  source: "browser-vault",
  startedOn: "2026-04-01",
  status: "finished",
  statusLabel: "Finished",
  tags: ["mobility"],
  timeline: [],
  timingKnown: true,
  title: "Movement quality review",
  trends: [],
} satisfies ExperimentRunProjection;

const experiment = {
  baselineDays: 0,
  outcomeConfidence: "medium",
  privateRun,
  signals: [],
  status: "finished",
  summary: "The baseline and follow-up evidence are ready to review.",
  summaryDetail:
    "Murph kept the evidence together without converting a qualitative observation into a numeric effect.",
  timeline: [],
  title: "Movement quality review",
  trends: [],
} satisfies ResultsTabExperiment;

export function StructuredReviewResultsStudy() {
  return (
    <div
      data-design-section="structured-review-results"
      id="structured-review-results"
      inert
    >
      <ResultsTab
        experiment={experiment}
        privateRunError={null}
        privateRunStatus="ready"
      />
    </div>
  );
}
