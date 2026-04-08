import assert from "node:assert/strict";

import { test } from "vitest";

import {
  compareMetricCandidateByDateDesc,
  compareSleepWindowByDateDesc,
  resolveMetric,
  resolveSleepWindowSelection,
  withSleepFallback,
} from "../src/wearables/selection.ts";
import {
  compareIsoDesc,
  daysBetweenIsoDates,
  isIsoTimestampNewer,
  latestIsoTimestamp,
} from "../src/wearables/shared.ts";
import type {
  WearableExternalRef,
  WearableMetricCandidate,
  WearableSleepWindowCandidate,
} from "../src/wearables/types.ts";

function makeExternalRef(overrides: Partial<WearableExternalRef> = {}): WearableExternalRef {
  return {
    facet: null,
    resourceId: null,
    resourceType: null,
    system: null,
    version: null,
    ...overrides,
  };
}

function makeMetricCandidate(
  overrides: Partial<WearableMetricCandidate> & Pick<
    WearableMetricCandidate,
    "candidateId" | "date" | "metric" | "provider" | "sourceFamily" | "sourceKind" | "unit" | "value"
  >,
): WearableMetricCandidate {
  return {
    candidateId: overrides.candidateId,
    date: overrides.date,
    externalRef: overrides.externalRef ?? null,
    metric: overrides.metric,
    occurredAt: overrides.occurredAt ?? null,
    paths: overrides.paths ?? [`/virtual/${overrides.candidateId}.jsonl`],
    provider: overrides.provider,
    recordedAt: overrides.recordedAt ?? null,
    recordIds: overrides.recordIds ?? [overrides.candidateId],
    sourceFamily: overrides.sourceFamily,
    sourceKind: overrides.sourceKind,
    title: overrides.title ?? null,
    unit: overrides.unit,
    value: overrides.value,
  };
}

function makeSleepWindowCandidate(
  overrides: Partial<WearableSleepWindowCandidate> & Pick<
    WearableSleepWindowCandidate,
    "candidateId" | "date" | "durationMinutes" | "provider" | "sourceFamily" | "sourceKind" | "nap"
  >,
): WearableSleepWindowCandidate {
  return {
    candidateId: overrides.candidateId,
    date: overrides.date,
    durationMinutes: overrides.durationMinutes,
    endAt: overrides.endAt ?? null,
    nap: overrides.nap,
    occurredAt: overrides.occurredAt ?? null,
    paths: overrides.paths ?? [`/virtual/${overrides.candidateId}.jsonl`],
    provider: overrides.provider,
    recordedAt: overrides.recordedAt ?? null,
    recordIds: overrides.recordIds ?? [overrides.candidateId],
    sourceFamily: overrides.sourceFamily,
    sourceKind: overrides.sourceKind,
    startAt: overrides.startAt ?? null,
    title: overrides.title ?? null,
  };
}

test("shared helpers cover null, timestamp, and invalid-date branches deterministically", () => {
  assert.equal(compareIsoDesc(null, "2026-04-01T00:00:00Z") > 0, true);
  assert.equal(compareIsoDesc("2026-04-02T00:00:00Z", null) < 0, true);
  assert.equal(latestIsoTimestamp([null, undefined, "2026-04-02T00:00:00Z", "2026-04-01T00:00:00Z"]), "2026-04-02T00:00:00Z");

  assert.equal(isIsoTimestampNewer(null, "2026-04-01T00:00:00Z"), false);
  assert.equal(isIsoTimestampNewer("2026-04-02T00:00:00Z", null), true);
  assert.equal(isIsoTimestampNewer("2026-04-02T00:00:00Z", "2026-04-01T00:00:00Z"), true);
  assert.equal(isIsoTimestampNewer("2026-04-01T00:00:00Z", "2026-04-02T00:00:00Z"), false);

  assert.equal(daysBetweenIsoDates("2026-04-01", "2026-04-04"), 3);
  assert.equal(daysBetweenIsoDates("invalid-date", "2026-04-04"), 0);
});

