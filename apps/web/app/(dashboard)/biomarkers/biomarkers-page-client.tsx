"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import {
  selectBrowserVaultDeviceMetricSummary,
  selectBrowserVaultMeasuredBiomarkers,
  type BrowserVaultBiomarkerMetricBinding,
  type BrowserVaultDeviceMetricSummary,
  type BrowserVaultLabsCapableQueryClient,
  type BrowserVaultMetricSeriesCapableQueryClient,
  type BrowserVaultMeasuredBiomarker,
} from "@murphai/query/browser-biomarkers";

import { LabResultValue } from "@/src/components/biomarkers/lab-result-value";
import { BiomarkerIcon } from "@/src/components/biomarkers/biomarker-icon";
import {
  BiomarkerIndexPlaceholder,
  type BiomarkerIndexPlaceholderVariant,
} from "@/src/components/biomarkers/biomarker-index-placeholder";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { AuthButton } from "@/src/components/ui/auth-button";
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
import { Input } from "@/src/components/ui/input";
import { Skeleton } from "@/src/components/ui/skeleton";
import {
  useBrowserVault,
  useBrowserVaultLabsSelector,
  useBrowserVaultMetricKeyDemand,
  useBrowserVaultMetricsSelector,
} from "@/src/lib/browser-vault/context";
import {
  formatLabFlag,
  labUnitSuffix,
} from "@/src/lib/biomarkers/lab-result-display";
import { formatMetricValue } from "@/src/lib/browser-vault/trend-comparison";
import { cn } from "@/src/lib/utils";

export interface DeviceTrackedBiomarker {
  category: string | null;
  privateMetricBindings: readonly BrowserVaultBiomarkerMetricBinding[];
  routeId: string;
  shortName: string;
  summary: string | null;
  unit: string;
  valuePrecision: number;
}

export interface DeviceMetricListItem {
  entry: DeviceTrackedBiomarker;
  summary: BrowserVaultDeviceMetricSummary;
}

interface BiomarkersPageClientProps {
  authenticated: boolean;
  deviceBiomarkers?: readonly DeviceTrackedBiomarker[];
  uploadLabsAction?: ReactNode;
}

export interface MeasuredBiomarkerGroup {
  id: string;
  items: BrowserVaultMeasuredBiomarker[];
  label: string;
}

type MeasuredBiomarkerFilter = "all" | "in-range" | "review";
type MeasuredBiomarkerStatus = "in-range" | "reported" | "review";

const MEASURED_BIOMARKER_FILTERS: readonly {
  label: string;
  tone?: Exclude<MeasuredBiomarkerStatus, "reported">;
  value: MeasuredBiomarkerFilter;
}[] = [
  { label: "All", value: "all" },
  { label: "Review", tone: "review", value: "review" },
  { label: "In range", tone: "in-range", value: "in-range" },
] as const;

