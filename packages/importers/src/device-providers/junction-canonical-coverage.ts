import { addDaysToIsoDate, toLocalDayKey } from "@murphai/contracts";

import { normalizeJunctionSourceProviderSlug } from "./junction-origin.ts";
import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  isJunctionDailyCanonicalCoverageResource,
  maxJunctionCanonicalCoverageBoundary,
  normalizeJunctionCanonicalCoverageBoundary,
} from "./junction-resources.ts";
import {
  asPlainObject,
  laterOptionalIsoTimestamp,
  normalizeProviderTimestamp as normalizeTimestamp,
  slugify,
} from "./shared-normalization.ts";

export interface JunctionCanonicalCoverageFence {
  readonly coverageBoundaryByResource: Readonly<Record<string, string | null>>;
  readonly sourceProviderSlug: string;
}

export interface JunctionCanonicalCoverageEvidence {
  readonly coverageBoundary: string;
  readonly coverageFinalizedAt?: string;
  readonly resource: string;
  readonly sourceProviderSlug: string;
}

export interface JunctionCanonicalCoverageDerivationOptions {
  readonly providerPulledAt?: string;
}

export interface JunctionCanonicalCoverageEvent {
  readonly dataOrigin?: {
    readonly sourceProviderSlug?: string;
    readonly timeZoneOffsetMinutes?: number | null;
  };
  readonly dayKey?: string;
  readonly endAt?: string;
  readonly externalRef?: { readonly resourceType: string };
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly kind: string;
  readonly occurredAt: string;
  readonly sample?: { readonly endAt?: string };
  readonly timeZone?: string;
  readonly workout?: { readonly endedAt?: string };
}

const JUNCTION_CANONICAL_COVERAGE_RESOURCES: readonly string[] = [
  ...JUNCTION_ALLOWED_SUMMARY_RESOURCES.filter((resource) => resource !== "profile"),
  ...JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
];

export function deriveJunctionCanonicalCoverageEvidence(
  events: readonly JunctionCanonicalCoverageEvent[],
  options?: JunctionCanonicalCoverageDerivationOptions,
): readonly JunctionCanonicalCoverageEvidence[] {
  const coverageBySourceAndResource = new Map<string, {
    evidence: JunctionCanonicalCoverageEvidence;
    providerDayClosedAt?: string;
  }>();
  for (const event of events) {
    const evidence = resolveJunctionCanonicalCoverageEvidence(event);
    if (!evidence) {
      continue;
    }
    const providerDayClosedAt = isJunctionDailyCanonicalCoverageResource(evidence.resource)
      ? resolveJunctionProviderDayClosedAt(evidence.coverageBoundary, event)
      : undefined;

    const key = `${evidence.sourceProviderSlug}\u0000${evidence.resource}`;
    const existing = coverageBySourceAndResource.get(key);
    if (
      !existing
      || maxJunctionCanonicalCoverageBoundary(
          evidence.resource,
          existing.evidence.coverageBoundary,
          evidence.coverageBoundary,
        ) === evidence.coverageBoundary
    ) {
      coverageBySourceAndResource.set(
        key,
        existing?.evidence.coverageBoundary === evidence.coverageBoundary
          ? {
              evidence,
              providerDayClosedAt: laterOptionalIsoTimestamp(
                existing.providerDayClosedAt,
                providerDayClosedAt,
              ),
            }
          : { evidence, providerDayClosedAt },
      );
    }
  }

  const providerPulledAt = normalizeJunctionCoverageProviderPulledAt(
    options?.providerPulledAt,
  );
  return [...coverageBySourceAndResource.values()]
    .map(({ evidence, providerDayClosedAt }) =>
      providerPulledAt
        && providerDayClosedAt
        && providerPulledAt >= providerDayClosedAt
        ? { ...evidence, coverageFinalizedAt: providerPulledAt }
        : evidence
    )
    .sort((left, right) =>
      left.sourceProviderSlug.localeCompare(right.sourceProviderSlug)
      || left.resource.localeCompare(right.resource)
    );
}

const JUNCTION_PROVIDER_DAY_LATEST_UNPROVEN_CLOSE_OFFSET_MINUTES = -12 * 60;

function resolveJunctionProviderDayClosedAt(
  dayKey: string,
  event: JunctionCanonicalCoverageEvent,
): string {
  const timeZone = event.timeZone?.trim();
  if (timeZone) {
    const timeZoneClose = resolveJunctionProviderDayClosedAtInTimeZone(
      dayKey,
      timeZone,
    );
    if (timeZoneClose) {
      return timeZoneClose;
    }
  }

  const offsetMinutes = event.dataOrigin?.timeZoneOffsetMinutes;
  if (
    Number.isInteger(offsetMinutes)
    && offsetMinutes !== null
    && offsetMinutes !== undefined
    && Math.abs(offsetMinutes) <= 24 * 60
  ) {
    return resolveJunctionProviderDayClosedAtOffset(dayKey, offsetMinutes);
  }

  // Junction's closed-calendar importer waits until a date has closed at
  // UTC-12. Date-only accepted records therefore converge safely without
  // borrowing the member's mutable vault timezone.
  return resolveJunctionProviderDayClosedAtOffset(
    dayKey,
    JUNCTION_PROVIDER_DAY_LATEST_UNPROVEN_CLOSE_OFFSET_MINUTES,
  );
}

