"use client";

import type {
  BrowserVaultDeviceMetricSummary,
  BrowserVaultLabBiomarkerDetail,
  BrowserVaultMeasuredBiomarker,
  BrowserVaultPresentedLabResultRow,
} from "@murphai/query/browser-biomarkers";

import {
  BiomarkerDetailContent,
  BiomarkerDetailShell,
  EmptyBiomarkerDetailCard,
} from "@/src/components/biomarkers/lab-biomarker-detail-view";
import {
  BiomarkerListSkeleton,
  DeviceMetricsSection,
  MeasuredBiomarkerSection,
  type DeviceMetricListItem,
  type MeasuredBiomarkerGroup,
} from "@/app/(dashboard)/biomarkers/biomarkers-page-client";
import {
  PrivateRunResultsView,
  PrivateRunRouteState,
} from "@/app/(dashboard)/experiments/runs/[experimentId]/private-run-results-client";
import {
  BiomarkerPrivateTrendCardView,
  type BiomarkerPrivateTrendState,
} from "@/src/components/biomarkers/biomarker-detail/biomarker-private-trend-card";
import { BiomarkerDetailSkeleton } from "@/src/components/biomarkers/lab-biomarker-detail-skeleton";
import {
  ResultsSummary,
  ResultsSummarySkeleton,
} from "@/src/components/experiments/experiment-detail/results-summary";
import { PageHeader } from "@/src/components/ui/page-header";
import type {
  ExperimentRunProjection,
  ExperimentSignal,
} from "@/src/types/experiments";

const DESIGN_SIGNAL: ExperimentSignal = {
  baseline: "62 ms baseline",
  delta: "+6 ms",
  direction: "up",
  expected: "Higher recovery signal",
  label: "Recovery variability",
  sentiment: "positive",
  unit: "ms",
  value: "68",
};

const DESIGN_PRIVATE_RUN: ExperimentRunProjection = {
  baselineDays: 3,
  durationDays: 10,
  id: "design-private-run",
  outcomeConfidence: "medium",
  outcomeStatus: "available",
  signals: [DESIGN_SIGNAL],
  slug: "design-private-run",
  snapshotGeneratedAt: "2026-08-01T12:00:00.000Z",
  source: "browser-vault",
  startedOn: "2026-07-20",
  status: "finished",
  statusLabel: "Completed",
  summary: "The synthetic recovery signal moved above its baseline.",
  tags: ["synthetic"],
  timeline: [],
  timingKnown: true,
  title: "Evening wind-down practice",
  trends: [],
};

const DESIGN_TREND_READY: BiomarkerPrivateTrendState = {
  comparison: null,
  context: [],
  latest: {
    confidence: "high",
    date: "2026-08-01",
    sourceLabel: "Synthetic wearable",
    value: 68,
  },
  series: [
    { date: "2026-07-26", value: 61 },
    { date: "2026-07-27", value: 63 },
    { date: "2026-07-28", value: 62 },
    { date: "2026-07-29", value: 65 },
    { date: "2026-07-30", value: 66 },
    { date: "2026-07-31", value: 67 },
    { date: "2026-08-01", value: 68 },
  ],
  stale: false,
  status: "ready",
};

const DESIGN_DEVICE_SUMMARY: BrowserVaultDeviceMetricSummary = {
  firstDate: "2026-07-26",
  latest: {
    confidence: "high",
    date: "2026-08-01",
    sourceLabel: "Synthetic wearable",
    unit: "ms",
    value: 68,
  },
  metricKey: "design-recovery-variability",
  readingCount: 7,
  stale: false,
};

const DESIGN_DEVICE_ITEMS: DeviceMetricListItem[] = [
  {
    entry: {
      category: "Recovery",
      privateMetricBindings: [{
        metricKey: "design-recovery-variability",
        role: "primary",
      }],
      routeId: "design-recovery-variability",
      shortName: "HRV",
      summary: "Synthetic example.",
      unit: "ms",
      valuePrecision: 0,
    },
    summary: DESIGN_DEVICE_SUMMARY,
  },
];

