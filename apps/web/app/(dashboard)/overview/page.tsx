"use client";

import { useMemo } from "react";
import {
  buildOverviewMetrics,
  buildOverviewWeeklyStats,
  isActiveOverviewExperimentStatus,
  summarizeOverviewExperiments,
  summarizeRecentOverviewJournals,
} from "@murphai/query/browser";

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
import {
  formatIsoDate,
  formatNumber,
  formatPercent,
  formatStatusLabel,
  formatStreamLabel,
} from "@/src/lib/browser-vault/display";

export default function OverviewPage() {
  const { error, refresh, snapshot, status, vault } = useBrowserVault();
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const metrics = useMemo(() => buildOverviewMetrics(vault), [vault]);
  const experiments = useMemo(() => summarizeOverviewExperiments(vault, 8), [vault]);
  const recentJournals = useMemo(() => summarizeRecentOverviewJournals(vault, 4), [vault]);
  const weeklyStats = useMemo(
    () => buildOverviewWeeklyStats(vault, timeZone)
      .filter((entry) => entry.currentWeekAvg !== null || entry.previousWeekAvg !== null)
      .slice(0, 8),
    [timeZone, vault],
  );
  const activeExperiments = experiments.filter((entry) => isActiveOverviewExperimentStatus(entry.status));
  const completedExperiments = experiments.filter((entry) => !isActiveOverviewExperimentStatus(entry.status));
  const isEmpty =
    metrics.every((metric) => metric.value === 0) &&
    weeklyStats.length === 0 &&
    recentJournals.length === 0 &&
    experiments.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Browser vault snapshot
          </span>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            Where your data stands today
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Client-side decrypted summary built from your latest hosted vault snapshot.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {snapshot
            ? `Generated ${formatIsoDate(snapshot.generatedAt, {
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              month: "short",
              year: "numeric",
            })}`
            : "No browser snapshot yet."}
        </div>
      </div>

      {status === "loading" ? (
        <Card>
          <CardHeader>
            <CardTitle>Decrypting your vault</CardTitle>
            <CardDescription>
              Loading the latest encrypted browser snapshot and building your read model locally.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load your browser vault</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{error ?? "The browser vault session could not be created."}</span>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {status === "ready" && isEmpty ? (
        <Card>
          <CardHeader>
            <CardTitle>Your vault is ready for data</CardTitle>
            <CardDescription>
              We decrypted an empty or near-empty read model. As soon as journal entries, experiments, samples,
              or imports land in the vault, this page will populate automatically.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {status === "ready" && !isEmpty ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Tracked experiments</CardTitle>
                <CardDescription>
                  Active investigations from your vault plus the most recent completed ones.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Active now
                  </div>
                  <div className="mt-2 font-serif text-3xl font-semibold text-foreground">
                    {activeExperiments.length}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeExperiments.length > 0 ? activeExperiments.slice(0, 4).map((entry) => (
                      <Badge key={entry.id} variant="outline">
                        {entry.title}
                      </Badge>
                    )) : (
                      <span className="text-sm text-muted-foreground">No active experiments in the latest snapshot.</span>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Recently finished
                  </div>
                  <div className="mt-2 font-serif text-3xl font-semibold text-foreground">
                    {completedExperiments.length}
                  </div>
                  <div className="mt-3 text-sm text-muted-foreground">
                    {completedExperiments[0]
                      ? `${completedExperiments[0].title} started ${formatIsoDate(completedExperiments[0].startedOn)}.`
                      : "No completed experiments yet in the latest snapshot."}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Snapshot coverage</CardTitle>
                <CardDescription>
                  High-level counts from the local browser read model.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {metrics.slice(0, 4).map((metric) => (
                  <div key={metric.label} className="rounded-xl border border-border/70 bg-background/60 p-4">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {metric.label}
                    </div>
                    <div className="mt-2 font-serif text-3xl font-semibold text-foreground">
                      {formatNumber(metric.value, { maximumFractionDigits: 0 })}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{metric.note}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {metrics.map((metric) => (
              <Card key={metric.label} size="sm">
                <CardHeader>
                  <CardTitle>{metric.label}</CardTitle>
                  <CardDescription>{metric.note}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="font-serif text-3xl font-semibold text-foreground">
                    {formatNumber(metric.value, { maximumFractionDigits: 0 })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent journal entries</CardTitle>
                <CardDescription>
                  The latest narrative pages in your vault.
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
                    No journal entries were present in the latest browser snapshot.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent experiments</CardTitle>
                <CardDescription>
                  Experiments found directly from canonical vault entities.
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
                      {entry.summary ?? "No experiment summary text was available in the latest snapshot."}
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
                    No experiments were present in the latest browser snapshot.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Weekly sample deltas</CardTitle>
              <CardDescription>
                This week versus last week for numeric sample streams in your vault.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {weeklyStats.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Stream</TableHead>
                      <TableHead>This week</TableHead>
                      <TableHead>Last week</TableHead>
                      <TableHead>Delta</TableHead>
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
                  There were not enough numeric samples in the current and prior weeks to compute a delta table.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
