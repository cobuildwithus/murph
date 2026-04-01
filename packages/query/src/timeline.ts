import { extractIsoDatePrefix } from "@murphai/contracts";

import {
  listRecords,
  recordRelationTargetIds,
  type VaultReadModel,
  type VaultRecord,
} from "./model.ts";
import {
  summarizeDailySamples,
  type DailySampleSummary,
} from "./summaries.ts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export interface TimelineFilters {
  from?: string;
  to?: string;
  experimentSlug?: string;
  kinds?: string[];
  streams?: string[];
  includeJournal?: boolean;
  includeEvents?: boolean;
  includeAssessments?: boolean;
  includeHistory?: boolean;
  includeProfileSnapshots?: boolean;
  includeDailySampleSummaries?: boolean;
  limit?: number;
}

export interface TimelineEntry {
  id: string;
  entryType:
    | "assessment"
    | "event"
    | "history"
    | "journal"
    | "profile_snapshot"
    | "sample_summary";
  occurredAt: string;
  date: string;
  title: string;
  kind: string;
  stream: string | null;
  experimentSlug: string | null;
  path: string | null;
  relatedIds: string[];
  tags: string[];
  data: Record<string, unknown>;
}

export function buildTimeline(
  vault: VaultReadModel,
  filters: TimelineFilters = {},
): TimelineEntry[] {
  const kindSet = filters.kinds?.length ? new Set(filters.kinds) : null;
  const streamSet = filters.streams?.length ? new Set(filters.streams) : null;
  const includeJournal = filters.includeJournal ?? true;
  const includeEvents = filters.includeEvents ?? true;
  const includeAssessments = filters.includeAssessments ?? true;
  const includeHistory = filters.includeHistory ?? true;
  const includeProfileSnapshots = filters.includeProfileSnapshots ?? true;
  const includeDailySampleSummaries =
    filters.includeDailySampleSummaries ?? true;

  const entries: TimelineEntry[] = [];

  if (includeJournal) {
    for (const journal of listRecords(vault, {
      recordTypes: ["journal"],
      experimentSlug: filters.experimentSlug,
      from: filters.from,
      to: filters.to,
    })) {
      const journalKind = journal.kind ?? "journal_day";
      if (kindSet && !kindSet.has(journalKind)) {
        continue;
      }

      const date = journal.date ?? extractDate(journal.occurredAt);
      if (!date) {
        continue;
      }

      entries.push({
        id: journal.displayId,
        entryType: "journal",
        occurredAt: journal.occurredAt ?? `${date}T12:00:00Z`,
        date,
        title: journal.title ?? journal.displayId,
        kind: journalKind,
        stream: null,
        experimentSlug: journal.experimentSlug,
        path: journal.sourcePath,
        relatedIds: timelineRelatedIds(journal),
        tags: journal.tags,
        data: journal.data,
      });
    }
  }

  if (includeEvents) {
    for (const event of listRecords(vault, {
      recordTypes: ["event"],
      experimentSlug: filters.experimentSlug,
      from: filters.from,
      to: filters.to,
    })) {
      if (streamSet && (!event.stream || !streamSet.has(event.stream))) {
        continue;
      }

      const eventKind = event.kind ?? "event";
      if (kindSet && !kindSet.has(eventKind)) {
        continue;
      }

      const date = event.date ?? extractDate(event.occurredAt);
      const occurredAt = event.occurredAt ?? (date ? `${date}T00:00:00Z` : "");

      if (!date || !occurredAt) {
        continue;
      }

      entries.push({
        id: event.displayId,
        entryType: "event",
        occurredAt,
        date,
        title: event.title ?? eventKind,
        kind: eventKind,
        stream: event.stream,
        experimentSlug: event.experimentSlug,
        path: event.sourcePath,
        relatedIds: timelineRelatedIds(event),
        tags: event.tags,
        data: event.data,
      });
    }
  }

  if (includeAssessments) {
    for (const assessment of listRecords(vault, {
      recordTypes: ["assessment"],
      from: filters.from,
      to: filters.to,
    })) {
      const assessmentKind = assessment.kind ?? "assessment";
      if (kindSet && !kindSet.has(assessmentKind)) {
        continue;
      }

      const date = assessment.date ?? extractDate(assessment.occurredAt);
      const occurredAt = assessment.occurredAt ?? (date ? `${date}T12:00:00Z` : "");

      if (!date || !occurredAt) {
        continue;
      }

      entries.push({
        id: assessment.displayId,
        entryType: "assessment",
        occurredAt,
        date,
        title:
          assessment.title ??
          stringData(assessment.data.assessmentType) ??
          assessment.displayId,
        kind: assessmentKind,
        stream: null,
        experimentSlug: null,
        path: assessment.sourcePath,
        relatedIds: timelineRelatedIds(assessment),
        tags: assessment.tags,
        data: assessment.data,
      });
    }
  }

  if (includeHistory) {
    for (const history of listRecords(vault, {
      recordTypes: ["history"],
      from: filters.from,
      to: filters.to,
    })) {
      const historyKind = history.kind ?? "history";
      if (kindSet && !kindSet.has(historyKind)) {
        continue;
      }

      const date = history.date ?? extractDate(history.occurredAt);
      const occurredAt = history.occurredAt ?? (date ? `${date}T00:00:00Z` : "");

      if (!date || !occurredAt) {
        continue;
      }

      entries.push({
        id: history.displayId,
        entryType: "history",
        occurredAt,
        date,
        title: history.title ?? historyKind,
        kind: historyKind,
        stream: null,
        experimentSlug: null,
        path: history.sourcePath,
        relatedIds: timelineRelatedIds(history),
        tags: history.tags,
        data: history.data,
      });
    }
  }

  if (includeProfileSnapshots) {
    for (const snapshot of listRecords(vault, {
      recordTypes: ["profile_snapshot"],
      from: filters.from,
      to: filters.to,
    })) {
      const snapshotKind = snapshot.kind ?? "profile_snapshot";
      if (kindSet && !kindSet.has(snapshotKind)) {
        continue;
      }

      const date = snapshot.date ?? extractDate(snapshot.occurredAt);
      const occurredAt = snapshot.occurredAt ?? (date ? `${date}T12:00:00Z` : "");

      if (!date || !occurredAt) {
        continue;
      }

      entries.push({
        id: snapshot.displayId,
        entryType: "profile_snapshot",
        occurredAt,
        date,
        title: snapshot.title ?? snapshot.displayId,
        kind: snapshotKind,
        stream: null,
        experimentSlug: null,
        path: snapshot.sourcePath,
        relatedIds: timelineRelatedIds(snapshot),
        tags: snapshot.tags,
        data: snapshot.data,
      });
    }
  }

  if (includeDailySampleSummaries) {
    const summaries = summarizeDailySamples(vault, {
      from: filters.from,
      to: filters.to,
      streams: filters.streams,
      experimentSlug: filters.experimentSlug,
    });

    for (const summary of summaries) {
      if (streamSet && !streamSet.has(summary.stream)) {
        continue;
      }

      if (kindSet && !kindSet.has("sample_summary")) {
        continue;
      }

      entries.push(summaryToTimelineEntry(summary));
    }
  }

  return entries
    .sort(compareTimelineEntries)
    .slice(0, normalizeLimit(filters.limit));
}

