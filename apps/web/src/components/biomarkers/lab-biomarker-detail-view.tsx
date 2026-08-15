"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import type { BiomarkerFallbackRangeForDisplay } from "@murphai/health-commons/biomarker-fallback-ranges";
import {
  type BrowserVaultLabBiomarkerDetail,
  type BrowserVaultPresentedLabResultRow,
} from "@murphai/query/browser-biomarkers";

import {
  LabBiomarkerHistoryChart,
  type LabBiomarkerChartPoint,
  type LabBiomarkerChartRange,
  type LabBiomarkerReferenceRangeTone,
} from "@/src/components/biomarkers/lab-biomarker-history-chart";
import { LabResultValue } from "@/src/components/biomarkers/lab-result-value";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { AuthButton } from "@/src/components/ui/auth-button";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import {
  formatLabDate,
  formatLabFlag,
  formatLabNumber,
  formatLabResultReferenceRange,
  formatLabUnit,
  labUnitSuffix,
  labResultYear,
} from "@/src/lib/biomarkers/lab-result-display";
import { cn } from "@/src/lib/utils";

interface LabResultYearGroup {
  rows: BrowserVaultPresentedLabResultRow[];
  year: string;
}

export function BiomarkerDetailShell({
  chatAction,
  children,
  detail,
  summary,
}: {
  chatAction: ReactNode;
  children: ReactNode;
  detail: BrowserVaultLabBiomarkerDetail | null;
  summary: string | null;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <BackToBiomarkersLink />
        <header>
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
            {detail?.displayName ?? "Biomarker history"}
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
            {detail
              ? summary ?? formatDetailSummary(detail)
              : "Review your saved results for one lab biomarker over time."}
          </p>
          {detail && summary ? (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {formatDetailSummary(detail)}
            </p>
          ) : null}
          {chatAction ? <div className="mt-5">{chatAction}</div> : null}
        </header>
      </div>
      {children}
    </div>
  );
}

