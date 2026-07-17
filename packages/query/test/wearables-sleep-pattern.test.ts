import assert from "node:assert/strict";

import { test } from "vitest";

import {
  summarizeWearableSleepPatternFromBundle,
  type WearableSleepNight,
  type WearableSourceHealth,
  type WearableSummaryBundle,
} from "../src/wearables.ts";
import type {
  WearableMetricCandidate,
  WearableMetricKey,
  WearableResolvedMetric,
  WearableSleepSessionType,
} from "../src/wearables/types.ts";
import { resolveMetric } from "../src/wearables/selection.ts";

function resolvedMetric(input: {
  candidateCount?: number;
  conflictingProviders?: string[];
  metric: WearableMetricKey;
  provider: string;
  recordedAt: string;
  sourceKind?: string;
  value?: number;
}): WearableResolvedMetric {
  if (input.value === undefined) {
    return resolveMetric(input.metric, []);
  }

  const candidate: WearableMetricCandidate = {
    candidateId: `${input.provider}:${input.metric}:${input.recordedAt}`,
    date: input.recordedAt.slice(0, 10),
    externalRef: null,
    metric: input.metric,
    occurredAt: input.recordedAt,
    paths: [],
    provider: input.provider,
    recordedAt: input.recordedAt,
    recordIds: [],
    sourceFamily: "event",
    sourceKind: input.sourceKind ?? "observation",
    title: `${input.provider} ${input.metric}`,
    unit: "minutes",
    value: input.value,
  };
  const resolved = resolveMetric(input.metric, [candidate], { metricFamily: "sleep" });
  return {
    ...resolved,
    confidence: {
      ...resolved.confidence,
      candidateCount: input.candidateCount ?? resolved.confidence.candidateCount,
      conflictingProviders: input.conflictingProviders ?? resolved.confidence.conflictingProviders,
    },
  };
}

function makeNight(input: {
  awakeMinutes?: number;
  candidateCount?: number;
  conflictingProviders?: string[];
  date: string;
  endAt: string;
  provider?: string;
  recordedAt?: string;
  sleepLatencyMinutes?: number;
  sleepType?: WearableSleepSessionType;
  startAt: string;
  timeZone?: string | null;
  totalSleepMinutes?: number;
}): WearableSleepNight {
  const provider = input.provider ?? "oura";
  const recordedAt = input.recordedAt ?? input.endAt;
  const durationMinutes = (Date.parse(input.endAt) - Date.parse(input.startAt)) / 60_000;
  const metric = (key: WearableMetricKey, value?: number) => resolvedMetric({
    metric: key,
    provider,
    recordedAt,
    value,
  });
  const sessionMinutes = resolvedMetric({
    candidateCount: input.candidateCount,
    conflictingProviders: input.conflictingProviders,
    metric: "sessionMinutes",
    provider,
    recordedAt,
    sourceKind: "sleep-window",
    value: durationMinutes,
  });

  return {
    averageHeartRate: metric("averageHeartRate"),
    awakeMinutes: metric("awakeMinutes", input.awakeMinutes),
    date: input.date,
    deepMinutes: metric("deepMinutes"),
    hrv: metric("hrv"),
    lightMinutes: metric("lightMinutes"),
    lowestHeartRate: metric("lowestHeartRate"),
    lowestSpo2: metric("lowestSpo2"),
    notes: [],
    provider,
    remMinutes: metric("remMinutes"),
    respiratoryRate: metric("respiratoryRate"),
    sessionMinutes,
    sleepConsistency: metric("sleepConsistency"),
    sleepEfficiency: metric("sleepEfficiency"),
    sleepEndAt: input.endAt,
    sleepLatencyMinutes: metric("sleepLatencyMinutes", input.sleepLatencyMinutes),
    sleepPerformance: metric("sleepPerformance"),
    sleepScore: metric("sleepScore"),
    sleepStartAt: input.startAt,
    sleepType: input.sleepType ?? "main_sleep",
    sleepWindowProvider: provider,
    spo2: metric("spo2"),
    summaryConfidence: {
      conflictingMetrics: [],
      level: input.conflictingProviders?.length ? "medium" : "high",
      lowConfidenceMetrics: [],
      notes: [],
      selectedProviders: [provider],
    },
    timeInBedMinutes: metric("timeInBedMinutes", durationMinutes),
    timeZone: input.timeZone === undefined ? "UTC" : input.timeZone,
    totalSleepMinutes: metric("totalSleepMinutes", input.totalSleepMinutes ?? durationMinutes),
  };
}

