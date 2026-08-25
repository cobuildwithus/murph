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
const MAX_RECORDS = 1_500;

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
  details: string[];
  id: string;
  kind: string;
  occurredAt: string;
  records: JournalRecord[];
  summary: string | null;
  timing: JournalEventTiming;
  timeZone: string | null;
  title: string;
}

export type JournalEventTiming = "all_day" | "night" | "timed";

export interface JournalDay {
  date: string;
  events: JournalEvent[];
}

export interface JournalView {
  days: JournalDay[];
  eventCount: number;
  recordCount: number;
  weeks: JournalWeekSummary[];
  windowDays: number;
}

export interface JournalWeekSummary {
  activityMinutes: number;
  averageSleepMinutes: number | null;
  averageSleepScore: number | null;
  endDate: string;
  sleepNights: number;
  startDate: string;
}

export function emptyJournalView(windowDays = DEFAULT_WINDOW_DAYS): JournalView {
  return { days: [], eventCount: 0, recordCount: 0, weeks: [], windowDays };
}

interface JournalCandidate extends JournalRecord {
  activityKey: string | null;
  date: string;
  durationMinutes: number | null;
  groupHint: string | null;
  metricKey: string | null;
  metricValue: number | null;
  relatedIds: string[];
  sleepType: "main_sleep" | "nap" | "unknown" | null;
  timing: JournalEventTiming;
}

interface BuiltJournalEvent extends JournalEvent {
  activityMinutes: number;
  sleepMinutes: number | null;
  sleepScore: number | null;
}

export function buildJournalView(
  vault: VaultReadModel,
  metricPoints: readonly MetricPoint[] = [],
  options: { asOf?: Date | string; windowDays?: number } = {},
): JournalView {
  const asOfDate = resolveDate(options.asOf);
  const windowDays = normalizeWindowDays(options.windowDays);
  const fromDate = addDays(asOfDate, -(windowDays - 1));
  const candidates = normalizeJournalCandidates([
    ...vault.events.flatMap((event) => journalCandidateFromEvent(event, fromDate, asOfDate)),
    ...journalMetricCandidates(metricPoints, fromDate, asOfDate),
  ])
    .sort(compareCandidates)
    .slice(0, MAX_RECORDS);
  const builtEvents = groupJournalCandidates(candidates);
  const weeks = buildJournalWeekSummaries(builtEvents);
  const events = builtEvents.map(({
    activityMinutes: _activityMinutes,
    sleepMinutes: _sleepMinutes,
    sleepScore: _sleepScore,
    ...event
  }) => event);
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
      events: dayEvents.sort(compareJournalEvents),
    }));

  return {
    days,
    eventCount: events.length,
    recordCount: candidates.length,
    weeks,
    windowDays,
  };
}

function journalCandidateFromEvent(
  event: CanonicalEntity,
  fromDate: string,
  toDate: string,
): JournalCandidate[] {
  if (event.family !== "event" || !isJournalEventKind(event.kind)) return [];
  if (isJournalProfileEvent(event)) return [];
  const date = resolveEventDate(event);
  if (!date || date < fromDate || date > toDate) return [];
  const occurredAt = normalizeOccurredAt(event.occurredAt ?? undefined, date);
  const label = eventLabel(event);
  const activityKey = event.kind === "activity_session"
    ? resolveAdherenceObservationActivityKind({ attributes: event.attributes }) ?? "activity"
    : null;
  const durationMinutes = readNumber(event.attributes.durationMinutes);
  const sleepType = event.kind === "sleep_session"
    ? readSleepType(event.attributes.sleepType)
    : null;
  const groupHint = activityKey ? `activity:${date}:${activityKey.toLowerCase()}` : null;
  return [{
    activityKey,
    date,
    durationMinutes,
    groupHint,
    id: event.entityId,
    kind: event.kind,
    label,
    metricKey: null,
    metricValue: null,
    occurredAt,
    relatedIds: [...new Set([...event.relatedIds, ...event.links.map((link) => link.targetId)])],
    sleepType,
    source: readEventSource(event),
    summary: eventSummary(event),
    tags: event.tags.slice(),
    timing: event.occurredAt ? "timed" : "all_day",
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
          activityKey: null,
          date: row.date,
          durationMinutes: null,
          groupHint: `${metric.group}:${row.date}`,
          id: `journal_metric_${metric.key}_${row.date}`,
          kind: "metric",
          label: metric.label,
          metricKey: metric.key,
          metricValue: row.value,
          occurredAt: normalizeOccurredAt(row.observedAt, row.date),
          relatedIds: row.recordIds?.slice() ?? [],
          sleepType: null,
          source: row.sourceLabel ?? null,
          summary: `${row.value}${unit}`,
          tags: [metric.key],
          timing: "night",
          timeZone: null,
        }];
      })
  );
}

