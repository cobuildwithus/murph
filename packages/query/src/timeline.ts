import type { VaultReadModel, VaultRecord } from "./model.js";
import {
  summarizeDailySamples,
  type DailySampleSummary,
} from "./summaries.js";

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
  includeDailySampleSummaries?: boolean;
  limit?: number;
}

export interface TimelineEntry {
  id: string;
  entryType: "journal" | "event" | "sample_summary";
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
  const includeDailySampleSummaries =
    filters.includeDailySampleSummaries ?? true;

  const entries: TimelineEntry[] = [];

  if (includeJournal) {
    for (const journal of vault.journalEntries) {
      if (!matchesRecordFilters(journal, filters)) {
        continue;
      }

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
        occurredAt: journal.occurredAt ?? `${date}T12:00:00`,
        date,
        title: journal.title ?? journal.displayId,
        kind: journalKind,
        stream: null,
        experimentSlug: journal.experimentSlug,
        path: journal.sourcePath,
        relatedIds: journal.lookupIds,
        tags: journal.tags,
        data: journal.data,
      });
    }
  }

  if (includeEvents) {
    for (const event of vault.events) {
      if (!matchesRecordFilters(event, filters)) {
        continue;
      }

      if (streamSet && (!event.stream || !streamSet.has(event.stream))) {
        continue;
      }

      const eventKind = event.kind ?? "event";
      if (kindSet && !kindSet.has(eventKind)) {
        continue;
      }

      const date = event.date ?? extractDate(event.occurredAt);
      const occurredAt = event.occurredAt ?? (date ? `${date}T00:00:00` : "");

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
        relatedIds: event.lookupIds,
        tags: event.tags,
        data: event.data,
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

function matchesRecordFilters(record: VaultRecord, filters: TimelineFilters): boolean {
  const dateLike = record.date ?? record.occurredAt;

  if (filters.experimentSlug && record.experimentSlug !== filters.experimentSlug) {
    return false;
  }

  if (filters.from && compareDateLike(dateLike, filters.from) < 0) {
    return false;
  }

  if (filters.to && compareDateLike(dateLike, filters.to) > 0) {
    return false;
  }

  return true;
}

function summaryToTimelineEntry(summary: DailySampleSummary): TimelineEntry {
  return {
    id: `sample-summary:${summary.date}:${summary.stream}`,
    entryType: "sample_summary",
    occurredAt: summary.lastSampleAt ?? `${summary.date}T23:59:59`,
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
  if (!value) {
    return "";
  }

  return value.length >= 10 ? value.slice(0, 10) : value;
}

function compareDateLike(value: string | null | undefined, boundary: string): number {
  if (!value) {
    return -1;
  }

  const normalizedValue = value.length > 10 ? value.slice(0, 10) : value;
  const normalizedBoundary = boundary.length > 10 ? boundary.slice(0, 10) : boundary;

  return normalizedValue.localeCompare(normalizedBoundary);
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)));
}