const DESIGN_LAB_BIOMARKER: BrowserVaultMeasuredBiomarker = {
  biomarkerKey: "design-ferritin",
  displayName: "Ferritin",
  firstDate: "2026-05-01",
  healthArea: { id: "nutrients", label: "Nutrients & fatty acids" },
  lastDate: "2026-08-01",
  latest: {
    analyte: "Ferritin",
    biomarkerKey: "design-ferritin",
    comparator: null,
    date: "2026-08-01",
    flag: "normal",
    id: "design-ferritin-result",
    labName: "Synthetic lab",
    metricKey: "design-ferritin",
    normalizedReferenceRange: { high: 150, low: 20 },
    normalizedUnit: "ng/mL",
    normalizedValue: 74,
    observedAt: "2026-08-01T08:00:00.000Z",
    referenceRange: { high: 150, low: 20 },
    rowSchema: "murph.browser-vault.lab-result-row.v1",
    sourceLabel: "Synthetic lab result",
    specimenKind: "serum",
    statusSource: "reporting_lab_flag",
    textValue: null,
    unit: "ng/mL",
    value: 74,
  },
  metricKey: "design-ferritin",
  resultCount: 2,
};

const DESIGN_LAB_GROUP: MeasuredBiomarkerGroup = {
  id: "nutrients",
  items: [DESIGN_LAB_BIOMARKER],
  label: "Nutrients & fatty acids",
};

const DESIGN_LAB_ROWS: readonly BrowserVaultPresentedLabResultRow[] = [
  {
    ...DESIGN_LAB_BIOMARKER.latest,
    date: "2025-11-01",
    id: "design-ferritin-result-2025",
    normalizedValue: 58,
    observedAt: "2025-11-01T08:00:00.000Z",
    value: 58,
  },
  {
    ...DESIGN_LAB_BIOMARKER.latest,
    date: "2026-05-01",
    id: "design-ferritin-result-2026-05",
    normalizedValue: 68,
    observedAt: "2026-05-01T08:00:00.000Z",
    value: 68,
  },
  DESIGN_LAB_BIOMARKER.latest,
];

const DESIGN_LAB_DETAIL: BrowserVaultLabBiomarkerDetail = {
  biomarkerKey: "design-ferritin",
  chartSeries: DESIGN_LAB_ROWS.map((row) => ({
    date: row.date,
    observedAt: row.observedAt,
    rowId: row.id,
    unit: "ng/mL",
    value: row.normalizedValue ?? row.value ?? 0,
  })),
  comparableUnit: "ng/mL",
  displayName: "Ferritin",
  hasIncompatibleHistory: false,
  latest: DESIGN_LAB_BIOMARKER.latest,
  metricKey: "design-ferritin",
  rows: [...DESIGN_LAB_ROWS],
};

const noopRetry = async () => undefined;