function normalizeJournalCandidates(
  candidates: readonly JournalCandidate[],
): JournalCandidate[] {
  const normalized = candidates.map((candidate) => ({ ...candidate }));
  const sleepSessionsByDate = new Map<string, JournalCandidate[]>();

  for (const candidate of normalized) {
    if (candidate.kind !== "sleep_session") continue;
    const sessions = sleepSessionsByDate.get(candidate.date) ?? [];
    sessions.push(candidate);
    sleepSessionsByDate.set(candidate.date, sessions);
  }

  for (const [date, sessions] of sleepSessionsByDate) {
    const explicitMain = sessions.filter((session) => session.sleepType === "main_sleep");
    const unknown = sessions.filter((session) => session.sleepType === "unknown");
    const selectedUnknownMain = unknown.slice().sort(compareSleepDuration)[0] ?? null;

    for (const session of sessions) {
      const isLongUnknownSleep = session.sleepType === "unknown"
        && (session.durationMinutes ?? 0) >= 180;
      const isMain = session.sleepType === "main_sleep"
        || session === selectedUnknownMain
        || (explicitMain.length > 0 && isLongUnknownSleep);
      session.groupHint = isMain ? `sleep:${date}` : `nap:${session.id}`;
      session.timing = isMain ? "night" : "timed";
    }
  }

  const hasSleepSession = new Set(sleepSessionsByDate.keys());
  const readinessByDate = new Map<string, number>();
  for (const candidate of normalized) {
    if (candidate.metricKey === "readiness-score" && candidate.metricValue !== null) {
      readinessByDate.set(candidate.date, candidate.metricValue);
    }
  }

  return normalized.filter((candidate) => {
    if (candidate.metricKey === "total-sleep" && hasSleepSession.has(candidate.date)) {
      return false;
    }
    if (candidate.metricKey === "recovery-score" && candidate.metricValue !== null) {
      return readinessByDate.get(candidate.date) !== candidate.metricValue;
    }
    return true;
  });
}

