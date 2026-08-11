"use client";

import Link from "next/link";
import { ArrowLeft, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";

import {
  LabBiomarkerHistoryChart,
  type LabBiomarkerChartPoint,
} from "@/src/components/biomarkers/lab-biomarker-history-chart";
import { BiomarkerIcon } from "@/src/components/biomarkers/biomarker-icon";
import { BiomarkerIndexPlaceholder } from "@/src/components/biomarkers/biomarker-index-placeholder";
import { Input } from "@/src/components/ui/input";
import {
  BIOMARKER_DEVICE_STUDIES,
  BIOMARKER_STUDY_GROUPS,
  type BiomarkerStudyGroup,
  type BiomarkerStudyResult,
  type BiomarkerStudyStatus,
} from "@/src/components/biomarkers/biomarker-design-data";
import { cn } from "@/src/lib/utils";

type BiomarkerStudyFilter = "all" | Exclude<BiomarkerStudyStatus, "reported">;

const FILTERS: readonly {
  label: string;
  tone?: "in-range" | "review";
  value: BiomarkerStudyFilter;
}[] = [
  { label: "All", value: "all" },
  { label: "Review", tone: "review", value: "review" },
  { label: "In range", tone: "in-range", value: "in-range" },
] as const;

const HEMOGLOBIN_HISTORY: readonly LabBiomarkerChartPoint[] = [
  { date: "2023-02-17", displayValue: "15.4", id: "synthetic-hgb-2023", value: 15.4 },
  { date: "2024-02-21", displayValue: "16.1", id: "synthetic-hgb-2024", value: 16.1 },
  { date: "2025-02-19", displayValue: "17.2", id: "synthetic-hgb-2025", value: 17.2 },
  { date: "2026-02-17", displayValue: "18.0", id: "synthetic-hgb-2026", value: 18 },
] as const;

export function BiomarkerPreparingStateStudy() {
  return (
    <article
      aria-labelledby="biomarker-preparing-study-heading"
      className="min-w-0"
      data-design-study="biomarker-preparing"
    >
      <header className="border-y border-border/70 px-5 py-8 sm:px-8 sm:py-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Synthetic interface study / Updating
        </p>
        <h3
          className="mt-3 font-serif text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
          id="biomarker-preparing-study-heading"
        >
          Biomarkers
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          An in-between state for a member who has already added health data and is waiting for their biomarkers to finish updating.
        </p>
      </header>
      <BiomarkerIndexPlaceholder headingAs="h4" variant="preparing" />
    </article>
  );
}

export function BiomarkerIndexStudy() {
  const [filter, setFilter] = useState<BiomarkerStudyFilter>("all");
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(BIOMARKER_STUDY_GROUPS.map((group) => group.id)),
  );
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const allResults = BIOMARKER_STUDY_GROUPS.flatMap((group) => group.results);
  const counts = {
    all: allResults.length,
    "in-range": allResults.filter((result) => result.status === "in-range").length,
    reported: allResults.filter((result) => result.status === "reported").length,
    review: allResults.filter((result) => result.status === "review").length,
  } satisfies Record<BiomarkerStudyStatus | "all", number>;
  const visibleGroups = useMemo(
    () => BIOMARKER_STUDY_GROUPS.flatMap((group) => {
      const results = group.results
        .filter((result) => {
          const matchesFilter = filter === "all" || result.status === filter;
          const matchesQuery = normalizedQuery.length === 0
            || `${result.name} ${group.label}`.toLocaleLowerCase().includes(normalizedQuery);
          return matchesFilter && matchesQuery;
        })
        .sort(compareBiomarkerStudyResults);

      return results.length > 0 ? [{ ...group, results }] : [];
    }),
    [filter, normalizedQuery],
  );

  function handleGroupToggle(groupId: string, open: boolean) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (open) {
        next.add(groupId);
      } else {
        next.delete(groupId);
      }
      return next;
    });
  }

  return (
    <article
      aria-labelledby="biomarker-index-study-heading"
      className="min-w-0"
      data-design-study="biomarker-index"
    >
      <header className="grid gap-8 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Synthetic interface study
          </p>
          <h3
            className="mt-3 scroll-mt-20 font-serif text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
            id="biomarker-index-study-heading"
          >
            Your biomarkers
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Example device readings and lab-result identities, filed by what they describe rather than by which report they arrived in. Values and flags are fabricated for this layout study.
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground lg:text-right">
          {BIOMARKER_DEVICE_STUDIES.length} device metrics<br />
          {counts.all} lab markers
        </p>
      </header>

      <section aria-labelledby="device-study-heading" className="border-y border-border/70">
        <div className="flex items-baseline justify-between gap-4 border-b border-border/70 py-4">
          <h4 className="font-serif text-2xl font-semibold tracking-tight text-foreground" id="device-study-heading">
            From your devices
          </h4>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Latest reading
          </span>
        </div>
        <ol>
          {BIOMARKER_DEVICE_STUDIES.map((metric) => (
            <li className="border-b border-border/70 last:border-b-0" key={metric.metricKey}>
              <Link
                className="group grid min-h-28 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-4 px-5 py-5 transition-colors duration-200 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-8 md:grid-cols-[2.5rem_8rem_minmax(0,1fr)_auto] md:gap-5"
                href={`/biomarkers/${metric.metricKey}`}
              >
                <BiomarkerIcon className="size-9" routeId={metric.metricKey} />
                <div className="min-w-0">
                  <p className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground md:block">
                    {metric.category}
                  </p>
                  <p className="text-lg font-semibold text-foreground md:mt-1 md:text-base">{metric.name}</p>
                </div>
                <p className="col-span-2 line-clamp-2 max-w-[72ch] text-sm leading-relaxed text-muted-foreground md:col-span-1 md:line-clamp-none">
                  {metric.summary}
                </p>
                <p className="col-span-2 min-w-24 text-left md:col-span-1 md:text-right">
                  <span className="font-serif text-3xl font-semibold tabular-nums text-foreground">
                    {metric.value}
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">{metric.unit}</span>
                </p>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="lab-study-heading">
        <div className="px-5 pt-8 sm:px-8 sm:pt-10">
          <h4 className="font-serif text-2xl font-semibold tracking-tight text-foreground" id="lab-study-heading">
            From the lab
          </h4>
        </div>

        <div className="grid gap-3 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(18rem,1fr)_auto] lg:items-center">
          <label className="relative block">
            <span className="sr-only">
              Search biomarkers
            </span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.75}
            />
            <Input
              className="h-12 rounded-full border-border/80 bg-background/45 pl-11 pr-5 shadow-none"
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search biomarkers"
              type="search"
              value={query}
            />
          </label>
          <div aria-label="Filter illustrative lab biomarkers" className="flex flex-wrap gap-2" role="group">
            {FILTERS.map((option) => (
              <button
                aria-label={`${option.label}, ${counts[option.value]}`}
                aria-pressed={filter === option.value}
                className={cn(
                  "inline-flex h-12 items-center justify-center gap-2 rounded-full border px-5 text-sm font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  filter === option.value
                    ? "border-foreground bg-background text-foreground ring-1 ring-foreground"
                    : "border-border/80 text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
                key={option.value}
                onClick={() => setFilter(option.value)}
                type="button"
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
                <span>{option.label}</span>
                <span aria-hidden="true" className="text-muted-foreground">·</span>
                <span className="inline-flex min-w-4 items-center justify-center self-center font-mono text-xs font-normal leading-none tabular-nums text-muted-foreground">
                  {counts[option.value]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {visibleGroups.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card/70">
            {visibleGroups.map((group) => (
              <BiomarkerStudyDisclosure
                forcedOpen={normalizedQuery.length > 0}
                group={group}
                key={group.id}
                onToggle={(open) => handleGroupToggle(group.id, open)}
                open={normalizedQuery.length > 0 || openGroups.has(group.id)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border/70 bg-card/70 px-5 py-14 text-center sm:px-8">
            <p className="font-serif text-xl font-semibold text-foreground">No matching biomarkers</p>
            <p className="mt-1 text-sm text-muted-foreground">Try another name or source status.</p>
          </div>
        )}
      </section>
    </article>
  );
}

function BiomarkerStudyDisclosure({
  forcedOpen,
  group,
  onToggle,
  open,
}: {
  forcedOpen: boolean;
  group: BiomarkerStudyGroup;
  onToggle: (open: boolean) => void;
  open: boolean;
}) {
  const headingId = `biomarker-study-area-${group.id}`;

  return (
    <details
      aria-labelledby={headingId}
      className="group border-b border-border/70 last:border-b-0"
      onToggle={(event) => {
        if (!forcedOpen) {
          onToggle(event.currentTarget.open);
        }
      }}
      open={open}
    >
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-4 bg-muted/10 px-5 py-3 transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-8 [&::-webkit-details-marker]:hidden">
        <span
          aria-level={5}
          className="min-w-0 flex-1 font-serif text-xl font-semibold tracking-tight text-foreground"
          id={headingId}
          role="heading"
        >
          {group.label}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform duration-200 group-open:rotate-0"
          strokeWidth={1.75}
        />
      </summary>
      <ol>
        {group.results.map((result) => (
          <li key={`${result.metricKey}:${result.name}`}>
            <BiomarkerStudyRow result={result} />
          </li>
        ))}
      </ol>
    </details>
  );
}

function BiomarkerStudyRow({ result }: { result: BiomarkerStudyResult }) {
  return (
    <Link
      className="grid min-h-16 w-full gap-2 border-t border-border/60 px-5 py-3.5 transition-colors duration-200 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8 sm:px-8"
      href={`/biomarkers/results/${encodeURIComponent(result.metricKey)}`}
      prefetch={false}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "h-12 w-1 shrink-0 rounded-full",
            result.status === "in-range" && "bg-primary",
            result.status === "reported" && "bg-muted-foreground/50",
            result.status === "review" && "bg-destructive",
          )}
        />
        <span className="min-w-0 break-words text-[15px] font-medium text-foreground sm:text-base">
          {result.name}
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm sm:justify-end sm:text-right">
        <span className={cn(
          "inline-flex items-center gap-1.5 font-medium",
          result.status === "in-range" && "text-primary",
          result.status === "reported" && "text-muted-foreground",
          result.status === "review" && "text-destructive",
        )}>
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              result.status === "in-range" && "bg-primary",
              result.status === "reported" && "bg-muted-foreground/60",
              result.status === "review" && "bg-destructive",
            )}
          />
          {result.statusLabel}
        </span>
        <span aria-hidden="true" className="text-border">/</span>
        <span className="font-serif text-lg font-semibold tabular-nums text-foreground">
          {result.value}
        </span>
        {result.unit ? <span className="text-xs text-muted-foreground">{result.unit}</span> : null}
      </span>
    </Link>
  );
}

export function BiomarkerDetailStudy() {
  return (
    <article
      aria-labelledby="biomarker-detail-study-heading"
      className="overflow-hidden rounded-xl border border-border/70 bg-card/70"
      data-design-study="biomarker-detail"
    >
      <header className="px-5 py-8 sm:px-8 sm:py-10">
        <Link className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground" href="#biomarker-index-study-heading">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Your biomarkers
        </Link>
        <p className="mt-10 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Synthetic interface study / Blood
        </p>
        <h3
          className="mt-2 scroll-mt-20 font-serif text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
          id="biomarker-detail-study-heading"
        >
          Hemoglobin
        </h3>
        <p className="mt-3 max-w-[68ch] text-base leading-relaxed text-muted-foreground sm:text-lg">
          The oxygen-carrying protein inside red blood cells, used with hematocrit and red-cell indices to understand oxygen transport and blood concentration.
        </p>
      </header>

      <section aria-labelledby="latest-reading-study-heading" className="grid border-t border-border/70 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]">
        <div className="px-5 py-8 sm:px-8 sm:py-10 lg:border-r lg:border-border/70">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground" id="latest-reading-study-heading">
            Latest reading
          </p>
          <p className="mt-4 text-xl font-semibold tracking-tight text-destructive">Above range</p>
          <p className="mt-3 flex flex-wrap items-baseline gap-2">
            <span className="font-serif text-5xl font-semibold tracking-tight tabular-nums text-foreground sm:text-6xl">18.0</span>
            <span className="text-lg text-muted-foreground">g/dL</span>
          </p>
          <time className="mt-4 block text-sm text-muted-foreground" dateTime="2026-02-17">
            Feb 17, 2026
          </time>
        </div>

        <div className="min-w-0 px-5 py-8 sm:px-8 sm:py-10">
          <div className="min-w-0">
            <LabBiomarkerHistoryChart
              displayName="Illustrative hemoglobin"
              points={HEMOGLOBIN_HISTORY}
              referenceRange={{ high: 17, low: 13 }}
              referenceRangeLabel="13.0 to 17.0 g/dL"
              referenceRangeSourceLabel="Example laboratory"
              unit="g/dL"
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="result-ledger-study-heading" className="border-t border-border/70 py-8 sm:py-10">
        <div className="flex items-baseline justify-between gap-4 px-5 sm:px-8">
          <h4 className="font-serif text-2xl font-semibold tracking-tight text-foreground" id="result-ledger-study-heading">
            All results
          </h4>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">2023 to 2026</span>
        </div>
        <div className="mt-5 overflow-hidden border-y border-border/70">
          <div className="hidden grid-cols-[8rem_minmax(8rem,0.65fr)_minmax(12rem,1fr)_minmax(10rem,0.85fr)] gap-4 border-b border-border/70 bg-muted/15 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground sm:px-5 lg:grid">
            <span>Date</span><span>Result</span><span>Reference range</span><span>Source</span>
          </div>
          <ol>
            {[...HEMOGLOBIN_HISTORY].reverse().map((result) => (
              <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 border-b border-border/60 px-4 py-3.5 last:border-b-0 sm:px-5 lg:grid-cols-[8rem_minmax(8rem,0.65fr)_minmax(12rem,1fr)_minmax(10rem,0.85fr)] lg:items-center lg:gap-4" key={result.id}>
                <time className="order-2 text-xs text-muted-foreground lg:order-none lg:text-sm lg:text-foreground" dateTime={result.date}>{formatStudyDate(result.date)}</time>
                <span className="order-1 font-serif text-lg font-semibold tabular-nums text-foreground lg:order-none">{result.displayValue} g/dL</span>
                <span className="order-3 col-span-2 text-xs text-muted-foreground lg:col-span-1 lg:text-sm">13.0 to 17.0 g/dL</span>
                <span className="order-4 col-span-2 text-xs text-muted-foreground lg:col-span-1 lg:text-sm">Example laboratory</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </article>
  );
}

export function BiomarkerBoundaryResultStudy() {
  return (
    <article className="overflow-hidden rounded-xl border border-border/70 bg-card/70" data-design-study="biomarker-boundary-result">
      <header className="grid gap-6 px-5 py-8 sm:px-8 sm:py-10 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Synthetic boundary result</p>
          <h3 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Rheumatoid Factor</h3>
          <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-muted-foreground sm:text-base">
            An antibody test used as one piece of evidence when clinicians evaluate inflammatory autoimmune conditions, especially rheumatoid arthritis.
          </p>
        </div>
        <div className="md:text-right">
          <p className="font-medium text-primary">In range</p>
          <p className="mt-1 font-serif text-4xl font-semibold tracking-tight text-foreground">&lt;10</p>
          <p className="mt-1 text-xs text-muted-foreground">Feb 17, 2026</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Published comparator — not the reporting lab&apos;s range
          </p>
        </div>
      </header>
      <div className="grid gap-2 border-t border-border/70 px-5 py-4 text-sm sm:px-8 lg:grid-cols-[8rem_minmax(8rem,0.6fr)_minmax(12rem,1fr)_minmax(10rem,0.85fr)] lg:items-center lg:gap-4">
        <time className="text-muted-foreground" dateTime="2026-02-17">Feb 17, 2026</time>
        <span className="font-serif text-lg font-semibold text-foreground">&lt;10</span>
        <span className="text-muted-foreground">Published comparator — not the reporting lab&apos;s range</span>
        <span className="text-muted-foreground">Example laboratory</span>
      </div>
    </article>
  );
}

export function BiomarkerReferenceContextStudy() {
  return (
    <div className="grid gap-6 lg:grid-cols-2" data-design-study="biomarker-reference-context">
      <article className="min-w-0 rounded-xl border border-border/70 bg-card/70 p-5 sm:p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Exact source limit
        </p>
        <h3 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-foreground">
          HbA1c
        </h3>
        <div className="mt-6 min-w-0">
          <LabBiomarkerHistoryChart
            displayName="Illustrative HbA1c"
            points={[
              { date: "2025-02-17", id: "synthetic-a1c-2025", value: 5 },
              { date: "2026-04-23", id: "synthetic-a1c-2026", value: 4.7 },
            ]}
            referenceRange={{ high: 5.7, low: null }}
            referenceRangeLabel="<5.7%"
            referenceRangeSourceLabel="Example laboratory"
            unit="percent"
          />
        </div>
      </article>

      <article className="min-w-0 rounded-xl border border-border/70 bg-card/70 p-5 sm:p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Missing source range
        </p>
        <h3 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-foreground">
          Chloride
        </h3>
        <div className="mt-6 min-w-0">
          <LabBiomarkerHistoryChart
            displayName="Illustrative chloride"
            points={[
              { date: "2025-02-17", id: "synthetic-chloride-2025", value: 103 },
              { date: "2026-04-23", id: "synthetic-chloride-2026", value: 101 },
            ]}
            referenceRange={{ high: 107, low: 98 }}
            referenceRangeLabel="98 to 107 mmol/L"
            referenceRangeSourceLabel="Mayo Clinic Laboratories adult serum reference interval · not the reporting lab's range"
            referenceRangeTitle="Published adult comparator"
            referenceRangeTone="context"
            unit="mmol/L"
          />
        </div>
      </article>
    </div>
  );
}

function formatStudyDate(date: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function compareBiomarkerStudyResults(
  left: BiomarkerStudyResult,
  right: BiomarkerStudyResult,
): number {
  const rank: Readonly<Record<BiomarkerStudyStatus, number>> = {
    review: 0,
    "in-range": 1,
    reported: 2,
  };

  return rank[left.status] - rank[right.status]
    || left.name.localeCompare(right.name)
    || left.metricKey.localeCompare(right.metricKey);
}