function makeSourceHealth(input: {
  lastSleepDate: string;
  provider: string;
  sleepStalenessVsNewestDays?: number;
}): WearableSourceHealth {
  return {
    activityDays: 0,
    bodyStateDays: 0,
    candidateMetrics: 1,
    conflictCount: 0,
    exactDuplicatesSuppressed: 0,
    firstDate: input.lastSleepDate,
    lastDate: input.lastSleepDate,
    lastSleepDate: input.lastSleepDate,
    latestRecordedAt: `${input.lastSleepDate}T08:00:00.000Z`,
    metricsContributed: ["sessionMinutes"],
    notes: [],
    provider: input.provider,
    providerDisplayName: input.provider,
    recoveryDays: 0,
    selectedMetrics: 1,
    sleepNights: 1,
    sleepStalenessVsNewestDays: input.sleepStalenessVsNewestDays ?? 0,
    stalenessVsNewestDays: input.sleepStalenessVsNewestDays ?? 0,
  };
}

function makeBundle(
  sleepNights: WearableSleepNight[],
  sourceHealth: WearableSourceHealth[] = [],
): WearableSummaryBundle {
  return {
    activityDays: [],
    bodyStateDays: [],
    recoveryDays: [],
    sleepNights,
    sourceHealth,
  };
}

test("sleep patterns use elapsed instants across DST while preserving local bedtime and wake time", () => {
  const spring = summarizeWearableSleepPatternFromBundle(makeBundle([
    makeNight({
      date: "2026-03-08",
      startAt: "2026-03-08T04:30:00.000Z",
      endAt: "2026-03-08T11:30:00.000Z",
      timeZone: "America/New_York",
    }),
  ]), {
    date: "2026-03-08",
    now: "2026-03-09T12:00:00.000Z",
  });
  const fall = summarizeWearableSleepPatternFromBundle(makeBundle([
    makeNight({
      date: "2026-11-01",
      startAt: "2026-11-01T03:30:00.000Z",
      endAt: "2026-11-01T12:30:00.000Z",
      timeZone: "America/New_York",
    }),
  ]), {
    date: "2026-11-01",
    now: "2026-11-02T12:00:00.000Z",
  });

  assert.equal(spring.sessionDurationMinutes.median, 420);
  assert.equal(spring.bedtime.medianLocalTime, "23:30");
  assert.equal(spring.wakeTime.medianLocalTime, "07:30");
  assert.equal(fall.sessionDurationMinutes.median, 540);
  assert.equal(fall.bedtime.medianLocalTime, "23:30");
  assert.equal(fall.wakeTime.medianLocalTime, "07:30");
});

test("sleep patterns combine per-night canonical local zones explicitly and unwrap midnight clock values", () => {
  const nights = [
    makeNight({
      date: "2026-07-09",
      startAt: "2026-07-08T23:50:00.000Z",
      endAt: "2026-07-09T07:50:00.000Z",
      provider: "oura",
      timeZone: "UTC",
    }),
    makeNight({
      date: "2026-07-10",
      startAt: "2026-07-10T04:10:00.000Z",
      endAt: "2026-07-10T12:10:00.000Z",
      provider: "whoop",
      timeZone: "America/New_York",
    }),
    makeNight({
      date: "2026-07-11",
      startAt: "2026-07-10T16:00:00.000Z",
      endAt: "2026-07-11T00:00:00.000Z",
      provider: "oura",
      timeZone: "Asia/Tokyo",
    }),
    makeNight({
      date: "2026-07-12",
      startAt: "2026-07-11T16:00:00.000Z",
      endAt: "2026-07-12T00:00:00.000Z",
      provider: "whoop",
      timeZone: "Asia/Tokyo",
    }),
  ];
  const summary = summarizeWearableSleepPatternFromBundle(makeBundle(nights), {
    from: "2026-07-09",
    now: "2026-07-13T12:00:00.000Z",
    to: "2026-07-12",
  });

  assert.equal(summary.providerMix, true);
  assert.equal(summary.reportingTimeZoneSource, "canonical");
  assert.deepEqual(summary.timeZones, ["America/New_York", "Asia/Tokyo", "UTC"]);
  assert.equal(summary.timingTimeZoneMode, "per_night_canonical_with_reporting_fallback");
  assert.ok((summary.bedtime.standardDeviationMinutes ?? 1_000) < 40);
  assert.equal(summary.weekdayWeekendMidpointSampleCounts.weekday, 2);
  assert.equal(summary.weekdayWeekendMidpointSampleCounts.weekend, 2);
  assert.notEqual(summary.weekdayWeekendMidpointDriftMinutes, null);
  assert.equal(summary.notes.some((note) => note.includes("multiple time zones")), true);
});

