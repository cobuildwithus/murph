import {
  isValidIanaTimeZone,
} from "@murphai/contracts";
import {
  resolveAdherenceObservationActivityKind,
  resolveActivityEvidenceLocalDate,
  resolveInterventionSessionLocalDate,
} from "./experiment-adherence.ts";
import { selectMetricSeries, type MetricPoint } from "./metrics/index.ts";
import type { CanonicalEntity } from "./canonical-entities.ts";
import type { VaultReadModel } from "./read-model.ts";

const DEFAULT_WINDOW_DAYS = 120;
const MAX_RECORDS = 500;

const JOURNAL_METRICS = [
  { key: "sleep-score", label: "Sleep score", group: "sleep" },
  { key: "sleep-efficiency", label: "Sleep efficiency", group: "sleep" },
  { key: "total-sleep", label: "Total sleep", group: "sleep" },
  { key: "hrv-rmssd", label: "HRV", group: "sleep" },
  { key: "resting-heart-rate", label: "Resting heart rate", group: "sleep" },
  { key: "readiness-score", label: "Readiness score", group: "sleep" },
  { key: "recovery-score", label: "Recovery score", group: "sleep" },
] as const;

export interface JournalRecord {
  id: string;
  kind: string;
  label: string;
  occurredAt: string;
  source: string | null;
  summary: string | null;
  tags: string[];
  timeZone: string | null;
}

export interface JournalEvent {
  date: string;
  id: string;
  kind: string;
  occurredAt: string;
  records: JournalRecord[];
  timeZone: string | null;
  title: string;
}

export interface JournalDay {
  date: string;
  events: JournalEvent[];
}

export interface JournalView {
  days: JournalDay[];
  eventCount: number;
  recordCount: number;
  windowDays: number;
}

export function emptyJournalView(windowDays = DEFAULT_WINDOW_DAYS): JournalView {
  return { days: [], eventCount: 0, recordCount: 0, windowDays };
}

interface JournalCandidate extends JournalRecord {
  date: string;
  groupHint: string | null;
  relatedIds: string[];
}

export function buildJournalView(
  vault: VaultReadModel,
  metricPoints: readonly MetricPoint[] = [],
  options: { asOf?: Date | string; windowDays?: number } = {},
): JournalView {
  const asOfDate = resolveDate(options.asOf);
  const windowDays = normalizeWindowDays(options.windowDays);
  const fromDate = addDays(asOfDate, -(windowDays - 1));
  const candidates = [
    ...vault.events.flatMap((event) => journalCandidateFromEvent(event, fromDate, asOfDate)),
    ...journalMetricCandidates(metricPoints, fromDate, asOfDate),
  ]
    .sort(compareCandidates)
    .slice(0, MAX_RECORDS);
  const events = groupJournalCandidates(candidates);
  const daysByDate = new Map<string, JournalEvent[]>();
  for (const event of events) {
    const dayEvents = daysByDate.get(event.date) ?? [];
    dayEvents.push(event);
    daysByDate.set(event.date, dayEvents);
  }
  const days = [...daysByDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, dayEvents]) => ({
      date,
      events: dayEvents.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
    }));

  return {
    days,
    eventCount: events.length,
    recordCount: candidates.length,
    windowDays,
  };
}

function journalCandidateFromEvent(
  event: CanonicalEntity,
  fromDate: string,
  toDate: string,
): JournalCandidate[] {
  if (event.family !== "event" || !isJournalEventKind(event.kind)) return [];
  const date = resolveEventDate(event);
  if (!date || date < fromDate || date > toDate) return [];
  const occurredAt = normalizeOccurredAt(event.occurredAt ?? undefined, date);
  const label = eventLabel(event);
  const groupHint = event.kind === "sleep_session" ? `sleep:${date}` : null;
  return [{
    date,
    groupHint,
    id: event.entityId,
    kind: event.kind,
    label,
    occurredAt,
    relatedIds: [...new Set([...event.relatedIds, ...event.links.map((link) => link.targetId)])],
    source: readEventSource(event),
    summary: eventSummary(event),
    tags: event.tags.slice(),
    timeZone: readEventTimeZone(event),
  }];
}

function journalMetricCandidates(
  points: readonly MetricPoint[],
  fromDate: string,
  toDate: string,
): JournalCandidate[] {
  return JOURNAL_METRICS.flatMap((metric) =>
    selectMetricSeries({ from: fromDate, metricKey: metric.key, points, to: toDate }).rows
      .flatMap((row) => {
        if (row.value === null || row.confidence === "none") return [];
        const unit = row.unit ? ` ${row.unit}` : "";
        return [{
          date: row.date,
          groupHint: `${metric.group}:${row.date}`,
          id: `journal_metric_${metric.key}_${row.date}`,
          kind: "metric",
          label: metric.label,
          occurredAt: normalizeOccurredAt(row.observedAt, row.date),
          relatedIds: row.recordIds?.slice() ?? [],
          source: row.sourceLabel ?? null,
          summary: `${row.value}${unit}`,
          tags: [metric.key],
          timeZone: null,
        }];
      })
  );
}

