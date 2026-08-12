export const JUNCTION_DENSE_FIDELITY_RESOURCES = Object.freeze([
  "glucose",
  "blood_oxygen",
  "stress_level",
] as const);

export const JUNCTION_SPARSE_INTERVAL_RESOURCES = Object.freeze([
  "caffeine",
  "water",
  "mindfulness_minutes",
] as const);

export type JunctionDenseFidelityResource =
  (typeof JUNCTION_DENSE_FIDELITY_RESOURCES)[number];
export type JunctionSparseIntervalResource =
  (typeof JUNCTION_SPARSE_INTERVAL_RESOURCES)[number];
export type JunctionFidelityResource =
  | JunctionDenseFidelityResource
  | JunctionSparseIntervalResource;

const JUNCTION_MAX_NORMALIZED_EVENTS = 10_000;
const JUNCTION_MAX_NORMALIZED_EVIDENCE_PARTS = 10_000;

export interface JunctionTimeseriesFidelityPoint {
  readonly localMinute: number;
  readonly observedAtMs: number;
  readonly value: number;
}

export interface JunctionTimeseriesDerivedFact {
  readonly metric: string;
  readonly unit: string;
  readonly value: number;
}

interface JunctionFidelityRoundingPolicy {
  readonly durationDecimals: number;
  readonly percentDecimals: number;
  readonly valueDecimals: number;
}

interface JunctionFidelityCoveragePolicy {
  readonly gapCapMinutes: number;
  readonly lastSampleSupportMinutes: 0;
  readonly method: "forward_gap_capped";
}

interface JunctionFidelityEpisodePolicy {
  readonly durationMethod: "sum_capped_forward_gaps_between_qualifying_readings";
  readonly linkGapMinutes: number;
  readonly maxRetained: number;
  readonly outputOrder: "start_asc_end_asc_kind_asc";
  readonly selectionOrder:
    "estimated_duration_desc_sample_count_desc_severity_desc_start_asc";
}

interface JunctionDenseFidelityPolicyBase {
  readonly identityVersion: string;
  readonly kind: "point";
  readonly maxDerivedFactCount: number;
  readonly maxRecordsPerResponse: number;
  readonly maxRecordsPerSourceDay: number;
  readonly policyVersion: string;
  readonly rounding: JunctionFidelityRoundingPolicy;
  readonly sorting: "observed_at_asc_local_minute_asc_value_asc";
  readonly coverage: JunctionFidelityCoveragePolicy;
  readonly episodes: JunctionFidelityEpisodePolicy;
  readonly unit: string;
}

export interface JunctionGlucoseFidelityPolicy extends JunctionDenseFidelityPolicyBase {
  readonly resource: "glucose";
  readonly thresholds: {
    readonly rangeHighInclusive: number;
    readonly rangeLowInclusive: number;
  };
  readonly overnightWindow: {
    readonly endLocalMinuteExclusive: number;
    readonly startLocalMinuteInclusive: number;
  };
}

export interface JunctionBloodOxygenFidelityPolicy extends JunctionDenseFidelityPolicyBase {
  readonly resource: "blood_oxygen";
  readonly thresholds: {
    readonly below90Exclusive: number;
    readonly below92Exclusive: number;
  };
}

export interface JunctionStressFidelityPolicy extends JunctionDenseFidelityPolicyBase {
  readonly resource: "stress_level";
  readonly recovery: {
    readonly maxAdjacentObservationGapMinutes: number;
    readonly maxLookaheadMinutes: number;
    readonly method: "elapsed_to_first_observed_recovered_reading_with_gap_guard";
  };
  readonly thresholds: {
    readonly elevatedInclusive: number;
    readonly recoveredInclusive: number;
  };
}

export type JunctionDenseFidelityPolicy =
  | JunctionGlucoseFidelityPolicy
  | JunctionBloodOxygenFidelityPolicy
  | JunctionStressFidelityPolicy;

export interface JunctionSparseIntervalPolicy {
  readonly identityVersion: string;
  readonly kind: "interval";
  readonly maxRecordsPerResponse: number;
  readonly maxRecordsPerSourceDay: number;
  readonly metric: string;
  readonly policyVersion: string;
  readonly resource: JunctionSparseIntervalResource;
  readonly title: string;
  readonly unit: string;
}

const COMMON_DENSE_POLICY = {
  identityVersion: "junction.timeseries_feature_identity.v1",
  kind: "point" as const,
  maxRecordsPerResponse: 25_000,
  maxRecordsPerSourceDay: 1_440,
  rounding: {
    durationDecimals: 2,
    percentDecimals: 2,
    valueDecimals: 4,
  },
  sorting: "observed_at_asc_local_minute_asc_value_asc" as const,
  coverage: {
    gapCapMinutes: 15,
    lastSampleSupportMinutes: 0 as const,
    method: "forward_gap_capped" as const,
  },
  episodes: {
    durationMethod: "sum_capped_forward_gaps_between_qualifying_readings" as const,
    linkGapMinutes: 20,
    maxRetained: 12,
    outputOrder: "start_asc_end_asc_kind_asc" as const,
    selectionOrder:
      "estimated_duration_desc_sample_count_desc_severity_desc_start_asc" as const,
  },
};

/**
 * Junction-specific policy seam for bounded temporal fidelity.
 *
 * Duration is always estimated from forward gaps between discrete readings.
 * Each gap is capped, the final reading contributes zero support, and episode
 * duration never extends beyond the last qualifying reading. Those semantics
 * intentionally avoid presenting discrete provider samples as clinically exact
 * continuous duration.
 *
 * Added persistence cardinality is static per source/day: one feature
 * envelope plus at most 10 glucose, or 8 blood-oxygen or stress derived facts;
 * sparse resources admit at most 128 interval events and evidence parts.
 */
