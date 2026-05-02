import type { CanonicalEntity } from "./canonical-entities.ts";
import type { VaultReadModel } from "./read-model.ts";
import {
  summarizeSampleSeries,
  type SampleSummaryProfile,
  type SampleWindowSummary,
} from "@murphai/importers/sample-series-summary";
import { isDisplayGradeMetricSampleEntity } from "./metrics/index.ts";

export interface DailySampleSummary {
  date: string;
  stream: string;
  sampleCount: number;
  numericSampleCount: number;
  units: string[];
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  averageValue: number | null;
  sumValue: number | null;
  firstSampleAt: string | null;
  lastSampleAt: string | null;
  sourcePaths: string[];
}

export interface SampleSummaryFilter {
  from?: string;
  to?: string;
  streams?: string[];
  experimentSlug?: string;
}

export interface SampleWindowSummaryFilter {
  stream: string;
  from?: string;
  to?: string;
  thresholdsBelow?: number[];
  gapSeconds?: number;
  profile?: SampleSummaryProfile;
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
    if (!isSummarizableSample(sample)) {
      continue;
    }

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
    const unit = getString(sample.attributes.unit);
    const key = buildSummaryKey(date, stream, unit);
    const group = getOrCreateSummaryGroup(groups, key, date, stream, unit);

    const { summary, values, unitSet } = group;
    summary.sampleCount += 1;

    if (!summary.sourcePaths.includes(sample.path)) {
      summary.sourcePaths.push(sample.path);
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
      summary.numericSampleCount += 1;
      values.push(numericValue);
    }
  }

  return [...groups.values()]
    .map(({ summary, values, unitSet }) => finalizeSummary(summary, values, unitSet))
    .sort(compareDailySampleSummaries);
}

export function summarizeSampleWindow(
  vault: VaultReadModel,
  filters: SampleWindowSummaryFilter,
): SampleWindowSummary {
  const samples = vault.samples
    .filter(isSummarizableSample)
    .filter((sample) => sample.stream === filters.stream)
    .map((sample) => ({
      recordedAt: sample.occurredAt ?? "",
      value: getNumericValue(sample) ?? undefined,
      unit: getString(sample.attributes.unit),
    }))
    .filter((sample) => sample.recordedAt.length > 0);
  const units = [...new Set(samples.map((sample) => sample.unit).filter((unit): unit is string => unit !== null))].sort();

  return summarizeSampleSeries({
    stream: filters.stream,
    unit: units.length === 1 ? units[0] : null,
    samples,
    from: filters.from,
    to: filters.to,
    thresholdsBelow: filters.thresholdsBelow,
    gapSeconds: filters.gapSeconds,
    profile: filters.profile,
  });
}

function isSummarizableSample(sample: CanonicalEntity): boolean {
  if (sample.kind !== "metric_sample") return true;
  return isDisplayGradeMetricSampleEntity(sample);
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
      numericSampleCount: 0,
      units: [],
      unit: null,
      minValue: null,
      maxValue: null,
      averageValue: null,
      sumValue: null,
      firstSampleAt: null,
      lastSampleAt: null,
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

function getNumericValue(sample: CanonicalEntity): number | null {
  const rawValue = sample.attributes.value;
  return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildSummaryKey(date: string, stream: string, unit: string | null): string {
  return `${date}:${stream}:${unit ?? ""}`;
}