function groupJournalCandidates(candidates: readonly JournalCandidate[]): JournalEvent[] {
  const parent = new Map(candidates.map((candidate) => [candidate.id, candidate.id]));
  const candidateIds = new Set(parent.keys());
  const hintOwner = new Map<string, string>();

  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  for (const candidate of candidates) {
    for (const relatedId of candidate.relatedIds) {
      if (candidateIds.has(relatedId)) union(candidate.id, relatedId);
    }
    if (candidate.groupHint) {
      const existing = hintOwner.get(candidate.groupHint);
      if (existing) union(candidate.id, existing);
      else hintOwner.set(candidate.groupHint, candidate.id);
    }
  }

  const groups = new Map<string, JournalCandidate[]>();
  for (const candidate of candidates) {
    const root = find(candidate.id);
    const group = groups.get(root) ?? [];
    group.push(candidate);
    groups.set(root, group);
  }

  return [...groups.values()].map((records) => {
    const sorted = records.sort(compareCandidates);
    const lead = selectLeadRecord(sorted);
    return {
      date: lead.date,
      id: sorted.map((record) => record.id).sort().join(":"),
      kind: eventGroupKind(sorted),
      occurredAt: lead.occurredAt,
      records: sorted.map(({ date: _date, groupHint: _hint, relatedIds: _related, ...record }) => record),
      timeZone: lead.timeZone,
      title: eventGroupTitle(sorted, lead),
    };
  });
}

function isJournalEventKind(kind: string): boolean {
  return kind === "activity_session"
    || kind === "experiment_context"
    || kind === "intervention_session"
    || kind === "note"
    || kind === "observation"
    || kind === "sleep_session"
    || kind === "symptom"
    || kind === "test";
}

function resolveEventDate(event: CanonicalEntity): string | null {
  if (event.kind === "activity_session") return resolveActivityEvidenceLocalDate(event);
  if (event.kind === "intervention_session") return resolveInterventionSessionLocalDate(event);
  return event.date ?? event.occurredAt?.slice(0, 10) ?? null;
}

function eventLabel(event: CanonicalEntity): string {
  if (event.title) return event.title;
  if (event.kind === "activity_session") {
    return humanize(resolveAdherenceObservationActivityKind({ attributes: event.attributes }) ?? "activity");
  }
  if (event.kind === "intervention_session") {
    return humanize(readString(event.attributes.interventionType) ?? "intervention");
  }
  if (event.kind === "observation") return humanize(readString(event.attributes.metric) ?? "observation");
  if (event.kind === "symptom") return humanize(readString(event.attributes.symptom) ?? "symptom");
  if (event.kind === "test") return readString(event.attributes.testName) ?? "Test result";
  if (event.kind === "sleep_session") return "Sleep";
  return humanize(event.kind);
}

function eventSummary(event: CanonicalEntity): string | null {
  const note = readString(event.attributes.note);
  if (note) return note;
  const summary = readString(event.attributes.summary);
  if (summary) return summary;
  if (event.kind === "observation") {
    const value = readNumber(event.attributes.value);
    if (value !== null) {
      const unit = readString(event.attributes.unit);
      return `${value}${unit ? ` ${unit}` : ""}`;
    }
  }
  if (event.kind === "activity_session" || event.kind === "intervention_session") {
    const duration = readNumber(event.attributes.durationMinutes);
    return duration === null ? null : `${duration} min`;
  }
  if (event.kind === "sleep_session") {
    const duration = readNumber(event.attributes.durationMinutes);
    return duration === null ? null : `${duration} min`;
  }
  return event.body?.trim() || null;
}

function readEventSource(event: CanonicalEntity): string | null {
  const dataOrigin = readRecord(event.attributes.dataOrigin);
  return readString(dataOrigin?.sourceProviderSlug)
    ?? readString(event.attributes.source)
    ?? null;
}

function readEventTimeZone(event: CanonicalEntity): string | null {
  const value = readString(event.attributes.timeZone);
  return value && isValidIanaTimeZone(value) ? value : null;
}

function selectLeadRecord(records: readonly JournalCandidate[]): JournalCandidate {
  return records.find((record) => record.kind === "activity_session")
    ?? records.find((record) => record.kind === "sleep_session")
    ?? records.find((record) => record.kind === "test")
    ?? records[0]!;
}

function eventGroupKind(records: readonly JournalCandidate[]): string {
  if (records.some((record) => record.groupHint?.startsWith("sleep:"))) return "sleep";
  if (records.some((record) => record.kind === "activity_session")) return "activity";
  if (records.some((record) => record.kind === "test")) return "test";
  return records[0]?.kind ?? "event";
}

function eventGroupTitle(
  records: readonly JournalCandidate[],
  lead: JournalCandidate,
): string {
  if (records.some((record) => record.groupHint?.startsWith("sleep:"))) return "Sleep";
  return lead.label;
}

function compareCandidates(left: JournalCandidate, right: JournalCandidate): number {
  return right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id);
}

function resolveDate(value: Date | string | undefined): string {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.valueOf())) throw new TypeError("Journal asOf must be a valid date.");
  return date.toISOString().slice(0, 10);
}

function normalizeWindowDays(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WINDOW_DAYS;
  if (!Number.isInteger(value) || value < 1 || value > 366) {
    throw new RangeError("Journal windowDays must be an integer from 1 through 366.");
  }
  return value;
}

function normalizeOccurredAt(value: string | undefined, date: string): string {
  return value && !Number.isNaN(Date.parse(value))
    ? value
    : `${date}T12:00:00.000Z`;
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function humanize(value: string): string {
  const words = value.replace(/[-_]+/gu, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