export const JUNCTION_TIMESERIES_FIDELITY_POLICIES = Object.freeze({
  glucose: {
    ...COMMON_DENSE_POLICY,
    maxDerivedFactCount: 10,
    policyVersion: "junction.glucose_feature_envelope.v1",
    resource: "glucose",
    unit: "mg/dL",
    thresholds: {
      rangeHighInclusive: 180,
      rangeLowInclusive: 70,
    },
    overnightWindow: {
      startLocalMinuteInclusive: 0,
      endLocalMinuteExclusive: 6 * 60,
    },
  },
  blood_oxygen: {
    ...COMMON_DENSE_POLICY,
    maxDerivedFactCount: 8,
    policyVersion: "junction.blood_oxygen_feature_envelope.v1",
    resource: "blood_oxygen",
    unit: "%",
    thresholds: {
      below90Exclusive: 90,
      below92Exclusive: 92,
    },
  },
  stress_level: {
    ...COMMON_DENSE_POLICY,
    maxDerivedFactCount: 8,
    policyVersion: "junction.stress_level_feature_envelope.v1",
    resource: "stress_level",
    unit: "score",
    thresholds: {
      elevatedInclusive: 60,
      recoveredInclusive: 40,
    },
    recovery: {
      maxAdjacentObservationGapMinutes: 30,
      maxLookaheadMinutes: 180,
      method: "elapsed_to_first_observed_recovered_reading_with_gap_guard",
    },
  },
  caffeine: {
    identityVersion: "junction.interval_identity.v1",
    kind: "interval",
    maxRecordsPerResponse: 2_048,
    maxRecordsPerSourceDay: 128,
    metric: "caffeine",
    policyVersion: "junction.caffeine_interval.v1",
    resource: "caffeine",
    title: "Junction caffeine intake",
    unit: "mg",
  },
  water: {
    identityVersion: "junction.interval_identity.v1",
    kind: "interval",
    maxRecordsPerResponse: 2_048,
    maxRecordsPerSourceDay: 128,
    metric: "water",
    policyVersion: "junction.water_interval.v1",
    resource: "water",
    title: "Junction water intake",
    unit: "ml",
  },
  mindfulness_minutes: {
    identityVersion: "junction.interval_identity.v1",
    kind: "interval",
    maxRecordsPerResponse: 2_048,
    maxRecordsPerSourceDay: 128,
    metric: "mindfulness-minutes",
    policyVersion: "junction.mindfulness_minutes_interval.v1",
    resource: "mindfulness_minutes",
    title: "Junction mindful minutes",
    unit: "minutes",
  },
} as const satisfies Record<JunctionFidelityResource, JunctionDenseFidelityPolicy | JunctionSparseIntervalPolicy>);

export function isJunctionDenseFidelityResource(
  resource: string,
): resource is JunctionDenseFidelityResource {
  return (JUNCTION_DENSE_FIDELITY_RESOURCES as readonly string[]).includes(resource);
}

export function isJunctionSparseIntervalResource(
  resource: string,
): resource is JunctionSparseIntervalResource {
  return (JUNCTION_SPARSE_INTERVAL_RESOURCES as readonly string[]).includes(resource);
}

export function getJunctionDenseFidelityPolicy(
  resource: "glucose",
): JunctionGlucoseFidelityPolicy;
export function getJunctionDenseFidelityPolicy(
  resource: "blood_oxygen",
): JunctionBloodOxygenFidelityPolicy;
export function getJunctionDenseFidelityPolicy(
  resource: "stress_level",
): JunctionStressFidelityPolicy;
export function getJunctionDenseFidelityPolicy(
  resource: JunctionDenseFidelityResource,
): JunctionDenseFidelityPolicy;
export function getJunctionDenseFidelityPolicy(
  resource: JunctionDenseFidelityResource,
): JunctionDenseFidelityPolicy {
  return JUNCTION_TIMESERIES_FIDELITY_POLICIES[resource];
}

export function getJunctionSparseIntervalPolicy(
  resource: JunctionSparseIntervalResource,
): JunctionSparseIntervalPolicy {
  return JUNCTION_TIMESERIES_FIDELITY_POLICIES[resource];
}

export function assertJunctionTimeseriesResponseBound(
  resource: JunctionFidelityResource,
  recordCount: number,
): void {
  const policy = JUNCTION_TIMESERIES_FIDELITY_POLICIES[resource];
  if (!Number.isSafeInteger(recordCount) || recordCount < 0) {
    throw new TypeError(`Junction ${resource} response record count must be a nonnegative integer.`);
  }
  if (recordCount > policy.maxRecordsPerResponse) {
    throw new RangeError(
      `Junction ${resource} response has ${recordCount} records; maximum admitted is ${policy.maxRecordsPerResponse}.`,
    );
  }
}

export function assertJunctionTimeseriesSourceDayBound(
  resource: JunctionFidelityResource,
  recordCount: number,
): void {
  const policy = JUNCTION_TIMESERIES_FIDELITY_POLICIES[resource];
  if (recordCount > policy.maxRecordsPerSourceDay) {
    throw new RangeError(
      `Junction ${resource} source/day has ${recordCount} records; maximum admitted is ${policy.maxRecordsPerSourceDay}.`,
    );
  }
}

export function assertJunctionTimeseriesOutputBounds(input: {
  readonly eventCount: number;
  readonly evidencePartCount: number;
}): void {
  if (input.eventCount > JUNCTION_MAX_NORMALIZED_EVENTS) {
    throw new RangeError(
      `Junction normalization produced ${input.eventCount} events; maximum admitted is ${JUNCTION_MAX_NORMALIZED_EVENTS}.`,
    );
  }
  if (input.evidencePartCount > JUNCTION_MAX_NORMALIZED_EVIDENCE_PARTS) {
    throw new RangeError(
      `Junction normalization produced ${input.evidencePartCount} evidence parts; maximum admitted is ${JUNCTION_MAX_NORMALIZED_EVIDENCE_PARTS}.`,
    );
  }
}

