"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  useCallback,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  selectBrowserVaultLabBiomarkerDetail,
  type BrowserVaultLabBiomarkerDetail,
  type BrowserVaultLabResultRow,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser-biomarkers";

import {
  LabBiomarkerHistoryChart,
  type LabBiomarkerChartPoint,
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
import { PageHeader } from "@/src/components/ui/page-header";
import { Skeleton } from "@/src/components/ui/skeleton";
import {
  formatLabDate,
  formatLabFlag,
  formatLabReferenceRange,
  formatLabUnit,
  labResultYear,
} from "@/src/lib/biomarkers/lab-result-display";
import {
  useBrowserVault,
  useBrowserVaultSelector,
} from "@/src/lib/browser-vault/context";
import { cn } from "@/src/lib/utils";

interface LabBiomarkerDetailClientProps {
  authenticated: boolean;
  metricKey: string;
  uploadLabsAction?: ReactNode;
}

interface LabResultYearGroup {
  rows: BrowserVaultLabResultRow[];
  year: string;
}

export function LabBiomarkerDetailClient({
  authenticated,
  metricKey,
  uploadLabsAction = null,
}: LabBiomarkerDetailClientProps) {
  const {
    error,
    freshness,
    refresh,
    refreshPending,
    status,
  } = useBrowserVault();
  const selectDetail = useCallback(
    (client: BrowserVaultQueryClient) =>
      selectBrowserVaultLabBiomarkerDetail(client, metricKey),
    [metricKey],
  );
  const detail = useBrowserVaultSelector(selectDetail);
  const authRequired = !authenticated
    || (status === "error" && isAuthRequiredBrowserVaultError(error));

  let content: ReactNode;
  let visibleDetail: BrowserVaultLabBiomarkerDetail | null = null;

  if (authRequired) {
    content = (
      <EmptyBiomarkerDetailCard
        authRequired
        preparing={false}
        uploadLabsAction={null}
      />
    );
  } else if (status === "loading") {
    content = <BiomarkerDetailSkeleton />;
  } else if (status === "error") {
    content = (
      <Alert variant="destructive">
        <AlertTitle>Could not load this biomarker</AlertTitle>
        <AlertDescription>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>Your saved lab results are not available right now.</span>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  } else if (!detail) {
    content = (
      <>
        {freshness === "stale" && !refreshPending ? (
          <BiomarkerStaleAlert
            hasResults={false}
            onRefresh={() => void refresh()}
            refreshPending={refreshPending}
          />
        ) : null}
        <EmptyBiomarkerDetailCard
          authRequired={authRequired}
          preparing={refreshPending}
          uploadLabsAction={uploadLabsAction}
        />
      </>
    );
  } else {
    visibleDetail = detail;
    content = (
      <BiomarkerDetailContent
        detail={detail}
        onRefresh={() => void refresh()}
        refreshPending={refreshPending}
        stale={freshness === "stale"}
      />
    );
  }

  return (
    <BiomarkerDetailShell detail={visibleDetail}>
      {content}
    </BiomarkerDetailShell>
  );
}

function BiomarkerDetailShell({
  children,
  detail,
}: {
  children: ReactNode;
  detail: BrowserVaultLabBiomarkerDetail | null;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <BackToBiomarkersLink />
        <PageHeader
          eyebrow={detail?.healthArea.label ?? "Lab history"}
          title={detail?.displayName ?? "Biomarker history"}
          description={detail
            ? formatDetailSummary(detail)
            : "Review your saved results for one lab biomarker over time."}
        />
      </div>
      {children}
    </div>
  );
}

function BiomarkerDetailContent({
  detail,
  onRefresh,
  refreshPending,
  stale,
}: {
  detail: BrowserVaultLabBiomarkerDetail;
  onRefresh: () => void;
  refreshPending: boolean;
  stale: boolean;
}) {
  const yearGroups = groupRowsByYear(detail.rows);
  const chartPoints: LabBiomarkerChartPoint[] = detail.chartSeries.map((point) => ({
    date: point.date,
    id: point.rowId,
    value: point.value,
  }));
  const comparisonRow = detail.latestComparable?.id === detail.latest.id
    ? detail.previousComparable
    : detail.latestComparable;
  const comparisonLabel = detail.latestComparable?.id === detail.latest.id
    ? "Previous comparable"
    : "Latest comparable";
  const chartNotes = buildChartNotes(detail);

  return (
    <>
      {stale ? (
        <BiomarkerStaleAlert
          hasResults
          onRefresh={onRefresh}
          refreshPending={refreshPending}
        />
      ) : null}

      <section aria-label="Biomarker summary" className="grid border-y border-border/70 sm:grid-cols-3">
        <ResultSummaryItem
          flag={detail.latest.flag}
          label="Latest result"
          row={detail.latest}
        />
        {comparisonRow ? (
          <ResultSummaryItem
            className="border-t border-border/70 sm:border-t-0 sm:border-l sm:px-6"
            label={comparisonLabel}
            row={comparisonRow}
          />
        ) : (
          <div className="flex min-h-28 flex-col justify-center border-t border-border/70 py-5 sm:border-t-0 sm:border-l sm:px-6">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Previous comparable
            </span>
            <p className="mt-2 text-sm text-muted-foreground">No earlier comparable result</p>
          </div>
        )}
        <div className="flex min-h-28 flex-col justify-center border-t border-border/70 py-5 sm:border-t-0 sm:border-l sm:px-6">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Saved history
          </span>
          <p className="mt-2 font-serif text-2xl font-semibold tracking-tight tabular-nums text-foreground">
            {detail.rows.length} {detail.rows.length === 1 ? "result" : "results"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatHistorySpan(detail.rows)}
          </p>
        </div>
      </section>

      <section aria-labelledby="biomarker-change-heading" className="flex flex-col gap-5">
        <div>
          <h2
            className="font-serif text-2xl font-semibold tracking-tight text-foreground"
            id="biomarker-change-heading"
          >
            Change over time
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {chartPoints.length > 0 && detail.comparableUnit
              ? `${chartPoints.length} comparable numeric ${chartPoints.length === 1 ? "result" : "results"} in ${formatLabUnit(detail.comparableUnit)}.`
              : "A numeric trend is not available for these results."}
          </p>
        </div>

        {chartPoints.length > 0 ? (
          <LabBiomarkerHistoryChart
            displayName={detail.displayName}
            points={chartPoints}
            unit={detail.comparableUnit}
          />
        ) : (
          <Card size="sm">
            <CardHeader>
              <CardTitle>No comparable numeric trend</CardTitle>
              <CardDescription>
                Qualitative results, boundary values, and units that cannot be compared remain in the history below.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {chartPoints.length === 1 ? (
          <p className="text-sm text-muted-foreground">
            One comparable numeric result is available. A second comparable numeric result will show a change over time.
          </p>
        ) : null}

        {chartNotes.length > 0 ? (
          <div className="border-t border-border/70 pt-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Chart context
            </span>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              {chartNotes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="biomarker-history-heading" className="flex flex-col gap-6">
        <div>
          <h2
            className="font-serif text-2xl font-semibold tracking-tight text-foreground"
            id="biomarker-history-heading"
          >
            All results
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Values and reference ranges are shown as each lab reported them.
          </p>
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

function ResultSummaryItem({
  className,
  flag = null,
  label,
  row,
}: {
  flag?: string | null;
  label: string;
  row: BrowserVaultLabResultRow;
} & Pick<ComponentProps<"div">, "className">) {
  return (
    <div className={cn(
      "flex min-h-28 min-w-0 flex-col justify-center py-5 sm:pr-6",
      className,
    )}>
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="break-words font-serif text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          <LabResultValue result={row} />
        </p>
        {flag ? <Badge variant="outline">{formatLabFlag(flag)}</Badge> : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{formatLabDate(row.date)}</p>
    </div>
  );
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
            const referenceRange = formatLabReferenceRange(row.referenceRange, row.unit);
            const source = row.labName ?? row.sourceLabel;

            return (
              <li
                className="grid gap-4 border-b border-border/60 px-4 py-4 last:border-b-0 sm:px-5 xl:grid-cols-[8rem_minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_minmax(10rem,1fr)]"
                key={row.id}
              >
                <div className="min-w-0">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground xl:sr-only">
                    Date
                  </span>
                  <time className="mt-1 block text-sm font-medium text-foreground xl:mt-0" dateTime={row.date}>
                    {formatLabDate(row.date)}
                  </time>
                </div>
                <div className="min-w-0">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground xl:sr-only">
                    Result
                  </span>
                  <div className="mt-1 flex flex-wrap items-center gap-2 xl:mt-0">
                    <span className="break-words font-serif text-lg font-semibold tabular-nums text-foreground">
                      <LabResultValue result={row} />
                    </span>
                    {row.flag ? (
                      <Badge variant="outline">{formatLabFlag(row.flag)}</Badge>
                    ) : null}
                  </div>
                </div>
                <div className="min-w-0">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground xl:sr-only">
                    Reference range
                  </span>
                  <p className="mt-1 break-words text-sm whitespace-normal text-muted-foreground xl:mt-0">
                    {referenceRange ?? "Not supplied"}
                  </p>
                </div>
                <div className="min-w-0">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground xl:sr-only">
                    Source
                  </span>
                  <p className="mt-1 break-words text-sm whitespace-normal text-muted-foreground xl:mt-0">
                    {source ?? "Not listed"}
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

function EmptyBiomarkerDetailCard({
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

function BiomarkerStaleAlert({
  hasResults,
  onRefresh,
  refreshPending,
}: {
  hasResults: boolean;
  onRefresh: () => void;
  refreshPending: boolean;
}) {
  return (
    <Alert aria-live="polite">
      <AlertTitle>
        {refreshPending ? "Refreshing this history" : "This history may be out of date"}
      </AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {refreshPending
              ? hasResults
                ? "Your last saved results remain visible while Murph checks for newer data."
                : "Murph is checking for newer saved results."
              : hasResults
                ? "These are your last saved results and may not include newer lab data."
                : "This saved view may not include newer lab data. Refresh to check again."}
          </span>
          <Button
            disabled={refreshPending}
            onClick={onRefresh}
            size="sm"
            variant="outline"
          >
            {refreshPending ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function BiomarkerDetailSkeleton() {
  return (
    <div aria-label="Loading biomarker history" className="flex flex-col gap-8" role="status">
      <div className="grid gap-4 border-y border-border/70 py-5 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div className="flex flex-col gap-3" key={item}>
            <Skeleton className="h-3 w-24 motion-reduce:animate-none" />
            <Skeleton className="h-8 w-32 motion-reduce:animate-none" />
            <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
      <Skeleton className="h-80 w-full motion-reduce:animate-none" />
      <span className="sr-only">Loading this biomarker&apos;s saved results.</span>
    </div>
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

function groupRowsByYear(rows: readonly BrowserVaultLabResultRow[]): LabResultYearGroup[] {
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

function formatHistorySpan(rows: readonly BrowserVaultLabResultRow[]): string {
  const first = rows[0]?.date;
  const last = rows.at(-1)?.date;
  if (!first || !last) return "No dated results";
  return first.slice(0, 4) === last.slice(0, 4)
    ? first.slice(0, 4)
    : `${first.slice(0, 4)} to ${last.slice(0, 4)}`;
}

function buildChartNotes(detail: BrowserVaultLabBiomarkerDetail): string[] {
  const notes: string[] = [];
  const comparatorCount = detail.rows.filter((row) => row.comparator !== null).length;
  const qualitativeCount = detail.rows.filter((row) =>
    row.value === null && row.textValue !== null
  ).length;

  if (comparatorCount > 0) {
    notes.push(`${comparatorCount} ${comparatorCount === 1 ? "result was" : "results were"} reported as a limit and ${comparatorCount === 1 ? "is" : "are"} kept in history rather than plotted as an exact value.`);
  }
  if (qualitativeCount > 0) {
    notes.push(`${qualitativeCount} qualitative ${qualitativeCount === 1 ? "result is" : "results are"} shown in history but not on the numeric chart.`);
  }
  if (detail.hasIncompatibleHistory) {
    notes.push("Results in units that could not be compared are kept in history; no single numeric series includes them.");
  }

  return notes;
}

function isAuthRequiredBrowserVaultError(error: string | null): boolean {
  const normalized = error?.toLowerCase() ?? "";
  return normalized.includes("sign in")
    || normalized.includes("auth_required")
    || normalized.includes("unauthorized")
    || normalized.includes("session expired");
}