function resolveJunctionProviderDayClosedAtInTimeZone(
  dayKey: string,
  timeZone: string,
): string | undefined {
  try {
    const nextDayKey = addDaysToIsoDate(dayKey, 1);
    const nominalNextDayMs = Date.parse(`${nextDayKey}T00:00:00.000Z`);
    let lowerBoundMs = nominalNextDayMs - 36 * 60 * 60_000;
    let upperBoundMs = nominalNextDayMs + 36 * 60 * 60_000;
    if (
      toLocalDayKey(lowerBoundMs, timeZone) > dayKey
      || toLocalDayKey(upperBoundMs, timeZone) <= dayKey
    ) {
      return undefined;
    }

    while (upperBoundMs - lowerBoundMs > 1) {
      const midpointMs = Math.floor((lowerBoundMs + upperBoundMs) / 2);
      if (toLocalDayKey(midpointMs, timeZone) > dayKey) {
        upperBoundMs = midpointMs;
      } else {
        lowerBoundMs = midpointMs;
      }
    }
    return new Date(upperBoundMs).toISOString();
  } catch {
    return undefined;
  }
}

function resolveJunctionProviderDayClosedAtOffset(
  dayKey: string,
  offsetMinutes: number,
): string {
  const nextDayKey = addDaysToIsoDate(dayKey, 1);
  const nominalNextDayMs = Date.parse(`${nextDayKey}T00:00:00.000Z`);
  return new Date(nominalNextDayMs - offsetMinutes * 60_000).toISOString();
}

function normalizeJunctionCoverageProviderPulledAt(
  providerPulledAt: string | undefined,
): string | undefined {
  if (!providerPulledAt) {
    return undefined;
  }
  const providerPulledAtMs = Date.parse(providerPulledAt);
  if (!Number.isFinite(providerPulledAtMs)) {
    return undefined;
  }
  const normalizedProviderPulledAt = new Date(providerPulledAtMs).toISOString();
  return normalizedProviderPulledAt === providerPulledAt
    ? normalizedProviderPulledAt
    : undefined;
}

export function applyJunctionCanonicalCoverageFence<Event extends JunctionCanonicalCoverageEvent>(
  events: Event[],
  fence: JunctionCanonicalCoverageFence | undefined,
): void {
  const sourceProviderSlug = normalizeJunctionSourceProviderSlug(
    fence?.sourceProviderSlug,
  );
  if (!fence || !sourceProviderSlug) {
    return;
  }

  const admittedEvents = events.filter((event) => {
    if (
      normalizeJunctionSourceProviderSlug(event.dataOrigin?.sourceProviderSlug)
        !== sourceProviderSlug
    ) {
      return true;
    }
    const evidence = resolveJunctionCanonicalCoverageEvidence(event);
    if (!evidence) {
      return event.externalRef?.resourceType
        === `junction-${slugify(sourceProviderSlug, "source")}-profile`;
    }
    if (!(evidence.resource in fence.coverageBoundaryByResource)) {
      return true;
    }
    const legacyCoverageBoundary = normalizeJunctionCanonicalCoverageBoundary(
      evidence.resource,
      fence.coverageBoundaryByResource[evidence.resource],
    );
    return legacyCoverageBoundary !== null
      && evidence.coverageBoundary > legacyCoverageBoundary;
  });
  events.splice(0, events.length, ...admittedEvents);
}

function resolveJunctionCanonicalCoverageEvidence(
  event: JunctionCanonicalCoverageEvent,
): JunctionCanonicalCoverageEvidence | null {
  const sourceProviderSlug = normalizeJunctionSourceProviderSlug(
    event.dataOrigin?.sourceProviderSlug,
  );
  const externalRefResourceType = event.externalRef?.resourceType;
  if (!sourceProviderSlug || !externalRefResourceType) {
    return null;
  }

  const resource = JUNCTION_CANONICAL_COVERAGE_RESOURCES.find((candidate) =>
    externalRefResourceType
      === `junction-${slugify(sourceProviderSlug, "source")}-${slugify(candidate, "resource")}`
  );
  if (!resource) {
    return null;
  }

  const coverageBoundary = normalizeJunctionCanonicalCoverageBoundary(
    resource,
    isJunctionDailyCanonicalCoverageResource(resource)
    ? event.dayKey
    : resolveCanonicalEventIntervalEnd(event),
  );
  return coverageBoundary
    ? { coverageBoundary, resource, sourceProviderSlug }
    : null;
}

function resolveCanonicalEventIntervalEnd(
  event: JunctionCanonicalCoverageEvent,
): string | null {
  if (event.kind === "sleep_session") {
    return normalizeTimestamp(event.endAt ?? event.fields?.endAt) ?? null;
  }
  if (event.kind === "activity_session") {
    const fieldsWorkout = asPlainObject(event.fields?.workout);
    return normalizeTimestamp(event.workout?.endedAt ?? fieldsWorkout?.endedAt)
      ?? normalizeTimestamp(event.occurredAt)
      ?? null;
  }
  if (event.sample?.endAt) {
    return normalizeTimestamp(event.sample.endAt) ?? null;
  }
  return normalizeTimestamp(event.occurredAt) ?? null;
}