interface JunctionFeatureEnvelopeCoverage {
  readonly cappedGapCount: number;
  readonly estimatedCoverageMinutes: number;
  readonly lastSampleSupportMinutes: 0;
  readonly method: "forward_gap_capped";
  readonly observedSpanMinutes: number;
}

interface JunctionEpisodeSummary {
  readonly endObservedAtMs: number;
  readonly endLocalMinute: number;
  readonly estimatedDurationMinutes: number;
  readonly kind: "elevated" | "high" | "low";
  readonly maxValue: number;
  readonly meanValue: number;
  readonly minValue: number;
  readonly observedRecoveryLatencyMinutes?: number;
  readonly sampleCount: number;
  readonly severity: number;
  readonly startLocalMinute: number;
}

interface JunctionEpisodeEnvelope {
  readonly fields: readonly string[];
  readonly retainedCount: number;
  readonly retained: readonly (readonly (number | string | null)[])[];
  readonly totalCount: number;
  readonly truncatedCount: number;
}

export interface JunctionTimeseriesFeatureEnvelope {
  readonly coverage: JunctionFeatureEnvelopeCoverage;
  readonly episodes: JunctionEpisodeEnvelope;
  readonly features: Readonly<Record<string, number>>;
  readonly hourlyBucketFields: readonly string[];
  readonly hourlyBuckets: readonly (readonly (number | null)[] | null)[];
  readonly policy: Readonly<Record<string, unknown>>;
  readonly policyVersion: string;
  readonly sampleCount: number;
  readonly schema: "junction.timeseries_feature_envelope.v1";
  readonly unit: string;
}

interface JunctionPointWithSupport extends JunctionTimeseriesFidelityPoint {
  readonly forwardSupportMinutes: number;
}

interface MutableHourlyBucket {
  estimatedCoverageMinutes: number;
  values: number[];
}

export function deriveJunctionTimeseriesFeatureEnvelope(
  resource: JunctionDenseFidelityResource,
  inputSamples: readonly JunctionTimeseriesFidelityPoint[],
): {
  readonly envelope: JunctionTimeseriesFeatureEnvelope;
  readonly facts: readonly JunctionTimeseriesDerivedFact[];
} {
  assertJunctionTimeseriesSourceDayBound(resource, inputSamples.length);
  if (inputSamples.length === 0) {
    return deriveEmptyJunctionTimeseriesFeatureEnvelope(resource);
  }

  const samples = inputSamples
    .map((sample) => validatePointSample(resource, sample))
    .sort(comparePointSamples);

  switch (resource) {
    case "glucose": {
      const policy = getJunctionDenseFidelityPolicy("glucose");
      const supportedSamples = addForwardSupport(samples, policy);
      return deriveGlucoseEnvelope(supportedSamples, buildCoverage(supportedSamples, policy), policy);
    }
    case "blood_oxygen": {
      const policy = getJunctionDenseFidelityPolicy("blood_oxygen");
      const supportedSamples = addForwardSupport(samples, policy);
      return deriveBloodOxygenEnvelope(supportedSamples, buildCoverage(supportedSamples, policy), policy);
    }
    case "stress_level": {
      const policy = getJunctionDenseFidelityPolicy("stress_level");
      const supportedSamples = addForwardSupport(samples, policy);
      return deriveStressEnvelope(supportedSamples, buildCoverage(supportedSamples, policy), policy);
    }
  }
}

function deriveEmptyJunctionTimeseriesFeatureEnvelope(
  resource: JunctionDenseFidelityResource,
): {
  readonly envelope: JunctionTimeseriesFeatureEnvelope;
  readonly facts: readonly JunctionTimeseriesDerivedFact[];
} {
  const policy = getJunctionDenseFidelityPolicy(resource);
  const metricPrefix = resource === "blood_oxygen"
    ? "spo2"
    : resource === "stress_level"
      ? "stress"
      : "glucose";
  const facts: readonly JunctionTimeseriesDerivedFact[] = [
    {
      metric: `${metricPrefix}-estimated-coverage-minutes`,
      unit: "minutes",
      value: 0,
    },
    {
      metric: `${metricPrefix}-observed-span-minutes`,
      unit: "minutes",
      value: 0,
    },
  ];
  assertDerivedFactBound(policy, facts);
  return {
    envelope: buildEnvelope({
      coverage: {
        cappedGapCount: 0,
        estimatedCoverageMinutes: 0,
        lastSampleSupportMinutes: policy.coverage.lastSampleSupportMinutes,
        method: policy.coverage.method,
        observedSpanMinutes: 0,
      },
      episodes: [],
      features: {},
      hourlyBucketFields: [],
      hourlyBuckets: Array.from({ length: 24 }, () => null),
      policy,
      sampleCount: 0,
    }),
    facts,
  };
}

function validatePointSample(
  resource: JunctionDenseFidelityResource,
  sample: JunctionTimeseriesFidelityPoint,
): JunctionTimeseriesFidelityPoint {
  if (!Number.isFinite(sample.observedAtMs)) {
    throw new TypeError(`Junction ${resource} feature sample observedAtMs must be finite.`);
  }
  if (!Number.isFinite(sample.localMinute) || sample.localMinute < 0 || sample.localMinute >= 24 * 60) {
    throw new TypeError(`Junction ${resource} feature sample localMinute must be within the local day.`);
  }
  if (!Number.isFinite(sample.value)) {
    throw new TypeError(`Junction ${resource} feature sample value must be finite.`);
  }
  return sample;
}

