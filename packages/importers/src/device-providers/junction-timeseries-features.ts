import { summarizeSampleSeries } from "@murphai/health-metrics";

export const JUNCTION_TEMPORAL_FEATURE_MAX_SAMPLES_PER_DAY = 5_000;
export const JUNCTION_TEMPORAL_FEATURE_MAX_SAMPLES_PER_IMPORT = 25_000;
export const JUNCTION_TEMPORAL_FEATURE_MAX_OBSERVATIONS_PER_DAY = 10;
export const JUNCTION_TEMPORAL_FEATURE_ENVELOPE_MAX_BYTES = 1_024;
export const JUNCTION_TEMPORAL_FEATURE_METHOD =
  "distinct-instant-mean-median-gap-2.5x-absolute-cap.v2";

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
  confidence: "low" | "medium";
  metric: string;
  qualifiers: JunctionTemporalFeatureObservationQualifiers;
  title: string;
  unit: string;
  value: number;
}

export interface JunctionTemporalFeatureObservationQualifiers {
  derived: true;
  evidenceConfidence: "low" | "medium";
  evidenceMethod: typeof JUNCTION_TEMPORAL_FEATURE_METHOD;
  eveningSampleCount?: number;
  maxAdjacentGapSeconds: number;
  morningSampleCount?: number;
  qualifyingPairCount: number;
  sampleCount: number;
  sampleIntervalSeconds?: number;
  thresholdSampleCount?: number;
}

interface JunctionTemporalFeatureEnvelopeBase {
  maxAdjacentGapSeconds: number;
  method: typeof JUNCTION_TEMPORAL_FEATURE_METHOD;
  qualifyingPairCount: number;
  sampleCount: number;
  sampleIntervalSeconds: number | null;
  schema: "junction.timeseries_temporal_features.v2";
}

export interface JunctionBloodOxygenTemporalFeatureEnvelope
  extends JunctionTemporalFeatureEnvelopeBase {
  belowThresholdRunCount?: number;
  belowThresholdSampleCount: number;
  belowThresholdSamplePercent: number;
  kind: "blood_oxygen";
  longestBelowThresholdSampleCount?: number;
  thresholdPercent: 90;
}

export interface JunctionStressTemporalFeatureEnvelope
  extends JunctionTemporalFeatureEnvelopeBase {
  aboveDailyMeanRunCount: number;
  dailyMean: number;
  eveningSampleCount?: number;
  eveningMean: number | null;
  eveningMinusMorningMean: number | null;
  eveningWindowEndLocalMinute: 1440;
  eveningWindowStartLocalMinute: 1080;
  kind: "stress_level";
  meanAbsoluteSuccessiveDifference: number;
  morningSampleCount?: number;
  morningMean: number | null;
  morningWindowEndLocalMinute: 720;
  morningWindowStartLocalMinute: 360;
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
      status:
        | "insufficient_samples"
        | "insufficient_temporal_evidence"
        | "suppressed_input_cap"
        | "suppressed_output_cap";
    };

// This is the only clinical-looking threshold in this reducer. It reuses the
// repository-owned oxygen-night screening contract in sample-series-summary;
// the output describes sample shape and is not a diagnosis.
const BLOOD_OXYGEN_THRESHOLD_PERCENT = 90;
const BLOOD_OXYGEN_MAX_ADJACENT_GAP_SECONDS = 5 * 60;
const STRESS_MAX_ADJACENT_GAP_SECONDS = 15 * 60;
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
  const samples = collapseEqualTimestampSamples(input.samples);
  if (samples.length < 2) {
    return { observations: [], status: "insufficient_samples" };
  }

  const result = buildTemporalFeatureResult(input.resource, samples);
  if (result.status !== "complete") {
    return result;
  }
  if (
    result.observations.length > JUNCTION_TEMPORAL_FEATURE_MAX_OBSERVATIONS_PER_DAY
    || serializedByteLength(result.envelope) > JUNCTION_TEMPORAL_FEATURE_ENVELOPE_MAX_BYTES
  ) {
    return { observations: [], status: "suppressed_output_cap" };
  }

  return result;
}