export function BiomarkerDetailContent({
  detail,
  fallbackRanges,
}: {
  detail: BrowserVaultLabBiomarkerDetail;
  fallbackRanges: readonly BiomarkerFallbackRangeForDisplay[];
}) {
  const yearGroups = groupRowsByYear(detail.rows);
  const chartPoints: LabBiomarkerChartPoint[] = detail.chartSeries.map((point) => ({
    date: point.date,
    id: point.rowId,
    value: point.value,
  }));
  const latestStatus = resolveLatestResultStatus(detail.latest.flag);
  const latestReferenceRange = formatLabResultReferenceRange(detail.latest);
  const chartReference = resolveChartedReferenceContext(
    detail,
    fallbackRanges,
    latestReferenceRange,
  );

  return (
    <>
      <section
        aria-labelledby="biomarker-latest-result-heading"
        className="overflow-hidden rounded-xl border border-border/70 bg-card/70"
      >
        <div className={cn(
          "grid",
          chartPoints.length > 0
            && "lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]",
        )}>
          <div className={cn(
            "px-5 py-8 sm:px-8 sm:py-10",
            chartPoints.length > 0 && "lg:border-r lg:border-border/70",
          )}>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Latest reading
            </p>
            <h2
              className={cn(
                "mt-4 text-xl font-semibold tracking-tight",
                latestStatus.tone === "in-range" && "text-primary",
                latestStatus.tone === "review" && "text-destructive",
                latestStatus.tone === "reported" && "text-foreground",
              )}
              id="biomarker-latest-result-heading"
            >
              {latestStatus.label}
            </h2>
            <div className="mt-3 flex min-w-0 items-baseline gap-3">
              <span
                aria-hidden="true"
                className={latestStatus.tone === "in-range"
                  ? "size-3 shrink-0 self-center rounded-full bg-primary/80"
                  : latestStatus.tone === "review"
                    ? "size-3 shrink-0 self-center rounded-full bg-destructive/80"
                    : "size-3 shrink-0 self-center rounded-full bg-muted-foreground/70"}
              />
              <LabResultValue
                presentation="hero"
                result={detail.latest}
              />
            </div>
            <time
              className="mt-4 block text-sm text-muted-foreground"
              dateTime={detail.latest.date}
            >
              {formatLabDate(detail.latest.date)}
            </time>
            {statusSourceLabel(detail.latest.statusSource, true) ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {statusSourceLabel(detail.latest.statusSource, true)}
              </p>
            ) : null}
          </div>

          {chartPoints.length > 0 ? (
            <div className="min-w-0 border-t border-border/70 px-5 py-8 sm:px-8 sm:py-10 lg:border-t-0">
              <div className="min-w-0">
                <LabBiomarkerHistoryChart
                  displayName={detail.displayName}
                  points={chartPoints}
                  referenceRange={chartReference?.range}
                  referenceRangeLabel={chartReference?.label}
                  referenceRangeSourceLabel={chartReference?.sourceLabel}
                  referenceRangeTitle={chartReference?.title}
                  referenceRangeTone={chartReference?.tone}
                  unit={detail.comparableUnit}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="biomarker-history-heading" className="flex flex-col gap-6">
        <div>
          <h2
            className="font-serif text-2xl font-semibold tracking-tight text-foreground"
            id="biomarker-history-heading"
          >
            All results
          </h2>
        </div>

        <div className="flex flex-col gap-8">
          {yearGroups.map((group) => (
            <LabResultYearSection group={group} key={group.year} />
          ))}
        </div>
      </section>
    </>
  );
}

export function BiomarkerStaleRefreshAlert({
  hasResults,
  onRefresh,
}: {
  hasResults: boolean;
  onRefresh: () => void;
}) {
  return (
    <Alert>
      <AlertTitle>This history may be out of date</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {hasResults
              ? "These are your last saved results and may not include newer lab data."
              : "This saved view may not include newer lab data. Refresh to check again."}
          </span>
          <Button onClick={onRefresh} size="sm" variant="outline">
            Refresh
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function resolveLatestResultStatus(flag: string | null): {
  label: string;
  tone: "in-range" | "reported" | "review";
} {
  const normalized = flag?.trim().toLowerCase() ?? "";
  switch (normalized) {
    case "":
      return { label: "Reported", tone: "reported" };
    case "normal":
      return { label: "In range", tone: "in-range" };
    case "high":
      return { label: "Above range", tone: "review" };
    case "low":
      return { label: "Below range", tone: "review" };
    case "abnormal":
    case "unknown":
      return { label: "Review", tone: "review" };
    default:
      return { label: formatLabFlag(normalized), tone: "review" };
  }
}

function LabResultYearSection({ group }: { group: LabResultYearGroup }) {
  const headingId = `lab-results-${group.year}`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3
        className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground"
        id={headingId}
      >
        {group.year}
      </h3>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/90">
        <div
          aria-hidden="true"
          className="hidden grid-cols-[8rem_minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_minmax(10rem,1fr)] gap-4 border-b border-border/60 bg-muted/20 px-5 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground xl:grid"
        >
          <span>Date</span>
          <span>Result</span>
          <span>Reference range</span>
          <span>Source</span>
        </div>

        <ol>
          {group.rows.map((row) => {
            const referenceRange = formatLabResultReferenceRange(row);
            const source = row.labName ?? row.sourceLabel;

            return (
              <li
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 border-b border-border/60 px-4 py-4 last:border-b-0 sm:px-5 xl:grid-cols-[8rem_minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_minmax(10rem,1fr)] xl:gap-4"
                key={row.id}
              >
                <div className="order-1 min-w-0 xl:order-none">
                  <span className="sr-only">Result</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words font-serif text-lg font-semibold tabular-nums text-foreground">
                      <LabResultValue result={row} />
                    </span>
                    {row.flag ? (
                      <Badge variant="outline">{formatLabFlag(row.flag)}</Badge>
                    ) : null}
                  </div>
                </div>
                <div className="order-2 min-w-0 justify-self-end xl:-order-1 xl:justify-self-start">
                  <span className="sr-only">Date</span>
                  <time
                    className="block text-sm text-muted-foreground xl:font-medium xl:text-foreground"
                    dateTime={row.date}
                  >
                    {formatLabDate(row.date)}
                  </time>
                </div>
                <div className="order-3 col-span-2 flex min-w-0 flex-wrap gap-x-1 text-xs text-muted-foreground xl:contents">
                  <p className="break-words whitespace-normal xl:min-w-0 xl:text-sm">
                    <span className="sr-only">Reference range</span>
                    {referenceRange ? (
                      <>
                        <span aria-hidden="true" className="xl:hidden">Range </span>
                        {referenceRange}
                      </>
                    ) : row.statusSource === "published_comparator" ? (
                      "Published comparator — not the reporting lab's range"
                    ) : (
                      "No reference range"
                    )}
                    <span aria-hidden="true" className="xl:hidden"> ·</span>
                  </p>
                  <p className="break-words whitespace-normal xl:min-w-0 xl:text-sm">
                    <span className="sr-only">Source</span>
                    {source ?? "Source not listed"}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function statusSourceLabel(
  source: BrowserVaultPresentedLabResultRow["statusSource"],
  latest: boolean,
): string | null {
  switch (source) {
    case "published_comparator":
      return "Published comparator — not the reporting lab's range";
    case "reporting_lab_flag":
      return "Reporting-lab flag";
    case "reporting_lab_range":
      return latest ? "Latest lab range" : "Reporting-lab range";
    case "reported":
      return null;
  }
}

export function EmptyBiomarkerDetailCard({
  authRequired,
  preparing,
  uploadLabsAction,
}: {
  authRequired: boolean;
  preparing: boolean;
  uploadLabsAction: ReactNode;
}) {
  return (
    <Card aria-live={preparing ? "polite" : undefined} role={preparing ? "status" : undefined}>
      <CardHeader>
        <CardTitle>
          {preparing
            ? "Preparing this history"
            : authRequired
              ? "Sign in to see this biomarker"
              : "No results found"}
        </CardTitle>
        <CardDescription>
          {preparing
            ? "Murph is preparing your saved lab results."
            : authRequired
              ? "Biomarker history is private and only appears after you sign in."
              : "This biomarker is not in your saved lab history."}
        </CardDescription>
      </CardHeader>
      {!preparing ? (
        <CardContent>
          <p className="max-w-xl text-sm text-muted-foreground">
            {authRequired
              ? "Sign in before viewing or adding private health information."
              : "Return to your biomarkers, or send Murph a newer lab report."}
          </p>
        </CardContent>
      ) : null}
      {!preparing && authRequired ? (
        <CardFooter><AuthButton>Sign in</AuthButton></CardFooter>
      ) : !preparing && uploadLabsAction ? (
        <CardFooter>{uploadLabsAction}</CardFooter>
      ) : null}
    </Card>
  );
}

function BackToBiomarkersLink() {
  return (
    <Link
      className="relative inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground underline-offset-4 before:absolute before:-inset-x-2 before:-inset-y-2.5 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      href="/biomarkers"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Your biomarkers
    </Link>
  );
}

function groupRowsByYear(rows: readonly BrowserVaultPresentedLabResultRow[]): LabResultYearGroup[] {
  const groups = new Map<string, LabResultYearGroup>();

  for (const row of rows.slice().reverse()) {
    const year = labResultYear(row.date);
    const existing = groups.get(year);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(year, { rows: [row], year });
    }
  }

  return [...groups.values()];
}

function formatDetailSummary(detail: BrowserVaultLabBiomarkerDetail): string {
  const firstDate = detail.rows[0]?.date ?? detail.latest.date;
  const span = firstDate.slice(0, 4) === detail.latest.date.slice(0, 4)
    ? firstDate.slice(0, 4)
    : `${firstDate.slice(0, 4)} to ${detail.latest.date.slice(0, 4)}`;
  return `${detail.rows.length} saved ${detail.rows.length === 1 ? "result" : "results"}, ${span}.`;
}

/**
 * The chart prefers the latest lab-reported range because older results may
 * have come from a different lab or range. Exact one-sided source limits are
 * valid context; qualified ranges that cannot be normalized stay in the
 * ledger. A sourced adult comparator is used only when the latest comparable
 * result has no lab range and the authored unit and specimen match exactly. It
 * is labeled as published context rather than the reporting lab's range.
 */
function resolveChartedReferenceContext(
  detail: BrowserVaultLabBiomarkerDetail,
  fallbackRanges: readonly BiomarkerFallbackRangeForDisplay[],
  latestReferenceRange: string | null,
): {
  label: string;
  range: LabBiomarkerChartRange;
  sourceLabel: string | null;
  title: string;
  tone: LabBiomarkerReferenceRangeTone;
} | null {
  const latestPoint = detail.chartSeries.find((point) => point.rowId === detail.latest.id);
  if (
    !latestPoint
    || detail.latest.normalizedValue !== latestPoint.value
    || formatLabUnit(detail.latest.normalizedUnit ?? "")
      !== formatLabUnit(detail.comparableUnit ?? "")
  ) {
    return null;
  }

  const normalizedRange = detail.latest.normalizedReferenceRange;
  const low = normalizedRange?.low ?? null;
  const high = normalizedRange?.high ?? null;
  if ((low !== null || high !== null) && latestReferenceRange) {
    return {
      label: latestReferenceRange,
      range: { high, low },
      sourceLabel: detail.latest.labName ?? detail.latest.sourceLabel,
      title: "Latest lab range",
      tone: "lab",
    };
  }

  // Any source-provided range text, including a qualified range that cannot
  // be normalized, blocks generic context from replacing the lab's wording.
  if (latestReferenceRange !== null || detail.comparableUnit === null) {
    return null;
  }

  const comparableUnit = formatLabUnit(detail.comparableUnit).trim();
  const fallback = fallbackRanges.find(
    (candidate) => formatLabUnit(candidate.unit).trim() === comparableUnit
      && detail.latest.specimenKind !== null
      && candidate.eligibleSpecimenKinds.includes(detail.latest.specimenKind),
  );
  if (!fallback) {
    return null;
  }

  const label = formatFallbackReferenceRange(fallback);
  if (!label) {
    return null;
  }

  return {
    label,
    range: {
      high: fallback.upperBound?.value ?? null,
      low: fallback.lowerBound?.value ?? null,
    },
    sourceLabel: `${fallback.label} · not the reporting lab's range`,
    title: "Published adult comparator",
    tone: "context",
  };
}

function formatFallbackReferenceRange(
  range: BiomarkerFallbackRangeForDisplay,
): string | null {
  const lower = range.lowerBound;
  const upper = range.upperBound;
  const unit = labUnitSuffix(range.unit);
  if (lower && upper) {
    if (lower.inclusive && upper.inclusive) {
      return `${formatLabNumber(lower.value)} to ${formatLabNumber(upper.value)}${unit}`;
    }
    const lowerComparator = lower.inclusive ? ">=" : ">";
    const upperComparator = upper.inclusive ? "<=" : "<";
    return `${lowerComparator}${formatLabNumber(lower.value)} to ${upperComparator}${formatLabNumber(upper.value)}${unit}`;
  }
  if (lower) {
    return `${lower.inclusive ? ">=" : ">"}${formatLabNumber(lower.value)}${unit}`;
  }
  if (upper) {
    return `${upper.inclusive ? "<=" : "<"}${formatLabNumber(upper.value)}${unit}`;
  }
  return null;
}
