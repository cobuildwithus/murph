import { summarizeSampleSeries } from "@murphai/health-metrics";

export const JUNCTION_TEMPORAL_FEATURE_MAX_SAMPLES_PER_DAY = 5_000;
export const JUNCTION_TEMPORAL_FEATURE_MAX_SAMPLES_PER_IMPORT = 25_000;
export const JUNCTION_TEMPORAL_FEATURE_MAX_OBSERVATIONS_PER_DAY = 10;
export const JUNCTION_TEMPORAL_FEATURE_ENVELOPE_MAX_BYTES = 1_024;

export const JUNCTION_TEMPORAL_FEATURE_RESOURCES = Object.freeze([
  "blood_oxygen",
  "stress_level",
] as const);

export type JunctionTemporalFeatureResource =
  (typeof JUNCTION_TEMPORAL_FEATURE_RESOURCES)[number];

export interface JunctionTemporalFeatureSample {
  localMinuteOfDay?: number;
  recordedAt: string;
  value: number;
}

export interface JunctionTemporalFeatureObservation {
  metric: string;
  title: string;
  unit: string;
  value: number;
}

interface JunctionTemporalFeatureEnvelopeBase {
  method: "ordered-samples-median-gap-2.5x.v1";
  sampleCount: number;
  sampleIntervalSeconds: number | null;
  schema: "junction.timeseries_temporal_features.v1";
}

export interface JunctionBloodOxygenTemporalFeatureEnvelope
  extends JunctionTemporalFeatureEnvelopeBase {
  belowThresholdRunCount: number;
  belowThresholdSampleCount: number;
  belowThresholdSamplePercent: number;
  kind: "blood_oxygen";
  longestBelowThresholdSampleCount: number;
  thresholdPercent: 90;
}

export interface JunctionStressTemporalFeatureEnvelope
  extends JunctionTemporalFeatureEnvelopeBase {
  aboveDailyMeanRunCount: number;
  dailyMean: number;
  eveningMean: number | null;
  eveningMinusMorningMean: number | null;
  eveningWindowLocalMinutes: readonly [1080, 1440];
  kind: "stress_level";
  meanAbsoluteSuccessiveDifference: number;
  morningMean: number | null;
  morningWindowLocalMinutes: readonly [360, 720];
}

export type JunctionTemporalFeatureEnvelope =
  | JunctionBloodOxygenTemporalFeatureEnvelope
  | JunctionStressTemporalFeatureEnvelope;

export type JunctionTemporalFeatureResult =
  | {
      envelope: JunctionTemporalFeatureEnvelope;
      observations: readonly JunctionTemporalFeatureObservation[];
      status: "complete";
    }
  | {
      observations: readonly [];
      status: "insufficient_samples" | "suppressed_input_cap" | "suppressed_output_cap";
    };

// This is the only clinical-looking threshold in this reducer. It reuses the
// repository-owned oxygen-night screening contract in sample-series-summary;
// the output describes sample shape and is not a diagnosis.
const BLOOD_OXYGEN_THRESHOLD_PERCENT = 90;
const MORNING_START_LOCAL_MINUTE = 360;
const MORNING_END_LOCAL_MINUTE = 720;
const EVENING_START_LOCAL_MINUTE = 1_080;
const EVENING_END_LOCAL_MINUTE = 1_440;

export function isJunctionTemporalFeatureResource(
  resource: string,
): resource is JunctionTemporalFeatureResource {
  return (JUNCTION_TEMPORAL_FEATURE_RESOURCES as readonly string[]).includes(resource);
}

export function buildJunctionTemporalFeatures(input: {
  resource: JunctionTemporalFeatureResource;
  samples: readonly JunctionTemporalFeatureSample[];
}): JunctionTemporalFeatureResult {
  if (input.samples.length > JUNCTION_TEMPORAL_FEATURE_MAX_SAMPLES_PER_DAY) {
    return { observations: [], status: "suppressed_input_cap" };
  }
  if (
    input.samples.length < 2
    || new Set(input.samples.map((sample) => sample.recordedAt)).size < 2
  ) {
    return { observations: [], status: "insufficient_samples" };
  }

  const result = buildCompleteTemporalFeatureResult(input.resource, input.samples);
  if (
    result.observations.length > JUNCTION_TEMPORAL_FEATURE_MAX_OBSERVATIONS_PER_DAY
    || serializedByteLength(result.envelope) > JUNCTION_TEMPORAL_FEATURE_ENVELOPE_MAX_BYTES
  ) {
    return { observations: [], status: "suppressed_output_cap" };
  }

  return result;
}

