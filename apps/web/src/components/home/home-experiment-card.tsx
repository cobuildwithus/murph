import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";

import { Badge } from "@/src/components/ui/badge";
import { formatIsoDate } from "@/src/lib/browser-vault/display";
import type { ExperimentLibraryCard } from "@/src/lib/experiments/library-cards";
import type {
  ExperimentRunCardMetric,
  ExperimentRunCardSummary,
} from "@/src/lib/experiments/run-card-summary";
import { cn } from "@/src/lib/utils";

interface HomeExperimentCardProps {
  card: ExperimentLibraryCard;
  variant: "default" | "history";
}

const MAX_EXACT_CADENCE_SEGMENTS = 12;

export function HomeExperimentCard({ card, variant }: HomeExperimentCardProps) {
  const dateLabel = resolveDateLabel(card);
  const content = (
    <article
      className={cn(
        "group flex flex-col rounded-xl border border-border/70 bg-card/70 transition-colors",
        variant === "history" ? "h-fit p-5" : "h-full min-h-[240px] p-5",
        card.href ? "hover:border-primary/35 hover:bg-card" : "",
      )}
      data-home-experiment-card
      data-home-experiment-card-variant={variant}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {card.category}
          </p>
          <h3 className="mt-1 text-balance font-serif text-xl font-semibold leading-tight text-foreground">
            {card.title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {variant === "default" && card.privateBadgeLabel ? (
            <span
              className="inline-flex size-7 items-center justify-center rounded-full border border-border/70 text-muted-foreground"
              title={card.privateBadgeLabel}
            >
              <LockKeyhole aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{card.privateBadgeLabel}</span>
            </span>
          ) : null}
          {card.statusLabel && (
            variant === "default" || !isRedundantHistoryStatus(card.statusLabel)
          ) ? (
            <Badge variant={card.statusVariant ?? "outline"} className="font-normal">
              {card.statusLabel}
            </Badge>
          ) : null}
        </div>
      </header>

      <div className={cn(
        "flex flex-1 items-center border-t border-border/60",
        variant === "history" ? "mt-4 pt-4" : "mt-5 pt-5",
      )}>
        <ExperimentDataVisual card={card} variant={variant} />
      </div>

      <footer className={cn(
        "flex items-center justify-between gap-4 text-[11px] text-muted-foreground",
        variant === "history" ? "mt-4" : "mt-5",
      )}>
        <span className="inline-flex min-w-0 items-center gap-1.5 tabular-nums">
          {variant === "history" && card.privateBadgeLabel ? (
            <>
              <LockKeyhole aria-hidden="true" className="size-3 shrink-0" />
              <span className="sr-only">{card.privateBadgeLabel}</span>
            </>
          ) : null}
          <span className="min-w-0 truncate">
            {dateLabel ?? "Stored in your private vault"}
          </span>
        </span>
        {variant === "default" && card.href ? (
          <span className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground/70 transition-colors group-hover:text-foreground">
            View
            <ArrowRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
            />
          </span>
        ) : null}
      </footer>
    </article>
  );

  if (!card.href) {
    return content;
  }

  return (
    <Link
      href={card.href}
      className={cn(
        "block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        variant === "default" ? "h-full" : "",
      )}
    >
      {content}
    </Link>
  );
}

function ExperimentDataVisual({ card, variant }: HomeExperimentCardProps) {
  const summary = card.runSummary;
  const inProgress = card.runStatus === "active" || card.runStatus === "paused";
  const comparableMetrics = summary?.metrics ?? [];

  if (inProgress && summary?.dailyCadence) {
    return <ExperimentDailyCadence summary={summary} />;
  }

  if (inProgress && typeof summary?.completionPercent === "number") {
    return <ExperimentProgress summary={summary} />;
  }

  if (variant === "history" && comparableMetrics.length > 0) {
    return <ExperimentResults metrics={comparableMetrics} />;
  }

  if (variant === "default" && summary?.metric) {
    return <ExperimentResult metric={summary.metric} />;
  }

  const fallback = inProgress
    ? "Collecting data"
    : summary
      ? "No clear signal"
      : card.statusLabel ?? "Private run";

  return (
    <div className="w-full">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Experiment status
      </p>
      <p className={cn(
        "mt-2 font-serif font-semibold leading-none text-foreground",
        variant === "history" ? "text-2xl" : "text-3xl",
      )}>
        {fallback}
      </p>
    </div>
  );
}

function ExperimentResults({ metrics }: { metrics: ExperimentRunCardMetric[] }) {
  const [primaryMetric, ...supportingMetrics] = metrics;

  if (!primaryMetric) {
    return null;
  }

  const primarySentimentLabel = resolveMetricSentimentLabel(primaryMetric);

  return (
    <div className="w-full" data-home-experiment-results>
      <div data-home-experiment-primary-result>
        <p className="font-mono text-[9px] uppercase leading-tight tracking-widest text-muted-foreground">
          {primaryMetric.label}
        </p>
        <p className={cn(
          "mt-1.5 font-serif text-3xl font-semibold leading-none tabular-nums",
          resolveMetricTone(primaryMetric),
        )}>
          {primaryMetric.delta || primaryMetric.current}
          {primarySentimentLabel ? (
            <span className="sr-only">{primarySentimentLabel}</span>
          ) : null}
        </p>
      </div>

      {supportingMetrics.length > 0 ? (
        <dl
          className="mt-4 divide-y divide-border/60 border-y border-border/60"
          data-home-experiment-supporting-results
        >
          {supportingMetrics.map((metric, index) => {
            const sentimentLabel = resolveMetricSentimentLabel(metric);

            return (
              <div
                key={`${metric.label}:${index}`}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-2.5"
              >
                <dt className="min-w-0 break-words font-mono text-[9px] uppercase leading-tight tracking-widest text-muted-foreground">
                  {metric.label}
                </dt>
                <dd className={cn(
                  "shrink-0 font-serif text-lg font-semibold leading-none tabular-nums",
                  resolveMetricTone(metric),
                )}>
                  {metric.delta || metric.current}
                  {sentimentLabel ? (
                    <span className="sr-only">{sentimentLabel}</span>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </div>
  );
}

function ExperimentResult({ metric }: { metric: ExperimentRunCardMetric }) {
  const headline = metric.delta || metric.current;
  const sentimentLabel = resolveMetricSentimentLabel(metric);

  return (
    <div className="w-full">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {metric.label}
      </p>
      <p className={cn(
        "mt-2 font-serif text-4xl font-semibold leading-none tabular-nums",
        resolveMetricTone(metric),
      )}>
        {headline}
        {sentimentLabel ? (
          <span className="sr-only">{sentimentLabel}</span>
        ) : null}
      </p>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-y border-border/60 py-3">
        <ResultValue label="Baseline" value={metric.baseline ?? "—"} />
        <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground/60" />
        <ResultValue label="Latest" value={metric.current} />
      </div>
    </div>
  );
}

function ResultValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-serif text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function ExperimentDailyCadence({ summary }: { summary: ExperimentRunCardSummary }) {
  const cadence = summary.dailyCadence;
  if (!cadence) {
    return null;
  }

  const expected = Math.max(1, Math.trunc(cadence.expected));
  const completed = Math.min(expected, Math.max(0, Math.trunc(cadence.completed)));
  const progress = Math.round((completed / expected) * 100);
  const context = [cadence.label, cadence.cadence]
    .filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    )
    .join(" · ");
  const ariaLabel = cadence.label
    ? `${cadence.label} today`
    : "Today's cadence";
  const ariaValueText = `${completed} of ${expected} completed today`;
  const showExactSegments = expected <= MAX_EXACT_CADENCE_SEGMENTS;

  return (
    <div className="w-full" data-home-experiment-daily-cadence>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Today
          </p>
          <p
            aria-hidden="true"
            className="mt-2 font-serif text-4xl font-semibold leading-none tabular-nums text-foreground"
          >
            {completed}
            <span className="mx-1.5 text-foreground/30">/</span>
            <span className="text-foreground/55">{expected}</span>
          </p>
          <p className="sr-only">{ariaValueText}</p>
        </div>
        {typeof summary.day === "number" ? (
          <p className="pb-1 text-sm tabular-nums text-muted-foreground">
            Day {summary.day}
          </p>
        ) : null}
      </div>

      {context ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {context}
        </p>
      ) : null}

      {showExactSegments ? (
        <div
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={expected}
          aria-valuenow={completed}
          aria-valuetext={ariaValueText}
          className="mt-5 grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${expected}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: expected }, (_, index) => {
            const complete = index < completed;
            return (
              <span
                aria-hidden="true"
                className={cn(
                  "h-2 rounded-full",
                  complete ? "bg-primary" : "bg-secondary/35",
                )}
                data-complete={complete ? "true" : "false"}
                data-home-experiment-cadence-segment
                key={index}
              />
            );
          })}
        </div>
      ) : (
        <div
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={expected}
          aria-valuenow={completed}
          aria-valuetext={ariaValueText}
          className="mt-5 h-2 overflow-hidden rounded-full bg-secondary/35"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ExperimentProgress({ summary }: { summary: ExperimentRunCardSummary }) {
  const progress = clampProgress(summary.completionPercent ?? 0);

  return (
    <div className="w-full">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Experiment progress
          </p>
          <p className="mt-2 font-serif text-4xl font-semibold leading-none tabular-nums text-foreground">
            {progress}%
          </p>
        </div>
        {typeof summary.day === "number" ? (
          <p className="pb-1 text-sm tabular-nums text-muted-foreground">
            Day {summary.day}
          </p>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label="Experiment progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="mt-5 h-2 overflow-hidden rounded-full bg-secondary/35"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${progress}%` }}
        />
      </div>
      {summary.metric ? (
        <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-border/60 pt-3">
          <span className="truncate text-xs text-muted-foreground">
            {summary.metric.label}
          </span>
          <span className="shrink-0 font-serif text-lg font-semibold tabular-nums text-foreground">
            {summary.metric.current}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function resolveDateLabel(card: ExperimentLibraryCard): string | null {
  if ((card.runStatus === "active" || card.runStatus === "paused") && card.startedOn) {
    return `Started ${formatIsoDate(card.startedOn)}`;
  }

  return card.runSummary?.dateRange
    ?? (card.startedOn ? `Started ${formatIsoDate(card.startedOn)}` : null);
}

function resolveMetricTone(metric: ExperimentRunCardMetric): string {
  if (metric.sentiment === "positive") return "text-primary";
  if (metric.sentiment === "negative") return "text-amber-700";
  return "text-foreground";
}

function resolveMetricSentimentLabel(metric: ExperimentRunCardMetric): string | null {
  if (metric.sentiment === "positive") return ", favorable";
  if (metric.sentiment === "negative") return ", unfavorable";
  return null;
}

function isRedundantHistoryStatus(label: string): boolean {
  return /^(?:complete|completed|finished)$/iu.test(label.trim());
}

function clampProgress(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}
