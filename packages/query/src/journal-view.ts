import { isValidIanaTimeZone } from "@murphai/contracts";
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
  { key: "deep-sleep-minutes", label: "Deep sleep", group: "sleep" },
  { key: "rem-sleep-minutes", label: "REM sleep", group: "sleep" },
  { key: "hrv-rmssd", label: "HRV", group: "sleep" },
  { key: "resting-heart-rate", label: "Resting heart rate", group: "sleep" },
  { key: "respiratory-rate", label: "Respiratory rate", group: "sleep" },
  { key: "spo2", label: "SpO₂", group: "sleep" },
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

export function emptyJournalView(
  windowDays = DEFAULT_WINDOW_DAYS,
): JournalView {
  return { days: [], eventCount: 0, recordCount: 0, weeks: [], windowDays };
}

interface JournalCandidate extends JournalRecord {
  activityKey: string | null;
  date: string;
  detailItems: string[];
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
    ...vault.events.flatMap((event) =>
      journalCandidateFromEvent(event, fromDate, asOfDate),
    ),
    ...journalCandidatesFromExperiments(
      vault.experiments,
      vault.events,
      fromDate,
      asOfDate,
    ),
    ...journalMetricCandidates(metricPoints, fromDate, asOfDate),
  ])
    .sort(compareCandidates)
    .slice(0, MAX_RECORDS);
  const builtEvents = groupJournalCandidates(candidates);
  const weeks = buildJournalWeekSummaries(builtEvents);
  const events = builtEvents.map(
    ({
      activityMinutes: _activityMinutes,
      sleepMinutes: _sleepMinutes,
      sleepScore: _sleepScore,
      ...event
    }) => event,
  );
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
  const observationMetric = journalObservationMetric(event);
  const label = observationMetric?.label ?? eventLabel(event);
  const activityKey =
    event.kind === "activity_session"
      ? resolveAdherenceObservationActivityKind({
          attributes: event.attributes,
        }) ?? "activity"
      : null;
  const durationMinutes = readNumber(event.attributes.durationMinutes);
  const sleepType =
    event.kind === "sleep_session"
      ? readSleepType(event.attributes.sleepType)
      : null;
  const groupHint = event.kind === "experiment_context"
    ? experimentJournalGroupHint(label, date)
    : activityKey
    ? `activity:${date}:${activityKey.toLowerCase()}`
    : observationMetric
    ? `${observationMetric.group}:${date}`
    : null;
  return [
    {
      activityKey,
      date,
      detailItems: journalEventDetailItems(event),
      durationMinutes,
      groupHint,
      id: event.entityId,
      kind: event.kind,
      label,
      metricKey: observationMetric?.key ?? null,
      metricValue: observationMetric
        ? readNumber(event.attributes.value)
        : null,
      occurredAt,
      relatedIds: [
        ...new Set([
          ...event.relatedIds,
          ...event.links.map((link) => link.targetId),
        ]),
      ],
      sleepType,
      source: readEventSource(event),
      summary: eventSummary(event),
      tags: event.tags.slice(),
      timing: event.occurredAt ? "timed" : "all_day",
      timeZone: readEventTimeZone(event),
    },
  ];
}