test("sleep-pattern clock medians average an even pair across midnight", () => {
  const summary = summarizeWearableSleepPatternFromBundle(makeBundle([
    makeNight({
      date: "2026-07-09",
      endAt: "2026-07-09T07:50:00.000Z",
      startAt: "2026-07-08T23:50:00.000Z",
    }),
    makeNight({
      date: "2026-07-10",
      endAt: "2026-07-10T08:10:00.000Z",
      startAt: "2026-07-10T00:10:00.000Z",
    }),
  ]), {
    from: "2026-07-09",
    now: "2026-07-11T12:00:00.000Z",
    to: "2026-07-10",
  });

  assert.equal(summary.bedtime.medianLocalTime, "00:00");
  assert.equal(summary.bedtime.medianLocalMinutes, 0);
});

test("sleep-pattern timing distinguishes explicit fallbacks from omitted clock statistics", () => {
  const withoutFallback = summarizeWearableSleepPatternFromBundle(makeBundle([
    makeNight({
      date: "2026-07-10",
      endAt: "2026-07-10T07:00:00.000Z",
      startAt: "2026-07-09T23:00:00.000Z",
      timeZone: null,
    }),
  ]), {
    date: "2026-07-10",
    now: "2026-07-11T12:00:00.000Z",
  });
  const withFallback = summarizeWearableSleepPatternFromBundle(makeBundle([
    makeNight({
      date: "2026-07-10",
      endAt: "2026-07-10T07:00:00.000Z",
      startAt: "2026-07-09T23:00:00.000Z",
      timeZone: null,
    }),
  ]), {
    date: "2026-07-10",
    now: "2026-07-11T12:00:00.000Z",
    timeZone: "America/New_York",
  });

  assert.equal(withoutFallback.reportingTimeZoneFallbackNightCount, 0);
  assert.equal(withoutFallback.reportingTimeZone, null);
  assert.equal(withoutFallback.reportingTimeZoneSource, "none");
  assert.equal(withoutFallback.timingOmittedNightCount, 1);
  assert.equal(withoutFallback.bedtime.count, 0);
  assert.equal(withoutFallback.notes.some((note) => note.includes("clock timing was omitted")), true);
  assert.equal(withoutFallback.notes.some((note) => note.includes("freshness calendar boundaries use UTC")), true);
  assert.equal(withFallback.reportingTimeZoneFallbackNightCount, 1);
  assert.equal(withFallback.reportingTimeZoneSource, "user_filter");
  assert.equal(withFallback.timingOmittedNightCount, 0);
  assert.equal(withFallback.bedtime.count, 1);
  assert.equal(withFallback.notes.some((note) => note.includes("reporting-zone fallback")), true);
});

test("sleep patterns derive the canonical reporting zone only from a completed non-nap session", () => {
  const summary = summarizeWearableSleepPatternFromBundle(makeBundle([
    makeNight({
      date: "2026-07-10",
      endAt: "2026-07-10T18:00:00.000Z",
      sleepType: "nap",
      startAt: "2026-07-10T17:00:00.000Z",
      timeZone: "Asia/Tokyo",
    }),
    makeNight({
      date: "2026-07-12",
      endAt: "2026-07-12T11:00:00.000Z",
      startAt: "2026-07-12T03:00:00.000Z",
      timeZone: "Europe/London",
    }),
    makeNight({
      date: "2026-07-10",
      endAt: "2026-07-10T11:00:00.000Z",
      startAt: "2026-07-10T03:00:00.000Z",
      timeZone: "America/New_York",
    }),
  ]), {
    date: "2026-07-10",
    now: "2026-07-11T12:00:00.000Z",
  });

  assert.equal(summary.reportingTimeZone, "America/New_York");
  assert.equal(summary.reportingTimeZoneSource, "canonical");
});

