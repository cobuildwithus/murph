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
  variant: "history" | "progress";
}

export function HomeExperimentCard({ card, variant }: HomeExperimentCardProps) {
  const dateLabel = resolveDateLabel(card);
  const content = (
    <article
      className={cn(
        "group flex h-full flex-col rounded-xl border border-border/70 bg-card/70 transition-colors",
        variant === "history" ? "p-4" : "min-h-[240px] p-5",
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
          <h3 className={cn(
            "mt-1 text-balance font-serif font-semibold leading-tight text-foreground",
            variant === "history" ? "text-lg" : "text-xl",
          )}>
            {card.title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {variant === "progress" && card.privateBadgeLabel ? (
            <span
              className="inline-flex size-7 items-center justify-center rounded-full border border-border/70 text-muted-foreground"
              title={card.privateBadgeLabel}
            >
              <LockKeyhole aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{card.privateBadgeLabel}</span>
            </span>
          ) : null}
          {card.statusLabel && (
            variant === "progress" || !isRedundantHistoryStatus(card.statusLabel)
          ) ? (
            <Badge variant={card.statusVariant ?? "outline"} className="font-normal">
              {card.statusLabel}
            </Badge>
          ) : null}
        </div>
      </header>

      <div className={cn(
        "flex flex-1 items-center border-t border-border/60",
        variant === "history" ? "mt-3 pt-3" : "mt-5 pt-5",
      )}>
        <ExperimentDataVisual card={card} variant={variant} />
      </div>

      <footer className={cn(
        "flex items-center justify-between gap-4 text-[11px] text-muted-foreground",
        variant === "history" ? "mt-3" : "mt-5",
      )}>
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate tabular-nums">
          {variant === "history" && card.privateBadgeLabel ? (
            <>
              <LockKeyhole aria-hidden="true" className="size-3 shrink-0" />
              <span className="sr-only">{card.privateBadgeLabel}</span>
            </>
          ) : null}
          {dateLabel ?? "Stored in your private vault"}
        </span>
        {variant === "progress" && card.href ? (
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
      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {content}
    </Link>
  );
}

function ExperimentDataVisual({ card, variant }: HomeExperimentCardProps) {
  const summary = card.runSummary;
  const primaryMetric = summary?.metric;
  const comparableMetrics = summary?.metrics.filter((metric) => metric.delta?.trim()) ?? [];

  if (variant === "progress" && typeof summary?.completionPercent === "number") {
    return <ExperimentProgress summary={summary} />;
  }

  if (variant === "history" && comparableMetrics.length > 0) {
    return <ExperimentResults metrics={comparableMetrics} />;
  }

  if (variant === "progress" && primaryMetric) {
    return <ExperimentResult metric={primaryMetric} />;
  }

  const fallback = variant === "progress"
    ? "Collecting data"
    : summary
      ? "No clear signal"
      : card.statusLabel ?? "Private run";

  return (
    <div className="w-full">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Experiment status
      </p>
      <p className="mt-2 font-serif text-3xl font-semibold leading-none text-foreground">
        {fallback}
      </p>
    </div>
  );
}

function ExperimentResults({ metrics }: { metrics: ExperimentRunCardMetric[] }) {
  return (
    <div className="grid w-full grid-cols-2 gap-x-4 gap-y-3">
      {metrics.map((metric, index) => (
        <div key={`${metric.label}:${index}`} className="min-w-0">
          <p className="font-mono text-[9px] uppercase leading-tight tracking-widest text-muted-foreground">
            {metric.label}
          </p>
          <p className={cn(
            "mt-1 font-serif text-xl font-semibold leading-none tabular-nums",
            resolveMetricTone(metric),
          )}>
            {metric.delta || metric.current}
          </p>
        </div>
      ))}
    </div>
  );
}

function ExperimentResult({ metric }: { metric: ExperimentRunCardMetric }) {
  const headline = metric.delta || metric.current;

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
  return "text-foreground";
}

function isRedundantHistoryStatus(label: string): boolean {
  return /^(?:complete|completed|finished)$/iu.test(label.trim());
}

function clampProgress(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}
