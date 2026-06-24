export type SampleSummaryProfile = "oxygen-night";

export interface SampleSeriesInputRecord {
  recordedAt: string;
  value?: number;
}

export interface SampleSeriesSummaryInput {
  stream: string;
  unit?: string | null;
  samples: readonly SampleSeriesInputRecord[];
  from?: string;
  to?: string;
  thresholdsBelow?: readonly number[];
  gapSeconds?: number;
  profile?: SampleSummaryProfile;
}

export interface SampleWindowGap {
  from: string;
  to: string;
  durationSeconds: number;
}

export interface SampleThresholdSummary {
  below: number;
  sampleCount: number;
  durationSeconds: number;
  runCount: number;
  clusterCount: number;
  longestRunSeconds: number;
}

export interface SampleWindowScreen {
  profile: SampleSummaryProfile;
  level: "normal_oxygen_trace" | "borderline_oxygen_trace" | "concerning_oxygen_trace";
  reasons: string[];
  caveat: string;
}

export interface SampleWindowSummary {
  stream: string;
  unit: string | null;
  from: string | null;
  to: string | null;
  sampleCount: number;
  numericSampleCount: number;
  firstSampleAt: string | null;
  lastSampleAt: string | null;
  durationSeconds: number | null;
  sampleIntervalSeconds: number | null;
  minValue: number | null;
  maxValue: number | null;
  averageValue: number | null;
  thresholds: SampleThresholdSummary[];
  gaps: SampleWindowGap[];
  warnings: string[];
  screen?: SampleWindowScreen;
}

interface NormalizedSample {
  recordedAt: string;
  epochMs: number;
  value: number | null;
}

const OXYGEN_NIGHT_THRESHOLDS = Object.freeze([92, 90, 88] as const);

export function summarizeSampleSeries(input: SampleSeriesSummaryInput): SampleWindowSummary {
  const normalized = normalizeSamples(input.samples, input.from, input.to);
  const numeric = normalized.filter((sample) => sample.value !== null);
  const thresholds = normalizeThresholds(input);
  const intervals = collectIntervals(normalized);
  const sampleIntervalSeconds = estimateSampleIntervalSeconds(intervals);
  const gapThresholdSeconds = normalizeGapThresholdSeconds(input.gapSeconds, sampleIntervalSeconds);
  const gaps = summarizeGaps(normalized, gapThresholdSeconds);
  const thresholdSummaries = thresholds.map((threshold) =>
    summarizeThreshold(threshold, numeric, sampleIntervalSeconds, gapThresholdSeconds)
  );
  const durationSeconds = normalized.length > 1
    ? secondsBetween(normalized[0]?.epochMs ?? 0, normalized[normalized.length - 1]?.epochMs ?? 0)
    : null;
  const values = numeric.map((sample) => sample.value).filter((value): value is number => value !== null);
  const sumValue = values.reduce((sum, value) => sum + value, 0);
  const summary: SampleWindowSummary = {
    stream: input.stream,
    unit: normalizeUnit(input.unit),
    from: input.from ?? normalized[0]?.recordedAt ?? null,
    to: input.to ?? normalized[normalized.length - 1]?.recordedAt ?? null,
    sampleCount: normalized.length,
    numericSampleCount: numeric.length,
    firstSampleAt: normalized[0]?.recordedAt ?? null,
    lastSampleAt: normalized[normalized.length - 1]?.recordedAt ?? null,
    durationSeconds,
    sampleIntervalSeconds,
    minValue: values.length > 0 ? Math.min(...values) : null,
    maxValue: values.length > 0 ? Math.max(...values) : null,
    averageValue: values.length > 0 ? round4(sumValue / values.length) : null,
    thresholds: thresholdSummaries,
    gaps,
    warnings: buildWarnings(input, normalized, numeric),
  };

  if (input.profile === "oxygen-night" && input.stream === "spo2") {
    summary.screen = summarizeOxygenNightScreen(thresholdSummaries);
  }

  return summary;
}

function normalizeSamples(
  samples: readonly SampleSeriesInputRecord[],
  from: string | undefined,
  to: string | undefined,
): NormalizedSample[] {
  const fromMs = from ? Date.parse(from) : null;
  const toMs = to ? Date.parse(to) : null;

  return samples
    .map((sample) => {
      const epochMs = Date.parse(sample.recordedAt);
      if (!Number.isFinite(epochMs)) {
        return null;
      }

      if (fromMs !== null && epochMs < fromMs) {
        return null;
      }

      if (toMs !== null && epochMs > toMs) {
        return null;
      }

      const value = typeof sample.value === "number" && Number.isFinite(sample.value)
        ? sample.value
        : null;

      return {
        recordedAt: new Date(epochMs).toISOString(),
        epochMs,
        value,
      };
    })
    .filter((sample): sample is NormalizedSample => sample !== null)
    .sort((left, right) => left.epochMs - right.epochMs);
}

function normalizeThresholds(input: SampleSeriesSummaryInput): number[] {
  const thresholds = input.thresholdsBelow?.length
    ? input.thresholdsBelow
    : input.profile === "oxygen-night"
      ? OXYGEN_NIGHT_THRESHOLDS
      : [];

  return [...new Set(thresholds)]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left);
}

function normalizeUnit(unit: string | null | undefined): string | null {
  const normalized = unit?.trim();
  return normalized ? normalized : null;
}

function collectIntervals(samples: readonly NormalizedSample[]): number[] {
  const intervals: number[] = [];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current) {
      continue;
    }

    const intervalSeconds = secondsBetween(previous.epochMs, current.epochMs);
    if (intervalSeconds > 0 && Number.isFinite(intervalSeconds)) {
      intervals.push(intervalSeconds);
    }
  }

  return intervals;
}