function buildCompleteTemporalFeatureResult(
  resource: JunctionTemporalFeatureResource,
  samples: readonly JunctionTemporalFeatureSample[],
): Extract<JunctionTemporalFeatureResult, { status: "complete" }> {
  switch (resource) {
    case "blood_oxygen":
      return buildBloodOxygenTemporalFeatures(samples);
    case "stress_level":
      return buildStressTemporalFeatures(samples);
  }
}

function buildBloodOxygenTemporalFeatures(
  samples: readonly JunctionTemporalFeatureSample[],
): Extract<JunctionTemporalFeatureResult, { status: "complete" }> {
  const summary = summarizeBelowThresholds(samples, [
    BLOOD_OXYGEN_THRESHOLD_PERCENT,
  ]);
  const threshold = summary.thresholds.find(
    (entry) => entry.below === BLOOD_OXYGEN_THRESHOLD_PERCENT,
  );
  const belowThresholdSampleCount = threshold?.sampleCount ?? 0;
  const belowThresholdSamplePercent = round4(
    belowThresholdSampleCount / samples.length * 100,
  );
  const belowThresholdRunCount = threshold?.runCount ?? 0;
  const longestBelowThresholdSampleCount = longestThresholdRunSampleCount(
    samples,
    BLOOD_OXYGEN_THRESHOLD_PERCENT,
    summary.sampleIntervalSeconds,
  );
  const envelope: JunctionBloodOxygenTemporalFeatureEnvelope = {
    schema: "junction.timeseries_temporal_features.v1",
    method: "ordered-samples-median-gap-2.5x.v1",
    kind: "blood_oxygen",
    sampleCount: samples.length,
    sampleIntervalSeconds: summary.sampleIntervalSeconds,
    thresholdPercent: BLOOD_OXYGEN_THRESHOLD_PERCENT,
    belowThresholdSampleCount,
    belowThresholdSamplePercent,
    belowThresholdRunCount,
    longestBelowThresholdSampleCount,
  };

  return {
    envelope,
    observations: [
      observation(
        "spo2-samples-below-90-percent",
        "Junction SpO2 samples below 90%",
        "%",
        belowThresholdSamplePercent,
      ),
      observation(
        "spo2-below-90-run-count",
        "Junction SpO2 runs below 90%",
        "count",
        belowThresholdRunCount,
      ),
      observation(
        "spo2-longest-below-90-sample-count",
        "Junction longest SpO2 sample run below 90%",
        "count",
        longestBelowThresholdSampleCount,
      ),
    ],
    status: "complete",
  };
}

