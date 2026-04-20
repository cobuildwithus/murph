"use client";

import { useMemo, useState } from "react";
import {
  isActiveOverviewExperimentStatus,
  selectBrowserVaultTrackedExperiments,
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
import { BrowserVaultProvider, useBrowserVault } from "@/src/lib/browser-vault/context";
import { formatIsoDate, formatStatusLabel } from "@/src/lib/browser-vault/display";

export default function ExperimentsPage() {
  return (
    <BrowserVaultProvider>
      <ExperimentsPageContent />
    </BrowserVaultProvider>
  );
}

function ExperimentsPageContent() {
  const [search, setSearch] = useState("");
  const { client, error, refresh, status } = useBrowserVault();
  const trackedExperiments = useMemo(
    () => client ? selectBrowserVaultTrackedExperiments(client) : [],
    [client],
  );
  const filteredTrackedExperiments = useMemo(
    () => trackedExperiments.filter((entry) => matchesTrackedExperiment(entry, search)),
    [search, trackedExperiments],
  );
  const activeCount = trackedExperiments.filter((entry) => isActiveOverviewExperimentStatus(entry.status)).length;
  const completedCount = trackedExperiments.length - activeCount;
  const canRenderContent = status === "empty" || client !== null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Experiments
          </span>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            Tracked experiments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Active and completed experiments from your recent history.
          </p>
        </div>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search experiments"
          className="w-full sm:w-64"
        />
      </div>

      <section className="flex flex-col gap-4">
        {status === "loading" ? (
          <Card>
            <CardHeader>
              <CardTitle>Loading experiments</CardTitle>
              <CardDescription>
                Loading your recent experiments.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {status === "error" ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load your experiments</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{error ?? "Your experiment list could not be decrypted."}</span>
                <Button size="sm" variant="outline" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {canRenderContent ? (
          <>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Overview
              </span>
              <span className="text-xs text-muted-foreground">
                {trackedExperiments.length} tracked experiments
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Active now</CardTitle>
                  <CardDescription>Experiments currently in motion.</CardDescription>
                </CardHeader>
                <CardContent className="font-serif text-3xl font-semibold text-foreground">
                  {activeCount}
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Completed</CardTitle>
                  <CardDescription>Finished experiments still shown here.</CardDescription>
                </CardHeader>
                <CardContent className="font-serif text-3xl font-semibold text-foreground">
                  {completedCount}
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Matching search</CardTitle>
                  <CardDescription>Results surfaced by the current filter.</CardDescription>
                </CardHeader>
                <CardContent className="font-serif text-3xl font-semibold text-foreground">
                  {filteredTrackedExperiments.length}
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}

        {canRenderContent && filteredTrackedExperiments.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No tracked experiments matched</CardTitle>
              <CardDescription>
                {trackedExperiments.length === 0
                  ? "No tracked experiments are available yet."
                  : "Try a different search term to find the experiment you want."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {canRenderContent && filteredTrackedExperiments.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredTrackedExperiments.map((entry) => {
              const slugBadge = formatExperimentSlugBadge(entry.slug);

              return (
                <Card key={entry.id} size="sm">
                  <CardHeader>
                    <CardTitle>{entry.title}</CardTitle>
                    <CardDescription>
                      {entry.startedOn ? `Started ${formatIsoDate(entry.startedOn)}` : "No recorded start date."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={isActiveOverviewExperimentStatus(entry.status) ? "default" : "outline"}>
                        {formatStatusLabel(entry.status)}
                      </Badge>
                      {slugBadge ? <Badge variant="secondary">{slugBadge}</Badge> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {entry.summary ?? "No summary text was available for this experiment."}
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
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function formatExperimentSlugBadge(slug: string | null): string | null {
  if (!slug) {
    return null;
  }

  return /[:/]/u.test(slug) ? null : slug;
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