function estimateSampleIntervalSeconds(intervals: readonly number[]): number | null {
  if (intervals.length === 0) {
    return null;
  }

  const sorted = [...intervals].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2
    : sorted[midpoint] ?? 0;

  return median > 0 ? round4(median) : null;
}

function normalizeGapThresholdSeconds(
  requested: number | undefined,
  sampleIntervalSeconds: number | null,
): number | null {
  if (requested !== undefined) {
    return requested > 0 && Number.isFinite(requested) ? requested : null;
  }

  if (sampleIntervalSeconds === null) {
    return null;
  }

  return sampleIntervalSeconds * 2.5;
}

function summarizeGaps(
  samples: readonly NormalizedSample[],
  gapThresholdSeconds: number | null,
): SampleWindowGap[] {
  if (gapThresholdSeconds === null) {
    return [];
  }

  const gaps: SampleWindowGap[] = [];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current) {
      continue;
    }

    const durationSeconds = secondsBetween(previous.epochMs, current.epochMs);
    if (durationSeconds > gapThresholdSeconds) {
      gaps.push({
        from: previous.recordedAt,
        to: current.recordedAt,
        durationSeconds: round4(durationSeconds),
      });
    }
  }

  return gaps;
}

function summarizeThreshold(
  below: number,
  samples: readonly NormalizedSample[],
  sampleIntervalSeconds: number | null,
  gapThresholdSeconds: number | null,
): SampleThresholdSummary {
  let sampleCount = 0;
  let durationSeconds = 0;
  let runCount = 0;
  let longestRunSeconds = 0;
  let currentRunSeconds = 0;
  let previousBelow: NormalizedSample | null = null;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!sample || sample.value === null || sample.value >= below) {
      if (currentRunSeconds > 0) {
        longestRunSeconds = Math.max(longestRunSeconds, currentRunSeconds);
      }
      currentRunSeconds = 0;
      previousBelow = null;
      continue;
    }

    const next = samples[index + 1];
    const contribution = resolveSampleDurationSeconds(sample, next, sampleIntervalSeconds, gapThresholdSeconds);
    const startsNewRun =
      previousBelow === null ||
      (gapThresholdSeconds !== null && secondsBetween(previousBelow.epochMs, sample.epochMs) > gapThresholdSeconds);

    if (startsNewRun) {
      if (currentRunSeconds > 0) {
        longestRunSeconds = Math.max(longestRunSeconds, currentRunSeconds);
      }
      currentRunSeconds = 0;
      runCount += 1;
    }

    sampleCount += 1;
    durationSeconds += contribution;
    currentRunSeconds += contribution;
    previousBelow = sample;
  }

  if (currentRunSeconds > 0) {
    longestRunSeconds = Math.max(longestRunSeconds, currentRunSeconds);
  }

  return {
    below,
    sampleCount,
    durationSeconds: round4(durationSeconds),
    runCount,
    clusterCount: runCount,
    longestRunSeconds: round4(longestRunSeconds),
  };
}

function resolveSampleDurationSeconds(
  sample: NormalizedSample,
  next: NormalizedSample | undefined,
  sampleIntervalSeconds: number | null,
  gapThresholdSeconds: number | null,
): number {
  if (next) {
    const nextDelta = secondsBetween(sample.epochMs, next.epochMs);
    if (
      nextDelta > 0 &&
      (gapThresholdSeconds === null || nextDelta <= gapThresholdSeconds)
    ) {
      return nextDelta;
    }
  }

  return sampleIntervalSeconds ?? 1;
}

function summarizeOxygenNightScreen(
  thresholds: readonly SampleThresholdSummary[],
): SampleWindowScreen {
  const below90 = thresholds.find((entry) => entry.below === 90);
  const below88 = thresholds.find((entry) => entry.below === 88);
  const below90Seconds = below90?.durationSeconds ?? 0;
  const below88Seconds = below88?.durationSeconds ?? 0;
  const longestBelow90 = below90?.longestRunSeconds ?? 0;
  const reasons: string[] = [];
  let level: SampleWindowScreen["level"] = "normal_oxygen_trace";

  if (below90Seconds > 300 || longestBelow90 > 120 || below88Seconds > 60) {
    level = "concerning_oxygen_trace";
    reasons.push("Low-oxygen time or sustained low-oxygen runs were detected.");
  } else if (below90Seconds > 60 || longestBelow90 > 30 || below88Seconds > 0) {
    level = "borderline_oxygen_trace";
    reasons.push("Low-oxygen time was present but not strongly sustained.");
  } else {
    reasons.push("Time below 90% was brief.");
    reasons.push("No sustained low-oxygen clusters were detected.");
  }

  return {
    profile: "oxygen-night",
    level,
    reasons,
    caveat: "This summarizes oxygen samples only and does not diagnose or rule out sleep apnea.",
  };
}

function buildWarnings(
  input: SampleSeriesSummaryInput,
  samples: readonly NormalizedSample[],
  numeric: readonly NormalizedSample[],
): string[] {
  const warnings: string[] = [];

  if (samples.length === 0) {
    warnings.push("No samples matched the requested stream and time window.");
  } else if (numeric.length === 0) {
    warnings.push("No numeric sample values matched the requested stream and time window.");
  }

  if (input.profile === "oxygen-night" && input.stream !== "spo2") {
    warnings.push("The oxygen-night profile is intended for the spo2 stream.");
  }

  return warnings;
}

function secondsBetween(leftEpochMs: number, rightEpochMs: number): number {
  return (rightEpochMs - leftEpochMs) / 1000;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}