function journalCandidatesFromExperiments(
  experiments: readonly CanonicalEntity[],
  events: readonly CanonicalEntity[],
  fromDate: string,
  toDate: string,
): JournalCandidate[] {
  const explicitDays = new Set(
    events.flatMap((event) => {
      if (event.kind !== "experiment_context") return [];
      const date = resolveEventDate(event);
      const label = event.title ?? "Personal experiment";
      return date ? [experimentJournalGroupHint(label, date)] : [];
    }),
  );

  return experiments.flatMap((experiment) => {
    const runPlan = readRecord(experiment.attributes.runPlan);
    const title = readString(experiment.attributes.title) ?? experiment.title;
    if (!runPlan || !title) return [];

    const candidates: JournalCandidate[] = [];
    const baselineStart = readString(runPlan.baselineStart);
    const baselineEnd = readString(runPlan.baselineEnd);
    const interventionStart = readString(runPlan.interventionStart);
    const interventionEnd = readString(runPlan.interventionEnd);
    const endedOn = readString(experiment.attributes.endedOn);
    const experimentStatus =
      readString(experiment.attributes.status) ?? experiment.status;

    if (baselineStart && baselineEnd) {
      appendExperimentPhaseCandidates({
        candidates,
        endDate: baselineEnd,
        explicitDays,
        experiment,
        fromDate,
        phase: "baseline",
        startDate: baselineStart,
        title,
        toDate,
      });
    }
    if (interventionStart && interventionEnd) {
      const completedOn =
        experimentStatus === "completed" ? endedOn ?? interventionEnd : null;
      appendExperimentPhaseCandidates({
        candidates,
        completedOn,
        endDate:
          completedOn && completedOn < interventionEnd
            ? completedOn
            : interventionEnd,
        explicitDays,
        experiment,
        fromDate,
        phase: "active",
        startDate: interventionStart,
        title,
        toDate,
      });
    }
    return candidates;
  });
}

function appendExperimentPhaseCandidates(input: {
  candidates: JournalCandidate[];
  completedOn?: string | null;
  endDate: string;
  explicitDays: ReadonlySet<string>;
  experiment: CanonicalEntity;
  fromDate: string;
  phase: "active" | "baseline";
  startDate: string;
  title: string;
  toDate: string;
}): void {
  let date = input.startDate;
  const totalDays = daysBetweenInclusive(input.startDate, input.endDate);
  if (totalDays === null) return;

  for (let day = 1; date <= input.endDate; day += 1) {
    if (date >= input.fromDate && date <= input.toDate) {
      const groupHint = experimentJournalGroupHint(input.title, date);
      if (!input.explicitDays.has(groupHint)) {
        const isCompleted = input.completedOn === date;
        const summary = isCompleted
          ? "Experiment completed"
          : input.phase === "baseline"
          ? `Baseline · day ${day}`
          : day === 1
          ? "Experiment started"
          : `Running experiment · day ${day}`;
        input.candidates.push({
          activityKey: null,
          date,
          detailItems: [
            `Status: ${isCompleted ? "Completed" : humanize(input.phase)}`,
            `Progress: Day ${day} of ${totalDays}`,
          ],
          durationMinutes: null,
          groupHint,
          id: `${input.experiment.entityId}:${input.phase}:${date}`,
          kind: "experiment_context",
          label: input.title,
          metricKey: null,
          metricValue: null,
          occurredAt: `${date}T12:00:00.000Z`,
          relatedIds: [input.experiment.entityId],
          sleepType: null,
          source: "murph",
          summary,
          tags: input.experiment.tags.slice(),
          timing: "all_day",
          timeZone: null,
        });
      }
    }
    date = addDays(date, 1);
  }
}

function experimentJournalGroupHint(title: string, date: string): string {
  return `experiment:${title.trim().toLowerCase()}:${date}`;
}

function daysBetweenInclusive(startDate: string, endDate: string): number | null {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return Math.round((end - start) / 86_400_000) + 1;
}

function journalMetricCandidates(
  points: readonly MetricPoint[],
  fromDate: string,
  toDate: string,
): JournalCandidate[] {
  return JOURNAL_METRICS.flatMap((metric) =>
    selectMetricSeries({
      from: fromDate,
      metricKey: metric.key,
      points,
      to: toDate,
    }).rows.flatMap((row) => {
      if (row.value === null || row.confidence === "none") return [];
      const unit = row.unit ? ` ${row.unit}` : "";
      return [
        {
          activityKey: null,
          date: row.date,
          detailItems: [],
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
        },
      ];
    }),
  );
}