function StudyState({
  children,
  label,
  state,
}: {
  children: React.ReactNode;
  label: string;
  state: string;
}) {
  return (
    <div
      className="min-w-0 space-y-4 rounded-2xl border border-border bg-background p-5 sm:p-7"
      data-design-state={state}
    >
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function TransitionStudy({
  children,
  description,
  title,
  transition,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
  transition: string;
}) {
  return (
    <section className="space-y-5" data-design-transition={transition}>
      <header className="max-w-3xl space-y-2">
        <h3 className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h3>
        <p className="text-sm leading-6 text-muted-foreground sm:text-base">
          {description}
        </p>
      </header>
      {children}
    </section>
  );
}

export function BrowserVaultLoadingTransitionsStudy() {
  return (
    <div
      className="space-y-12"
      data-design-section="browser-vault-loading-transitions"
      id="browser-vault-loading-transitions"
      inert
    >
      <TransitionStudy
        description="The measured-change skeleton keeps the final summary's hierarchy and width while private metric buckets arrive."
        title="Experiment summary"
        transition="experiment-summary"
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <StudyState label="Loading" state="loading">
            <ResultsSummarySkeleton />
          </StudyState>
          <StudyState label="Content" state="content">
            <ResultsSummary signals={[DESIGN_SIGNAL]} trends={[]} />
          </StudyState>
        </div>
      </TransitionStudy>

      <TransitionStudy
        description="The private run route keeps an explicit wait, recovery state, and saved result without exposing member data."
        title="Private experiment route"
        transition="private-experiment"
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <StudyState label="Loading" state="loading">
            <PrivateRunRouteState error={null} loading onRetry={noopRetry} />
          </StudyState>
          <StudyState label="Error" state="error">
            <PrivateRunRouteState
              error="This synthetic private experiment could not be opened."
              loading={false}
              onRetry={noopRetry}
            />
          </StudyState>
          <StudyState label="Result" state="result">
            <PrivateRunResultsView
              error={null}
              onRetry={noopRetry}
              privateRun={DESIGN_PRIVATE_RUN}
              status="ready"
            />
          </StudyState>
        </div>
      </TransitionStudy>

      <TransitionStudy
        description="The private trend reserves the chart footprint, then replaces it with the same production metric view."
        title="Biomarker trend"
        transition="biomarker-trend"
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <StudyState label="Loading" state="loading">
            <BiomarkerPrivateTrendCardView
              biomarker={{ shortName: "recovery variability", unit: "ms", valuePrecision: 0 }}
              onRetry={noopRetry}
              trend={{ status: "loading" }}
            />
          </StudyState>
          <StudyState label="Data" state="data">
            <BiomarkerPrivateTrendCardView
              biomarker={{ shortName: "recovery variability", unit: "ms", valuePrecision: 0 }}
              onRetry={noopRetry}
              trend={DESIGN_TREND_READY}
            />
          </StudyState>
        </div>
      </TransitionStudy>

      <TransitionStudy
        description="The list can reveal saved labs before the requested wearable bucket finishes, without treating the missing device rows as empty data."
        title="Biomarkers list"
        transition="biomarkers-list"
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <StudyState label="Loading" state="loading">
            <PageHeader title="Biomarkers" />
            <BiomarkerListSkeleton />
          </StudyState>
          <StudyState label="Labs ready" state="labs-ready">
            <PageHeader title="Biomarkers" />
            <MeasuredBiomarkerSection group={DESIGN_LAB_GROUP} />
          </StudyState>
          <div className="xl:col-span-2">
            <StudyState label="Wearable + labs" state="complete">
              <PageHeader title="Biomarkers" />
              <DeviceMetricsSection items={DESIGN_DEVICE_ITEMS} />
              <MeasuredBiomarkerSection group={DESIGN_LAB_GROUP} />
            </StudyState>
          </div>
        </div>
      </TransitionStudy>

      <TransitionStudy
        description="The private result route reserves the latest reading, chart, and year-grouped ledger while loading, then keeps usable saved results or the empty state quiet during automatic refresh."
        title="Biomarker result detail"
        transition="biomarker-result-detail"
      >
        <StudyState label="Loading" state="loading">
          <BiomarkerDetailSkeleton />
        </StudyState>
        <StudyState label="Stale saved result" state="stale-populated">
          <BiomarkerDetailShell
            chatAction={null}
            detail={DESIGN_LAB_DETAIL}
            summary="Synthetic iron-storage marker history for layout review."
          >
            <BiomarkerDetailContent detail={DESIGN_LAB_DETAIL} fallbackRanges={[]} />
          </BiomarkerDetailShell>
        </StudyState>
        <StudyState label="Refreshing saved result" state="refresh-pending-populated">
          <BiomarkerDetailShell
            chatAction={null}
            detail={DESIGN_LAB_DETAIL}
            summary="Synthetic iron-storage marker history for layout review."
          >
            <BiomarkerDetailContent detail={DESIGN_LAB_DETAIL} fallbackRanges={[]} />
          </BiomarkerDetailShell>
        </StudyState>
        <StudyState label="Stale empty result" state="stale-empty">
          <BiomarkerDetailShell chatAction={null} detail={null} summary={null}>
            <EmptyBiomarkerDetailCard
              authRequired={false}
              preparing={false}
              uploadLabsAction={null}
            />
          </BiomarkerDetailShell>
        </StudyState>
      </TransitionStudy>
    </div>
  );
}