test("sleep patterns exclude explicit nap-only dates and never infer identity from presentation text", () => {
  const nap = makeNight({
    date: "2026-07-10",
    startAt: "2026-07-10T17:00:00.000Z",
    endAt: "2026-07-10T18:00:00.000Z",
    sleepType: "nap",
  });
  nap.sessionMinutes.selection.title = "Ordinary sleep";
  const unknown = makeNight({
    date: "2026-07-11",
    startAt: "2026-07-10T23:00:00.000Z",
    endAt: "2026-07-11T07:00:00.000Z",
    sleepType: "unknown",
  });
  unknown.sessionMinutes.selection.title = "Nap according to an old title";

  const summary = summarizeWearableSleepPatternFromBundle(makeBundle([nap, unknown]), {
    from: "2026-07-10",
    now: "2026-07-12T12:00:00.000Z",
    to: "2026-07-11",
  });

  assert.equal(summary.excludedNapOnlyDateCount, 1);
  assert.equal(summary.validNightCount, 1);
  assert.equal(summary.unknownSleepTypeNightCount, 1);
  assert.equal(summary.notes.some((note) => note.includes("titles were not used to guess")), true);
});

test("sleep patterns report wearable missingness, sparse evidence, and imported latency independently", () => {
  const summary = summarizeWearableSleepPatternFromBundle(makeBundle([
    makeNight({
      awakeMinutes: 35,
      date: "2026-07-08",
      endAt: "2026-07-08T07:00:00.000Z",
      provider: "oura",
      sleepLatencyMinutes: 18,
      startAt: "2026-07-07T23:00:00.000Z",
    }),
    makeNight({
      date: "2026-07-10",
      endAt: "2026-07-10T07:30:00.000Z",
      provider: "whoop",
      startAt: "2026-07-09T23:30:00.000Z",
    }),
  ]), {
    from: "2026-07-08",
    now: "2026-07-11T12:00:00.000Z",
    to: "2026-07-10",
  });

  assert.equal(summary.expectedNightCount, 3);
  assert.equal(summary.validNightCount, 2);
  assert.equal(summary.missingNightCount, 1);
  assert.equal(summary.coveragePercent, 66.7);
  assert.equal(summary.providerMix, true);
  assert.equal(summary.bedtime.standardDeviationMinutes, null);
  assert.equal(summary.sleepLatencyMinutes.count, 1);
  assert.equal(summary.sleepLatencyMinutes.median, 18);
  assert.equal(summary.awakeMinutes.count, 1);
  assert.equal(summary.notes.some((note) => note.includes("not relabeled as WASO")), true);
  assert.equal(summary.notes.some((note) => note.includes("do not mean the user did not sleep")), true);
});

test("sleep patterns use sleep-specific absolute and relative source freshness even when data arrived late", () => {
  const summary = summarizeWearableSleepPatternFromBundle(makeBundle([
    makeNight({
      date: "2026-07-03",
      endAt: "2026-07-03T07:00:00.000Z",
      provider: "whoop",
      recordedAt: "2026-07-10T12:00:00.000Z",
      startAt: "2026-07-02T23:00:00.000Z",
    }),
  ], [
    makeSourceHealth({
      lastSleepDate: "2026-07-01",
      provider: "oura",
      sleepStalenessVsNewestDays: 2,
    }),
    makeSourceHealth({
      lastSleepDate: "2026-07-03",
      provider: "whoop",
      sleepStalenessVsNewestDays: 0,
    }),
  ]), {
    date: "2026-07-03",
    now: "2026-07-16T12:00:00.000Z",
  });

  assert.equal(summary.allSourcesStale, true);
  assert.equal(summary.latestNightAgeDays, 13);
  assert.equal(summary.latestRecordedAt, "2026-07-10T12:00:00.000Z");
  assert.equal(summary.latestSleepEndAt, "2026-07-03T07:00:00.000Z");
  assert.equal(summary.lateArrivingNightCount, 1);
  assert.deepEqual(summary.sourceFreshness, [
    {
      lastSleepEvidenceDate: "2026-07-03",
      provider: "whoop",
      stalenessVsNewestDays: 0,
      stalenessVsNowDays: 13,
    },
    {
      lastSleepEvidenceDate: "2026-07-01",
      provider: "oura",
      stalenessVsNewestDays: 2,
      stalenessVsNowDays: 15,
    },
  ]);
});

