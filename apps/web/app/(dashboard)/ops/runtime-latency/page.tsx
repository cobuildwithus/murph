import type { Metadata } from "next";

import { readHostedIngressLatencyDashboard } from "@/src/lib/hosted-runtime-latency/store";
import {
  HOSTED_INGRESS_LATENCY_SOURCES,
  type HostedIngressLatencySource,
} from "@murphai/hosted-execution/runtime-control";
import { requireHostedRuntimeLatencyOpsAccess } from "@/src/lib/hosted-runtime-latency/ops-access";
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
  await requireHostedRuntimeLatencyOpsAccess();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const dashboard = await readHostedIngressLatencyDashboard({
    limit: readPositiveIntegerSearchParam(resolvedSearchParams.limit, 20),
    source: readRuntimeLatencySourceSearchParam(resolvedSearchParams.source),
    windowHours: readPositiveIntegerSearchParam(resolvedSearchParams.windowHours, 24),
  });
  const metricScope = dashboard.truncated ? "sampled" : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Ops
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Hosted runtime latency
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {dashboard.source} accepted to provider start, {dashboard.window.hours}h window.
            {" "}
            {dashboard.truncated
              ? `Showing metrics from newest ${formatInteger(dashboard.readLimit)} accepted rows.`
              : "Showing complete window metrics."}
          </p>
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          {formatDateTime(dashboard.window.end)}
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label={metricLabel("p50", metricScope)} value={formatMs(dashboard.percentileMs.p50)} />
        <Metric label={metricLabel("p95", metricScope)} value={formatMs(dashboard.percentileMs.p95)} />
        <Metric label={metricLabel("p99", metricScope)} value={formatMs(dashboard.percentileMs.p99)} />
        <Metric label={metricLabel("accepted", metricScope)} value={formatInteger(dashboard.totalAcceptedCount)} />
        <Metric label={metricLabel("completed", metricScope)} value={formatInteger(dashboard.completedCount)} />
        <Metric label={metricLabel("in flight", metricScope)} value={formatInteger(dashboard.recentInFlightCount)} />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Metric
          label={metricLabel("accepted to signal p50", metricScope)}
          value={formatMs(dashboard.stageLatencyMs.acceptedToTemporalSignalP50)}
        />
        <Metric
          label={metricLabel("accepted to staged p50", metricScope)}
          value={formatMs(dashboard.stageLatencyMs.acceptedToStagedP50)}
        />
        <Metric
          label={metricLabel("staged to provider p50", metricScope)}
          value={formatMs(dashboard.stageLatencyMs.stagedToProviderStartP50)}
        />
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label={metricLabel("missing staged", metricScope)} value={formatInteger(dashboard.missingStagedCount)} />
        <Metric label={metricLabel("missing provider", metricScope)} value={formatInteger(dashboard.missingProviderStartCount)} />
        <Metric label={metricLabel("staged missing provider", metricScope)} value={formatInteger(dashboard.stagedButMissingProviderCount)} />
        <Metric label={metricLabel("invalid negative", metricScope)} value={formatInteger(dashboard.invalidNegativeLatencyCount)} />
      </section>

      <section className="rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">Slow rows</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {dashboard.truncated ? `first ${dashboard.readLimit}` : "complete read"}
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>Accepted</TableHead>
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
                    <TableCell className="font-mono text-xs">{row.rowLabel}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDateTime(row.acceptedAt)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
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
                    <TableCell className="text-sm text-muted-foreground" colSpan={6}>
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

function Metric(input: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-2 font-mono text-xl font-semibold text-foreground">
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
  }).format(new Date(value));
}

function metricLabel(label: string, scope: string | null): string {
  return scope ? `${label} ${scope}` : label;
}
