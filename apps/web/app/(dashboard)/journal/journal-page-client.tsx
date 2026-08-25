"use client";

import { useMemo } from "react";
import {
  selectBrowserVaultJournal,
  type JournalView,
  type PersonalPatternCell,
  type PersonalPatternClassification,
  type PersonalPatternReport,
  type PersonalPatternStage,
} from "@murphai/query/browser-overview";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import {
  JournalViewContent,
  type JournalInsight,
} from "@/src/components/journal/journal-view";
import { useBrowserVault } from "@/src/lib/browser-vault/context";

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

const PATTERN_LABELS: Record<PersonalPatternClassification, JournalInsight["label"]> = {
  early_signal: "Early signal",
  observation: "Observation",
  pattern: "Pattern",
};

export default function JournalPageClient() {
  const { client, error, refresh, status } = useBrowserVault();
  const journal = useMemo(
    () => client ? selectBrowserVaultJournal(client) : null,
    [client],
  );
  const insights = useMemo(
    () => client ? buildJournalInsights(client.replica.personalPatterns ?? null) : [],
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

  return (
    <JournalViewContent
      asOfDate={client?.replica.generatedAt.slice(0, 10)}
      insights={insights}
      journal={journal ?? EMPTY_JOURNAL}
    />
  );
}

function buildJournalInsights(report: PersonalPatternReport | null): JournalInsight[] {
  if (!report) return [];
  const cell = findLeadPattern(report);
  if (!cell) return [];
  const factor = report.factors.find((entry) => entry.id === cell.factorId);
  const outcome = report.outcomes.find((entry) => entry.id === cell.outcomeId);
  if (!factor || !outcome) return [];
  const classification = cell.classification ?? "observation";
  return [{
    detail: `${factor.label} and ${sentenceCase(outcome.label)} moved together in your data.`,
    href: "/patterns",
    id: `${cell.factorId}:${cell.outcomeId}`,
    label: PATTERN_LABELS[classification],
    title: factor.label,
  }];
}

function findLeadPattern(report: PersonalPatternReport): PersonalPatternCell | null {
  return report.cells
    .filter((cell) => PATTERN_STAGE_RANK[cell.stage] >= PATTERN_STAGE_RANK.new_clue)
    .sort((left, right) =>
      PATTERN_STAGE_RANK[right.stage] - PATTERN_STAGE_RANK[left.stage]
      || Math.abs(right.deltaPercent ?? 0) - Math.abs(left.deltaPercent ?? 0)
      || right.exposedDays - left.exposedDays
    )[0] ?? null;
}

function sentenceCase(value: string): string {
  if (!value) return value;
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}