test("sleep patterns exclude future-dated source freshness instead of letting it mask stale evidence", () => {
  const summary = summarizeWearableSleepPatternFromBundle(makeBundle([
    makeNight({
      date: "2026-07-01",
      endAt: "2026-07-01T07:00:00.000Z",
      provider: "whoop",
      startAt: "2026-06-30T23:00:00.000Z",
    }),
  ], [
    makeSourceHealth({
      lastSleepDate: "2026-07-20",
      provider: "oura",
      sleepStalenessVsNewestDays: 0,
    }),
    makeSourceHealth({
      lastSleepDate: "2026-07-01",
      provider: "whoop",
      sleepStalenessVsNewestDays: 19,
    }),
  ]), {
    date: "2026-07-01",
    now: "2026-07-16T12:00:00.000Z",
  });

  assert.deepEqual(summary.sourceFreshness, [{
    lastSleepEvidenceDate: "2026-07-01",
    provider: "whoop",
    stalenessVsNewestDays: 0,
    stalenessVsNowDays: 15,
  }]);
  assert.equal(summary.allSourcesStale, true);
  assert.equal(summary.notes.some((note) => note.includes("dated after the as-of date")), true);
});

test("sleep patterns collapse cross-date duplicate windows and suppress non-identical overlaps", () => {
  const exactEarlier = makeNight({
    date: "2026-07-09",
    endAt: "2026-07-10T07:00:00.000Z",
    recordedAt: "2026-07-10T08:00:00.000Z",
    startAt: "2026-07-09T23:00:00.000Z",
  });
  const exactLater = makeNight({
    date: "2026-07-10",
    endAt: "2026-07-10T07:01:00.000Z",
    recordedAt: "2026-07-11T08:00:00.000Z",
    startAt: "2026-07-09T23:01:00.000Z",
  });
  const overlap = makeNight({
    date: "2026-07-11",
    endAt: "2026-07-10T08:00:00.000Z",
    recordedAt: "2026-07-10T09:00:00.000Z",
    startAt: "2026-07-10T00:00:00.000Z",
  });
  const summary = summarizeWearableSleepPatternFromBundle(makeBundle([
    exactEarlier,
    exactLater,
    overlap,
  ]), {
    from: "2026-07-09",
    now: "2026-07-12T12:00:00.000Z",
    to: "2026-07-11",
  });

  assert.equal(summary.validNightCount, 1);
  assert.ok(summary.suppressedExactDuplicateCount >= 1);
  assert.equal(summary.overlappingNightCount, 1);
  assert.equal(summary.notes.some((note) => note.includes("instead of averaging both")), true);
});

test("sleep patterns retain a pairwise non-overlapping set when one preferred window bridges two split windows", () => {
  const firstSplit = makeNight({
    date: "2026-07-10",
    endAt: "2026-07-10T02:00:00.000Z",
    startAt: "2026-07-09T22:00:00.000Z",
  });
  const secondSplit = makeNight({
    date: "2026-07-10",
    endAt: "2026-07-10T06:00:00.000Z",
    startAt: "2026-07-10T02:00:00.000Z",
  });
  const preferredLongWindow = makeNight({
    date: "2026-07-10",
    endAt: "2026-07-10T05:00:00.000Z",
    startAt: "2026-07-09T23:00:00.000Z",
  });

  const summary = summarizeWearableSleepPatternFromBundle(makeBundle([
    firstSplit,
    secondSplit,
    preferredLongWindow,
  ]), {
    date: "2026-07-10",
    now: "2026-07-11T12:00:00.000Z",
  });
  const reversed = summarizeWearableSleepPatternFromBundle(makeBundle([
    preferredLongWindow,
    secondSplit,
    firstSplit,
  ]), {
    date: "2026-07-10",
    now: "2026-07-11T12:00:00.000Z",
  });

  assert.equal(summary.validNightCount, 1);
  assert.equal(summary.sessionDurationMinutes.median, 360);
  assert.equal(summary.overlappingNightCount, 2);
  assert.deepEqual(reversed, summary);
});

