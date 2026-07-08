// Habitat coverage: a pure derivation over (catalog, member habitat records).
// Nothing here is ever stored — consumers recompute on read so coverage can
// never drift from the underlying records.

import {
  HABITAT_CATALOG,
  isHabitatDeclinedValue,
  type HabitatAspectDefinition,
  type HabitatCatalog,
  type HabitatDomainId,
  type HabitatIndicatorPriority,
  type HabitatIndicatorValue,
} from "./habitat-catalog.ts";

export type HabitatIndicatorCoverageStatus =
  | "known"
  | "stale"
  | "declined"
  | "unknown";

export interface HabitatRecordInput {
  aspect: string;
  indicators: Readonly<Record<string, HabitatIndicatorValue>>;
  indicatorRecordedAt?: Readonly<Record<string, string>>;
}

export interface HabitatIndicatorCoverage {
  indicatorId: string;
  label: string;
  priority: HabitatIndicatorPriority;
  informational: boolean;
  status: HabitatIndicatorCoverageStatus;
  value: HabitatIndicatorValue;
  recordedAt: string | null;
}

export interface HabitatCoverageCounts {
  known: number;
  stale: number;
  declined: number;
  unknown: number;
  total: number;
}

export interface HabitatAspectCoverage {
  aspectId: string;
  title: string;
  domain: HabitatDomainId;
  indicators: HabitatIndicatorCoverage[];
  counts: HabitatCoverageCounts;
  /** High-priority indicators still unknown — the best next questions. */
  topGaps: HabitatIndicatorCoverage[];
}

export interface HabitatDomainCoverage {
  domain: HabitatDomainId;
  aspects: HabitatAspectCoverage[];
  counts: HabitatCoverageCounts;
}

export interface HabitatCoverage {
  catalogVersion: string;
  domains: HabitatDomainCoverage[];
  counts: HabitatCoverageCounts;
}

export interface ComputeHabitatCoverageOptions {
  catalog?: HabitatCatalog;
  /** ISO date used for staleness checks; staleness is skipped when absent. */
  now?: string;
  /** Days after which a dated high-priority indicator counts as stale. */
  staleAfterDays?: number;
}

const DEFAULT_STALE_AFTER_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1_000;

function emptyCounts(): HabitatCoverageCounts {
  return { known: 0, stale: 0, declined: 0, unknown: 0, total: 0 };
}

function addCounts(target: HabitatCoverageCounts, source: HabitatCoverageCounts): void {
  target.known += source.known;
  target.stale += source.stale;
  target.declined += source.declined;
  target.unknown += source.unknown;
  target.total += source.total;
}

function isStale(
  recordedAt: string | null,
  priority: HabitatIndicatorPriority,
  options: ComputeHabitatCoverageOptions,
): boolean {
  if (!options.now || !recordedAt || priority !== "high") {
    return false;
  }

  const recorded = Date.parse(recordedAt);
  const now = Date.parse(options.now);

  if (Number.isNaN(recorded) || Number.isNaN(now)) {
    return false;
  }

  const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;

  return now - recorded > staleAfterDays * DAY_MS;
}

function computeAspectCoverage(
  aspect: HabitatAspectDefinition,
  record: HabitatRecordInput | undefined,
  options: ComputeHabitatCoverageOptions,
): HabitatAspectCoverage {
  const counts = emptyCounts();
  const indicators = aspect.indicators.map((definition): HabitatIndicatorCoverage => {
    const value = record?.indicators[definition.id] ?? null;
    const recordedAt = record?.indicatorRecordedAt?.[definition.id] ?? null;

    let status: HabitatIndicatorCoverageStatus;
    if (value === null) {
      status = "unknown";
    } else if (isHabitatDeclinedValue(value)) {
      status = "declined";
    } else if (isStale(recordedAt, definition.priority, options)) {
      status = "stale";
    } else {
      status = "known";
    }

    counts[status] += 1;
    counts.total += 1;

    return {
      indicatorId: definition.id,
      label: definition.label,
      priority: definition.priority,
      informational: definition.informational ?? false,
      status,
      value: status === "unknown" ? null : value,
      recordedAt,
    };
  });

  return {
    aspectId: aspect.id,
    title: aspect.title,
    domain: aspect.domain,
    indicators,
    counts,
    topGaps: indicators.filter(
      (indicator) => indicator.status === "unknown" && indicator.priority === "high",
    ),
  };
}

export function computeHabitatCoverage(
  records: readonly HabitatRecordInput[],
  options: ComputeHabitatCoverageOptions = {},
): HabitatCoverage {
  const catalog = options.catalog ?? HABITAT_CATALOG;
  const recordByAspect = new Map(records.map((record) => [record.aspect, record]));
  const domainCoverageByDomain = new Map<HabitatDomainId, HabitatDomainCoverage>();
  const totals = emptyCounts();

  for (const aspect of catalog.aspects) {
    const aspectCoverage = computeAspectCoverage(
      aspect,
      recordByAspect.get(aspect.id),
      options,
    );

    let domainCoverage = domainCoverageByDomain.get(aspect.domain);
    if (!domainCoverage) {
      domainCoverage = { domain: aspect.domain, aspects: [], counts: emptyCounts() };
      domainCoverageByDomain.set(aspect.domain, domainCoverage);
    }

    domainCoverage.aspects.push(aspectCoverage);
    addCounts(domainCoverage.counts, aspectCoverage.counts);
    addCounts(totals, aspectCoverage.counts);
  }

  return {
    catalogVersion: catalog.version,
    domains: [...domainCoverageByDomain.values()],
    counts: totals,
  };
}