function comparePointSamples(
  left: JunctionTimeseriesFidelityPoint,
  right: JunctionTimeseriesFidelityPoint,
): number {
  return left.observedAtMs - right.observedAtMs
    || left.localMinute - right.localMinute
    || left.value - right.value;
}

function addForwardSupport(
  samples: readonly JunctionTimeseriesFidelityPoint[],
  policy: JunctionDenseFidelityPolicy,
): JunctionPointWithSupport[] {
  return samples.map((sample, index) => {
    const next = samples[index + 1];
    const gapMinutes = next
      ? Math.max(0, (next.observedAtMs - sample.observedAtMs) / 60_000)
      : policy.coverage.lastSampleSupportMinutes;
    return {
      ...sample,
      forwardSupportMinutes: Math.min(gapMinutes, policy.coverage.gapCapMinutes),
    };
  });
}

function buildCoverage(
  samples: readonly JunctionPointWithSupport[],
  policy: JunctionDenseFidelityPolicy,
): JunctionFeatureEnvelopeCoverage {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const observedSpanMinutes = first && last
    ? Math.max(0, Math.min(24 * 60, (last.observedAtMs - first.observedAtMs) / 60_000))
    : 0;
  let cappedGapCount = 0;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = samples[index];
    const next = samples[index + 1];
    if (current && next && (next.observedAtMs - current.observedAtMs) / 60_000 > policy.coverage.gapCapMinutes) {
      cappedGapCount += 1;
    }
  }

  return {
    cappedGapCount,
    estimatedCoverageMinutes: round(
      samples.reduce((sum, sample) => sum + sample.forwardSupportMinutes, 0),
      policy.rounding.durationDecimals,
    ),
    lastSampleSupportMinutes: policy.coverage.lastSampleSupportMinutes,
    method: policy.coverage.method,
    observedSpanMinutes: round(observedSpanMinutes, policy.rounding.durationDecimals),
  };
}

function deriveGlucoseEnvelope(
  samples: readonly JunctionPointWithSupport[],
  coverage: JunctionFeatureEnvelopeCoverage,
  policy: JunctionGlucoseFidelityPolicy,
): {
  readonly envelope: JunctionTimeseriesFeatureEnvelope;
  readonly facts: readonly JunctionTimeseriesDerivedFact[];
} {
  const { rangeHighInclusive, rangeLowInclusive } = policy.thresholds;
  const episodes = [
    ...deriveEpisodes(samples, "low", (value) => value < rangeLowInclusive, policy, rangeLowInclusive),
    ...deriveEpisodes(samples, "high", (value) => value > rangeHighInclusive, policy, rangeHighInclusive),
  ];
  const observedInRangeCount = samples.filter((sample) =>
    sample.value >= rangeLowInclusive && sample.value <= rangeHighInclusive
  ).length;
  const observedInRangePercent = percentage(observedInRangeCount, samples.length, policy.rounding.percentDecimals);
  const estimatedInRangeMinutes = round(
    samples.reduce((sum, sample) =>
      sample.value >= rangeLowInclusive && sample.value <= rangeHighInclusive
        ? sum + sample.forwardSupportMinutes
        : sum, 0),
    policy.rounding.durationDecimals,
  );
  const estimatedBelowRangeMinutes = round(
    samples.reduce((sum, sample) =>
      sample.value < rangeLowInclusive
        ? sum + sample.forwardSupportMinutes
        : sum, 0),
    policy.rounding.durationDecimals,
  );
  const estimatedAboveRangeMinutes = round(
    samples.reduce((sum, sample) =>
      sample.value > rangeHighInclusive
        ? sum + sample.forwardSupportMinutes
        : sum, 0),
    policy.rounding.durationDecimals,
  );
  const estimatedTimeInRangePercent = coverage.estimatedCoverageMinutes > 0
    ? percentage(
        estimatedInRangeMinutes,
        coverage.estimatedCoverageMinutes,
        policy.rounding.percentDecimals,
      )
    : undefined;
  const overnightSamples = samples.filter((sample) =>
    sample.localMinute >= policy.overnightWindow.startLocalMinuteInclusive
    && sample.localMinute < policy.overnightWindow.endLocalMinuteExclusive
  );
  const overnightAverage = average(overnightSamples.map((sample) => sample.value));
  const coefficientOfVariationPercent = coefficientOfVariation(samples.map((sample) => sample.value));
  const rateChange = deriveObservedRateChange(
    samples,
    policy.coverage.gapCapMinutes,
    policy.rounding.valueDecimals,
  );
  const hourlyBucketFields = [
    "sampleCount",
    "meanValue",
    "minValue",
    "maxValue",
    "estimatedCoverageMinutes",
    "observedInRangeCount",
    "lowReadingCount",
    "highReadingCount",
    "ratePairCount",
    "observedMaxRiseRate",
    "observedMaxFallRate",
  ] as const;
  const hourlyBuckets = buildHourlyBuckets(samples, policy, (bucketSamples, base) => {
    const bucketRateChange = deriveObservedRateChange(
      bucketSamples,
      policy.coverage.gapCapMinutes,
      policy.rounding.valueDecimals,
    );
    return [
      ...base,
      bucketSamples.filter((sample) =>
        sample.value >= rangeLowInclusive && sample.value <= rangeHighInclusive
      ).length,
      bucketSamples.filter((sample) => sample.value < rangeLowInclusive).length,
      bucketSamples.filter((sample) => sample.value > rangeHighInclusive).length,
      bucketRateChange.pairCount,
      bucketRateChange.maxRiseRate ?? 0,
      bucketRateChange.maxFallRate ?? 0,
    ];
  });
  const features = {
    observedInRangePercent,
    estimatedBelowRangeMinutes,
    estimatedInRangeMinutes,
    estimatedAboveRangeMinutes,
    ...(estimatedTimeInRangePercent === undefined ? {} : { estimatedTimeInRangePercent }),
    coefficientOfVariationPercent: round(coefficientOfVariationPercent, policy.rounding.percentDecimals),
    excursionCount: episodes.length,
    overnightSampleCount: overnightSamples.length,
    ratePairCount: rateChange.pairCount,
    ...(rateChange.maxRiseRate === undefined
      ? {}
      : { observedMaxRiseRate: rateChange.maxRiseRate }),
    ...(rateChange.maxFallRate === undefined
      ? {}
      : { observedMaxFallRate: rateChange.maxFallRate }),
    ...(overnightAverage === undefined
      ? {}
      : { overnightAverage: round(overnightAverage, policy.rounding.valueDecimals) }),
  };
  const facts: JunctionTimeseriesDerivedFact[] = [
    {
      metric: "glucose-coefficient-of-variation",
      unit: "%",
      value: round(coefficientOfVariationPercent, policy.rounding.percentDecimals),
    },
    {
      metric: "glucose-excursion-count",
      unit: "count",
      value: episodes.length,
    },
    {
      metric: "glucose-estimated-time-below-range-minutes",
      unit: "minutes",
      value: estimatedBelowRangeMinutes,
    },
    {
      metric: "glucose-estimated-time-above-range-minutes",
      unit: "minutes",
      value: estimatedAboveRangeMinutes,
    },
    {
      metric: "glucose-estimated-coverage-minutes",
      unit: "minutes",
      value: coverage.estimatedCoverageMinutes,
    },
    {
      metric: "glucose-observed-span-minutes",
      unit: "minutes",
      value: coverage.observedSpanMinutes,
    },
  ];
  if (estimatedTimeInRangePercent !== undefined) {
    facts.unshift({
      metric: "glucose-estimated-time-in-range-percent",
      unit: "%",
      value: estimatedTimeInRangePercent,
    });
  }
  if (overnightAverage !== undefined) {
    facts.push({
      metric: "glucose-overnight-average",
      unit: policy.unit,
      value: round(overnightAverage, policy.rounding.valueDecimals),
    });
  }
  if (rateChange.maxRiseRate !== undefined) {
    facts.push({
      metric: "glucose-observed-max-rise-rate",
      unit: "mg/dL/min",
      value: rateChange.maxRiseRate,
    });
  }
  if (rateChange.maxFallRate !== undefined) {
    facts.push({
      metric: "glucose-observed-max-fall-rate",
      unit: "mg/dL/min",
      value: rateChange.maxFallRate,
    });
  }

  assertDerivedFactBound(policy, facts);
  return {
    envelope: buildEnvelope({
      coverage,
      episodes,
      features,
      hourlyBucketFields,
      hourlyBuckets,
      policy,
      sampleCount: samples.length,
    }),
    facts,
  };
}

