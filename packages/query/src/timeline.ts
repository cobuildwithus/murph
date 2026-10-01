import { extractIsoDatePrefix } from "@murphai/contracts";

import type { CanonicalEntity } from "./canonical-entities.ts";

import {
  entityRelationTargetIds,
  listEntities,
  type VaultReadModel,
} from "./read-model.ts";
import {
  summarizeDailySamples,
  type DailySampleSummary,
} from "./summaries.ts";
import { buildSampleSummaryId } from "./sample-summary-id.ts";

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
  includeDailySampleSummaries?: boolean;
  limit?: number;
}

export interface TimelineEntry {
  id: string;
  entryType:
    | "assessment"
    | "event"
    | "journal"
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

type EntityTimelineEntryType = Exclude<TimelineEntry["entryType"], "sample_summary">;

export function buildTimeline(
  vault: VaultReadModel,
  filters: TimelineFilters = {},
): TimelineEntry[] {
  const kindSet = filters.kinds?.length ? new Set(filters.kinds) : null;
  const streamSet = filters.streams?.length ? new Set(filters.streams) : null;
  const families = [
    ["journal", filters.includeJournal ?? true],
    ["event", filters.includeEvents ?? true],
    ["assessment", filters.includeAssessments ?? true],
  ] as const;
  const entries: TimelineEntry[] = [];

  for (const [entryType, included] of families) {
    if (!included) {
      continue;
    }

    for (const entity of listEntities(vault, {
      families: [entryType],
      experimentSlug: entryType === "assessment" ? undefined : filters.experimentSlug,
      from: filters.from,
      to: filters.to,
    })) {
      const entry = entityToTimelineEntry(entity, entryType, kindSet, streamSet);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  if (
    (filters.includeDailySampleSummaries ?? true) &&
    (!kindSet || kindSet.has("sample_summary"))
  ) {
    const summaries = summarizeDailySamples(vault, {
      from: filters.from,
      to: filters.to,
      streams: filters.streams,
      experimentSlug: filters.experimentSlug,
    });
    for (const summary of summaries) {
      entries.push(summaryToTimelineEntry(summary));
    }
  }

  return entries
    .sort(compareTimelineEntries)
    .slice(0, normalizeLimit(filters.limit));
}

function entityToTimelineEntry(
  entity: CanonicalEntity,
  entryType: EntityTimelineEntryType,
  kindSet: ReadonlySet<string> | null,
  streamSet: ReadonlySet<string> | null,
): TimelineEntry | null {
  if (
    entryType === "event" && streamSet &&
    (!entity.stream || !streamSet.has(entity.stream))
  ) {
    return null;
  }

  const kind = entity.kind || (entryType === "journal" ? "journal_day" : entryType);
  if (kindSet && !kindSet.has(kind)) {
    return null;
  }

  const occurrence = resolveTimelineOccurrence(
    entity,
    entryType === "event" ? "00:00:00Z" : "12:00:00Z",
  );
  if (!occurrence || (entryType !== "journal" && !occurrence.occurredAt)) {
    return null;
  }

  return {
    id: entity.entityId,
    entryType,
    occurredAt: occurrence.occurredAt,
    date: occurrence.date,
    title: entity.title ?? timelineFallbackTitle(entity, entryType, kind),
    kind,
    stream: entryType === "event" ? entity.stream : null,
    experimentSlug: entryType === "assessment" ? null : entity.experimentSlug,
    path: entity.path,
    relatedIds: entityRelationTargetIds(entity),
    tags: entity.tags,
    data: entity.attributes,
  };
}

function timelineFallbackTitle(
  entity: CanonicalEntity,
  entryType: EntityTimelineEntryType,
  kind: string,
): string {
  if (entryType === "event") {
    return kind;
  }
  if (entryType === "assessment") {
    return stringData(entity.attributes.assessmentType) ?? entity.entityId;
  }
  return entity.entityId;
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
    relatedIds: [],
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
