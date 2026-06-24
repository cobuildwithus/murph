"use client";

import { useMemo } from "react";
import { selectBrowserVaultHistory } from "@murphai/query/browser-overview";

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
  formatIsoDateTime,
  formatStreamLabel,
} from "@/src/lib/browser-vault/display";

export default function HistoryPage() {
  return (
    <BrowserVaultProvider>
      <HistoryPageContent />
    </BrowserVaultProvider>
  );
}

function HistoryPageContent() {
  const { client, error, refresh, refreshPending, status } = useBrowserVault();
  const history = useMemo(() => client ? selectBrowserVaultHistory(client) : null, [client]);
  const timeline = history?.timeline ?? [];
  const canRenderContent = status === "empty" || client !== null;
  const isPreparingEmptyReplica = status === "empty" && refreshPending;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            History
          </span>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            Timeline from your vault
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recent notes, events, assessments, and daily summaries sorted from most recent to oldest.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {client
            ? `Updated ${formatIsoDate(client.replica.generatedAt)}`
            : isPreparingEmptyReplica
              ? "Preparing timeline."
              : "No history available yet."}
        </div>
      </div>

      {status === "loading" ? (
        <Card>
          <CardHeader>
            <CardTitle>Preparing your timeline</CardTitle>
            <CardDescription>
              Loading your recent timeline.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load history</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{error ?? "Your history is not available right now."}</span>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {canRenderContent && timeline.length === 0 ? (
        <Card
          aria-live={isPreparingEmptyReplica ? "polite" : undefined}
          role={isPreparingEmptyReplica ? "status" : undefined}
        >
          <CardHeader>
            <CardTitle>
              {isPreparingEmptyReplica ? "Preparing your timeline" : "No timeline entries yet"}
            </CardTitle>
            <CardDescription>
              {isPreparingEmptyReplica
                ? "Your latest timeline data is still being prepared."
                : "No notes, events, assessments, or daily summaries are available yet."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {canRenderContent && timeline.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{timeline.length} recent timeline entries</CardTitle>
            <CardDescription>Most recent first.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Stream</TableHead>
                  <TableHead>Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timeline.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">{formatIsoDate(entry.date)}</span>
                        <span className="text-xs text-muted-foreground">{formatIsoDateTime(entry.occurredAt)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-foreground">{entry.title}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{formatConfidenceLabel(entry.entryType)}</Badge>
                        <Badge variant="secondary">{formatConfidenceLabel(entry.kind)}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>{entry.stream ? formatStreamLabel(entry.stream) : "—"}</TableCell>
                    <TableCell>
                      <div className="flex max-w-sm flex-wrap gap-2">
                        {entry.tags.length > 0 ? entry.tags.slice(0, 4).map((tag) => (
                          <Badge key={`${entry.id}:${tag}`} variant="secondary">
                            {tag}
                          </Badge>
                        )) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