export function BiomarkersPageClient({
  authenticated,
  deviceBiomarkers = [],
  uploadLabsAction = null,
}: BiomarkersPageClientProps) {
  const [filter, setFilter] = useState<MeasuredBiomarkerFilter>("all");
  const [query, setQuery] = useState("");
  const {
    error,
    freshness,
    refresh,
    refreshPending,
    status,
  } = useBrowserVault();
  const demandedMetricKeys = deviceBiomarkers.flatMap((entry) => {
    const binding = entry.privateMetricBindings.find(
      (candidate) => candidate.role === "primary",
    ) ?? entry.privateMetricBindings[0];
    return binding ? [binding.metricKey] : [];
  });
  const deviceMetricBucketsLoaded = useBrowserVaultMetricKeyDemand(demandedMetricKeys);
  const biomarkers = useBrowserVaultLabsSelector(selectBrowserVaultMeasuredBiomarkers) ?? [];
  const selectDeviceMetrics = useCallback(
    (client: BrowserVaultMetricSeriesCapableQueryClient) =>
      deviceMetricBucketsLoaded
        ? selectDeviceMetricItems(client, deviceBiomarkers)
        : [],
    [deviceBiomarkers, deviceMetricBucketsLoaded],
  );
  const deviceMetrics = useBrowserVaultMetricsSelector(selectDeviceMetrics) ?? [];
  const savedLabResultCount = useBrowserVaultLabsSelector(countSavedLabResults) ?? 0;
  const normalizedQuery = query.trim().toLowerCase();
  const groups = groupMeasuredBiomarkers(
    biomarkers.filter((biomarker) => {
      const status = measuredBiomarkerStatus(biomarker.latest.flag);
      const matchesFilter = filter === "all" || status === filter;
      const matchesQuery = normalizedQuery.length === 0
        || `${biomarker.displayName} ${biomarker.healthArea.label}`
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    }),
  );
  const filterCounts = {
    all: biomarkers.length,
    "in-range": biomarkers.filter((biomarker) =>
      measuredBiomarkerStatus(biomarker.latest.flag) === "in-range"
    ).length,
    review: biomarkers.filter((biomarker) =>
      measuredBiomarkerStatus(biomarker.latest.flag) === "review"
    ).length,
  } satisfies Record<MeasuredBiomarkerFilter, number>;
  const authRequired = !authenticated
    || (status === "error" && isAuthRequiredBrowserVaultError(error));
  const preparing = authenticated && refreshPending;
  const totalCount = biomarkers.length + deviceMetrics.length;
  const deviceMetricDemandSettled = demandedMetricKeys.length === 0
    || deviceMetricBucketsLoaded;
  const canShowResolvedEmptyState = status === "empty"
    || (status === "ready" && deviceMetricDemandSettled);
  const showListSkeleton = authenticated
    && !authRequired
    && (
      status === "loading"
      || (
        status === "ready"
        && !deviceMetricDemandSettled
        && biomarkers.length === 0
      )
    );
  const showUnclassifiedLabNotice = authenticated
    && !authRequired
    && canShowResolvedEmptyState
    && deviceMetrics.length > 0
    && biomarkers.length === 0
    && savedLabResultCount > 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Biomarkers" />

      {showListSkeleton ? <BiomarkerListSkeleton /> : null}

      {authenticated && status === "error" && !authRequired ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load your biomarkers</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>Some private biomarker data is not available right now.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh({ background: true })}
              >
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {authenticated && !authRequired && deviceMetrics.length > 0 ? (
        <DeviceMetricsSection items={deviceMetrics} />
      ) : null}

      {authenticated && !authRequired && biomarkers.length > 0 ? (
        <section aria-labelledby="lab-biomarkers-heading" className="flex flex-col gap-4">
          <h2
            className="font-serif text-2xl font-semibold tracking-tight text-foreground"
            id="lab-biomarkers-heading"
          >
            From the lab
          </h2>
          <MeasuredBiomarkerControls
            counts={filterCounts}
            filter={filter}
            onFilterChange={setFilter}
            onQueryChange={setQuery}
            query={query}
          />
          {groups.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card/70">
              {groups.map((group) => (
                <MeasuredBiomarkerSection
                  key={group.id}
                  group={group}
                />
              ))}
            </div>
          ) : (
            <div
              aria-live="polite"
              className="rounded-xl border border-border/70 bg-card/70 px-5 py-10 text-center"
              role="status"
            >
              <p className="font-serif text-xl font-semibold text-foreground">
                No matching biomarkers
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try another name or status.
              </p>
            </div>
          )}
        </section>
      ) : null}

      {showUnclassifiedLabNotice ? <UnclassifiedLabsNotice /> : null}

      {authRequired || (canShowResolvedEmptyState && totalCount === 0) ? (
        <EmptyBiomarkersState
          authRequired={authRequired}
          hasSavedLabResults={savedLabResultCount > 0}
          preparing={authenticated && preparing}
          stale={freshness === "stale"}
          uploadLabsAction={uploadLabsAction}
        />
      ) : null}

    </div>
  );
}

function UnclassifiedLabsNotice() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No recognized lab biomarkers yet</CardTitle>
        <CardDescription>
          Your saved lab records remain available, but none are recognized as biomarkers yet.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

/**
 * Only biomarkers with an actual device-derived reading appear: the summary
 * selector filters to wearable provenance, so manual entries and lab values
 * can never render, count, or decide staleness under this heading.
 */
