"use client";

import { useMemo } from "react";
import {
  buildOverviewWeeklyStatsFromDailySampleSummaries,
  isActiveOverviewExperimentStatus,
  selectBrowserVaultOverview,
} from "@murphai/query/browser-overview";

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
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import { PersonalPatternsSection } from "@/src/components/overview/personal-patterns-section";
import {
  formatIsoDate,
  formatNumber,
  formatPercent,
  formatStatusLabel,
  formatStreamLabel,
} from "@/src/lib/browser-vault/display";

export default function OverviewPage() {
  const { client, error, refresh, refreshPending, status } = useBrowserVault();
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const overview = useMemo(() => client ? selectBrowserVaultOverview(client) : null, [client]);
  const metrics = overview?.metrics ?? [];
  const experimentSummary = overview?.experimentSummary;
  const personalPatterns = overview?.personalPatterns;
  const allExperiments = overview?.trackedExperiments ?? [];
  const experiments = allExperiments.slice(0, 8);
  const recentJournals = overview?.recentJournals ?? [];
  const weeklyStats = useMemo(
    () => buildOverviewWeeklyStatsFromDailySampleSummaries(
      overview?.weeklySampleSummaries ?? [],
      timeZone,
      client?.replica.generatedAt ?? new Date(),
    )
      .filter((entry) => entry.currentWeekAvg !== null || entry.previousWeekAvg !== null)
      .slice(0, 8),
    [client, overview, timeZone],
  );
  const canRenderContent = status === "empty" || client !== null;
  const isPreparingEmptyReplica = status === "empty" && refreshPending;
  const isEmpty =
    metrics.every((metric) => metric.value === 0) &&
    weeklyStats.length === 0 &&
    recentJournals.length === 0 &&
    experiments.length === 0 &&
    (personalPatterns?.testedCellCount ?? 0) === 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Overview
          </span>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            Where your data stands today
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A quick read on your recent notes, experiments, and tracked trends.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {client
            ? `Updated ${formatIsoDate(client.replica.generatedAt, {
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              month: "short",
              year: "numeric",
            })}`
            : isPreparingEmptyReplica
              ? "Preparing overview."
              : "No overview available yet."}
        </div>
      </div>

      {status === "loading" ? (
        <Card>
          <CardHeader>
            <CardTitle>Loading your overview</CardTitle>
            <CardDescription>
              Loading your latest dashboard data.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load your overview</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{error ?? "We couldn't unlock your dashboard data right now."}</span>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {canRenderContent && isEmpty ? (
        <Card
          aria-live={isPreparingEmptyReplica ? "polite" : undefined}
          role={isPreparingEmptyReplica ? "status" : undefined}
        >
          <CardHeader>
            <CardTitle>
              {isPreparingEmptyReplica
                ? "Preparing your dashboard"
                : "Your dashboard is ready for data"}
            </CardTitle>
            <CardDescription>
              {isPreparingEmptyReplica
                ? "Your latest dashboard data is still being prepared."
                : "As soon as you add notes, experiments, or measurements, this page will fill in automatically."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {canRenderContent && !isEmpty ? (
        <>
          {personalPatterns ? <PersonalPatternsSection report={personalPatterns} /> : null}

          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Tracked experiments</CardTitle>
                <CardDescription>
                  What is active now and what finished recently.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Active now
                  </div>
                  <div className="mt-2 font-serif text-3xl font-semibold text-foreground">
                    {experimentSummary?.activeCount ?? 0}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {experimentSummary && experimentSummary.activePreview.length > 0
                      ? experimentSummary.activePreview.map((entry) => (
                        <Badge key={entry.id} variant="outline">
                          {entry.title}
                        </Badge>
                      )) : (
                      <span className="text-sm text-muted-foreground">No active experiments right now.</span>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Recently finished
                  </div>
                  <div className="mt-2 font-serif text-3xl font-semibold text-foreground">
                    {experimentSummary?.completedCount ?? 0}
                  </div>
                  <div className="mt-3 text-sm text-muted-foreground">
                    {experimentSummary?.latestCompleted
                      ? `${experimentSummary.latestCompleted.title} started ${formatIsoDate(experimentSummary.latestCompleted.startedOn)}.`
                      : "No completed experiments yet."}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Included today</CardTitle>
                <CardDescription>
                  Counts available in this dashboard.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-background/60 p-4"
                  >
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {metric.label}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{metric.note}</div>
                    </div>
                    <div className="font-serif text-3xl font-semibold text-foreground">
                      {formatNumber(metric.value, { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent journal entries</CardTitle>
                <CardDescription>
                  Recent notes included in your dashboard.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {recentJournals.length > 0 ? recentJournals.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-border/70 bg-background/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-foreground">{entry.title}</div>
                      <Badge variant="outline">{formatIsoDate(entry.date)}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {entry.summary ?? "No summary text was available for this journal entry."}
                    </p>
                    {entry.tags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entry.tags.slice(0, 4).map((tag) => (
                          <Badge key={`${entry.id}:${tag}`} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed border-border bg-background/40 p-4 text-sm text-muted-foreground">
                    No journal entries are available yet.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent experiments</CardTitle>
                <CardDescription>
                  Recent experiments available in your dashboard.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {experiments.length > 0 ? experiments.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-border/70 bg-background/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-foreground">{entry.title}</div>
                    <Badge variant={isActiveOverviewExperimentStatus(entry.status) ? "default" : "outline"}>
                      {formatStatusLabel(entry.status)}
                    </Badge>
                      {entry.startedOn ? (
                        <Badge variant="secondary">{formatIsoDate(entry.startedOn)}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {entry.summary ?? "No experiment summary was available."}
                    </p>
                    {entry.tags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entry.tags.slice(0, 4).map((tag) => (
                          <Badge key={`${entry.id}:${tag}`} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed border-border bg-background/40 p-4 text-sm text-muted-foreground">
                    No experiments are available yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Weekly changes</CardTitle>
              <CardDescription>
                How this week compares to last week across what you track.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {weeklyStats.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      <TableHead>This week</TableHead>
                      <TableHead>Last week</TableHead>
                      <TableHead>Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyStats.map((entry) => (
                      <TableRow key={`${entry.stream}:${entry.unit ?? "none"}`}>
                        <TableCell className="font-medium">{formatStreamLabel(entry.stream)}</TableCell>
                        <TableCell>
                          {entry.currentWeekAvg !== null
                            ? `${formatNumber(entry.currentWeekAvg)}${entry.unit ? ` ${entry.unit}` : ""}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {entry.previousWeekAvg !== null
                            ? `${formatNumber(entry.previousWeekAvg)}${entry.unit ? ` ${entry.unit}` : ""}`
                            : "—"}
                        </TableCell>
                        <TableCell>{formatPercent(entry.deltaPercent)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-background/40 p-4 text-sm text-muted-foreground">
                  Not enough data yet to compare this week with last week.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