function normalizeJournalCandidates(
  candidates: readonly JournalCandidate[],
): JournalCandidate[] {
  const normalized = candidates.map((candidate) => ({ ...candidate }));
  const sleepSessionsByDate = new Map<string, JournalCandidate[]>();
  const canonicalObservationMetrics = new Set(
    normalized
      .filter(
        (candidate) =>
          candidate.kind === "observation" && candidate.metricKey !== null,
      )
      .map((candidate) => `${candidate.date}:${candidate.metricKey}`),
  );

  for (const candidate of normalized) {
    if (candidate.kind !== "sleep_session") continue;
    const sessions = sleepSessionsByDate.get(candidate.date) ?? [];
    sessions.push(candidate);
    sleepSessionsByDate.set(candidate.date, sessions);
  }

  for (const [date, sessions] of sleepSessionsByDate) {
    const explicitMain = sessions.filter(
      (session) => session.sleepType === "main_sleep",
    );
    const unknown = sessions.filter(
      (session) => session.sleepType === "unknown",
    );
    const selectedUnknownMain =
      unknown.slice().sort(compareSleepDuration)[0] ?? null;

    for (const session of sessions) {
      const isLongUnknownSleep =
        session.sleepType === "unknown" &&
        (session.durationMinutes ?? 0) >= 180;
      const isMain =
        session.sleepType === "main_sleep" ||
        session === selectedUnknownMain ||
        (explicitMain.length > 0 && isLongUnknownSleep);
      session.groupHint = isMain ? `sleep:${date}` : `nap:${session.id}`;
      session.timing = isMain ? "night" : "timed";
    }
  }

  const hasSleepSession = new Set(sleepSessionsByDate.keys());
  const readinessByDate = new Map<string, number>();
  const recoveryByDate = new Map<string, number>();
  const preferRecoveryDates = new Set<string>();
  for (const candidate of normalized) {
    if (
      candidate.metricKey === "readiness-score" &&
      candidate.metricValue !== null
    ) {
      readinessByDate.set(candidate.date, candidate.metricValue);
    }
    if (
      candidate.metricKey === "recovery-score" &&
      candidate.metricValue !== null
    ) {
      recoveryByDate.set(candidate.date, candidate.metricValue);
      if (candidate.source?.toLocaleLowerCase().includes("whoop")) {
        preferRecoveryDates.add(candidate.date);
      }
    }
  }

  return normalized.filter((candidate) => {
    if (
      candidate.kind === "metric" &&
      candidate.metricKey &&
      canonicalObservationMetrics.has(
        `${candidate.date}:${candidate.metricKey}`,
      )
    ) {
      return false;
    }
    if (
      candidate.metricKey === "total-sleep" &&
      hasSleepSession.has(candidate.date)
    ) {
      return false;
    }
    if (
      candidate.metricKey === "recovery-score" &&
      candidate.metricValue !== null
    ) {
      return (
        readinessByDate.get(candidate.date) !== candidate.metricValue ||
        preferRecoveryDates.has(candidate.date)
      );
    }
    if (
      candidate.metricKey === "readiness-score" &&
      candidate.metricValue !== null
    ) {
      return (
        recoveryByDate.get(candidate.date) !== candidate.metricValue ||
        !preferRecoveryDates.has(candidate.date)
      );
    }
    return true;
  });
}

function journalObservationMetric(
  event: CanonicalEntity,
): (typeof JOURNAL_METRICS)[number] | null {
  if (event.kind !== "observation") return null;
  const metric = readString(event.attributes.metric);
  if (!metric) return null;
  return JOURNAL_METRICS.find((candidate) => candidate.key === metric) ?? null;
}

function groupJournalCandidates(
  candidates: readonly JournalCandidate[],
): BuiltJournalEvent[] {
  const parent = new Map(
    candidates.map((candidate) => [candidate.id, candidate.id]),
  );
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
      id: sorted
        .map((record) => record.id)
        .sort()
        .join(":"),
      kind: eventGroupKind(sorted),
      occurredAt: lead.occurredAt,
      records: sorted.map(
        ({
          activityKey: _activityKey,
          date: _date,
          detailItems: _detailItems,
          durationMinutes: _durationMinutes,
          groupHint: _hint,
          metricKey: _metricKey,
          metricValue: _metricValue,
          relatedIds: _related,
          sleepType: _sleepType,
          timing: _timing,
          ...record
        }) => record,
      ),
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
  return (
    kind === "activity_session" ||
    kind === "experiment_context" ||
    kind === "intervention_session" ||
    kind === "meal" ||
    kind === "note" ||
    kind === "observation" ||
    kind === "sleep_session" ||
    kind === "symptom" ||
    kind === "test"
  );
}

