"use client";

import { useMemo } from "react";
import { selectBrowserVaultOverview } from "@murphai/query/browser-overview";

import { PersonalPatternsSection } from "@/src/components/overview/personal-patterns-section";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { useBrowserVault } from "@/src/lib/browser-vault/context";

export default function PatternsPageClient() {
  const { client, error, refresh, refreshPending, status } = useBrowserVault();
  const report = useMemo(
    () => client ? selectBrowserVaultOverview(client).personalPatterns : null,
    [client],
  );
  const isPreparing = status === "empty" && refreshPending;

  return (
    <div className="flex flex-col gap-8">
      {status === "loading" || isPreparing ? (
        <Card aria-live="polite" role="status">
          <CardHeader>
            <CardTitle>Preparing your patterns</CardTitle>
            <CardDescription>
              Murph is loading the latest comparisons from your private health data.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load your patterns</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{error ?? "We couldn't unlock your pattern data right now."}</span>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {status !== "loading" && status !== "error" && !isPreparing ? (
        <PersonalPatternsSection report={report} />
      ) : null}
    </div>
  );
}