test("selection helpers cover direct, fallback, agreement, conflict, and tie-break branches", () => {
  const soloMetric = makeMetricCandidate({
    candidateId: "alpha:steps:solo",
    date: "2026-04-03",
    externalRef: makeExternalRef({
      resourceId: "steps-solo",
      resourceType: "activity_session",
      system: "alpha",
    }),
    metric: "steps",
    occurredAt: "2026-04-03T08:00:00Z",
    paths: ["solo.jsonl"],
    provider: "alpha",
    recordedAt: "2026-04-03T08:02:00Z",
    recordIds: ["evt_solo"],
    sourceFamily: "event",
    sourceKind: "steps",
    title: "Alpha steps",
    unit: "count",
    value: 900,
  });
  const soloResolved = resolveMetric("steps", [soloMetric], { metricFamily: "activity" });
  assert.equal(soloResolved.selection.provider, "alpha");
  assert.equal(soloResolved.confidence.level, "high");
  assert.equal(
    soloResolved.confidence.reasons[0]?.includes("because it scored highest (provider +"),
    true,
  );
  assert.equal(
    soloResolved.confidence.reasons[0]?.includes("ahead of"),
    false,
  );

  const fallbackMetric = resolveMetric("totalSleepMinutes", [], { metricFamily: "sleep" });
  const fallbackSource = resolveMetric(
    "sessionMinutes",
    [
      makeMetricCandidate({
        candidateId: "oura:sleep:window",
        date: "2026-04-03",
        externalRef: makeExternalRef({
          resourceId: "sleep-window",
          resourceType: "sleep_session",
          system: "oura",
        }),
        metric: "sessionMinutes",
        occurredAt: "2026-04-03T22:00:00Z",
        paths: ["sleep-window.jsonl"],
        provider: "oura",
        recordedAt: "2026-04-04T06:00:00Z",
        recordIds: ["evt_sleep_window"],
        sourceFamily: "event",
        sourceKind: "sleep_session",
        title: "Oura sleep window",
        unit: "minutes",
        value: 450,
      }),
    ],
    { metricFamily: "sleep" },
  );
  const liftedFallback = withSleepFallback(
    fallbackMetric,
    fallbackSource,
    "Used the selected sleep session duration because no direct total-sleep metric was available.",
  );
  assert.equal(liftedFallback.selection.resolution, "fallback");
  assert.equal(liftedFallback.selection.fallbackFromMetric, "sessionMinutes");
  assert.equal(
    withSleepFallback(
      fallbackSource,
      fallbackSource,
      "Used the selected sleep session duration because no direct total-sleep metric was available.",
    ),
    fallbackSource,
  );

  const mixedAgreementMetric = resolveMetric(
    "steps",
    [
      makeMetricCandidate({
        candidateId: "alpha:steps:selected",
        date: "2026-04-03",
        externalRef: makeExternalRef({
          resourceId: "steps-selected",
          resourceType: "activity_session",
          system: "alpha",
        }),
        metric: "steps",
        occurredAt: "2026-04-03T08:00:00Z",
        paths: ["selected.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-03T08:05:00Z",
        recordIds: ["evt_selected"],
        sourceFamily: "event",
        sourceKind: "steps",
        title: "Alpha steps",
        unit: "count",
        value: 2000,
      }),
      makeMetricCandidate({
        candidateId: "beta:steps:agree",
        date: "2026-04-03",
        externalRef: makeExternalRef({
          resourceId: "steps-agree",
          resourceType: "summary",
          system: "beta",
        }),
        metric: "steps",
        occurredAt: "2026-04-03T08:12:00Z",
        paths: ["agree.jsonl"],
        provider: "beta",
        recordedAt: "2026-04-03T08:14:00Z",
        recordIds: ["evt_agree"],
        sourceFamily: "sample",
        sourceKind: "steps",
        title: "Beta steps",
        unit: "count",
        value: 1080,
      }),
      makeMetricCandidate({
        candidateId: "whoop:steps:conflict",
        date: "2026-04-03",
        externalRef: makeExternalRef({
          resourceId: "steps-conflict",
          resourceType: "summary",
          system: "whoop",
        }),
        metric: "steps",
        occurredAt: "2026-04-03T08:20:00Z",
        paths: ["conflict.jsonl"],
        provider: "whoop",
        recordedAt: "2026-04-03T08:22:00Z",
        recordIds: ["evt_conflict"],
        sourceFamily: "derived",
        sourceKind: "steps",
        title: "WHOOP steps",
        unit: "count",
        value: 1000,
      }),
    ],
    { metricFamily: "activity" },
  );
  assert.equal(mixedAgreementMetric.selection.provider, "whoop");
  assert.equal(mixedAgreementMetric.confidence.level, "medium");
  assert.deepEqual(mixedAgreementMetric.confidence.conflictingProviders, ["alpha"]);
  assert.equal(
    mixedAgreementMetric.confidence.reasons.some((reason) =>
      reason.includes("Providers agreed within tolerance:") &&
      reason.includes("beta") &&
      reason.includes("WHOOP"),
    ),
    true,
  );
  assert.equal(
    mixedAgreementMetric.confidence.reasons.some((reason) =>
      reason.includes("Conflicting values remained from alpha."),
    ),
    true,
  );

  const earlierMetric = makeMetricCandidate({
    candidateId: "alpha:steps:earlier",
    date: "2026-04-02",
    metric: "steps",
    occurredAt: "2026-04-02T08:00:00Z",
    paths: ["earlier.jsonl"],
    provider: "alpha",
    recordedAt: "2026-04-02T08:01:00Z",
    recordIds: ["evt_earlier"],
    sourceFamily: "event",
    sourceKind: "steps",
    title: "Earlier alpha steps",
    unit: "count",
    value: 750,
  });
  const laterMetric = {
    ...earlierMetric,
    candidateId: "alpha:steps:later",
    date: "2026-04-03",
    recordedAt: "2026-04-03T08:01:00Z",
    recordIds: ["evt_later"],
    value: 760,
  };
  const sameDayMetric = {
    ...earlierMetric,
    candidateId: "beta:steps:same-day",
    provider: "beta",
    value: 760,
  } satisfies WearableMetricCandidate;
  assert.equal(compareMetricCandidateByDateDesc(laterMetric, earlierMetric) < 0, true);
  assert.equal(compareMetricCandidateByDateDesc(earlierMetric, sameDayMetric) < 0, true);
  assert.equal(
    compareMetricCandidateByDateDesc(
      { ...earlierMetric, candidateId: "alpha:steps:a" },
      { ...earlierMetric, candidateId: "alpha:steps:b" },
    ) < 0,
    true,
  );

  const earlierSleepWindow = makeSleepWindowCandidate({
    candidateId: "alpha:sleep:earlier",
    date: "2026-04-02",
    durationMinutes: 480,
    endAt: "2026-04-03T06:00:00Z",
    nap: false,
    occurredAt: "2026-04-02T22:00:00Z",
    paths: ["sleep-earlier.jsonl"],
    provider: "alpha",
    recordedAt: "2026-04-03T06:01:00Z",
    recordIds: ["evt_sleep_earlier"],
    sourceFamily: "event",
    sourceKind: "sleep_session",
    startAt: "2026-04-02T22:00:00Z",
    title: "Alpha sleep",
  });
  const laterSleepWindow = {
    ...earlierSleepWindow,
    candidateId: "alpha:sleep:later",
    date: "2026-04-03",
    recordedAt: "2026-04-03T06:06:00Z",
    recordIds: ["evt_sleep_later"],
  } satisfies WearableSleepWindowCandidate;
  const sameTimestampSleepWindow = {
    ...earlierSleepWindow,
    candidateId: "alpha:sleep:same-timestamp",
  } satisfies WearableSleepWindowCandidate;
  const sameTimestampSleepWindowOther = {
    ...earlierSleepWindow,
    candidateId: "alpha:sleep:zzz",
  } satisfies WearableSleepWindowCandidate;
  assert.equal(compareSleepWindowByDateDesc(laterSleepWindow, earlierSleepWindow) < 0, true);
  assert.equal(compareSleepWindowByDateDesc(earlierSleepWindow, laterSleepWindow) > 0, true);
  assert.equal(
    compareSleepWindowByDateDesc(sameTimestampSleepWindow, sameTimestampSleepWindowOther) < 0,
    true,
  );

  const resourceTieMetric = resolveMetric(
    "steps",
    [
      makeMetricCandidate({
        candidateId: "alpha:steps:resource-low",
        date: "2026-04-04",
        externalRef: null,
        metric: "steps",
        occurredAt: "2026-04-04T08:00:00Z",
        paths: ["resource-low.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-04T08:15:00Z",
        recordIds: ["evt_resource_low"],
        sourceFamily: "event",
        sourceKind: "steps",
        title: "Alpha event steps",
        unit: "count",
        value: 600,
      }),
      makeMetricCandidate({
        candidateId: "alpha:steps:resource-high",
        date: "2026-04-04",
        externalRef: makeExternalRef({
          resourceId: "resource-high",
          resourceType: "mystery",
          system: "alpha",
        }),
        metric: "steps",
        occurredAt: "2026-04-04T08:00:00Z",
        paths: ["resource-high.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-04T08:15:00Z",
        recordIds: ["evt_resource_high"],
        sourceFamily: "sample",
        sourceKind: "steps",
        title: "Alpha sample steps",
        unit: "count",
        value: 600,
      }),
    ],
    { metricFamily: "activity" },
  );
  assert.equal(resourceTieMetric.selection.title, "Alpha sample steps");

  const recencyTieMetric = resolveMetric(
    "steps",
    [
      makeMetricCandidate({
        candidateId: "alpha:steps:recency-old",
        date: "2026-04-05",
        externalRef: null,
        metric: "steps",
        occurredAt: "2026-04-05T07:50:00Z",
        paths: ["recency-old.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-05T07:55:00Z",
        recordIds: ["evt_recency_old"],
        sourceFamily: "event",
        sourceKind: "steps",
        title: "Alpha older event steps",
        unit: "count",
        value: 600,
      }),
      makeMetricCandidate({
        candidateId: "alpha:steps:recency-new",
        date: "2026-04-05",
        externalRef: null,
        metric: "steps",
        occurredAt: "2026-04-05T08:00:00Z",
        paths: ["recency-new.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-05T08:05:00Z",
        recordIds: ["evt_recency_new"],
        sourceFamily: "sample",
        sourceKind: "steps",
        title: "Alpha newer sample steps",
        unit: "count",
        value: 600,
      }),
    ],
    { metricFamily: "activity" },
  );
  assert.equal(recencyTieMetric.selection.title, "Alpha newer sample steps");

  const timestampTieMetric = resolveMetric(
    "steps",
    [
      makeMetricCandidate({
        candidateId: "alpha:steps:timestamp-1",
        date: "2026-04-06",
        externalRef: null,
        metric: "steps",
        occurredAt: "2026-04-06T07:00:00Z",
        paths: ["timestamp-1.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-06T07:01:00Z",
        recordIds: ["evt_timestamp_1"],
        sourceFamily: "sample",
        sourceKind: "steps",
        title: "Alpha timestamp one",
        unit: "count",
        value: 600,
      }),
      makeMetricCandidate({
        candidateId: "alpha:steps:timestamp-2",
        date: "2026-04-06",
        externalRef: null,
        metric: "steps",
        occurredAt: "2026-04-06T08:00:00Z",
        paths: ["timestamp-2.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-06T08:01:00Z",
        recordIds: ["evt_timestamp_2"],
        sourceFamily: "sample",
        sourceKind: "steps",
        title: "Alpha timestamp two",
        unit: "count",
        value: 600,
      }),
      makeMetricCandidate({
        candidateId: "alpha:steps:timestamp-3",
        date: "2026-04-06",
        externalRef: null,
        metric: "steps",
        occurredAt: "2026-04-06T09:00:00Z",
        paths: ["timestamp-3.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-06T09:01:00Z",
        recordIds: ["evt_timestamp_3"],
        sourceFamily: "sample",
        sourceKind: "steps",
        title: "Alpha timestamp three",
        unit: "count",
        value: 600,
      }),
      makeMetricCandidate({
        candidateId: "alpha:steps:timestamp-4",
        date: "2026-04-06",
        externalRef: null,
        metric: "steps",
        occurredAt: "2026-04-06T10:00:00Z",
        paths: ["timestamp-4.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-06T10:01:00Z",
        recordIds: ["evt_timestamp_4"],
        sourceFamily: "sample",
        sourceKind: "steps",
        title: "Alpha timestamp four",
        unit: "count",
        value: 600,
      }),
      makeMetricCandidate({
        candidateId: "alpha:steps:timestamp-5",
        date: "2026-04-06",
        externalRef: null,
        metric: "steps",
        occurredAt: "2026-04-06T11:00:00Z",
        paths: ["timestamp-5.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-06T11:01:00Z",
        recordIds: ["evt_timestamp_5"],
        sourceFamily: "sample",
        sourceKind: "steps",
        title: "Alpha timestamp five",
        unit: "count",
        value: 600,
      }),
    ],
    { metricFamily: "activity" },
  );
  assert.equal(timestampTieMetric.selection.title, "Alpha timestamp five");

  const candidateIdTieMetric = resolveMetric(
    "steps",
    [
      makeMetricCandidate({
        candidateId: "alpha:steps:candidate-a",
        date: "2026-04-07",
        externalRef: null,
        metric: "steps",
        occurredAt: "2026-04-07T08:00:00Z",
        paths: ["candidate-a.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-07T08:15:00Z",
        recordIds: ["evt_candidate_a"],
        sourceFamily: "sample",
        sourceKind: "steps",
        title: "Alpha candidate A",
        unit: "count",
        value: 600,
      }),
      makeMetricCandidate({
        candidateId: "alpha:steps:candidate-b",
        date: "2026-04-07",
        externalRef: null,
        metric: "steps",
        occurredAt: "2026-04-07T08:00:00Z",
        paths: ["candidate-b.jsonl"],
        provider: "alpha",
        recordedAt: "2026-04-07T08:15:00Z",
        recordIds: ["evt_candidate_b"],
        sourceFamily: "sample",
        sourceKind: "steps",
        title: "Alpha candidate B",
        unit: "count",
        value: 600,
      }),
    ],
    { metricFamily: "activity" },
  );
  assert.equal(candidateIdTieMetric.selection.title, "Alpha candidate A");

  const emptySleepSelection = resolveSleepWindowSelection([]);
  assert.equal(emptySleepSelection.selection, null);
  assert.equal(emptySleepSelection.confidence.level, "none");

  const durationTieSleepSelection = resolveSleepWindowSelection([
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:longer",
      date: "2026-04-08",
      durationMinutes: 480,
      endAt: "2026-04-09T06:00:00Z",
      nap: false,
      occurredAt: "2026-04-08T22:00:00Z",
      paths: ["sleep-longer.jsonl"],
      provider: "alpha",
      recordedAt: "2026-04-09T06:05:00Z",
      recordIds: ["evt_sleep_longer"],
      sourceFamily: "event",
      sourceKind: "sleep_session",
      startAt: "2026-04-08T22:00:00Z",
      title: "Alpha longer sleep",
    }),
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:shorter",
      date: "2026-04-08",
      durationMinutes: 470,
      endAt: "2026-04-09T05:50:00Z",
      nap: false,
      occurredAt: "2026-04-08T21:50:00Z",
      paths: ["sleep-shorter.jsonl"],
      provider: "alpha",
      recordedAt: "2026-04-09T06:06:00Z",
      recordIds: ["evt_sleep_shorter"],
      sourceFamily: "event",
      sourceKind: "sleep_session",
      startAt: "2026-04-08T21:50:00Z",
      title: "Alpha shorter sleep",
    }),
  ]);
  assert.equal(durationTieSleepSelection.selection?.title, "Alpha longer sleep");

  const timestampTieSleepSelection = resolveSleepWindowSelection([
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:timestamp-1",
      date: "2026-04-09",
      durationMinutes: 420,
      endAt: "2026-04-10T06:00:00Z",
      nap: false,
      occurredAt: "2026-04-09T22:00:00Z",
      paths: ["sleep-ts-1.jsonl"],
      provider: "alpha",
      recordedAt: "2026-04-10T06:01:00Z",
      recordIds: ["evt_sleep_ts_1"],
      sourceFamily: "sample",
      sourceKind: "sleep_session",
      startAt: "2026-04-09T22:00:00Z",
      title: "Alpha timestamp one",
    }),
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:timestamp-2",
      date: "2026-04-09",
      durationMinutes: 420,
      endAt: "2026-04-10T06:00:00Z",
      nap: false,
      occurredAt: "2026-04-09T22:00:00Z",
      paths: ["sleep-ts-2.jsonl"],
      provider: "alpha",
      recordedAt: "2026-04-10T06:02:00Z",
      recordIds: ["evt_sleep_ts_2"],
      sourceFamily: "sample",
      sourceKind: "sleep_session",
      startAt: "2026-04-09T22:00:00Z",
      title: "Alpha timestamp two",
    }),
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:timestamp-3",
      date: "2026-04-09",
      durationMinutes: 420,
      endAt: "2026-04-10T06:00:00Z",
      nap: false,
      occurredAt: "2026-04-09T22:00:00Z",
      paths: ["sleep-ts-3.jsonl"],
      provider: "alpha",
      recordedAt: "2026-04-10T06:03:00Z",
      recordIds: ["evt_sleep_ts_3"],
      sourceFamily: "sample",
      sourceKind: "sleep_session",
      startAt: "2026-04-09T22:00:00Z",
      title: "Alpha timestamp three",
    }),
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:timestamp-4",
      date: "2026-04-09",
      durationMinutes: 420,
      endAt: "2026-04-10T06:00:00Z",
      nap: false,
      occurredAt: "2026-04-09T22:00:00Z",
      paths: ["sleep-ts-4.jsonl"],
      provider: "alpha",
      recordedAt: "2026-04-10T06:04:00Z",
      recordIds: ["evt_sleep_ts_4"],
      sourceFamily: "sample",
      sourceKind: "sleep_session",
      startAt: "2026-04-09T22:00:00Z",
      title: "Alpha timestamp four",
    }),
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:timestamp-5",
      date: "2026-04-09",
      durationMinutes: 420,
      endAt: "2026-04-10T06:00:00Z",
      nap: false,
      occurredAt: "2026-04-09T22:00:00Z",
      paths: ["sleep-ts-5.jsonl"],
      provider: "alpha",
      recordedAt: "2026-04-10T06:05:00Z",
      recordIds: ["evt_sleep_ts_5"],
      sourceFamily: "sample",
      sourceKind: "sleep_session",
      startAt: "2026-04-09T22:00:00Z",
      title: "Alpha timestamp five",
    }),
  ]);
  assert.equal(timestampTieSleepSelection.selection?.provider, "alpha");

  const candidateIdTieSleepSelection = resolveSleepWindowSelection([
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:candidate-a",
      date: "2026-04-10",
      durationMinutes: 410,
      endAt: "2026-04-11T06:10:00Z",
      nap: false,
      occurredAt: "2026-04-10T22:10:00Z",
      paths: ["sleep-candidate-a.jsonl"],
      provider: "alpha",
      recordedAt: "2026-04-11T06:15:00Z",
      recordIds: ["evt_sleep_candidate_a"],
      sourceFamily: "sample",
      sourceKind: "sleep_session",
      startAt: "2026-04-10T22:10:00Z",
      title: "Alpha candidate A",
    }),
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:candidate-b",
      date: "2026-04-10",
      durationMinutes: 410,
      endAt: "2026-04-11T06:10:00Z",
      nap: false,
      occurredAt: "2026-04-10T22:10:00Z",
      paths: ["sleep-candidate-b.jsonl"],
      provider: "alpha",
      recordedAt: "2026-04-11T06:15:00Z",
      recordIds: ["evt_sleep_candidate_b"],
      sourceFamily: "sample",
      sourceKind: "sleep_session",
      startAt: "2026-04-10T22:10:00Z",
      title: "Alpha candidate B",
    }),
  ]);
  assert.equal(candidateIdTieSleepSelection.selection?.title, "Alpha candidate A");

  const fallbackTimestampSleepSelection = resolveSleepWindowSelection([
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:end-at",
      date: "2026-04-11",
      durationMinutes: 405,
      endAt: "2026-04-12T06:10:00Z",
      nap: false,
      occurredAt: "2026-04-11T22:05:00Z",
      paths: ["sleep-end-at.jsonl"],
      provider: "alpha",
      recordedAt: null,
      recordIds: ["evt_sleep_end_at"],
      sourceFamily: "sample",
      sourceKind: "sleep_session",
      startAt: null,
      title: "Alpha end-at sleep",
    }),
    makeSleepWindowCandidate({
      candidateId: "alpha:sleep:start-at",
      date: "2026-04-11",
      durationMinutes: 405,
      endAt: null,
      nap: false,
      occurredAt: "2026-04-11T22:05:00Z",
      paths: ["sleep-start-at.jsonl"],
      provider: "alpha",
      recordedAt: null,
      recordIds: ["evt_sleep_start_at"],
      sourceFamily: "sample",
      sourceKind: "sleep_session",
      startAt: "2026-04-11T22:05:00Z",
      title: "Alpha start-at sleep",
    }),
  ]);
  assert.equal(fallbackTimestampSleepSelection.selection?.title, "Alpha end-at sleep");
});