function resolveEventDate(event: CanonicalEntity): string | null {
  if (event.kind === "activity_session")
    return resolveActivityEvidenceLocalDate(event);
  if (event.kind === "intervention_session")
    return resolveInterventionSessionLocalDate(event);
  return event.date ?? event.occurredAt?.slice(0, 10) ?? null;
}

function eventLabel(event: CanonicalEntity): string {
  if (event.kind === "activity_session") {
    return humanize(
      resolveAdherenceObservationActivityKind({
        attributes: event.attributes,
      }) ??
        event.title ??
        "activity",
    );
  }
  if (event.kind === "experiment_context") {
    return event.title ?? "Personal experiment";
  }
  if (event.title) return event.title;
  if (event.kind === "intervention_session") {
    return humanize(
      readString(event.attributes.interventionType) ?? "intervention",
    );
  }
  if (event.kind === "observation")
    return humanize(readString(event.attributes.metric) ?? "observation");
  if (event.kind === "symptom")
    return humanize(readString(event.attributes.symptom) ?? "symptom");
  if (event.kind === "test")
    return readString(event.attributes.testName) ?? "Test result";
  if (event.kind === "meal") return "Meal";
  if (event.kind === "sleep_session") return "Sleep";
  return humanize(event.kind);
}

function eventSummary(event: CanonicalEntity): string | null {
  const note = readString(event.attributes.note);
  if (note) {
    if (
      event.tags.includes("key-late-caffeine") ||
      event.tags.includes("key-high-strain") ||
      event.tags.includes("key-bedroom-temperature")
    ) {
      return null;
    }
    if (event.tags.includes("episode-work-trip")) {
      return readString(event.attributes.destination);
    }
    return note;
  }
  const summary = readString(event.attributes.summary);
  if (event.kind === "experiment_context") {
    return experimentJournalSummary(event, summary);
  }
  if (summary) return summary;
  if (event.kind === "meal") return mealSummary(event.attributes);
  if (event.kind === "observation") {
    const value = readNumber(event.attributes.value);
    if (value !== null) {
      const unit = readString(event.attributes.unit);
      return `${value}${unit ? ` ${unit}` : ""}`;
    }
  }
  if (
    event.kind === "activity_session" ||
    event.kind === "intervention_session"
  ) {
    const duration = readNumber(event.attributes.durationMinutes);
    return duration === null ? null : `${duration} min`;
  }
  if (event.kind === "sleep_session") {
    const duration = readNumber(event.attributes.durationMinutes);
    return duration === null ? null : `${duration} min`;
  }
  return event.body?.trim() || null;
}

function mealSummary(attributes: Record<string, unknown>): string | null {
  const ingredients = Array.isArray(attributes.ingredients)
    ? attributes.ingredients
        .map(readString)
        .filter((value): value is string => value !== null)
        .slice(0, 3)
    : [];
  return ingredients.length > 0 ? ingredients.join(", ") : "Meal recorded";
}

