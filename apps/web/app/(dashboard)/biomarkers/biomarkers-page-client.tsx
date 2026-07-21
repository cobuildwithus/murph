"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useCallback, type ReactNode } from "react";
import {
  selectBrowserVaultDeviceMetricSummary,
  selectBrowserVaultMeasuredBiomarkers,
  type BrowserVaultBiomarkerMetricBinding,
  type BrowserVaultDeviceMetricSummary,
  type BrowserVaultMeasuredBiomarker,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser-biomarkers";

import { LabResultValue } from "@/src/components/biomarkers/lab-result-value";
import { BiomarkerDeviceReadingCard } from "@/src/components/biomarkers/biomarker-device-reading-card";
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
  useBrowserVault,
  useBrowserVaultSelector,
} from "@/src/lib/browser-vault/context";
import {
  formatLabDate,
  formatLabFlag,
  labUnitSuffix,
} from "@/src/lib/biomarkers/lab-result-display";
import { formatMetricValue } from "@/src/lib/browser-vault/trend-comparison";

export interface DeviceTrackedBiomarker {
  category: string | null;
  privateMetricBindings: readonly BrowserVaultBiomarkerMetricBinding[];
  routeId: string;
  shortName: string;
  summary: string | null;
  unit: string;
  valuePrecision: number;
}

interface DeviceMetricListItem {
  entry: DeviceTrackedBiomarker;
  summary: BrowserVaultDeviceMetricSummary;
}

interface BiomarkersPageClientProps {
  authenticated: boolean;
  deviceBiomarkers?: readonly DeviceTrackedBiomarker[];
  uploadLabsAction?: ReactNode;
}

interface MeasuredBiomarkerGroup {
  id: string;
  items: BrowserVaultMeasuredBiomarker[];
  label: string;
}

