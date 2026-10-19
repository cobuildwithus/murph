"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  selectBrowserVaultJournal,
  type JournalView,
} from "@murphai/query/browser-overview";

import {
  JournalErrorState,
  JournalLoadingState,
  JournalUnavailableState,
  JournalViewContent,
} from "@/src/components/journal/journal-view";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import { browserVaultReplicaRefsMatch } from "@/src/lib/browser-vault/ref";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

const EMPTY_JOURNAL: JournalView = {
  days: [],
  eventCount: 0,
  recordCount: 0,
  weeks: [],
  windowDays: 120,
};

export default function JournalPageClient({
  contactOptions = [],
}: {
  contactOptions?: readonly MurphContactOption[];
}) {
  const {
    client,
    deviceSyncImportPending,
    ref,
    refresh,
    refreshPending,
    status,
  } = useBrowserVault();
  const requestedOnOpen = useRef(false);
  const refreshJournal = useCallback(
    () => {
      if (requestedOnOpen.current && refreshPending) return;
      requestedOnOpen.current = true;
      return refresh({
        background: true,
        requestRuntimeRefreshUntil: (nextClient, nextRef) =>
          nextClient.replica.journal !== undefined &&
          (ref === null || !browserVaultReplicaRefsMatch(ref, nextRef)),
      });
    },
    [ref, refresh, refreshPending],
  );
  useEffect(() => {
    const awaitingFirstImport = status === "empty" && deviceSyncImportPending;
    if (
      requestedOnOpen.current ||
      (status !== "ready" && !awaitingFirstImport) ||
      (refreshPending && !awaitingFirstImport)
    ) return;
    void refreshJournal();
  }, [deviceSyncImportPending, refreshJournal, refreshPending, status]);
  const journal = useMemo(
    () => (client ? selectBrowserVaultJournal(client) : null),
    [client],
  );
  const journalAvailable = client?.replica.journal !== undefined;
  const isPreparing =
    deviceSyncImportPending &&
    refreshPending &&
    (status === "empty" || (client !== null && !journalAvailable));

  if (status === "error") {
    return <JournalErrorState onRetry={() => void refresh()} />;
  }

  if (status === "loading" || isPreparing) {
    return <JournalLoadingState />;
  }

  if (client && !journalAvailable) {
    return <JournalUnavailableState onRetry={() => void refreshJournal()} />;
  }

  return (
    <JournalViewContent
      contactOptions={contactOptions}
      isRefreshing={refreshPending}
      journal={journal ?? EMPTY_JOURNAL}
    />
  );
}