function buildStressTemporalFeatures(
  samples: readonly JunctionTemporalFeatureSample[],
): Extract<JunctionTemporalFeatureResult, { status: "complete" }> {
  const dailyMean = round4(
    samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length,
  );
  const aboveSummary = summarizeBelowThresholds(
    samples.map((sample) => ({ ...sample, value: -sample.value })),
    [-dailyMean],
  );
  const aboveDailyMeanRunCount = thresholdRunCount(aboveSummary, -dailyMean);
  const meanAbsoluteSuccessiveDifferenceValue = meanAbsoluteSuccessiveDifference(samples);
  const morningMean = meanForLocalMinuteWindow(
    samples,
    MORNING_START_LOCAL_MINUTE,
    MORNING_END_LOCAL_MINUTE,
  );
  const eveningMean = meanForLocalMinuteWindow(
    samples,
    EVENING_START_LOCAL_MINUTE,
    EVENING_END_LOCAL_MINUTE,
  );
  const eveningMinusMorningMean = morningMean === null || eveningMean === null
    ? null
    : round4(eveningMean - morningMean);
  const envelope: JunctionStressTemporalFeatureEnvelope = {
    schema: "junction.timeseries_temporal_features.v1",
    method: "ordered-samples-median-gap-2.5x.v1",
    kind: "stress_level",
    sampleCount: samples.length,
    sampleIntervalSeconds: aboveSummary.sampleIntervalSeconds,
    dailyMean,
    aboveDailyMeanRunCount,
    meanAbsoluteSuccessiveDifference: meanAbsoluteSuccessiveDifferenceValue,
    morningWindowLocalMinutes: [
      MORNING_START_LOCAL_MINUTE,
      MORNING_END_LOCAL_MINUTE,
    ],
    eveningWindowLocalMinutes: [
      EVENING_START_LOCAL_MINUTE,
      EVENING_END_LOCAL_MINUTE,
    ],
    morningMean,
    eveningMean,
    eveningMinusMorningMean,
  };
  const observations: JunctionTemporalFeatureObservation[] = [
    observation(
      "stress-above-daily-mean-run-count",
      "Junction stress runs above the daily mean",
      "count",
      aboveDailyMeanRunCount,
    ),
    observation(
      "stress-mean-absolute-successive-difference",
      "Junction stress mean absolute successive difference",
      "score",
      meanAbsoluteSuccessiveDifferenceValue,
    ),
  ];
  if (eveningMinusMorningMean !== null) {
    observations.push(observation(
      "stress-evening-minus-morning-score",
      "Junction evening minus morning stress score",
      "score",
      eveningMinusMorningMean,
    ));
  }

  return { envelope, observations, status: "complete" };
}

function summarizeBelowThresholds(
  samples: readonly JunctionTemporalFeatureSample[],
  thresholdsBelow: readonly number[],
) {
  return summarizeSampleSeries({
    stream: "junction-temporal-feature",
    samples,
    thresholdsBelow,
  });
}

function thresholdRunCount(
  summary: ReturnType<typeof summarizeSampleSeries>,
  threshold: number,
): number {
  return summary.thresholds.find((entry) => entry.below === threshold)?.runCount ?? 0;
}

function longestThresholdRunSampleCount(
  samples: readonly JunctionTemporalFeatureSample[],
  threshold: number,
  sampleIntervalSeconds: number | null,
): number {
  const ordered = orderSamples(samples);
  const gapThresholdSeconds = sampleIntervalSeconds === null
    ? null
    : sampleIntervalSeconds * 2.5;
  let currentRun = 0;
  let longestRun = 0;
  let previousBelowAt: number | undefined;

  for (const sample of ordered) {
    const sampleAt = Date.parse(sample.recordedAt);
    if (sample.value >= threshold) {
      currentRun = 0;
      previousBelowAt = undefined;
      continue;
    }

    const gapSeconds = previousBelowAt === undefined
      ? null
      : (sampleAt - previousBelowAt) / 1_000;
    if (
      gapSeconds !== null
      && gapThresholdSeconds !== null
      && gapSeconds > gapThresholdSeconds
    ) {
      currentRun = 0;
    }
    currentRun += 1;
    longestRun = Math.max(longestRun, currentRun);
    previousBelowAt = sampleAt;
  }

  return longestRun;
}

function meanForLocalMinuteWindow(
  samples: readonly JunctionTemporalFeatureSample[],
  startMinute: number,
  endMinute: number,
): number | null {
  const values = samples.flatMap((sample) =>
    sample.localMinuteOfDay !== undefined
      && sample.localMinuteOfDay >= startMinute
      && sample.localMinuteOfDay < endMinute
      ? [sample.value]
      : []
  );
  return values.length > 0
    ? round4(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

function meanAbsoluteSuccessiveDifference(
  samples: readonly JunctionTemporalFeatureSample[],
): number {
  const ordered = orderSamples(samples);
  let differenceTotal = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous && current) {
      differenceTotal += Math.abs(current.value - previous.value);
    }
  }
  return round4(differenceTotal / Math.max(1, ordered.length - 1));
}

function orderSamples(
  samples: readonly JunctionTemporalFeatureSample[],
): JunctionTemporalFeatureSample[] {
  return [...samples].sort((left, right) =>
    Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
  );
}

function observation(
  metric: string,
  title: string,
  unit: string,
  value: number,
): JunctionTemporalFeatureObservation {
  return { metric, title, unit, value: round4(value) };
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}
