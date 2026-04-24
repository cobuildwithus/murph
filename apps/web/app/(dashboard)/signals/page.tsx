"use client";

import { useMemo } from "react";
import { selectBrowserVaultSignals } from "@murphai/query/browser";

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
  const { client, error, refresh, status } = useBrowserVault();
  const signals = useMemo(() => client ? selectBrowserVaultSignals(client) : null, [client]);
  const assistantSummary = signals?.assistantSummary ?? {
    highlights: [],
    latestDate: null,
  };
  const sleep = signals?.sleep ?? [];
  const recovery = signals?.recovery ?? [];
  const activity = signals?.activity ?? [];
  const bodyState = signals?.bodyState ?? [];
  const sourceHealth = signals?.sourceHealth ?? [];
  const canRenderContent = status === "empty" || client !== null;
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
        <Card>
          <CardHeader>
            <CardTitle>No wearable signals yet</CardTitle>
            <CardDescription>
              Connect a source or sync more recent data to populate sleep, recovery, activity, and body metrics.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {canRenderContent && hasWearableData ? (
        <>
          <div className="grid gap-4 xl:grid-cols-4">
            <SignalSummaryCard
              description="Latest cross-provider sleep summary"
              extra={sleep[0] && sleep[0].sleepScore.selection.value !== null
                ? `Score ${formatMetricValue(sleep[0].sleepScore)}`
                : null}
              title="Sleep"
              value={sleep[0] ? formatMetricValue(sleep[0].totalSleepMinutes) : "—"}
              confidence={sleep[0]?.summaryConfidence.level ?? null}
            />
            <SignalSummaryCard
              description="Latest recovery and readiness summary"
              extra={recovery[0] && recovery[0].hrv.selection.value !== null
                ? `HRV ${formatMetricValue(recovery[0].hrv)}`
                : null}
              title="Recovery"
              value={recovery[0] ? formatMetricValue(recovery[0].readinessScore) : "—"}
              confidence={recovery[0]?.summaryConfidence.level ?? null}
            />
            <SignalSummaryCard
              description="Latest activity aggregate"
              extra={activity[0] && activity[0].sessionMinutes.selection.value !== null
                ? `${formatMetricValue(activity[0].sessionMinutes)} tracked`
                : null}
              title="Activity"
              value={activity[0] ? formatMetricValue(activity[0].steps) : "—"}
              confidence={activity[0]?.summaryConfidence.level ?? null}
            />
            <SignalSummaryCard
              description="Latest body-state summary"
              extra={bodyState[0] && bodyState[0].bodyFatPercentage.selection.value !== null
                ? `Body fat ${formatMetricValue(bodyState[0].bodyFatPercentage)}`
                : null}
              title="Body state"
              value={bodyState[0] ? formatMetricValue(bodyState[0].weightKg) : "—"}
              confidence={bodyState[0]?.summaryConfidence.level ?? null}
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

          <div className="grid gap-4 xl:grid-cols-3">
            <SignalListCard
              items={sleep.map((entry) => ({
                date: entry.date,
                detail: formatMetricValue(entry.totalSleepMinutes),
                note: entry.notes[0] ?? `Confidence ${formatConfidenceLabel(entry.summaryConfidence.level)}`,
                secondary: entry.sleepScore.selection.value !== null ? `Score ${formatMetricValue(entry.sleepScore)}` : null,
                title: "Sleep night",
              }))}
              title="Recent sleep"
            />
            <SignalListCard
              items={recovery.map((entry) => ({
                date: entry.date,
                detail: formatMetricValue(entry.readinessScore),
                note: entry.notes[0] ?? `Confidence ${formatConfidenceLabel(entry.summaryConfidence.level)}`,
                secondary: entry.hrv.selection.value !== null ? `HRV ${formatMetricValue(entry.hrv)}` : null,
                title: "Recovery day",
              }))}
              title="Recent recovery"
            />
            <SignalListCard
              items={activity.map((entry) => ({
                date: entry.date,
                detail: formatMetricValue(entry.steps),
                note: entry.activityTypes.length > 0
                  ? `Types: ${entry.activityTypes.join(", ")}`
                  : (entry.notes[0] ?? `Confidence ${formatConfidenceLabel(entry.summaryConfidence.level)}`),
                secondary: entry.sessionMinutes.selection.value !== null
                  ? `Tracked ${formatMetricValue(entry.sessionMinutes)}`
                  : null,
                title: "Activity day",
              }))}
              title="Recent activity"
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
