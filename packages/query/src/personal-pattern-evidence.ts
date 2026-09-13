import { deviceDataOriginSchema } from "@murphai/contracts";
import type { CanonicalEntity } from "./canonical-entities.ts";
import { resolveActivityEvidenceLocalDate } from "./experiment-adherence.ts";
import type { WearableActivityDay, WearableResolvedMetric } from "./wearables.ts";
import { resolveWearablePublicSourceProvider } from "./wearables/origin.ts";

export const patternAddDays = (date: string, days: number): string =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
export const patternDayGap = (a: string, b: string): number =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Keep the import route and underlying device instance, never a resource id. */
export function personalPatternSource(input: {
  dataOrigin?: unknown;
  externalRef?: unknown;
  provider?: string | null;
}): string | null {
  const parsed = deviceDataOriginSchema.safeParse(input.dataOrigin);
  const origin = parsed.success ? parsed.data : null;
  const ref = record(input.externalRef);
  const field = (key: string) => typeof ref[key] === "string" ? ref[key] : null;
  const provider = resolveWearablePublicSourceProvider({
    dataOrigin: origin,
    externalRef: {
      system: field("system"), resourceType: field("resourceType"),
      resourceId: null, facet: null, version: null,
    },
    provider: input.provider,
  }, { suppressJunctionSourceInstanceFallback: true });
  if (["unknown", "device", "wearable", "junction"].includes(provider)) return null;
  return JSON.stringify([provider, origin?.aggregatorProvider ?? field("system") ?? provider,
    origin?.sourceInstanceId ?? null, origin?.sourceType ?? null]);
}

export function personalPatternMetricSource(metric: WearableResolvedMetric): string | null {
  if (metric.confidence.conflictingProviders.length > 0) return null;
  const selected = metric.candidates.filter((candidate) =>
    candidate.provider === metric.selection.provider
    && candidate.recordIds.some((id) => metric.selection.recordIds.includes(id)));
  const sources = new Set(selected.map(personalPatternSource));
  if (sources.size > 1) return null;
  return selected.length ? personalPatternSource(selected[0])
    : personalPatternSource({ provider: metric.selection.provider });
}

export interface PersonalPatternEvidence {
  dailySteps: Map<string, Map<string, number>>;
  qualifiedDates: Map<string, Set<string>>;
  excludedActivityDates: Set<string>;
}

export function buildPersonalPatternEvidence(
  events: readonly CanonicalEntity[],
  activityDays: readonly WearableActivityDay[],
  asOf: string,
): PersonalPatternEvidence {
  const dailySteps = collectDailySteps(activityDays.filter((day) =>
    day.date >= patternAddDays(asOf, -387) && day.date <= patternAddDays(asOf, -2)));
  const { sessionDates, excludedActivityDates } = collectSessionEvidence(events, asOf);
  const qualifiedDates = qualifyObservedDates(dailySteps, sessionDates, asOf);
  return { dailySteps, qualifiedDates, excludedActivityDates };
}

function collectDailySteps(activityDays: readonly WearableActivityDay[]) {
  const dailySteps = new Map<string, Map<string, number>>();
  for (const day of activityDays) {
    const metric = day.steps;
    // Session-derived totals and workout percent-recorded do not prove day coverage.
    if (metric.selection.resolution !== "direct" || metric.selection.value === null
      || metric.selection.value < 0 || metric.confidence.level === "none"
      || metric.selection.sourceKind === "activity_session"
      || metric.selection.sourceFamily === "derived") continue;
    const source = personalPatternMetricSource(metric);
    if (!source) continue;
    const dates = dailySteps.get(source) ?? new Map<string, number>();
    dates.set(day.date, metric.selection.value);
    dailySteps.set(source, dates);
  }
  return dailySteps;
}

function collectSessionEvidence(events: readonly CanonicalEntity[], asOf: string) {
  const sessionDates = new Map<string, Set<string>>();
  const excludedActivityDates = new Set<string>();
  for (const event of events) {
    if (event.kind === "note" && event.attributes.noteType === "journal-context"
      && !event.tags.includes("planned") && !event.tags.includes("did-not-happen")
      && event.tags.some((tag) => ["key-travel", "key-illness", "key-sick"].includes(tag))
      && event.date) excludedActivityDates.add(event.date);
    if (event.kind !== "activity_session" || event.attributes.source !== "device") continue;
    const source = personalPatternSource(event.attributes);
    const date = resolveActivityEvidenceLocalDate(event);
    if (!source || !date || date > patternAddDays(asOf, -2)
      || date < patternAddDays(asOf, -486)) continue;
    const dates = sessionDates.get(source) ?? new Set<string>();
    dates.add(date);
    sessionDates.set(source, dates);
  }
  return { sessionDates, excludedActivityDates };
}

function qualifyObservedDates(dailySteps: Map<string, Map<string, number>>,
  sessionDates: Map<string, Set<string>>, asOf: string) {
  const qualifiedDates = new Map<string, Set<string>>();
  for (const [source, days] of dailySteps) {
    const sessions = [...(sessionDates.get(source) ?? [])].sort();
    const dates = new Set<string>();
    for (const date of days.keys()) {
      if (date > patternAddDays(asOf, -2)) continue;
      // Retrospective inference uses the established recording period, not a
      // claim that session imports were already complete on the historical date.
      const priorSessions = sessions.filter((session) => session >= patternAddDays(date, -120)
        && session <= patternAddDays(date, 120));
      if (priorSessions.length < 4
        || patternDayGap(priorSessions[0], priorSessions.at(-1)!) < 14) continue;
      const covered = Array.from({ length: 21 }, (_, i) => patternAddDays(date, -i))
        .filter((day) => days.has(day)).length;
      if (covered >= 17) dates.add(date);
    }
    qualifiedDates.set(source, dates);
  }
  return qualifiedDates;
}

export function personalPatternPriorLoad(
  evidence: PersonalPatternEvidence, source: string | null, date: string,
): number | null {
  if (!source) return null;
  const days = evidence.dailySteps.get(source);
  const values = Array.from({ length: 7 }, (_, i) => days?.get(patternAddDays(date, -i - 1)))
    .filter((value): value is number => value !== undefined);
  return values.length >= 5 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