function selectDeviceMetricItems(
  client: BrowserVaultMetricSeriesCapableQueryClient,
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

function countSavedLabResults(client: BrowserVaultLabsCapableQueryClient): number {
  return client.labResults.list().length;
}

export function DeviceMetricsSection({ items }: { items: DeviceMetricListItem[] }) {
  return (
    <section aria-labelledby="biomarker-devices-heading" className="border-y border-border/70">
      <div className="flex items-baseline justify-between gap-4 border-b border-border/70 py-4">
        <h2
          className="font-serif text-2xl font-semibold tracking-tight text-foreground"
          id="biomarker-devices-heading"
        >
          From your devices
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {items.length} {items.length === 1 ? "metric" : "metrics"}
        </span>
      </div>

      <ul>
        {items.map((item) => (
          <li className="min-w-0 border-b border-border/70 last:border-b-0" key={item.entry.routeId}>
            <DeviceMetricRow item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeviceMetricRow({ item }: { item: DeviceMetricListItem }) {
  const { entry, summary } = item;
  const category = entry.category?.replaceAll("-", " ") ?? "Device metric";
  const valueLabel = `${formatMetricValue(summary.latest.value, entry.valuePrecision)}${labUnitSuffix(summary.latest.unit ?? entry.unit)}`;

  return (
    <Link
      className="group grid min-h-28 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-4 px-5 py-5 transition-colors duration-200 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-8 md:grid-cols-[2.5rem_8rem_minmax(0,1fr)_auto] md:gap-5"
      href={`/biomarkers/${entry.routeId}`}
    >
      <BiomarkerIcon className="size-9" routeId={entry.routeId} />
      <div className="min-w-0">
        <p className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground md:block">
          {category}
        </p>
        <p className="text-lg font-semibold text-foreground md:mt-1 md:text-base">{entry.shortName}</p>
      </div>
      <p className="col-span-2 line-clamp-2 max-w-[72ch] text-sm leading-relaxed text-muted-foreground md:col-span-1 md:line-clamp-none">
        {entry.summary ?? "A device-derived health metric from your connected data."}
      </p>
      <p className="col-span-2 min-w-24 text-left md:col-span-1 md:text-right">
        <span className="font-serif text-3xl font-semibold tabular-nums text-foreground">
          {valueLabel}
        </span>
        {summary.stale ? (
          <span className="mt-1 block text-xs font-medium text-destructive">Out of date</span>
        ) : null}
      </p>
    </Link>
  );
}

function MeasuredBiomarkerControls({
  counts,
  filter,
  onFilterChange,
  onQueryChange,
  query,
}: {
  counts: Record<MeasuredBiomarkerFilter, number>;
  filter: MeasuredBiomarkerFilter;
  onFilterChange: (filter: MeasuredBiomarkerFilter) => void;
  onQueryChange: (query: string) => void;
  query: string;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_auto] lg:items-center">
      <label className="relative block">
        <span className="sr-only">Search saved lab biomarkers</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
        />
        <Input
          className="bg-card/60 pl-10"
          inputSize="lg"
          onInput={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Search biomarkers"
          type="search"
          value={query}
        />
      </label>

      <div aria-label="Filter saved lab biomarkers" className="flex flex-wrap gap-2" role="group">
        {MEASURED_BIOMARKER_FILTERS.map((option) => (
          <Button
            aria-label={`${option.label}, ${counts[option.value]}`}
            aria-pressed={filter === option.value}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-full border-2 bg-card/60 px-5 text-sm leading-none text-foreground hover:bg-muted/30",
              filter === option.value ? "border-foreground" : "border-border/70",
            )}
            key={option.value}
            onClick={() => onFilterChange(option.value)}
            size="lg"
            type="button"
            variant="unstyled"
          >
            {option.tone ? (
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  option.tone === "review" ? "bg-destructive" : "bg-primary",
                )}
              />
            ) : null}
            <span
              className={cn(
                option.tone === "review" && "text-destructive",
                option.tone === "in-range" && "text-primary",
              )}
            >
              {option.label}
            </span>
            <span aria-hidden="true" className="text-muted-foreground">·</span>
            <span className="inline-flex min-w-4 items-center justify-center self-center font-mono text-xs font-normal leading-none tabular-nums text-muted-foreground">
              {counts[option.value]}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

export function MeasuredBiomarkerSection({
  group,
}: {
  group: MeasuredBiomarkerGroup;
}) {
  const [open, setOpen] = useState(true);
  const headingId = `biomarker-area-${group.id}`;

  return (
    <details
      aria-labelledby={headingId}
      className="group border-b border-border/70 last:border-b-0"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
      open={open}
    >
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        <h2
          className="min-w-0 flex-1 font-serif text-xl font-semibold tracking-tight text-foreground"
          id={headingId}
        >
          {group.label}
        </h2>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
          strokeWidth={1.75}
        />
      </summary>

      <div className="flex flex-col">
        {group.items.map((biomarker) => (
          <MeasuredBiomarkerRow
            biomarker={biomarker}
            key={biomarker.metricKey}
          />
        ))}
      </div>
    </details>
  );
}

function MeasuredBiomarkerRow({
  biomarker,
}: {
  biomarker: BrowserVaultMeasuredBiomarker;
}) {
  const status = measuredBiomarkerStatus(biomarker.latest.flag);

  return (
    <Link
      className="flex min-h-20 cursor-pointer flex-col justify-center gap-1 border-t border-border/70 bg-card/70 px-4 py-4 transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-24 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5"
      href={`/biomarkers/results/${encodeURIComponent(biomarker.metricKey)}`}
      prefetch={false}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "h-12 w-1 shrink-0 rounded-full",
            status === "review" && "bg-destructive",
            status === "in-range" && "bg-primary",
            status === "reported" && "bg-muted-foreground/50",
          )}
        />
        <h3 className="min-w-0 break-words text-lg font-medium tracking-tight text-foreground">
          {biomarker.displayName}
        </h3>
      </div>
      <p className="min-w-0 break-words text-sm sm:ml-auto sm:max-w-[50%] sm:text-right">
        <strong
          className={cn(
            status === "review" && "text-destructive",
            status === "in-range" && "text-primary",
            status === "reported" && "text-muted-foreground",
          )}
        >
          {measuredBiomarkerStatusLabel(biomarker.latest.flag)}
        </strong>
        <span aria-hidden="true" className="text-muted-foreground"> · </span>
        <LabResultValue
          className="font-serif font-semibold tabular-nums text-foreground"
          result={biomarker.latest}
        />
      </p>
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
  if (!authRequired) {
    const variant: BiomarkerIndexPlaceholderVariant = preparing
      ? "preparing"
      : hasSavedLabResults
        ? "saved"
        : stale
          ? "stale"
          : "empty";

    return (
      <BiomarkerIndexPlaceholder
        action={preparing ? null : uploadLabsAction}
        variant={variant}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to see your biomarkers</CardTitle>
        <CardDescription>
          Your biomarker history is private and only appears after you sign in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="max-w-xl text-sm text-muted-foreground">
          Sign in before viewing or adding private health information.
        </p>
      </CardContent>
      <CardFooter>
        <AuthButton>Sign in</AuthButton>
      </CardFooter>
    </Card>
  );
}

export function BiomarkerListSkeleton() {
  return (
    <div aria-label="Loading biomarkers" className="flex flex-col gap-6" role="status">
      <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_auto]">
        <Skeleton className="h-11 w-full rounded-2xl motion-reduce:animate-none" />
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2].map((pill) => (
            <Skeleton
              className="h-11 w-20 rounded-full motion-reduce:animate-none sm:w-24"
              key={pill}
            />
          ))}
        </div>
      </div>
      {[0, 1].map((group) => (
        <div
          className="overflow-hidden rounded-xl border border-border/70 bg-card/70"
          key={group}
        >
          <div className="flex min-h-16 items-center gap-4 px-4 py-3 sm:px-5">
            <Skeleton className="h-6 min-w-0 flex-1 motion-reduce:animate-none" />
            <Skeleton className="size-4 shrink-0 motion-reduce:animate-none" />
          </div>
          <div className="flex flex-col">
            {[0, 1, 2].map((item) => (
              <div
                className="flex min-h-20 flex-col justify-center gap-2 border-t border-border/70 px-4 py-4 sm:min-h-24 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5"
                key={item}
              >
                <Skeleton className="h-5 w-3/4 motion-reduce:animate-none sm:w-64" />
                <Skeleton className="h-4 w-1/2 motion-reduce:animate-none sm:w-40" />
              </div>
            ))}
          </div>
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

  return [...groups.values()].map((group) => ({
    ...group,
    items: group.items.sort(compareMeasuredBiomarkers),
  }));
}

function measuredBiomarkerStatus(flag: string | null): MeasuredBiomarkerStatus {
  const normalized = flag?.trim().toLowerCase() ?? "";
  if (normalized === "normal") {
    return "in-range";
  }
  return normalized.length > 0 ? "review" : "reported";
}

function measuredBiomarkerStatusLabel(flag: string | null): string {
  const normalized = flag?.trim().toLowerCase() ?? "";
  switch (normalized) {
    case "normal":
      return "In range";
    case "high":
      return "Above range";
    case "low":
      return "Below range";
    case "critical":
      return "Critical";
    case "abnormal":
    case "unknown":
      return "Review";
    case "":
      return "Reported";
    default:
      return formatLabFlag(normalized);
  }
}

function compareMeasuredBiomarkers(
  left: BrowserVaultMeasuredBiomarker,
  right: BrowserVaultMeasuredBiomarker,
): number {
  const rank: Record<MeasuredBiomarkerStatus, number> = {
    review: 0,
    "in-range": 1,
    reported: 2,
  };
  const statusDifference = rank[measuredBiomarkerStatus(left.latest.flag)]
    - rank[measuredBiomarkerStatus(right.latest.flag)];
  return statusDifference
    || left.displayName.localeCompare(right.displayName)
    || left.metricKey.localeCompare(right.metricKey);
}

function isAuthRequiredBrowserVaultError(error: string | null): boolean {
  const normalized = error?.toLowerCase() ?? "";
  return normalized.includes("sign in")
    || normalized.includes("auth_required")
    || normalized.includes("unauthorized")
    || normalized.includes("session expired");
}
