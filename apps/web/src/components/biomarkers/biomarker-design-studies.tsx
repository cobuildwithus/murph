"use client";

import Link from "next/link";
import {
  Activity,
  ChevronRight,
  Droplets,
  Search,
  TestTubes,
} from "lucide-react";
import { useMemo, useState, type ComponentType } from "react";

import {
  LabBiomarkerHistoryChart,
  type LabBiomarkerChartPoint,
} from "@/src/components/biomarkers/lab-biomarker-history-chart";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { cn } from "@/src/lib/utils";

type BiomarkerStudyStatus = "attention" | "in-range";
type BiomarkerStudyFilter = "all" | BiomarkerStudyStatus;

interface BiomarkerStudyResult {
  id: string;
  metricKey: string;
  name: string;
  status: BiomarkerStudyStatus;
  statusLabel: string;
  unit: string;
  value: string;
}

interface BiomarkerStudyGroup {
  icon: ComponentType<{ className?: string }>;
  id: string;
  label: string;
  results: readonly BiomarkerStudyResult[];
}

const BIOMARKER_STUDY_GROUPS: readonly BiomarkerStudyGroup[] = [
  {
    icon: Droplets,
    id: "blood",
    label: "Blood",
    results: [
      {
        id: "hemoglobin",
        metricKey: "hemoglobin",
        name: "Hemoglobin",
        status: "attention",
        statusLabel: "Above range",
        unit: "g/dL",
        value: "18.0",
      },
      {
        id: "hematocrit",
        metricKey: "hematocrit",
        name: "Hematocrit",
        status: "attention",
        statusLabel: "Above range",
        unit: "%",
        value: "52.0",
      },
      {
        id: "mch",
        metricKey: "mean-corpuscular-hemoglobin",
        name: "Mean corpuscular hemoglobin",
        status: "in-range",
        statusLabel: "In range",
        unit: "pg",
        value: "30.0",
      },
    ],
  },
  {
    icon: Activity,
    id: "metabolic",
    label: "Metabolic",
    results: [
      {
        id: "glucose",
        metricKey: "glucose",
        name: "Glucose",
        status: "in-range",
        statusLabel: "In range",
        unit: "mg/dL",
        value: "90",
      },
      {
        id: "hemoglobin-a1c",
        metricKey: "hba1c",
        name: "Hemoglobin A1c",
        status: "in-range",
        statusLabel: "In range",
        unit: "%",
        value: "5.0",
      },
    ],
  },
  {
    icon: TestTubes,
    id: "thyroid",
    label: "Thyroid",
    results: [
      {
        id: "tsh",
        metricKey: "thyroid-stimulating-hormone",
        name: "Thyroid stimulating hormone",
        status: "in-range",
        statusLabel: "In range",
        unit: "µIU/mL",
        value: "2.0",
      },
      {
        id: "free-t4",
        metricKey: "free-t4",
        name: "Free T4",
        status: "in-range",
        statusLabel: "In range",
        unit: "ng/dL",
        value: "1.0",
      },
    ],
  },
] as const;

const HEMOGLOBIN_HISTORY: readonly LabBiomarkerChartPoint[] = [
  { date: "2023-01-01", id: "synthetic-hgb-2023", value: 15 },
  { date: "2024-01-01", id: "synthetic-hgb-2024", value: 16 },
  { date: "2025-01-01", id: "synthetic-hgb-2025", value: 17 },
  { date: "2026-01-01", id: "synthetic-hgb-2026", value: 18 },
] as const;

