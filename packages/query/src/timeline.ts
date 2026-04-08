import { extractIsoDatePrefix } from "@murphai/contracts";

import {
  entityRelationTargetIds,
  listEntities,
  type VaultReadModel,
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
    for (const journal of listEntities(vault, {
      families: ["journal"],
      experimentSlug: filters.experimentSlug,
      from: filters.from,
      to: filters.to,
    })) {
      const journalKind = journal.kind || "journal_day";
      if (kindSet && !kindSet.has(journalKind)) {
        continue;
      }

      const occurrence = resolveTimelineOccurrence(journal, "12:00:00Z");
      if (!occurrence) {
        continue;
      }

      entries.push({
        id: journal.entityId,
        entryType: "journal",
        occurredAt: occurrence.occurredAt,
        date: occurrence.date,
        title: journal.title ?? journal.entityId,
        kind: journalKind,
        stream: null,
        experimentSlug: journal.experimentSlug,
        path: journal.path,
        relatedIds: entityRelationTargetIds(journal),
        tags: journal.tags,
        data: journal.attributes,
      });
    }
  }

  if (includeEvents) {
    for (const event of listEntities(vault, {
      families: ["event"],
      experimentSlug: filters.experimentSlug,
      from: filters.from,
      to: filters.to,
    })) {
      if (streamSet && (!event.stream || !streamSet.has(event.stream))) {
        continue;
      }

      const eventKind = event.kind || "event";
      if (kindSet && !kindSet.has(eventKind)) {
        continue;
      }

      const occurrence = resolveTimelineOccurrence(event, "00:00:00Z");
      if (!occurrence || !occurrence.occurredAt) {
        continue;
      }

      entries.push({
        id: event.entityId,
        entryType: "event",
        occurredAt: occurrence.occurredAt,
        date: occurrence.date,
        title: event.title ?? eventKind,
        kind: eventKind,
        stream: event.stream,
        experimentSlug: event.experimentSlug,
        path: event.path,
        relatedIds: entityRelationTargetIds(event),
        tags: event.tags,
        data: event.attributes,
      });
    }
  }

  if (includeAssessments) {
    for (const assessment of listEntities(vault, {
      families: ["assessment"],
      from: filters.from,
      to: filters.to,
    })) {
      const assessmentKind = assessment.kind || "assessment";
      if (kindSet && !kindSet.has(assessmentKind)) {
        continue;
      }

      const occurrence = resolveTimelineOccurrence(assessment, "12:00:00Z");
      if (!occurrence || !occurrence.occurredAt) {
        continue;
      }

      entries.push({
        id: assessment.entityId,
        entryType: "assessment",
        occurredAt: occurrence.occurredAt,
        date: occurrence.date,
        title:
          assessment.title ??
          stringData(assessment.attributes.assessmentType) ??
          assessment.entityId,
        kind: assessmentKind,
        stream: null,
        experimentSlug: null,
        path: assessment.path,
        relatedIds: entityRelationTargetIds(assessment),
        tags: assessment.tags,
        data: assessment.attributes,
      });
    }
  }

  if (includeHistory) {
    for (const history of listEntities(vault, {
      families: ["history"],
      from: filters.from,
      to: filters.to,
    })) {
      const historyKind = history.kind || "history";
      if (kindSet && !kindSet.has(historyKind)) {
        continue;
      }

      const occurrence = resolveTimelineOccurrence(history, "00:00:00Z");
      if (!occurrence || !occurrence.occurredAt) {
        continue;
      }

      entries.push({
        id: history.entityId,
        entryType: "history",
        occurredAt: occurrence.occurredAt,
        date: occurrence.date,
        title: history.title ?? historyKind,
        kind: historyKind,
        stream: null,
        experimentSlug: null,
        path: history.path,
        relatedIds: entityRelationTargetIds(history),
        tags: history.tags,
        data: history.attributes,
      });
    }
  }

  if (includeProfileSnapshots) {
    for (const snapshot of listEntities(vault, {
      families: ["profile_snapshot"],
      from: filters.from,
      to: filters.to,
    })) {
      const snapshotKind = snapshot.kind || "profile_snapshot";
      if (kindSet && !kindSet.has(snapshotKind)) {
        continue;
      }

      const occurrence = resolveTimelineOccurrence(snapshot, "12:00:00Z");
      if (!occurrence || !occurrence.occurredAt) {
        continue;
      }

      entries.push({
        id: snapshot.entityId,
        entryType: "profile_snapshot",
        occurredAt: occurrence.occurredAt,
        date: occurrence.date,
        title: snapshot.title ?? snapshot.entityId,
        kind: snapshotKind,
        stream: null,
        experimentSlug: null,
        path: snapshot.path,
        relatedIds: entityRelationTargetIds(snapshot),
        tags: snapshot.tags,
        data: snapshot.attributes,
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

interface TimelineOccurrence {
  date: string;
  occurredAt: string;
}

function resolveTimelineOccurrence(
  entry: {
    date?: string | null;
    occurredAt?: string | null;
  },
  fallbackTime: "00:00:00Z" | "12:00:00Z",
): TimelineOccurrence | null {
  const date = entry.date ?? extractDate(entry.occurredAt);
  if (!date) {
    return null;
  }

  return {
    date,
    occurredAt: entry.occurredAt ?? `${date}T${fallbackTime}`,
  };
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
