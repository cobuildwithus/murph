import type { VaultReadModel, VaultRecord } from "./model.ts";

export interface DailySampleSummary {
  date: string;
  stream: string;
  sampleCount: number;
  units: string[];
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  averageValue: number | null;
  sumValue: number | null;
  firstSampleAt: string | null;
  lastSampleAt: string | null;
  sampleIds: string[];
  sourcePaths: string[];
}

export interface SampleSummaryFilter {
  from?: string;
  to?: string;
  streams?: string[];
  experimentSlug?: string;
}

export function summarizeDailySamples(
  vault: VaultReadModel,
  filters: SampleSummaryFilter = {},
): DailySampleSummary[] {
  const { from, to, streams, experimentSlug } = filters;
  const streamSet = streams ? new Set(streams) : null;

  const groups = new Map<
    string,
    { summary: DailySampleSummary; values: number[]; unitSet: Set<string> }
  >();

  for (const sample of vault.samples) {
    const date = sample.date;
    const stream = sample.stream;

    if (!date || !stream) {
      continue;
    }

    if (from && date < from) {
      continue;
    }

    if (to && date > to) {
      continue;
    }

    if (streamSet && !streamSet.has(stream)) {
      continue;
    }

    if (experimentSlug && sample.experimentSlug !== experimentSlug) {
      continue;
    }

    const numericValue = getNumericValue(sample);
    const unit = getString(sample.data.unit);
    const key = buildSummaryKey(date, stream, unit);
    const group = getOrCreateSummaryGroup(groups, key, date, stream, unit);

    const { summary, values, unitSet } = group;
    summary.sampleCount += 1;
    summary.sampleIds.push(sample.displayId);

    if (!summary.sourcePaths.includes(sample.sourcePath)) {
      summary.sourcePaths.push(sample.sourcePath);
    }

    if (sample.occurredAt) {
      if (!summary.firstSampleAt || sample.occurredAt < summary.firstSampleAt) {
        summary.firstSampleAt = sample.occurredAt;
      }

      if (!summary.lastSampleAt || sample.occurredAt > summary.lastSampleAt) {
        summary.lastSampleAt = sample.occurredAt;
      }
    }

    if (unit) {
      unitSet.add(unit);
    }

    if (numericValue !== null) {
      values.push(numericValue);
    }
  }

  return [...groups.values()]
    .map(({ summary, values, unitSet }) => finalizeSummary(summary, values, unitSet))
    .sort(compareDailySampleSummaries);
}

function getOrCreateSummaryGroup(
  groups: Map<
    string,
    { summary: DailySampleSummary; values: number[]; unitSet: Set<string> }
  >,
  key: string,
  date: string,
  stream: string,
  unit: string | null,
): { summary: DailySampleSummary; values: number[]; unitSet: Set<string> } {
  const existing = groups.get(key);
  if (existing) {
    return existing;
  }

  const created = {
    summary: {
      date,
      stream,
      sampleCount: 0,
      units: [],
      unit: null,
      minValue: null,
      maxValue: null,
      averageValue: null,
      sumValue: null,
      firstSampleAt: null,
      lastSampleAt: null,
      sampleIds: [],
      sourcePaths: [],
    },
    values: [],
    unitSet: new Set<string>(unit ? [unit] : []),
  };

  groups.set(key, created);
  return created;
}

function finalizeSummary(
  summary: DailySampleSummary,
  values: number[],
  unitSet: Set<string>,
): DailySampleSummary {
  const sortedUnits = [...unitSet].sort();
  summary.units = sortedUnits;
  summary.unit = sortedUnits.length === 1 ? sortedUnits[0] : null;

  if (values.length > 0) {
    summary.minValue = Math.min(...values);
    summary.maxValue = Math.max(...values);
    summary.sumValue = values.reduce((sum, value) => sum + value, 0);
    summary.averageValue = Number((summary.sumValue / values.length).toFixed(4));
  }

  summary.sampleIds.sort();
  summary.sourcePaths.sort();

  return summary;
}

function compareDailySampleSummaries(
  left: DailySampleSummary,
  right: DailySampleSummary,
): number {
  if (left.date === right.date) {
    if (left.stream === right.stream) {
      return (left.unit ?? "").localeCompare(right.unit ?? "");
    }

    return left.stream.localeCompare(right.stream);
  }

  return left.date.localeCompare(right.date);
}

function getNumericValue(sample: VaultRecord): number | null {
  const rawValue = sample.data.value;
  return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildSummaryKey(date: string, stream: string, unit: string | null): string {
  return `${date}:${stream}:${unit ?? ""}`;
}