// Junction reconciles the same instant more than once for some providers. A
// sorted mean makes those rows one deterministic observation, independent of
// payload order. Conflicting local clocks are dropped for daypart use instead
// of choosing one provider row. The shared sample summarizer therefore only
// receives unique, ordered instants and needs no repository-wide policy change.
function collapseEqualTimestampSamples(
  samples: readonly JunctionTemporalFeatureSample[],
): JunctionTemporalFeatureSample[] {
  const byInstant = new Map<number, JunctionTemporalFeatureSample[]>();
  for (const sample of samples) {
    const instant = Date.parse(sample.recordedAt);
    if (!Number.isFinite(instant) || !Number.isFinite(sample.value)) {
      continue;
    }
    const atInstant = byInstant.get(instant) ?? [];
    atInstant.push(sample);
    byInstant.set(instant, atInstant);
  }

  return [...byInstant.entries()]
    .sort(([left], [right]) => left - right)
    .map(([instant, atInstant]) => {
      const values = atInstant.map((sample) => sample.value).sort((left, right) => left - right);
      const localMinutes = [...new Set(atInstant.flatMap((sample) =>
        sample.localMinuteOfDay === undefined ? [] : [sample.localMinuteOfDay]
      ))];
      return {
        recordedAt: new Date(instant).toISOString(),
        value: values.reduce((sum, value) => sum + value, 0) / values.length,
        ...(localMinutes.length === 1 ? { localMinuteOfDay: localMinutes[0] } : {}),
      };
    });
}

function buildTemporalFeatureResult(
  resource: JunctionTemporalFeatureResource,
  samples: readonly JunctionTemporalFeatureSample[],
): JunctionTemporalFeatureResult {
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
  const continuity = assessContinuity(
    samples,
    BLOOD_OXYGEN_MAX_ADJACENT_GAP_SECONDS,
  );
  const runEvidence = continuity.qualifyingPairs.length > 0
    ? summarizeThresholdRuns(samples, continuity.qualifyingPairs, (value) =>
      value < BLOOD_OXYGEN_THRESHOLD_PERCENT
    )
    : null;
  const envelope: JunctionBloodOxygenTemporalFeatureEnvelope = {
    schema: "junction.timeseries_temporal_features.v2",
    method: JUNCTION_TEMPORAL_FEATURE_METHOD,
    kind: "blood_oxygen",
    sampleCount: samples.length,
    sampleIntervalSeconds: continuity.sampleIntervalSeconds,
    maxAdjacentGapSeconds: BLOOD_OXYGEN_MAX_ADJACENT_GAP_SECONDS,
    qualifyingPairCount: continuity.qualifyingPairs.length,
    thresholdPercent: BLOOD_OXYGEN_THRESHOLD_PERCENT,
    belowThresholdSampleCount,
    belowThresholdSamplePercent,
    belowThresholdRunCount: runEvidence?.runCount,
    longestBelowThresholdSampleCount: runEvidence?.longestRunSampleCount,
  };
  const sampleBurdenQualifiers = evidenceQualifiers({
    confidence: "low",
    continuity,
    sampleCount: samples.length,
    thresholdSampleCount: belowThresholdSampleCount,
  });
  const observations: JunctionTemporalFeatureObservation[] = [
    observation(
      "spo2-samples-below-90-percent",
      "Junction SpO2 samples below 90%",
      "%",
      belowThresholdSamplePercent,
      sampleBurdenQualifiers,
    ),
  ];
  if (runEvidence) {
    const continuitySampleCount = continuity.participatingSampleIndexes.length;
    const continuityThresholdSampleCount = continuity.participatingSampleIndexes.reduce(
      (count, index) => count + (
        (samples[index]?.value ?? Infinity) < BLOOD_OXYGEN_THRESHOLD_PERCENT ? 1 : 0
      ),
      0,
    );
    const runQualifiers = evidenceQualifiers({
      confidence: "medium",
      continuity,
      sampleCount: continuitySampleCount,
      thresholdSampleCount: continuityThresholdSampleCount,
    });
    observations.push(
      observation(
        "spo2-below-90-run-count",
        "Junction SpO2 runs below 90%",
        "count",
        runEvidence.runCount,
        runQualifiers,
      ),
      observation(
        "spo2-longest-below-90-sample-count",
        "Junction longest SpO2 sample run below 90%",
        "count",
        runEvidence.longestRunSampleCount,
        runQualifiers,
      ),
    );
  }

  return {
    envelope,
    observations,
    status: "complete",
  };
}

