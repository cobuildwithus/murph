import type { CanonicalEntity } from "./canonical-entities.ts";
import type { VaultReadModel } from "./read-model.ts";
import {
  summarizeSampleSeries,
  type SampleSummaryProfile,
  type SampleWindowSummary,
} from "@murphai/health-metrics";
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

interface DailySampleSummaryGroup {
  summary: DailySampleSummary;
  sourcePathSet: Set<string>;
  unitSet: Set<string>;
}

export function summarizeDailySamples(
  vault: VaultReadModel,
  filters: SampleSummaryFilter = {},
): DailySampleSummary[] {
  const { from, to, streams, experimentSlug } = filters;
  const streamSet = streams ? new Set(streams) : null;

  const groups = new Map<string, DailySampleSummaryGroup>();

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

    const { summary, sourcePathSet, unitSet } = group;
    summary.sampleCount += 1;

    if (!sourcePathSet.has(sample.path)) {
      sourcePathSet.add(sample.path);
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
      summary.sumValue = (summary.sumValue ?? 0) + numericValue;
      summary.minValue = summary.minValue === null
        ? numericValue
        : Math.min(summary.minValue, numericValue);
      summary.maxValue = summary.maxValue === null
        ? numericValue
        : Math.max(summary.maxValue, numericValue);
    }
  }

  return [...groups.values()]
    .map(({ summary, unitSet }) => finalizeSummary(summary, unitSet))
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
  const windowSamples = samples.filter((sample) =>
    sampleRecordedAtIsInWindow(sample.recordedAt, filters.from, filters.to)
  );
  const units = [...new Set(windowSamples.map((sample) => sample.unit).filter((unit): unit is string => unit !== null))].sort();

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

function sampleRecordedAtIsInWindow(
  recordedAt: string,
  from: string | undefined,
  to: string | undefined,
): boolean {
  const epochMs = Date.parse(recordedAt);
  if (!Number.isFinite(epochMs)) {
    return false;
  }

  const fromMs = from ? Date.parse(from) : null;
  if (fromMs !== null && epochMs < fromMs) {
    return false;
  }

  const toMs = to ? Date.parse(to) : null;
  if (toMs !== null && epochMs > toMs) {
    return false;
  }

  return true;
}

function isSummarizableSample(sample: CanonicalEntity): boolean {
  if (sample.kind !== "metric_sample") return true;
  return isDisplayGradeMetricSampleEntity(sample);
}

function getOrCreateSummaryGroup(
  groups: Map<string, DailySampleSummaryGroup>,
  key: string,
  date: string,
  stream: string,
  unit: string | null,
): DailySampleSummaryGroup {
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
    sourcePathSet: new Set<string>(),
    unitSet: new Set<string>(unit ? [unit] : []),
  };

  groups.set(key, created);
  return created;
}

function finalizeSummary(
  summary: DailySampleSummary,
  unitSet: Set<string>,
): DailySampleSummary {
  const sortedUnits = [...unitSet].sort();
  summary.units = sortedUnits;
  summary.unit = sortedUnits.length === 1 ? sortedUnits[0] : null;

  if (summary.numericSampleCount > 0 && summary.sumValue !== null) {
    summary.averageValue = Number((summary.sumValue / summary.numericSampleCount).toFixed(4));
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