function deriveBloodOxygenEnvelope(
  samples: readonly JunctionPointWithSupport[],
  coverage: JunctionFeatureEnvelopeCoverage,
  policy: JunctionBloodOxygenFidelityPolicy,
): {
  readonly envelope: JunctionTimeseriesFeatureEnvelope;
  readonly facts: readonly JunctionTimeseriesDerivedFact[];
} {
  const below92Episodes = deriveEpisodes(
    samples,
    "low",
    (value) => value < policy.thresholds.below92Exclusive,
    policy,
    policy.thresholds.below92Exclusive,
  );
  const below90Episodes = deriveEpisodes(
    samples,
    "low",
    (value) => value < policy.thresholds.below90Exclusive,
    policy,
    policy.thresholds.below90Exclusive,
  );
  const below90ReadingCount = samples.filter((sample) =>
    sample.value < policy.thresholds.below90Exclusive
  ).length;
  const below92ReadingCount = samples.filter((sample) =>
    sample.value < policy.thresholds.below92Exclusive
  ).length;
  const below90EstimatedMinutes = round(
    below90Episodes.reduce((sum, episode) => sum + episode.estimatedDurationMinutes, 0),
    policy.rounding.durationDecimals,
  );
  const below92EstimatedMinutes = round(
    below92Episodes.reduce((sum, episode) => sum + episode.estimatedDurationMinutes, 0),
    policy.rounding.durationDecimals,
  );
  const longestBelow90EstimatedMinutes = round(
    Math.max(0, ...below90Episodes.map((episode) => episode.estimatedDurationMinutes)),
    policy.rounding.durationDecimals,
  );
  const longestBelow92EstimatedMinutes = round(
    Math.max(0, ...below92Episodes.map((episode) => episode.estimatedDurationMinutes)),
    policy.rounding.durationDecimals,
  );
  const hourlyBucketFields = [
    "sampleCount",
    "meanValue",
    "minValue",
    "maxValue",
    "estimatedCoverageMinutes",
    "below90ReadingCount",
    "below92ReadingCount",
  ] as const;
  const hourlyBuckets = buildHourlyBuckets(samples, policy, (bucketSamples, base) => [
    ...base,
    bucketSamples.filter((sample) => sample.value < policy.thresholds.below90Exclusive).length,
    bucketSamples.filter((sample) => sample.value < policy.thresholds.below92Exclusive).length,
  ]);
  const features = {
    below90ReadingCount,
    below90EpisodeCount: below90Episodes.length,
    below90EstimatedMinutes,
    longestBelow90EstimatedMinutes,
    below92ReadingCount,
    below92EpisodeCount: below92Episodes.length,
    below92EstimatedMinutes,
    longestBelow92EstimatedMinutes,
  };
  const facts: readonly JunctionTimeseriesDerivedFact[] = [
    {
      metric: "spo2-below-90-reading-count",
      unit: "count",
      value: below90ReadingCount,
    },
    {
      metric: "spo2-below-90-episode-count",
      unit: "count",
      value: below90Episodes.length,
    },
    {
      metric: "spo2-below-90-estimated-minutes",
      unit: "minutes",
      value: below90EstimatedMinutes,
    },
    {
      metric: "spo2-below-92-reading-count",
      unit: "count",
      value: below92ReadingCount,
    },
    {
      metric: "spo2-below-92-episode-count",
      unit: "count",
      value: below92Episodes.length,
    },
    {
      metric: "spo2-below-92-estimated-minutes",
      unit: "minutes",
      value: below92EstimatedMinutes,
    },
    {
      metric: "spo2-estimated-coverage-minutes",
      unit: "minutes",
      value: coverage.estimatedCoverageMinutes,
    },
    {
      metric: "spo2-observed-span-minutes",
      unit: "minutes",
      value: coverage.observedSpanMinutes,
    },
  ];

  assertDerivedFactBound(policy, facts);
  return {
    envelope: buildEnvelope({
      coverage,
      episodes: below92Episodes,
      features,
      hourlyBucketFields,
      hourlyBuckets,
      policy,
      sampleCount: samples.length,
    }),
    facts,
  };
}