function groupJournalCandidates(candidates: readonly JournalCandidate[]): BuiltJournalEvent[] {
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
    const presentation = buildEventPresentation(sorted, lead);
    return {
      activityMinutes: presentation.activityMinutes,
      date: lead.date,
      details: presentation.details,
      id: sorted.map((record) => record.id).sort().join(":"),
      kind: eventGroupKind(sorted),
      occurredAt: lead.occurredAt,
      records: sorted.map(({
        activityKey: _activityKey,
        date: _date,
        durationMinutes: _durationMinutes,
        groupHint: _hint,
        metricKey: _metricKey,
        metricValue: _metricValue,
        relatedIds: _related,
        sleepType: _sleepType,
        timing: _timing,
        ...record
      }) => record),
      sleepMinutes: presentation.sleepMinutes,
      sleepScore: presentation.sleepScore,
      summary: presentation.summary,
      timing: presentation.timing,
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
  if (event.kind === "activity_session") {
    return humanize(
      resolveAdherenceObservationActivityKind({ attributes: event.attributes })
        ?? event.title
        ?? "activity",
    );
  }
  if (event.title) return event.title;
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
  if (records.some((record) => record.groupHint?.startsWith("nap:"))) return "nap";
  if (records.some((record) => record.groupHint?.startsWith("sleep:"))) return "sleep";
  if (records.some((record) => record.kind === "activity_session")) return "activity";
  if (records.some((record) => record.kind === "test")) return "test";
  return records[0]?.kind ?? "event";
}

function eventGroupTitle(
  records: readonly JournalCandidate[],
  lead: JournalCandidate,
): string {
  if (records.some((record) => record.groupHint?.startsWith("nap:"))) return "Nap";
  if (records.some((record) => record.groupHint?.startsWith("sleep:"))) return "Sleep";
  return lead.label;
}

function buildEventPresentation(
  records: readonly JournalCandidate[],
  lead: JournalCandidate,
): {
  activityMinutes: number;
  details: string[];
  sleepMinutes: number | null;
  sleepScore: number | null;
  summary: string | null;
  timing: JournalEventTiming;
} {
  const activitySessions = records.filter((record) => record.kind === "activity_session");
  if (activitySessions.length > 0) {
    const activityMinutes = sumNumbers(activitySessions.map((record) => record.durationMinutes));
    return {
      activityMinutes,
      details: uniqueStrings(records
        .filter((record) => record.kind === "note")
        .map((record) => record.summary)),
      sleepMinutes: null,
      sleepScore: null,
      summary: activityMinutes > 0
        ? `${formatDuration(activityMinutes)}${activitySessions.length > 1
          ? ` across ${activitySessions.length} sessions`
          : ""}`
        : lead.summary,
      timing: "timed",
    };
  }

  const sleepSessions = records.filter((record) => record.kind === "sleep_session");
  const isNap = records.some((record) => record.groupHint?.startsWith("nap:"));
  if (sleepSessions.length > 0 || records.some((record) => record.groupHint?.startsWith("sleep:"))) {
    const sleepMinutes = maxNumber(sleepSessions.map((record) => record.durationMinutes));
    const sleepScore = metricValue(records, "sleep-score");
    const summaryParts = [
      sleepMinutes === null ? null : formatDuration(sleepMinutes),
      !isNap && sleepScore !== null ? `score ${formatNumber(sleepScore)}` : null,
    ].filter((value): value is string => value !== null);
    const details = isNap ? [] : [
      formatMetricDetail(records, "sleep-efficiency", (value) => `${formatNumber(value)}% efficiency`),
      formatMetricDetail(records, "hrv-rmssd", (value) => `HRV ${formatNumber(value)} ms`),
      formatMetricDetail(records, "readiness-score", (value) => `readiness ${formatNumber(value)}`),
      formatMetricDetail(records, "resting-heart-rate", (value) => `resting HR ${formatNumber(value)} bpm`),
    ].filter((value): value is string => value !== null);
    return {
      activityMinutes: 0,
      details,
      sleepMinutes: isNap ? null : sleepMinutes,
      sleepScore: isNap ? null : sleepScore,
      summary: summaryParts.length > 0 ? summaryParts.join(" · ") : null,
      timing: isNap ? "timed" : "night",
    };
  }

  return {
    activityMinutes: 0,
    details: uniqueStrings(records
      .filter((record) => record !== lead)
      .map((record) => record.summary)),
    sleepMinutes: null,
    sleepScore: null,
    summary: lead.summary,
    timing: lead.timing,
  };
}

function buildJournalWeekSummaries(
  events: readonly BuiltJournalEvent[],
): JournalWeekSummary[] {
  const byStartDate = new Map<string, BuiltJournalEvent[]>();
  for (const event of events) {
    const startDate = startOfIsoWeek(event.date);
    const weekEvents = byStartDate.get(startDate) ?? [];
    weekEvents.push(event);
    byStartDate.set(startDate, weekEvents);
  }

  return [...byStartDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([startDate, weekEvents]) => {
      const sleepEvents = weekEvents.filter((event) => event.sleepMinutes !== null);
      const sleepMinutes = sleepEvents
        .map((event) => event.sleepMinutes)
        .filter((value): value is number => value !== null);
      const sleepScores = sleepEvents
        .map((event) => event.sleepScore)
        .filter((value): value is number => value !== null);
      return {
        activityMinutes: sumNumbers(weekEvents.map((event) => event.activityMinutes)),
        averageSleepMinutes: averageNumbers(sleepMinutes),
        averageSleepScore: averageNumbers(sleepScores),
        endDate: addDays(startDate, 6),
        sleepNights: sleepEvents.length,
        startDate,
      };
    });
}

function isJournalProfileEvent(event: CanonicalEntity): boolean {
  if (event.kind !== "observation") return false;
  const values = [event.title, readString(event.attributes.metric)]
    .filter((value): value is string => value !== null)
    .map((value) => value.trim().toLowerCase());
  return values.some((value) => value === "profile" || value === "junction profile");
}

function readSleepType(value: unknown): "main_sleep" | "nap" | "unknown" {
  return value === "main_sleep" || value === "nap" ? value : "unknown";
}

function compareSleepDuration(left: JournalCandidate, right: JournalCandidate): number {
  return (right.durationMinutes ?? 0) - (left.durationMinutes ?? 0)
    || left.id.localeCompare(right.id);
}

function metricValue(records: readonly JournalCandidate[], metricKey: string): number | null {
  return records.find((record) => record.metricKey === metricKey)?.metricValue ?? null;
}

function formatMetricDetail(
  records: readonly JournalCandidate[],
  metricKey: string,
  format: (value: number) => string,
): string | null {
  const value = metricValue(records, metricKey);
  return value === null ? null : format(value);
}

function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainingMinutes = rounded % 60;
  if (hours === 0) return `${remainingMinutes} min`;
  if (remainingMinutes === 0) return `${hours} h`;
  return `${hours} h ${remainingMinutes}`;
}

function formatNumber(value: number): string {
  return String(Math.round(value));
}

function sumNumbers(values: readonly (number | null)[]): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function maxNumber(values: readonly (number | null)[]): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

function averageNumbers(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function uniqueStrings(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function startOfIsoWeek(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDay();
  return addDays(date, -(day === 0 ? 6 : day - 1));
}

function compareCandidates(left: JournalCandidate, right: JournalCandidate): number {
  return right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id);
}

function compareJournalEvents(left: JournalEvent, right: JournalEvent): number {
  const timingRank: Record<JournalEventTiming, number> = {
    all_day: 0,
    night: 1,
    timed: 2,
  };
  return timingRank[left.timing] - timingRank[right.timing]
    || left.occurredAt.localeCompare(right.occurredAt)
    || left.id.localeCompare(right.id);
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
  const words = value
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/[-_]+/gu, " ")
    .toLowerCase()
    .replace(/\byardwork\b/gu, "yard work");
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