test("sleep patterns weight one deterministic representative per analysis date", () => {
  const shorterSession = makeNight({
    date: "2026-07-10",
    endAt: "2026-07-10T18:00:00.000Z",
    startAt: "2026-07-10T16:00:00.000Z",
  });
  const mainOvernightSession = makeNight({
    date: "2026-07-10",
    endAt: "2026-07-10T07:00:00.000Z",
    startAt: "2026-07-09T23:00:00.000Z",
  });
  const filters = {
    date: "2026-07-10",
    now: "2026-07-11T12:00:00.000Z",
  };

  const summary = summarizeWearableSleepPatternFromBundle(
    makeBundle([shorterSession, mainOvernightSession]),
    filters,
  );
  const reversed = summarizeWearableSleepPatternFromBundle(
    makeBundle([mainOvernightSession, shorterSession]),
    filters,
  );

  assert.equal(summary.validNightCount, 1);
  assert.equal(summary.sameDateSessionSuppressedCount, 1);
  assert.equal(summary.sessionDurationMinutes.count, 1);
  assert.equal(summary.sessionDurationMinutes.median, 480);
  assert.equal(summary.notes.some((note) => note.includes("weight each date once")), true);
  assert.deepEqual(reversed, summary);
});

test("sleep-pattern exclusion and suppression counts are scoped to the resolved analysis window", () => {
  const outsideNap = makeNight({
    date: "2026-05-01",
    endAt: "2026-05-01T18:00:00.000Z",
    sleepType: "nap",
    startAt: "2026-05-01T17:00:00.000Z",
  });
  const outsideDuplicateA = makeNight({
    date: "2026-05-02",
    endAt: "2026-05-02T07:00:00.000Z",
    startAt: "2026-05-01T23:00:00.000Z",
  });
  const outsideDuplicateB = makeNight({
    date: "2026-05-02",
    endAt: "2026-05-02T07:01:00.000Z",
    startAt: "2026-05-01T23:01:00.000Z",
  });
  const outsideOverlap = makeNight({
    date: "2026-05-02",
    endAt: "2026-05-02T08:00:00.000Z",
    startAt: "2026-05-02T00:00:00.000Z",
  });
  const inWindow = makeNight({
    date: "2026-07-10",
    endAt: "2026-07-10T07:00:00.000Z",
    startAt: "2026-07-09T23:00:00.000Z",
  });

  const summary = summarizeWearableSleepPatternFromBundle(makeBundle([
    outsideNap,
    outsideDuplicateA,
    outsideDuplicateB,
    outsideOverlap,
    inWindow,
  ], [{
    ...makeSourceHealth({ lastSleepDate: "2026-07-10", provider: "oura" }),
    exactDuplicatesSuppressed: 99,
  }]), {
    date: "2026-07-10",
    now: "2026-07-11T12:00:00.000Z",
  });

  assert.equal(summary.from, "2026-07-10");
  assert.equal(summary.to, "2026-07-10");
  assert.equal(summary.excludedNapOnlyDateCount, 0);
  assert.equal(summary.suppressedExactDuplicateCount, 0);
  assert.equal(summary.overlappingNightCount, 0);
  assert.equal(summary.notes.some((note) => note.includes("Excluded")), false);
  assert.equal(summary.notes.some((note) => note.includes("overlapping sleep window")), false);
});

test("sleep patterns keep the default window anchored to now when the latest sleep is five days stale", () => {
  const summary = summarizeWearableSleepPatternFromBundle(makeBundle([
    makeNight({
      date: "2026-07-11",
      endAt: "2026-07-11T07:00:00.000Z",
      startAt: "2026-07-10T23:00:00.000Z",
    }),
  ], [makeSourceHealth({ lastSleepDate: "2026-07-11", provider: "oura" })]), {
    now: "2026-07-16T12:00:00.000Z",
  });

  assert.equal(summary.to, "2026-07-16");
  assert.equal(summary.from, "2026-06-19");
  assert.equal(summary.expectedNightCount, 28);
  assert.equal(summary.validNightCount, 1);
  assert.equal(summary.missingNightCount, 27);
  assert.equal(summary.latestNightAgeDays, 5);
  assert.equal(summary.allSourcesStale, true);
});

test("sleep patterns cap an explicit future end date at the as-of date", () => {
  const summary = summarizeWearableSleepPatternFromBundle(makeBundle([
    makeNight({
      date: "2026-07-10",
      endAt: "2026-07-10T07:00:00.000Z",
      startAt: "2026-07-09T23:00:00.000Z",
    }),
  ]), {
    from: "2026-07-10",
    now: "2026-07-12T12:00:00.000Z",
    timeZone: "UTC",
    to: "2026-07-20",
  });

  assert.equal(summary.to, "2026-07-12");
  assert.equal(summary.expectedNightCount, 3);
  assert.equal(summary.validNightCount, 1);
  assert.equal(summary.missingNightCount, 2);
  assert.equal(summary.notes.some((note) => note.includes("stop at the as-of date")), true);
});