function journalEventDetailItems(event: CanonicalEntity): string[] {
  if (event.kind === "activity_session") {
    return activityDetailItems(event.attributes);
  }

  if (event.kind === "experiment_context") {
    const status = readString(event.attributes.status) ?? event.status;
    const progress = readString(event.attributes.progress);
    const result =
      readString(event.attributes.resultSummary) ??
      readString(event.attributes.result);
    return uniqueStrings([
      status ? `Status: ${humanize(status)}` : null,
      progress ? `Progress: ${progress}` : null,
      result ? `Result: ${result}` : null,
    ]);
  }

  if (event.kind === "meal") {
    const nutrition = readRecord(event.attributes.nutrition);
    const totals = readRecord(nutrition?.totals);
    return uniqueStrings([
      formatJournalDetail("Energy", readNumber(totals?.calories), "kcal"),
      formatJournalDetail("Protein", readNumber(totals?.proteinGrams), "g"),
      formatJournalDetail(
        "Carbohydrates",
        readNumber(totals?.carbohydrateGrams),
        "g",
      ),
    ]);
  }

  if (event.kind === "test") {
    return uniqueStrings([
      readNumber(event.attributes.markerCount) === null
        ? null
        : `Markers: ${readNumber(event.attributes.markerCount)}`,
      readNumber(event.attributes.flaggedCount) === null
        ? null
        : `Flagged: ${readNumber(event.attributes.flaggedCount)}`,
      readString(event.attributes.resultSummary)
        ? `Summary: ${readString(event.attributes.resultSummary)}`
        : null,
    ]);
  }

  if (event.kind === "note") {
    return uniqueStrings([
      readString(event.attributes.detail),
      readString(event.attributes.destination)
        ? `Destination: ${readString(event.attributes.destination)}`
        : null,
      readString(event.attributes.location)
        ? `Location: ${readString(event.attributes.location)}`
        : null,
      readString(event.attributes.duration)
        ? `Duration: ${readString(event.attributes.duration)}`
        : null,
      readString(event.attributes.timeZoneChange)
        ? `Time zones: ${readString(event.attributes.timeZoneChange)}`
        : null,
      readString(event.attributes.platform)
        ? `Platform: ${humanize(readString(event.attributes.platform) ?? "")}`
        : null,
      readString(event.attributes.groupName)
        ? `Group: ${readString(event.attributes.groupName)}`
        : null,
    ]);
  }

  return [];
}

function experimentJournalSummary(
  event: CanonicalEntity,
  summary: string | null,
): string | null {
  const status = readString(event.attributes.status) ?? event.status;
  const progress = readString(event.attributes.progress) ?? summary;
  const day = progress?.match(/\bday\s+(\d+)\b/i)?.[1] ?? null;

  if (status === "completed") return "Experiment completed";
  if (status === "baseline") {
    return day ? `Baseline · day ${day}` : "Baseline";
  }
  if (status === "active") {
    if (day === "1") return "Experiment started";
    return day ? `Running experiment · day ${day}` : "Running experiment";
  }
  return progress;
}

function activityDetailItems(attributes: Record<string, unknown>): string[] {
  const workout = readRecord(attributes.workout);
  const metrics = readRecord(workout?.metrics);
  const distanceKm =
    readNumber(attributes.distanceKm) ?? readNumber(workout?.distanceKm);
  const averageHeartRate =
    readNumber(metrics?.averageHeartRate) ??
    readNumber(metrics?.averageHeartRateBpm) ??
    readNumber(attributes.averageHeartRate);
  const maxHeartRate =
    readNumber(metrics?.maxHeartRate) ??
    readNumber(metrics?.maxHeartRateBpm) ??
    readNumber(attributes.maxHeartRate);
  const strain =
    readNumber(metrics?.workoutStrain) ??
    readNumber(attributes.workoutStrain) ??
    readNumber(attributes.strain);
  const activeCalories =
    readNumber(metrics?.activeCalories) ??
    readNumber(attributes.activeCalories);
  const totalCalories =
    readNumber(metrics?.totalCalories) ?? readNumber(attributes.totalCalories);
  const elevationGain =
    readNumber(metrics?.totalElevationGainMeters) ??
    readNumber(attributes.totalElevationGainMeters);
  const averagePower = readNumber(metrics?.averagePowerWatts);
  const exercises = Array.isArray(workout?.exercises)
    ? workout.exercises
        .map((exercise) =>
          typeof exercise === "string"
            ? exercise.trim()
            : readString(readRecord(exercise)?.name),
        )
        .filter((exercise): exercise is string => Boolean(exercise))
        .slice(0, 6)
    : [];

  return uniqueStrings([
    readString(workout?.routineName),
    readString(workout?.sportName),
    formatJournalDetail("Distance", distanceKm, "km"),
    formatJournalDetail("Average heart rate", averageHeartRate, "bpm"),
    formatJournalDetail("Maximum heart rate", maxHeartRate, "bpm"),
    formatJournalDetail("Strain", strain),
    formatJournalDetail(
      activeCalories === null ? "Energy" : "Active energy",
      activeCalories ?? totalCalories,
      "kcal",
    ),
    formatJournalDetail("Elevation gain", elevationGain, "m"),
    formatJournalDetail("Average power", averagePower, "W"),
    exercises.length > 0 ? `Exercises: ${exercises.join(", ")}` : null,
  ]);
}

