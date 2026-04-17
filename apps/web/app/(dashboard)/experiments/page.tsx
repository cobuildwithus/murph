"use client";

import { useMemo, useState } from "react";
import {
  isActiveOverviewExperimentStatus,
  summarizeOverviewExperiments,
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
import { Input } from "@/src/components/ui/input";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import { formatIsoDate, formatStatusLabel } from "@/src/lib/browser-vault/display";

export default function ExperimentsPage() {
  const [search, setSearch] = useState("");
  const { error, refresh, status, vault } = useBrowserVault();
  const trackedExperiments = useMemo(
    () => summarizeOverviewExperiments(vault, 12),
    [vault],
  );
  const filteredTrackedExperiments = useMemo(
    () => trackedExperiments.filter((entry) => matchesTrackedExperiment(entry, search)),
    [search, trackedExperiments],
  );
  const activeCount = trackedExperiments.filter((entry) => isActiveOverviewExperimentStatus(entry.status)).length;
  const completedCount = trackedExperiments.length - activeCount;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Browser vault snapshot
          </span>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            Tracked experiments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Active and completed experiment entities decrypted from your latest hosted browser snapshot.
          </p>
        </div>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search tracked experiments..."
          className="w-full sm:w-64"
        />
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Snapshot coverage
          </span>
          <span className="text-xs text-muted-foreground">
            {trackedExperiments.length} tracked entities
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Active now</CardTitle>
              <CardDescription>Experiments still in motion in the latest snapshot.</CardDescription>
            </CardHeader>
            <CardContent className="font-serif text-3xl font-semibold text-foreground">
              {activeCount}
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Completed</CardTitle>
              <CardDescription>Finished experiments that remain queryable from the snapshot.</CardDescription>
            </CardHeader>
            <CardContent className="font-serif text-3xl font-semibold text-foreground">
              {completedCount}
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Matching search</CardTitle>
              <CardDescription>Tracked entities currently surfaced by the local filter.</CardDescription>
            </CardHeader>
            <CardContent className="font-serif text-3xl font-semibold text-foreground">
              {filteredTrackedExperiments.length}
            </CardContent>
          </Card>
        </div>

        {status === "loading" ? (
          <Card>
            <CardHeader>
              <CardTitle>Loading tracked experiments</CardTitle>
              <CardDescription>
                Creating your browser vault session and reading experiment entities locally.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {status === "error" ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load your tracked experiments</AlertTitle>
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

        {status === "ready" && filteredTrackedExperiments.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No tracked experiments matched</CardTitle>
              <CardDescription>
                {trackedExperiments.length === 0
                  ? "The latest browser snapshot did not include any experiment entities yet."
                  : "Try a different search term to surface your tracked experiment entities."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {status === "ready" && filteredTrackedExperiments.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredTrackedExperiments.map((entry) => (
              <Card key={entry.id} size="sm">
                <CardHeader>
                  <CardTitle>{entry.title}</CardTitle>
                  <CardDescription>
                    {entry.startedOn ? `Started ${formatIsoDate(entry.startedOn)}` : "No start date in snapshot."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={isActiveOverviewExperimentStatus(entry.status) ? "default" : "outline"}>
                      {formatStatusLabel(entry.status)}
                    </Badge>
                    {entry.slug ? <Badge variant="secondary">{entry.slug}</Badge> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {entry.summary ?? "No summary text was available for this experiment entity."}
                  </p>
                  {entry.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {entry.tags.slice(0, 4).map((tag) => (
                        <Badge key={`${entry.id}:${tag}`} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function matchesTrackedExperiment(
  entry: { slug: string | null; summary: string | null; title: string },
  search: string,
): boolean {
  const normalizedSearch = search.trim().toLowerCase();
  if (normalizedSearch.length === 0) {
    return true;
  }

  return entry.title.toLowerCase().includes(normalizedSearch) ||
    (entry.slug?.toLowerCase().includes(normalizedSearch) ?? false) ||
    (entry.summary?.toLowerCase().includes(normalizedSearch) ?? false);
}
