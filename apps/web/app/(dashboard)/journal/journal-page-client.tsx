"use client";

import { useMemo } from "react";
import {
  selectBrowserVaultJournal,
  type JournalView,
} from "@murphai/query/browser-overview";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { JournalViewContent } from "@/src/components/journal/journal-view";
import { useBrowserVault } from "@/src/lib/browser-vault/context";

const EMPTY_JOURNAL: JournalView = {
  days: [],
  eventCount: 0,
  recordCount: 0,
  windowDays: 120,
};

export default function JournalPageClient() {
  const { client, error, refresh, status } = useBrowserVault();
  const journal = useMemo(
    () => client ? selectBrowserVaultJournal(client) : null,
    [client],
  );
  const journalAvailable = client?.replica.journal !== undefined;

  if (status === "loading") {
    return <p aria-live="polite">Preparing your Journal...</p>;
  }

  if (status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load your Journal</AlertTitle>
        <AlertDescription>
          <p>{error ?? "Murph could not unlock your private Journal."}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void refresh()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (client && !journalAvailable) {
    return (
      <section>
        <h1>Journal</h1>
        <p>Murph is preparing your Journal from your private health data.</p>
      </section>
    );
  }

  return <JournalViewContent journal={journal ?? EMPTY_JOURNAL} />;
}