function formatJournalDetail(
  label: string,
  value: number | null,
  unit?: string,
): string | null {
  if (value === null) return null;
  return `${label}: ${formatDetailNumber(value)}${unit ? ` ${unit}` : ""}`;
}

function formatDetailNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function readEventSource(event: CanonicalEntity): string | null {
  const dataOrigin = readRecord(event.attributes.dataOrigin);
  return (
    readString(dataOrigin?.sourceProviderSlug) ??
    readString(event.attributes.source) ??
    null
  );
}

function readEventTimeZone(event: CanonicalEntity): string | null {
  const value = readString(event.attributes.timeZone);
  return value && isValidIanaTimeZone(value) ? value : null;
}

function selectLeadRecord(
  records: readonly JournalCandidate[],
): JournalCandidate {
  return (
    records.find((record) => record.kind === "activity_session") ??
    records.find((record) => record.kind === "sleep_session") ??
    records.find((record) => record.kind === "test") ??
    records[0]!
  );
}

function eventGroupKind(records: readonly JournalCandidate[]): string {
  if (records.some((record) => record.groupHint?.startsWith("nap:")))
    return "nap";
  if (records.some((record) => record.groupHint?.startsWith("sleep:")))
    return "sleep";
  if (records.some((record) => record.kind === "activity_session"))
    return "activity";
  if (records.some((record) => record.kind === "test")) return "test";
  return records[0]?.kind ?? "event";
}

