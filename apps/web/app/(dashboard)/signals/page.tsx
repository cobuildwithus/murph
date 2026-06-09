"use client";

import { useMemo } from "react";
import type { BrowserVaultMetricRow } from "@murphai/query/browser-replica-client";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { BrowserVaultProvider, useBrowserVault } from "@/src/lib/browser-vault/context";
import {
  formatConfidenceLabel,
  formatIsoDate,
  formatMetricValue,
  formatNumber,
} from "@/src/lib/browser-vault/display";

export default function SignalsPage() {
  return (
    <BrowserVaultProvider>
      <SignalsPageContent />
    </BrowserVaultProvider>
  );
}

function SignalsPageContent() {
  const { client, error, refresh, refreshPending, status } = useBrowserVault();
  const signalRows = useMemo(() => client ? client.metrics.series() : [], [client]);
  const signalSummaries = useMemo(() => summarizeSignalRows(signalRows), [signalRows]);
  const assistantSummary = client?.replica.assistantSummary ?? {
    highlights: [],
    latestDate: null,
  };
  const sleep = signalSummaries.sleep;
  const recovery = signalSummaries.recovery;
  const activity = signalSummaries.activity;
  const bodyState = signalSummaries.bodyState;
  const sourceHealth = client?.replica.sourceHealthRows ?? [];
  const canRenderContent = status === "empty" || client !== null;
  const isPreparingEmptyReplica = status === "empty" && refreshPending;
  const hasWearableData =
    sleep.length > 0 ||
    recovery.length > 0 ||
    activity.length > 0 ||
    bodyState.length > 0 ||
    sourceHealth.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Signals
          </span>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            Wearable summaries from your vault
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sleep, recovery, activity, and body metrics when connected data is available.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {assistantSummary.latestDate
            ? `Latest data ${formatIsoDate(assistantSummary.latestDate)}`
            : client
              ? `Updated ${formatIsoDate(client.replica.generatedAt)}`
              : isPreparingEmptyReplica
                ? "Preparing signals."
                : "No signals available yet."}
        </div>
      </div>

      {status === "loading" ? (
        <Card>
          <CardHeader>
            <CardTitle>Loading your signals</CardTitle>
            <CardDescription>
              Loading recent wearable summaries.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load signal summaries</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{error ?? "Your recent signal summaries could not be decrypted."}</span>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {canRenderContent && !hasWearableData ? (
        <Card
          aria-live={isPreparingEmptyReplica ? "polite" : undefined}
          role={isPreparingEmptyReplica ? "status" : undefined}
        >
          <CardHeader>
            <CardTitle>
              {isPreparingEmptyReplica ? "Preparing your signals" : "No wearable signals yet"}
            </CardTitle>
            <CardDescription>
              {isPreparingEmptyReplica
                ? "Your latest signal data is still being prepared."
                : "Connect a source or sync more recent data to populate sleep, recovery, activity, and body metrics."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {canRenderContent && hasWearableData ? (
        <>
          <div className="grid gap-4 xl:grid-cols-4">
            <SignalSummaryCard
              description="Latest cross-provider sleep summary"
              extra={formatSecondarySignal(sleep[0], (value) => `Score ${value}`)}
              title="Sleep"
              value={sleep[0] ? formatMetricValue(selectDisplayMetric(sleep[0])) : "—"}
              confidence={sleep[0]?.confidence ?? null}
            />
            <SignalSummaryCard
              description="Latest recovery and readiness summary"
              extra={formatSecondarySignal(recovery[0], (value) => `HRV ${value}`)}
              title="Recovery"
              value={recovery[0] ? formatMetricValue(selectDisplayMetric(recovery[0])) : "—"}
              confidence={recovery[0]?.confidence ?? null}
            />
            <SignalSummaryCard
              description="Latest activity aggregate"
              extra={formatSecondarySignal(activity[0], (value) => `${value} tracked`)}
              title="Activity"
              value={activity[0] ? formatMetricValue(selectDisplayMetric(activity[0])) : "—"}
              confidence={activity[0]?.confidence ?? null}
            />
            <SignalSummaryCard
              description="Latest body-state summary"
              extra={formatSecondarySignal(bodyState[0], (value) => `Body fat ${value}`)}
              title="Body state"
              value={bodyState[0] ? formatMetricValue(selectDisplayMetric(bodyState[0])) : "—"}
              confidence={bodyState[0]?.confidence ?? null}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Assistant highlights</CardTitle>
              <CardDescription>
                Recent takeaways generated from the latest signal summaries.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {assistantSummary.highlights.map((highlight, index) => (
                <div key={`${index}:${highlight}`} className="rounded-xl border border-border/70 bg-background/60 p-4 text-sm text-foreground">
                  {highlight}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-4">
            <SignalListCard
              items={sleep.map((entry) => ({
                date: entry.date,
                detail: formatMetricValue(selectDisplayMetric(entry)),
                note: entry.note,
                secondary: formatSecondarySignal(entry, (value) => `Score ${value}`),
                title: entry.title,
              }))}
              title="Recent sleep"
            />
            <SignalListCard
              items={recovery.map((entry) => ({
                date: entry.date,
                detail: formatMetricValue(selectDisplayMetric(entry)),
                note: entry.note,
                secondary: formatSecondarySignal(entry, (value) => `HRV ${value}`),
                title: entry.title,
              }))}
              title="Recent recovery"
            />
            <SignalListCard
              items={activity.map((entry) => ({
                date: entry.date,
                detail: formatMetricValue(selectDisplayMetric(entry)),
                note: entry.note,
                secondary: formatSecondarySignal(entry, (value) => `Tracked ${value}`),
                title: entry.title,
              }))}
              title="Recent activity"
            />
            <SignalListCard
              items={bodyState.map((entry) => ({
                date: entry.date,
                detail: formatMetricValue(selectDisplayMetric(entry)),
                note: entry.note,
                secondary: formatSecondarySignal(entry, (value) => `Body fat ${value}`),
                title: entry.title,
              }))}
              title="Recent body state"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Provider source health</CardTitle>
              <CardDescription>
                Freshness and contribution by connected provider.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sourceHealth.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Last date</TableHead>
                      <TableHead>Sleep</TableHead>
                      <TableHead>Recovery</TableHead>
                      <TableHead>Activity</TableHead>
                      <TableHead>Body</TableHead>
                      <TableHead>Selected metrics</TableHead>
                      <TableHead>Conflicts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sourceHealth.map((entry) => (
                      <TableRow key={entry.provider}>
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{entry.providerDisplayName}</span>
                            {entry.stalenessVsNewestDays !== null && entry.stalenessVsNewestDays > 0 ? (
                              <Badge variant="outline">+{entry.stalenessVsNewestDays}d stale</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{formatIsoDate(entry.lastDate)}</TableCell>
                        <TableCell>{formatNumber(entry.sleepNights, { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell>{formatNumber(entry.recoveryDays, { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell>{formatNumber(entry.activityDays, { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell>{formatNumber(entry.bodyStateDays, { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell>{formatNumber(entry.selectedMetrics, { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell>{formatNumber(entry.conflictCount, { maximumFractionDigits: 0 })}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-background/40 p-4 text-sm text-muted-foreground">
                  No provider summary was available.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

type SignalMetric = {
  selection: {
    unit: string | null;
    value: number | null;
  };
};

type SignalDaySummary = {
  confidence: string | null;
  date: string;
  note: string;
  primary: SignalMetric;
  secondary: SignalMetric;
  title: string;
};

function summarizeSignalRows(rows: readonly BrowserVaultMetricRow[]): {
  activity: SignalDaySummary[];
  bodyState: SignalDaySummary[];
  recovery: SignalDaySummary[];
  sleep: SignalDaySummary[];
} {
  const rowsByDate = groupMetricRowsByDate(rows);
  const dates = [...rowsByDate.keys()].sort((left, right) => right.localeCompare(left));
  return {
    activity: dates
      .map((date) => dateToSignalSummary(date, rowsByDate.get(date) ?? [], {
        primary: "steps",
        secondary: "activity-minutes",
        title: "Activity day",
      }))
      .filter(hasSignalData),
    bodyState: dates
      .map((date) => dateToSignalSummary(date, rowsByDate.get(date) ?? [], {
        primary: "body-weight",
        secondary: "body-fat-percentage",
        title: "Body state",
      }))
      .filter(hasSignalData),
    recovery: dates
      .map((date) => dateToSignalSummary(date, rowsByDate.get(date) ?? [], {
        primary: "readiness-score",
        secondary: "hrv-rmssd",
        title: "Recovery day",
      }))
      .filter(hasSignalData),
    sleep: dates
      .map((date) => dateToSignalSummary(date, rowsByDate.get(date) ?? [], {
        primary: "total-sleep-minutes",
        secondary: "sleep-score",
        title: "Sleep night",
      }))
      .filter(hasSignalData),
  };
}

function dateToSignalSummary(
  date: string,
  rows: readonly BrowserVaultMetricRow[],
  config: { primary: string; secondary: string; title: string },
): SignalDaySummary {
  const primary = findMetricRow(rows, config.primary);
  const secondary = findMetricRow(rows, config.secondary);
  const confidence = primary?.confidence ?? secondary?.confidence ?? "none";
  return {
    confidence,
    date,
    note: `Confidence ${formatConfidenceLabel(confidence)}`,
    primary: metricForRow(primary),
    secondary: metricForRow(secondary),
    title: config.title,
  };
}

function groupMetricRowsByDate(rows: readonly BrowserVaultMetricRow[]): Map<string, BrowserVaultMetricRow[]> {
  const output = new Map<string, BrowserVaultMetricRow[]>();
  for (const row of rows) {
    const bucket = output.get(row.date) ?? [];
    bucket.push(row);
    output.set(row.date, bucket);
  }
  return output;
}

function findMetricRow(rows: readonly BrowserVaultMetricRow[], metricKey: string): BrowserVaultMetricRow | null {
  return rows
    .filter((row) => row.metricKey === metricKey && typeof row.value === "number" && Number.isFinite(row.value))
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id))
    .at(-1) ?? null;
}

function metricForRow(row: BrowserVaultMetricRow | null): SignalMetric {
  return { selection: { unit: row?.unit ?? null, value: row?.value ?? null } };
}

function hasSignalData(summary: SignalDaySummary): boolean {
  return hasMetricValue(summary.primary) || hasMetricValue(summary.secondary);
}

function selectDisplayMetric(summary: SignalDaySummary): SignalMetric {
  return hasMetricValue(summary.primary) ? summary.primary : summary.secondary;
}

function formatSecondarySignal(
  summary: SignalDaySummary | undefined,
  format: (value: string) => string,
): string | null {
  if (!summary || !hasMetricValue(summary.primary) || !hasMetricValue(summary.secondary)) {
    return null;
  }

  return format(formatMetricValue(summary.secondary));
}

function hasMetricValue(metric: SignalMetric): boolean {
  return metric.selection.value !== null;
}

function SignalSummaryCard({
  confidence,
  description,
  extra,
  title,
  value,
}: {
  confidence: string | null;
  description: string;
  extra: string | null;
  title: string;
  value: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="font-serif text-3xl font-semibold text-foreground">{value}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {confidence ? <Badge variant="outline">{formatConfidenceLabel(confidence)} confidence</Badge> : null}
          {extra ? <Badge variant="secondary">{extra}</Badge> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function SignalListCard({
  items,
  title,
}: {
  items: { date: string; detail: string; note: string; secondary: string | null; title: string }[];
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Most recent entries included in your dashboard.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length > 0 ? items.map((entry, index) => (
          <div key={`${entry.date}:${index}`} className="rounded-xl border border-border/70 bg-background/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{entry.title}</span>
              <Badge variant="outline">{formatIsoDate(entry.date)}</Badge>
            </div>
            <div className="mt-2 font-serif text-2xl font-semibold text-foreground">{entry.detail}</div>
            <div className="mt-2 text-sm text-muted-foreground">{entry.note}</div>
            {entry.secondary ? (
              <div className="mt-2 text-xs text-muted-foreground">{entry.secondary}</div>
            ) : null}
          </div>
        )) : (
          <div className="rounded-xl border border-dashed border-border bg-background/40 p-4 text-sm text-muted-foreground">
            No wearable entries were available for this category.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