function deriveStressEnvelope(
  samples: readonly JunctionPointWithSupport[],
  coverage: JunctionFeatureEnvelopeCoverage,
  policy: JunctionStressFidelityPolicy,
): {
  readonly envelope: JunctionTimeseriesFeatureEnvelope;
  readonly facts: readonly JunctionTimeseriesDerivedFact[];
} {
  const episodes = attachStressRecoveries(
    deriveEpisodes(
      samples,
      "elevated",
      (value) => value >= policy.thresholds.elevatedInclusive,
      policy,
      policy.thresholds.elevatedInclusive,
    ),
    samples,
    policy,
  );
  const elevatedEstimatedMinutes = round(
    episodes.reduce((sum, episode) => sum + episode.estimatedDurationMinutes, 0),
    policy.rounding.durationDecimals,
  );
  const longestElevatedEstimatedMinutes = round(
    Math.max(0, ...episodes.map((episode) => episode.estimatedDurationMinutes)),
    policy.rounding.durationDecimals,
  );
  const observedRecoveryLatencies = episodes.flatMap((episode) =>
    episode.observedRecoveryLatencyMinutes === undefined
      ? []
      : [episode.observedRecoveryLatencyMinutes]
  );
  const medianObservedRecoveryLatencyMinutes = median(observedRecoveryLatencies);
  const hourlyBucketFields = [
    "sampleCount",
    "meanValue",
    "minValue",
    "maxValue",
    "estimatedCoverageMinutes",
    "elevatedReadingCount",
    "recoveredReadingCount",
  ] as const;
  const hourlyBuckets = buildHourlyBuckets(samples, policy, (bucketSamples, base) => [
    ...base,
    bucketSamples.filter((sample) => sample.value >= policy.thresholds.elevatedInclusive).length,
    bucketSamples.filter((sample) => sample.value <= policy.thresholds.recoveredInclusive).length,
  ]);
  const peakLocalHour = resolvePeakLocalHour(hourlyBuckets);
  const eveningValues = samples
    .filter((sample) => sample.localMinute >= 18 * 60)
    .map((sample) => sample.value);
  const eveningAverage = average(eveningValues);
  const features = {
    elevatedEpisodeCount: episodes.length,
    elevatedEstimatedMinutes,
    longestElevatedEstimatedMinutes,
    peakLocalHour,
    ...(medianObservedRecoveryLatencyMinutes === undefined
      ? {}
      : {
          medianObservedRecoveryLatencyMinutes: round(
            medianObservedRecoveryLatencyMinutes,
            policy.rounding.durationDecimals,
          ),
        }),
    ...(eveningAverage === undefined
      ? {}
      : { eveningAverage: round(eveningAverage, policy.rounding.valueDecimals) }),
  };
  const facts: JunctionTimeseriesDerivedFact[] = [
    {
      metric: "stress-elevated-episode-count",
      unit: "count",
      value: episodes.length,
    },
    {
      metric: "stress-elevated-estimated-minutes",
      unit: "minutes",
      value: elevatedEstimatedMinutes,
    },
    {
      metric: "stress-longest-elevated-estimated-minutes",
      unit: "minutes",
      value: longestElevatedEstimatedMinutes,
    },
    {
      metric: "stress-peak-local-hour",
      unit: "hour",
      value: peakLocalHour,
    },
    {
      metric: "stress-estimated-coverage-minutes",
      unit: "minutes",
      value: coverage.estimatedCoverageMinutes,
    },
    {
      metric: "stress-observed-span-minutes",
      unit: "minutes",
      value: coverage.observedSpanMinutes,
    },
  ];
  if (medianObservedRecoveryLatencyMinutes !== undefined) {
    facts.push({
      metric: "stress-median-observed-recovery-latency-minutes",
      unit: "minutes",
      value: round(medianObservedRecoveryLatencyMinutes, policy.rounding.durationDecimals),
    });
  }
  if (eveningAverage !== undefined) {
    facts.push({
      metric: "stress-evening-average",
      unit: policy.unit,
      value: round(eveningAverage, policy.rounding.valueDecimals),
    });
  }

  assertDerivedFactBound(policy, facts);
  return {
    envelope: buildEnvelope({
      coverage,
      episodes,
      features,
      hourlyBucketFields,
      hourlyBuckets,
      policy,
      sampleCount: samples.length,
    }),
    facts,
  };
}

