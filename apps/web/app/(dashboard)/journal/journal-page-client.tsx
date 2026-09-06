"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  selectBrowserVaultJournal,
  type JournalView,
  type PersonalPatternCell,
  type PersonalPatternClassification,
  type PersonalPatternReport,
  type PersonalPatternStage,
} from "@murphai/query/browser-overview";

import {
  JournalErrorState,
  JournalLoadingState,
  JournalUnavailableState,
  JournalViewContent,
  type JournalInsight,
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

const PATTERN_STAGE_RANK: Record<PersonalPatternStage, number> = {
  insufficient: 0,
  no_clear_pattern: 1,
  new_clue: 2,
  seen_again: 3,
  worth_testing: 4,
};

const PATTERN_LABELS: Record<
  PersonalPatternClassification,
  JournalInsight["label"]
> = {
  early_signal: "Early signal",
  observation: "Observation",
  pattern: "Pattern",
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
      requestedOnOpen.current = true;
      return refresh({
        background: true,
        requestRuntimeRefreshUntil: (nextClient, nextRef) =>
          nextClient.replica.journal !== undefined &&
          (ref === null || !browserVaultReplicaRefsMatch(ref, nextRef)),
      });
    },
    [ref, refresh],
  );
  useEffect(() => {
    if (requestedOnOpen.current || status !== "ready" || refreshPending) return;
    void refreshJournal();
  }, [refreshJournal, refreshPending, status]);
  const journal = useMemo(
    () => (client ? selectBrowserVaultJournal(client) : null),
    [client],
  );
  const insights = useMemo(
    () =>
      client
        ? buildJournalInsights(client.replica.personalPatterns ?? null)
        : [],
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
      insights={insights}
      isRefreshing={refreshPending}
      journal={journal ?? EMPTY_JOURNAL}
    />
  );
}

function buildJournalInsights(
  report: PersonalPatternReport | null,
): JournalInsight[] {
  if (!report) return [];
  const cell = findLeadPattern(report);
  if (!cell) return [];
  const factor = report.factors.find((entry) => entry.id === cell.factorId);
  const outcome = report.outcomes.find((entry) => entry.id === cell.outcomeId);
  if (!factor || !outcome || !cell.lastExposedDate) return [];
  const classification = cell.classification ?? "observation";
  return [
    {
      date: cell.lastExposedDate,
      detail: `${factor.label} and ${sentenceCase(
        outcome.label,
      )} moved together in your data.`,
      href: "/patterns",
      id: `${cell.factorId}:${cell.outcomeId}`,
      label: PATTERN_LABELS[classification],
      title: factor.label,
    },
  ];
}

function findLeadPattern(
  report: PersonalPatternReport,
): PersonalPatternCell | null {
  return (
    report.cells
      .filter(
        (cell) => PATTERN_STAGE_RANK[cell.stage] >= PATTERN_STAGE_RANK.new_clue,
      )
      .sort(
        (left, right) =>
          PATTERN_STAGE_RANK[right.stage] - PATTERN_STAGE_RANK[left.stage] ||
          Math.abs(right.deltaPercent ?? 0) -
            Math.abs(left.deltaPercent ?? 0) ||
          right.exposedDays - left.exposedDays,
      )[0] ?? null
  );
}

function sentenceCase(value: string): string {
  if (!value) return value;
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}