function buildStressTemporalFeatures(
  samples: readonly JunctionTemporalFeatureSample[],
): JunctionTemporalFeatureResult {
  const continuity = assessContinuity(samples, STRESS_MAX_ADJACENT_GAP_SECONDS);
  if (continuity.qualifyingPairs.length === 0) {
    return { observations: [], status: "insufficient_temporal_evidence" };
  }
  const continuitySamples = continuity.participatingSampleIndexes.flatMap((index) => {
    const sample = samples[index];
    return sample ? [sample] : [];
  });
  const unroundedDailyMean =
    continuitySamples.reduce((sum, sample) => sum + sample.value, 0)
      / continuitySamples.length;
  const dailyMean = round4(unroundedDailyMean);
  const aboveDailyMeanRunCount = summarizeThresholdRuns(
    samples,
    continuity.qualifyingPairs,
    (value) => value > unroundedDailyMean,
  ).runCount;
  const meanAbsoluteSuccessiveDifferenceValue = meanAbsoluteSuccessiveDifference(
    samples,
    continuity.qualifyingPairs,
  );
  const morning = evidenceForLocalMinuteWindow(
    samples,
    continuity.qualifyingPairs,
    MORNING_START_LOCAL_MINUTE,
    MORNING_END_LOCAL_MINUTE,
  );
  const evening = evidenceForLocalMinuteWindow(
    samples,
    continuity.qualifyingPairs,
    EVENING_START_LOCAL_MINUTE,
    EVENING_END_LOCAL_MINUTE,
  );
  const eveningMinusMorningMean = morning === null || evening === null
    ? null
    : round4(evening.mean - morning.mean);
  const envelope: JunctionStressTemporalFeatureEnvelope = {
    schema: "junction.timeseries_temporal_features.v2",
    method: JUNCTION_TEMPORAL_FEATURE_METHOD,
    kind: "stress_level",
    sampleCount: continuitySamples.length,
    sampleIntervalSeconds: continuity.sampleIntervalSeconds,
    maxAdjacentGapSeconds: STRESS_MAX_ADJACENT_GAP_SECONDS,
    qualifyingPairCount: continuity.qualifyingPairs.length,
    dailyMean,
    aboveDailyMeanRunCount,
    meanAbsoluteSuccessiveDifference: meanAbsoluteSuccessiveDifferenceValue,
    morningWindowStartLocalMinute: MORNING_START_LOCAL_MINUTE,
    morningWindowEndLocalMinute: MORNING_END_LOCAL_MINUTE,
    eveningWindowStartLocalMinute: EVENING_START_LOCAL_MINUTE,
    eveningWindowEndLocalMinute: EVENING_END_LOCAL_MINUTE,
    morningMean: morning?.mean ?? null,
    morningSampleCount: morning?.sampleCount,
    eveningMean: evening?.mean ?? null,
    eveningSampleCount: evening?.sampleCount,
    eveningMinusMorningMean,
  };
  const continuityQualifiers = evidenceQualifiers({
    confidence: "medium",
    continuity,
    sampleCount: continuitySamples.length,
  });
  const observations: JunctionTemporalFeatureObservation[] = [
    observation(
      "stress-above-daily-mean-run-count",
      "Junction stress runs above the daily mean",
      "count",
      aboveDailyMeanRunCount,
      continuityQualifiers,
    ),
    observation(
      "stress-mean-absolute-successive-difference",
      "Junction stress mean absolute successive difference",
      "score",
      meanAbsoluteSuccessiveDifferenceValue,
      continuityQualifiers,
    ),
  ];
  if (eveningMinusMorningMean !== null && morning && evening) {
    observations.push(observation(
      "stress-evening-minus-morning-score",
      "Junction evening minus morning stress score",
      "score",
      eveningMinusMorningMean,
      evidenceQualifiers({
        confidence: "medium",
        continuity,
        eveningSampleCount: evening.sampleCount,
        morningSampleCount: morning.sampleCount,
        qualifyingPairCount: morning.qualifyingPairCount + evening.qualifyingPairCount,
        sampleCount: continuitySamples.length,
      }),
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

interface QualifyingAdjacentPair {
  currentIndex: number;
  previousIndex: number;
}

interface ContinuityAssessment {
  maxAdjacentGapSeconds: number;
  participatingSampleIndexes: readonly number[];
  qualifyingPairs: readonly QualifyingAdjacentPair[];
  sampleIntervalSeconds: number | null;
}

function assessContinuity(
  samples: readonly JunctionTemporalFeatureSample[],
  maxAdjacentGapSeconds: number,
): ContinuityAssessment {
  const partitionCadences: number[] = [];
  const qualifyingPairs: QualifyingAdjacentPair[] = [];
  let partitionStart = 0;

  for (let index = 1; index <= samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const gapSeconds = previous && current
      ? (Date.parse(current.recordedAt) - Date.parse(previous.recordedAt)) / 1_000
      : Infinity;
    if (index < samples.length && gapSeconds <= maxAdjacentGapSeconds) {
      continue;
    }

    const partition = samples.slice(partitionStart, index);
    if (partition.length > 1) {
      const partitionCadence = summarizeBelowThresholds(partition, []).sampleIntervalSeconds;
      if (partitionCadence !== null) {
        partitionCadences.push(partitionCadence);
        const qualifyingGapSeconds = Math.min(
          maxAdjacentGapSeconds,
          partitionCadence * 2.5,
        );
        for (let partitionIndex = partitionStart + 1; partitionIndex < index; partitionIndex += 1) {
          const partitionPrevious = samples[partitionIndex - 1];
          const partitionCurrent = samples[partitionIndex];
          if (!partitionPrevious || !partitionCurrent) {
            continue;
          }
          const partitionGapSeconds = (
            Date.parse(partitionCurrent.recordedAt)
            - Date.parse(partitionPrevious.recordedAt)
          ) / 1_000;
          if (partitionGapSeconds > 0 && partitionGapSeconds <= qualifyingGapSeconds) {
            qualifyingPairs.push({
              currentIndex: partitionIndex,
              previousIndex: partitionIndex - 1,
            });
          }
        }
      }
    }
    partitionStart = index;
  }

  return {
    maxAdjacentGapSeconds,
    participatingSampleIndexes: [...new Set(qualifyingPairs.flatMap((pair) => [
      pair.previousIndex,
      pair.currentIndex,
    ]))].sort((left, right) => left - right),
    qualifyingPairs,
    sampleIntervalSeconds: medianPositiveNumber(partitionCadences),
  };
}

function medianPositiveNumber(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2
    : sorted[midpoint] ?? 0;
  return median > 0 ? round4(median) : null;
}

function summarizeThresholdRuns(
  samples: readonly JunctionTemporalFeatureSample[],
  qualifyingPairs: readonly QualifyingAdjacentPair[],
  qualifies: (value: number) => boolean,
): { longestRunSampleCount: number; runCount: number } {
  let currentRun = 0;
  let longestRun = 0;
  let previousPairCurrentIndex = -1;
  let runCount = 0;

  for (const pair of qualifyingPairs) {
    const previous = samples[pair.previousIndex];
    const current = samples[pair.currentIndex];
    if (!previous || !current || !qualifies(previous.value) || !qualifies(current.value)) {
      currentRun = 0;
      previousPairCurrentIndex = -1;
      continue;
    }
    if (pair.previousIndex === previousPairCurrentIndex) {
      currentRun += 1;
    } else {
      currentRun = 2;
      runCount += 1;
    }
    longestRun = Math.max(longestRun, currentRun);
    previousPairCurrentIndex = pair.currentIndex;
  }

  return { longestRunSampleCount: longestRun, runCount };
}

function evidenceForLocalMinuteWindow(
  samples: readonly JunctionTemporalFeatureSample[],
  qualifyingPairs: readonly QualifyingAdjacentPair[],
  startMinute: number,
  endMinute: number,
): { mean: number; qualifyingPairCount: number; sampleCount: number } | null {
  const sampleIndexes = new Set<number>();
  let qualifyingPairCount = 0;
  for (const pair of qualifyingPairs) {
    const previous = samples[pair.previousIndex];
    const current = samples[pair.currentIndex];
    if (!previous || !current) {
      continue;
    }
    if (
      minuteIsInWindow(previous.localMinuteOfDay, startMinute, endMinute)
      && minuteIsInWindow(current.localMinuteOfDay, startMinute, endMinute)
    ) {
      sampleIndexes.add(pair.previousIndex);
      sampleIndexes.add(pair.currentIndex);
      qualifyingPairCount += 1;
    }
  }
  if (qualifyingPairCount === 0) {
    return null;
  }
  const values = [...sampleIndexes].map((index) => samples[index]?.value).filter(
    (value): value is number => value !== undefined,
  );
  return {
    mean: round4(values.reduce((sum, value) => sum + value, 0) / values.length),
    qualifyingPairCount,
    sampleCount: values.length,
  };
}

function minuteIsInWindow(
  minute: number | undefined,
  startMinute: number,
  endMinute: number,
): boolean {
  return minute !== undefined && minute >= startMinute && minute < endMinute;
}

function meanAbsoluteSuccessiveDifference(
  samples: readonly JunctionTemporalFeatureSample[],
  qualifyingPairs: readonly QualifyingAdjacentPair[],
): number {
  const differenceTotal = qualifyingPairs.reduce((sum, pair) => {
    const previous = samples[pair.previousIndex];
    const current = samples[pair.currentIndex];
    return previous && current ? sum + Math.abs(current.value - previous.value) : sum;
  }, 0);
  return round4(differenceTotal / qualifyingPairs.length);
}

function evidenceQualifiers(input: {
  confidence: "low" | "medium";
  continuity: ContinuityAssessment;
  eveningSampleCount?: number;
  morningSampleCount?: number;
  qualifyingPairCount?: number;
  sampleCount: number;
  thresholdSampleCount?: number;
}): JunctionTemporalFeatureObservationQualifiers {
  return {
    derived: true,
    evidenceConfidence: input.confidence,
    evidenceMethod: JUNCTION_TEMPORAL_FEATURE_METHOD,
    maxAdjacentGapSeconds: input.continuity.maxAdjacentGapSeconds,
    qualifyingPairCount: input.qualifyingPairCount ?? input.continuity.qualifyingPairs.length,
    sampleCount: input.sampleCount,
    ...(input.continuity.sampleIntervalSeconds === null
      ? {}
      : { sampleIntervalSeconds: input.continuity.sampleIntervalSeconds }),
    ...(input.thresholdSampleCount === undefined
      ? {}
      : { thresholdSampleCount: input.thresholdSampleCount }),
    ...(input.morningSampleCount === undefined
      ? {}
      : { morningSampleCount: input.morningSampleCount }),
    ...(input.eveningSampleCount === undefined
      ? {}
      : { eveningSampleCount: input.eveningSampleCount }),
  };
}

function observation(
  metric: string,
  title: string,
  unit: string,
  value: number,
  qualifiers: JunctionTemporalFeatureObservationQualifiers,
): JunctionTemporalFeatureObservation {
  return {
    confidence: qualifiers.evidenceConfidence,
    metric,
    qualifiers,
    title,
    unit,
    value: round4(value),
  };
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}