function assertDerivedFactBound(
  policy: JunctionDenseFidelityPolicy,
  facts: readonly JunctionTimeseriesDerivedFact[],
): void {
  if (facts.length > policy.maxDerivedFactCount) {
    throw new RangeError(
      `Junction ${policy.resource} produced ${facts.length} derived facts; maximum is ${policy.maxDerivedFactCount}.`,
    );
  }
}

function buildEnvelope(input: {
  coverage: JunctionFeatureEnvelopeCoverage;
  episodes: readonly JunctionEpisodeSummary[];
  features: Readonly<Record<string, number>>;
  hourlyBucketFields: readonly string[];
  hourlyBuckets: readonly (readonly (number | null)[] | null)[];
  policy: JunctionDenseFidelityPolicy;
  sampleCount: number;
}): JunctionTimeseriesFeatureEnvelope {
  const retainedEpisodes = retainEpisodes(input.episodes, input.policy);
  return {
    coverage: input.coverage,
    episodes: {
      fields: [
        "kind",
        "startLocalMinute",
        "endLocalMinute",
        "sampleCount",
        "estimatedDurationMinutes",
        "minValue",
        "maxValue",
        "meanValue",
        "observedRecoveryLatencyMinutes",
      ],
      retainedCount: retainedEpisodes.length,
      retained: retainedEpisodes.map((episode) => [
        episode.kind,
        round(episode.startLocalMinute, input.policy.rounding.durationDecimals),
        round(episode.endLocalMinute, input.policy.rounding.durationDecimals),
        episode.sampleCount,
        round(episode.estimatedDurationMinutes, input.policy.rounding.durationDecimals),
        round(episode.minValue, input.policy.rounding.valueDecimals),
        round(episode.maxValue, input.policy.rounding.valueDecimals),
        round(episode.meanValue, input.policy.rounding.valueDecimals),
        episode.observedRecoveryLatencyMinutes === undefined
          ? null
          : round(
              episode.observedRecoveryLatencyMinutes,
              input.policy.rounding.durationDecimals,
            ),
      ]),
      totalCount: input.episodes.length,
      truncatedCount: Math.max(0, input.episodes.length - retainedEpisodes.length),
    },
    features: input.features,
    hourlyBucketFields: input.hourlyBucketFields,
    hourlyBuckets: input.hourlyBuckets,
    policy: serializablePolicy(input.policy),
    policyVersion: input.policy.policyVersion,
    sampleCount: input.sampleCount,
    schema: "junction.timeseries_feature_envelope.v1",
    unit: input.policy.unit,
  };
}

function serializablePolicy(policy: JunctionDenseFidelityPolicy): Readonly<Record<string, unknown>> {
  return {
    identityVersion: policy.identityVersion,
    maxDerivedFactCount: policy.maxDerivedFactCount,
    maxRecordsPerResponse: policy.maxRecordsPerResponse,
    maxRecordsPerSourceDay: policy.maxRecordsPerSourceDay,
    localHourBucketCount: 24,
    sorting: policy.sorting,
    rounding: policy.rounding,
    coverage: policy.coverage,
    episodes: policy.episodes,
    ...(policy.resource === "glucose"
      ? { thresholds: policy.thresholds, overnightWindow: policy.overnightWindow }
      : policy.resource === "blood_oxygen"
        ? { thresholds: policy.thresholds }
        : { thresholds: policy.thresholds, recovery: policy.recovery }),
  };
}

function buildHourlyBuckets(
  samples: readonly JunctionPointWithSupport[],
  policy: JunctionDenseFidelityPolicy,
  extend: (
    samples: readonly JunctionPointWithSupport[],
    base: readonly (number | null)[],
  ) => readonly (number | null)[],
): readonly (readonly (number | null)[] | null)[] {
  const buckets: MutableHourlyBucket[] = Array.from({ length: 24 }, () => ({
    estimatedCoverageMinutes: 0,
    values: [],
  }));

  for (const sample of samples) {
    const hour = Math.min(23, Math.floor(sample.localMinute / 60));
    buckets[hour]?.values.push(sample.value);
    distributeCoverageToHours(
      buckets,
      sample.localMinute,
      sample.forwardSupportMinutes,
    );
  }

  return buckets.map((bucket, hour) => {
    if (bucket.values.length === 0 && bucket.estimatedCoverageMinutes === 0) {
      return null;
    }
    const meanValue = average(bucket.values);
    const base = [
      bucket.values.length,
      meanValue === undefined ? null : round(meanValue, policy.rounding.valueDecimals),
      bucket.values.length === 0 ? null : round(Math.min(...bucket.values), policy.rounding.valueDecimals),
      bucket.values.length === 0 ? null : round(Math.max(...bucket.values), policy.rounding.valueDecimals),
      round(bucket.estimatedCoverageMinutes, policy.rounding.durationDecimals),
    ] as const;
    return extend(
      samples.filter((sample) => Math.floor(sample.localMinute / 60) === hour),
      base,
    );
  });
}

function distributeCoverageToHours(
  buckets: MutableHourlyBucket[],
  startLocalMinute: number,
  supportMinutes: number,
): void {
  let cursor = startLocalMinute;
  let remaining = Math.min(supportMinutes, Math.max(0, 24 * 60 - startLocalMinute));
  while (remaining > 0) {
    const hour = Math.min(23, Math.floor(cursor / 60));
    const hourEnd = (hour + 1) * 60;
    const portion = Math.min(remaining, hourEnd - cursor);
    const bucket = buckets[hour];
    if (!bucket || portion <= 0) {
      break;
    }
    bucket.estimatedCoverageMinutes += portion;
    cursor += portion;
    remaining -= portion;
  }
}

