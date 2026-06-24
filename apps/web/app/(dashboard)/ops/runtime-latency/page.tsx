import type { Metadata } from "next";

import { readHostedIngressLatencyDashboard } from "@/src/lib/hosted-runtime-latency/store";
import {
  HOSTED_INGRESS_LATENCY_SOURCES,
  type HostedIngressLatencySource,
} from "@murphai/hosted-execution/runtime-control";
import { requireHostedRuntimeLatencyOpsAccess } from "@/src/lib/hosted-runtime-latency/ops-access";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Runtime latency - Murph",
};

type RuntimeLatencySearchParams = {
  limit?: string | string[];
  source?: string | string[];
  windowHours?: string | string[];
};

export default async function RuntimeLatencyOpsPage({
  searchParams,
}: {
  searchParams?: Promise<RuntimeLatencySearchParams>;
} = {}) {
  await getHostedDashboardPageAuthSnapshot();
  await requireHostedRuntimeLatencyOpsAccess();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const dashboard = await readHostedIngressLatencyDashboard({
    limit: readPositiveIntegerSearchParam(resolvedSearchParams.limit, 20),
    source: readRuntimeLatencySourceSearchParam(resolvedSearchParams.source),
    windowHours: readPositiveIntegerSearchParam(resolvedSearchParams.windowHours, 24),
  });
  const metricScope = dashboard.truncated ? "sampled" : null;
  const completedPercent = dashboard.totalAcceptedCount > 0
    ? Math.round((dashboard.completedCount / dashboard.totalAcceptedCount) * 100)
    : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
              Ops notebook
            </span>
            <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
              Hosted runtime latency
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              {dashboard.source} mailbox accepted to provider start, measured over the last{" "}
              {dashboard.window.hours} hours.{" "}
              {dashboard.truncated
                ? `Metrics use the newest ${formatInteger(dashboard.readLimit)} accepted rows.`
                : "Metrics use the complete window."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SummaryChip label="Source" value={dashboard.source} />
            <SummaryChip label="Window end" value={formatDateTime(dashboard.window.end)} />
            <SummaryChip
              label="Read"
              value={dashboard.truncated ? `Newest ${formatInteger(dashboard.readLimit)}` : "Complete"}
            />
          </div>
        </div>
      </header>

      <section aria-labelledby="runtime-latency-distribution-title" className="flex flex-col gap-4">
        <SectionHeading
          title="Provider start distribution"
          description="End-to-end wait from mailbox accepted to first provider generation signal."
          id="runtime-latency-distribution-title"
        />
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label={metricLabel("p50", metricScope)} value={formatMs(dashboard.percentileMs.p50)} />
          <Metric label={metricLabel("p95", metricScope)} value={formatMs(dashboard.percentileMs.p95)} />
          <Metric
            emphasis
            label={metricLabel("p99", metricScope)}
            value={formatMs(dashboard.percentileMs.p99)}
          />
          <Metric label={metricLabel("accepted", metricScope)} value={formatInteger(dashboard.totalAcceptedCount)} />
          <Metric
            helper={completedPercent === null ? null : `${formatInteger(completedPercent)}% of accepted`}
            label={metricLabel("completed", metricScope)}
            value={formatInteger(dashboard.completedCount)}
          />
          <Metric label={metricLabel("in flight", metricScope)} value={formatInteger(dashboard.recentInFlightCount)} />
        </div>
      </section>

      <section aria-labelledby="runtime-latency-stage-title" className="flex flex-col gap-4">
        <SectionHeading
          title="Pipeline stages"
          description="P50 stage timing isolates queue handoff, staging, and provider wait."
          id="runtime-latency-stage-title"
        />
        <div className="grid overflow-hidden rounded-xl border border-border/70 bg-card/90 md:grid-cols-3">
          <StageMetric
            label={metricLabel("accepted to signal p50", metricScope)}
            value={formatMs(dashboard.stageLatencyMs.acceptedToTemporalSignalP50)}
          />
          <StageMetric
            label={metricLabel("accepted to staged p50", metricScope)}
            value={formatMs(dashboard.stageLatencyMs.acceptedToStagedP50)}
          />
          <StageMetric
            label={metricLabel("staged to provider p50", metricScope)}
            value={formatMs(dashboard.stageLatencyMs.stagedToProviderStartP50)}
          />
        </div>
      </section>

      <section aria-labelledby="runtime-latency-quality-title" className="flex flex-col gap-4">
        <SectionHeading
          title="Trace quality"
          description="Rows that need attention before percentile math can be trusted."
          id="runtime-latency-quality-title"
        />
        <div className="grid gap-3 md:grid-cols-4">
          <Metric
            label={metricLabel("missing staged", metricScope)}
            tone={dashboard.missingStagedCount > 0 ? "warning" : "default"}
            value={formatInteger(dashboard.missingStagedCount)}
          />
          <Metric
            label={metricLabel("missing provider", metricScope)}
            tone={dashboard.missingProviderStartCount > 0 ? "warning" : "default"}
            value={formatInteger(dashboard.missingProviderStartCount)}
          />
          <Metric
            label={metricLabel("staged missing provider", metricScope)}
            tone={dashboard.stagedButMissingProviderCount > 0 ? "warning" : "default"}
            value={formatInteger(dashboard.stagedButMissingProviderCount)}
          />
          <Metric
            label={metricLabel("invalid negative", metricScope)}
            tone={dashboard.invalidNegativeLatencyCount > 0 ? "warning" : "default"}
            value={formatInteger(dashboard.invalidNegativeLatencyCount)}
          />
        </div>
      </section>

      <section
        aria-labelledby="runtime-latency-slow-rows-title"
        className="overflow-hidden rounded-xl border border-border/70 bg-card/90"
      >
        <div className="flex flex-col gap-2 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
              Outliers
            </span>
            <h2
              className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground"
              id="runtime-latency-slow-rows-title"
            >
              Slow rows
            </h2>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {dashboard.truncated ? `first ${dashboard.readLimit}` : "complete read"}
          </span>
        </div>
        <Table className="text-[13px]">
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>Mailbox accepted</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Signal</TableHead>
              <TableHead className="text-right">Staged</TableHead>
              <TableHead className="text-right">Provider wait</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dashboard.recentSlowRows.length > 0
              ? dashboard.recentSlowRows.map((row) => (
                  <TableRow key={row.rowLabel}>
                    <TableCell className="font-mono text-xs text-foreground">{row.rowLabel}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDateTime(row.acceptedAt)}
                    </TableCell>
                    <TableCell className="text-right font-serif text-base font-semibold tabular-nums text-foreground">
                      {formatMs(row.acceptedToProviderStartMs)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatMs(row.acceptedToTemporalSignalMs)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatMs(row.acceptedToStagedMs)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatMs(row.stagedToProviderStartMs)}
                    </TableCell>
                  </TableRow>
                ))
              : (
                  <TableRow>
                    <TableCell className="px-5 py-8 text-sm text-muted-foreground" colSpan={6}>
                      No completed rows in this window.
                    </TableCell>
                  </TableRow>
                )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function SectionHeading(input: {
  description: string;
  id: string;
  title: string;
}) {
  return (
    <div>
      <h2
        className="font-serif text-xl font-semibold tracking-tight text-foreground"
        id={input.id}
      >
        {input.title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
        {input.description}
      </p>
    </div>
  );
}

function SummaryChip(input: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-1 font-mono text-[11px] font-medium text-foreground">
        {input.value}
      </div>
    </div>
  );
}

function Metric(input: {
  emphasis?: boolean;
  helper?: string | null;
  label: string;
  tone?: "default" | "warning";
  value: string;
}) {
  const tone = input.tone ?? "default";
  const valueClassName = tone === "warning"
    ? "text-chart-4"
    : input.emphasis
      ? "text-primary"
      : "text-foreground";

  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card/90 px-4 py-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {input.label}
      </div>
      <div className={`mt-2 min-w-0 break-words font-serif text-3xl font-semibold leading-none tracking-tight tabular-nums ${valueClassName}`}>
        {input.value}
      </div>
      {input.helper ? (
        <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {input.helper}
        </div>
      ) : null}
    </div>
  );
}

function StageMetric(input: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 border-b border-border/70 px-5 py-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-3 font-serif text-2xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {input.value}
      </div>
    </div>
  );
}

function readSingleSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }
  return value?.trim() || null;
}

function readPositiveIntegerSearchParam(
  value: string | string[] | undefined,
  fallback: number,
): number {
  const raw = readSingleSearchParam(value);
  if (!raw) {
    return fallback;
  }
  if (!/^[1-9]\d*$/u.test(raw)) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRuntimeLatencySourceSearchParam(
  value: string | string[] | undefined,
): HostedIngressLatencySource {
  const source = readSingleSearchParam(value);
  return source && (HOSTED_INGRESS_LATENCY_SOURCES as readonly string[]).includes(source)
    ? source as HostedIngressLatencySource
    : "linq";
}

function formatMs(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return `${formatInteger(value)} ms`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function metricLabel(label: string, scope: string | null): string {
  return scope ? `${label} ${scope}` : label;
}