function timelineRelatedIds(record: VaultRecord): string[] {
  return recordRelationTargetIds(record);
}

function summaryToTimelineEntry(summary: DailySampleSummary): TimelineEntry {
  return {
    id: buildSampleSummaryId(summary),
    entryType: "sample_summary",
    occurredAt: summary.lastSampleAt ?? `${summary.date}T23:59:59Z`,
    date: summary.date,
    title: `${summary.stream} daily summary`,
    kind: "sample_summary",
    stream: summary.stream,
    experimentSlug: null,
    path: summary.sourcePaths[0] ?? null,
    relatedIds: summary.sampleIds,
    tags: ["sample_summary", summary.stream],
    data: {
      stream: summary.stream,
      sampleCount: summary.sampleCount,
      unit: summary.unit,
      units: summary.units,
      minValue: summary.minValue,
      maxValue: summary.maxValue,
      averageValue: summary.averageValue,
      sumValue: summary.sumValue,
      firstSampleAt: summary.firstSampleAt,
      lastSampleAt: summary.lastSampleAt,
      sampleIds: summary.sampleIds,
      sourcePaths: summary.sourcePaths,
    },
  };
}

function buildSampleSummaryId(summary: DailySampleSummary): string {
  return `sample-summary:${summary.date}:${summary.stream}:${summary.unit ?? "none"}`;
}

function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
  if (left.occurredAt !== right.occurredAt) {
    return right.occurredAt.localeCompare(left.occurredAt);
  }

  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  return left.id.localeCompare(right.id);
}

function extractDate(value: string | null | undefined): string {
  return extractIsoDatePrefix(value) ?? "";
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)));
}

function stringData(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