export function BiomarkersPageClient({
  authenticated,
  deviceBiomarkers = [],
  uploadLabsAction = null,
}: BiomarkersPageClientProps) {
  const {
    error,
    freshness,
    refresh,
    refreshPending,
    status,
  } = useBrowserVault();
  const biomarkers = useBrowserVaultSelector(selectBrowserVaultMeasuredBiomarkers) ?? [];
  const selectDeviceMetrics = useCallback(
    (client: BrowserVaultQueryClient) => selectDeviceMetricItems(client, deviceBiomarkers),
    [deviceBiomarkers],
  );
  const deviceMetrics = useBrowserVaultSelector(selectDeviceMetrics) ?? [];
  const savedLabResultCount = useBrowserVaultSelector(countSavedLabResults) ?? 0;
  const groups = groupMeasuredBiomarkers(biomarkers);
  const authRequired = !authenticated
    || (status === "error" && isAuthRequiredBrowserVaultError(error));
  const preparing = authenticated && refreshPending;
  const totalCount = biomarkers.length + deviceMetrics.length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          eyebrow="Health data"
          title="Your biomarkers"
          description="Recognized biomarkers from your devices and saved lab results, organized by health area."
        />
        {authenticated && totalCount > 0 ? (
          <p className="text-sm tabular-nums text-muted-foreground">
            {totalCount} {totalCount === 1 ? "biomarker" : "biomarkers"}
          </p>
        ) : null}
      </div>

      {authenticated && status === "loading" ? <BiomarkerListSkeleton /> : null}

      {authenticated && status === "error" && !authRequired ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load your biomarkers</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>Your saved lab results are not available right now.</span>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {authenticated && !authRequired && freshness === "stale"
        && status !== "loading" && status !== "error"
        && (savedLabResultCount > 0 || !refreshPending) ? (
        <Alert aria-live="polite">
          <AlertTitle>
            {refreshPending ? "Refreshing your lab history" : "Your lab history may be out of date"}
          </AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {refreshPending
                  ? savedLabResultCount > 0
                    ? "Your saved results remain available while Murph checks for newer data."
                    : "Murph is checking for newer saved lab results."
                  : savedLabResultCount > 0
                    ? "These are the last saved results. Refresh to check for newer data."
                    : "No lab results are available in this saved view. Refresh to check for newer data."}
              </span>
              <Button
                disabled={refreshPending}
                onClick={() => void refresh()}
                size="sm"
                variant="outline"
              >
                {refreshPending ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {authenticated && !authRequired && deviceMetrics.length > 0 ? (
        <DeviceMetricsSection items={deviceMetrics} />
      ) : null}

      {(authRequired || status === "empty" || status === "ready")
        && (!authenticated
          || totalCount === 0
          || (biomarkers.length === 0 && savedLabResultCount > 0)) ? (
        <EmptyBiomarkersState
          authRequired={authRequired}
          hasSavedLabResults={savedLabResultCount > 0}
          preparing={authenticated && preparing}
          stale={freshness === "stale"}
          uploadLabsAction={uploadLabsAction}
        />
      ) : null}

      {authenticated && groups.length > 0 ? (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <MeasuredBiomarkerSection key={group.id} group={group} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Only biomarkers with an actual device-derived reading appear: the summary
 * selector filters to wearable provenance, so manual entries and lab values
 * can never render, count, or decide staleness under this heading.
 */
function selectDeviceMetricItems(
  client: BrowserVaultQueryClient,
  deviceBiomarkers: readonly DeviceTrackedBiomarker[],
): DeviceMetricListItem[] {
  return deviceBiomarkers.flatMap((entry) => {
    const binding = entry.privateMetricBindings.find((candidate) => candidate.role === "primary")
      ?? entry.privateMetricBindings[0];
    if (!binding) {
      return [];
    }

    const summary = selectBrowserVaultDeviceMetricSummary(client, binding.metricKey);
    if (!summary) {
      return [];
    }

    return [{ entry, summary } satisfies DeviceMetricListItem];
  });
}

function countSavedLabResults(client: BrowserVaultQueryClient): number {
  return client.labResults.list().length;
}

function DeviceMetricsSection({ items }: { items: DeviceMetricListItem[] }) {
  return (
    <section aria-labelledby="biomarker-devices-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2
          className="font-serif text-xl font-semibold tracking-tight text-foreground"
          id="biomarker-devices-heading"
        >
          From your devices
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {items.length} {items.length === 1 ? "metric" : "metrics"}
        </span>
      </div>

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li className="min-w-0" key={item.entry.routeId}>
            <DeviceMetricCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeviceMetricCard({ item }: { item: DeviceMetricListItem }) {
  const { entry, summary } = item;

  return (
    <BiomarkerDeviceReadingCard
      category={entry.category}
      date={summary.latest.date}
      dateLabel={formatLabDate(summary.latest.date)}
      historyLabel={formatDeviceSpan(summary)}
      readingCount={summary.readingCount}
      routeId={entry.routeId}
      stale={summary.stale}
      summary={entry.summary}
      title={entry.shortName}
      valueLabel={`${formatMetricValue(summary.latest.value, entry.valuePrecision)}${labUnitSuffix(summary.latest.unit ?? entry.unit)}`}
    />
  );
}

function formatDeviceSpan(summary: BrowserVaultDeviceMetricSummary): string {
  const firstYear = summary.firstDate.slice(0, 4);
  const lastYear = summary.latest.date.slice(0, 4);
  return firstYear === lastYear ? firstYear : `${firstYear} to ${lastYear}`;
}

function MeasuredBiomarkerSection({ group }: { group: MeasuredBiomarkerGroup }) {
  const headingId = `biomarker-area-${group.id}`;

  return (
    <details
      aria-labelledby={headingId}
      className="group overflow-hidden rounded-xl border border-border/70 bg-card/70"
    >
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        <h2
          className="min-w-0 flex-1 font-serif text-xl font-semibold tracking-tight text-foreground"
          id={headingId}
        >
          {group.label}
        </h2>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {group.items.length} {group.items.length === 1 ? "biomarker" : "biomarkers"}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
          strokeWidth={1.75}
        />
      </summary>

      <ul className="grid gap-px border-t border-border/70 bg-border/70 md:grid-cols-2">
        {group.items.map((biomarker) => (
          <li
            className="min-w-0 bg-card"
            key={biomarker.metricKey}
          >
            <MeasuredBiomarkerRow biomarker={biomarker} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function MeasuredBiomarkerRow({
  biomarker,
}: {
  biomarker: BrowserVaultMeasuredBiomarker;
}) {
  const historyLabel = formatHistorySpan(biomarker);
  const flag = biomarker.latest.flag?.trim() ?? null;

  return (
    <Link
      className="group flex min-h-20 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4 sm:px-5"
      href={`/biomarkers/results/${encodeURIComponent(biomarker.metricKey)}`}
    >
      <div className="min-w-0 flex-1">
        <h3 className="break-words font-serif text-lg font-semibold tracking-tight text-foreground">
          {biomarker.displayName}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {biomarker.resultCount} {biomarker.resultCount === 1 ? "result" : "results"}
          <span aria-hidden="true"> · </span>
          {historyLabel}
        </p>
      </div>

      <div className="flex min-w-0 max-w-[55%] flex-col items-end text-right">
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {flag ? (
            <Badge variant="outline">
              {formatLabFlag(flag)}
            </Badge>
          ) : null}
          <span className="break-words font-serif text-xl font-semibold tracking-tight tabular-nums text-foreground">
            <LabResultValue result={biomarker.latest} />
          </span>
        </span>
        <time
          className="mt-1 block text-xs text-muted-foreground"
          dateTime={biomarker.lastDate}
        >
          {formatLabDate(biomarker.lastDate)}
        </time>
      </div>

      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground"
        strokeWidth={1.75}
      />
    </Link>
  );
}

function EmptyBiomarkersState({
  authRequired,
  hasSavedLabResults,
  preparing,
  stale,
  uploadLabsAction,
}: {
  authRequired: boolean;
  hasSavedLabResults: boolean;
  preparing: boolean;
  stale: boolean;
  uploadLabsAction: ReactNode;
}) {
  return (
    <Card aria-live={preparing ? "polite" : undefined} role={preparing ? "status" : undefined}>
      <CardHeader>
        <CardTitle>
          {preparing
            ? "Preparing your lab history"
            : authRequired
              ? "Sign in to see your biomarkers"
              : hasSavedLabResults
                ? "No recognized lab biomarkers yet"
              : stale
                ? "No saved lab results in this view"
                : "No lab results yet"}
        </CardTitle>
        <CardDescription>
          {preparing
            ? "Murph is preparing your saved lab results."
            : authRequired
              ? "Your biomarker history is private and only appears after you sign in."
              : hasSavedLabResults
                ? "Your saved lab records remain available, but none are classified for this index yet."
              : stale
                ? "Refresh to check for newer data, or send Murph a lab report."
                : "Send Murph a lab report to start building your history."}
        </CardDescription>
      </CardHeader>
      {!preparing ? (
        <>
          <CardContent>
            <p className="max-w-xl text-sm text-muted-foreground">
              {authRequired
                ? "Sign in before viewing or adding private health information."
                : "Murph will keep each measured biomarker together so future results can be compared over time."}
            </p>
          </CardContent>
          {authRequired ? (
            <CardFooter>
              <AuthButton>Sign in</AuthButton>
            </CardFooter>
          ) : uploadLabsAction ? (
            <CardFooter>{uploadLabsAction}</CardFooter>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function BiomarkerListSkeleton() {
  return (
    <div aria-label="Loading biomarkers" className="flex flex-col gap-3" role="status">
      {[0, 1].map((group) => (
        <div
          className="flex min-h-16 items-center gap-4 rounded-xl border border-border/70 bg-card/70 px-4 py-3 sm:px-5"
          key={group}
        >
          <Skeleton className="h-6 min-w-0 flex-1 motion-reduce:animate-none" />
          <Skeleton className="h-3 w-16 shrink-0 motion-reduce:animate-none" />
          <Skeleton className="size-4 shrink-0 motion-reduce:animate-none" />
        </div>
      ))}
      <span className="sr-only">Loading your saved biomarker results.</span>
    </div>
  );
}

function groupMeasuredBiomarkers(
  biomarkers: readonly BrowserVaultMeasuredBiomarker[],
): MeasuredBiomarkerGroup[] {
  const groups = new Map<string, MeasuredBiomarkerGroup>();

  for (const biomarker of biomarkers) {
    const existing = groups.get(biomarker.healthArea.id);
    if (existing) {
      existing.items.push(biomarker);
      continue;
    }

    groups.set(biomarker.healthArea.id, {
      id: biomarker.healthArea.id,
      items: [biomarker],
      label: biomarker.healthArea.label,
    });
  }

  return [...groups.values()];
}

function formatHistorySpan(biomarker: BrowserVaultMeasuredBiomarker): string {
  const firstYear = biomarker.firstDate.slice(0, 4);
  const lastYear = biomarker.lastDate.slice(0, 4);
  return firstYear === lastYear ? firstYear : `${firstYear} to ${lastYear}`;
}

function isAuthRequiredBrowserVaultError(error: string | null): boolean {
  const normalized = error?.toLowerCase() ?? "";
  return normalized.includes("sign in")
    || normalized.includes("auth_required")
    || normalized.includes("unauthorized")
    || normalized.includes("session expired");
}