function eventGroupTitle(
  records: readonly JournalCandidate[],
  lead: JournalCandidate,
): string {
  if (records.some((record) => record.groupHint?.startsWith("nap:")))
    return "Nap";
  if (records.some((record) => record.groupHint?.startsWith("sleep:")))
    return "Sleep";
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
  const activitySessions = records.filter(
    (record) => record.kind === "activity_session",
  );
  if (activitySessions.length > 0) {
    const activityMinutes = sumNumbers(
      activitySessions.map((record) => record.durationMinutes),
    );
    return {
      activityMinutes,
      details: uniqueStrings(
        records.flatMap((record) => [
          ...record.detailItems,
          ...(record.kind === "note" ? [record.summary] : []),
        ]),
      ),
      sleepMinutes: null,
      sleepScore: null,
      summary:
        activityMinutes > 0
          ? `${formatDuration(activityMinutes)}${
              activitySessions.length > 1
                ? ` across ${activitySessions.length} sessions`
                : ""
            }`
          : lead.summary,
      timing: "timed",
    };
  }

  const sleepSessions = records.filter(
    (record) => record.kind === "sleep_session",
  );
  const isNap = records.some((record) => record.groupHint?.startsWith("nap:"));
  if (
    sleepSessions.length > 0 ||
    records.some((record) => record.groupHint?.startsWith("sleep:"))
  ) {
    const sleepMinutes = maxNumber(
      sleepSessions.map((record) => record.durationMinutes),
    );
    const sleepScore = metricValue(records, "sleep-score");
    const summaryParts = [
      sleepMinutes === null ? null : formatDuration(sleepMinutes),
      !isNap && sleepScore !== null
        ? `sleep score ${formatNumber(sleepScore)}`
        : null,
    ].filter((value): value is string => value !== null);
    const details = isNap
      ? []
      : [
          formatMetricDetail(
            records,
            "sleep-efficiency",
            (value) => `${formatNumber(value)}% efficiency`,
          ),
          formatMetricDetail(
            records,
            "hrv-rmssd",
            (value) => `HRV ${formatNumber(value)} ms`,
          ),
          formatMetricDetail(
            records,
            "readiness-score",
            (value) => `readiness ${formatNumber(value)}`,
          ),
          formatMetricDetail(
            records,
            "recovery-score",
            (value) => `recovery ${formatNumber(value)}`,
          ),
          formatMetricDetail(
            records,
            "resting-heart-rate",
            (value) => `resting HR ${formatNumber(value)} bpm`,
          ),
          formatMetricDetail(
            records,
            "deep-sleep-minutes",
            (value) => `deep sleep ${formatNumber(value)} min`,
          ),
          formatMetricDetail(
            records,
            "rem-sleep-minutes",
            (value) => `REM sleep ${formatNumber(value)} min`,
          ),
          formatMetricDetail(
            records,
            "respiratory-rate",
            (value) => `respiratory rate ${formatNumber(value)} breaths/min`,
          ),
          formatMetricDetail(
            records,
            "spo2",
            (value) => `SpO₂ ${formatNumber(value)}%`,
          ),
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
    details: uniqueStrings(
      records.flatMap((record) => [
        ...record.detailItems,
        ...(record !== lead ? [record.summary] : []),
      ]),
    ),
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
      const sleepEvents = weekEvents.filter(
        (event) => event.sleepMinutes !== null,
      );
      const sleepMinutes = sleepEvents
        .map((event) => event.sleepMinutes)
        .filter((value): value is number => value !== null);
      const sleepScores = sleepEvents
        .map((event) => event.sleepScore)
        .filter((value): value is number => value !== null);
      return {
        activityMinutes: sumNumbers(
          weekEvents.map((event) => event.activityMinutes),
        ),
        averageSleepMinutes: averageNumbers(sleepMinutes),
        averageSleepScore: averageNumbers(sleepScores),
        endDate: addDays(startDate, 6),
        sleepNights: sleepEvents.length,
        startDate,
      };
    });
}

function isJournalProfileEvent(event: CanonicalEntity): boolean {
  const title = event.title?.trim().toLowerCase() ?? null;
  if (title === "junction profile") return true;
  if (event.kind !== "observation") return false;
  const metric =
    readString(event.attributes.metric)?.trim().toLowerCase() ?? null;
  return title === "profile" || metric === "profile";
}

function readSleepType(value: unknown): "main_sleep" | "nap" | "unknown" {
  return value === "main_sleep" || value === "nap" ? value : "unknown";
}

function compareSleepDuration(
  left: JournalCandidate,
  right: JournalCandidate,
): number {
  return (
    (right.durationMinutes ?? 0) - (left.durationMinutes ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

function metricValue(
  records: readonly JournalCandidate[],
  metricKey: string,
): number | null {
  return (
    records.find((record) => record.metricKey === metricKey)?.metricValue ??
    null
  );
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
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function uniqueStrings(values: readonly (string | null)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function startOfIsoWeek(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDay();
  return addDays(date, -(day === 0 ? 6 : day - 1));
}

function compareCandidates(
  left: JournalCandidate,
  right: JournalCandidate,
): number {
  return (
    right.occurredAt.localeCompare(left.occurredAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareJournalEvents(left: JournalEvent, right: JournalEvent): number {
  const timingRank: Record<JournalEventTiming, number> = {
    all_day: 0,
    night: 1,
    timed: 2,
  };
  return (
    timingRank[left.timing] - timingRank[right.timing] ||
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.id.localeCompare(right.id)
  );
}

function resolveDate(value: Date | string | undefined): string {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.valueOf()))
    throw new TypeError("Journal asOf must be a valid date.");
  return date.toISOString().slice(0, 10);
}

function normalizeWindowDays(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WINDOW_DAYS;
  if (!Number.isInteger(value) || value < 1 || value > 366) {
    throw new RangeError(
      "Journal windowDays must be an integer from 1 through 366.",
    );
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
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