const FILTERS: readonly {
  label: string;
  tone?: BiomarkerStudyStatus;
  value: BiomarkerStudyFilter;
}[] = [
  { label: "All", value: "all" },
  { label: "Review", tone: "attention", value: "attention" },
  { label: "In range", tone: "in-range", value: "in-range" },
] as const;

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
    attention: allResults.filter((result) => result.status === "attention").length,
    "in-range": allResults.filter((result) => result.status === "in-range").length,
  } satisfies Record<BiomarkerStudyFilter, number>;
  const visibleGroups = useMemo(
    () => BIOMARKER_STUDY_GROUPS.flatMap((group) => {
      const results = group.results
        .filter((result) => {
          const matchesFilter = filter === "all" || result.status === filter;
          const matchesQuery = normalizedQuery.length === 0
            || `${result.name} ${group.label}`.toLocaleLowerCase().includes(normalizedQuery);
          return matchesFilter && matchesQuery;
        })
        .sort((left, right) => Number(left.status !== "attention") - Number(right.status !== "attention"));

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
    <section
      aria-labelledby="biomarker-index-study-heading"
      className="overflow-hidden rounded-xl border border-border/70 bg-card/80"
      data-design-study="biomarker-index"
    >
      <div className="px-5 py-6 sm:px-7 sm:py-8">
        <h3
          className="scroll-mt-20 font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          id="biomarker-index-study-heading"
        >
          Biomarkers
        </h3>
      </div>

      <div className="border-t border-border/70 px-5 py-5 sm:px-7 sm:py-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_auto] lg:items-center">
          <label className="relative block">
            <span className="sr-only">Search illustrative lab biomarkers</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.75}
            />
            <Input
              className="bg-background/45 pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search biomarkers"
              type="search"
              value={query}
            />
          </label>
          <div aria-label="Filter illustrative lab biomarkers" className="flex flex-wrap gap-2" role="group">
            {FILTERS.map((option) => (
              <Button
                aria-label={`${option.label}, ${counts[option.value]}`}
                aria-pressed={filter === option.value}
                className={cn(
                  "rounded-full bg-card/40 px-6 text-base text-foreground hover:bg-muted/30",
                  filter === option.value
                    ? "border-2 border-foreground"
                    : "border border-border/90",
                )}
                key={option.value}
                onClick={() => setFilter(option.value)}
                size="lg"
                type="button"
                variant="unstyled"
              >
                {option.tone ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      option.tone === "attention" ? "bg-destructive/80" : "bg-primary",
                    )}
                  />
                ) : null}
                <span className={cn(
                  option.tone === "attention" && "text-destructive",
                  option.tone === "in-range" && "text-primary",
                )}>
                  {option.label}
                </span>
                <span aria-hidden="true" className="text-muted-foreground">·</span>
                <span className="text-sm font-normal tabular-nums text-muted-foreground">
                  {counts[option.value]}
                </span>
              </Button>
            ))}
          </div>
        </div>

      </div>

      {visibleGroups.length > 0 ? (
        <div className="border-t border-border/70">
          {visibleGroups.map((group) => (
            <BiomarkerStudyDisclosure
              group={group}
              key={group.id}
              forcedOpen={normalizedQuery.length > 0}
              onToggle={(open) => handleGroupToggle(group.id, open)}
              open={normalizedQuery.length > 0 || openGroups.has(group.id)}
            />
          ))}
        </div>
      ) : (
        <div className="border-t border-border/70 px-5 py-12 text-center sm:px-7">
          <p className="font-serif text-xl font-semibold text-foreground">No matching biomarkers</p>
          <p className="mt-1 text-sm text-muted-foreground">Try another name or status.</p>
        </div>
      )}
    </section>
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
  const Icon = group.icon;
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
      <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4 sm:px-7 [&::-webkit-details-marker]:hidden">
        <Icon aria-hidden="true" className="size-5 shrink-0 text-foreground" />
        <span className="min-w-0 flex-1">
          <span
            aria-level={4}
            className="block font-serif text-xl font-semibold tracking-tight text-foreground"
            id={headingId}
            role="heading"
          >
            {group.label}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
          strokeWidth={1.75}
        />
      </summary>

      <div className="grid md:grid-cols-2">
        {group.results.map((result, index) => (
          <BiomarkerStudyRow
            className={cn(
              "min-w-0 border-t border-border/70 bg-card",
              group.results.length % 2 === 1 && "last:md:col-span-2",
              index % 2 === 0 && index + 1 < group.results.length && "md:border-r",
            )}
            key={result.id}
            result={result}
          />
        ))}
      </div>
    </details>
  );
}

function BiomarkerStudyRow({
  className,
  result,
}: {
  className?: string;
  result: BiomarkerStudyResult;
}) {
  const needsAttention = result.status === "attention";

  return (
    <Link
      className={cn(
        "flex min-h-24 w-full cursor-pointer flex-col justify-center px-5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-7",
        className,
      )}
      href={`/biomarkers/results/${encodeURIComponent(result.metricKey)}`}
      prefetch={false}
    >
      <span className="block break-words text-lg font-medium tracking-tight text-foreground">
        {result.name}
      </span>
      <span className="mt-1 block text-sm">
        <strong className={needsAttention ? "text-destructive" : "text-primary"}>
          {result.statusLabel}
        </strong>
        <span aria-hidden="true" className="text-muted-foreground"> · </span>
        <strong className="tabular-nums text-foreground">{result.value}</strong>{" "}
        <small className="text-xs text-muted-foreground">{result.unit}</small>
      </span>
    </Link>
  );
}

export function BiomarkerDetailStudy() {
  return (
    <article
      aria-labelledby="biomarker-detail-study-heading"
      className="border-y border-border/70 bg-card/40"
      data-design-study="biomarker-detail"
    >
      <header className="px-5 py-8 sm:px-7 sm:py-10">
        <h3
          className="scroll-mt-20 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
          id="biomarker-detail-study-heading"
        >
          Hemoglobin
        </h3>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          A protein in red blood cells that carries oxygen through the body.
        </p>
      </header>

      <section aria-label="Latest illustrative result" className="border-t border-border/70 px-5 py-9 sm:px-7 sm:py-10">
        <h4 className="text-2xl font-semibold tracking-tight text-destructive">Above range</h4>
        <div className="mt-3 flex items-baseline gap-3">
          <span aria-hidden="true" className="size-3 self-center rounded-full bg-destructive/80" />
          <span className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">18.0</span>
          <span className="text-base text-muted-foreground">g/dL</span>
        </div>
        <time className="mt-4 block text-sm text-muted-foreground" dateTime="2026-01-01">
          Jan 1, 2026
        </time>

        <div className="mt-9 min-w-0 border-y border-border/70 py-5">
          <LabBiomarkerHistoryChart
            displayName="Illustrative hemoglobin"
            points={HEMOGLOBIN_HISTORY}
            referenceRange={{ high: 17, low: 13 }}
            unit="g/dL"
          />
        </div>
      </section>
    </article>
  );
}