function deriveEpisodes(
  samples: readonly JunctionPointWithSupport[],
  kind: JunctionEpisodeSummary["kind"],
  qualifies: (value: number) => boolean,
  policy: JunctionDenseFidelityPolicy,
  threshold: number,
): JunctionEpisodeSummary[] {
  const episodes: JunctionEpisodeSummary[] = [];
  let current: JunctionPointWithSupport[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const values = current.map((sample) => sample.value);
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) return;
    let estimatedDurationMinutes = 0;
    for (let index = 0; index < current.length - 1; index += 1) {
      const left = current[index];
      const right = current[index + 1];
      if (!left || !right) continue;
      estimatedDurationMinutes += Math.min(
        Math.max(0, (right.observedAtMs - left.observedAtMs) / 60_000),
        policy.coverage.gapCapMinutes,
      );
    }
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    episodes.push({
      endObservedAtMs: last.observedAtMs,
      endLocalMinute: last.localMinute,
      estimatedDurationMinutes: round(estimatedDurationMinutes, policy.rounding.durationDecimals),
      kind,
      maxValue,
      meanValue: average(values) ?? values[0] ?? 0,
      minValue,
      sampleCount: current.length,
      severity: kind === "low" ? threshold - minValue : maxValue - threshold,
      startLocalMinute: first.localMinute,
    });
    current = [];
  };

  for (const sample of samples) {
    if (!qualifies(sample.value)) {
      flush();
      continue;
    }
    const prior = current[current.length - 1];
    if (
      prior
      && (sample.observedAtMs - prior.observedAtMs) / 60_000 > policy.episodes.linkGapMinutes
    ) {
      flush();
    }
    current.push(sample);
  }
  flush();
  return episodes;
}

function attachStressRecoveries(
  episodes: readonly JunctionEpisodeSummary[],
  samples: readonly JunctionPointWithSupport[],
  policy: JunctionStressFidelityPolicy,
): JunctionEpisodeSummary[] {
  return episodes.map((episode) => {
    const episodeEnd = samples.find((sample) =>
      sample.observedAtMs === episode.endObservedAtMs
      && sample.value >= policy.thresholds.elevatedInclusive
    );
    if (!episodeEnd) return episode;
    const laterSamples = samples.filter((sample) => sample.observedAtMs > episodeEnd.observedAtMs);
    let prior = episodeEnd;
    for (const sample of laterSamples) {
      const adjacentGap = (sample.observedAtMs - prior.observedAtMs) / 60_000;
      const lookahead = (sample.observedAtMs - episodeEnd.observedAtMs) / 60_000;
      if (
        adjacentGap > policy.recovery.maxAdjacentObservationGapMinutes
        || lookahead > policy.recovery.maxLookaheadMinutes
      ) {
        break;
      }
      if (sample.value <= policy.thresholds.recoveredInclusive) {
        return {
          ...episode,
          observedRecoveryLatencyMinutes: round(
            lookahead,
            policy.rounding.durationDecimals,
          ),
        };
      }
      prior = sample;
    }
    return episode;
  });
}

function retainEpisodes(
  episodes: readonly JunctionEpisodeSummary[],
  policy: JunctionDenseFidelityPolicy,
): JunctionEpisodeSummary[] {
  const retained = [...episodes]
    .sort((left, right) =>
      right.estimatedDurationMinutes - left.estimatedDurationMinutes
      || right.sampleCount - left.sampleCount
      || right.severity - left.severity
      || left.startLocalMinute - right.startLocalMinute
      || left.kind.localeCompare(right.kind)
    )
    .slice(0, policy.episodes.maxRetained);
  return retained.sort((left, right) =>
    left.startLocalMinute - right.startLocalMinute
    || left.endLocalMinute - right.endLocalMinute
    || left.kind.localeCompare(right.kind)
  );
}

function resolvePeakLocalHour(
  hourlyBuckets: readonly (readonly (number | null)[] | null)[],
): number {
  let peakHour = 0;
  let peakMean = Number.NEGATIVE_INFINITY;
  hourlyBuckets.forEach((bucket, hour) => {
    const mean = bucket?.[1];
    if (typeof mean === "number" && mean > peakMean) {
      peakMean = mean;
      peakHour = hour;
    }
  });
  return peakHour;
}

function coefficientOfVariation(values: readonly number[]): number {
  const meanValue = average(values) ?? 0;
  if (meanValue === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / values.length;
  return (Math.sqrt(variance) / Math.abs(meanValue)) * 100;
}

function deriveObservedRateChange(
  samples: readonly JunctionTimeseriesFidelityPoint[],
  maxGapMinutes: number,
  decimals: number,
): {
  readonly maxFallRate?: number;
  readonly maxRiseRate?: number;
  readonly pairCount: number;
} {
  let maxFallRate: number | undefined;
  let maxRiseRate: number | undefined;
  let pairCount = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current) continue;
    const gapMinutes = (current.observedAtMs - previous.observedAtMs) / 60_000;
    if (gapMinutes <= 0 || gapMinutes > maxGapMinutes) continue;
    const rate = round((current.value - previous.value) / gapMinutes, decimals);
    pairCount += 1;
    if (rate > 0 && (maxRiseRate === undefined || rate > maxRiseRate)) {
      maxRiseRate = rate;
    }
    const fallRate = Math.abs(rate);
    if (rate < 0 && (maxFallRate === undefined || fallRate > maxFallRate)) {
      maxFallRate = fallRate;
    }
  }
  return { maxFallRate, maxRiseRate, pairCount };
}

function average(values: readonly number[]): number | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function percentage(numerator: number, denominator: number, decimals: number): number {
  return denominator === 0 ? 0 : round((numerator / denominator) * 100, decimals);
}

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}
